"""
Comprehensive PyTest Suite for Glucose Monitoring and Lab Report Scan
Covers:
- >= 30 Lab Parser test cases (synonyms, OCR noise, unit conversions, plausibility, boundaries)
- Alert engine test cases (critical low, critical high, sudden delta, multi-day trend, cooldown)
- API integration tests (idempotency, schema, validation, rate/format limits)
- Synthetic lab report fixtures
"""

import os
import json
try:
    import pytest
except ImportError:
    pytest = None
from datetime import datetime, timedelta
from fastapi.testclient import TestClient

from lab_parser import (
    parse_lab_report_text,
    sanitize_ocr_number,
    convert_units,
    extract_field_from_line,
    PLAUSIBILITY_LIMITS,
)
from glucose_alerts import (
    evaluate_glucose_reading,
    evaluate_multi_day_trend,
    correlate_glucose_with_adherence,
    parse_iso_datetime,
    DEFAULT_THRESHOLDS,
)
from server import app

client = TestClient(app)


# ═════════════════════════════════════════════════════════════════════════════
# 1. LAB PARSER UNIT TESTS (>= 30 Test Cases)
# ═════════════════════════════════════════════════════════════════════════════

class TestLabParserSanitizeNumber:
    def test_clean_integer(self):
        assert sanitize_ocr_number("125") == 125.0

    def test_clean_decimal(self):
        assert sanitize_ocr_number("6.8") == 6.8

    def test_comma_decimal_conversion(self):
        assert sanitize_ocr_number("7,4") == 7.4

    def test_ocr_noise_letter_o_replacement(self):
        assert sanitize_ocr_number("1O5") == 105.0
        assert sanitize_ocr_number("2o0") == 200.0

    def test_ocr_noise_letter_l_replacement(self):
        assert sanitize_ocr_number("l40") == 140.0
        assert sanitize_ocr_number("I25") == 125.0

    def test_ocr_noise_letter_s_replacement(self):
        assert sanitize_ocr_number("S5") == 55.0

    def test_invalid_text_returns_none(self):
        assert sanitize_ocr_number("N/A") is None
        assert sanitize_ocr_number("") is None


class TestLabParserUnitConversions:
    def test_glucose_mmol_to_mgdl(self):
        val, unit, warns = convert_units("glucose", 5.5, "Glucose: 5.5 mmol/L")
        assert unit == "mg/dL"
        assert abs(val - 99.1) < 0.2
        assert len(warns) > 0

    def test_glucose_inferred_mmol(self):
        val, unit, warns = convert_units("glucose", 7.0, "FBS: 7.0")
        assert unit == "mg/dL"
        assert abs(val - 126.1) < 0.2

    def test_glucose_already_mgdl(self):
        val, unit, warns = convert_units("glucose", 145.0, "FBS: 145 mg/dL")
        assert unit == "mg/dL"
        assert val == 145.0

    def test_hba1c_mmol_mol_to_percent(self):
        val, unit, warns = convert_units("hba1c", 48.0, "HbA1c: 48 mmol/mol")
        assert unit == "%"
        assert 6.4 <= val <= 6.6

    def test_creatinine_umol_to_mgdl(self):
        val, unit, warns = convert_units("creatinine", 106.0, "Creatinine: 106 umol/L")
        assert unit == "mg/dL"
        assert 1.15 <= val <= 1.25

    def test_bun_mmol_to_mgdl(self):
        val, unit, warns = convert_units("bun", 7.5, "BUN: 7.5 mmol/L")
        assert unit == "mg/dL"
        assert abs(val - 21.0) < 0.5


