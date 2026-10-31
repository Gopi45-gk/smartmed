"""
SmartMed Clinical Intelligence: Glucose Tracking & Trend Router
Provides offline-first idempotent REST APIs for logging blood sugar,
querying historical logs, computing trend alerts, and tracking correlation with adherence.
Uses standard library sqlite3 with parameterized queries and patient-level isolation.
"""

import os
import sqlite3
import json
import logging
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from glucose_alerts import (
    evaluate_glucose_reading,
    correlate_glucose_with_adherence,
    DEFAULT_THRESHOLDS,
    parse_iso_datetime,
)

logger = logging.getLogger("smartmed.glucose")
router = APIRouter(prefix="/api/glucose", tags=["glucose-monitoring"])

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(CURRENT_DIR, "data")
DB_PATH = os.path.join(DATA_DIR, "glucose.db")
CONFIRMATIONS_FILE = os.path.join(DATA_DIR, "confirmations.json")


# ─── SQLite Database Initialization ──────────────────────────────────────────
def get_db_connection() -> sqlite3.Connection:
    """Creates a connection to the SQLite database with row factory enabled."""
    os.makedirs(DATA_DIR, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    """Initializes tables and indexes for glucose readings, alerts, and thresholds."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS glucose_readings (
                id TEXT PRIMARY KEY,
                patient_id TEXT NOT NULL,
                value_mgdl REAL NOT NULL,
                unit_entered TEXT NOT NULL,
                context TEXT NOT NULL,
                measured_at TEXT NOT NULL,
                source TEXT NOT NULL,
                created_at TEXT NOT NULL,
                synced_at TEXT NOT NULL
            );
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_glucose_patient_time ON glucose_readings(patient_id, measured_at);")

        cursor.execute("""
            CREATE TABLE IF NOT EXISTS glucose_alerts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                patient_id TEXT NOT NULL,
                rule TEXT NOT NULL,
                severity TEXT NOT NULL,
                title TEXT NOT NULL,
                message TEXT NOT NULL,
                value REAL,
                measured_at TEXT NOT NULL,
                created_at TEXT NOT NULL,
                action_needed INTEGER DEFAULT 0
            );
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_alerts_patient ON glucose_alerts(patient_id, created_at);")

        cursor.execute("""
            CREATE TABLE IF NOT EXISTS patient_thresholds (
                patient_id TEXT PRIMARY KEY,
                thresholds_json TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
        """)
        conn.commit()


# Run table initialization at module import
init_db()


# ─── Pydantic Schemas ────────────────────────────────────────────────────────
class GlucoseEntryRequest(BaseModel):
    id: str = Field(..., description="Client-generated unique UUID for idempotency")
    patientId: str = Field("default", description="Patient identifier")
    value_mgdl: float = Field(..., ge=20.0, le=800.0, description="Glucose level in mg/dL (20-800)")
    unit_entered: str = Field("mg/dL", description="'mg/dL' or 'mmol/L'")
    context: str = Field("random", description="'fasting', 'before_meal', 'after_meal', 'bedtime', 'random'")
    measuredAt: str = Field(..., description="ISO 8601 measurement timestamp")
    source: str = Field("manual", description="'manual', 'voice', or 'lab_scan'")


class ThresholdsUpdateRequest(BaseModel):
    critical_low: Optional[float] = Field(None, ge=40.0, le=90.0)
    critical_high: Optional[float] = Field(None, ge=180.0, le=450.0)
    fasting_target_max: Optional[float] = Field(None, ge=90.0, le=180.0)
    general_target_max: Optional[float] = Field(None, ge=120.0, le=240.0)


# ─── Helper Functions ─────────────────────────────────────────────────────────
def row_to_dict(row: sqlite3.Row) -> Dict[str, Any]:
    return {
        "id": row["id"],
        "patientId": row["patient_id"],
        "value_mgdl": row["value_mgdl"],
        "unit_entered": row["unit_entered"],
        "context": row["context"],
        "measuredAt": row["measured_at"],
        "source": row["source"],
        "createdAt": row["created_at"],
        "syncedAt": row["synced_at"],
    }


