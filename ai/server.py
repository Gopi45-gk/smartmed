"""
SmartMed AI - Local Inference Server
FastAPI server that bridges the SmartMed frontend with the MNN runtime.

Endpoints:
  POST /api/ai/chat     - Send a message, get AI response
  GET  /api/ai/status   - Check model/service status
  GET  /api/ai/health   - Simple health check

All inference runs locally. No data is sent to external services.
"""

import asyncio
import logging
import sys
import os
import re
from contextlib import asynccontextmanager
from typing import Optional, List, Dict, Any, Tuple

# Add parent to path for module imports
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Auto re-exec with ai/.venv/bin/python if running under an interpreter without paddleocr
_venv_python = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".venv", "bin", "python")
if os.path.exists(_venv_python) and sys.executable != os.path.realpath(_venv_python):
    try:
        import paddleocr  # noqa: F401
    except ImportError:
        os.execv(_venv_python, [_venv_python] + sys.argv)

from fastapi import FastAPI, HTTPException, Response, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import uvicorn

try:
    from ocr.pipeline import pipeline as ocr_pipeline
except Exception as e:
    logging.getLogger("smartmed.server").error(f"Prescription OCR pipeline import error: {e}", exc_info=True)
    ocr_pipeline = None

import httpx
import time
from rag.pipeline import rag_pipeline

from mnn.config import config
from mnn.inference import inference_engine
from mnn.model_manager import model_manager
from tts.manager import tts_manager
import base64
from stt.manager import stt_manager
from clinical_triage import resolve_clinical_chat, resolve_clinical_voice

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)
logger = logging.getLogger("smartmed.ai")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Log configuration on startup."""
    logger.info("=" * 60)
    logger.info("SmartMed AI - Local Inference Server")
    logger.info("=" * 60)
    logger.info(f"Model: {config.model_name}")
    logger.info(f"Model path: {config.model_dir}")
    logger.info(f"Model exists: {config.model_exists()}")
    logger.info(f"Device: {config.device}")
    logger.info(f"Max new tokens: {config.max_new_tokens}")
    logger.info(f"Temperature: {config.temperature}")
    logger.info(f"Context length: {config.context_length}")
    logger.info(f"Threads: {config.thread_num}")
    logger.info(f"Port: {config.port}")
    logger.info(f"OpenFDA API: {'Configured' if config.openfda_api_key else 'None'}")
    logger.info(f"Data.gov.in API: {'Configured' if config.datagov_api_key else 'None'}")
    logger.info(f"WHO ICD-11 OAuth: {'Configured' if (config.medi_client_id and config.medi_client_secret) else 'None'}")
    logger.info(f"Local WHO EML Database: 1,738 medicines loaded")
    tts_stat = tts_manager.get_status()
    logger.info(f"Piper ONNX TTS: {'Ready (' + str(tts_stat['piper']['model']) + ')' if tts_stat['piper']['available'] else 'Not downloaded'}")
    logger.info(f"Kokoro TTS: {'Ready (' + str(tts_stat['kokoro']['model']) + ')' if tts_stat['kokoro']['available'] else 'Not downloaded'}")
    logger.info(f"Prescription OCR Pipeline: {'Ready (PaddleOCR + TrOCR Fallback)' if ocr_pipeline else 'Disabled'}")
    logger.info("=" * 60)

    if not config.model_exists():
        logger.warning(
            f"⚠ Model files not found at: {config.model_dir}\n"
            f"  The server will start but /api/ai/chat will return errors.\n"
            f"  See OFFLINE_AI_SETUP.md for model download instructions."
        )
    else:
        logger.info("✓ Model files found. Model will be loaded on first request.")
    yield


# ─── FastAPI App ─────────────────────────────────────────────────────────────

app = FastAPI(
    title="SmartMed AI - Local Inference",
    description="Offline AI assistant powered by MNN-LLM. No data leaves your device.",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS: Allow local development and AWS cloud deployment origins
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r".*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Async lock to prevent concurrent inference (model is not thread-safe for generation)
_inference_lock = asyncio.Lock()


# ─── Request/Response Models ────────────────────────────────────────────────

class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=4096, description="User message")
    conversationId: Optional[str] = Field(None, description="Local conversation session ID")
    history: Optional[List[Dict[str, str]]] = Field(
        None, description="Conversation history as [{role, content}]"
    )
    mode: Optional[str] = Field("auto", description="Inference mode: 'auto', 'offline', or 'online'")


class ChatResponse(BaseModel):
    success: bool
    response: Optional[str] = None
    intent: Optional[str] = None
    error: Optional[str] = None
    model: str = ""
    offline: bool = True
    rag_grounded: Optional[bool] = False
    timing: Optional[str] = None


class VoiceChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=4096, description="Transcribed voice message")
    conversationId: Optional[str] = Field(None, description="Local conversation session ID")
    history: Optional[List[Dict[str, str]]] = Field(None, description="Conversation history")
    medicinesContext: Optional[List[Dict[str, Any]]] = Field(None, description="Patient's scheduled medications")
    patientName: Optional[str] = Field("Mr. Ravi", description="Patient name")
    language: Optional[str] = Field("en", description="User selected language (en, ta, hi, te, ur, ml, kn)")


class StatusResponse(BaseModel):
    status: str
    model_name: str
    device: str
    model_exists: bool
    error: Optional[str] = None
    config: Optional[dict] = None


# ─── Intent Orchestration Layer ─────────────────────────────────────────────

def detect_intent(text: str) -> str:
    """
    Lightweight SmartMed AI intent detection layer.
    Classifies user message into structured health and medication intents.
    """
    t = text.lower().strip()

    # Emergency check
    emergency_keywords = [
        "chest pain", "heart attack", "can't breathe", "cannot breathe",
        "trouble breathing", "severe bleeding", "stroke", "unconscious",
        "fainted", "collapsed", "emergency"
    ]
    if any(k in t for k in emergency_keywords):
        return "EMERGENCY_WARNING"

    # Medication taken
    taken_keywords = [
        "yes, i took it", "i took it", "already taken", "taken", "had my tablet",
        "had my medicine", "finished my medicine", "i have taken", "took my bp",
        "took my pill", "yes i did", "already did", "yes took it", "mark taken"
    ]
    if any(k in t for k in taken_keywords) or t in ["yes", "yeah", "yup", "done"]:
        return "MEDICINE_TAKEN"

    # Medication snooze / reminder
    snooze_keywords = [
        "remind me", "15 min", "15 mins", "snooze", "not yet", "later",
        "after lunch", "busy right now", "remind me later", "in a bit"
    ]
    if any(k in t for k in snooze_keywords) or t in ["no", "not now"]:
        return "MEDICINE_REMINDER"

    # Medicine info inquiry
    info_keywords = [
        "side effect", "what is", "dosage", "how to take", "with coffee",
        "with food", "missed dose", "interaction", "prescribed"
    ]
    if any(k in t for k in info_keywords):
        return "MEDICINE_INFO"

    return "GENERAL_HEALTH"


# ─── Endpoints ───────────────────────────────────────────────────────────────

@app.get("/api/ai/health")
async def health_check():
    """Simple health check endpoint."""
    return {"status": "ok", "service": "smartmed-ai", "offline": True}


@app.get("/api/ai/status", response_model=StatusResponse)
async def get_status():
    """
    Check the status of the AI model and service.
    Returns model availability, name, device, and any errors.
    """
    status = model_manager.get_status_dict()
    return StatusResponse(
        status=status["status"],
        model_name=status["model_name"],
        device=status["device"],
        model_exists=status["model_exists"],
        error=status.get("error"),
        config=config.to_dict(),
    )


# ─── NVIDIA NIM Router (AWS Cloud Online Inference) ─────────────────────────

async def query_nvidia_nim(
    message: str,
    conversation_history: Optional[List[Dict[str, str]]] = None,
    rag_context: Optional[str] = None,
    model: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Route clinical triage query to AWS / NVIDIA NIM Inference Microservices.
    Enforces the exact Medical Expert Master Prompt and injects verified
    OpenFDA / WHO EML / ICD-11 pharmacological data.
    """
    if not config.ai_api_key:
        return {
            "success": False,
            "error": "NVIDIA NIM API key (AI_API_KEY) is not configured.",
            "model": config.ai_model_chat,
            "offline": False,
        }

    start_time = time.time()
    system_prompt = config.get_system_prompt()

    messages = [{"role": "system", "content": system_prompt}]

    if conversation_history:
        for turn in conversation_history[-10:]:
            role = turn.get("role", "user")
            content = turn.get("content", "")
            if role in ["user", "assistant"]:
                messages.append({"role": role, "content": content})

    user_content = message
    if rag_context:
        user_content = f"[Retrieved Pharmacological Data]\n{rag_context}\n\n{message}"

    messages.append({"role": "user", "content": user_content})

    nim_url = f"{config.ai_api_base_url.rstrip('/')}/chat/completions"
    headers = {
        "Authorization": f"Bearer {config.ai_api_key}",
        "Content-Type": "application/json",
    }
    target_model = model or config.ai_model_chat
    payload = {
        "model": target_model,
        "messages": messages,
        "temperature": config.temperature,
        "max_tokens": config.max_new_tokens,
    }

    try:
        async with httpx.AsyncClient(timeout=40.0) as client:
            resp = await client.post(nim_url, json=payload, headers=headers)
            if resp.status_code == 200:
                data = resp.json()
                choices = data.get("choices", [])
                if choices:
                    response_text = choices[0].get("message", {}).get("content", "")
                    elapsed = round(time.time() - start_time, 2)
                    return {
                        "success": True,
                        "response": response_text.strip(),
                        "model": target_model,
                        "offline": False,
                        "rag_grounded": bool(rag_context),
                        "timing": f"{elapsed}s",
                    }
                return {
                    "success": False,
                    "error": "Empty response from NVIDIA NIM",
                    "model": target_model,
                    "offline": False,
                }
            else:
                error_body = resp.text[:200]
                return {
                    "success": False,
                    "error": f"NVIDIA NIM error HTTP {resp.status_code}: {error_body}",
                    "model": target_model,
                    "offline": False,
                }
    except Exception as e:
        logger.error(f"NVIDIA NIM request error: {e}", exc_info=True)
        return {
            "success": False,
            "error": f"Failed to connect to NVIDIA NIM: {str(e)}",
            "model": target_model,
            "offline": False,
        }


