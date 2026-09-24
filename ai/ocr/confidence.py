"""
SmartMed AI - Multi-Factor Confidence Fusion Engine
Combines:
1. OCR Recognition Confidence
2. Document Layout & Region Classification Score
3. Handwriting vs. Printed Clarity Score
4. Medicine Database (WHO EML) Verification Score
5. Clinical Field Completeness & Consistency Score
Ensures reported confidence values reflect true medical validity, not raw OCR token confidence.
"""

import logging
from typing import Dict, Any, Tuple, Optional

logger = logging.getLogger("smartmed.ocr.confidence")


class ConfidenceFusionEngine:
    """
    Computes a mathematically grounded combined confidence score
    and determines if human-in-the-loop review is required.
    """

    def __init__(self, review_threshold: float = 0.85):
        self.review_threshold = review_threshold

    def calculate_medicine_confidence(
        self,
        ocr_confidence: float,
        layout_confidence: float,
        db_match_score: float,
        has_strength: bool,
        has_frequency: bool,
        has_dosage: bool,
        is_handwritten: bool = False,
    ) -> Tuple[float, bool]:
        """
        Calculates fused confidence for a single medication candidate.
        Returns: (fused_confidence: float [0.0 to 1.0], requires_review: bool)
        """
        # 1. Zero-Hallucination Gatekeeper:
        # If candidate text has ZERO match in WHO EML or medicine database,
        # it CANNOT be certified as a valid medicine.
        if db_match_score < 0.70:
            # Drop confidence severely and mandate human review
            fused = round(min(0.45, ocr_confidence * 0.40), 2)
            return fused, True

        # 2. Clinical Field Completeness (0.0 to 1.0)
        completeness = 0.0
        if has_strength:
            completeness += 0.45
        if has_frequency:
            completeness += 0.35
        if has_dosage:
            completeness += 0.20

        # 3. Weighted Multi-Factor Fusion
        # OCR recognition weight: 35%
        # Medical Database validation weight: 40%
        # Layout section weight: 15%
        # Clinical completeness weight: 10%
        fused = (
            (ocr_confidence * 0.35)
            + (db_match_score * 0.40)
            + (layout_confidence * 0.15)
            + (completeness * 0.10)
        )

        # Slight adjustment for noisy handwriting to ensure safe human review
        if is_handwritten and fused < 0.90:
            fused *= 0.95

        fused = round(min(0.99, max(0.10, fused)), 2)
        requires_review = fused < self.review_threshold or completeness < 0.50

        return fused, bool(requires_review)

    def calculate_document_confidence(
        self,
        medicine_confidences: list,
        quality_score: float,
        has_patient_info: bool,
    ) -> float:
        """
        Calculates overall document extraction confidence.
        """
        if not medicine_confidences:
            return round(max(0.20, quality_score * 0.5), 2)

        avg_med = sum(medicine_confidences) / len(medicine_confidences)
        doc_score = (avg_med * 0.70) + (quality_score * 0.20) + (0.10 if has_patient_info else 0.0)
        return round(min(0.99, max(0.20, doc_score)), 2)