def get_patient_thresholds(patient_id: str) -> Dict[str, Any]:
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT thresholds_json FROM patient_thresholds WHERE patient_id = ?", (patient_id,))
        row = cursor.fetchone()
        if row and row["thresholds_json"]:
            try:
                custom = json.loads(row["thresholds_json"])
                merged = DEFAULT_THRESHOLDS.copy()
                merged.update(custom)
                return merged
            except Exception:
                pass
    return DEFAULT_THRESHOLDS.copy()


def load_recent_alerts(patient_id: str, limit: int = 50) -> List[Dict[str, Any]]:
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT id, patient_id, rule, severity, title, message, value, measured_at, created_at, action_needed
            FROM glucose_alerts
            WHERE patient_id = ?
            ORDER BY created_at DESC LIMIT ?
        """, (patient_id, limit))
        rows = cursor.fetchall()
        return [
            {
                "id": str(r["id"]),
                "patientId": r["patient_id"],
                "rule": r["rule"],
                "severity": r["severity"],
                "title": r["title"],
                "message": r["message"],
                "value": r["value"],
                "measuredAt": r["measured_at"],
                "createdAt": r["created_at"],
                "actionNeeded": bool(r["action_needed"]),
            }
            for r in rows
        ]


# ─── Endpoints ────────────────────────────────────────────────────────────────

@router.post("")
async def create_or_sync_reading(entry: GlucoseEntryRequest):
    """
    Idempotent logging endpoint.
    Accepts client-generated UUID, saves reading to SQLite, evaluates alerts,
    and returns saved reading along with any active alerts.
    """
    # Timestamp validation: not in far future
    dt = parse_iso_datetime(entry.measuredAt)
    if not dt:
        raise HTTPException(status_code=400, detail="Invalid ISO timestamp format for measuredAt.")
    if dt > datetime.utcnow() + timedelta(hours=24):
        raise HTTPException(status_code=400, detail="Measurement timestamp cannot be in the future.")

    now_iso = datetime.utcnow().isoformat()

    # Save to SQLite (Idempotent: INSERT OR REPLACE)
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT OR REPLACE INTO glucose_readings (
                id, patient_id, value_mgdl, unit_entered, context, measured_at, source, created_at, synced_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            entry.id,
            entry.patientId,
            entry.value_mgdl,
            entry.unit_entered,
            entry.context,
            entry.measuredAt,
            entry.source,
            now_iso,
            now_iso,
        ))
        conn.commit()

        # Fetch recent readings for this patient to evaluate alert rules
        cursor.execute("""
            SELECT id, patient_id, value_mgdl, unit_entered, context, measured_at, source, created_at, synced_at
            FROM glucose_readings
            WHERE patient_id = ?
            ORDER BY measured_at DESC LIMIT 30
        """, (entry.patientId,))
        recent_rows = cursor.fetchall()
        recent_readings = [row_to_dict(r) for r in recent_rows]

    # Evaluate alerts
    thresholds = get_patient_thresholds(entry.patientId)
    past_alerts = load_recent_alerts(entry.patientId, limit=20)
    current_dict = {
        "id": entry.id,
        "patientId": entry.patientId,
        "value_mgdl": entry.value_mgdl,
        "context": entry.context,
        "measuredAt": entry.measuredAt,
    }
    new_alerts = evaluate_glucose_reading(
        current_dict,
        recent_readings,
        thresholds=thresholds,
        existing_alerts=past_alerts
    )

    # Persist newly generated alerts
    if new_alerts:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            for al in new_alerts:
                cursor.execute("""
                    INSERT INTO glucose_alerts (
                        patient_id, rule, severity, title, message, value, measured_at, created_at, action_needed
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    al["patientId"],
                    al["rule"],
                    al["severity"],
                    al["title"],
                    al["message"],
                    al["value"],
                    al["measuredAt"],
                    al["createdAt"],
                    1 if al.get("actionNeeded") else 0
                ))
            conn.commit()

    return {
        "success": True,
        "reading": {
            "id": entry.id,
            "patientId": entry.patientId,
            "value_mgdl": entry.value_mgdl,
            "unit_entered": entry.unit_entered,
            "context": entry.context,
            "measuredAt": entry.measuredAt,
            "source": entry.source,
            "syncedAt": now_iso,
        },
        "alerts": new_alerts,
        "disclaimer": "SmartMed glucose logging is for tracking and screening purposes only. Please consult your physician for clinical diagnosis and medical advice."
    }


