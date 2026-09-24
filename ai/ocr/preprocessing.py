"""
SmartMed AI - Adaptive Prescription Image Preprocessing
Implements OpenCV and Pillow logic for deskewing, contrast enhancement,
and edge-preserving noise reduction without destroying handwritten strokes.
"""

import io
import math
import logging
from typing import Tuple, Dict, Any, Union, Optional
import numpy as np
import cv2
from PIL import Image

logger = logging.getLogger("smartmed.ocr.preprocessing")


class ImageQualityMetrics:
    """Stores image quality assessment results."""
    def __init__(
        self,
        blur_score: float,
        brightness: float,
        contrast: float,
        is_blurry: bool,
        is_insufficient: bool = False,
        quality_error: Optional[str] = None,
    ):
        self.blur_score = blur_score
        self.brightness = brightness
        self.contrast = contrast
        self.is_blurry = is_blurry
        self.is_insufficient = is_insufficient
        self.quality_error = quality_error

    def to_dict(self) -> Dict[str, Any]:
        return {
            "blur_score": round(self.blur_score, 2),
            "brightness": round(self.brightness, 2),
            "contrast": round(self.contrast, 2),
            "is_blurry": self.is_blurry,
            "is_insufficient": self.is_insufficient,
            "quality_error": self.quality_error,
        }