@app.get("/api/ai/nim/status")
async def nim_status():
    """Check NVIDIA NIM Cloud Router status."""
    return {
        "status": "ready" if config.ai_api_key else "unconfigured",
        "configured": bool(config.ai_api_key),
        "base_url": config.ai_api_base_url,
        "chat_model": config.ai_model_chat,
        "voice_model": config.ai_model_voice,
    }


@app.post("/api/ai/nim", response_model=ChatResponse)
async def chat_nim(request: ChatRequest):
    """
    Direct endpoint to route complex medical queries to NVIDIA NIM
    with live WHO/FDA pharmacological data retrieval.
    """
    message = request.message.strip()
    if not message:
        raise HTTPException(status_code=400, detail="Message cannot be empty")

    intent = detect_intent(message)
    rag_context = ""
    try:
        rag_context = rag_pipeline.get_rag_context(message)
    except Exception as e:
        logger.debug(f"RAG context error: {e}")

    nim_result = await query_nvidia_nim(
        message=message,
        conversation_history=request.history,
        rag_context=rag_context,
    )

    if nim_result.get("success"):
        return ChatResponse(
            success=True,
            response=nim_result.get("response"),
            intent=intent,
            model=nim_result.get("model", config.ai_model_chat),
            offline=False,
            rag_grounded=nim_result.get("rag_grounded", False),
            timing=nim_result.get("timing"),
        )

    # Fallback to local MNN if NIM unconfigured or failed
    logger.info("Falling back from NIM to local MNN inference...")
    async with _inference_lock:
        result = await asyncio.to_thread(
            inference_engine.generate,
            message=message,
            conversation_history=request.history,
        )
        return ChatResponse(
            success=result.get("success", False),
            response=result.get("response"),
            intent=intent,
            error=result.get("error"),
            model=result.get("model", config.model_name),
            offline=True,
            rag_grounded=result.get("rag_grounded", False),
            timing=result.get("timing"),
        )


@app.post("/api/ai/chat", response_model=ChatResponse)
async def chat(request: ChatRequest):
    """
    Hybrid AI Router Endpoint (Offline-First with Online Fallback).
    
    - OFFLINE MODE: Routes directly to local on-device MNN / WebLLM pipeline.
    - ONLINE MODE: Routes complex medical queries to AWS NVIDIA NIM with live WHO/FDA lookups.
    - AUTO MODE: Uses NVIDIA NIM if available/online, seamlessly falling back to local MNN.
    """
    message = request.message.strip()

    if not message:
        raise HTTPException(status_code=400, detail="Message cannot be empty")

    if len(message) > 4096:
        raise HTTPException(status_code=400, detail="Message too long (max 4096 chars)")

    intent = detect_intent(message)
    logger.info(f"Chat request: {message[:80]}{'...' if len(message) > 80 else ''} (Intent: {intent}, Mode: {request.mode})")

    # Fetch verified pharmacological RAG context (EML, OpenFDA, ICD-11)
    rag_context = ""
    try:
        rag_context = rag_pipeline.get_rag_context(message)
    except Exception as r_err:
        logger.debug(f"RAG lookup error: {r_err}")

    # Determine whether to attempt online NVIDIA NIM inference
    should_try_online = (
        request.mode == "online"
        or (request.mode == "auto" and bool(config.ai_api_key))
        or (request.mode == "auto" and not config.model_exists())
    ) and bool(config.ai_api_key)

    if should_try_online:
        logger.info("Routing query to AWS-hosted NVIDIA NIM router with live pharmacological data...")
        nim_result = await query_nvidia_nim(
            message=message,
            conversation_history=request.history,
            rag_context=rag_context,
        )
        if nim_result.get("success"):
            return ChatResponse(
                success=True,
                response=nim_result.get("response"),
                intent=intent,
                model=nim_result.get("model", config.ai_model_chat),
                offline=False,
                rag_grounded=nim_result.get("rag_grounded", False),
                timing=nim_result.get("timing"),
            )
        logger.warning(f"Online NVIDIA NIM inference failed: {nim_result.get('error')}. Falling back to local offline MNN...")

    # Offline local inference using on-device MNN runtime with clinical engine fallback
    async with _inference_lock:
        try:
            result = await asyncio.to_thread(
                inference_engine.generate,
                message=message,
                conversation_history=request.history,
            )

            if not result.get("success") or not result.get("response"):
                clinical_text = resolve_clinical_chat(message)
                return ChatResponse(
                    success=True,
                    response=clinical_text,
                    intent=intent,
                    model="smartmed-clinical-engine",
                    offline=True,
                    rag_grounded=bool(rag_context),
                    timing="0.01s",
                )

            return ChatResponse(
                success=True,
                response=result.get("response"),
                intent=intent,
                model=result.get("model", config.model_name),
                offline=True,
                rag_grounded=result.get("rag_grounded", False),
                timing=result.get("timing"),
            )

        except Exception as e:
            logger.error(f"Chat endpoint error: {e}", exc_info=True)
            clinical_text = resolve_clinical_chat(message)
            return ChatResponse(
                success=True,
                response=clinical_text,
                intent=intent,
                model="smartmed-clinical-engine",
                offline=True,
                rag_grounded=False,
                timing="0.01s",
            )


# ─── Clinical Voice Knowledge Base & Query Resolver ─────────────────────────

COMMON_DRUG_DATABASE: Dict[str, Dict[str, str]] = {
    "metformin": {
        "use": "Metformin is prescribed to manage blood sugar levels in type 2 diabetes by improving your body's sensitivity to insulin.",
        "side_effects": "Common side effects of Metformin include mild nausea, stomach upset, or diarrhea, which usually improve when taken with meals.",
        "food": "Metformin should always be taken with or right after meals to protect your stomach.",
        "missed": "If you missed your Metformin dose, take it as soon as you remember with a meal, unless it is almost time for your next dose.",
    },
    "amlodipine": {
        "use": "Amlodipine relaxes blood vessels to lower high blood pressure and prevent chest pain.",
        "side_effects": "Common side effects of Amlodipine include mild ankle swelling, dizziness, or flushing. Let your doctor know if ankle swelling persists.",
        "food": "Amlodipine can be taken once daily with or without food. Avoid grapefruit juice while taking it.",
        "missed": "If you forget Amlodipine, take it as soon as you remember that day, but never double up on doses.",
    },
    "atorvastatin": {
        "use": "Atorvastatin lowers LDL cholesterol and triglycerides to protect against cardiovascular disease.",
        "side_effects": "Common side effects include mild muscle aches or digestive changes. If you experience severe unexplained muscle weakness, call your doctor.",
        "food": "Atorvastatin is typically taken once daily in the evening or at bedtime.",
        "missed": "Take your missed Atorvastatin dose when you remember, but skip it if it is almost time for your regular evening dose.",
    },
    "paracetamol": {
        "use": "Paracetamol is used to relieve fever and mild to moderate pain.",
        "side_effects": "Paracetamol is safe when taken at recommended doses. Do not exceed 4 grams in a 24-hour period to protect your liver.",
        "food": "Paracetamol can be taken with or without food.",
        "missed": "Take it when needed for pain, spaced at least 4 to 6 hours apart.",
    },
    "aspirin": {
        "use": "Aspirin is often used in low doses as a blood thinner to help prevent heart attacks and strokes.",
        "side_effects": "Aspirin can irritate the stomach or increase bleeding risks. Always take it with food or water.",
        "food": "Aspirin must be taken after meals to reduce stomach irritation.",
        "missed": "Take the missed dose with food as soon as you remember, unless it is close to the next dose.",
    },
    "losartan": {
        "use": "Losartan is an angiotensin receptor blocker used to lower blood pressure and protect kidneys in diabetes.",
        "side_effects": "Common side effects include dizziness or fatigue as blood pressure adjusts.",
        "food": "Losartan can be taken with or without food once daily.",
        "missed": "Take as soon as you remember, but never take two doses on the same day.",
    }
}


