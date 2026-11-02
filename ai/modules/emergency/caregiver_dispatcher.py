"""
SmartMed Emergency Assistance System - Automated Caregiver Phone Call Dispatcher
Manages automated telephony calls to registered caregivers via Twilio Voice API,
pre-synthesizes emergency audio using Kokoro TTS / Piper fallback,
manages call statuses (SOS ACTIVATED -> CALLING CAREGIVER -> CAREGIVER CALL CONNECTED -> CAREGIVER ACKNOWLEDGED),
handles failed calls with automated retries and fallback notification alerts.
"""

import os
import io
import time
import logging
import threading
from typing import Dict, Any, Optional
from datetime import datetime
from urllib.parse import quote

from twilio_service import (
    get_twilio_client,
    format_e164_phone,
    mask_phone_number,
    TWILIO_PHONE_NUMBER,
    BASE_WEBHOOK_URL,
    normalize_language_code,
)
from tts.manager import tts_manager
from .emergency_status import emergency_tracker, EmergencyStatusEnum
from .caregiver_alert import caregiver_alert_service

logger = logging.getLogger("smartmed.ai.emergency.dispatcher")

# Dedicated Twilio Credentials strictly for SOS Emergency Calls (loaded from .env)
SOS_TWILIO_ACCOUNT_SID = os.getenv("SOS_TWILIO_ACCOUNT_SID", "")
SOS_TWILIO_AUTH_TOKEN = os.getenv("SOS_TWILIO_AUTH_TOKEN", "")
SOS_TWILIO_API_KEY = os.getenv("SOS_TWILIO_API_KEY", "")
SOS_TWILIO_API_SECRET = os.getenv("SOS_TWILIO_API_SECRET", "")
SOS_TWILIO_PHONE_NUMBER = os.getenv("SOS_TWILIO_PHONE_NUMBER", "+17372508034")

_sos_twilio_client = None

def get_sos_twilio_client():
    """Retrieve dedicated Twilio client initialized with SOS credentials."""
    global _sos_twilio_client
    if _sos_twilio_client is not None:
        return _sos_twilio_client

    try:
        from twilio.rest import Client
        if SOS_TWILIO_API_KEY and SOS_TWILIO_API_SECRET and SOS_TWILIO_ACCOUNT_SID:
            _sos_twilio_client = Client(SOS_TWILIO_API_KEY, SOS_TWILIO_API_SECRET, account_sid=SOS_TWILIO_ACCOUNT_SID)
            logger.info("✓ SOS Dedicated Twilio Client initialized with API Key.")
        elif SOS_TWILIO_ACCOUNT_SID and SOS_TWILIO_AUTH_TOKEN:
            _sos_twilio_client = Client(SOS_TWILIO_ACCOUNT_SID, SOS_TWILIO_AUTH_TOKEN)
            logger.info("✓ SOS Dedicated Twilio Client initialized with Auth Token.")
    except Exception as e:
        logger.warning(f"Could not initialize dedicated SOS Twilio client: {e}")

    if _sos_twilio_client is None:
        _sos_twilio_client = get_twilio_client()

    return _sos_twilio_client

# In-memory audio cache for caregiver voice calls
_sos_audio_cache: Dict[str, bytes] = {}

# Max retry limit for failed caregiver calls
MAX_CALL_RETRIES = 3