class AdaptivePreprocessor:
    """
    Adaptive image preprocessor for medical prescription images.
    Preserves fine handwritten pen strokes while eliminating shadows, skew, and grain.
    """

    def __init__(
        self,
        clahe_clip_limit: float = 2.0,
        clahe_grid_size: Tuple[int, int] = (8, 8),
        blur_threshold: float = 80.0,
        max_skew_angle: float = 30.0,
    ):
        self.clahe_clip_limit = clahe_clip_limit
        self.clahe_grid_size = clahe_grid_size
        self.blur_threshold = blur_threshold
        self.max_skew_angle = max_skew_angle

    def load_image(self, source: Union[bytes, str, np.ndarray, Image.Image]) -> np.ndarray:
        """Loads input source into a standard BGR numpy array."""
        if isinstance(source, np.ndarray):
            if len(source.shape) == 2:
                return cv2.cvtColor(source, cv2.COLOR_GRAY2BGR)
            return source.copy()

        if isinstance(source, bytes):
            nparr = np.frombuffer(source, np.uint8)
            img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            if img is None:
                raise ValueError("Failed to decode image from bytes")
            return img

        if isinstance(source, Image.Image):
            rgb = np.array(source.convert("RGB"))
            return cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)

        if isinstance(source, str):
            img = cv2.imread(source)
            if img is None:
                raise ValueError(f"Failed to load image from path: {source}")
            return img

        raise TypeError(f"Unsupported image input type: {type(source)}")

    def assess_quality(self, gray: np.ndarray) -> ImageQualityMetrics:
        """
        Calculates sharpness (Laplacian variance), mean brightness, and contrast.
        """
        # Laplacian variance measures edge sharpness
        blur_score = float(cv2.Laplacian(gray, cv2.CV_64F).var())
        brightness = float(np.mean(gray))
        contrast = float(np.std(gray))
        is_blurry = blur_score < self.blur_threshold

        h, w = gray.shape[:2]
        is_insufficient = False
        quality_error = None

        # Check for unreadable quality conditions
        if h < 100 or w < 100:
            is_insufficient = True
            quality_error = "Prescription image quality is insufficient for reliable extraction. Resolution is too low. Please upload a clearer image."
        elif blur_score < 12.0:
            is_insufficient = True
            quality_error = "Prescription image quality is insufficient for reliable extraction. Image is severely blurry. Please upload a clearer image."
        elif contrast < 8.0:
            is_insufficient = True
            quality_error = "Prescription image quality is insufficient for reliable extraction. Contrast is too low to distinguish handwriting. Please upload a clearer image."
        elif brightness < 15.0 or (brightness > 254.0 and contrast < 10.0):
            is_insufficient = True
            quality_error = "Prescription image quality is insufficient for reliable extraction. Lighting is too dark or washed out. Please upload a clearer image."

        return ImageQualityMetrics(
            blur_score=blur_score,
            brightness=brightness,
            contrast=contrast,
            is_blurry=is_blurry,
            is_insufficient=is_insufficient,
            quality_error=quality_error,
        )

    def detect_skew_angle(self, gray: np.ndarray) -> float:
        """
        Detects document skew angle using edge-based Hough line transform
        and minimum area bounding rects of text contours.
        Returns angle in degrees (-30 to +30).
        """
        try:
            edges = cv2.Canny(gray, 50, 150, apertureSize=3)
            lines = cv2.HoughLinesP(
                edges,
                rho=1,
                theta=np.pi / 180,
                threshold=100,
                minLineLength=gray.shape[1] // 6,
                maxLineGap=20,
            )

            angles = []
            if lines is not None:
                for line in lines:
                    line_flat = np.array(line).reshape(-1)
                    if len(line_flat) < 4:
                        continue
                    x1, y1, x2, y2 = line_flat[:4]
                    dx = x2 - x1
                    dy = y2 - y1
                    if dx == 0:
                        continue
                    angle = math.degrees(math.atan2(dy, dx))
                    # Filter lines that are approximately horizontal
                    if abs(angle) <= self.max_skew_angle:
                        angles.append(angle)

            if len(angles) >= 3:
                return float(np.median(angles))

            # Fallback: Contour minAreaRect on dilated text regions
            kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (15, 3))
            dilated = cv2.dilate(edges, kernel, iterations=1)
            contours, _ = cv2.findContours(dilated, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)

            fallback_angles = []
            for cnt in contours:
                if cv2.contourArea(cnt) > 200:
                    rect = cv2.minAreaRect(cnt)
                    angle = rect[2]
                    if angle < -45:
                        angle += 90
                    elif angle > 45:
                        angle -= 90
                    if abs(angle) <= self.max_skew_angle:
                        fallback_angles.append(angle)

            if fallback_angles:
                return float(np.median(fallback_angles))

            return 0.0
        except Exception as e:
            logger.warning(f"Error detecting skew angle: {e}")
            return 0.0

    def deskew(self, image: np.ndarray, angle: float) -> np.ndarray:
        """
        Rotates image by given angle around its center with white boundary padding.
        """
        if abs(angle) < 0.5:
            return image

        h, w = image.shape[:2]
        center = (w // 2, h // 2)
        rot_mat = cv2.getRotationMatrix2D(center, angle, 1.0)
        
        # Calculate new bounding dimensions to avoid clipping
        cos_val = abs(rot_mat[0, 0])
        sin_val = abs(rot_mat[0, 1])
        new_w = int((h * sin_val) + (w * cos_val))
        new_h = int((h * cos_val) + (w * sin_val))

        rot_mat[0, 2] += (new_w / 2) - center[0]
        rot_mat[1, 2] += (new_h / 2) - center[1]

        deskewed = cv2.warpAffine(
            image,
            rot_mat,
            (new_w, new_h),
            flags=cv2.INTER_CUBIC,
            borderMode=cv2.BORDER_CONSTANT,
            borderValue=(255, 255, 255),
        )
        return deskewed

    def enhance_contrast(self, bgr: np.ndarray) -> np.ndarray:
        """
        Applies Contrast Limited Adaptive Histogram Equalization (CLAHE)
        on the Luminance (L) channel of LAB color space.
        Enhances light handwriting strokes without causing ink blooming.
        """
        lab = cv2.cvtColor(bgr, cv2.COLOR_BGR2LAB)
        l_chan, a_chan, b_chan = cv2.split(lab)

        clahe = cv2.createCLAHE(
            clipLimit=self.clahe_clip_limit,
            tileGridSize=self.clahe_grid_size,
        )
        enhanced_l = clahe.apply(l_chan)

        merged_lab = cv2.merge([enhanced_l, a_chan, b_chan])
        return cv2.cvtColor(merged_lab, cv2.COLOR_LAB2BGR)

    def reduce_noise_preserve_strokes(self, bgr: np.ndarray) -> np.ndarray:
        """
        Applies bilateral filtering to smooth paper grain while strictly preserving
        sharp stroke edges (essential for doctor handwriting and thin cursive lines).
        """
        # d=5, sigmaColor=45, sigmaSpace=45 is optimal for preserving 0.5mm pen strokes
        return cv2.bilateralFilter(bgr, d=5, sigmaColor=45, sigmaSpace=45)

    def process(self, source: Union[bytes, str, np.ndarray, Image.Image]) -> Dict[str, Any]:
        """
        Full adaptive preprocessing pipeline.
        Returns processed image, grayscale, quality metrics, and deskew angle.
        """
        orig_bgr = self.load_image(source)
        h, w = orig_bgr.shape[:2]

        # 1. Resize extremely large images for memory and speed, keeping aspect ratio
        max_dim = 2400
        if max(h, w) > max_dim:
            scale = max_dim / max(h, w)
            orig_bgr = cv2.resize(orig_bgr, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)

        # 2. Convert to grayscale for quality and skew estimation
        gray = cv2.cvtColor(orig_bgr, cv2.COLOR_BGR2GRAY)
        quality = self.assess_quality(gray)

        # 3. Detect and correct skew
        skew_angle = self.detect_skew_angle(gray)
        deskewed_bgr = self.deskew(orig_bgr, skew_angle)

        # 4. Adaptive contrast enhancement
        enhanced_bgr = self.enhance_contrast(deskewed_bgr)

        # 5. Edge-preserving noise filtering
        final_bgr = self.reduce_noise_preserve_strokes(enhanced_bgr)
        final_gray = cv2.cvtColor(final_bgr, cv2.COLOR_BGR2GRAY)

        return {
            "processed_bgr": final_bgr,
            "processed_gray": final_gray,
            "quality": quality.to_dict(),
            "deskew_angle": round(skew_angle, 2),
            "original_shape": [h, w],
            "processed_shape": list(final_bgr.shape[:2]),
        }