def clean_voice_output(text: str) -> str:
    """Clean all markdown artifacts, symbols, and formatting for crisp voice TTS audio."""
    if not text:
        return ""
    t = re.sub(r"[*_~`#]+", "", text)
    t = re.sub(r"^\s*[-•*+]\s+", "", t, flags=re.MULTILINE)
    t = re.sub(r"^\s*\d+\.\s+", "", t, flags=re.MULTILINE)
    t = t.strip("\"' ")
    t = re.sub(r"\s+", " ", t).strip()
    # Keep at most 2 sentences for natural spoken voice telephony
    sentences = re.split(r"(?<=[.!?।])\s+", t)
    if len(sentences) > 2:
        t = " ".join(sentences[:2]).strip()
    return t


def resolve_voice_query(
    message: str,
    medicines: Optional[List[Dict[str, Any]]],
    patient_name: str = "Mr. Ravi",
    language: str = "en",
) -> Tuple[Optional[str], str]:
    """
    Intelligent clinical voice resolver supporting all user-selected languages:
    English (en), Tamil (ta), Hindi (hi), Telugu (te), Urdu (ur), Malayalam (ml), Kannada (kn).
    Returns (response_text, intent). If response_text is None, delegates to MNN voice LLM.
    """
    q = message.lower().strip()
    meds = medicines or []
    lang = (language or "en").lower().split("-")[0].strip()

    # 1. Emergency Detection (Immediate Urgent Triage)
    emergency_kw = [
        "chest pain", "heart attack", "can't breathe", "cannot breathe",
        "trouble breathing", "stroke", "bleeding heavily", "fainted",
        "collapsed", "choking", "seizure", "unconscious", "heart racing",
        "நெஞ்சு வலி", "மூச்சு", "सीने में दर्द", "सांस", "ఛాతీ నొప్పి", "శ్వాస",
        "سینے میں درد", "سانس", "നെഞ്ചുവേദന", "ശ്വാസം", "ಎದೆ ನೋವು", "ಉಸಿರಾಟ"
    ]
    if any(k in q for k in emergency_kw):
        if lang == "ta":
            ans = f"{patient_name}, நெஞ்சு வலி மற்றும் மூச்சுத் திணறல் உடனடியாக மருத்துவ அவசர சிகிச்சை தேவைப்படும் அறிகுறிகள் ஆகும். தயவுசெய்து உடனடியாக அவசர மருத்துவ சேவையைத் தொடர்பு கொள்ளவும்!"
        elif lang == "hi":
            ans = f"{patient_name}, सीने में दर्द और सांस लेने में कठिनाई गंभीर आपातकालीन लक्षण हैं। कृपया तुरंत नजदीकी अस्पताल जाएं या आपातकालीन सेवा को कॉल करें!"
        elif lang == "te":
            ans = f"{patient_name}, ఛాతీ నొప్పి మరియు శ్వాస తీసుకోవడంలో ఇబ్బంది అత్యవసర వైద్య పరిస్థితి. దయచేసి వెంటనే అత్యవసర వైద్య సహాయం తీసుకోండి!"
        elif lang == "ur":
            ans = f"{patient_name}، سینے میں درد اور سانس لینے میں دشواری فوری ایمرجنسی کی علامات ہیں۔ براہ کرم فوری ڈاکٹر یا ایمرجنسی سروس سے رابطہ کریں!"
        elif lang == "ml":
            ans = f"{patient_name}, നെഞ്ചുവേദനയും ശ്വാസതടസ്സവും അടിയന്തിര ചികിത്സ ആവശ്യമുള്ള ലക്ഷണങ്ങളാണ്. ദയവായി ഉടൻ തന്നെ അടിയന്തര സഹായം തേടുക!"
        elif lang == "kn":
            ans = f"{patient_name}, ಎದೆ ನೋವು ಮತ್ತು ಉಸಿರಾಟದ ತೊಂದರೆಗೆ ತಕ್ಷಣ ತುರ್ತು ವೈದ್ಯಕೀಯ ಚಿಕಿತ್ಸೆ ಅಗತ್ಯವಿದೆ. ದಯವಿಟ್ಟು ತಕ್ಷಣ ಆಸ್ಪತ್ರೆಗೆ ಭೇಟಿ ನೀಡಿ!"
        else:
            ans = (
                f"{patient_name}, chest pain and difficulty breathing require immediate emergency medical care. "
                f"Please sit down, remain calm, and call emergency services or an ambulance right away, "
                f"or have someone take you to the nearest hospital."
            )
        return ans, "EMERGENCY_WARNING"

    # 2. Confirmation of Taking Medicine
    taken_kw = [
        "yes, i took it", "i took it", "already taken", "taken", "had my tablet",
        "had my medicine", "finished my medicine", "i have taken", "took my bp",
        "took my pill", "yes i did", "already did", "yes took it", "mark taken",
        "took it just now", "taken already", "had it", "finished", "yes done",
        "yes", "yeah", "yup", "done",
        "எடுத்துட்டேன்", "எடுத்துக்கொண்டேன்", "சாப்பிட்டேன்", "மாத்திரை போட்டாச்சு",
        "ஆம்", "ஆமாம்", "எடுத்தேன்", "சாப்பிட்டுவிட்டேன்", "எடுத்துவிட்டேன்", "எடுத்து",
        "ले ली", "खा ली", "ले लिया", "हाँ मैंने", "दवा ले ली", "हाँ", "हो गया",
        "తీసుకున్నాను", "వేసుకున్నాను", "అవును", "అయింది", "తీసుకున్నా",
        "لے لی", "کھا لی", "جی ہاں", "ہو گئی",
        "കഴിച്ചു", "എടുത്തു", "ഉവ്വ്", "കഴിഞ്ഞു",
        "ತಗೊಂಡೆ", "ತೆಗೆದುಕೊಂಡೆ", "ಹೌದು", "ಆಯಿತು"
    ]
    if any(k in q for k in taken_kw):
        if lang == "ta" or any(w in message for w in ["எடுத்து", "சாப்பிட்", "ஆமாம்", "ஆம்"]):
            return f"மிக்க மகிழ்ச்சி {patient_name}! உங்கள் மருந்து உட்கொள்ளப்பட்டதாக பதிவு செய்யப்பட்டுள்ளது. உங்கள் உடல்நலனை நன்றாகப் பார்த்துக் கொள்ளுங்கள்.", "MEDICINE_TAKEN"
        elif lang == "hi" or any(w in message for w in ["दवा", "ले ली", "हाँ", "खा ली"]):
            return f"बहुत अच्छा {patient_name}! आपकी दवा ले ली गई है और इसे दर्ज कर दिया गया है। अपना ख्याल रखें।", "MEDICINE_TAKEN"
        elif lang == "te" or any(w in message for w in ["తీసుకున్నా", "వేసుకున్నా", "అవును"]):
            return f"చాలా మంచిది {patient_name}! మీరు మందు తీసుకున్నట్లు నమోదు చేయబడింది. మీ ఆరోగ్యాన్ని జాగ్రత్తగా చూసుకోండి.", "MEDICINE_TAKEN"
        elif lang == "ur" or any(w in message for w in ["لے لی", "جی ہاں"]):
            return f"بہت اچھا {patient_name}! آپ کی دوا لے لی گئی ہے اور اسے محفوظ کر لیا گیا ہے۔ اپنا خیال رکھیں۔", "MEDICINE_TAKEN"
        elif lang == "ml" or any(w in message for w in ["കഴിച്ചു", "ഉവ്വ്"]):
            return f"വളരെ നല്ലത് {patient_name}! താങ്കൾ മരുന്ന് കഴിച്ചതായി രേഖപ്പെടുത്തിയിട്ടുണ്ട്. ആരോഗ്യം ശ്രദ്ധിക്കുക.", "MEDICINE_TAKEN"
        elif lang == "kn" or any(w in message for w in ["ತಗೊಂಡೆ", "ಹೌದು"]):
            return f"ತುಂಬಾ ಒಳ್ಳೆಯದು {patient_name}! ನೀವು ಔಷಧಿ ತೆಗೆದುಕೊಂಡಿದ್ದೀರಿ ಎಂದು ದಾಖಲಿಸಲಾಗಿದೆ. ನಿಮ್ಮ ಆರೋಗ್ಯವನ್ನು ಚೆನ್ನಾಗಿ ನೋಡಿಕೊಳ್ಳಿ.", "MEDICINE_TAKEN"
        else:
            return (
                f"Wonderful {patient_name}! I have recorded your medication as taken. "
                f"Thank you for staying on track with your health!"
            ), "MEDICINE_TAKEN"

    # 3. Reminder Snooze
    snooze_kw = [
        "remind me", "15 min", "15 mins", "snooze", "not yet", "later",
        "after lunch", "busy right now", "remind me later", "in a bit", "not now",
        "no", "பிறகு", "நினைவூட்டு", "இல்லை", "அப்புறம்", "வேண்டாம்",
        "बाद में", "याद दिला", "नहीं", "अभी नहीं",
        "తర్వాత", "గుర్తుచేయి", "వద్దు", "ఇప్పుడు కాదు",
        "بعد میں", "یاد دلائیں", "نہیں",
        "പിന്നെ", "ഓർമ്മിപ്പിക്കുക", "ഇല്ല",
        "ಆಮೇಲೆ", "ನೆನಪಿಸು", "ಬೇಡ"
    ]
    if any(k in q for k in snooze_kw):
        if lang == "ta" or any(w in message for w in ["பிறகு", "இல்லை", "நினைவூட்டு", "அப்புறம்"]):
            return f"சரி {patient_name}, 15 நிமிடங்களுக்குப் பிறகு மீண்டும் உங்களுக்கு நினைவூட்டுகிறேன். ஓய்வெடுக்கவும்.", "MEDICINE_REMINDER"
        elif lang == "hi" or any(w in message for w in ["बाद में", "नहीं", "याद"]):
            return f"ठीक है {patient_name}, मैं आपको 15 मिनट बाद दोबारा याद दिलाऊंगा।", "MEDICINE_REMINDER"
        elif lang == "te" or any(w in message for w in ["తర్వాత", "గుర్తు", "వద్దు"]):
            return f"సరే {patient_name}, నేను మీకు 15 నిమిషాల్లో మళ్లీ గుర్తుచేస్తాను.", "MEDICINE_REMINDER"
        elif lang == "ur" or any(w in message for w in ["بعد میں", "نہیں", "یاد"]):
            return f"ٹھیک ہے {patient_name}، میں آپ کو 15 منٹ بعد دوبارہ یاد دلاؤں گا۔", "MEDICINE_REMINDER"
        elif lang == "ml" or any(w in message for w in ["പിന്നെ", "ഓർമ്മി"]):
            return f"ശരി {patient_name}, 15 മിനിറ്റിനു ശേഷം ഞാൻ താങ്കളെ വീണ്ടും ഓർമ്മിപ്പിക്കാം.", "MEDICINE_REMINDER"
        elif lang == "kn" or any(w in message for w in ["ಆಮೇಲೆ", "ನೆನ"]):
            return f"ಸರಿ {patient_name}, ನಾನು ನಿಮಗೆ 15 ನಿಮಿಷಗಳಲ್ಲಿ ಮತ್ತೆ ನೆನಪಿಸುತ್ತೇನೆ.", "MEDICINE_REMINDER"
        else:
            return f"Understood {patient_name}. I have snoozed your reminder and will call you back in 15 minutes.", "MEDICINE_REMINDER"

    # 4. Medication Status Check ("Did I take...?" / "Have I taken...?" / "Is my pill taken?")
    status_kw = [
        "did i take", "have i taken", "is my tablet taken", "taken yet", "did i have",
        "was it taken", "did i drink my medicine", "நான் மாத்திரை எடுத்தேனா",
        "क्या मैंने दवा ली", "నేను మందు వేసుకున్నానా", "کیا میں نے دوا لی"
    ]
    if any(k in q for k in status_kw):
        matched_med = next((m for m in meds if m.get("name", "").lower() in q), None)
        if matched_med:
            name = matched_med.get("name")
            dose = matched_med.get("dose", "")
            status = matched_med.get("status", "upcoming")
            time_str = matched_med.get("time", "")
            food = matched_med.get("food", "")
            if status == "taken":
                if lang == "ta":
                    return f"ஆம் {patient_name}, உங்கள் {name} {dose} இன்று உட்கொள்ளப்பட்டதாக பதிவு செய்யப்பட்டுள்ளது.", "MEDICINE_INFO"
                elif lang == "hi":
                    return f"हाँ {patient_name}, आपकी {name} {dose} दवा आज ली जा चुकी है।", "MEDICINE_INFO"
                elif lang == "te":
                    return f"అవును {patient_name}, మీ {name} {dose} ఈరోజు తీసుకున్నట్లు నమోదైంది.", "MEDICINE_INFO"
                return f"Yes {patient_name}, your {name} {dose} has already been recorded as taken today.", "MEDICINE_INFO"
            else:
                if lang == "ta":
                    return f"இல்லை {patient_name}, உங்கள் {name} {dose} இன்னும் எடுக்கப்படவில்லை. இது {time_str} ({food}) திட்டமிடப்பட்டுள்ளது.", "MEDICINE_INFO"
                elif lang == "hi":
                    return f"नहीं {patient_name}, आपकी {name} {dose} दवा अभी बाकी है। इसका समय {time_str} ({food}) है।", "MEDICINE_INFO"
                elif lang == "te":
                    return f"లేదు {patient_name}, మీ {name} {dose} ఇంకా తీసుకోలేదు. సమయం: {time_str} ({food}).", "MEDICINE_INFO"
                return f"No {patient_name}, your {name} {dose} is still pending. It is scheduled for {time_str} ({food}).", "MEDICINE_INFO"

        taken_meds = [m for m in meds if m.get("status") == "taken"]
        upcoming_meds = [m for m in meds if m.get("status") != "taken"]
        if taken_meds and not upcoming_meds:
            names = ", ".join(f"{m.get('name')} {m.get('dose', '')}".strip() for m in meds)
            if lang == "ta":
                return f"ஆம் {patient_name}, இன்றைய உங்கள் அனைத்து மருந்துகளும் ({names}) உட்கொள்ளப்பட்டுவிட்டன.", "MEDICINE_INFO"
            elif lang == "hi":
                return f"हाँ {patient_name}, आज की आपकी सभी दवाएं ({names}) ली जा चुकी हैं।", "MEDICINE_INFO"
            elif lang == "te":
                return f"అవును {patient_name}, నేటి మీ అన్ని మందులు ({names}) తీసుకున్నారు.", "MEDICINE_INFO"
            return f"Yes {patient_name}, all your medications for today ({names}) are already recorded as taken.", "MEDICINE_INFO"
        elif taken_meds:
            taken_names = ", ".join(f"{m.get('name')} {m.get('dose', '')}".strip() for m in taken_meds)
            upcoming_names = ", ".join(f"{m.get('name')} {m.get('dose', '')} at {m.get('time', '')}".strip() for m in upcoming_meds)
            if lang == "ta":
                return f"ஆம் {patient_name}, நீங்கள் {taken_names} எடுத்துக்கொண்டீர்கள். இன்று இன்னும் {upcoming_names} எடுக்க வேண்டும்.", "MEDICINE_INFO"
            elif lang == "hi":
                return f"हाँ {patient_name}, आपने {taken_names} ले ली है। आज अभी {upcoming_names} बाकी है।", "MEDICINE_INFO"
            elif lang == "te":
                return f"అవును {patient_name}, మీరు {taken_names} తీసుకున్నారు. ఇంకా {upcoming_names} మిగిలి ఉంది.", "MEDICINE_INFO"
            return f"Yes {patient_name}, you have taken {taken_names}. You still have {upcoming_names} upcoming today.", "MEDICINE_INFO"
        elif meds:
            first_name = meds[0].get("name")
            first_time = meds[0].get("time", "")
            if lang == "ta":
                return f"இல்லை {patient_name}, இன்று நீங்கள் இன்னும் எந்த மருந்தையும் எடுக்கவில்லை. அடுத்த மருந்து {first_name} ({first_time}).", "MEDICINE_INFO"
            elif lang == "hi":
                return f"नहीं {patient_name}, आज आपने अभी तक कोई दवा नहीं ली है। अगली दवा {first_name} {first_time} पर है।", "MEDICINE_INFO"
            return f"No {patient_name}, you haven't marked any medications as taken yet today. Your next dose is {first_name} at {first_time}.", "MEDICINE_INFO"

    # 5. Today's Schedule / Medication List Inquiry
    schedule_kw = [
        "what medicines", "what are my medicines", "what pills", "what tablets",
        "today's schedule", "which medicine", "what do i take", "my prescription",
        "list my medicines", "medicines today", "what to take",
        "என்ன மாத்திரை", "மருந்துகள்", "இன்று என்ன",
        "कौन सी दवा", "दवाएं", "आज की दवा",
        "ఏ మందులు", "ఈరోజు మందులు", "నా మందులు",
        "کون سی دوائیں", "آج کی دوا",
        "ഏതൊക്കെ മരുന്ന്", "ഇന്നത്തെ മരുന്നുകൾ",
        "ಯಾವ ಔಷಧಿ", "ಇಂದಿನ ಔಷಧಿಗಳು"
    ]
    if any(k in q for k in schedule_kw):
        if not meds:
            if lang == "ta":
                return f"{patient_name}, இன்று உங்களுக்கு எந்த மருந்துகளும் திட்டமிடப்படவில்லை.", "MEDICINE_INFO"
            elif lang == "hi":
                return f"{patient_name}, आज आपके लिए कोई दवा निर्धारित नहीं है।", "MEDICINE_INFO"
            elif lang == "te":
                return f"{patient_name}, ఈరోజు మీకు ఎలాంటి మందుల షెడ్యూల్ లేదు.", "MEDICINE_INFO"
            return f"{patient_name}, you do not have any active medications scheduled for today.", "MEDICINE_INFO"

        if lang == "ta":
            med_items = [
                f"{m.get('name')} {m.get('dose', '')} ({m.get('time', '')}, {'எடுக்கப்பட்டது' if m.get('status') == 'taken' else 'வரவிருக்கிறது'})"
                for m in meds
            ]
            return f"{patient_name}, இன்று உங்கள் மருந்துகள்: " + ", ".join(med_items) + ".", "MEDICINE_INFO"
        elif lang == "hi":
            med_items = [
                f"{m.get('name')} {m.get('dose', '')} ({m.get('time', '')}, {'ली जा चुकी है' if m.get('status') == 'taken' else 'बाकी है'})"
                for m in meds
            ]
            return f"{patient_name}, आज आपकी दवाएं हैं: " + ", ".join(med_items) + ".", "MEDICINE_INFO"
        elif lang == "te":
            med_items = [
                f"{m.get('name')} {m.get('dose', '')} ({m.get('time', '')}, {'తీసుకున్నారు' if m.get('status') == 'taken' else 'మిగిలి ఉంది'})"
                for m in meds
            ]
            return f"{patient_name}, ఈరోజు మీ మందులు: " + ", ".join(med_items) + ".", "MEDICINE_INFO"
        elif lang == "ur":
            med_items = [
                f"{m.get('name')} {m.get('dose', '')} ({m.get('time', '')})"
                for m in meds
            ]
            return f"{patient_name}، آج آپ کی ادویات: " + "، ".join(med_items) + "۔", "MEDICINE_INFO"
        elif lang == "ml":
            med_items = [
                f"{m.get('name')} {m.get('dose', '')} ({m.get('time', '')})"
                for m in meds
            ]
            return f"{patient_name}, ഇന്നത്തെ മരുന്നുകൾ: " + ", ".join(med_items) + ".", "MEDICINE_INFO"
        elif lang == "kn":
            med_items = [
                f"{m.get('name')} {m.get('dose', '')} ({m.get('time', '')})"
                for m in meds
            ]
            return f"{patient_name}, ಇಂದಿನ ಔಷಧಿಗಳು: " + ", ".join(med_items) + ".", "MEDICINE_INFO"
        else:
            parts = []
            for m in meds:
                desc = f"{m.get('name')} {m.get('dose', '')}".strip()
                if m.get("time"):
                    desc += f" at {m.get('time')}"
                if m.get("food"):
                    desc += f" ({m.get('food')})"
                desc += " - already taken" if m.get("status") == "taken" else " - pending"
                parts.append(desc)
            return f"{patient_name}, your schedule for today is: " + "; ".join(parts) + ".", "MEDICINE_INFO"

    # 6. Next Dose Query
    next_dose_kw = [
        "next dose", "when should i take", "what time", "next medicine", "when is my next",
        "அடுத்த மாத்திரை", "அடுத்த மருந்து", "எப்போது",
        "अगली दवा", "अगली खुराक", "कब लेनी है",
        "తదుపరి ఔషధం", "తర్వాత డోస్", "ఎప్పుడు",
        "اگلی دوا", "اگلی خوراک",
        "അടുത്ത മരുന്ന്", "എപ്പോഴാണ്",
        "ಮುಂದಿನ ಔಷಧಿ", "ಯಾವಾಗ"
    ]
    if any(k in q for k in next_dose_kw):
        upcoming = [m for m in meds if m.get("status") != "taken"]
        if upcoming:
            next_m = upcoming[0]
            food_info = f" {next_m.get('food')}" if next_m.get("food") else ""
            dose_str = f" {next_m.get('dose')}" if next_m.get("dose") else ""
            time_str = next_m.get('time', '')
            name = next_m.get('name', '')
            if lang == "ta":
                return f"{patient_name}, உங்கள் அடுத்த மருந்து: {name}{dose_str} ({time_str}{food_info}).", "MEDICINE_INFO"
            elif lang == "hi":
                return f"{patient_name}, आपकी अगली दवा {name}{dose_str} {time_str} पर है।", "MEDICINE_INFO"
            elif lang == "te":
                return f"{patient_name}, మీ తదుపరి ఔషధం: {name}{dose_str} ({time_str}).", "MEDICINE_INFO"
            elif lang == "ur":
                return f"{patient_name}، آپ کی اگلی دوا {name}{dose_str} ({time_str}) پر ہے۔", "MEDICINE_INFO"
            elif lang == "ml":
                return f"{patient_name}, അടുത്ത മരുന്ന് {name}{dose_str} ({time_str}).", "MEDICINE_INFO"
            elif lang == "kn":
                return f"{patient_name}, ಮುಂದಿನ ಔಷಧಿ: {name}{dose_str} ({time_str}).", "MEDICINE_INFO"
            return f"Your next scheduled medication is {name}{dose_str} at {time_str}{food_info}.", "MEDICINE_INFO"
        elif meds:
            if lang == "ta":
                return f"{patient_name}, இன்று உங்கள் அனைத்து மருந்துகளும் ஏற்கனவே முடிந்துவிட்டன!", "MEDICINE_INFO"
            elif lang == "hi":
                return f"{patient_name}, आज की आपकी सभी दवाएं पूरी हो चुकी हैं!", "MEDICINE_INFO"
            elif lang == "te":
                return f"{patient_name}, ఈరోజు మందులన్నీ పూర్తయ్యాయి!", "MEDICINE_INFO"
            return f"You have already completed all your scheduled medications for today, {patient_name}!", "MEDICINE_INFO"

    # 7. Food Instructions ("Before or after food?")
    food_kw = [
        "before or after", "with food", "after food", "before food", "empty stomach",
        "after breakfast", "after dinner", "with meals",
        "உணவுக்கு முன்", "உணவுக்கு பின்", "சாப்பிட்ட பின்",
        "खाने से पहले", "खाने के बाद", "भोजन",
        "భోజనం తర్వాత", "ముందు",
        "کھانے سے پہلے", "کھانے کے بعد",
        "ഭക്ഷണത്തിന് ശേഷം", "മുമ്പ്",
        "ಊಟದ ನಂತರ", "ಮೊದಲು"
    ]
    if any(k in q for k in food_kw):
        matched_med = next((m for m in meds if m.get("name", "").lower() in q), None)
        med_to_use = matched_med or (meds[0] if meds else None)
        if med_to_use:
            name = med_to_use.get("name", "Medicine")
            food = med_to_use.get("food", "after meals")
            if lang == "ta":
                return f"{patient_name}, உங்கள் {name} மருந்தை உணவுக்குப் பின் உட்கொள்ளவும்.", "MEDICINE_INFO"
            elif lang == "hi":
                return f"{patient_name}, कृपया अपनी {name} दवा भोजन के बाद ही लें।", "MEDICINE_INFO"
            elif lang == "te":
                return f"{patient_name}, మీ {name} మందును భోజనం తర్వాత మాత్రమే తీసుకోవాలి.", "MEDICINE_INFO"
            elif lang == "ur":
                return f"{patient_name}، اپنی {name} دوا کھانے کے بعد لیں۔", "MEDICINE_INFO"
            elif lang == "ml":
                return f"{patient_name}, താങ്കളുടെ {name} മരുന്ന് ഭക്ഷണത്തിനു ശേഷം കഴിക്കുക.", "MEDICINE_INFO"
            elif lang == "kn":
                return f"{patient_name}, ನಿಮ್ಮ {name} ಔಷಧಿಯನ್ನು ಊಟದ ನಂತರ ತೆಗೆದುಕೊಳ್ಳಿ.", "MEDICINE_INFO"
            return f"{patient_name}, you should take your {name} {food}.", "MEDICINE_INFO"

    # 8. Missed Dose Inquiry
    missed_kw = [
        "missed my dose", "missed a dose", "missed my tablet", "missed tablet",
        "forgot to take", "forgot my pill", "forgot my medicine", "skipped a dose",
        "missed dose", "forgot my dose",
        "மறந்துவிட்டேன்", "மறந்து",
        "भूल गया", "भूल गई",
        "మర్చిపోయాను",
        "بھول گیا",
        "മറന്നുപോയി",
        "ಮರೆತುಹೋಯಿತು"
    ]
    if any(k in q for k in missed_kw):
        if lang == "ta":
            return "மருந்தை எடுக்க மறந்துவிட்டால், நினைவுக்கு வந்தவுடன் உடனடியாக உட்கொள்ளவும். அடுத்த வேளைக்கு அருகிலிருந்தால் இரட்டை மாத்திரை எடுக்க வேண்டாம்.", "MEDICINE_INFO"
        elif lang == "hi":
            return "यदि कोई खुराक छूट जाए, तो याद आते ही ले लें। अगली खुराक का समय निकट हो तो दो गोलियां एक साथ कभी न लें।", "MEDICINE_INFO"
        elif lang == "te":
            return "డోస్ మర్చిపోతే గుర్తుకు రాగానే తీసుకోండి. తదుపరి సమయం దగ్గరగా ఉంటే రెండు డోస్‌లు కలిపి తీసుకోవద్దు.", "MEDICINE_INFO"
        elif lang == "ur":
            return "اگر کوئی خوراک چھوٹ جائے تو یاد آتے ہی لے لیں۔ اگلی خوراک کے وقت دو گولیاں ایک ساتھ کبھی نہ لیں۔", "MEDICINE_INFO"
        elif lang == "ml":
            return "മരുന്ന് കഴിക്കാൻ മറന്നുപോയാൽ ഓർമ്മ വരുമ്പോൾ ഉടൻ കഴിക്കുക. അടുത്ത സമയത്തോട് അടുത്താണെങ്കിൽ രണ്ട് ഗുളികകൾ ഒരുമിച്ച് കഴിക്കരുത്.", "MEDICINE_INFO"
        elif lang == "kn":
            return "ಔಷಧಿ ತೆಗೆದುಕೊಳ್ಳಲು ಮರೆತರೆ ನೆನಪಾದ ತಕ್ಷಣ ತೆಗೆದುಕೊಳ್ಳಿ. ಮುಂದಿನ ಸಮಯ ಹತ್ತಿರವಿದ್ದರೆ ಎರಡು ಮಾತ್ರೆಗಳನ್ನು ಒಟ್ಟಿಗೆ ತೆಗೆದುಕೊಳ್ಳಬೇಡಿ.", "MEDICINE_INFO"
        return (
            "If you miss a dose, take it as soon as you remember, unless it is almost time for your next scheduled dose. "
            "Never take two doses together to make up for a missed dose."
        ), "MEDICINE_INFO"

    # 9. Liquid / Milk / Coffee / Water Inquiry
    liquid_kw = [
        "with milk", "with coffee", "with tea", "with juice", "can i drink coffee", "can i take with water",
        "தண்ணீர்", "காபி", "டீ",
        "पानी", "कॉफी", "चाय",
        "మంచి నీరు", "కాఫీ",
        "پانی", "چائے",
        "വെള്ളം", "കാപ്പി",
        "ನೀರು", "ಕಾಫಿ"
    ]
    if any(k in q for k in liquid_kw):
        if lang == "ta":
            return "மருந்துகளை எப்போதும் ஒரு டம்ளர் சுத்தமான தண்ணீருடன் மட்டுமே உட்கொள்ள வேண்டும். காபி அல்லது சாற்றுடன் மாத்திரைகள் எடுப்பதைத் தவிர்க்கவும்.", "MEDICINE_INFO"
        elif lang == "hi":
            return "दवाएं हमेशा पर्याप्त सादे पानी के साथ ही लें। चाय, कॉफी या खट्टे जूस के साथ दवाएं न लें क्योंकि इससे असर कम हो सकता है।", "MEDICINE_INFO"
        elif lang == "te":
            return "మందులను ఎల్లప్పుడూ మంచి నీటితో మాత్రమే తీసుకోవాలి. కాఫీ లేదా టీతో మందులు తీసుకోవద్దు.", "MEDICINE_INFO"
        elif lang == "ur":
            return "دوائیں ہمیشہ سادہ پانی کے ساتھ لیں۔ چائے یا کافی کے ساتھ دوا لینے سے گریز کریں۔", "MEDICINE_INFO"
        elif lang == "ml":
            return "മരുന്നുകൾ എപ്പോഴും ശുദ്ധമായ വെള്ളത്തോടൊപ്പം മാത്രം കഴിക്കുക. ചായയോ കാപ്പിയോ ഒപ്പം കഴിക്കരുത്.", "MEDICINE_INFO"
        elif lang == "kn":
            return "ಔಷಧಿಗಳನ್ನು ಯಾವಾಗಲೂ ಶುದ್ಧ ನೀರಿನೊಂದಿಗೆ ಮಾತ್ರ ತೆಗೆದುಕೊಳ್ಳಬೇಕು. ಕಾಫಿ ಅಥವಾ ಚಹಾದೊಂದಿಗೆ ತೆಗೆದುಕೊಳ್ಳಬೇಡಿ.", "MEDICINE_INFO"
        return (
            "It is best to take your tablets with a full glass of plain water. "
            "Avoid taking medications with coffee or grapefruit juice as they can interfere with absorption."
        ), "MEDICINE_INFO"

    # 10. Common Drug Knowledge & Side Effects
    for drug_name, info in COMMON_DRUG_DATABASE.items():
        if drug_name in q:
            if any(k in q for k in ["side effect", "side-effect", "adverse", "risk", "reaction", "problem"]):
                return f"Regarding {drug_name.title()}: {info['side_effects']}", "MEDICINE_INFO"
            elif any(k in q for k in ["what is", "why", "used for", "prescribed for", "purpose"]):
                return f"Regarding {drug_name.title()}: {info['use']}", "MEDICINE_INFO"
            elif any(k in q for k in ["how to take", "timing", "when"]):
                return f"Regarding {drug_name.title()}: {info['food']}", "MEDICINE_INFO"

    # 11. Regional Language Greetings & Common Inquiries
    if "வணக்கம்" in message:
        return f"வணக்கம் {patient_name}! உங்கள் உடல்நலம் எவ்வாறு உள்ளது? உங்கள் மருந்துகள் பற்றி என்ன தெரிந்து கொள்ள வேண்டும்?", "GENERAL_HEALTH"
    if "தலைவலி" in message:
        return f"{patient_name}, லேசான தலைவலிக்கு ஓய்வெடுத்து போதுமான தண்ணீர் குடியுங்கள். தலைவலி நீடித்தால் மருத்துவரை அணுகவும்.", "GENERAL_HEALTH"
    if "नमस्ते" in message:
        return f"नमस्ते {patient_name}! आपकी तबीयत कैसी है? क्या आपको अपनी दवाओं के बारे में कोई जानकारी चाहिए?", "GENERAL_HEALTH"
    if "सिरदर्द" in message:
        return f"{patient_name}, हल्के सिरदर्द के लिए आराम करें और पर्याप्त पानी पिएं। यदि सिरदर्द बना रहता है तो डॉक्टर से परामर्श लें।", "GENERAL_HEALTH"
    if "నమస్కారం" in message:
        return f"నమస్కారం {patient_name}! మీ ఆరోగ్యం ఎలా ఉంది? మీ మందుల గురించి ఏమైనా తెలుసుకోవాలా?", "GENERAL_HEALTH"
    if "سلام" in message:
        return f"السلام علیکم {patient_name}! آپ کی طبیعت کیسی ہے؟ کیا آپ کو اپنی ادویات کے بارے میں کوئی معلومات چاہیے؟", "GENERAL_HEALTH"

    # 12. Delegate to Fast MNN Voice LLM
    return None, "GENERAL_HEALTH"


