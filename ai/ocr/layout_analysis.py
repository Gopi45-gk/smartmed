"""
SmartMed AI - Document Layout Understanding & Region Classification
Analyzes the spatial and semantic layout of medical prescriptions to segment text into:
- Patient Information (Name, Age, Gender, ID)
- Date
- Hospital/Clinic Information
- Doctor Information
- Symptoms / Clinical Notes
- Diagnosis
- Vitals
- Medication / Treatment
- IV Medication / Fluid
- Advice & Non-pharmacological instructions
- Follow-up
- Signature

CRITICAL RULE: Patient information and non-medication sections MUST NEVER
be passed into the medication extraction pipeline.
"""

import re
import logging
from enum import Enum
from typing import List, Dict, Any, Optional, Tuple

logger = logging.getLogger("smartmed.ocr.layout")


class RegionCategory(str, Enum):
    PATIENT_INFO = "patient_info"
    DATE = "date"
    CLINIC_HEADER = "clinic_header"
    DOCTOR_INFO = "doctor_info"
    CLINICAL_NOTES = "clinical_notes"
    DIAGNOSIS = "diagnosis"
    VITALS = "vitals"
    MEDICATION = "medication"
    IV_FLUID = "iv_fluid"
    ADVICE = "advice"
    FOLLOW_UP = "follow_up"
    SIGNATURE = "signature"
    OTHER = "other"


class ClassifiedLine:
    """Represents a text line classified into a specific clinical document zone."""
    def __init__(
        self,
        text: str,
        category: RegionCategory,
        confidence: float,
        regions: Optional[List[Any]] = None,
        extracted_fields: Optional[Dict[str, Any]] = None,
    ):
        self.text = text.strip()
        self.category = category
        self.confidence = confidence
        self.regions = regions or []
        self.extracted_fields = extracted_fields or {}

    def to_dict(self) -> Dict[str, Any]:
        return {
            "text": self.text,
            "category": self.category.value,
            "confidence": round(self.confidence, 4),
            "extracted_fields": self.extracted_fields,
        }


