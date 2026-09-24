"""
SmartMed AI - MNN Model Manager
Singleton manager that handles model lifecycle:
- Lazy loading on first request
- Reuses loaded model across requests
- Thread-safe initialization
- Status reporting
"""

import threading
import logging
from enum import Enum
from typing import Optional

from .config import config

logger = logging.getLogger("smartmed.ai")


class ModelStatus(Enum):
    NOT_LOADED = "not_loaded"
    LOADING = "loading"
    READY = "ready"
    ERROR = "error"
    MODEL_NOT_FOUND = "model_not_found"


class ModelManager:
    """
    Singleton model manager for MNN-LLM.
    Ensures the model is loaded once and reused across all inference requests.
    """

    _instance: Optional["ModelManager"] = None
    _lock = threading.Lock()

    def __new__(cls) -> "ModelManager":
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
                    cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        if self._initialized:
            return
        self._initialized = True
        self._model = None
        self._status = ModelStatus.NOT_LOADED
        self._error_message: str = ""
        self._model_lock = threading.Lock()
        self._inference_lock = threading.Lock()

    @property
    def status(self) -> ModelStatus:
        return self._status

    @property
    def error_message(self) -> str:
        return self._error_message

    @property
    def is_ready(self) -> bool:
        return self._status == ModelStatus.READY

    def get_status_dict(self) -> dict:
        """Return a JSON-serializable status dictionary."""
        return {
            "status": self._status.value,
            "model_name": config.model_name,
            "device": config.device,
            "model_exists": config.model_exists(),
            "error": self._error_message if self._status == ModelStatus.ERROR else None,
        }

    def load_model(self) -> bool:
        """
        Load the MNN model. Thread-safe, idempotent.
        Returns True if model is ready after this call.
        """
        if self._status == ModelStatus.READY and self._model is not None:
            return True

        with self._model_lock:
            # Double-check after acquiring lock
            if self._status == ModelStatus.READY and self._model is not None:
                return True

            if not config.model_exists():
                self._status = ModelStatus.MODEL_NOT_FOUND
                self._error_message = (
                    f"Model files not found at: {config.model_dir}. "
                    f"Please download and place an MNN-compatible model in that directory. "
                    f"See OFFLINE_AI_SETUP.md for instructions."
                )
                logger.error(self._error_message)
                return False

            self._status = ModelStatus.LOADING
            self._error_message = ""
            logger.info(f"Loading MNN model from: {config.model_dir}")

            try:
                self._model = self._create_mnn_llm()
                self._status = ModelStatus.READY
                logger.info(f"MNN model loaded successfully: {config.model_name}")
                return True

            except ImportError as e:
                self._status = ModelStatus.ERROR
                self._error_message = (
                    f"MNN Python package not installed. "
                    f"Run: pip install MNN  |  Details: {e}"
                )
                logger.error(self._error_message)
                return False

            except FileNotFoundError as e:
                self._status = ModelStatus.MODEL_NOT_FOUND
                self._error_message = f"Model file not found: {e}"
                logger.error(self._error_message)
                return False

            except Exception as e:
                self._status = ModelStatus.ERROR
                self._error_message = f"Failed to load MNN model: {type(e).__name__}: {e}"
                logger.error(self._error_message, exc_info=True)
                return False

    def _create_mnn_llm(self):
        """
        Create an MNN LLM instance using the pymnn API.
        
        MNN-LLM uses a C++ backend exposed through Python bindings.
        The model is loaded from a config.json file that references
        the .mnn model, weights, embeddings, and tokenizer.
        """
        try:
            import MNN.llm as mnn_llm
        except ImportError:
            # Fallback: Try the alternative import path
            try:
                import MNN
                mnn_llm = MNN.llm
            except (ImportError, AttributeError):
                raise ImportError(
                    "Cannot import MNN.llm. Ensure MNN is installed with LLM support: "
                    "pip install MNN"
                )

        model_dir = config.model_dir
        config_path = str(model_dir / "config.json")

        if not (model_dir / "config.json").exists():
            # Try loading directly from llm.mnn
            llm_path = str(model_dir / "llm.mnn")
            if not (model_dir / "llm.mnn").exists():
                raise FileNotFoundError(
                    f"Neither config.json nor llm.mnn found in {model_dir}"
                )
            config_path = llm_path

        logger.info(f"Creating MNN LLM from: {config_path}")
        llm = mnn_llm.create(config_path)
        llm.load()

        return llm

    def generate(self, prompt: str) -> str:
        """
        Generate a response from the loaded model.
        Thread-safe — only one inference at a time.
        
        Args:
            prompt: The formatted prompt string (with system prompt + history).
            
        Returns:
            The model's generated text response.
        """
        if not self.is_ready:
            if not self.load_model():
                raise RuntimeError(
                    f"Model is not available: {self._error_message}"
                )

        with self._inference_lock:
            try:
                response = self._model.response(prompt)
                return response
            except Exception as e:
                logger.error(f"Inference error: {e}", exc_info=True)
                raise RuntimeError(f"Inference failed: {type(e).__name__}: {e}")

    def unload_model(self):
        """Unload the model and free memory."""
        with self._model_lock:
            self._model = None
            self._status = ModelStatus.NOT_LOADED
            self._error_message = ""
            logger.info("MNN model unloaded")


# Singleton instance
model_manager = ModelManager()