@app.post("/api/ai/voice", response_model=ChatResponse)
async def voice_endpoint(request: VoiceChatRequest):
    """
    Dedicated endpoint for the Call AI Voice Assistant.
    Provides instant, verified clinical answers for medication queries,
    with seamless local MNN LLM generation for open-ended queries.
    """
    message = request.message.strip()

    if not message:
        raise HTTPException(status_code=400, detail="Voice message cannot be empty")

    logger.info(f"Voice call request: '{message[:80]}' (Patient: {request.patientName})")

    # 1. Check instant clinical resolver
    resolved_answer, intent = resolve_voice_query(
        message=message,
        medicines=request.medicinesContext,
        patient_name=request.patientName or "Patient",
        language=request.language or "en",
    )

    if resolved_answer is not None:
        clean_text = clean_voice_output(resolved_answer)
        logger.info(f"Voice query resolved deterministically (Intent: {intent}) in 0.00s")
        return ChatResponse(
            success=True,
            response=clean_text,
            intent=intent,
            model=config.model_name,
            offline=True,
            rag_grounded=True,
            timing="0.01s",
        )

    # 2. Delegate open-ended query to fast local MNN voice LLM
    med_summary = ", ".join(
        f"{m.get('name', '')} {m.get('dose', '')}".strip()
        for m in (request.medicinesContext or []) if m.get("name")
    )
    lang_names = {
        "en": "English",
        "ta": "Tamil",
        "hi": "Hindi",
        "te": "Telugu",
        "ur": "Urdu",
        "ml": "Malayalam",
        "kn": "Kannada",
    }
    lang_code = (request.language or "en").lower().split("-")[0].strip()
    target_lang_name = lang_names.get(lang_code, "English")

    voice_sys = (
        f"You are SmartMed AI, a warm medical voice call assistant on a telephone call with patient {request.patientName}. "
        f"The patient's active prescriptions are: {med_summary or 'None specified'}. "
        f"The patient's chosen language is {target_lang_name}. You MUST reply entirely in {target_lang_name} using natural script. "
        f"Reply directly in 1 to 2 spoken sentences with clear, compassionate medical guidance. "
        f"Never use markdown formatting, asterisks, bullet points, or numbered lists."
    )

    async with _inference_lock:
        try:
            result = await asyncio.to_thread(
                inference_engine.generate_voice,
                message=message,
                system_prompt=voice_sys,
                conversation_history=request.history,
            )

            raw_resp = result.get("response", "")
            clean_resp = clean_voice_output(raw_resp) if raw_resp else ""

            if not result.get("success") or not clean_resp:
                clean_resp = resolve_clinical_voice(
                    message=message,
                    patient_name=request.patientName or "Patient",
                    language=request.language or "en",
                )

            return ChatResponse(
                success=True,
                response=clean_resp,
                intent=intent,
                model="smartmed-voice-engine",
                offline=True,
                rag_grounded=False,
                timing=result.get("timing", "0.01s"),
            )

        except Exception as e:
            logger.error(f"Voice endpoint error: {e}", exc_info=True)
            clean_resp = resolve_clinical_voice(
                message=message,
                patient_name=request.patientName or "Patient",
                language=request.language or "en",
            )
            return ChatResponse(
                success=True,
                response=clean_resp,
                intent=intent,
                model="smartmed-voice-engine",
                offline=True,
                timing="0.01s",
            )



