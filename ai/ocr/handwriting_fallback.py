"""
SmartMed AI - Handwriting Fallback Layer (TrOCR)
Routes low-confidence PaddleOCR detected text regions to a specialized
transformer handwriting model (e.g., TrOCR) to accurately decipher handwritten prescriptions.
"""

import logging
from typing import List, Optional
import numpy as np
from PIL import Image
import cv2

from .engine import OCRRegion

logger = logging.getLogger("smartmed.ocr.handwriting")


class TrOCRHandwritingFallback:
    """
    Handwriting recognition fallback for low-confidence prescription regions using TrOCR.
    """

    def __init__(
        self,
        confidence_threshold: float = 0.82,
        model_name: str = "microsoft/trocr-small-handwritten",
        device: Optional[str] = None,
    ):
        self.confidence_threshold = confidence_threshold
        self.model_name = model_name
        self.device = device
        
        self._processor = None
        self._model = None
        self._init_attempted = False
        self._is_available = False

    def _init_model(self):
        """Lazy loader for TrOCR processor and model weights with GPU & fine-tuned checkpoint support."""
        if self._init_attempted:
            return
        self._init_attempted = True

        import os
        from pathlib import Path
        hf_token = os.environ.get("HF_TOKEN") or os.environ.get("HUGGINGFACE_HUB_TOKEN")
        if hf_token:
            os.environ["HF_TOKEN"] = hf_token
            os.environ["HUGGINGFACE_HUB_TOKEN"] = hf_token

        fine_tuned_dir = Path(__file__).resolve().parent / "models" / "fine_tuned_trocr"

        try:
            import torch
            from transformers import (
                TrOCRProcessor,
                VisionEncoderDecoderModel,
                XLMRobertaTokenizer,
                AutoImageProcessor,
            )

            if self.device is None:
                self.device = "cuda" if torch.cuda.is_available() else "cpu"

            # Check if domain-specific fine-tuned checkpoint exists
            if (fine_tuned_dir / "model.safetensors").exists():
                logger.info(f"Loading Fine-Tuned Prescription TrOCR model from {fine_tuned_dir} on {self.device}...")
                try:
                    self._processor = TrOCRProcessor.from_pretrained(str(fine_tuned_dir))
                except Exception:
                    tokenizer = XLMRobertaTokenizer.from_pretrained(str(fine_tuned_dir))
                    image_processor = AutoImageProcessor.from_pretrained(self.model_name, token=hf_token)
                    self._processor = TrOCRProcessor(image_processor=image_processor, tokenizer=tokenizer)

                self._model = VisionEncoderDecoderModel.from_pretrained(str(fine_tuned_dir)).to(self.device)
                self.is_fine_tuned = True
            else:
                logger.info(f"Loading base TrOCR model '{self.model_name}' on {self.device}...")
                try:
                    self._processor = TrOCRProcessor.from_pretrained(self.model_name, token=hf_token)
                except Exception:
                    tokenizer = XLMRobertaTokenizer.from_pretrained(self.model_name, token=hf_token)
                    image_processor = AutoImageProcessor.from_pretrained(self.model_name, token=hf_token)
                    self._processor = TrOCRProcessor(image_processor=image_processor, tokenizer=tokenizer)

                self._model = VisionEncoderDecoderModel.from_pretrained(self.model_name, token=hf_token).to(self.device)
                self.is_fine_tuned = False

            # Ensure generation config handles pad and decoder tokens properly
            if hasattr(self._model, "config"):
                self._model.config.pad_token_id = self._processor.tokenizer.pad_token_id
                self._model.config.decoder_start_token_id = self._processor.tokenizer.cls_token_id or 0
                self._model.config.eos_token_id = self._processor.tokenizer.sep_token_id or 2

            self._model.eval()
            self._is_available = True
            logger.info(f"TrOCR handwriting model loaded on {self.device} (Fine-tuned: {getattr(self, 'is_fine_tuned', False)}).")
        except Exception as e:
            logger.warning(
                f"TrOCR handwriting model not initialized ({e}). "
                f"Low-confidence regions will be flagged for human review."
            )
            self._is_available = False

    def is_available(self) -> bool:
        self._init_model()
        return self._is_available

    def crop_region(self, image_bgr: np.ndarray, region: OCRRegion, padding: int = 4) -> Optional[np.ndarray]:
        """Crops a region from the image with padding, avoiding bounds overflow."""
        h, w = image_bgr.shape[:2]
        x, y, bw, bh = region.bounding_rect

        x1 = max(0, x - padding)
        y1 = max(0, y - padding)
        x2 = min(w, x + bw + padding)
        y2 = min(h, y + bh + padding)

        if (x2 - x1) <= 2 or (y2 - y1) <= 2:
            return None

        cropped = image_bgr[y1:y2, x1:x2]
        return cropped

    def recognize_crop(self, crop_bgr: np.ndarray) -> Optional[tuple[str, float]]:
        """Runs TrOCR inference on a cropped region with GPU acceleration."""
        self._init_model()
        if not self._is_available or self._model is None or self._processor is None:
            return None

        try:
            import torch

            # Convert BGR crop to RGB PIL Image
            rgb = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2RGB)
            pil_img = Image.fromarray(rgb)

            pixel_values = self._processor(pil_img, return_tensors="pt").pixel_values.to(self.device)

            with torch.no_grad():
                if self.device == "cuda":
                    with torch.amp.autocast("cuda", dtype=torch.float16):
                        outputs = self._model.generate(
                            pixel_values,
                            max_new_tokens=32,
                            return_dict_in_generate=True,
                            output_scores=True,
                        )
                else:
                    outputs = self._model.generate(
                        pixel_values,
                        max_new_tokens=32,
                        return_dict_in_generate=True,
                        output_scores=True,
                    )

            sequences = outputs.sequences
            generated_text = self._processor.batch_decode(sequences, skip_special_tokens=True)[0].strip()

            if not generated_text:
                return None

            # Calculate confidence from output logits
            confidence = 0.90  # Default baseline for fine-tuned TrOCR recognition
            if outputs.scores:
                try:
                    scores = torch.stack(outputs.scores, dim=1)
                    probs = torch.softmax(scores, dim=-1)
                    max_probs = torch.max(probs, dim=-1).values
                    confidence = float(torch.mean(max_probs).item())
                except Exception:
                    confidence = 0.88

            return generated_text, float(confidence)

        except Exception as e:
            logger.debug(f"TrOCR recognition error on crop: {e}")
            return None

    def apply_fallback(
        self,
        image_bgr: np.ndarray,
        regions: List[OCRRegion],
    ) -> List[OCRRegion]:
        """
        Scans regions for low confidence (< confidence_threshold).
        If TrOCR is available and confidence is higher, upgrades the region text.
        """
        updated_regions: List[OCRRegion] = []

        for region in regions:
            if region.confidence < self.confidence_threshold:
                crop = self.crop_region(image_bgr, region)
                if crop is not None:
                    trocr_result = self.recognize_crop(crop)
                    if trocr_result:
                        trocr_text, trocr_conf = trocr_result
                        # If TrOCR provides confident output, upgrade region
                        if trocr_conf >= region.confidence and len(trocr_text) >= 2:
                            logger.info(
                                f"Handwriting fallback upgraded '{region.text}' ({region.confidence:.2f}) "
                                f"-> '{trocr_text}' ({trocr_conf:.2f})"
                            )
                            updated_regions.append(
                                OCRRegion(box=region.box, text=trocr_text, confidence=trocr_conf)
                            )
                            continue

            updated_regions.append(region)

        return updated_regions
