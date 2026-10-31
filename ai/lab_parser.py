"""
SmartMed Clinical Intelligence: Lab Report Text Parser (Pure Functions)
Extracts clinical biomarker vitals (Glucose, HbA1c, Creatinine, BUN, BP, BMI, Age)
from OCR raw text with unit normalization, synonym mapping, OCR noise tolerance,
and medical plausibility range validation.
"""

import re
from typing import Dict, Any, List, Optional, Tuple


# ─── Standard Plausibility Boundaries (Medical Screening Ranges) ───────────────
PLAUSIBILITY_LIMITS = {
    "glucose": {"min": 40.0, "max": 500.0, "unit": "mg/dL", "label": "Blood Glucose (Fasting)"},
    "glucose_random": {"min": 40.0, "max": 600.0, "unit": "mg/dL", "label": "Random / Post-Prandial Glucose"},
    "hba1c": {"min": 3.5, "max": 18.0, "unit": "%", "label": "Glycated Hemoglobin (HbA1c)"},
    "bmi": {"min": 10.0, "max": 70.0, "unit": "kg/m²", "label": "Body Mass Index (BMI)"},
    "age": {"min": 1.0, "max": 120.0, "unit": "years", "label": "Patient Age"},
    "systolic_bp": {"min": 60.0, "max": 250.0, "unit": "mmHg", "label": "Systolic Blood Pressure"},
    "diastolic_bp": {"min": 40.0, "max": 150.0, "unit": "mmHg", "label": "Diastolic Blood Pressure"},
    "heart_rate": {"min": 35.0, "max": 220.0, "unit": "bpm", "label": "Heart Rate / Pulse"},
    "creatinine": {"min": 0.2, "max": 15.0, "unit": "mg/dL", "label": "Serum Creatinine"},
    "bun": {"min": 2.0, "max": 120.0, "unit": "mg/dL", "label": "Blood Urea Nitrogen (BUN)"},
}


# ─── Synonym Patterns (Regex) ──────────────────────────────────────────────────
FIELD_PATTERNS = {
    "glucose": [
        r"(?:fasting\s+(?:blood\s+)?(?:sugar|glucose)|f\.?b\.?s\.?|glu(?:cose)?\s*[-_]?\s*f(?:asting)?|fpg|fasting\s+plasma\s+glucose)",
        r"(?:blood\s+sugar\s*\(?f(?:asting)?\)?|s(?:erum)?\.?\s*glucose\s*\(?f(?:asting)?\)?)",
    ],
    "glucose_random": [
        r"(?:post\s*prandial\s+(?:blood\s+)?(?:sugar|glucose)|p\.?p\.?b\.?s\.?|glu(?:cose)?\s*[-_]?\s*pp|ppbs|ppbg|2\s*hr\s*pp)",
        r"(?:random\s+(?:blood\s+)?(?:sugar|glucose)|r\.?b\.?s\.?|rbs|blood\s+sugar\s*\(?r(?:andom)?\)?)",
    ],
    "hba1c": [
        r"(?:hb\s*a[1l]c|hba[1l]c|glycated\s+h(?:a)?emoglobin|glycosylated\s+h(?:a)?emoglobin|a1c|glyco\s*hb)",
    ],
    "bmi": [
        r"(?:body\s+mass\s+index|b\.?m\.?i\.?)",
    ],
    "age": [
        r"(?:age\s*(?:[\/:]\s*(?:sex|gender))?|patient\s+age|yrs?\s+old)",
    ],
    "bp": [
        r"(?:blood\s+pressure|b\.?p\.?|bp\s+recumbent|arterial\s+pressure)",
    ],
    "heart_rate": [
        r"(?:heart\s+rate|pulse\s+rate|pulse|\bh\.?r\.?\b|\bpr\b)",
    ],
    "creatinine": [
        r"(?:serum\s+creatinine|s\.?\s*creatinine|creatinine|creat|s_cr)",
    ],
    "bun": [
        r"(?:blood\s+urea\s+nitrogen|b\.?u\.?n\.?|urea\s+nitrogen|blood\s+urea|serum\s+urea)",
    ],
}