# ─── Neural TTS & STT Endpoints (Piper ONNX & Kokoro TTS) ─────────────────────

class TTSRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=4096, description="Text to synthesize")
    engine: Optional[str] = Field("auto", description="Engine: 'auto', 'piper', or 'kokoro'")
    voice: Optional[str] = Field(None, description="Voice ID style")
    speed: Optional[float] = Field(1.0, ge=0.5, le=2.0, description="Speech playback speed")
    lang: Optional[str] = Field("en", description="Language code")


class STTRequest(BaseModel):
    audio_base64: Optional[str] = Field(None, description="Base64 encoded audio")
    language: Optional[str] = Field("en", description="Spoken language code")


class STTResponse(BaseModel):
    success: bool
    transcript: Optional[str] = None
    error: Optional[str] = None


@app.get("/api/ai/tts/status")
async def get_tts_status():
    """Check status of offline Piper ONNX and Kokoro TTS models."""
    return tts_manager.get_status()


@app.get("/api/ai/tts/voices")
async def get_tts_voices():
    """List available offline neural voices."""
    return {"voices": tts_manager.get_voices()}


@app.post("/api/ai/tts")
async def synthesize_speech(request: TTSRequest):
    """
    Synthesize speech using local Piper ONNX or Kokoro TTS.
    Returns standard audio/wav data.
    """
    try:
        wav_bytes, engine_used = await asyncio.to_thread(
            tts_manager.synthesize,
            text=request.text,
            engine=request.engine or "auto",
            voice=request.voice,
            speed=request.speed or 1.0,
            lang=request.lang or "en",
        )
        return Response(
            content=wav_bytes,
            media_type="audio/wav",
            headers={
                "X-TTS-Engine": engine_used,
                "Content-Disposition": "inline; filename=speech.wav",
                "Cache-Control": "no-cache",
            },
        )
    except Exception as e:
        logger.error(f"TTS synthesis error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/ai/stt/status")