def generate_caregiver_call_message(
    patient_name: str,
    language: str = "en",
    activation_time: Optional[str] = None,
) -> str:
    """
    Constructs the automated voice call message for the caregiver in the patient's selected language.
    Strictly follows the SmartMed Emergency Specification.
    """
    time_str = activation_time or datetime.now().strftime("%I:%M %p")
    lang = normalize_language_code(language)
    name = patient_name.strip() if patient_name else "your family member"

    if lang == "ta":
        return (
            f"SmartMed அவசர எச்சரிக்கை. உங்கள் குடும்ப உறுப்பினர் {name} அவசர உதவிக்காக SOS பொத்தானை அழுத்தியுள்ளார். "
            f"அவருக்கு உடனடியாக உதவி தேவைப்படுகிறது. தயவுசெய்து உடனடியாக அவரைத் தொடர்பு கொள்ளுங்கள். "
            f"இந்த அவசர எச்சரிக்கை {time_str} மணிக்கு செயல்படுத்தப்பட்டது."
        )
    elif lang == "hi":
        return (
            f"SmartMed आपातकालीन चेतावनी। यह आपके पंजीकृत परिवार के सदस्य {name} के बारे में एक महत्वपूर्ण सूचना है। "
            f"मरीज ने SOS आपातकालीन बटन दबाया है और उन्हें तत्काल सहायता की आवश्यकता है। "
            f"कृपया तुरंत मरीज से संपर्क करें। यह आपातकाल {time_str} पर सक्रिय हुआ था।"
        )
    elif lang == "te":
        return (
            f"SmartMed అత్యవసర హెచ్చరిక. మీ కుటుంబ సభ్యులు {name} అత్యవసర సహాయం కోసం SOS బటన్‌ను నొక్కారు. "
            f"వారికి వెంటనే సహాయం కావాలి. దయచేసి వెంటనే వారిని సంప్రదించండి. "
            f"ఈ అత్యవసర హెచ్చరిక {time_str} వద్ద సక్రియం చేయబడింది."
        )
    elif lang == "kn":
        return (
            f"SmartMed ತುರ್ತು ಎಚ್ಚರಿಕೆ. ನಿಮ್ಮ ಕುಟುಂಬದ ಸದಸ್ಯ {name} ತುರ್ತು ನೆರವಿಗಾಗಿ SOS ಗುಂಡಿಯನ್ನು ಒತ್ತಿದ್ದಾರೆ. "
            f"ಅವರಿಗೆ ತಕ್ಷಣದ ನೆರವು ಬೇಕಾಗಿದೆ. ದಯವಿಟ್ಟು ತಕ್ಷಣ ಅವರನ್ನು ಸಂಪರ್ಕಿಸಿ. "
            f"ಈ ತುರ್ತು ಎಚ್ಚರಿಕೆ {time_str} ರಂದು ಸಕ್ರಿಯಗೊಳಿಸಲಾಗಿದೆ."
        )
    elif lang == "ml":
        return (
            f"SmartMed അടിയന്തര മുന്നറിയിപ്പ്. നിങ്ങളുടെ കുടുംബാംഗം {name} അടിയന്തര സഹായത്തിനായി SOS ബട്ടൺ അമർത്തിയിരിക്കുന്നു. "
            f"അദ്ദേഹത്തിന് അടിയന്തര സഹായം ആവശ്യമാണ്. ദയവായി ഉടൻ അദ്ദേഹവുമായി ബന്ധപ്പെടുക. "
            f"അടിയന്തരാവസ്ഥ {time_str}-ൽ സജീവമാക്കി."
        )
    elif lang == "bn":
        return (
            f"SmartMed জরুরি সতর্কতা। এটি আপনার পরিবারের সদস্য {name} সম্পর্কিত একটি গুরুত্বপূর্ণ বার্তা। "
            f"তিনি জরুরি সহায়তার জন্য SOS বোতাম সক্রিয় করেছেন এবং অবিলম্বে সাহায্যের প্রয়োজন। "
            f"অনুগ্রহ করে অবিলম্বে তার সাথে যোগাযোগ করুন। এই জরুরি সতর্কতাটি {time_str} সময়ে সক্রিয় হয়েছে।"
        )
    elif lang == "mr":
        return (
            f"SmartMed आणीबाणी इशारा. हे आपले कुटुंब सदस्य {name} यांच्याबद्दल एक तातडीचे वृत्त आहे. "
            f"त्यांनी आणीबाणी मदतीसाठी SOS बटण दाबले असून त्यांना त्वरित मदतीची आवश्यकता आहे. "
            f"कृपया तात्काळ त्यांच्याशी संपर्क साधा. ही आणीबाणी {time_str} वाजता सक्रिय झाली."
        )
    else:
        # Default English
        return (
            f"Emergency Alert from SmartMed. This is an urgent notification regarding your registered family member, {name}. "
            f"The patient has activated the SOS emergency button and requires immediate assistance. "
            f"Please contact the patient immediately. The emergency was activated at {time_str}."
        )


