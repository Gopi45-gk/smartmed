"""
SmartMed Voice Companion - Conversation Service
Manages interactive two-way voice sessions, turns, audio transcription,
and conversational speech generation.
"""

import uuid
import base64
import logging
from typing import Dict, Any, List, Optional
from datetime import datetime, timezone

from .language_handler import normalize_language_code, get_greeting_text
from .tts_service import voice_tts_service
from .medical_intelligence import medical_intelligence_engine

logger = logging.getLogger("smartmed.ai.voice.session")


class VoiceSessionManager:
    """
    In-memory manager for active voice conversations.
    """

    def __init__(self):
        self._sessions: Dict[str, Dict[str, Any]] = {}

    def start_session(
        self,
        patient_id: str = "guest",
        language: str = "en",
        patient_profile: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        Begins a new voice companion session:
        1. Formulates localized greeting in patient's language.
        2. Synthesizes Kokoro / Indic TTS audio for greeting.
        3. Initializes session state and history.
        """
        session_id = f"vses-{uuid.uuid4().hex[:10]}"
        lang = normalize_language_code(language)
        greeting = get_greeting_text(lang)

        # Synthesize greeting voice
        tts_res = voice_tts_service.synthesize_speech(
            text=greeting,
            language=lang,
            speed=0.95,
        )

        session_record = {
            "session_id": session_id,
            "patient_id": patient_id,
            "language": lang,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "history": [
                {
                    "role": "assistant",
                    "content": greeting,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                }
            ],
            "profile": patient_profile or {},
            "active": True,
        }
        self._sessions[session_id] = session_record

        return {
            "success": True,
            "session_id": session_id,
            "greeting_text": greeting,
            "audio_base64": tts_res.get("audio_base64"),
            "engine_used": tts_res.get("engine_used"),
            "language": lang,
        }

    def process_message(
        self,
        session_id: str,
        user_text: Optional[str] = None,
        audio_base64: Optional[str] = None,
        language: Optional[str] = None,
        patient_profile: Optional[Dict[str, Any]] = None,
        medicines: Optional[List[Dict[str, Any]]] = None,
        caregivers: Optional[List[Dict[str, Any]]] = None,
        latest_glucose: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        Executes a two-way conversational turn:
        1. Transcribes audio if audio is provided.
        2. Retrieves clinical intelligence response.
        3. Synthesizes speech response using Kokoro/Indic TTS.
        4. Maintains conversational turn history.
        """
        session = self._sessions.get(session_id)
        current_lang = normalize_language_code(language or (session.get("language") if session else "en"))

        # 1. Speech-to-Text if raw audio is provided
        transcript = (user_text or "").strip()
        if not transcript and audio_base64:
            try:
                from stt.manager import stt_manager
                # Strip data URL prefix if present
                clean_b64 = audio_base64.split(",")[-1] if "," in audio_base64 else audio_base64
                audio_bytes = base64.b64decode(clean_b64)
                ok, stt_text, _ = stt_manager.transcribe(audio_bytes, language=current_lang)
                if ok and stt_text:
                    transcript = stt_text
            except Exception as e:
                logger.warning(f"Voice session STT error: {e}")

        if not transcript:
            return {
                "success": False,
                "error": "No speech or text detected. Please speak clearly into your microphone.",
                "response_text": "I didn't catch that. Could you please repeat your question?",
                "audio_base64": None,
            }

        # 2. Extract conversation history
        conv_history = []
        if session:
            conv_history = [
                {"role": h["role"], "content": h["content"]}
                for h in session.get("history", [])[-6:]
            ]

        profile_data = patient_profile or (session.get("profile") if session else None)

        # 3. Medical Intelligence Engine Query
        med_res = medical_intelligence_engine.generate_reply(
            query=transcript,
            language=current_lang,
            conversation_history=conv_history,
            patient_profile=profile_data,
            medicines=medicines,
            caregivers=caregivers,
            latest_glucose=latest_glucose,
        )

        reply_text = med_res.get("response_text", "")

        # 4. Synthesize Kokoro / Indic voice
        tts_res = voice_tts_service.synthesize_speech(
            text=reply_text,
            language=current_lang,
            speed=0.95,
        )

        # 5. Record turn
        if session:
            now_iso = datetime.now(timezone.utc).isoformat()
            session["history"].append({"role": "user", "content": transcript, "timestamp": now_iso})
            session["history"].append({"role": "assistant", "content": reply_text, "timestamp": now_iso})

        return {
            "success": True,
            "session_id": session_id,
            "patient_text": transcript,
            "response_text": reply_text,
            "audio_base64": tts_res.get("audio_base64"),
            "engine_used": tts_res.get("engine_used"),
            "is_emergency": med_res.get("is_emergency", False),
            "suggest_sos": med_res.get("suggest_sos", False),
            "emergency_number": med_res.get("emergency_number"),
            "language": current_lang,
        }

    def end_session(self, session_id: str) -> Dict[str, Any]:
        """Ends an active session."""
        session = self._sessions.get(session_id)
        if session:
            session["active"] = False
            session["ended_at"] = datetime.now(timezone.utc).isoformat()
            return {
                "success": True,
                "session_id": session_id,
                "turn_count": len(session.get("history", [])),
                "message": "Session completed successfully.",
            }
        return {"success": False, "error": "Session not found"}


voice_session_manager = VoiceSessionManager()