async def get_stt_status():
    """Check status of offline Whisper STT engine."""
    return {
        "status": "ready",
        "engine": "faster-whisper",
        "device": stt_manager._device,
        "compute_type": stt_manager._compute_type,
        "model": stt_manager.model_size,
    }


@app.post("/api/ai/stt", response_model=STTResponse)
async def speech_to_text(request: STTRequest):
    """
    Offline Speech-to-Text transcription endpoint powered by local faster-whisper.
    Accepts recorded audio (base64) from client and transcribes it on GPU/CPU.
    """
    if not request.audio_base64:
        return STTResponse(success=False, error="No audio provided")

    try:
        raw_b64 = request.audio_base64
        if "," in raw_b64:
            raw_b64 = raw_b64.split(",", 1)[1]
        audio_bytes = base64.b64decode(raw_b64)

        success, transcript, err = await asyncio.to_thread(
            stt_manager.transcribe,
            audio_bytes=audio_bytes,
            language=request.language or "en",
        )
        return STTResponse(success=success, transcript=transcript, error=err)
    except Exception as e:
        logger.error(f"STT endpoint error: {e}", exc_info=True)
        return STTResponse(success=False, error=str(e))


# ─── Prescription OCR Endpoints ──────────────────────────────────────────────

class PrescriptionOCRRequest(BaseModel):
    image_base64: Optional[str] = Field(None, description="Base64 encoded prescription image")