def sanitize_ocr_number(text: str) -> Optional[float]:
    """
    Cleans OCR number text tolerant to common character confusions:
    - O / o -> 0
    - l / I / | -> 1
    - S / s -> 5
    - comma decimals '5,8' -> '5.8'
    """
    if not text:
        return None

    cleaned = text.strip()
    # Normalize comma decimal (e.g. 5,8 -> 5.8)
    cleaned = re.sub(r"(\d+),(\d+)", r"\1.\2", cleaned)

    # Common OCR letter replacements when embedded in numbers
    # Only replace if surrounded by digits or at start/end of likely number
    def repl_char(m):
        val = m.group(0)
        val = val.replace("O", "0").replace("o", "0")
        val = val.replace("l", "1").replace("I", "1").replace("|", "1")
        val = val.replace("S", "5").replace("s", "5")
        return val

    # Match candidate numeric tokens possibly tainted by letters
    match = re.search(r"[0-9OoIlISs|]+(?:\.[0-9OoIlISs|]+)?", cleaned)
    if not match:
        return None

    candidate = repl_char(match)
    try:
        return float(candidate)
    except ValueError:
        return None


def convert_units(field_key: str, value: float, raw_line: str) -> Tuple[float, str, List[str]]:
    """
    Converts units if non-standard units (e.g., mmol/L for glucose) are detected.
    Returns (converted_value, standard_unit, warnings).
    """
    warnings: List[str] = []
    line_lower = raw_line.lower()

    if field_key in ("glucose", "glucose_random"):
        # Detect mmol/L
        if "mmol" in line_lower:
            # 1 mmol/L = 18.016 mg/dL
            converted = round(value * 18.016, 1)
            warnings.append(f"Converted glucose from {value} mmol/L to {converted} mg/dL")
            return converted, "mg/dL", warnings
        # If value is very low (e.g. 4.0 - 20.0) without explicit unit, it's likely mmol/L
        if value < 25.0:
            converted = round(value * 18.016, 1)
            warnings.append(f"Auto-inferred mmol/L unit for low glucose reading {value} -> {converted} mg/dL")
            return converted, "mg/dL", warnings
        return value, "mg/dL", warnings

    if field_key == "hba1c":
        # Detect mmol/mol (IFCC)
        if "mmol/mol" in line_lower:
            # IFCC to NGSP %: (mmol/mol * 0.09148) + 2.152
            pct = round((value * 0.09148) + 2.152, 1)
            warnings.append(f"Converted HbA1c from {value} mmol/mol to {pct}%")
            return pct, "%", warnings
        # If value > 20 and no unit, likely mmol/mol
        if value > 20.0:
            pct = round((value * 0.09148) + 2.152, 1)
            warnings.append(f"Auto-inferred mmol/mol for HbA1c {value} -> {pct}%")
            return pct, "%", warnings
        return value, "%", warnings

    if field_key == "creatinine":
        # Detect µmol/L or umol/L
        if "umol" in line_lower or "µmol" in line_lower or "micromol" in line_lower:
            # 1 mg/dL = 88.4 µmol/L
            mgdl = round(value / 88.4, 2)
            warnings.append(f"Converted creatinine from {value} µmol/L to {mgdl} mg/dL")
            return mgdl, "mg/dL", warnings
        # If creatinine > 40 and no unit, likely µmol/L
        if value > 40.0:
            mgdl = round(value / 88.4, 2)
            warnings.append(f"Auto-inferred µmol/L for creatinine {value} -> {mgdl} mg/dL")
            return mgdl, "mg/dL", warnings
        return value, "mg/dL", warnings

    if field_key == "bun":
        if "mmol" in line_lower:
            converted = round(value * 2.8, 1)
            warnings.append(f"Converted BUN from {value} mmol/L to {converted} mg/dL")
            return converted, "mg/dL", warnings
        return value, "mg/dL", warnings

    return value, PLAUSIBILITY_LIMITS.get(field_key, {}).get("unit", ""), warnings


