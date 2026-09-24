"""
SmartMed AI - Modular OCR Engine Layer
Provides BaseOCREngine abstraction and PaddleOCREngine for text detection
(bounding boxes) and recognition, architected for future prescription-specific fine-tuning.
"""

from abc import ABC, abstractmethod
import logging
from typing import List, Dict, Any, Optional
import numpy as np

logger = logging.getLogger("smartmed.ocr.engine")


class OCRRegion:
    """Represents a detected text region with its polygon bounding box, text, and confidence."""
    def __init__(self, box: List[List[float]], text: str, confidence: float):
        self.box = box  # 4-point polygon: [[x1,y1], [x2,y2], [x3,y3], [x4,y4]]
        self.text = text.strip()
        self.confidence = float(confidence)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "box": [[round(float(c), 1) for c in pt] for pt in self.box],
            "text": self.text,
            "confidence": round(self.confidence, 4),
        }

    @property
    def bounding_rect(self) -> List[int]:
        """Returns [x, y, w, h] integer bounding rectangle."""
        xs = [pt[0] for pt in self.box]
        ys = [pt[1] for pt in self.box]
        min_x = max(0, int(min(xs)))
        min_y = max(0, int(min(ys)))
        max_x = int(max(xs))
        max_y = int(max(ys))
        return [min_x, min_y, max(1, max_x - min_x), max(1, max_y - min_y)]


class BaseOCREngine(ABC):
    """Abstract interface for pluggable OCR engines (PaddleOCR, fine-tuned Rx models, etc.)."""

    @abstractmethod
    def detect_and_recognize(self, image_bgr: np.ndarray) -> List[OCRRegion]:
        """Executes detection and recognition on the preprocessed image."""
        pass

    @abstractmethod
    def is_available(self) -> bool:
        """Returns True if the engine is ready and models are loaded."""
        pass


class PaddleOCREngine(BaseOCREngine):
    """
    PaddleOCR Engine wrapper.
    Performs DBNet text detection and SVTR/CRNN text recognition.
    Architected for future swap-in of custom fine-tuned prescription checkpoints.
    """

    def __init__(
        self,
        use_angle_cls: bool = True,
        lang: str = "en",
        det_db_thresh: float = 0.3,
        det_db_box_thresh: float = 0.5,
        rec_model_dir: Optional[str] = None,
        det_model_dir: Optional[str] = None,
    ):
        self.use_angle_cls = use_angle_cls
        self.lang = lang
        self.det_db_thresh = det_db_thresh
        self.det_db_box_thresh = det_db_box_thresh
        self.rec_model_dir = rec_model_dir
        self.det_model_dir = det_model_dir

        self._ocr_instance = None
        self._init_failed = False

    def _get_ocr(self):
        """Lazy loader for PaddleOCR to optimize startup time."""
        if self._ocr_instance is not None:
            return self._ocr_instance
        if self._init_failed:
            return None

        try:
            from paddleocr import PaddleOCR
            kwargs = {
                "use_angle_cls": self.use_angle_cls,
                "lang": self.lang,
                "det_db_thresh": self.det_db_thresh,
                "det_db_box_thresh": self.det_db_box_thresh,
            }
            if self.rec_model_dir:
                kwargs["rec_model_dir"] = self.rec_model_dir
            if self.det_model_dir:
                kwargs["det_model_dir"] = self.det_model_dir

            logger.info("Initializing PaddleOCR engine...")
            self._ocr_instance = PaddleOCR(**kwargs)
            logger.info("PaddleOCR engine initialized successfully.")
            return self._ocr_instance
        except Exception as e:
            logger.error(f"Failed to initialize PaddleOCR: {e}")
            self._init_failed = True
            return None

    def is_available(self) -> bool:
        return self._get_ocr() is not None

    def detect_and_recognize(self, image_bgr: np.ndarray) -> List[OCRRegion]:
        """
        Executes PaddleOCR detection and text recognition.
        Returns list of OCRRegion objects with boxes, texts, and confidences.
        """
        ocr = self._get_ocr()
        if ocr is None:
            logger.warning("PaddleOCR instance not available.")
            return []

        try:
            # PaddleOCR expects RGB or BGR numpy array
            results = ocr.ocr(image_bgr, cls=self.use_angle_cls)
            regions: List[OCRRegion] = []

            if not results:
                return []

            for page in results:
                if page is None:
                    continue
                for line in page:
                    if not line or len(line) < 2:
                        continue
                    box_coords = line[0]  # [[x1, y1], [x2, y2], [x3, y3], [x4, y4]]
                    rec_result = line[1]  # (text, confidence)
                    if not rec_result:
                        continue
                    text = str(rec_result[0]).strip()
                    conf = float(rec_result[1]) if len(rec_result) > 1 else 0.5
                    
                    if text:
                        regions.append(OCRRegion(box=box_coords, text=text, confidence=conf))

            return regions

        except Exception as e:
            logger.error(f"PaddleOCR recognition failed: {e}", exc_info=True)
            return []