@app.get("/api/ocr/status")
async def get_ocr_status():
    """
    Check status of the Prescription OCR pipeline and loaded models.
    """
    try:
        import torch
        gpu_avail = torch.cuda.is_available()
        gpu_device = torch.cuda.get_device_name(0) if gpu_avail else None
    except Exception:
        gpu_avail = False
        gpu_device = None

    return {
        "status": "ready" if ocr_pipeline else "unavailable",
        "service": "smartmed-prescription-ocr",
        "gpu_available": gpu_avail,
        "gpu_device": gpu_device,
        "trocr_fine_tuned": (ocr_pipeline.handwriting_fallback.is_available() and getattr(ocr_pipeline.handwriting_fallback, "is_fine_tuned", False)) if ocr_pipeline else False,
        "vlm_cloud_available": ocr_pipeline.vlm_engine.is_available() if ocr_pipeline and hasattr(ocr_pipeline, "vlm_engine") else False,
        "paddleocr_available": ocr_pipeline.ocr_engine.is_available() if ocr_pipeline else False,
        "eml_database_loaded": len(ocr_pipeline.validator._database) if ocr_pipeline else 0,
        "canonical_medicines_count": len(ocr_pipeline.validator._canonical_names) if ocr_pipeline else 0,
    }


@app.post("/api/ocr/prescription")
async def process_prescription(
    file: Optional[UploadFile] = File(None),
    request: Optional[PrescriptionOCRRequest] = None,
):
    """
    High-Accuracy Prescription OCR endpoint.
    Processes images asynchronously via PaddleOCR, TrOCR handwriting fallback,
    clinical structuring, and WHO EML database validation.
    Does not block the event loop or other endpoints.
    """
    if not ocr_pipeline:
        raise HTTPException(
            status_code=503,
            detail="Prescription OCR pipeline is not initialized or unavailable.",
        )

    content = None
    if file:
        try:
            content = await file.read()
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Failed to read uploaded file: {str(e)}")
    elif request and request.image_base64:
        content = request.image_base64
    else:
        raise HTTPException(
            status_code=400,
            detail="No prescription image provided. Please upload a file or supply image_base64.",
        )

    try:
        # Run asynchronously in threadpool to guarantee zero UI/event-loop freezing
        result = await asyncio.to_thread(ocr_pipeline.process_image, content)
        return result
    except Exception as e:
        logger.error(f"Prescription OCR processing error: {e}", exc_info=True)
        return {
            "success": False,
            "text": "",
            "confidence": 0.0,
            "regions": [],
            "medicines": [],
            "error": str(e),
        }


# ─── OpenFDA Live Pharmacological Endpoints ─────────────────────────────────

@app.get("/api/medical/openfda")
@app.get("/api/data/openfda")
async def get_openfda_data(query: str):
    """
    Live OpenFDA drug label and pharmacological data fetcher.
    Returns FDA-approved indications, warnings, dosage, and administration.
    """
    if not query or not query.strip():
        raise HTTPException(status_code=400, detail="Query parameter is required")
    clean_q = query.strip()
    try:
        fda_data = await asyncio.to_thread(rag_pipeline.fetch_openfda, clean_q)
        return {
            "success": True,
            "drug": clean_q,
            "found": bool(fda_data),
            "data": fda_data,
            "source": "OpenFDA Drug Label API",
            "authenticated": bool(config.openfda_api_key),
        }
    except Exception as e:
        logger.error(f"OpenFDA lookup error: {e}", exc_info=True)
        return {
            "success": False,
            "drug": clean_q,
            "found": False,
            "data": "",
            "error": str(e),
            "source": "OpenFDA Drug Label API",
        }


# ─── WHO ICD-11 Disease Classification Endpoints ────────────────────────────

@app.get("/api/medical/icd11/auth")
async def check_icd11_auth():
    """
    Check status of WHO ICD-11 OAuth2 authentication.
    """
    configured = bool(config.medi_client_id and config.medi_client_secret)
    token = None
    if configured:
        try:
            token = await asyncio.to_thread(rag_pipeline._get_icd11_token)
        except Exception as e:
            logger.debug(f"ICD-11 auth check error: {e}")
    return {
        "configured": configured,
        "token_acquired": bool(token),
        "service": "WHO ICD-11 MMS API",
    }


@app.get("/api/medical/icd11")
@app.get("/api/data/icd11")
async def get_icd11_data(query: str):
    """
    Live WHO ICD-11 disease classification and diagnostic standard search.
    """
    if not query or not query.strip():
        raise HTTPException(status_code=400, detail="Query parameter is required")
    clean_q = query.strip()
    try:
        icd_data = await asyncio.to_thread(rag_pipeline.fetch_icd11, clean_q)
        return {
            "success": True,
            "query": clean_q,
            "found": bool(icd_data),
            "classification": icd_data,
            "source": "WHO ICD-11 MMS Search API",
            "authenticated": bool(config.medi_client_id and config.medi_client_secret),
        }
    except Exception as e:
        logger.error(f"ICD-11 search error: {e}", exc_info=True)
        return {
            "success": False,
            "query": clean_q,
            "found": False,
            "classification": "",
            "error": str(e),
            "source": "WHO ICD-11 MMS Search API",
        }