class TestLabParserFieldExtraction:
    def test_synonym_fbs(self):
        res = extract_field_from_line("FBS: 118 mg/dL", "glucose")
        assert res is not None
        assert res["value"] == 118.0
        assert res["needs_review"] is False

    def test_synonym_fasting_blood_sugar(self):
        res = extract_field_from_line("Fasting Blood Sugar - 132 mg/dL", "glucose")
        assert res is not None
        assert res["value"] == 132.0

    def test_synonym_glu_f(self):
        res = extract_field_from_line("GLU-F: 145", "glucose")
        assert res is not None
        assert res["value"] == 145.0

    def test_synonym_fpg(self):
        res = extract_field_from_line("FPG 98 mg/dL", "glucose")
        assert res is not None
        assert res["value"] == 98.0

    def test_synonym_ppbs(self):
        res = extract_field_from_line("PPBS: 172 mg/dL", "glucose_random")
        assert res is not None
        assert res["value"] == 172.0

    def test_synonym_post_prandial(self):
        res = extract_field_from_line("Post Prandial Blood Glucose: 195", "glucose_random")
        assert res is not None
        assert res["value"] == 195.0

    def test_synonym_rbs(self):
        res = extract_field_from_line("RBS: 160 mg/dL", "glucose_random")
        assert res is not None
        assert res["value"] == 160.0

    def test_synonym_hba1c(self):
        res = extract_field_from_line("HbA1c: 7.2 %", "hba1c")
        assert res is not None
        assert res["value"] == 7.2

    def test_synonym_glycated_hemoglobin(self):
        res = extract_field_from_line("Glycated Hemoglobin : 8.1%", "hba1c")
        assert res is not None
        assert res["value"] == 8.1

    def test_synonym_serum_creatinine(self):
        res = extract_field_from_line("Serum Creatinine: 1.1 mg/dL", "creatinine")
        assert res is not None
        assert res["value"] == 1.1

    def test_synonym_s_creatinine(self):
        res = extract_field_from_line("S. Creatinine : 0.95", "creatinine")
        assert res is not None
        assert res["value"] == 0.95

    def test_synonym_bun(self):
        res = extract_field_from_line("BUN: 18 mg/dL", "bun")
        assert res is not None
        assert res["value"] == 18.0

    def test_synonym_blood_urea_nitrogen(self):
        res = extract_field_from_line("Blood Urea Nitrogen: 22", "bun")
        assert res is not None
        assert res["value"] == 22.0

    def test_synonym_blood_pressure(self):
        res = extract_field_from_line("B.P.: 130/85 mmHg", "bp")
        assert res is not None
        assert res["systolic"] == 130.0
        assert res["diastolic"] == 85.0

    def test_bp_with_spaces_and_slash(self):
        res = extract_field_from_line("Blood Pressure: 140 / 90", "bp")
        assert res is not None
        assert res["systolic"] == 140.0
        assert res["diastolic"] == 90.0

    def test_synonym_bmi(self):
        res = extract_field_from_line("Body Mass Index: 28.4 kg/m2", "bmi")
        assert res is not None
        assert res["value"] == 28.4

    def test_synonym_age(self):
        res = extract_field_from_line("Age: 62 Yrs / Male", "age")
        assert res is not None
        assert res["value"] == 62.0

    def test_implausible_high_glucose_flagged(self):
        res = extract_field_from_line("FBS: 850 mg/dL", "glucose")
        assert res is not None
        assert res["value"] == 850.0
        assert res["needs_review"] is True
        assert res["confidence"] < 0.6

    def test_implausible_low_hba1c_flagged(self):
        res = extract_field_from_line("HbA1c: 1.5%", "hba1c")
        assert res is not None
        assert res["needs_review"] is True


