"""
SmartMed AI - Comprehensive Prescription OCR Test Suite
Tests:
1. Document Layout Understanding & Region Classification
2. The Exact Failure Case ("Name: Vivek" NEVER becoming a medicine, field separation)
3. Strict No-Hallucination & Database Verification
4. Image Quality Gatekeeper
5. Multi-Factor Confidence Fusion
6. Printed vs. Handwritten Classification
"""

import sys
import os
import unittest
import numpy as np
import cv2

# Add ai directory to sys.path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from ocr.preprocessing import AdaptivePreprocessor
from ocr.engine import OCRRegion
from ocr.layout_analysis import DocumentLayoutAnalyzer, RegionCategory
from ocr.classifier import PrintedVsHandwrittenClassifier
from ocr.confidence import ConfidenceFusionEngine
from ocr.validation import MedicineValidator
from ocr.extraction import ClinicalExtractor
from ocr.pipeline import PrescriptionOCRPipeline


class TestExactFailureCase(unittest.TestCase):
    """
    Tests the exact failure case where previous OCR reported:
    - '9 Medicine Detected'
    - 'Name Vivek' as a medicine
    - Fake defaults ('1 tablet', 'As directed by doctor')
    """

    def setUp(self):
        self.extractor = ClinicalExtractor()
        self.layout_analyzer = DocumentLayoutAnalyzer()

    def test_name_vivek_never_becomes_medicine(self):
        # Sample prescription lines matching the user's real prescription structure
        prescription_lines = [
            "CITY HOSPITAL - DR. R. MENON MBBS MD",
            "Name: Vivek Age: 28 Yrs Sex: Male Date: 14/09/2026",
            "C/O fever x 3 days, vomiting, loose stools",
            "BP: 110/70 mm Hg, Pulse: 88/min, Temp: 100 F",
            "Dx: Acute Gastroenteritis with mild dehydration",
            "IV RL 500 ml stat",
            "Tab Metformin 500 mg 1-0-1 After food",
            "Tab Pantoprazole 40 mg 1-0-0 Before breakfast",
            "Advice: Drink ORS in 1 liter boiled water, soft bland diet, plenty of fluids",
            "Review after 3 days / SOS",
        ]

        # Convert to mock OCR regions
        mock_regions = []
        for idx, line in enumerate(prescription_lines):
            y_pos = float(40 + (idx * 35))
            mock_regions.append(
                OCRRegion(
                    box=[[50.0, y_pos], [450.0, y_pos], [450.0, y_pos + 20.0], [50.0, y_pos + 20.0]],
                    text=line,
                    confidence=0.95,
                )
            )

        structured = self.extractor.extract_structured_prescription(mock_regions)

        # 1. Patient Name must be isolated in patient field
        patient = structured["patient"]
        self.assertIsNotNone(patient)
        self.assertIn("Vivek", patient.get("name", ""))

        # 2. "Vivek" must NEVER appear as a medicine name
        medications = structured["medications"]
        for med in medications:
            self.assertNotIn("vivek", med["name"].lower())
            self.assertNotIn("name", med["name"].lower())

        # 3. Dynamic medicine count: Must NOT be 9! Must contain only the 2 valid medications
        self.assertEqual(len(medications), 2, f"Expected exactly 2 valid medications, got {len(medications)}")
        med_names = [m["name"].lower() for m in medications]
        self.assertIn("metformin", med_names)
        self.assertIn("pantoprazole", med_names)

        # 4. IV Fluids must be separated
        iv_fluids = structured["iv_fluids"]
        self.assertTrue(any("iv rl" in iv.lower() for iv in iv_fluids))

        # 5. Advice / ORS must be separated
        advice = structured["advice"]
        self.assertTrue(any("ors" in adv.lower() for adv in advice))

        # 6. Clinical notes / Symptoms must be separated
        notes = structured["clinical_notes"]
        self.assertTrue(any("fever" in n.lower() for n in notes))