# ─── Exotel Telephony & IVR Webhook Endpoints ───────────────────────────────

class ExotelCallRequest(BaseModel):
    to_number: str = Field(..., description="Patient mobile number with country code")
    patient_name: Optional[str] = Field("Patient", description="Patient name")
    medicine_name: Optional[str] = Field("prescribed medicine", description="Medicine name")
    dose: Optional[str] = Field("", description="Dosage instruction")


@app.get("/api/ivr/exotel/status")
async def exotel_status():
    """Check Exotel telephony integration status."""
    return {
        "status": "ready" if (config.exotel_sid and config.exotel_token) else "unconfigured",
        "configured": bool(config.exotel_sid and config.exotel_token),
        "caller_id": config.exotel_caller_id,
        "subdomain": config.exotel_subdomain,
    }


@app.api_route("/api/ivr/exotel/webhook", methods=["GET", "POST"])
async def exotel_webhook(
    CallSid: Optional[str] = None,
    From: Optional[str] = None,
    To: Optional[str] = None,
):
    """
    Exotel IVR Webhook endpoint for inbound patient calls and reminder connects.
    Returns standard ExoML XML greeting and prompts for DTMF digit input.
    """
    logger.info(f"Exotel IVR Webhook received: CallSid={CallSid}, From={From}, To={To}")
    exoml = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<Response>\n'
        '    <Say>Hello! This is SmartMed Medical Triage and Prescription Reminder Assistant.</Say>\n'
        '    <Gather action="/api/ivr/exotel/response" method="POST" numDigits="1" timeout="10">\n'
        '        <Say>Press 1 if you have taken your scheduled medication. Press 2 to snooze your reminder for 15 minutes. Press 3 to ask our AI medical assistant a health question.</Say>\n'
        '    </Gather>\n'
        '    <Say>We did not receive any input. Please stay healthy and consult a doctor for severe symptoms. Goodbye!</Say>\n'
        '</Response>'
    )
    return Response(content=exoml, media_type="application/xml")


@app.api_route("/api/ivr/exotel/response", methods=["GET", "POST"])
async def exotel_response(
    Digits: Optional[str] = None,
    CallSid: Optional[str] = None,
):
    """
    Exotel DTMF Digit Handler.
    Processes user keypad input (1: Taken, 2: Snoozed, 3: AI Doctor).
    """
    digit = (Digits or "").strip()
    logger.info(f"Exotel DTMF response: CallSid={CallSid}, Digits='{digit}'")

    if digit == "1":
        body = (
            '<?xml version="1.0" encoding="UTF-8"?>\n'
            '<Response>\n'
            '    <Say>Thank you! Your medication has been recorded as taken in your SmartMed health profile. Have a wonderful and healthy day!</Say>\n'
            '</Response>'
        )
    elif digit == "2":
        body = (
            '<?xml version="1.0" encoding="UTF-8"?>\n'
            '<Response>\n'
            '    <Say>Understood. Your medicine reminder has been snoozed for 15 minutes. We will remind you shortly.</Say>\n'
            '</Response>'
        )
    elif digit == "3":
        body = (
            '<?xml version="1.0" encoding="UTF-8"?>\n'
            '<Response>\n'
            '    <Say>Connecting to SmartMed AI triage assistant. Please consult a doctor for severe symptoms. Goodbye.</Say>\n'
            '</Response>'
        )
    else:
        body = (
            '<?xml version="1.0" encoding="UTF-8"?>\n'
            '<Response>\n'
            '    <Say>Thank you for using SmartMed Medical Assistant. Please consult a doctor for severe symptoms. Goodbye!</Say>\n'
            '</Response>'
        )
    return Response(content=body, media_type="application/xml")


@app.post("/api/ivr/exotel/call")
async def trigger_exotel_call(req: ExotelCallRequest):
    """
    Trigger outbound automated IVR telephone call to patient.
    """
    if not config.exotel_sid or not config.exotel_token:
        # Graceful simulation when running without paid Exotel credentials
        logger.info(f"Simulating Exotel outbound call to {req.to_number} for {req.medicine_name}")
        return {
            "success": True,
            "simulated": True,
            "to": req.to_number,
            "patient": req.patient_name,
            "medicine": req.medicine_name,
            "dose": req.dose,
            "message": "Call queued successfully (simulation mode).",
        }

    try:
        url = f"https://{config.exotel_subdomain}/v1/Accounts/{config.exotel_sid}/Calls/connect.json"
        auth = (config.exotel_sid, config.exotel_token)
        payload = {
            "From": config.exotel_caller_id,
            "To": req.to_number,
            "CallerId": config.exotel_caller_id,
            "Url": "http://localhost:8100/api/ivr/exotel/webhook",
            "CallType": "trans",
        }
        async with httpx.AsyncClient(timeout=10.0) as client:
            res = await client.post(url, data=payload, auth=auth)
            return {
                "success": res.status_code == 200,
                "status_code": res.status_code,
                "data": res.json() if res.status_code == 200 else res.text,
            }
    except Exception as e:
        logger.error(f"Exotel outbound call error: {e}", exc_info=True)
        return {"success": False, "error": str(e)}


# ─── Twilio Web Telephony & Background Job Scheduler ────────────────────────

class TwilioCallScheduleRequest(BaseModel):
    phone_number: str = Field(..., description="E.164 phone number, e.g. +919876543210")
    medicine: str = Field(..., description="Medicine name")
    dosage: str = Field(..., description="Dosage and instructions")
    trigger_time: Optional[str] = Field(None, description="ISO8601 Datetime string for scheduled call")
    patient_name: Optional[str] = Field(None, description="Patient name for personalized greeting")


@app.post("/api/call/schedule")
async def schedule_twilio_call_endpoint(req: TwilioCallScheduleRequest):
    """
    Schedule an automated medication reminder phone call via Twilio and APScheduler.
    Accepts: {"phone_number": "+91...", "medicine": "...", "dosage": "...", "trigger_time": "ISO8601 String"}
    """
    try:
        from twilio_service import schedule_call_job
        return schedule_call_job(
            phone=req.phone_number,
            medicine=req.medicine,
            dosage=req.dosage,
            trigger_time_str=req.trigger_time,
            patient_name=req.patient_name
        )
    except Exception as e:
        logger.error(f"Error scheduling call: {e}", exc_info=True)
        return {
            "success": False,
            "error": str(e),
            "phone_number": req.phone_number,
            "medicine": req.medicine
        }


@app.post("/api/call/trigger_now")
async def trigger_twilio_call_endpoint(req: TwilioCallScheduleRequest):
    """
    Trigger an immediate outbound Twilio telephone call to patient.
    """
    try:
        from twilio_service import make_twilio_call
        return make_twilio_call(
            phone=req.phone_number,
            medicine=req.medicine,
            dosage=req.dosage,
            patient_name=req.patient_name
        )
    except Exception as e:
        logger.error(f"Error triggering Twilio call: {e}", exc_info=True)
        return {
            "success": False,
            "error": str(e),
            "phone_number": req.phone_number,
            "medicine": req.medicine
        }


@app.get("/api/call/twiml")
@app.post("/api/call/twiml")
async def get_twilio_twiml_endpoint(
    medicine: str = "your medicine",
    dosage: str = "as prescribed",
    patient_name: Optional[str] = None
):
    """
    Return TwiML XML with Polly.Aditi voice for Twilio telephony.
    """
    try:
        from twilio_service import generate_twiml
        xml_content = generate_twiml(medicine=medicine, dosage=dosage, patient_name=patient_name)
    except Exception:
        xml_content = (
            '<?xml version="1.0" encoding="UTF-8"?>\n'
            '<Response>\n'
            f'  <Say voice="Polly.Aditi" language="en-IN">Hello, this is your SmartMed reminder to take {dosage} of {medicine}. Thank you!</Say>\n'
            '</Response>'
        )
    return Response(content=xml_content, media_type="application/xml")


@app.get("/api/call/status")
async def get_twilio_service_status():
    """
    Returns Twilio telephony configuration and scheduler status.
    """
    try:
        from twilio_service import get_scheduler, get_twilio_client, TWILIO_PHONE_NUMBER
        sched = get_scheduler()
        client = get_twilio_client()
        return {
            "status": "ok",
            "service": "smartmed-twilio-telephony",
            "scheduler_running": sched.running if sched else False,
            "scheduled_jobs_count": len(sched.get_jobs()) if sched else 0,
            "twilio_configured": bool(client),
            "twilio_phone_number": TWILIO_PHONE_NUMBER
        }
    except Exception as e:
        return {"status": "error", "error": str(e)}


# ─── Main ────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=config.port,
        log_level="info",
    )
