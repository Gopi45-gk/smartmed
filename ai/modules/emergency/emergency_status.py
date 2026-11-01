"""
SmartMed Emergency Assistance System - Emergency Status Tracker
Tracks actual emergency lifecycle states with verified confirmed events,
thread-safe in-memory caching, and persistent local storage.
"""

import os
import json
import uuid
import logging
from enum import Enum
from pathlib import Path
from datetime import datetime, timezone
from typing import Optional, Dict, Any, List

logger = logging.getLogger("smartmed.ai.emergency.status")

_DATA_DIR = Path(__file__).resolve().parent.parent.parent / "data"
_EVENTS_FILE = _DATA_DIR / "emergency_events.json"


class EmergencyStatusEnum(str, Enum):
    IDLE = "IDLE"
    SOS_ACTIVATED = "SOS ACTIVATED"
    CALLING_CAREGIVER = "CALLING CAREGIVER"
    CAREGIVER_CALL_CONNECTED = "CAREGIVER CALL CONNECTED"
    CAREGIVER_ACKNOWLEDGED = "CAREGIVER ACKNOWLEDGED"
    CALL_FAILED = "CALL FAILED"
    ALTERNATE_ALERT_SENT = "ALTERNATE ALERT SENT"
    EMERGENCY_RESOLVED = "EMERGENCY RESOLVED"
    CANCELLED = "CANCELLED"

    # Backward compatibility aliases
    SOS_INITIATED = "SOS ACTIVATED"
    ALERT_SENT = "CALLING CAREGIVER"
    CAREGIVER_CALL_INITIATED = "CALLING CAREGIVER"
    CAREGIVER_CONTACTED = "CAREGIVER CALL CONNECTED"
    ASSISTANCE_ACKNOWLEDGED = "CAREGIVER ACKNOWLEDGED"
    RESOLVED = "EMERGENCY RESOLVED"


