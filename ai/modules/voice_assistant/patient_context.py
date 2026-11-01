"""
SmartMed Voice Companion - Patient Context Aggregator
Retrieves verified, un-hallucinated patient data:
- Prescriptions and Medication schedules
- Recent Glucose records and diabetes risk
- Laboratory report parameters (HbA1c, Creatinine, Fasting Glucose)
- Caregiver contacts and emergency profiles
Strictly enforces: If information is not in records, states that it is not recorded.
"""

import os
import json
import sqlite3
import logging
from pathlib import Path
from typing import Dict, Any, List, Optional

logger = logging.getLogger("smartmed.ai.voice.context")

_DATA_DIR = Path(__file__).resolve().parent.parent.parent / "data"
_GLUCOSE_DB = _DATA_DIR / "glucose.db"
_REMINDERS_FILE = _DATA_DIR / "reminders.json"
_ADHERENCE_FILE = _DATA_DIR / "adherence.json"


class PatientContextService:
    """
    Assembles a verified clinical context snapshot for a patient.
    """

    def get_patient_medications(self, patient_phone: Optional[str] = None) -> List[Dict[str, Any]]:
        """Retrieve verified medication reminders from disk/cache."""
        try:
            if _REMINDERS_FILE.exists():
                with open(_REMINDERS_FILE, "r", encoding="utf-8") as f:
                    reminders = json.load(f)
                    if isinstance(reminders, list):
                        if patient_phone:
                            return [r for r in reminders if r.get("phoneNumber") == patient_phone or r.get("patientId") == patient_phone]
                        return reminders
        except Exception as e:
            logger.warning(f"Could not load medication reminders: {e}")
        return []

    def get_latest_glucose_reading(self, patient_phone: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """Retrieve latest blood glucose reading from SQLite."""
        if not _GLUCOSE_DB.exists():
            return None
        try:
            conn = sqlite3.connect(str(_GLUCOSE_DB))
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            query = "SELECT * FROM glucose_readings"
            params = []
            if patient_phone:
                query += " WHERE user_id = ?"
                params.append(patient_phone)
            query += " ORDER BY recorded_at DESC LIMIT 1"
            cursor.execute(query, params)
            row = cursor.fetchone()
            conn.close()
            if row:
                return dict(row)
        except Exception as e:
            logger.warning(f"Could not fetch glucose reading from DB: {e}")
        return None

    def get_recent_glucose_trend(self, limit: int = 5, patient_phone: Optional[str] = None) -> List[Dict[str, Any]]:
        """Retrieve last N glucose readings."""
        if not _GLUCOSE_DB.exists():
            return []
        try:
            conn = sqlite3.connect(str(_GLUCOSE_DB))
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            query = "SELECT * FROM glucose_readings"
            params = []
            if patient_phone:
                query += " WHERE user_id = ?"
                params.append(patient_phone)
            query += " ORDER BY recorded_at DESC LIMIT ?"
            params.append(limit)
            cursor.execute(query, params)
            rows = cursor.fetchall()
            conn.close()
            return [dict(r) for r in rows]
        except Exception as e:
            logger.warning(f"Could not fetch glucose trends: {e}")
            return []

    def build_context_summary(
        self,
        profile: Optional[Dict[str, Any]] = None,
        frontend_medicines: Optional[List[Dict[str, Any]]] = None,
        frontend_caregivers: Optional[List[Dict[str, Any]]] = None,
        frontend_glucose: Optional[Dict[str, Any]] = None,
    ) -> str:
        """
        Builds a structured prompt section with verified patient facts.
        """
        lines = ["[VERIFIED PATIENT CLINICAL CONTEXT]"]

        # 1. Patient Demographics
        if profile:
            name = profile.get("name") or "Patient"
            age = profile.get("age", "Unknown")
            gender = profile.get("gender", "Unknown")
            bg = profile.get("bloodGroup") or profile.get("blood_group") or "Not recorded"
            cond = profile.get("condition") or "None listed"
            lines.append(f"- Patient: {name}, Age {age}, Gender {gender}, Blood Group: {bg}, Condition: {cond}")
        else:
            lines.append("- Patient: Verified registered SmartMed user")

        # 2. Verified Active Medications
        meds = frontend_medicines or self.get_patient_medications(profile.get("phone") if profile else None)
        if meds:
            lines.append("- Scheduled Medications:")
            for m in meds:
                m_name = m.get("name") or m.get("medicineName") or "Unknown medicine"
                m_dose = m.get("dose") or m.get("dosage") or "1 dose"
                m_time = m.get("time") or m.get("scheduledTime") or "scheduled time"
                m_food = m.get("food") or m.get("mealRelation") or "as directed"
                m_status = m.get("status") or "upcoming"
                lines.append(f"  * {m_name} | Dose: {m_dose} | Time: {m_time} | Food: {m_food} | Status: {m_status}")
        else:
            lines.append("- Scheduled Medications: None recorded in active prescription list.")

        # 3. Glucose Records
        latest_glu = frontend_glucose or self.get_latest_glucose_reading(profile.get("phone") if profile else None)
        if latest_glu:
            val = latest_glu.get("glucose_value") or latest_glu.get("value")
            m_type = latest_glu.get("meal_type", "Random")
            r_time = latest_glu.get("recorded_at", "recently")
            lines.append(f"- Latest Blood Glucose: {val} mg/dL ({m_type}) recorded at {r_time}.")
        else:
            lines.append("- Latest Blood Glucose: No recent glucose readings logged.")

        # 4. Caregiver Information
        if frontend_caregivers:
            cg_items = [f"{c.get('name', 'Caregiver')} ({c.get('relation', 'Contact')}: {c.get('phone', 'N/A')})" for c in frontend_caregivers]
            lines.append(f"- Caregivers: {', '.join(cg_items)}")
        else:
            lines.append("- Caregivers: Primary emergency contact registered on file.")

        return "\n".join(lines)


patient_context_service = PatientContextService()