class CaregiverCallDispatcher:
    """
    Dispatches automated voice calls to registered caregivers via Twilio Voice API,
    synthesizes spoken emergency warnings with Kokoro TTS,
    and updates live status lifecycle.
    """

    def synthesize_call_audio(self, emergency_id: str, message_text: str, language: str = "en") -> Optional[bytes]:
        """Pre-synthesize humanoid Neural/Kokoro audio for Twilio <Play>."""
        try:
            audio_bytes, mime_type, engine_used = tts_manager.synthesize_neural_humanoid(
                text=message_text,
                voice="af_bella",
                speed=1.0,
                lang=language,
            )
            _sos_audio_cache[emergency_id] = audio_bytes
            logger.info(f"Synthesized humanoid emergency call audio for {emergency_id} using {engine_used} ({len(audio_bytes)} bytes)")
            return audio_bytes
        except Exception as e:
            logger.warning(f"Could not synthesize humanoid call audio for {emergency_id}: {e}")
            return None

    def get_cached_audio(self, emergency_id: str) -> Optional[bytes]:
        """Fetch pre-synthesized call audio bytes."""
        return _sos_audio_cache.get(emergency_id)

    def dispatch_caregiver_call(
        self,
        emergency_id: str,
        caregiver_phone: str,
        caregiver_name: str,
        patient_name: str,
        language: str = "en",
        activation_time: Optional[str] = None,
        retry_count: int = 0,
    ) -> Dict[str, Any]:
        """
        Initiates the caregiver phone call immediately.
        Runs asynchronously/independently of the patient voice alert.
        """
        lang = normalize_language_code(language)
        time_str = activation_time or datetime.now().strftime("%I:%M %p")
        message_text = generate_caregiver_call_message(
            patient_name=patient_name,
            language=lang,
            activation_time=time_str,
        )

        # Pre-synthesize Kokoro audio in background thread to not block call setup
        threading.Thread(
            target=self.synthesize_call_audio,
            args=(emergency_id, message_text, lang),
            daemon=True,
        ).start()

        # Update status to CALLING CAREGIVER
        emergency_tracker.update_status(
            new_status=EmergencyStatusEnum.CALLING_CAREGIVER,
            emergency_id=emergency_id,
            call_status="CALLING",
            note=f"Caregiver call initiated to {mask_phone_number(caregiver_phone)} (attempt {retry_count + 1})",
        )

        client = get_sos_twilio_client()
        from_phone = SOS_TWILIO_PHONE_NUMBER or TWILIO_PHONE_NUMBER
        formatted_phone = format_e164_phone(caregiver_phone)
        masked_phone = mask_phone_number(formatted_phone)

        # Twilio unavailable / Mock Telephony Mode
        if client is None or not from_phone:
            logger.warning(
                f"[Caregiver Call] Twilio not configured. Prepared native Android dialer fallback for {masked_phone}."
            )
            return {
                "success": True,
                "status": EmergencyStatusEnum.CALLING_CAREGIVER.value,
                "mock": True,
                "caregiver_phone": caregiver_phone,
                "masked_phone": masked_phone,
                "dialer_uri": f"tel:{caregiver_phone}",
                "retry_count": retry_count,
                "message": message_text,
            }

        try:
            webhook_url = (
                f"{BASE_WEBHOOK_URL}/api/emergency/sos/call/twiml"
                f"?emergency_id={quote(emergency_id)}&lang={quote(lang)}"
            )
            status_callback_url = (
                f"{BASE_WEBHOOK_URL}/api/emergency/sos/call/status"
                f"?emergency_id={quote(emergency_id)}"
            )

            logger.info(f"Initiating Twilio Caregiver Voice Call -> To: {masked_phone}, From: {from_phone} (SOS Twilio Account)")

            call = client.calls.create(
                to=formatted_phone,
                from_=from_phone,
                url=webhook_url,
                status_callback=status_callback_url,
                status_callback_event=["initiated", "ringing", "answered", "completed"],
            )

            logger.info(f"✓ Twilio Emergency Call Created! SID: {call.sid}, Status: {call.status}")

            emergency_tracker.update_status(
                new_status=EmergencyStatusEnum.CALLING_CAREGIVER,
                emergency_id=emergency_id,
                call_status=call.status or "CALLING",
                delivery_status={"call_sid": call.sid},
                note=f"Twilio Call SID: {call.sid}",
            )

            return {
                "success": True,
                "status": EmergencyStatusEnum.CALLING_CAREGIVER.value,
                "call_sid": call.sid,
                "caregiver_phone": caregiver_phone,
                "masked_phone": masked_phone,
                "dialer_uri": f"tel:{caregiver_phone}",
                "retry_count": retry_count,
                "message": message_text,
            }

        except Exception as e:
            logger.error(f"Failed to initiate Twilio caregiver call: {e}")
            # Mark call as failed, but immediately trigger alternate alert fallback!
            emergency_tracker.update_status(
                new_status=EmergencyStatusEnum.CALL_FAILED,
                emergency_id=emergency_id,
                call_status="FAILED",
                note=f"Call failed: {str(e)}",
            )
            # Dispatch alternate SMS fallback alert
            self.dispatch_fallback_alert(emergency_id, caregiver_phone, caregiver_name, patient_name, lang)

            return {
                "success": False,
                "status": EmergencyStatusEnum.CALL_FAILED.value,
                "error": str(e),
                "caregiver_phone": caregiver_phone,
                "masked_phone": masked_phone,
                "dialer_uri": f"tel:{caregiver_phone}",
                "retry_count": retry_count,
                "alternate_alert_sent": True,
            }

    def retry_call(self, emergency_id: str) -> Dict[str, Any]:
        """Retry a failed or unanswered caregiver emergency call."""
        event = emergency_tracker.get_active() or emergency_tracker.get_status(emergency_id).get("emergency")
        if not event:
            return {"success": False, "error": "Emergency event not found"}

        retry_count = event.get("retry_count", 0) + 1
        if retry_count > MAX_CALL_RETRIES:
            logger.warning(f"Maximum retry limit ({MAX_CALL_RETRIES}) reached for emergency {emergency_id}.")
            return {
                "success": False,
                "error": f"Max retry limit ({MAX_CALL_RETRIES}) reached",
                "max_retries_reached": True,
                "dialer_uri": f"tel:{event.get('caregiver', {}).get('phone', '112')}",
            }

        event["retry_count"] = retry_count
        cg = event.get("caregiver", {})
        return self.dispatch_caregiver_call(
            emergency_id=emergency_id,
            caregiver_phone=cg.get("phone", ""),
            caregiver_name=cg.get("name", "Caregiver"),
            patient_name=event.get("patient_name", "Patient"),
            language=event.get("language", "en"),
            activation_time=event.get("created_at"),
            retry_count=retry_count,
        )

    def handle_call_status_update(self, emergency_id: str, twilio_status: str) -> Dict[str, Any]:
        """
        Handles Twilio status webhook updates:
        'initiated' / 'ringing' -> CALLING CAREGIVER
        'in-progress' -> CAREGIVER CALL CONNECTED
        'completed' -> checks if acknowledged
        'failed' / 'busy' / 'no-answer' / 'canceled' -> CALL FAILED -> triggers ALTERNATE ALERT SENT
        """
        status_clean = twilio_status.lower().strip()
        logger.info(f"[Emergency Telephony Webhook] ID: {emergency_id}, Twilio Status: {status_clean}")

        event = emergency_tracker.get_status(emergency_id).get("emergency")
        current_status = event.get("status") if event else None

        if status_clean in ("initiated", "queued", "ringing"):
            emergency_tracker.update_status(
                new_status=EmergencyStatusEnum.CALLING_CAREGIVER,
                emergency_id=emergency_id,
                call_status="RINGING",
            )
            return {"status": EmergencyStatusEnum.CALLING_CAREGIVER.value}

        elif status_clean in ("in-progress", "answered"):
            # Caregiver answered the call!
            emergency_tracker.update_status(
                new_status=EmergencyStatusEnum.CAREGIVER_CALL_CONNECTED,
                emergency_id=emergency_id,
                call_status="CONNECTED",
                note="Caregiver answered emergency phone call.",
            )
            return {"status": EmergencyStatusEnum.CAREGIVER_CALL_CONNECTED.value}

        elif status_clean in ("failed", "busy", "no-answer", "canceled"):
            # Call was not answered or failed
            emergency_tracker.update_status(
                new_status=EmergencyStatusEnum.CALL_FAILED,
                emergency_id=emergency_id,
                call_status="UNANSWERED_OR_FAILED",
                note=f"Caregiver call ended with status: {status_clean}",
            )
            # Dispatch fallback notification
            if event:
                cg = event.get("caregiver", {})
                self.dispatch_fallback_alert(
                    emergency_id=emergency_id,
                    caregiver_phone=cg.get("phone", ""),
                    caregiver_name=cg.get("name", "Caregiver"),
                    patient_name=event.get("patient_name", "Patient"),
                    language=event.get("language", "en"),
                )
            return {"status": EmergencyStatusEnum.CALL_FAILED.value}

        elif status_clean == "completed":
            if current_status != EmergencyStatusEnum.CAREGIVER_ACKNOWLEDGED.value:
                # Connected and completed
                emergency_tracker.update_status(
                    new_status=EmergencyStatusEnum.CAREGIVER_CALL_CONNECTED,
                    emergency_id=emergency_id,
                    call_status="COMPLETED",
                )
            return {"status": current_status or "COMPLETED"}

        return {"status": current_status}

    def acknowledge_call(self, emergency_id: str, note: Optional[str] = None) -> Dict[str, Any]:
        """Called when the caregiver acknowledges the voice call (e.g. presses 1)."""
        emergency_tracker.update_status(
            new_status=EmergencyStatusEnum.CAREGIVER_ACKNOWLEDGED,
            emergency_id=emergency_id,
            call_status="ACKNOWLEDGED",
            note=note or "Caregiver acknowledged emergency call via telephony keypad.",
        )
        return {"success": True, "status": EmergencyStatusEnum.CAREGIVER_ACKNOWLEDGED.value}

    def dispatch_fallback_alert(
        self,
        emergency_id: str,
        caregiver_phone: str,
        caregiver_name: str,
        patient_name: str,
        language: str = "en",
    ):
        """Dispatches SMS/Push alternate alert when phone call is unanswered or fails."""
        try:
            logger.info(f"Triggering fallback alert notification for {caregiver_phone} due to call failure.")
            res = caregiver_alert_service.dispatch_alert(
                caregiver_name=caregiver_name,
                caregiver_phone=caregiver_phone,
                patient_name=patient_name,
                patient_phone="",
                language=language,
            )
            emergency_tracker.update_status(
                new_status=EmergencyStatusEnum.ALTERNATE_ALERT_SENT,
                emergency_id=emergency_id,
                delivery_status={"alternate_sms": res.get("sms_status")},
                note="Alternate alert dispatched after call failure/unanswered.",
            )
        except Exception as e:
            logger.warning(f"Failed to dispatch fallback alert: {e}")


caregiver_call_dispatcher = CaregiverCallDispatcher()
