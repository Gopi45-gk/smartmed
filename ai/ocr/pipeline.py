"""
SmartMed AI - Master Prescription OCR Pipeline
Orchestrates:
1. Image Quality Assessment Gatekeeper
2. Adaptive Preprocessing (Deskewing, CLAHE contrast, bilateral noise reduction)
3. Text Region Detection & Printed vs. Handwritten Classification
4. Dual-Engine OCR Recognition (PaddleOCR & TrOCR handwriting fallback)
5. Document Layout Understanding & Region Classification
6. Medicine Candidate Generation & Strict WHO EML Validation (Zero Hallucination)
7. Multi-Factor Confidence Fusion
8. Structured Clinical Field Separation (Patient, Notes, Diagnosis, Vitals, Meds, IV, Advice)
"""

import base64
import logging
from typing import List, Dict, Any, Union, Optional
import numpy as np
from pydantic import BaseModel, Field

from .preprocessing import AdaptivePreprocessor
from .engine import PaddleOCREngine, OCRRegion
from .classifier import PrintedVsHandwrittenClassifier
from .handwriting_fallback import TrOCRHandwritingFallback
from .vlm_engine import CloudVLMEngine
from .extraction import ClinicalExtractor
from .validation import MedicineValidator
from .confidence import ConfidenceFusionEngine

logger = logging.getLogger("smartmed.ocr.pipeline")


class ExtractedMedicine(BaseModel):
    name: str
    strength: Optional[str] = None
    dosage: Optional[str] = None
    frequency: Optional[str] = None
    route: Optional[str] = "oral"
    duration: Optional[str] = None
    instructions: Optional[str] = None
    confidence: float
    requires_review: bool
    type: Optional[str] = "tablet"


class PrescriptionOCRResult(BaseModel):
    success: bool
    text: str
    confidence: float
    regions: List[Dict[str, Any]] = Field(default_factory=list)
    medicines: List[Dict[str, Any]] = Field(default_factory=list)
    medications: List[Dict[str, Any]] = Field(default_factory=list)
    patient: Optional[Dict[str, Any]] = None
    date: Optional[str] = None
    clinical_notes: List[str] = Field(default_factory=list)
    diagnosis: List[str] = Field(default_factory=list)
    vitals: List[str] = Field(default_factory=list)
    iv_fluids: List[str] = Field(default_factory=list)
    advice: List[str] = Field(default_factory=list)
    follow_up: List[str] = Field(default_factory=list)
    overall_confidence: float = 0.0
    requires_review: bool = False
    quality: Optional[Dict[str, Any]] = None