class TestLabParserFullDocument:
    def test_empty_text(self):
        parsed = parse_lab_report_text("")
        assert parsed["fields"] == []
        assert len(parsed["warnings"]) > 0

    def test_comprehensive_synthetic_report(self):
        sample_doc = """
        APOLLO DIAGNOSTICS - CLINICAL BIOCHEMISTRY REPORT
        Patient Name: Ramesh Kumar   Age: 56 Yrs   Sex: Male
        Referred By: Dr. S. Sharma MD
        -------------------------------------------------------------
        TEST NAME                          RESULT      BIOLOGICAL REF
        -------------------------------------------------------------
        Fasting Blood Sugar (FBS)          152 mg/dL   70 - 100 mg/dL
        Post Prandial Blood Glucose (PPBS) 210 mg/dL   < 140 mg/dL
        Glycated Hemoglobin (HbA1c)        7.8 %       < 5.7 %
        Serum Creatinine                   1.2 mg/dL   0.7 - 1.3 mg/dL
        Blood Urea Nitrogen (BUN)          20.0 mg/dL  7.0 - 20.0 mg/dL
        Blood Pressure                     138/86 mmHg < 120/80 mmHg
        Body Mass Index (BMI)              29.3 kg/m2  18.5 - 24.9
        Pulse Rate                         78 bpm      60 - 100 bpm
        -------------------------------------------------------------
        """
        parsed = parse_lab_report_text(sample_doc)
        fields_by_key = {f["key"]: f for f in parsed["fields"]}

        assert fields_by_key["glucose"]["value"] == 152.0
        assert fields_by_key["glucose_random"]["value"] == 210.0
        assert fields_by_key["hba1c"]["value"] == 7.8
        assert fields_by_key["creatinine"]["value"] == 1.2
        assert fields_by_key["bun"]["value"] == 20.0
        assert fields_by_key["systolic_bp"]["value"] == 138.0
        assert fields_by_key["diastolic_bp"]["value"] == 86.0
        assert fields_by_key["bmi"]["value"] == 29.3
        assert fields_by_key["age"]["value"] == 56.0
        assert fields_by_key["heart_rate"]["value"] == 78.0

    def test_noisy_ocr_document(self):
        noisy_doc = """
        LAB TEST RESULTS
        Patient Age: 4S Yrs
        FBS: l3O mg/dL
        HbAlc: 6,9 %
        B.P: l2O/8O
        S. Creatinine: l.O mg/dL
        """
        parsed = parse_lab_report_text(noisy_doc)
        f_map = {f["key"]: f for f in parsed["fields"]}

        assert f_map["glucose"]["value"] == 130.0
        assert f_map["hba1c"]["value"] == 6.9
        assert f_map["systolic_bp"]["value"] == 120.0
        assert f_map["diastolic_bp"]["value"] == 80.0
        assert f_map["creatinine"]["value"] == 1.0


# ═════════════════════════════════════════════════════════════════════════════
# 2. GLUCOSE ALERT ENGINE UNIT TESTS
# ═════════════════════════════════════════════════════════════════════════════