def extract_field_from_line(line: str, field_key: str) -> Optional[Dict[str, Any]]:
    """
    Attempts to extract a specific clinical field from an individual line of text.
    """
    patterns = FIELD_PATTERNS.get(field_key, [])
    line_clean = line.strip()

    # Special handling for Blood Pressure: "120/80 mmHg" or "130 / 85" or "l2O/8O"
    if field_key == "bp":
        for pat in patterns:
            if re.search(pat, line_clean, re.IGNORECASE):
                # Look for X / Y format
                bp_match = re.search(r"([0-9OoIlISs|]{2,3})\s*[\/|\\]\s*([0-9OoIlISs|]{2,3})", line_clean)
                if bp_match:
                    sys_val = sanitize_ocr_number(bp_match.group(1))
                    dia_val = sanitize_ocr_number(bp_match.group(2))
                    if sys_val and dia_val:
                        return {
                            "systolic": sys_val,
                            "diastolic": dia_val,
                            "source_text": line_clean,
                        }
        return None

    # Standard single-value extraction
    for pat in patterns:
        m = re.search(pat, line_clean, re.IGNORECASE)
        if m:
            # Look for number after or near the pattern match
            remainder = line_clean[m.end():]
            # Strip any parenthesized abbreviation like (FBS) or (PPBS) or (BMI)
            remainder = re.sub(r"^\s*\([^)]*\)", "", remainder)
            # Match number token possibly with colon or hyphen separator
            num_match = re.search(r"[:\s\-_=]*\b([0-9OoIlISs|]+(?:[,\.][0-9OoIlISs|]+)?)\b", remainder)
            if num_match:
                raw_num = num_match.group(1)
                val = sanitize_ocr_number(raw_num)
                if val is not None:
                    converted_val, std_unit, warnings = convert_units(field_key, val, line_clean)
                    limits = PLAUSIBILITY_LIMITS.get(field_key, {})
                    p_min = limits.get("min", 0.0)
                    p_max = limits.get("max", 1000.0)

                    is_plausible = p_min <= converted_val <= p_max
                    needs_review = not is_plausible

                    confidence = 0.92 if is_plausible else 0.45

                    return {
                        "key": field_key,
                        "label": limits.get("label", field_key),
                        "value": converted_val,
                        "unit": std_unit,
                        "confidence": confidence,
                        "source_text": line_clean,
                        "needs_review": needs_review,
                        "warnings": warnings,
                    }
    return None


def parse_lab_report_text(raw_text: str) -> Dict[str, Any]:
    """
    Parses full lab report OCR text and structures all extracted biomarker vitals.
    Returns:
    {
      "fields": [...],
      "raw_text": str,
      "warnings": [...]
    }
    """
    if not raw_text:
        return {"fields": [], "raw_text": "", "warnings": ["Empty or unreadable document text."]}

    lines = [ln.strip() for ln in raw_text.splitlines() if ln.strip()]
    extracted: Dict[str, Dict[str, Any]] = {}
    all_warnings: List[str] = []

    for line in lines:
        # Check Blood Pressure first
        if "bp" not in extracted:
            bp_res = extract_field_from_line(line, "bp")
            if bp_res:
                sys_limits = PLAUSIBILITY_LIMITS["systolic_bp"]
                dia_limits = PLAUSIBILITY_LIMITS["diastolic_bp"]

                sys_v = bp_res["systolic"]
                dia_v = bp_res["diastolic"]

                sys_plausible = sys_limits["min"] <= sys_v <= sys_limits["max"]
                dia_plausible = dia_limits["min"] <= dia_v <= dia_limits["max"]

                extracted["systolic_bp"] = {
                    "key": "systolic_bp",
                    "label": sys_limits["label"],
                    "value": sys_v,
                    "unit": sys_limits["unit"],
                    "confidence": 0.94 if sys_plausible else 0.45,
                    "source_text": bp_res["source_text"],
                    "needs_review": not sys_plausible,
                }
                extracted["diastolic_bp"] = {
                    "key": "diastolic_bp",
                    "label": dia_limits["label"],
                    "value": dia_v,
                    "unit": dia_limits["unit"],
                    "confidence": 0.94 if dia_plausible else 0.45,
                    "source_text": bp_res["source_text"],
                    "needs_review": not dia_plausible,
                }
                extracted["bp"] = bp_res

        # Check all other single fields
        for field_key in ("glucose", "glucose_random", "hba1c", "bmi", "age", "heart_rate", "creatinine", "bun"):
            if field_key not in extracted:
                res = extract_field_from_line(line, field_key)
                if res:
                    if res.get("warnings"):
                        all_warnings.extend(res["warnings"])
                    extracted[field_key] = res

    # Construct complete ordered list for frontend consumption
    # Include default nulls for fields in diabetes feature schema if missing
    standard_schema_keys = [
        "glucose", "glucose_random", "hba1c", "bmi", "age",
        "systolic_bp", "diastolic_bp", "heart_rate", "creatinine", "bun"
    ]

    output_fields: List[Dict[str, Any]] = []
    for k in standard_schema_keys:
        if k in extracted and extracted[k]:
            field_data = extracted[k].copy()
            field_data.pop("warnings", None)
            output_fields.append(field_data)
        else:
            limits = PLAUSIBILITY_LIMITS.get(k, {})
            output_fields.append({
                "key": k,
                "label": limits.get("label", k),
                "value": None,
                "unit": limits.get("unit", ""),
                "confidence": 0.0,
                "source_text": "",
                "needs_review": True,
            })

    return {
        "fields": output_fields,
        "raw_text": raw_text,
        "warnings": all_warnings,
    }
