"""
SmartMed AI - Clinical Prescription Entity Extraction & Structuring
Implements strict document layout understanding, prescription field separation,
and zero-hallucination medicine candidate extraction.

Separates:
- Patient Information (Name, Age, Gender, ID)
- Date
- Clinical Notes & Symptoms
- Diagnosis
- Vitals
- Medications (strictly validated against WHO EML)
- IV Fluids / Injections
- Advice & ORS Instructions
- Follow-up
"""

import re
import logging
from typing import List, Dict, Any, Optional, Tuple
import numpy as np

from .engine import OCRRegion
from .layout_analysis import DocumentLayoutAnalyzer, RegionCategory
from .validation import MedicineValidator
from .confidence import ConfidenceFusionEngine

logger = logging.getLogger("smartmed.ocr.extraction")

# Prefix forms mapping: (med_type, default_dosage, default_route)
# Dosage MUST BE None unless explicitly written in the prescription text!
FORM_PREFIXES = {
    "tab": ("tablet", None, "oral"),
    "tab.": ("tablet", None, "oral"),
    "tablet": ("tablet", None, "oral"),
    "tablets": ("tablet", None, "oral"),
    "cap": ("capsule", None, "oral"),
    "cap.": ("capsule", None, "oral"),
    "capsule": ("capsule", None, "oral"),
    "capsules": ("capsule", None, "oral"),
    "syp": ("liquid", None, "oral"),
    "syp.": ("liquid", None, "oral"),
    "syrup": ("liquid", None, "oral"),
    "inj": ("injection", None, "iv/im"),
    "inj.": ("injection", None, "iv/im"),
    "injection": ("injection", None, "iv/im"),
    "oint": ("ointment", None, "topical"),
    "ointment": ("ointment", None, "topical"),
    "drops": ("liquid", None, "drops"),
    "drop": ("liquid", None, "drops"),
}

FREQUENCY_MAP = {
    "1-0-1": "1-0-1",
    "0-0-1": "0-0-1",
    "1-0-0": "1-0-0",
    "1-1-1": "1-1-1",
    "0-1-0": "0-1-0",
    "1-1-1-1": "1-1-1-1",
    "od": "1-0-0",
    "qd": "1-0-0",
    "bd": "1-0-1",
    "bid": "1-0-1",
    "tds": "1-1-1",
    "tid": "1-1-1",
    "qid": "1-1-1-1",
    "qds": "1-1-1-1",
    "sos": "SOS (As needed)",
    "prn": "SOS (As needed)",
    "hs": "0-0-1 (Bedtime)",
    "once daily": "1-0-0",
    "twice daily": "1-0-1",
    "twice a day": "1-0-1",
    "thrice daily": "1-1-1",
    "three times daily": "1-1-1",
}

INSTRUCTION_MAP = {
    "after food": "After food",
    "after meals": "After food",
    "after meal": "After food",
    "after dinner": "After Dinner",
    "after lunch": "After Lunch",
    "after breakfast": "After Breakfast",
    "af": "After food",
    "pc": "After food",
    "post-meal": "After food",
    "before food": "Before food",
    "before meals": "Before food",
    "before meal": "Before food",
    "before breakfast": "Before Breakfast",
    "empty stomach": "Empty Stomach",
    "bf": "Before food",
    "ac": "Before food",
    "pre-meal": "Before food",
    "with food": "With meals",
    "with meals": "With meals",
    "with dinner": "With Dinner",
    "at bedtime": "At Bedtime",
    "at night": "At Bedtime",
    "hs": "At Bedtime",
}


