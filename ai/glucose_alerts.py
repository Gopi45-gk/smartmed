"""
SmartMed Clinical Intelligence: Glucose Alert & Trend Engine (Pure Functions)
Evaluates critical threshold violations, multi-day glycemic trends, sudden glycemic swings,
and medication adherence correlation. Plain language, safety-first screening aid.
"""

from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional, Tuple


# ─── Default Clinical Thresholds ───────────────────────────────────────────────
DEFAULT_THRESHOLDS = {
    "critical_low": 70.0,      # Hypoglycemia emergency trigger
    "critical_high": 250.0,    # Severe hyperglycemia trigger
    "fasting_target_max": 130.0,# ADA recommended fasting upper bound
    "general_target_max": 180.0,# ADA recommended post-meal upper bound
    "sudden_delta_mgdl": 100.0, # Rapid glycemic change threshold
    "sudden_window_hours": 3.0, # Timeframe for rapid change
    "trend_consecutive_days": 3,# Consecutive days threshold for trend alert
    "cooldown_critical_hours": 6.0,
    "cooldown_warning_hours": 24.0,
}


def parse_iso_datetime(dt_str: str) -> Optional[datetime]:
    """Safely parses ISO datetime string and returns naive UTC datetime."""
    if not dt_str:
        return None
    try:
        cleaned = dt_str.replace("Z", "+00:00")
        dt = datetime.fromisoformat(cleaned)
        if dt.tzinfo is not None:
            from datetime import timezone
            dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
        return dt
    except Exception:
        try:
            return datetime.strptime(dt_str[:19], "%Y-%m-%dT%H:%M:%S")
        except Exception:
            return None


