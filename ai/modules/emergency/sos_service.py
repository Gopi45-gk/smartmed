"""
SmartMed Emergency Assistance System - SOS Service Orchestrator
Coordinates SOS emergency activation, automatic caregiver phone call dispatch,
Kokoro TTS voice reassurance, call initiation tracking, retry management, and resolution.
Both Caregiver Calling (Path A) and Patient Voice Alert (Path B) execute independently and simultaneously.
"""

import logging
import threading
from typing import Dict, Any, Optional

from .emergency_status import emergency_tracker, EmergencyStatusEnum
from .caregiver_alert import caregiver_alert_service
from .caregiver_dispatcher import caregiver_call_dispatcher
from .emergency_voice import emergency_voice_service

logger = logging.getLogger("smartmed.ai.emergency.service")


class SOSService:
    """
    High-level orchestrator for SOS emergency procedures.
    """

    def activate_emergency(
        self,
        patient_name: str,
        phone_number: str,
        language: str = "en",
        caregiver: Optional[Dict[str, Any]] = None,
        location: Optional[Dict[str, Any]] = None,
        vital_info: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        Activates the emergency workflow:
        1. Records state in emergency tracker (SOS ACTIVATED).
        2. PATH A: Dispatches automated caregiver phone call (independent non-blocking execution).
        3. PATH B: Generates Kokoro TTS voice alert directly for the patient.
        4. Returns unified emergency status & action items without waiting for call completion.
        """
        # 1. Record event
        event = emergency_tracker.create_emergency(
            patient_name=patient_name,
            phone_number=phone_number,
            language=language,
            caregiver=caregiver,
            location=location,
            vital_info=vital_info,
        )
        emergency_id = event["id"]

        caregiver_name = caregiver.get("name", "Primary Caregiver") if caregiver else "Primary Caregiver"
        caregiver_phone = caregiver.get("phone", "") if caregiver else ""

        # 2. PATH A: Asynchronously dispatch automated Caregiver Phone Call (and SMS notification)
        # Does NOT block patient voice alert generation!
        def _dispatch_caregiver_call_async():
            try:
                # 2a. Initiate Twilio Voice Call
                caregiver_call_dispatcher.dispatch_caregiver_call(
                    emergency_id=emergency_id,
                    caregiver_phone=caregiver_phone,
                    caregiver_name=caregiver_name,
                    patient_name=patient_name,
                    language=language,
                    activation_time=event.get("created_at"),
                )
                # 2b. Also dispatch complementary SMS alert notification
                caregiver_alert_service.dispatch_alert(
                    caregiver_name=caregiver_name,
                    caregiver_phone=caregiver_phone,
                    patient_name=patient_name,
                    patient_phone=phone_number,
                    language=language,
                    location=location,
                    vital_info=vital_info,
                )
            except Exception as e:
                logger.error(f"Error in asynchronous caregiver call dispatch: {e}")

        call_thread = threading.Thread(target=_dispatch_caregiver_call_async, daemon=True)
        call_thread.start()

        # 3. PATH B: Generate Kokoro TTS voice alert directly for the patient
        voice_result = emergency_voice_service.synthesize_reassurance_prompt(language=language)

        return {
            "success": True,
            "emergency_id": emergency_id,
            "status": EmergencyStatusEnum.SOS_ACTIVATED.value,
            "patient_name": patient_name,
            "caregiver_name": caregiver_name,
            "caregiver_phone": caregiver_phone,
            "call_status": "CALLING CAREGIVER",
            "voice_prompt": voice_result,
            "call_action": {
                "tel_uri": f"tel:{caregiver_phone}" if caregiver_phone else "tel:112",
                "can_direct_dial": True,
                "fallback_number": "112",
            },
            "timestamp": event["created_at"],
            "status_message": "Calling your caregiver...",
        }

    def retry_call(self, emergency_id: str) -> Dict[str, Any]:
        """Retries a failed caregiver emergency call."""
        return caregiver_call_dispatcher.retry_call(emergency_id=emergency_id)

    def handle_dialogue_turn(
        self,
        emergency_id: str,
        patient_message: str,
        language: str = "en",
    ) -> Dict[str, Any]:
        """
        Processes an interactive voice conversation turn during an active emergency.
        """
        result = emergency_voice_service.process_emergency_speech(
            patient_message=patient_message,
            language=language,
        )

        emergency_tracker.append_conversation(
            user_message=patient_message,
            ai_response=result["ai_response_text"],
            emergency_id=emergency_id,
            risk_level=result["risk_level"],
        )

        return result

    def cancel_emergency(self, emergency_id: Optional[str] = None, reason: str = "User cancelled") -> Dict[str, Any]:
        """Cancels an active emergency."""
        return emergency_tracker.cancel_emergency(emergency_id=emergency_id, reason=reason)

    def acknowledge_emergency(
        self,
        emergency_id: Optional[str] = None,
        acknowledged_by: str = "Caregiver",
        note: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Marks emergency as acknowledged by caregiver or responder."""
        updated = emergency_tracker.update_status(
            new_status=EmergencyStatusEnum.CAREGIVER_ACKNOWLEDGED,
            emergency_id=emergency_id,
            note=f"Acknowledged by {acknowledged_by}: {note or 'Help is on the way.'}",
        )
        return {
            "success": True,
            "status": EmergencyStatusEnum.CAREGIVER_ACKNOWLEDGED.value,
            "emergency": updated,
        }

    def resolve_emergency(
        self,
        emergency_id: Optional[str] = None,
        notes: str = "Patient assistance completed safely.",
    ) -> Dict[str, Any]:
        """Marks emergency as fully resolved."""
        updated = emergency_tracker.resolve_emergency(emergency_id=emergency_id, resolution_notes=notes)
        return {
            "success": True,
            "status": EmergencyStatusEnum.EMERGENCY_RESOLVED.value,
            "emergency": updated,
        }

    def get_status(self, emergency_id: Optional[str] = None) -> Dict[str, Any]:
        """Returns current status."""
        return emergency_tracker.get_status(emergency_id=emergency_id)


sos_service = SOSService()
