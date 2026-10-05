"""
SmartMed AI - MNN Configuration
Loads all AI/model configuration from environment variables.
Never accepts model paths from the frontend.
"""

import os
from pathlib import Path
from dotenv import load_dotenv

# Load .env from the ai/ directory
_ai_dir = Path(__file__).resolve().parent.parent
_env_path = _ai_dir / ".env"
if _env_path.exists():
    load_dotenv(_env_path)


class MNNConfig:
    """Immutable configuration for the MNN inference engine."""

    def __init__(self):
        self.model_path: str = os.getenv(
            "MNN_MODEL_PATH",
            str(_ai_dir / "mnn" / "model")
        )
        self.model_name: str = os.getenv(
            "MNN_MODEL_NAME",
            "Qwen2.5-0.5B-Instruct-MNN"
        )
        self.device: str = os.getenv("MNN_DEVICE", "cpu").lower()
        self.max_new_tokens: int = int(os.getenv("MNN_MAX_NEW_TOKENS", "512"))
        self.temperature: float = float(os.getenv("MNN_TEMPERATURE", "0.7"))
        self.context_length: int = int(os.getenv("MNN_CONTEXT_LENGTH", "2048"))
        self.thread_num: int = int(os.getenv("MNN_THREAD_NUM", "4"))
        self.port: int = int(os.getenv("PORT", os.getenv("SMARTMED_AI_PORT", "8100")))
        self.system_prompt_path: str = str(_ai_dir / "prompts" / "smart-med-system.txt")
        self.inference_timeout: int = int(os.getenv("MNN_INFERENCE_TIMEOUT", "120"))

        # Medical & External APIs (MedAssist Integration)
        self.openfda_api_key: str = os.getenv("OPENFDA_API_KEY", "")
        self.datagov_api_key: str = os.getenv("DATA_GOV_IN_API_KEY", "")
        self.medi_client_id: str = os.getenv("MEDI_CLIENT_ID", "")
        self.medi_client_secret: str = os.getenv("MEDI_CLIENT_SECRET", "")
        self.ai_api_key: str = os.getenv("AI_API_KEY", "")
        self.ai_api_base_url: str = os.getenv("AI_API_BASE_URL", "https://integrate.api.nvidia.com/v1")
        self.ai_model_chat: str = os.getenv("AI_MODEL_CHAT", "meta/llama-3.1-8b-instruct")
        self.ai_model_voice: str = os.getenv("AI_MODEL_VOICE", "openai/gpt-oss-120b")
        self.whisper_api_key: str = os.getenv("WHISPER_API_KEY", "")
        self.exotel_sid: str = os.getenv("EXOTEL_SID", "")
        self.exotel_token: str = os.getenv("EXOTEL_TOKEN", "")
        self.exotel_subdomain: str = os.getenv("EXOTEL_SUBDOMAIN", "api.exotel.com")
        self.exotel_caller_id: str = os.getenv("EXOTEL_CALLER_ID", "")

    @property
    def model_dir(self) -> Path:
        """Resolved absolute path to the model directory."""
        return Path(self.model_path).resolve()

    @property
    def config_json_path(self) -> Path:
        """Path to the MNN config.json inside the model directory."""
        return self.model_dir / "config.json"

    @property
    def llm_model_path(self) -> Path:
        """Path to the llm.mnn model file."""
        return self.model_dir / "llm.mnn"

    def model_exists(self) -> bool:
        """Check if the required model files are present."""
        model_dir = self.model_dir
        if not model_dir.exists():
            return False
        # Check for either config.json (preferred) or llm.mnn (fallback)
        has_config = (model_dir / "config.json").exists()
        has_model = (model_dir / "llm.mnn").exists()
        return has_config or has_model

    def get_system_prompt(self) -> str:
        """Load the system prompt from the prompt file."""
        prompt_path = Path(self.system_prompt_path)
        if prompt_path.exists():
            return prompt_path.read_text(encoding="utf-8").strip()
        # Fallback system prompt
        return (
            "You are SmartMed AI, an expert, empathetic, and highly accurate Medical Triage Assistant.\n\n"
            "STRICT RULES:\n"
            "1. MEDICAL EXPERTISE: Answer ONLY the user's specific health/medication query. Provide clear, "
            "actionable triage steps or drug information (dosage, side effects) based strictly on verified "
            "pharmacological data (OpenFDA, WHO EML).\n"
            "2. 6-LANGUAGE ENFORCEMENT: Detect the user's language (Tamil, English, Hindi, Telugu, Kannada, "
            "Malayalam) and respond 100% in that native script. NO LANGUAGE MIXING.\n"
            "3. CONCISENESS: Keep answers strictly between 2 to 3 short sentences. Use bullet points. "
            "No fluff. No hallucination.\n"
            "4. MEDICAL DISCLAIMER: Always end with 'Please consult a doctor for severe symptoms.'\n"
            "5. NO DATA INVENTING: If you don't know the answer, or if the prescription OCR data is "
            "unclear, say 'I need more information / Please verify the prescription manually.' Do NOT guess."
        )

    def to_dict(self) -> dict:
        """Return a safe dictionary representation (no secrets)."""
        return {
            "model_name": self.model_name,
            "device": self.device,
            "max_new_tokens": self.max_new_tokens,
            "temperature": self.temperature,
            "context_length": self.context_length,
            "thread_num": self.thread_num,
            "model_exists": self.model_exists(),
            "model_path_configured": bool(self.model_path),
            "openfda_configured": bool(self.openfda_api_key),
            "datagov_configured": bool(self.datagov_api_key),
            "icd11_configured": bool(self.medi_client_id and self.medi_client_secret),
            "nvidia_nim_configured": bool(self.ai_api_key),
            "exotel_configured": bool(self.exotel_sid and self.exotel_token),
            "exotel_caller_id_configured": bool(self.exotel_caller_id),
        }


# Singleton config instance
config = MNNConfig()
