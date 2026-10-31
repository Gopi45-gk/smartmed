"""
SmartMed Clinical Intelligence: Lab Report Scan & Auto-Fill Router
Processes uploaded medical lab reports (JPEG, PNG, WebP, PDF) in-memory,
extracts text via the loaded OCR pipeline, and parses biomarker values
for automatic clinical risk calculation.
"""

import io
import os
import logging
from typing import Optional, Dict, Any, List
from fastapi import APIRouter, UploadFile, File, HTTPException
from pydantic import BaseModel

from lab_parser import parse_lab_report_text, PLAUSIBILITY_LIMITS

logger = logging.getLogger("smartmed.lab_scan")
router = APIRouter(prefix="/api/clinical", tags=["clinical-lab-scan"])

MAX_UPLOAD_SIZE = 8 * 1024 * 1024  # 8 MB


def validate_magic_bytes(data: bytes) -> str:
    """
    Validates file format by inspection of magic bytes (zero trust in extension).
    Returns normalized format string: 'jpeg', 'png', 'webp', 'pdf', 'tiff'.
    Raises ValueError if unsupported.
    """
    if len(data) < 12:
        raise ValueError("File content is too small or truncated.")

    if data[:3] == b"\xff\xd8\xff":
        return "jpeg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "png"
    if data[:4] == b"%PDF":
        return "pdf"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    if data[:4] in (b"II*\x00", b"MM\x00*"):
        return "tiff"

    raise ValueError("Invalid file signature. Supported formats: JPEG, PNG, WebP, PDF.")


def render_pdf_first_page(pdf_bytes: bytes) -> bytes:
    """Renders the first page of a PDF document to JPEG bytes in-memory."""
    try:
        import pypdfium2 as pdfium
        pdf = pdfium.PdfDocument(pdf_bytes)
        if len(pdf) == 0:
            raise ValueError("PDF document has 0 pages.")
        page = pdf[0]
        pil_img = page.render(scale=2.0).to_pil()
        out_buf = io.BytesIO()
        pil_img.save(out_buf, format="JPEG", quality=90)
        return out_buf.getvalue()
    except Exception as e:
        logger.error(f"PDF page rendering failed: {e}", exc_info=True)
        raise HTTPException(status_code=400, detail=f"Failed to process PDF page: {str(e)}")


@router.get("/diabetes-schema")
async def get_diabetes_schema():
    """
    Returns the calibrated feature schema for the MathWorks Diabetes Model.
    Ensures frontend and lab parser remain dynamically synchronized with model inputs.
    """
    return {
        "features": [
            {"key": "glucose", "label": "Blood Glucose (Fasting)", "unit": "mg/dL", "default": 110.0, "type": "float"},
            {"key": "bmi", "label": "Body Mass Index (BMI)", "unit": "kg/m²", "default": 25.5, "type": "float"},
            {"key": "age", "label": "Patient Age", "unit": "years", "default": 50.0, "type": "float"},
            {"key": "systolic_bp", "label": "Systolic Blood Pressure", "unit": "mmHg", "default": 120.0, "type": "float"},
            {"key": "diastolic_bp", "label": "Diastolic Blood Pressure", "unit": "mmHg", "default": 80.0, "type": "float"},
            {"key": "heart_rate", "label": "Heart Rate / Pulse", "unit": "bpm", "default": 75.0, "type": "float"},
            {"key": "creatinine", "label": "Serum Creatinine", "unit": "mg/dL", "default": 1.0, "type": "float"},
            {"key": "bun", "label": "Blood Urea Nitrogen (BUN)", "unit": "mg/dL", "default": 16.0, "type": "float"},
        ],
        "auxiliary_features": [
            {"key": "glucose_random", "label": "Random / PPBS Glucose", "unit": "mg/dL", "type": "float"},
            {"key": "hba1c", "label": "Glycated Hemoglobin (HbA1c)", "unit": "%", "type": "float"},
        ],
        "disclaimer": "SmartMed is an AI screening and clinical decision support aid, not a definitive diagnosis. Clinical lab findings should be verified by a licensed medical practitioner."
    }


@router.post("/lab-scan")
async def scan_lab_report(file: UploadFile = File(...)):
    """
    Processes an uploaded lab report page in-memory.
    Performs OCR text extraction, parses biomarker fields, and validates plausibility.
    No image is saved to disk; zero PHI is persisted.
    """
    try:
        raw_bytes = await file.read()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to read uploaded file: {str(e)}")

    if not raw_bytes:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    if len(raw_bytes) > MAX_UPLOAD_SIZE:
        raise HTTPException(status_code=400, detail=f"File exceeds maximum allowed size of 8 MB.")

    try:
        fmt = validate_magic_bytes(raw_bytes)
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))

    # Convert PDF if needed
    image_bytes = raw_bytes
    if fmt == "pdf":
        image_bytes = render_pdf_first_page(raw_bytes)

    # Execute OCR text extraction reusing loaded pipeline
    raw_ocr_text = ""
    try:
        from ocr.pipeline import pipeline as ocr_pipeline
        if ocr_pipeline:
            res = ocr_pipeline.process_image(image_bytes)
            raw_ocr_text = res.get("text", "")
            # If line regions available, join them
            if not raw_ocr_text and res.get("regions"):
                raw_ocr_text = "\n".join([r.get("text", "") for r in res["regions"] if r.get("text")])
        else:
            raise RuntimeError("OCR Pipeline is not initialized.")
    except Exception as ocr_err:
        logger.warning(f"Primary OCR extraction error in lab_scan: {ocr_err}. Running fallback OCR.")
        try:
            # Direct PaddleOCR fallback if pipeline object failed
            from ocr.engine import PaddleOCREngine
            import cv2
            import numpy as np
            engine = PaddleOCREngine()
            np_arr = np.frombuffer(image_bytes, np.uint8)
            img = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
            regions = engine.detect_and_recognize(img)
            raw_ocr_text = "\n".join([r.text for r in regions if r.text])
        except Exception as fb_err:
            logger.error(f"OCR fallback failed: {fb_err}", exc_info=True)
            raise HTTPException(status_code=500, detail="OCR engine failed to extract text from document.")
    finally:
        # Immediate memory cleanup of uploaded image
        del raw_bytes
        del image_bytes

    # Parse extracted text with pure functions
    parsed_result = parse_lab_report_text(raw_ocr_text)

    # Append disclaimer
    parsed_result["disclaimer"] = "Screening aid only. Values must be verified by patient or healthcare provider before clinical decision making."

    return parsed_result