class TestGlucoseAlertRules:
    def test_critical_low_hypoglycemia(self):
        reading = {"id": "1", "patientId": "p1", "value_mgdl": 54.0, "measuredAt": "2026-10-16T10:00:00"}
        alerts = evaluate_glucose_reading(reading, [])
        assert len(alerts) == 1
        assert alerts[0]["rule"] == "critical_low"
        assert alerts[0]["severity"] == "critical"
        assert "54" in alerts[0]["message"]

    def test_normal_reading_generates_no_alerts(self):
        reading = {"id": "1", "patientId": "p1", "value_mgdl": 115.0, "measuredAt": "2026-10-16T10:00:00"}
        alerts = evaluate_glucose_reading(reading, [])
        assert len(alerts) == 0

    def test_critical_high_hyperglycemia(self):
        reading = {"id": "1", "patientId": "p1", "value_mgdl": 290.0, "measuredAt": "2026-10-16T10:00:00"}
        alerts = evaluate_glucose_reading(reading, [])
        assert any(a["rule"] == "critical_high" and a["severity"] == "critical" for a in alerts)

    def test_sudden_delta_spike(self):
        past = [{"id": "p1", "patientId": "p1", "value_mgdl": 110.0, "measuredAt": "2026-10-16T08:00:00"}]
        curr = {"id": "curr", "patientId": "p1", "value_mgdl": 235.0, "measuredAt": "2026-10-16T09:30:00"}
        alerts = evaluate_glucose_reading(curr, past)
        spike = [a for a in alerts if a["rule"] == "sudden_change"]
        assert len(spike) == 1
        assert "spiked" in spike[0]["message"]

    def test_sudden_delta_drop(self):
        past = [{"id": "p1", "patientId": "p1", "value_mgdl": 220.0, "measuredAt": "2026-10-16T14:00:00"}]
        curr = {"id": "curr", "patientId": "p1", "value_mgdl": 105.0, "measuredAt": "2026-10-16T15:30:00"}
        alerts = evaluate_glucose_reading(curr, past)
        drop = [a for a in alerts if a["rule"] == "sudden_change"]
        assert len(drop) == 1
        assert "dropped" in drop[0]["message"]

    def test_consecutive_3_days_trend_alert(self):
        readings = [
            {"id": "d1", "patientId": "p1", "value_mgdl": 160.0, "context": "fasting", "measuredAt": "2026-10-13T08:00:00"},
            {"id": "d2", "patientId": "p1", "value_mgdl": 155.0, "context": "fasting", "measuredAt": "2026-10-14T08:00:00"},
        ]
        curr = {"id": "d3", "patientId": "p1", "value_mgdl": 165.0, "context": "fasting", "measuredAt": "2026-10-15T08:00:00"}
        alerts = evaluate_glucose_reading(curr, readings)
        trend = [a for a in alerts if a["rule"] == "consecutive_high_trend"]
        assert len(trend) == 1
        assert trend[0]["severity"] == "warning"

    def test_cooldown_suppression(self):
        existing_alert = [{
            "rule": "critical_low",
            "patientId": "p1",
            "createdAt": "2026-10-16T09:00:00"
        }]
        curr = {"id": "2", "patientId": "p1", "value_mgdl": 58.0, "measuredAt": "2026-10-16T10:00:00"}
        alerts = evaluate_glucose_reading(curr, [], existing_alerts=existing_alert)
        assert len(alerts) == 0  # Suppressed due to 6h cooldown

    def test_custom_thresholds_override(self):
        # Default critical low is 70, but custom set to 60
        custom_cfg = {"critical_low": 60.0}
        curr = {"id": "1", "patientId": "p1", "value_mgdl": 65.0, "measuredAt": "2026-10-16T10:00:00"}
        alerts = evaluate_glucose_reading(curr, [], thresholds=custom_cfg)
        assert len(alerts) == 0


class TestAdherenceCorrelation:
    def test_correlation_with_missed_doses(self):
        readings = [
            {"value_mgdl": 210.0, "measuredAt": "2026-10-14T10:00:00"},
            {"value_mgdl": 115.0, "measuredAt": "2026-10-15T10:00:00"},
        ]
        adherence = [
            {"medicine": "Metformin", "status": "SKIPPED", "scheduledTime": "2026-10-13T20:00:00"}
        ]
        res = correlate_glucose_with_adherence(readings, adherence)
        assert res["has_correlation_data"] is True
        assert res["missed_dose_impact_avg_mgdl"] is not None
        assert res["missed_dose_impact_avg_mgdl"] > 0

    def test_correlation_when_no_adherence_data(self):
        res = correlate_glucose_with_adherence([], [])
        assert res["has_correlation_data"] is False


# ═════════════════════════════════════════════════════════════════════════════
# 3. FASTAPI ENDPOINT INTEGRATION TESTS
# ═════════════════════════════════════════════════════════════════════════════

