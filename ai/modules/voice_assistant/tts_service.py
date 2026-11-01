"""
SmartMed Voice Companion - TTS Service
Synthesizes speech using Kokoro TTS (Primary for English),
Local Offline Indic TTS for Indian languages (ta, hi, te, kn, ml, ur, bn, mr),
and Piper ONNX fallback.
"""

import base64
import logging
from typing import Dict, Any, Tuple
from tts.manager import tts_manager

logger = logging.getLogger("smartmed.ai.voice.tts")


class VoiceCompanionTTSService:
    """
    Dedicated voice synthesis service for the interactive medical companion.
    """

    def synthesize_speech(
        self,
        text: str,
        language: str = "en",
        speed: float = 0.95,
    ) -> Dict[str, Any]:
        """
        Synthesizes text to speech, returning engine info and base64 audio.
        """
        clean_text = text.strip()
        if not clean_text:
            return {
                "success": False,
                "error": "Empty text provided for synthesis",
                "audio_base64": None,
                "engine_used": "none",
            }

        lang = (language or "en").lower().split("-")[0].strip()

        try:
            wav_bytes, engine_used = tts_manager.synthesize(
                text=clean_text,
                speed=speed,
                lang=lang,
            )
            audio_base64 = base64.b64encode(wav_bytes).decode("ascii")
            return {
                "success": True,
                "audio_base64": f"data:audio/wav;base64,{audio_base64}",
                "engine_used": engine_used,
                "byte_size": len(wav_bytes),
                "language": lang,
            }
        except Exception as e:
            logger.error(f"Voice companion TTS failed: {e}")
            return {
                "success": False,
                "error": str(e),
                "audio_base64": None,
                "engine_used": "failed",
                "language": lang,
            }


voice_tts_service = VoiceCompanionTTSService()