class ClinicalExtractor:
    """
    High-accuracy clinical prescription extractor adhering strictly to zero hallucination.
    """

    def __init__(self, eml_path: Optional[str] = None):
        self.layout_analyzer = DocumentLayoutAnalyzer()
        self.validator = MedicineValidator(eml_path=eml_path)
        self.confidence_engine = ConfidenceFusionEngine()

        # Regex patterns
        self.re_frequency_pattern = re.compile(r"\b([012])-([012])-([012])(-([012]))?\b", re.IGNORECASE)
        self.re_abbrev_frequency = re.compile(
            r"\b(OD|QD|BD|BID|TDS|TID|QID|QDS|SOS|PRN|HS|once\s+daily|twice\s+daily|twice\s+a\s+day|thrice\s+daily)\b",
            re.IGNORECASE,
        )
        self.re_strength = re.compile(
            r"\b(\d+(?:\.\d+)?\s*(?:mg|g|mcg|µg|ml|iu|k|%|gm)(?:/(?:\d+)?\s*(?:ml|g))?)\b",
            re.IGNORECASE,
        )
        self.re_dosage = re.compile(
            r"\b((?:\d+(?:\.\d+)?|\d+/\d+)\s*(?:tablets?|tabs?|capsules?|caps?|ml|puffs?|drops?|sachets?|ochets?|tsp|ampoules?))\b",
            re.IGNORECASE,
        )
        self.re_duration = re.compile(r"\b(?:x\s*)?(\d+)\s*(days?|weeks?|months?|d|w|m)\b", re.IGNORECASE)
        self.re_instructions = re.compile(
            r"\b(after\s+(?:food|meals?|dinner|lunch|breakfast)|before\s+(?:food|meals?|breakfast)|empty\s+stomach|with\s+(?:food|meals?|dinner)|at\s+bedtime|at\s+night|af|bf|pc|ac|hs)\b",
            re.IGNORECASE,
        )
        self.re_scheduled_time = re.compile(
            r"\b(?:at\s+)?(\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.))\b",
            re.IGNORECASE,
        )

    def group_regions_into_lines(self, regions: List[OCRRegion]) -> List[List[OCRRegion]]:
        """
        Groups bounding boxes by spatial vertical line overlap (Y-coordinate proximity).
        """
        if not regions:
            return []

        sorted_regions = sorted(regions, key=lambda r: (r.bounding_rect[1], r.bounding_rect[0]))

        lines: List[List[OCRRegion]] = []
        current_line: List[OCRRegion] = []
        current_line_y = -1
        current_line_h = -1

        for r in sorted_regions:
            x, y, w, h = r.bounding_rect
            if current_line_y < 0:
                current_line = [r]
                current_line_y = y
                current_line_h = h
            else:
                y_diff = abs(y - current_line_y)
                avg_h = (h + current_line_h) / 2
                if y_diff < (avg_h * 0.65):
                    current_line.append(r)
                else:
                    lines.append(sorted(current_line, key=lambda item: item.bounding_rect[0]))
                    current_line = [r]
                    current_line_y = y
                    current_line_h = h

        if current_line:
            lines.append(sorted(current_line, key=lambda item: item.bounding_rect[0]))

        return lines

    def parse_medication_line(
        self, line_text: str, line_confidence: float, bbox: Optional[List[float]] = None
    ) -> Optional[Dict[str, Any]]:
        """
        Parses a line that has been verified to reside in the MEDICATION or IV section.
        Extracts visible clinical entities WITHOUT hallucinating defaults.
        Fields not present in the visible text MUST remain None.
        """
        raw_clean = line_text.strip()
        # Strip leading numbering, bullets, or Rx: e.g., "1.", "2)", "Rx:", "- "
        raw_clean = re.sub(r"^(?:Rx[:\s]*|\d+[\.\)\s]+|[-*•]\s*)", "", raw_clean, flags=re.IGNORECASE).strip()
        if len(raw_clean) < 3:
            return None

        # Normalize common OCR-merged prescription tokens:
        #  - DRS28ochets / DRS280chets → ORS 2 sachets
        #  - DRS2sachets → ORS 2 sachets
        ors_m = re.match(r"(?i)^(?:DRS|ORS)\s*(\d)\d*\s*(?:ochets?|sachets?|0chets?)\.?$", raw_clean)
        if ors_m:
            raw_clean = f"ORS {ors_m.group(1)} sachets"

        # 1. Extract Strength
        strength = None
        strength_match = self.re_strength.search(raw_clean)
        if strength_match:
            strength = strength_match.group(1).strip()

        # 2. Extract Frequency
        frequency = None
        freq_match = self.re_frequency_pattern.search(raw_clean)
        if freq_match:
            frequency = freq_match.group(0).upper()
        else:
            freq_abbrev = self.re_abbrev_frequency.search(raw_clean)
            if freq_abbrev:
                k = freq_abbrev.group(0).lower()
                frequency = FREQUENCY_MAP.get(k, freq_abbrev.group(0).upper())

        # 3. Extract Instructions
        instructions = None
        instr_match = self.re_instructions.search(raw_clean)
        if instr_match:
            k = instr_match.group(0).lower()
            instructions = INSTRUCTION_MAP.get(k, instr_match.group(0).title())

        # 4. Extract Scheduled Time (Only if explicitly visible, e.g. "9 AM", "8 PM", "09:00")
        scheduled_time = None
        time_match = self.re_scheduled_time.search(raw_clean)
        if time_match:
            scheduled_time = time_match.group(1).upper()

        # 5. Extract Dosage & Form Type & Route
        med_type = "tablet"
        dosage = None
        route = "oral"

        # Check prefix form indicator (e.g. Tab, Cap, Syp, Inj)
        words = raw_clean.split()
        first_token = words[0].lower().rstrip(".:") if words else ""
        if first_token in FORM_PREFIXES:
            t, d, r = FORM_PREFIXES[first_token]
            med_type = t
            dosage = d
            route = r

        # Explicit dosage match (e.g. "10 ml", "2 tablets", "1 tablet")
        text_without_strength = self.re_strength.sub(" ", raw_clean)
        dose_match = self.re_dosage.search(text_without_strength)
        if dose_match:
            dosage = dose_match.group(1).strip()
            d_lower = dosage.lower()
            if "cap" in d_lower:
                med_type = "capsule"
            elif "ml" in d_lower or "drop" in d_lower:
                med_type = "liquid"
            elif "inj" in d_lower or "amp" in d_lower:
                med_type = "injection"
                route = "iv/im"

        # 6. Extract Duration
        duration = None
        dur_match = self.re_duration.search(raw_clean)
        if dur_match:
            duration = dur_match.group(0).strip()

        # 7. Extract Raw Medicine Name Candidate
        name_candidate = raw_clean

        # Remove "Rx" or numbering at beginning (e.g. "1.", "Rx:")
        name_candidate = re.sub(r"^(?:Rx[:\s]*|\d+[\.\)\s]+)", "", name_candidate, flags=re.IGNORECASE)

        # Remove form prefix
        tokens = name_candidate.split()
        if tokens and tokens[0].lower().rstrip(".:") in FORM_PREFIXES:
            name_candidate = " ".join(tokens[1:])

        # Strip extracted fields from text to isolate name
        if strength:
            name_candidate = re.sub(re.escape(strength), " ", name_candidate, flags=re.IGNORECASE)
        name_candidate = self.re_strength.sub(" ", name_candidate)
        if dosage:
            name_candidate = re.sub(re.escape(dosage), " ", name_candidate, flags=re.IGNORECASE)
        name_candidate = self.re_dosage.sub(" ", name_candidate)
        name_candidate = self.re_frequency_pattern.sub(" ", name_candidate)
        name_candidate = self.re_abbrev_frequency.sub(" ", name_candidate)
        name_candidate = self.re_instructions.sub(" ", name_candidate)
        if scheduled_time:
            name_candidate = re.sub(re.escape(scheduled_time), " ", name_candidate, flags=re.IGNORECASE)
        if duration:
            name_candidate = re.sub(re.escape(duration), " ", name_candidate, flags=re.IGNORECASE)
        name_candidate = self.re_duration.sub(" ", name_candidate)

        # Clean remaining characters
        clean_name = re.sub(r"[^\w\s\-\+]", " ", name_candidate).strip()
        clean_name = re.sub(r"\s+", " ", clean_name).strip()
        name_tokens = [t for t in clean_name.split() if not t.isdigit() and len(t) >= 2]

        if not name_tokens and not strength and not dosage and not frequency:
            return None

        candidate_name = " ".join(name_tokens[:3]).strip() if name_tokens else ""

        # 8. Strict Medicine Database Validation (Zero Hallucination)
        best_match, db_score = self.validator.find_best_match(candidate_name) if candidate_name else (None, 0.0)

        if best_match and db_score >= 0.74:
            verified_name = best_match.title()
            is_verified = True
        else:
            # Unverified / unreadable handwriting -> None (Never fabricate a medicine!)
            verified_name = None
            db_score = 0.0
            is_verified = False

        # If name cannot be verified AND no strength, dosage, or frequency is found,
        # then this is NOT a medication line. Drop it completely!
        if not is_verified and not strength and not dosage and not frequency:
            return None

        # 9. Multi-Factor Confidence Fusion
        has_strength = bool(strength is not None)
        has_frequency = bool(frequency is not None)
        has_dosage = bool(dosage is not None)

        fused_conf, requires_review = self.confidence_engine.calculate_medicine_confidence(
            ocr_confidence=line_confidence,
            layout_confidence=0.92,
            db_match_score=db_score,
            has_strength=has_strength,
            has_frequency=has_frequency,
            has_dosage=has_dosage,
            is_handwritten=False,
        )

        if not is_verified:
            requires_review = True

        # 10. Construct Evidence Objects for Every Field
        evidence = []
        if verified_name:
            evidence.append({
                "field": "name",
                "value": verified_name,
                "source_text": raw_clean,
                "bbox": bbox,
                "ocr_confidence": round(line_confidence, 4),
                "region_confidence": 0.95,
                "validation_confidence": round(db_score, 4),
            })
        if strength:
            evidence.append({
                "field": "strength",
                "value": strength,
                "source_text": raw_clean,
                "bbox": bbox,
                "ocr_confidence": round(line_confidence, 4),
                "region_confidence": 0.95,
                "validation_confidence": 0.95,
            })
        if dosage:
            evidence.append({
                "field": "dosage",
                "value": dosage,
                "source_text": raw_clean,
                "bbox": bbox,
                "ocr_confidence": round(line_confidence, 4),
                "region_confidence": 0.95,
                "validation_confidence": 0.95,
            })
        if frequency:
            evidence.append({
                "field": "frequency",
                "value": frequency,
                "source_text": raw_clean,
                "bbox": bbox,
                "ocr_confidence": round(line_confidence, 4),
                "region_confidence": 0.95,
                "validation_confidence": 0.95,
            })
        if instructions:
            evidence.append({
                "field": "food_instruction",
                "value": instructions,
                "source_text": raw_clean,
                "bbox": bbox,
                "ocr_confidence": round(line_confidence, 4),
                "region_confidence": 0.95,
                "validation_confidence": 0.95,
            })
        if scheduled_time:
            evidence.append({
                "field": "scheduled_time",
                "value": scheduled_time,
                "source_text": raw_clean,
                "bbox": bbox,
                "ocr_confidence": round(line_confidence, 4),
                "region_confidence": 0.95,
                "validation_confidence": 0.95,
            })

        return {
            "name": verified_name,
            "strength": strength,
            "dosage": dosage,
            "frequency": frequency,
            "route": route,
            "duration": duration,
            "scheduled_time": scheduled_time,
            "food_instruction": instructions,
            "instructions": instructions,  # backwards compatibility
            "confidence": fused_conf,
            "requires_review": bool(requires_review),
            "type": med_type,
            "raw_text": raw_clean,
            "evidence": evidence,
        }

    def extract_structured_prescription(
        self, regions: List[OCRRegion]
    ) -> Dict[str, Any]:
        """
        Full structured extraction with layout segmentation.
        Guarantees that patient details, advice, and clinical notes are NEVER treated as medicines.
        """
        if not regions:
            return {
                "patient": {"name": None, "age": None, "gender": None, "id": None},
                "date": None,
                "clinical_notes": [],
                "diagnosis": [],
                "vitals": [],
                "medications": [],
                "iv_fluids": [],
                "advice": [],
                "follow_up": [],
                "overall_confidence": 0.0,
                "requires_review": True,
            }

        grouped_lines = self.group_regions_into_lines(regions)
        line_texts: List[str] = []
        line_confidences: List[float] = []

        for grp in grouped_lines:
            text = " ".join(r.text for r in grp).strip()
            conf = float(np.mean([r.confidence for r in grp])) if grp else 0.5
            line_texts.append(text)
            line_confidences.append(conf)

        # 1. Document Layout Analysis
        layout_result = self.layout_analyzer.analyze_document_lines(line_texts)
        classified_lines = layout_result["classified_lines"]

        patient_info = layout_result["patient"]
        date_val = layout_result["date"]
        clinical_notes = layout_result["clinical_notes"]
        diagnosis = layout_result["diagnosis"]
        vitals = layout_result["vitals"]
        iv_fluids = layout_result["iv_fluids"]
        advice = layout_result["advice"]
        follow_up = layout_result["follow_up"]

        # 2. Extract medications ONLY from lines classified as MEDICATION or IV_FLUID
        # Patient info, clinical notes, advice lines are STRICTLY EXCLUDED!
        validated_medications: List[Dict[str, Any]] = []

        for idx, c_line in enumerate(classified_lines):
            # STRICT FILTER: Never process patient info, vitals, etc. as medications
            if c_line.category in (
                RegionCategory.PATIENT_INFO,
                RegionCategory.CLINIC_HEADER,
                RegionCategory.DOCTOR_INFO,
                RegionCategory.CLINICAL_NOTES,
                RegionCategory.DIAGNOSIS,
                RegionCategory.VITALS,
                RegionCategory.FOLLOW_UP,
                RegionCategory.DATE,
            ):
                continue

            # For IV_FLUID and ADVICE lines: only process if they contain a validated medicine
            # (e.g. Dextrose, ORS, Ringer Lactate). Pure advice like "drink water" is skipped.
            is_treatment_line = c_line.category in (RegionCategory.IV_FLUID, RegionCategory.ADVICE)

            # Process candidate line
            line_conf = line_confidences[idx] if idx < len(line_confidences) else 0.5
            line_bbox = None
            if idx < len(grouped_lines) and grouped_lines[idx]:
                all_boxes = [r.box for r in grouped_lines[idx]]
                min_x = min(min(pt[0] for pt in b) for b in all_boxes)
                min_y = min(min(pt[1] for pt in b) for b in all_boxes)
                max_x = max(max(pt[0] for pt in b) for b in all_boxes)
                max_y = max(max(pt[1] for pt in b) for b in all_boxes)
                line_bbox = [round(min_x, 1), round(min_y, 1), round(max_x, 1), round(max_y, 1)]

            med = self.parse_medication_line(c_line.text, line_conf, bbox=line_bbox)

            # Accept only if it contains a verified medicine OR legitimate clinical prescription structure
            if med:
                # Discard if name is None and no clinical markers
                if med["name"] is None and med["strength"] is None and med["frequency"] is None and med["dosage"] is None:
                    continue

                # For treatment lines (IV_FLUID/ADVICE), ONLY accept if a real medicine was validated
                if is_treatment_line and med["name"] is None:
                    continue

                # Tag treatment lines with appropriate type and route
                if is_treatment_line and c_line.category == RegionCategory.IV_FLUID:
                    if med.get("type") == "tablet":
                        med["type"] = "injection"
                    if med.get("route") == "oral":
                        med["route"] = "iv"

                validated_medications.append(med)

        # 3. Overall Document Confidence
        med_confs = [m["confidence"] for m in validated_medications]
        doc_conf = self.confidence_engine.calculate_document_confidence(
            medicine_confidences=med_confs,
            quality_score=0.95,
            has_patient_info=bool(patient_info.get("name")),
        )

        requires_review = any(m["requires_review"] for m in validated_medications) or (len(validated_medications) == 0)

        full_text = " \n ".join(line_texts)

        return {
            "patient": patient_info,
            "date": date_val,
            "clinical_notes": clinical_notes,
            "diagnosis": diagnosis,
            "vitals": vitals,
            "medications": validated_medications,
            "iv_fluids": iv_fluids,
            "advice": advice,
            "follow_up": follow_up,
            "overall_confidence": doc_conf,
            "requires_review": bool(requires_review),
            "full_text": full_text,
        }
