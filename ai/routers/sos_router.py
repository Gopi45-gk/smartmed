"""
SmartMed API - SOS Emergency Assistance Router
Provides endpoints for SOS activation, automated caregiver phone calling via Twilio Voice,
interactive Kokoro voice reassurance, call status tracking, and emergency resolution.
"""

import logging
from typing import Optional, Dict, Any
from fastapi import APIRouter, HTTPException, Query, Request, Response
from pydantic import BaseModel, Field

from modules.emergency.sos_service import sos_service
from modules.emergency.emergency_status import EmergencyStatusEnum, emergency_tracker
from modules.emergency.caregiver_dispatcher import (
    caregiver_call_dispatcher,
    generate_caregiver_call_message,
)
from twilio_service import BASE_WEBHOOK_URL, get_locale_for_language, LANGUAGE_VOICE_CONFIG

logger = logging.getLogger("smartmed.ai.router.sos")

router = APIRouter(prefix="/api/emergency/sos", tags=["SOS Emergency System"])


# ─── Pydantic Request Models ─────────────────────────────────────────────────

class SOSActivateRequest(BaseModel):
    patient_name: str = Field(..., description="Registered patient full name")
    phone_number: str = Field(..., description="Patient registered telephone number")
    language: str = Field("en", description="Patient interface language code (e.g. en, ta, hi, te)")
    caregiver: Optional[Dict[str, Any]] = Field(default=None, description="Primary caregiver contact details")
    location: Optional[Dict[str, Any]] = Field(default=None, description="GPS coordinates if permitted")
    vital_info: Optional[Dict[str, Any]] = Field(default=None, description="Pertinent emergency vitals (blood group, condition)")


class SOSCancelRequest(BaseModel):
    emergency_id: Optional[str] = Field(default=None, description="ID of emergency event")
    reason: str = Field("Accidental activation", description="Reason for cancellation")


class SOSAcknowledgeRequest(BaseModel):
    emergency_id: Optional[str] = Field(default=None, description="ID of emergency event")
    caregiver_id: Optional[str] = Field(default=None, description="Caregiver identifier")
    note: Optional[str] = Field(default=None, description="Acknowledgment notes")


class SOSResolveRequest(BaseModel):
    emergency_id: Optional[str] = Field(default=None, description="ID of emergency event")
    notes: str = Field("Assistance arrived and patient is safe", description="Resolution notes")


class SOSDialogueRequest(BaseModel):
    emergency_id: str = Field(..., description="ID of active emergency event")
    patient_message: str = Field(..., description="Patient spoken or typed reply")
    language: str = Field("en", description="Spoken language code")


class SOSRetryCallRequest(BaseModel):
    emergency_id: str = Field(..., description="ID of active emergency event")


# ─── SOS Core Endpoints ───────────────────────────────────────────────────────