def evaluate_glucose_reading(
    reading: Dict[str, Any],
    recent_readings: List[Dict[str, Any]],
    thresholds: Optional[Dict[str, Any]] = None,
    existing_alerts: Optional[List[Dict[str, Any]]] = None
) -> List[Dict[str, Any]]:
    """
    Evaluates a newly added or existing reading against clinical alert rules.
    Returns generated alerts for this patient:
    [
      {
        "id": str,
        "patientId": str,
        "rule": str,
        "severity": "critical" | "warning" | "info",
        "title": str,
        "message": str,
        "value": float,
        "measuredAt": str,
        "createdAt": str,
        "actionNeeded": bool
      }
    ]
    """
    cfg = DEFAULT_THRESHOLDS.copy()
    if thresholds:
        cfg.update(thresholds)

    val = float(reading.get("value_mgdl", 0))
    patient_id = str(reading.get("patientId", ""))
    reading_time = parse_iso_datetime(reading.get("measuredAt", "")) or datetime.utcnow()
    context = reading.get("context", "random")

    now_iso = datetime.utcnow().isoformat()
    generated_alerts: List[Dict[str, Any]] = []

    # Helper: Check alert cooldown
    def is_in_cooldown(rule_name: str, cooldown_hours: float) -> bool:
        if not existing_alerts:
            return False
        cutoff = reading_time - timedelta(hours=cooldown_hours)
        for a in existing_alerts:
            if a.get("rule") == rule_name and a.get("patientId") == patient_id:
                a_time = parse_iso_datetime(a.get("createdAt", ""))
                if a_time and a_time >= cutoff:
                    return True
        return False

    # ─── Rule 1: Critical Low (Hypoglycemia < 70 mg/dL) ─────────────────────────
    if val < cfg["critical_low"]:
        if not is_in_cooldown("critical_low", cfg["cooldown_critical_hours"]):
            generated_alerts.append({
                "patientId": patient_id,
                "rule": "critical_low",
                "severity": "critical",
                "title": "Urgent: Low Blood Sugar Alert",
                "message": f"Blood sugar reading of {val:.0f} mg/dL is low. Please take 15g of fast-acting sugar (fruit juice or glucose tablets) and contact your doctor immediately.",
                "value": val,
                "measuredAt": reading.get("measuredAt", now_iso),
                "createdAt": now_iso,
                "actionNeeded": True,
                "disclaimer": "Screening aid only. Seek emergency medical care for confusion or loss of consciousness."
            })

    # ─── Rule 2: Critical High (Hyperglycemia > 250 mg/dL) ──────────────────────
    elif val > cfg["critical_high"]:
        if not is_in_cooldown("critical_high", cfg["cooldown_critical_hours"]):
            generated_alerts.append({
                "patientId": patient_id,
                "rule": "critical_high",
                "severity": "critical",
                "title": "Urgent: High Blood Sugar Alert",
                "message": f"Blood sugar reading of {val:.0f} mg/dL is very high. Stay hydrated, check for ketones if advised, and contact your healthcare provider.",
                "value": val,
                "measuredAt": reading.get("measuredAt", now_iso),
                "createdAt": now_iso,
                "actionNeeded": True,
                "disclaimer": "Screening alert. Not a clinical diagnosis."
            })

    # ─── Rule 3: Sudden Glycemic Swing (> 100 mg/dL within 3 hours) ────────────
    if recent_readings:
        # Sort recent readings descending by timestamp
        sorted_recent = []
        for r in recent_readings:
            if r.get("id") != reading.get("id"):
                r_dt = parse_iso_datetime(r.get("measuredAt", ""))
                if r_dt:
                    sorted_recent.append((r_dt, float(r.get("value_mgdl", 0))))
        sorted_recent.sort(key=lambda x: x[0], reverse=True)

        for prev_dt, prev_val in sorted_recent:
            diff_hours = abs((reading_time - prev_dt).total_seconds()) / 3600.0
            if diff_hours <= cfg["sudden_window_hours"]:
                delta = abs(val - prev_val)
                if delta >= cfg["sudden_delta_mgdl"]:
                    if not is_in_cooldown("sudden_change", cfg["cooldown_warning_hours"]):
                        direction = "dropped" if val < prev_val else "spiked"
                        generated_alerts.append({
                            "patientId": patient_id,
                            "rule": "sudden_change",
                            "severity": "warning",
                            "title": "Notice: Rapid Blood Sugar Change",
                            "message": f"Blood sugar {direction} by {delta:.0f} mg/dL within {diff_hours:.1f} hours (from {prev_val:.0f} to {val:.0f} mg/dL). Monitor symptoms closely.",
                            "value": val,
                            "measuredAt": reading.get("measuredAt", now_iso),
                            "createdAt": now_iso,
                            "actionNeeded": False,
                            "disclaimer": "Automated trend warning."
                        })
                    break

    # ─── Rule 4: Multi-Day Elevation Trend (≥ 3 consecutive days) ──────────────
    trend_alert = evaluate_multi_day_trend(reading, recent_readings, cfg, is_in_cooldown)
    if trend_alert:
        generated_alerts.append(trend_alert)

    return generated_alerts


