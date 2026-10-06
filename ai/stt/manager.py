"""
SmartMed AI - Offline Speech-to-Text Manager
Provides on-device, GPU-accelerated speech transcription using faster-whisper.
Supports English, Tamil, Hindi, Telugu, Urdu, Malayalam, and Kannada offline.
"""

import io
import logging
from typing import Optional, Tuple

logger = logging.getLogger("smartmed.ai.stt")

try:
    import torch
    _HAS_CUDA = torch.cuda.is_available()
except Exception:
    _HAS_CUDA = False

# Language code normalization for Whisper
WHISPER_LANG_MAP = {
    "en": "en",
    "ta": "ta",
    "hi": "hi",
    "ur": "ur",
    "te": "te",
    "ml": "ml",
    "kn": "kn",
}


class STTManager:
    """
    Manages offline, low-latency Speech-to-Text inference using faster-whisper.
    Runs on NVIDIA GPU with float16 when available, with automatic CPU int8 fallback.
    """

    def __init__(self, model_size: str = "tiny"):
        self.model_size = model_size
        self._model = None
        self._device = "cuda" if _HAS_CUDA else "cpu"
        self._compute_type = "float16" if self._device == "cuda" else "int8"

    def get_model(self):
        """Lazy load the Whisper model."""
        if self._model is not None:
            return self._model

        try:
            from faster_whisper import WhisperModel
            logger.info(
                f"Loading offline Whisper model '{self.model_size}' on {self._device.upper()} ({self._compute_type})..."
            )
            self._model = WhisperModel(
                self.model_size,
                device=self._device,
                compute_type=self._compute_type,
            )
            logger.info(f"✓ Offline Whisper model loaded successfully on {self._device.upper()}.")
            return self._model
        except Exception as e:
            if self._device == "cuda":
                logger.warning(f"CUDA faster-whisper load failed ({e}), falling back to CPU...")
                try:
                    from faster_whisper import WhisperModel
                    self._device = "cpu"
                    self._compute_type = "int8"
                    self._model = WhisperModel(
                        self.model_size,
                        device="cpu",
                        compute_type="int8",
                    )
                    logger.info("✓ Offline Whisper model loaded successfully on CPU fallback.")
                    return self._model
                except Exception as cpu_e:
                    logger.error(f"CPU faster-whisper load also failed: {cpu_e}", exc_info=True)
                    return None
            else:
                logger.error(f"Failed to load Whisper model: {e}", exc_info=True)
                return None

    def transcribe(
        self,
        audio_bytes: bytes,
        language: Optional[str] = None,
    ) -> Tuple[bool, str, Optional[str]]:
        """
        Transcribe audio bytes (WebM, WAV, OGG, etc.) into text.
        Returns: (success: bool, transcript: str, error: Optional[str])
        """
        if not audio_bytes or len(audio_bytes) < 100:
            return False, "", "Audio file is empty or too short"

        model = self.get_model()
        if model is None:
            return False, "", "Offline STT model could not be initialized"

        whisper_lang = None
        if language:
            code = language.lower().split("-")[0].strip()
            whisper_lang = WHISPER_LANG_MAP.get(code, None)

        try:
            audio_stream = io.BytesIO(audio_bytes)
            segments, info = model.transcribe(
                audio_stream,
                language=whisper_lang,
                beam_size=3,
                vad_filter=True,
                vad_parameters=dict(min_silence_duration_ms=500),
            )

            texts = [s.text.strip() for s in segments if s.text and s.text.strip()]
            transcript = " ".join(texts).strip()

            detected_lang = getattr(info, "language", whisper_lang or "unknown")
            logger.info(f"STT transcribed ({len(audio_bytes)} bytes, lang={detected_lang}): '{transcript}'")
            return True, transcript, None
        except Exception as e:
            logger.error(f"Transcription error: {e}", exc_info=True)
            return False, "", str(e)


# Singleton
stt_manager = STTManager(model_size="tiny")