@router.get("")
async def list_glucose_readings(
    patientId: str = Query("default"),
    from_date: Optional[str] = Query(None, alias="from"),
    to_date: Optional[str] = Query(None, alias="to"),
    limit: int = Query(100, le=500)
):
    """Retrieves patient glucose readings within an optional date range."""
    query = "SELECT * FROM glucose_readings WHERE patient_id = ?"
    params: List[Any] = [patientId]

    if from_date:
        query += " AND measured_at >= ?"
        params.append(from_date)
    if to_date:
        query += " AND measured_at <= ?"
        params.append(to_date)

    query += " ORDER BY measured_at DESC LIMIT ?"
    params.append(limit)

    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(query, tuple(params))
        rows = cursor.fetchall()
        readings = [row_to_dict(r) for r in rows]

    return {
        "patientId": patientId,
        "count": len(readings),
        "readings": readings
    }


@router.delete("/{reading_id}")
async def delete_glucose_reading(reading_id: str, patientId: str = Query("default")):
    """Deletes a glucose reading by ID."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM glucose_readings WHERE id = ? AND patient_id = ?", (reading_id, patientId))
        conn.commit()
        deleted = cursor.rowcount > 0

    if not deleted:
        raise HTTPException(status_code=404, detail="Reading not found or already deleted.")
    return {"success": True, "id": reading_id}


@router.get("/alerts")
async def get_patient_alerts(patientId: str = Query("default")):
    """Returns active alerts and trend warnings for the patient."""
    alerts = load_recent_alerts(patientId, limit=50)
    return {
        "patientId": patientId,
        "count": len(alerts),
        "alerts": alerts,
        "disclaimer": "Automated alert notices are clinical screening aids, not diagnoses."
    }


@router.get("/thresholds")
async def get_thresholds(patientId: str = Query("default")):
    """Returns configurable alert thresholds for the patient."""
    return {
        "patientId": patientId,
        "thresholds": get_patient_thresholds(patientId)
    }


@router.put("/thresholds")
async def update_thresholds(req: ThresholdsUpdateRequest, patientId: str = Query("default")):
    """Updates custom alert thresholds for the patient."""
    current = get_patient_thresholds(patientId)
    updates = {k: v for k, v in req.dict().items() if v is not None}
    current.update(updates)

    now_iso = datetime.utcnow().isoformat()
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT OR REPLACE INTO patient_thresholds (patient_id, thresholds_json, updated_at)
            VALUES (?, ?, ?)
        """, (patientId, json.dumps(current), now_iso))
        conn.commit()

    return {
        "success": True,
        "patientId": patientId,
        "thresholds": current
    }


@router.get("/correlation")
async def get_glucose_adherence_correlation(patientId: str = Query("default")):
    """
    Computes read-only correlation insight between missed medication doses
    and subsequent glucose readings.
    """
    # 1. Fetch recent glucose readings
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT * FROM glucose_readings
            WHERE patient_id = ?
            ORDER BY measured_at DESC LIMIT 100
        """, (patientId,))
        readings = [row_to_dict(r) for r in cursor.fetchall()]

    # 2. Fetch adherence confirmations from confirmations.json if available
    adherence_records = []
    if os.path.exists(CONFIRMATIONS_FILE):
        try:
            with open(CONFIRMATIONS_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                if isinstance(data, list):
                    adherence_records = data
                elif isinstance(data, dict) and "confirmations" in data:
                    adherence_records = data["confirmations"]
        except Exception as e:
            logger.warning(f"Could not load adherence confirmations: {e}")

    result = correlate_glucose_with_adherence(readings, adherence_records)
    return {
        "patientId": patientId,
        "correlation": result
    }