class TestGlucoseAPIs:
    def test_schema_endpoint(self):
        r = client.get("/api/clinical/diabetes-schema")
        assert r.status_code == 200
        data = r.json()
        assert "features" in data
        keys = [f["key"] for f in data["features"]]
        assert "glucose" in keys
        assert "bmi" in keys
        assert "age" in keys
        assert "systolic_bp" in keys
        assert "creatinine" in keys

    def test_glucose_post_and_get_idempotency(self):
        uid = f"test-idemp-{int(datetime.utcnow().timestamp())}"
        payload = {
            "id": uid,
            "patientId": "test_patient",
            "value_mgdl": 135.0,
            "unit_entered": "mg/dL",
            "context": "fasting",
            "measuredAt": "2026-10-16T08:30:00Z",
            "source": "manual"
        }

        # First POST
        r1 = client.post("/api/glucose", json=payload)
        assert r1.status_code == 200
        assert r1.json()["reading"]["id"] == uid

        # Second POST (idempotent overwrite)
        r2 = client.post("/api/glucose", json=payload)
        assert r2.status_code == 200
        assert r2.json()["reading"]["id"] == uid

        # Query GET
        r3 = client.get(f"/api/glucose?patientId=test_patient")
        assert r3.status_code == 200
        items = [x for x in r3.json()["readings"] if x["id"] == uid]
        assert len(items) == 1

        # Delete cleanup
        rd = client.delete(f"/api/glucose/{uid}?patientId=test_patient")
        assert rd.status_code == 200

    def test_glucose_validation_bounds(self):
        # Value < 20 rejected
        r_low = client.post("/api/glucose", json={
            "id": "low-err",
            "patientId": "test",
            "value_mgdl": 10.0,
            "measuredAt": "2026-10-16T08:00:00Z"
        })
        assert r_low.status_code == 422

        # Value > 800 rejected
        r_high = client.post("/api/glucose", json={
            "id": "high-err",
            "patientId": "test",
            "value_mgdl": 950.0,
            "measuredAt": "2026-10-16T08:00:00Z"
        })
        assert r_high.status_code == 422

    def test_glucose_future_date_rejected(self):
        future_iso = (datetime.utcnow() + timedelta(days=5)).isoformat()
        r = client.post("/api/glucose", json={
            "id": "future-err",
            "patientId": "test",
            "value_mgdl": 120.0,
            "measuredAt": future_iso
        })
        assert r.status_code == 400
        assert "future" in r.json()["detail"].lower()

    def test_thresholds_get_and_put(self):
        # Update custom thresholds
        r_put = client.put("/api/glucose/thresholds?patientId=test_thresh", json={"critical_low": 65.0})
        assert r_put.status_code == 200
        assert r_put.json()["thresholds"]["critical_low"] == 65.0

        # Query back
        r_get = client.get("/api/glucose/thresholds?patientId=test_thresh")
        assert r_get.status_code == 200
        assert r_get.json()["thresholds"]["critical_low"] == 65.0

    def test_lab_scan_rejects_invalid_magic_bytes(self):
        fake_bytes = b"This is a plain text file, not an image"
        files = {"file": ("test.txt", fake_bytes, "text/plain")}
        r = client.post("/api/clinical/lab-scan", files=files)
        assert r.status_code == 400
        assert "invalid file signature" in r.json()["detail"].lower()


if __name__ == "__main__":
    import sys
    import inspect

    passed = 0
    failed = 0
    errors = []

    current_module = sys.modules[__name__]
    for name, obj in inspect.getmembers(current_module, inspect.isclass):
        if name.startswith("Test") and name != "TestClient" and obj.__module__ == __name__:
            instance = obj()
            for method_name, method in inspect.getmembers(instance, inspect.ismethod):
                if method_name.startswith("test_"):
                    try:
                        method()
                        passed += 1
                        print(f"  ✓ {name}.{method_name}")
                    except Exception as e:
                        failed += 1
                        errors.append((f"{name}.{method_name}", str(e)))
                        print(f"  ✗ {name}.{method_name}: {e}")

    print("\n" + "=" * 60)
    print(f"Test Summary: {passed} passed, {failed} failed")
    print("=" * 60)
    if failed > 0:
        for err_name, err_desc in errors:
            print(f"FAILED: {err_name} -> {err_desc}")
        sys.exit(1)
    else:
        print("ALL TESTS PASSED SUCCESSFULLY!")
        sys.exit(0)