@router.post("/activate")
async def activate_sos(req: SOSActivateRequest):
    """
    Initiates emergency workflow:
    1. Confirms emergency state and records event.
    2. Dispatches automated caregiver phone call (Path A).
    3. Generates Kokoro/Indic voice reassurance for the patient (Path B).
    """
    try:
        result = sos_service.activate_emergency(
            patient_name=req.patient_name,
            phone_number=req.phone_number,
            language=req.language,
            caregiver=req.caregiver,
            location=req.location,
            vital_info=req.vital_info,
        )
        return result
    except Exception as e:
        logger.error(f"SOS activation error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"SOS activation failed: {str(e)}")


@router.post("/cancel")
async def cancel_sos(req: SOSCancelRequest):
    """
    Cancels an active or pending emergency (e.g., false alarm).
    """
    try:
        result = sos_service.cancel_emergency(
            emergency_id=req.emergency_id,
            reason=req.reason,
        )
        return {"success": True, "emergency": result}
    except Exception as e:
        logger.error(f"SOS cancellation error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/status")
async def get_sos_status(emergency_id: Optional[str] = Query(None, description="Optional target emergency ID")):
    """
    Retrieves current active emergency status, delivery breakdown, and call status.
    """
    try:
        status_info = sos_service.get_status(emergency_id=emergency_id)
        return status_info
    except Exception as e:
        logger.error(f"Error fetching SOS status: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/acknowledge")
async def acknowledge_sos(req: SOSAcknowledgeRequest):
    """
    Caregiver or responder confirms receipt of emergency notification.
    """
    try:
        result = sos_service.acknowledge_emergency(
            emergency_id=req.emergency_id,
            acknowledged_by=req.caregiver_id or "Caregiver",
            note=req.note,
        )
        return result
    except Exception as e:
        logger.error(f"Error acknowledging SOS: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/resolve")
async def resolve_sos(req: SOSResolveRequest):
    """
    Marks the emergency event as resolved after confirmed assistance.
    """
    try:
        result = sos_service.resolve_emergency(
            emergency_id=req.emergency_id,
            notes=req.notes,
        )
        return result
    except Exception as e:
        logger.error(f"Error resolving SOS: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/dialogue")
async def sos_dialogue(req: SOSDialogueRequest):
    """
    Processes an interactive voice conversation turn with an elderly patient during an active emergency.
    Returns symptom triage, 112 escalation advice if critical, and synthesized Kokoro voice audio.
    """
    try:
        result = sos_service.handle_dialogue_turn(
            emergency_id=req.emergency_id,
            patient_message=req.patient_message,
            language=req.language,
        )
        return result
    except Exception as e:
        logger.error(f"Error during emergency dialogue turn: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


# ─── Caregiver Telephony & Interactive Voice Call Endpoints ───────────────────

@router.post("/call/retry")
async def retry_caregiver_call(req: SOSRetryCallRequest):
    """
    Retries an automated caregiver emergency phone call if previous attempt failed or was unanswered.
    """
    try:
        res = sos_service.retry_call(emergency_id=req.emergency_id)
        return res
    except Exception as e:
        logger.error(f"Error retrying caregiver call: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/call/twiml")
@router.post("/call/twiml")
async def get_emergency_twiml_endpoint(
    emergency_id: str = Query(..., description="Target emergency ID"),
    lang: str = Query("en", description="Selected language"),
):
    """
    Twilio Voice TwiML webhook for the automated caregiver call.
    - Plays pre-synthesized Kokoro/Piper neural voice audio.
    - Prompts caregiver to acknowledge by pressing 1.
    - Repeats the alert if unacknowledged.
    """
    event = emergency_tracker.get_status(emergency_id).get("emergency")
    patient_name = event.get("patient_name", "your family member") if event else "your family member"
    activation_time = event.get("created_at") if event else None

    # Construct multilingual spoken message
    alert_text = generate_caregiver_call_message(
        patient_name=patient_name,
        language=lang,
        activation_time=activation_time,
    )

    clean_lang = (lang or "en").lower().split("-")[0].strip()
    voice_cfg = LANGUAGE_VOICE_CONFIG.get(clean_lang, LANGUAGE_VOICE_CONFIG["en"])
    polly_voice = voice_cfg.get("voice", "Polly.Aditi")
    polly_locale = get_locale_for_language(clean_lang)

    audio_url = f"{BASE_WEBHOOK_URL}/api/emergency/sos/call/audio?emergency_id={emergency_id}"
    ack_url = f"{BASE_WEBHOOK_URL}/api/emergency/sos/call/ack?emergency_id={emergency_id}"

    twiml_xml = f"""<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather numDigits="1" action="{ack_url}" method="POST" timeout="6">
    <Play>{audio_url}</Play>
    <Pause length="1"/>
    <Say voice="{polly_voice}" language="{polly_locale}">{alert_text}</Say>
    <Pause length="1"/>
    <Say voice="{polly_voice}" language="{polly_locale}">Press 1 to acknowledge this emergency alert.</Say>
  </Gather>
  <!-- Repeat alert once if unacknowledged -->
  <Gather numDigits="1" action="{ack_url}" method="POST" timeout="6">
    <Say voice="{polly_voice}" language="{polly_locale}">Repeating alert. {alert_text}</Say>
    <Pause length="1"/>
    <Say voice="{polly_voice}" language="{polly_locale}">Press 1 to acknowledge this emergency alert.</Say>
  </Gather>
  <Say voice="{polly_voice}" language="{polly_locale}">Alert call finished. Please check your text messages and attend to the patient immediately.</Say>
  <Hangup/>
</Response>"""

    return Response(content=twiml_xml, media_type="application/xml")


@router.get("/call/audio")
async def get_emergency_audio(emergency_id: str = Query(...)):
    """
    Serves pre-synthesized Kokoro/Piper WAV audio for Twilio <Play>.
    """
    wav_bytes = caregiver_call_dispatcher.get_cached_audio(emergency_id)
    if not wav_bytes:
        # Fallback synthesis if cache miss
        event = emergency_tracker.get_status(emergency_id).get("emergency")
        patient_name = event.get("patient_name", "Patient") if event else "Patient"
        lang = event.get("language", "en") if event else "en"
        msg = generate_caregiver_call_message(patient_name, language=lang)
        wav_bytes = caregiver_call_dispatcher.synthesize_call_audio(emergency_id, msg, language=lang)

    if wav_bytes:
        return Response(content=wav_bytes, media_type="audio/wav")
    raise HTTPException(status_code=404, detail="Audio not found")


@router.post("/call/ack")
@router.get("/call/ack")
async def handle_caregiver_call_ack(
    request: Request,
    emergency_id: str = Query(...),
):
    """
    Twilio callback when caregiver presses 1 or interacts during emergency voice call.
    Transitions status to CAREGIVER ACKNOWLEDGED.
    """
    form_data = {}
    if request.method == "POST":
        try:
            form_data = await request.form()
        except Exception:
            form_data = {}

    digits = form_data.get("Digits", request.query_params.get("Digits", "1"))
    logger.info(f"Caregiver acknowledged call for emergency {emergency_id} with input: {digits}")

    caregiver_call_dispatcher.acknowledge_call(
        emergency_id=emergency_id,
        note=f"Caregiver acknowledged alert via phone keypad input: {digits}",
    )

    ack_twiml = """<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Thank you. Your acknowledgment has been recorded. Please contact the patient immediately.</Say>
  <Hangup/>
</Response>"""
    return Response(content=ack_twiml, media_type="application/xml")


@router.post("/call/status")
@router.get("/call/status")
async def handle_call_status_callback(
    request: Request,
    emergency_id: str = Query(...),
):
    """
    Twilio status callback webhook for emergency call progression:
    initiated/ringing -> CALLING CAREGIVER
    in-progress -> CAREGIVER CALL CONNECTED
    completed -> completed
    failed/busy/no-answer -> CALL FAILED -> triggers ALTERNATE ALERT SENT
    """
    form_data = {}
    if request.method == "POST":
        try:
            form_data = await request.form()
        except Exception:
            form_data = {}

    call_status = str(
        form_data.get("CallStatus") or request.query_params.get("CallStatus", "unknown")
    )
    result = caregiver_call_dispatcher.handle_call_status_update(
        emergency_id=emergency_id,
        twilio_status=call_status,
    )
    return {"status": "ok", "result": result}
