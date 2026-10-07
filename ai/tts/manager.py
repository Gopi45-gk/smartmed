"""
SmartMed AI - TTS Engine Manager
Unified manager for offline neural Text-to-Speech using Piper ONNX and Kokoro TTS.
"""

import io
import os
import wave
import shutil
import subprocess
import logging
from pathlib import Path
from typing import Optional, Dict, Any, List

logger = logging.getLogger("smartmed.ai.tts")

_BASE_DIR = Path(__file__).resolve().parent
_MODELS_DIR = _BASE_DIR / "models"
_PIPER_DIR = _MODELS_DIR / "piper"
_KOKORO_DIR = _MODELS_DIR / "kokoro"


class TTSManager:
    """
    Manages offline neural TTS models:
    - Kokoro TTS: High-quality 82M open-weight neural voice (Primary for English)
    - Local Offline Indic TTS: Fast, on-device language-compatible synthesis for Indic scripts
    - Piper ONNX: Lightweight on-device fallback speech synthesis
    """

    def __init__(self):
        self._piper_voice = None
        self._piper_model_path: Optional[Path] = None
        self._kokoro_voice = None
        self._kokoro_model_path: Optional[Path] = None
        self._audio_cache: Dict[str, bytes] = {}
        self._cache_max: int = 128

        # Ensure directories exist
        _PIPER_DIR.mkdir(parents=True, exist_ok=True)
        _KOKORO_DIR.mkdir(parents=True, exist_ok=True)

    # ─── Model Discovery ────────────────────────────────────────────────────────

    def find_piper_model(self) -> Optional[tuple[Path, Path]]:
        """Find the first available Piper ONNX model and config."""
        for onnx_file in _PIPER_DIR.glob("*.onnx"):
            config_file = onnx_file.with_suffix(".onnx.json")
            if not config_file.exists():
                config_file = onnx_file.with_suffix(".json")
            if config_file.exists():
                return onnx_file, config_file
        return None

    def find_kokoro_model(self) -> Optional[tuple[Path, Path]]:
        """Find Kokoro ONNX model and voices file."""
        model_file = _KOKORO_DIR / "kokoro-v0_19.onnx"
        if not model_file.exists():
            onnx_files = list(_KOKORO_DIR.glob("*.onnx"))
            model_file = onnx_files[0] if onnx_files else None

        voices_file = _KOKORO_DIR / "voices.bin"
        if not voices_file.exists():
            voices_file = _KOKORO_DIR / "voices.json"

        if model_file and model_file.exists() and voices_file.exists():
            return model_file, voices_file
        return None

    # ─── Loaders ────────────────────────────────────────────────────────────────

    def get_piper_voice(self):
        """Lazy-load Piper voice model."""
        if self._piper_voice is not None:
            return self._piper_voice

        pair = self.find_piper_model()
        if not pair:
            return None

        model_path, config_path = pair
        try:
            import piper
            logger.info(f"Loading Piper ONNX voice from {model_path.name}...")
            self._piper_voice = piper.PiperVoice.load(
                str(model_path),
                config_path=str(config_path),
            )
            self._piper_model_path = model_path
            logger.info("✓ Piper ONNX voice loaded successfully.")
            return self._piper_voice
        except Exception as e:
            logger.error(f"Failed to load Piper ONNX model: {e}")
            return None

    def get_kokoro_voice(self):
        """Lazy-load Kokoro voice model."""
        if self._kokoro_voice is not None:
            return self._kokoro_voice

        pair = self.find_kokoro_model()
        if not pair:
            return None

        model_path, voices_path = pair
        try:
            import numpy as np
            import kokoro_onnx

            orig_load = np.load
            def safe_np_load(*args, **kwargs):
                kwargs.setdefault("allow_pickle", True)
                return orig_load(*args, **kwargs)
            np.load = safe_np_load

            logger.info(f"Loading Kokoro TTS from {model_path.name} with {voices_path.name}...")
            self._kokoro_voice = kokoro_onnx.Kokoro(
                str(model_path),
                str(voices_path),
            )
            self._kokoro_model_path = model_path
            logger.info("✓ Kokoro TTS loaded successfully.")
            return self._kokoro_voice
        except Exception as e:
            logger.error(f"Failed to load Kokoro TTS model: {e}")
            return None

    # ─── Synthesis ──────────────────────────────────────────────────────────────

    def synthesize_piper(
        self,
        text: str,
        rate: float = 1.0,
    ) -> bytes:
        """Synthesize speech using Piper ONNX to WAV bytes."""
        voice = self.get_piper_voice()
        if not voice:
            raise RuntimeError("Piper ONNX model not loaded or not found in models/piper/")

        clean_text = text.strip()
        wav_io = io.BytesIO()
        with wave.open(wav_io, "wb") as wav_file:
            voice.synthesize_wav(clean_text, wav_file)
        return wav_io.getvalue()

    def synthesize_kokoro(
        self,
        text: str,
        voice: str = "af_sarah",
        speed: float = 1.0,
        lang: str = "en-us",
    ) -> bytes:
        """Synthesize speech using Kokoro TTS to WAV bytes."""
        kokoro = self.get_kokoro_voice()
        if not kokoro:
            raise RuntimeError("Kokoro TTS model not loaded or not found in models/kokoro/")

        import soundfile as sf

        clean_text = text.strip()
        # Fallback to available voice style if given voice not found
        available = kokoro.get_voices()
        target_voice = voice if voice in available else (available[0] if available else "af_sarah")

        samples, sample_rate = kokoro.create(
            clean_text,
            voice=target_voice,
            speed=speed,
            lang=lang,
        )

        wav_io = io.BytesIO()
        sf.write(wav_io, samples, sample_rate, format="WAV")
        return wav_io.getvalue()

    def synthesize_offline_indic(
        self,
        text: str,
        lang: str = "ta",
        speed: float = 1.0,
    ) -> bytes:
        """
        Synthesize speech using local offline Indic TTS engine (espeak-ng).
        Supports: ta, hi, te, kn, ml, etc.
        """
        clean_text = text.strip()
        voice_map = {
            "ta": "ta",
            "hi": "hi",
            "te": "te",
            "kn": "kn",
            "ml": "ml",
            "en": "en-us",
        }
        voice = voice_map.get(lang.lower().split("-")[0], "ta")
        wpm = max(80, min(260, int(155 * speed)))

        espeak_bin = shutil.which("espeak-ng") or "/usr/bin/espeak-ng"
        if not os.path.exists(espeak_bin):
            raise RuntimeError(f"Local offline Indic TTS engine not found at {espeak_bin}")

        res = subprocess.run(
            [espeak_bin, "-v", voice, "-s", str(wpm), "--stdout", clean_text],
            capture_output=True,
            check=True,
        )
        if not res.stdout:
            raise RuntimeError("Offline Indic TTS returned empty audio")
        return res.stdout

    def synthesize(
        self,
        text: str,
        engine: str = "auto",
        voice: Optional[str] = None,
        speed: float = 1.0,
        lang: str = "en",
    ) -> tuple[bytes, str]:
        """
        Unified synthesis following strict Kokoro + Offline Voice Architecture:
        1. English: Kokoro TTS is the PRIMARY local neural synthesis engine.
        2. Non-English (ta, hi, te, kn, ml): Kokoro-v0.19 tokenizer supports English/IPA.
           Per prompt rule 3, route to local offline language-compatible Indic TTS (espeak-ng).
        3. Local audio cache for low latency.
        Returns: (wav_bytes, engine_used)
        """
        clean_text = text.strip()
        if not clean_text:
            raise ValueError("Text cannot be empty")

        norm_lang = (lang or "en").lower().split("-")[0].strip()

        # Check in-memory audio cache for instant sub-millisecond response
        cache_key = f"{norm_lang}:{engine}:{voice or 'default'}:{speed:.2f}:{clean_text}"
        if cache_key in self._audio_cache:
            logger.debug(f"Audio cache hit for key: {cache_key[:40]}")
            engine_name = "kokoro" if norm_lang == "en" else "offline_indic"
            return self._audio_cache[cache_key], engine_name

        wav_bytes: Optional[bytes] = None
        engine_used: str = "auto"

        # Route 1: Indic non-English languages (ta, hi, te, kn, ml)
        if norm_lang in ("ta", "hi", "te", "kn", "ml"):
            try:
                wav_bytes = self.synthesize_offline_indic(clean_text, lang=norm_lang, speed=speed)
                engine_used = "offline_indic"
            except Exception as e:
                logger.error(f"Local offline Indic TTS failed for {norm_lang}: {e}")
                raise

        # Route 2: English (or user-forced kokoro/piper)
        else:
            kokoro_ready = self.find_kokoro_model() is not None
            piper_ready = self.find_piper_model() is not None

            # Resolve engine: Kokoro is PRIMARY local synthesis engine
            target_engine = engine.lower()
            if target_engine == "auto":
                target_engine = "kokoro" if kokoro_ready else ("piper" if piper_ready else "offline_indic")

            if target_engine == "kokoro":
                try:
                    lang_code = "en-us"
                    kokoro_voice = voice or "af_sarah"
                    wav_bytes = self.synthesize_kokoro(clean_text, voice=kokoro_voice, speed=speed, lang=lang_code)
                    engine_used = "kokoro"
                except Exception as e:
                    logger.warning(f"Kokoro TTS synthesis error: {e}. Falling back to Piper/offline engine.")
                    if piper_ready:
                        wav_bytes = self.synthesize_piper(clean_text, rate=speed)
                        engine_used = "piper"
                    else:
                        wav_bytes = self.synthesize_offline_indic(clean_text, lang="en", speed=speed)
                        engine_used = "offline_indic"

            elif target_engine == "piper":
                try:
                    wav_bytes = self.synthesize_piper(clean_text, rate=speed)
                    engine_used = "piper"
                except Exception as e:
                    logger.warning(f"Piper synthesis error: {e}. Falling back to Kokoro.")
                    if kokoro_ready:
                        wav_bytes = self.synthesize_kokoro(clean_text, voice=voice or "af_sarah", speed=speed, lang="en-us")
                        engine_used = "kokoro"
                    else:
                        wav_bytes = self.synthesize_offline_indic(clean_text, lang="en", speed=speed)
                        engine_used = "offline_indic"

            else:
                wav_bytes = self.synthesize_offline_indic(clean_text, lang="en", speed=speed)
                engine_used = "offline_indic"

        if not wav_bytes:
            raise RuntimeError("TTS synthesis yielded no audio data")

        # Store in cache (limit to _cache_max items)
        if len(self._audio_cache) >= self._cache_max:
            first_key = next(iter(self._audio_cache))
            del self._audio_cache[first_key]
        self._audio_cache[cache_key] = wav_bytes

        return wav_bytes, engine_used

    # ─── Status & Info ──────────────────────────────────────────────────────────

    def get_status(self) -> Dict[str, Any]:
        """Check status of installed TTS engines and models."""
        piper_pair = self.find_piper_model()
        kokoro_pair = self.find_kokoro_model()
        indic_bin = shutil.which("espeak-ng") or "/usr/bin/espeak-ng"

        return {
            "status": "ready" if (piper_pair or kokoro_pair or os.path.exists(indic_bin)) else "no_models",
            "piper": {
                "available": piper_pair is not None,
                "model": piper_pair[0].name if piper_pair else None,
                "loaded": self._piper_voice is not None,
            },
            "kokoro": {
                "available": kokoro_pair is not None,
                "model": kokoro_pair[0].name if kokoro_pair else None,
                "loaded": self._kokoro_voice is not None,
            },
            "offline_indic": {
                "available": os.path.exists(indic_bin),
                "engine": "espeak-ng",
                "languages": ["ta", "hi", "te", "kn", "ml"],
            },
            "cache_entries": len(self._audio_cache),
            "models_dir": str(_MODELS_DIR),
        }

    def get_voices(self) -> List[Dict[str, str]]:
        """List available voices across all engines (Kokoro, Indic offline, Piper)."""
        voices = []
        if self.find_kokoro_model():
            kokoro = self.get_kokoro_voice()
            if kokoro:
                try:
                    for v in kokoro.get_voices():
                        voices.append({
                            "id": v,
                            "name": f"Kokoro - {v.replace('_', ' ').title()}",
                            "engine": "kokoro",
                            "lang": "en",
                        })
                except Exception:
                    pass
            if not voices or not any(v["engine"] == "kokoro" for v in voices):
                voices.append({
                    "id": "af_sarah",
                    "name": "Kokoro (Sarah - Natural Neural Voice)",
                    "engine": "kokoro",
                    "lang": "en",
                })

        # Local Offline Indic Voices
        voices.extend([
            {"id": "indic_ta", "name": "Tamil (Local Offline Voice)", "engine": "offline_indic", "lang": "ta"},
            {"id": "indic_hi", "name": "Hindi (Local Offline Voice)", "engine": "offline_indic", "lang": "hi"},
            {"id": "indic_te", "name": "Telugu (Local Offline Voice)", "engine": "offline_indic", "lang": "te"},
            {"id": "indic_kn", "name": "Kannada (Local Offline Voice)", "engine": "offline_indic", "lang": "kn"},
            {"id": "indic_ml", "name": "Malayalam (Local Offline Voice)", "engine": "offline_indic", "lang": "ml"},
        ])

        if self.find_piper_model():
            voices.append({
                "id": "piper-default",
                "name": "Piper ONNX (Fast Neural Voice)",
                "engine": "piper",
                "lang": "en",
            })
        return voices


# Singleton instance
tts_manager = TTSManager()