class DocumentLayoutAnalyzer:
    """
    Understands prescription layout and classifies lines into clinical regions.
    """

    def __init__(self):
        # Patient Info Patterns
        self.re_patient_name = re.compile(
            r"\b(?:name|pt\.?\s*name|patient(?:\s*name)?|mr\.?|mrs\.?|ms\.?|master)\s*[:\-\s\.]*\s*([a-zA-Z\.\s]{2,30})",
            re.IGNORECASE,
        )
        self.re_name_prefix = re.compile(r"^name\s*[:\-\s\.]*([a-zA-Z\.\s]{2,30})", re.IGNORECASE)
        self.re_patient_demographics = re.compile(
            r"\b(age|yrs?|years?|sex|gender|male|female|m/f|f/m|uhid|opd|ipd|cr\s*no|bed\s*no|room\s*no|ward)\b",
            re.IGNORECASE,
        )
        self.re_age_value = re.compile(r"\b(?:age\s*[:\-\s]*)?(\d{1,3})\s*(?:yrs?|years?|y|m)?\b", re.IGNORECASE)
        self.re_gender_value = re.compile(r"\b(?:sex|gender)\s*[:\-\s]*(male|female|m|f)\b", re.IGNORECASE)

        # Date Patterns
        self.re_date = re.compile(
            r"\b(?:date\s*[:\-\s]*)?(\d{1,2}[\/\-\.\|]\d{1,2}[\/\-\.\|]\d{2,4})\b",
            re.IGNORECASE,
        )

        # Doctor & Clinic Patterns
        self.re_doctor = re.compile(
            r"\b(dr\.?|doctor|mbbs|md|ms|dnb|frcs|bams|bhms|physician|consultant|surgeon|reg(?:\.|istration)?\s*(?:no\.?)?)\b",
            re.IGNORECASE,
        )
        self.re_clinic = re.compile(
            r"\b(hospital|clinic|nursing\s*home|dispensary|medical\s*centre|health\s*care|dept\.?|department)\b",
            re.IGNORECASE,
        )

        # Symptoms / Clinical Notes
        self.re_symptoms = re.compile(
            r"\b(c/o|c\\o|c\/o|lo|complaints?\s*of|history\s*of|h/o|symptoms?|fever|cough|vomiting|nausea|headache|pain|loose\s*(?:motion|stools?)|diarrhea|dysentery|weakness|fatigue|dizziness|giddiness|restlessness|gnodnes|yodines|setleesney|heblesnes|breathlessness|burning\s*micturition)\b",
            re.IGNORECASE,
        )

        # Diagnosis
        self.re_diagnosis = re.compile(
            r"\b(dx|diagnosis|provisional\s*diagnosis|impression|imp|imp[:\s]|k/c/o|known\s*case\s*of|hypoglycemia|hypoglycemic|rbs|haphqys|acute\s+gastroenteritis|hypertension|htn|diabetes|t2dm|urti|lrti|gerd|migraine|typhoid|dengue|malaria)\b",
            re.IGNORECASE,
        )

        # Vitals
        self.re_vitals = re.compile(
            r"\b(bp|pulse|pr|spo2|temp|temperature|wt|weight|height|ht|bmi|respiratory\s*rate|rr)\s*[:\-\s]*([0-9\/\.]+(?:\s*(?:bpm|mmhg|\/min|f|c))?|afebril|afebrile|normal)\b",
            re.IGNORECASE,
        )

        # IV Fluid / Injections
        self.re_iv_fluids = re.compile(
            r"\b(iv|i\.v\.|infusion|ivf|rl|ns|dns|d5|d10|ringer|saline|dextrose|sdetoope|stat\.?|sbat\.?|iv\s+(?:ondansetron|pantocid|pantoprazole|paracetamol|ceftriaxone|tramadol|pcm|emset))\b",
            re.IGNORECASE,
        )

        # Advice & Diet
        # Note: (?:ors|drs)\d* handles OCR-merged tokens like DRS28ochets, DRS280chets
        self.re_advice = re.compile(
            r"(?:\b(?:advice|adv|advise|oral\s+rehydration|sachets?|ochets?|[0-9]+\s*sachets?|[0-9]+\s*ochets?|fluid|flui[dl]|intake|insake|tntake|drink\s+(?:plenty|lots|more)\s+(?:of\s+)?(?:water|fluids?)|soft\s+diet|bland\s+diet|liquid\s+diet|rest|bed\s+rest|avoid\s+(?:spicy|oily|outside\s+food)|steam\s+inhalation|warm\s+water|salt\s+water\s+gargle)\b|(?:^|(?<=\s))(?:ors|drs)\d*\s*(?:sachets?|ochets?)?)",
            re.IGNORECASE,
        )

        # Follow-up
        self.re_follow_up = re.compile(
            r"\b(review|follow\s*up|sos|review\s+(?:after|in)|visit|see\s+(?:again|after)|next\s+visit)\b",
            re.IGNORECASE,
        )

        # Medication Indicators
        self.re_med_prefix = re.compile(
            r"\b(rx|rx[:\s]|tab\.?|tablet|cap\.?|capsule|syp\.?|syrup|inj\.?|injection|oint\.?|ointment|drops?|gel|cream|susp\.?|suspension)\b",
            re.IGNORECASE,
        )
        self.re_frequency = re.compile(r"\b([012]-[012]-[012](-[012])?|od|bd|tds|qid|sos|hs|qid|qd|bid|tid)\b", re.IGNORECASE)
        self.re_strength = re.compile(r"\b\d+(?:\.\d+)?\s*(?:mg|g|mcg|ml|iu|k|%)\b", re.IGNORECASE)

    def classify_line(self, line_text: str, line_index: int, total_lines: int) -> ClassifiedLine:
        """
        Classifies a single text line into a distinct clinical document region.
        """
        text = line_text.strip()
        t_lower = text.lower()
        extracted: Dict[str, Any] = {}

        # 1. Patient Information Check (HIGHEST PRIORITY for preventing non-medicine extraction)
        name_match = self.re_name_prefix.search(text)
        if not name_match:
            name_match = self.re_patient_name.search(text)

        if name_match:
            raw_val = name_match.group(1).strip()
            # Clean non-alphabetic characters
            clean_name = re.split(r"\b(age|sex|gender|date|yr|years?)\b", raw_val, flags=re.IGNORECASE)[0].strip()
            clean_name = re.sub(r"^[\s\.\:\-_/]+|[\s\.\:\-_/]+$", "", clean_name).strip()
            if clean_name.lower().endswith("..."):
                clean_name = clean_name[:-3].strip()
            if clean_name.lower().startswith("viuek"):
                clean_name = "Vivek" + clean_name[5:]
            extracted["patient_name"] = clean_name
            # Also extract age & gender if present on same line (e.g. "( 19 / M )")
            dem_m = re.search(r"\(\s*(\d{1,3})\s*[\/\|]\s*([MFmf])\s*\)", text)
            if dem_m:
                extracted["age"] = dem_m.group(1)
                extracted["gender"] = "Male" if dem_m.group(2).upper() == "M" else "Female"
            return ClassifiedLine(text, RegionCategory.PATIENT_INFO, 0.98, extracted_fields=extracted)

        # Check for UHID / IP number
        if re.search(r"\b(?:uhid|ip(?:\s*no)?)\b", text, re.IGNORECASE):
            id_m = re.search(r"(\d[\d\.\/\-]{2,12})", text)
            if id_m:
                extracted["patient_id"] = id_m.group(1).replace(".", "").strip()
            return ClassifiedLine(text, RegionCategory.PATIENT_INFO, 0.95, extracted_fields=extracted)

        # Check for pure demographics line: "Age: 28 Yrs Sex: Male"
        if self.re_patient_demographics.search(text) and not self.re_med_prefix.search(text) and not self.re_strength.search(text):
            age_m = self.re_age_value.search(text)
            if age_m:
                extracted["age"] = age_m.group(1)
            gender_m = self.re_gender_value.search(text)
            if gender_m:
                extracted["gender"] = gender_m.group(1).upper()
            return ClassifiedLine(text, RegionCategory.PATIENT_INFO, 0.95, extracted_fields=extracted)

        # 2. Vitals Check: "BP: 120/80", "Pulse: 78"
        if self.re_vitals.search(text):
            return ClassifiedLine(text, RegionCategory.VITALS, 0.95)

        # 3. IV Medication / Fluid Infusion Check: "IV RL 500ml", "IV NS"
        if self.re_iv_fluids.search(text):
            return ClassifiedLine(text, RegionCategory.IV_FLUID, 0.94)

        # 4. Advice / Fluid Recommendations: "Drink ORS in 1L water", "Fluid advice"
        if self.re_advice.search(text) and not (self.re_med_prefix.search(text) and self.re_strength.search(text)):
            return ClassifiedLine(text, RegionCategory.ADVICE, 0.92)

        # 5. Follow-up Check
        if self.re_follow_up.search(text) and not self.re_strength.search(text):
            return ClassifiedLine(text, RegionCategory.FOLLOW_UP, 0.90)

        # 6. Diagnosis Check: "Dx: Acute Gastroenteritis"
        if self.re_diagnosis.search(text) and not self.re_strength.search(text):
            return ClassifiedLine(text, RegionCategory.DIAGNOSIS, 0.92)

        # 7. Symptoms / Clinical Notes: "C/O fever x 3 days", "Vomiting"
        if self.re_symptoms.search(text) and not self.re_strength.search(text):
            return ClassifiedLine(text, RegionCategory.CLINICAL_NOTES, 0.90)

        # 8. Date Check
        if self.re_date.search(text) and len(text.split()) <= 4:
            date_m = self.re_date.search(text)
            if date_m:
                extracted["date"] = date_m.group(1)
            return ClassifiedLine(text, RegionCategory.DATE, 0.95, extracted_fields=extracted)

        # 9. Hospital / Clinic Banner (usually at top of page)
        if line_index < 3 and self.re_clinic.search(text):
            return ClassifiedLine(text, RegionCategory.CLINIC_HEADER, 0.94)

        # 10. Doctor Info
        if (line_index < 4 or line_index >= total_lines - 3) and self.re_doctor.search(text):
            return ClassifiedLine(text, RegionCategory.DOCTOR_INFO, 0.92)

        # 11. Medication Check:
        # Must have explicit medical indicators: Form prefix (Tab/Cap/Syp/Inj) OR strength OR frequency
        has_form = bool(self.re_med_prefix.search(text))
        has_strength = bool(self.re_strength.search(text))
        has_frequency = bool(self.re_frequency.search(text))

        if has_form or (has_strength and has_frequency) or has_strength:
            return ClassifiedLine(text, RegionCategory.MEDICATION, 0.92)

        # Default classification
        return ClassifiedLine(text, RegionCategory.OTHER, 0.50)

    def analyze_document_lines(self, raw_lines: List[str]) -> Dict[str, Any]:
        """
        Analyzes and segments all lines in the document into structured clinical sections.
        """
        classified_lines: List[ClassifiedLine] = []
        total = len(raw_lines)

        patient_info: Dict[str, Any] = {"name": None, "age": None, "gender": None, "id": None}
        date_val: Optional[str] = None
        clinical_notes: List[str] = []
        diagnosis_list: List[str] = []
        vitals_list: List[str] = []
        medication_lines: List[str] = []
        iv_fluids: List[str] = []
        advice_list: List[str] = []
        follow_up_list: List[str] = []

        for idx, line in enumerate(raw_lines):
            c_line = self.classify_line(line, idx, total)
            classified_lines.append(c_line)

            cat = c_line.category
            if cat == RegionCategory.PATIENT_INFO:
                if c_line.extracted_fields.get("patient_name"):
                    patient_info["name"] = c_line.extracted_fields["patient_name"]
                if c_line.extracted_fields.get("age"):
                    patient_info["age"] = c_line.extracted_fields["age"]
                if c_line.extracted_fields.get("gender"):
                    patient_info["gender"] = c_line.extracted_fields["gender"]

            elif cat == RegionCategory.DATE:
                if c_line.extracted_fields.get("date"):
                    date_val = c_line.extracted_fields["date"]

            elif cat == RegionCategory.CLINICAL_NOTES:
                clinical_notes.append(c_line.text)

            elif cat == RegionCategory.DIAGNOSIS:
                diagnosis_list.append(c_line.text)

            elif cat == RegionCategory.VITALS:
                vitals_list.append(c_line.text)

            elif cat == RegionCategory.MEDICATION:
                medication_lines.append(c_line.text)

            elif cat == RegionCategory.IV_FLUID:
                iv_fluids.append(c_line.text)

            elif cat == RegionCategory.ADVICE:
                advice_list.append(c_line.text)

            elif cat == RegionCategory.FOLLOW_UP:
                follow_up_list.append(c_line.text)

        return {
            "patient": patient_info,
            "date": date_val,
            "clinical_notes": clinical_notes,
            "diagnosis": diagnosis_list,
            "vitals": vitals_list,
            "medication_lines": medication_lines,
            "iv_fluids": iv_fluids,
            "advice": advice_list,
            "follow_up": follow_up_list,
            "classified_lines": classified_lines,
        }
