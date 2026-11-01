"""
SmartMed API - Interactive Medical Voice Companion Router
Provides endpoints for starting voice sessions, conversational dialogue turns,
Kokoro TTS synthesis, and session finalization.
"""

import logging
from typing import Optional, Dict, Any, List
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from modules.voice_assistant.conversation_service import voice_session_manager
from modules.voice_assistant.tts_service import voice_tts_service

logger = logging.getLogger("smartmed.ai.router.voice")

router = APIRouter(prefix="/api/voice/session", tags=["Interactive Voice Companion"])


# ─── Pydantic Request Models ─────────────────────────────────────────────────

class VoiceSessionStartRequest(BaseModel):
    patient_id: str = Field("guest", description="Patient identifier")
    language: str = Field("en", description="Patient preferred language (en, ta, hi, te, etc.)")
    patient_profile: Optional[Dict[str, Any]] = Field(default=None, description="Patient profile demographics")


class VoiceSessionMessageRequest(BaseModel):
    session_id: str = Field(..., description="Active session identifier")
    user_text: Optional[str] = Field(default=None, description="Transcribed user speech or typed text")
    audio_base64: Optional[str] = Field(default=None, description="Optional raw microphone recorded audio data URL")
    language: Optional[str] = Field(default=None, description="Language code")
    patient_profile: Optional[Dict[str, Any]] = Field(default=None, description="Patient demographics")
    medicines: Optional[List[Dict[str, Any]]] = Field(default=None, description="Active prescriptions and medication schedule")
    caregivers: Optional[List[Dict[str, Any]]] = Field(default=None, description="Caregiver contacts")
    latest_glucose: Optional[Dict[str, Any]] = Field(default=None, description="Recent blood glucose logs")


class VoiceSessionSpeakRequest(BaseModel):
    text: str = Field(..., description="Text to synthesize to speech")
    language: str = Field("en", description="Language code for voice synthesis")
    speed: float = Field(0.95, description="Playback speech speed (0.8 - 1.2)")


class VoiceSessionEndRequest(BaseModel):
    session_id: str = Field(..., description="Active session identifier to end")


# ─── Endpoints ───────────────────────────────────────────────────────────────

@router.post("/start")
async def start_voice_session(req: VoiceSessionStartRequest):
    """
    Initializes an interactive voice companion session.
    Returns:
    - session_id
    - localized greeting in target language
    - Kokoro/Indic TTS audio data URL for instantaneous playback
    """
    try:
        result = voice_session_manager.start_session(
            patient_id=req.patient_id,
            language=req.language,
            patient_profile=req.patient_profile,
        )
        return result
    except Exception as e:
        logger.error(f"Error starting voice session: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/message")
async def send_voice_message(req: VoiceSessionMessageRequest):
    """
    Continuous interactive voice conversation turn:
    - Accepts voice audio (WebM/WAV) or text.
    - Evaluates query with clinical context (prescriptions, glucose, vitals).
    - Checks for acute emergency symptoms (chest pain, dyspnea, stroke).
    - Synthesizes empathetic response using Kokoro/Indic TTS.
    - Returns text and audio payload for seamless automated microphone activation loop.
    """
    try:
        result = voice_session_manager.process_message(
            session_id=req.session_id,
            user_text=req.user_text,
            audio_base64=req.audio_base64,
            language=req.language,
            patient_profile=req.patient_profile,
            medicines=req.medicines,
            caregivers=req.caregivers,
            latest_glucose=req.latest_glucose,
        )
        return result
    except Exception as e:
        logger.error(f"Error processing voice message turn: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/speak")
async def speak_text(req: VoiceSessionSpeakRequest):
    """
    Direct voice synthesis endpoint using Kokoro / Indic TTS engine.
    """
    try:
        result = voice_tts_service.synthesize_speech(
            text=req.text,
            language=req.language,
            speed=req.speed,
        )
        return result
    except Exception as e:
        logger.error(f"Error synthesizing speech: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/end")
async def end_voice_session(req: VoiceSessionEndRequest):
    """
    Concludes the voice assistant session and returns conversation turn count.
    """
    try:
        result = voice_session_manager.end_session(session_id=req.session_id)
        return result
    except Exception as e:
        logger.error(f"Error ending voice session: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