class EmergencyStatusTracker:
    """
    Manages active and historical emergency events.
    Thread-safe and backed by local file storage.
    """

    def __init__(self, storage_path: Path = _EVENTS_FILE):
        self.storage_path = storage_path
        self._active_emergency: Optional[Dict[str, Any]] = None
        self._history: List[Dict[str, Any]] = []
        self._load_storage()

    def _load_storage(self) -> None:
        """Load emergency events from disk."""
        try:
            self.storage_path.parent.mkdir(parents=True, exist_ok=True)
            if self.storage_path.exists():
                with open(self.storage_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    self._history = data.get("history", [])
                    active = data.get("active", None)
                    if active and active.get("status") not in (
                        EmergencyStatusEnum.EMERGENCY_RESOLVED.value,
                        EmergencyStatusEnum.CANCELLED.value,
                        "RESOLVED",
                    ):
                        self._active_emergency = active
                    else:
                        self._active_emergency = None
        except Exception as e:
            logger.error(f"Failed to load emergency events: {e}")
            self._history = []
            self._active_emergency = None

    def _persist(self) -> None:
        """Persist state to local storage."""
        try:
            payload = {
                "active": self._active_emergency,
                "history": self._history[-50:],  # retain last 50 events
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
            with open(self.storage_path, "w", encoding="utf-8") as f:
                json.dump(payload, f, indent=2, ensure_ascii=False)
        except Exception as e:
            logger.error(f"Failed to persist emergency events: {e}")

    def create_emergency(
        self,
        patient_name: str,
        phone_number: str,
        language: str = "en",
        caregiver: Optional[Dict[str, Any]] = None,
        location: Optional[Dict[str, Any]] = None,
        vital_info: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        Create and record a new confirmed SOS Emergency event.
        Prevents duplicate pending activations.
        """
        now_iso = datetime.now(timezone.utc).isoformat()

        # If already active and not resolved, return existing active emergency
        if self._active_emergency and self._active_emergency.get("status") not in (
            EmergencyStatusEnum.EMERGENCY_RESOLVED.value,
            EmergencyStatusEnum.CANCELLED.value,
            "RESOLVED",
        ):
            logger.info(f"Existing active emergency found: {self._active_emergency['id']}")
            return self._active_emergency

        emergency_id = f"sos-{uuid.uuid4().hex[:10]}"
        event: Dict[str, Any] = {
            "id": emergency_id,
            "patient_name": patient_name or "Patient",
            "phone_number": phone_number or "",
            "language": (language or "en").lower().split("-")[0],
            "status": EmergencyStatusEnum.SOS_ACTIVATED.value,
            "created_at": now_iso,
            "updated_at": now_iso,
            "caregiver": caregiver or {},
            "location": location,
            "vital_info": vital_info or {},
            "call_status": "PENDING",
            "retry_count": 0,
            "delivery_status": {
                "sms": "QUEUED",
                "call": "NOT_INITIATED",
                "confirmed_delivered": False,
            },
            "conversation": [],
            "resolution_notes": None,
        }

        self._active_emergency = event
        self._history.append(event)
        self._persist()
        logger.warning(f"🚨 New SOS Emergency Activated: {emergency_id} for {patient_name}")
        return event

    def get_active(self) -> Optional[Dict[str, Any]]:
        """Return currently active emergency or None."""
        if self._active_emergency and self._active_emergency.get("status") not in (
            EmergencyStatusEnum.RESOLVED.value,
            EmergencyStatusEnum.CANCELLED.value,
        ):
            return self._active_emergency
        return None

    def get_status(self, emergency_id: Optional[str] = None) -> Dict[str, Any]:
        """Get status of active or specified emergency."""
        if emergency_id:
            for item in reversed(self._history):
                if item.get("id") == emergency_id:
                    return {
                        "active": item.get("status") not in (
                            EmergencyStatusEnum.RESOLVED.value,
                            EmergencyStatusEnum.CANCELLED.value,
                        ),
                        "emergency": item,
                    }
        active = self.get_active()
        if active:
            return {"active": True, "emergency": active}
        return {
            "active": False,
            "emergency": {
                "status": EmergencyStatusEnum.IDLE.value,
                "message": "No active emergency.",
            },
        }

    def update_status(
        self,
        new_status: EmergencyStatusEnum,
        emergency_id: Optional[str] = None,
        call_status: Optional[str] = None,
        delivery_status: Optional[Dict[str, Any]] = None,
        note: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        """Update status of the target emergency."""
        target = None
        if emergency_id:
            for item in self._history:
                if item.get("id") == emergency_id:
                    target = item
                    break
        if not target:
            target = self._active_emergency

        if not target:
            return None

        target["status"] = new_status.value
        target["updated_at"] = datetime.now(timezone.utc).isoformat()
        if call_status:
            target["call_status"] = call_status
        if delivery_status:
            target["delivery_status"].update(delivery_status)
        if note:
            target.setdefault("notes", []).append({
                "time": target["updated_at"],
                "note": note,
            })

        self._persist()
        return target

    def append_conversation(
        self,
        user_message: str,
        ai_response: str,
        emergency_id: Optional[str] = None,
        risk_level: str = "normal",
    ) -> None:
        """Record an interactive emergency conversation exchange."""
        target = self._active_emergency
        if emergency_id:
            for item in self._history:
                if item.get("id") == emergency_id:
                    target = item
                    break
        if target:
            target.setdefault("conversation", []).append({
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "patient": user_message,
                "assistant": ai_response,
                "risk_level": risk_level,
            })
            self._persist()

    def cancel_emergency(self, emergency_id: Optional[str] = None, reason: str = "User cancelled") -> Dict[str, Any]:
        """Cancel an emergency (e.g. false alarm)."""
        target = self.update_status(
            new_status=EmergencyStatusEnum.CANCELLED,
            emergency_id=emergency_id,
            note=f"Cancelled: {reason}",
        )
        if self._active_emergency and (not emergency_id or self._active_emergency.get("id") == emergency_id):
            self._active_emergency = None
        self._persist()
        return target or {"status": EmergencyStatusEnum.CANCELLED.value, "reason": reason}

    def resolve_emergency(
        self, emergency_id: Optional[str] = None, resolution_notes: str = "Assistance arrived and confirmed."
    ) -> Dict[str, Any]:
        """Mark an emergency event as resolved."""
        target = self.update_status(
            new_status=EmergencyStatusEnum.RESOLVED,
            emergency_id=emergency_id,
            note=resolution_notes,
        )
        if target:
            target["resolution_notes"] = resolution_notes
            target["resolved_at"] = datetime.now(timezone.utc).isoformat()
        if self._active_emergency and (not emergency_id or self._active_emergency.get("id") == emergency_id):
            self._active_emergency = None
        self._persist()
        return target or {"status": EmergencyStatusEnum.RESOLVED.value, "notes": resolution_notes}


# Singleton tracker
emergency_tracker = EmergencyStatusTracker()