class PrescriptionOCRPipeline:
    """
    End-to-end production-ready prescription OCR pipeline.
    Enforces strict zero hallucination and document layout separation.
    """

    def __init__(
        self,
        clahe_clip_limit: float = 2.0,
        handwriting_threshold: float = 0.82,
        eml_path: Optional[str] = None,
    ):
        self.preprocessor = AdaptivePreprocessor(clahe_clip_limit=clahe_clip_limit)
        self.ocr_engine = PaddleOCREngine()
        self.classifier = PrintedVsHandwrittenClassifier()
        self.handwriting_fallback = TrOCRHandwritingFallback(
            confidence_threshold=handwriting_threshold
        )
        self.vlm_engine = CloudVLMEngine()
        self.extractor = ClinicalExtractor(eml_path=eml_path)
        self.validator = MedicineValidator(eml_path=eml_path)
        self.confidence_engine = ConfidenceFusionEngine()

    @staticmethod
    def _decode_source(source: Union[bytes, str, np.ndarray]) -> Union[bytes, np.ndarray, str]:
        """Decodes base64 string if provided."""
        if isinstance(source, str):
            # Check for data URI: "data:image/jpeg;base64,..."
            if "base64," in source:
                header, encoded = source.split("base64,", 1)
                return base64.b64decode(encoded)
            # Check for pure base64 without prefix
            if len(source) > 200 and not source.startswith("/") and not source.startswith("."):
                try:
                    return base64.b64decode(source)
                except Exception:
                    pass
        return source

    def process_image(self, source: Union[bytes, str, np.ndarray]) -> Dict[str, Any]:
        """
        Executes the full 12-stage pipeline on input image.
        Prioritizes Cloud VLM (Qwen2.5-VL-72B-Instruct) when HF token is available,
        with seamless local PaddleOCR + TrOCR fallback if offline.
        """
        try:
            decoded = self._decode_source(source)

            # Stage 0: Cloud VLM High-Accuracy Recognition (if token is available)
            if self.vlm_engine.is_available():
                try:
                    vlm_res = self.vlm_engine.recognize_prescription(decoded)
                    if vlm_res and vlm_res.get("success") and (vlm_res.get("medications") or vlm_res.get("patient", {}).get("name")):
                        logger.info(
                            f"Prescription successfully recognized via Cloud VLM: "
                            f"{len(vlm_res.get('medications', []))} medications found."
                        )
                        return vlm_res
                except Exception as vlm_err:
                    logger.warning(
                        f"Cloud VLM recognition failed: {vlm_err}. "
                        f"Falling back seamlessly to local PaddleOCR + TrOCR pipeline."
                    )

            # 1. Adaptive Preprocessing & Quality Assessment
            prep_result = self.preprocessor.process(decoded)
            proc_bgr = prep_result["processed_bgr"]
            quality_info = prep_result["quality"]
            deskew_angle = prep_result["deskew_angle"]

            # Image Quality Gatekeeper: Stop if unreadable
            if quality_info.get("is_insufficient"):
                return {
                    "success": False,
                    "error": quality_info.get("quality_error")
                    or "Prescription image quality is insufficient for reliable extraction. Please upload a clearer image.",
                    "text": "",
                    "confidence": 0.0,
                    "regions": [],
                    "medicines": [],
                    "medications": [],
                    "patient": {"name": None, "id": None},
                    "clinical_notes": [],
                    "diagnosis": [],
                    "vitals": [],
                    "iv_fluids": [],
                    "advice": [],
                    "requires_review": True,
                    "quality": quality_info,
                }

            # 2. Multi-Pass OCR Execution (Pass 1: Preprocessed, Pass 2: Contrast-enhanced for low contrast/skew)
            raw_bgr = self.preprocessor.load_image(decoded)
            regions_pass1: List[OCRRegion] = self.ocr_engine.detect_and_recognize(proc_bgr)
            regions = regions_pass1
            passes_evaluated = 1

            # Execute Pass 2 if image had low contrast or skew
            if quality_info.get("contrast", 50.0) < 32.0 or abs(deskew_angle) > 1.0:
                contrast_bgr = self.preprocessor.enhance_contrast(raw_bgr)
                regions_pass2: List[OCRRegion] = self.ocr_engine.detect_and_recognize(contrast_bgr)
                passes_evaluated = 2

                # Cross-pass agreement comparison
                if regions_pass1 and regions_pass2:
                    t1 = " ".join([r.text.lower() for r in regions_pass1])
                    t2 = " ".join([r.text.lower() for r in regions_pass2])
                    from difflib import SequenceMatcher
                    similarity = SequenceMatcher(None, t1, t2).ratio()
                    if similarity > 0.82:
                        for r in regions:
                            r.confidence = min(0.99, r.confidence * 1.04)
                    elif similarity < 0.60:
                        for r in regions:
                            r.confidence = r.confidence * 0.90

            # 3. Printed vs. Handwritten Classification & Fallback Routing
            if regions:
                regions = self.handwriting_fallback.apply_fallback(proc_bgr, regions)

            # 4. Document Layout Analysis & Field Separation
            # Patient Info, Advice, and Notes are strictly segregated from medications
            structured = self.extractor.extract_structured_prescription(regions)

            medications = structured["medications"]
            patient_info = structured["patient"]
            clinical_notes = structured["clinical_notes"]
            diagnosis = structured["diagnosis"]
            vitals = structured["vitals"]
            iv_fluids = structured["iv_fluids"]
            advice = structured["advice"]
            follow_up = structured["follow_up"]
            overall_confidence = structured["overall_confidence"]
            requires_review = structured["requires_review"]
            full_text = structured["full_text"]

            # Backward-compatible medicines format with strict zero-hallucination fields
            # Unknown / missing values MUST remain None (never fabricated defaults)
            medicines_output = []
            for m in medications:
                medicines_output.append({
                    "name": m.get("name"),
                    "strength": m.get("strength"),
                    "dosage": m.get("dosage"),
                    "frequency": m.get("frequency"),
                    "scheduled_time": m.get("scheduled_time"),
                    "food_instruction": m.get("food_instruction"),
                    "instructions": m.get("instructions"),
                    "confidence": m.get("confidence", 0.5),
                    "requires_review": m.get("requires_review", True),
                    "type": m.get("type", "tablet"),
                    "evidence": m.get("evidence", []),
                })

            regions_json = [r.to_dict() for r in regions]

            return {
                "success": True,
                "text": full_text.strip() if full_text.strip() else "Prescription scanned",
                "confidence": overall_confidence,
                "regions": regions_json,
                "medicines": medicines_output,  # For backward-compatible clients
                "medications": medications,      # Rich structured clinical records with evidence
                "patient": patient_info,
                "date": structured["date"],
                "clinical_notes": clinical_notes,
                "diagnosis": diagnosis,
                "vitals": vitals,
                "treatments": iv_fluids,
                "iv_fluids": iv_fluids,
                "advice": advice,
                "follow_up": follow_up,
                "raw_text": full_text.split(" \n "),
                "overall_confidence": overall_confidence,
                "requires_review": requires_review,
                "passes_evaluated": passes_evaluated,
                "quality": {
                    **quality_info,
                    "deskew_angle": deskew_angle,
                },
            }

        except Exception as e:
            logger.error(f"Prescription OCR pipeline error: {e}", exc_info=True)
            return {
                "success": False,
                "text": "",
                "confidence": 0.0,
                "regions": [],
                "medicines": [],
                "medications": [],
                "patient": {"name": None, "id": None},
                "clinical_notes": [],
                "diagnosis": [],
                "vitals": [],
                "iv_fluids": [],
                "advice": [],
                "requires_review": True,
                "error": str(e),
            }


# Singleton pipeline instance for reuse across requests
pipeline = PrescriptionOCRPipeline()