def evaluate_multi_day_trend(
    current_reading: Dict[str, Any],
    all_readings: List[Dict[str, Any]],
    cfg: Dict[str, Any],
    is_in_cooldown_fn
) -> Optional[Dict[str, Any]]:
    """
    Checks if there are ≥ 3 consecutive days with elevated blood sugar
    (fasting > 130 or any reading > 180).
    """
    if is_in_cooldown_fn("consecutive_high_trend", cfg["cooldown_warning_hours"]):
        return None

    # Group readings by calendar date (YYYY-MM-DD)
    days_elevated = set()
    combined = all_readings + [current_reading]

    for r in combined:
        dt = parse_iso_datetime(r.get("measuredAt", ""))
        if not dt:
            continue
        day_str = dt.strftime("%Y-%m-%d")
        v = float(r.get("value_mgdl", 0))
        ctx = r.get("context", "")

        is_elevated = False
        if ctx == "fasting" and v > cfg["fasting_target_max"]:
            is_elevated = True
        elif v > cfg["general_target_max"]:
            is_elevated = True

        if is_elevated:
            days_elevated.add(day_str)

    if len(days_elevated) < cfg["trend_consecutive_days"]:
        return None

    # Check for consecutive days
    sorted_days = sorted([datetime.strptime(d, "%Y-%m-%d") for d in days_elevated])
    max_consecutive = 1
    curr_consecutive = 1

    for i in range(1, len(sorted_days)):
        if (sorted_days[i] - sorted_days[i-1]).days == 1:
            curr_consecutive += 1
            max_consecutive = max(max_consecutive, curr_consecutive)
        else:
            curr_consecutive = 1

    if max_consecutive >= cfg["trend_consecutive_days"]:
        now_iso = datetime.utcnow().isoformat()
        return {
            "patientId": str(current_reading.get("patientId", "")),
            "rule": "consecutive_high_trend",
            "severity": "warning",
            "title": "Pattern Alert: Consecutive Elevated Readings",
            "message": f"Blood sugar has been above target for {max_consecutive} consecutive days. Review meal and medication schedule with your caregiver or physician.",
            "value": float(current_reading.get("value_mgdl", 0)),
            "measuredAt": current_reading.get("measuredAt", now_iso),
            "createdAt": now_iso,
            "actionNeeded": False,
            "disclaimer": "Monitoring insight based on consecutive logged readings."
        }

    return None


def correlate_glucose_with_adherence(
    readings: List[Dict[str, Any]],
    adherence_records: List[Dict[str, Any]]
) -> Dict[str, Any]:
    """
    Read-only correlation summary between missed medication doses and subsequent glucose readings.
    """
    if not readings or not adherence_records:
        return {
            "has_correlation_data": False,
            "summary": "Insufficient adherence logs or glucose readings for correlation.",
            "missed_dose_impact_avg_mgdl": None,
        }

    # Find missed or delayed dose timestamps
    missed_times = []
    for rec in adherence_records:
        st = rec.get("status", "").upper()
        if st in ("SKIPPED", "DELAYED", "NO_ANSWER"):
            t = parse_iso_datetime(rec.get("scheduledTime") or rec.get("confirmedAt"))
            if t:
                missed_times.append((t, rec.get("medicine", "Medication")))

    if not missed_times:
        return {
            "has_correlation_data": True,
            "summary": "No missed doses recorded in adherence history. Good medication compliance.",
            "missed_dose_impact_avg_mgdl": None,
        }

    # Match glucose readings taken within 24 hours after a missed dose
    after_missed_readings = []
    normal_readings = []

    for r in readings:
        r_dt = parse_iso_datetime(r.get("measuredAt", ""))
        if not r_dt:
            continue
        v = float(r.get("value_mgdl", 0))

        # Check if preceded by a missed dose within 24 hours
        is_after_missed = False
        for m_dt, med_name in missed_times:
            if timedelta(hours=0) <= (r_dt - m_dt) <= timedelta(hours=24):
                is_after_missed = True
                break

        if is_after_missed:
            after_missed_readings.append(v)
        else:
            normal_readings.append(v)

    if after_missed_readings and normal_readings:
        avg_missed = sum(after_missed_readings) / len(after_missed_readings)
        avg_normal = sum(normal_readings) / len(normal_readings)
        diff = avg_missed - avg_normal
        return {
            "has_correlation_data": True,
            "summary": f"Average glucose following a missed dose was {avg_missed:.0f} mg/dL vs {avg_normal:.0f} mg/dL during regular adherence (+{diff:.0f} mg/dL difference).",
            "missed_dose_impact_avg_mgdl": round(diff, 1),
            "after_missed_count": len(after_missed_readings),
            "normal_count": len(normal_readings)
        }

    return {
        "has_correlation_data": True,
        "summary": "Adherence logged. More sequential readings needed to establish statistical correlation.",
        "missed_dose_impact_avg_mgdl": None,
    }
