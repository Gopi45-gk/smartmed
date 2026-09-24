"""
SmartMed AI - Prescription OCR Package
Provides adaptive preprocessing, PaddleOCR text detection/recognition,
TrOCR handwriting fallback, clinical structuring, and WHO EML database validation.
"""

from .pipeline import PrescriptionOCRPipeline, PrescriptionOCRResult, ExtractedMedicine

__all__ = [
    "PrescriptionOCRPipeline",
    "PrescriptionOCRResult",
    "ExtractedMedicine",
]
