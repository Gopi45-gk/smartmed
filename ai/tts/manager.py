"""
SmartMed AI - TTS Engine Manager
Unified manager for offline neural Text-to-Speech using Piper ONNX and Kokoro TTS.
"""

import io
import os
import wave
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
    - Kokoro TTS: High-quality 82M open-weight neural voice
    - Piper ONNX: Ultra-fast lightweight on-device speech synthesis
    """

    def __init__(self):
        self._piper_voice = None
        self._piper_model_path: Optional[Path] = None
        self._kokoro_voice = None
        self._kokoro_model_path: Optional[Path] = None

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

    def synthesize(
        self,
        text: str,
        engine: str = "auto",
        voice: Optional[str] = None,
        speed: float = 1.0,
        lang: str = "en",
    ) -> tuple[bytes, str]:
        """
        Unified synthesis.
        Returns: (wav_bytes, engine_used)
        """
        clean_text = text.strip()
        if not clean_text:
            raise ValueError("Text cannot be empty")

        kokoro_ready = self.find_kokoro_model() is not None
        piper_ready = self.find_piper_model() is not None

        # Resolve engine
        target_engine = engine.lower()
        if target_engine == "auto":
            if kokoro_ready:
                target_engine = "kokoro"
            elif piper_ready:
                target_engine = "piper"
            else:
                target_engine = "none"

        if target_engine == "kokoro":
            lang_code = "en-us" if lang.startswith("en") else lang
            kokoro_voice = voice or "af_sarah"
            return self.synthesize_kokoro(clean_text, voice=kokoro_voice, speed=speed, lang=lang_code), "kokoro"

        if target_engine == "piper":
            return self.synthesize_piper(clean_text, rate=speed), "piper"

        raise RuntimeError(
            "No offline TTS models (Kokoro/Piper) found. "
            "Run 'python ai/download_voice_models.py' to download voice models."
        )

    # ─── Status & Info ──────────────────────────────────────────────────────────

    def get_status(self) -> Dict[str, Any]:
        """Check status of installed TTS engines and models."""
        piper_pair = self.find_piper_model()
        kokoro_pair = self.find_kokoro_model()

        return {
            "status": "ready" if (piper_pair or kokoro_pair) else "no_models",
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
            "models_dir": str(_MODELS_DIR),
        }

    def get_voices(self) -> List[Dict[str, str]]:
        """List available voices across both engines."""
        voices = []
        if self.find_piper_model():
            voices.append({
                "id": "piper-default",
                "name": "Piper ONNX (Fast Neural Voice)",
                "engine": "piper",
                "lang": "en",
            })
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
                    "name": "Kokoro (Sarah - Natural)",
                    "engine": "kokoro",
                    "lang": "en",
                })
        return voices


# Singleton instance
tts_manager = TTSManager()
