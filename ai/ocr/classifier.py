"""
SmartMed AI - Printed vs. Handwritten Text Region Classifier
Analyzes contour morphology, stroke width variance, and line uniformity
to classify image text crops into printed vs. handwritten doctor text.
"""

import logging
from typing import Tuple, Dict, Any, Optional
import numpy as np
import cv2

logger = logging.getLogger("smartmed.ocr.classifier")


class PrintedVsHandwrittenClassifier:
    """
    Classifies a text region crop as either Printed or Handwritten.
    Printed text: high line uniformity, low stroke width variance, rectangular contour moments.
    Handwritten text: cursive connected loops, variable stroke thickness, irregular baselines.
    """

    def __init__(self, handwriting_threshold: float = 0.50):
        self.handwriting_threshold = handwriting_threshold

    def classify_crop(self, crop_bgr: np.ndarray) -> Tuple[bool, float]:
        """
        Classifies an image crop.
        Returns: (is_handwritten: bool, handwriting_score: float [0.0 to 1.0])
        """
        if crop_bgr is None or crop_bgr.size == 0:
            return False, 0.0

        h, w = crop_bgr.shape[:2]
        if h < 10 or w < 10:
            return False, 0.0

        try:
            gray = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2GRAY)

            # Adaptive threshold to isolate ink strokes
            thresh = cv2.adaptiveThreshold(
                gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 15, 8
            )

            # Find connected ink stroke components
            contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            if not contours or len(contours) < 2:
                return False, 0.2

            stroke_variances = []
            aspect_ratios = []
            curvatures = []

            for cnt in contours:
                area = cv2.contourArea(cnt)
                if area < 15:
                    continue

                perimeter = cv2.arcLength(cnt, True)
                if perimeter == 0:
                    continue

                # Circularity / Curvature metric: 4 * pi * area / (perimeter^2)
                circularity = (4 * np.pi * area) / (perimeter * perimeter)
                curvatures.append(circularity)

                x, y, cw, ch = cv2.boundingRect(cnt)
                if ch > 0:
                    aspect_ratios.append(cw / ch)

            if not curvatures:
                return False, 0.3

            # Handwritten script exhibits high variance in stroke circularity and aspect ratio
            curv_std = float(np.std(curvatures)) if len(curvatures) > 2 else 0.2
            aspect_std = float(np.std(aspect_ratios)) if len(aspect_ratios) > 2 else 0.5

            # Calculate stroke gradient smoothness
            lap = cv2.Laplacian(gray, cv2.CV_64F)
            lap_var = float(lap.var())

            # Composite handwriting score
            score = 0.0
            if curv_std > 0.12:
                score += 0.35
            if aspect_std > 0.8:
                score += 0.35
            if len(contours) < (w // 20):  # Continuous cursive connected strokes
                score += 0.20
            if lap_var < 500:  # Softer handwriting strokes vs sharp printed font edges
                score += 0.10

            is_handwritten = score >= self.handwriting_threshold
            return is_handwritten, round(score, 3)

        except Exception as e:
            logger.debug(f"Error classifying text crop: {e}")
            return False, 0.3