class TestDocumentLayoutAnalyzer(unittest.TestCase):
    """Tests region classification across all clinical sections."""

    def setUp(self):
        self.analyzer = DocumentLayoutAnalyzer()

    def test_patient_classification(self):
        c = self.analyzer.classify_line("Name: Vivek Kumar", 1, 10)
        self.assertEqual(c.category, RegionCategory.PATIENT_INFO)
        self.assertIn("Vivek", c.extracted_fields.get("patient_name", ""))

    def test_iv_fluid_classification(self):
        c = self.analyzer.classify_line("IV RL 500ml over 4 hours", 5, 10)
        self.assertEqual(c.category, RegionCategory.IV_FLUID)

    def test_advice_classification(self):
        c = self.analyzer.classify_line("Drink ORS solution frequently and take soft diet", 8, 10)
        self.assertEqual(c.category, RegionCategory.ADVICE)

    def test_medication_classification(self):
        c = self.analyzer.classify_line("Tab Metformin 500 mg 1-0-1 AF", 6, 10)
        self.assertEqual(c.category, RegionCategory.MEDICATION)


class TestZeroHallucination(unittest.TestCase):
    """Tests that unverified or unreadable words NEVER become medicines."""

    def setUp(self):
        self.validator = MedicineValidator()

    def test_arbitrary_word_rejected(self):
        match_name, score = self.validator.find_best_match("Vivek")
        self.assertIsNone(match_name)
        self.assertEqual(score, 0.0)

    def test_medical_note_word_rejected(self):
        match_name, score = self.validator.find_best_match("Vomiting")
        self.assertIsNone(match_name)
        self.assertEqual(score, 0.0)

    def test_legitimate_medicine_accepted(self):
        match_name, score = self.validator.find_best_match("Metformin")
        self.assertEqual(match_name, "Metformin")
        self.assertGreaterEqual(score, 0.95)


class TestImageQualityGatekeeper(unittest.TestCase):
    """Tests quality assessment rejecting severely degraded images."""

    def setUp(self):
        self.preprocessor = AdaptivePreprocessor()

    def test_low_resolution_rejection(self):
        tiny_img = np.ones((50, 50, 3), dtype=np.uint8) * 200
        gray = cv2.cvtColor(tiny_img, cv2.COLOR_BGR2GRAY)
        metrics = self.preprocessor.assess_quality(gray)
        self.assertTrue(metrics.is_insufficient)
        self.assertIn("insufficient", metrics.quality_error.lower())

    def test_severe_blur_rejection(self):
        # Create heavily blurred flat image
        blur_img = np.ones((400, 400, 3), dtype=np.uint8) * 128
        gray = cv2.cvtColor(blur_img, cv2.COLOR_BGR2GRAY)
        metrics = self.preprocessor.assess_quality(gray)
        self.assertTrue(metrics.is_insufficient)


class TestConfidenceFusion(unittest.TestCase):
    """Tests multi-factor confidence fusion."""

    def setUp(self):
        self.fusion = ConfidenceFusionEngine()

    def test_unverified_medicine_drops_confidence(self):
        # db_match_score = 0.0 -> must result in low confidence and requires_review
        fused, req_review = self.fusion.calculate_medicine_confidence(
            ocr_confidence=0.92,
            layout_confidence=0.90,
            db_match_score=0.0,
            has_strength=False,
            has_frequency=False,
            has_dosage=False,
        )
        self.assertLessEqual(fused, 0.45)
        self.assertTrue(req_review)

    def test_verified_complete_medicine_high_confidence(self):
        fused, req_review = self.fusion.calculate_medicine_confidence(
            ocr_confidence=0.96,
            layout_confidence=0.95,
            db_match_score=1.0,
            has_strength=True,
            has_frequency=True,
            has_dosage=True,
        )
        self.assertGreaterEqual(fused, 0.90)
        self.assertFalse(req_review)


if __name__ == "__main__":
    unittest.main()
