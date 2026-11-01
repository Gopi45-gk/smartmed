"""
SmartMed Voice Companion - Medical Intelligence Engine
Coordinates:
- Query intent classification
- Medical RAG knowledge retrieval (EML, OpenFDA, RxNorm)
- Patient clinical context injection
- Qwen2.5-Instruct (MNN inference) / MedAssist Triage
- Medical safety and emergency evaluation
"""

import logging
from typing import Dict, Any, List, Optional

from .patient_context import patient_context_service
from .medical_safety import medical_safety
from .language_handler import normalize_language_code, get_language_name

logger = logging.getLogger("smartmed.ai.voice.intelligence")


class MedicalIntelligenceEngine:
    """
    High-level clinical intelligence engine for the interactive voice companion.
    """

    def generate_reply(
        self,
        query: str,
        language: str = "en",
        conversation_history: Optional[List[Dict[str, str]]] = None,
        patient_profile: Optional[Dict[str, Any]] = None,
        medicines: Optional[List[Dict[str, Any]]] = None,
        caregivers: Optional[List[Dict[str, Any]]] = None,
        latest_glucose: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        Processes a medical query through safety check, context retrieval,
        knowledge grounding, LLM inference, and safety sanitization.
        """
        lang = normalize_language_code(language)
        lang_name = get_language_name(lang)

        # 1. Immediate Critical Emergency Safety Check
        is_emergency, emergency_advisory = medical_safety.check_emergency_symptoms(query, language=lang)
        if is_emergency and emergency_advisory:
            return {
                "response_text": emergency_advisory,
                "is_emergency": True,
                "suggest_sos": True,
                "emergency_number": "112",
                "intent": "EMERGENCY_ESCALATION",
                "grounded": True,
            }

        # 2. Build verified Patient Clinical Context
        patient_ctx = patient_context_service.build_context_summary(
            profile=patient_profile,
            frontend_medicines=medicines,
            frontend_caregivers=caregivers,
            frontend_glucose=latest_glucose,
        )

        # 3. Retrieve Medical Knowledge Context from Local RAG (WHO EML / Pharmacological)
        rag_context = ""
        try:
            from rag.pipeline import rag_pipeline
            rag_context = rag_pipeline.get_context(query)
        except Exception as e:
            logger.debug(f"RAG context retrieval note: {e}")

        # 4. Construct System & User Prompt for Qwen2.5 / Clinical Triage
        system_instructions = (
            f"You are SmartMed Voice Companion, an empathetic, clear, and highly accurate AI medical assistant for elderly patients.\n"
            f"CRITICAL RULES:\n"
            f"1. Respond entirely and exclusively in {lang_name} ({lang}) native script. Do NOT mix languages.\n"
            f"2. Answer in 2 to 3 concise, clear sentences first, using simple words suitable for an elderly listener.\n"
            f"3. Base answers strictly on the verified patient context and medical facts provided below. Do NOT invent medication doses or glucose values.\n"
            f"4. If asked about taking or missing medication, refer strictly to their scheduled list.\n"
            f"5. If information is not in the records, politely state that it is not recorded and advise consulting their doctor or pharmacist.\n"
            f"6. For severe symptoms, prioritize safety and advise consulting a healthcare professional.\n\n"
            f"{patient_ctx}\n"
        )
        if rag_context:
            system_instructions += f"\n[VERIFIED MEDICAL KNOWLEDGE]\n{rag_context}\n"

        # 5. Generate Response via MNN / Local Triage Pipeline
        raw_response = ""
        try:
            from mnn.inference import MNNInference
            mnn = MNNInference()
            raw_response = mnn.generate(
                message=query,
                conversation_history=conversation_history,
                rag_context=system_instructions,
                preferred_language=lang,
            )
        except Exception as mnn_err:
            logger.warning(f"MNN inference note ({mnn_err}); using clinical triage fallback.")
            try:
                from clinical_triage import clinical_triage
                triage_res = clinical_triage.evaluate(
                    query=query,
                    preferred_language=lang,
                    patient_context=patient_ctx,
                )
                raw_response = triage_res.get("response", "")
            except Exception as triage_err:
                logger.error(f"Triage fallback also failed: {triage_err}")

        # 6. Fallback Rule-based Intelligent Responses if LLM engine is unavailable
        if not raw_response or len(raw_response.strip()) < 5:
            raw_response = self._generate_rule_based_reply(query, lang, medicines, latest_glucose)

        # 7. Apply Medical Safety Sanitization
        sanitized_response = medical_safety.sanitize_medical_response(raw_response, language=lang)

        return {
            "response_text": sanitized_response,
            "is_emergency": False,
            "suggest_sos": False,
            "intent": "MEDICAL_CONSULTATION",
            "grounded": bool(rag_context or patient_ctx),
        }

    def _generate_rule_based_reply(
        self,
        query: str,
        lang: str,
        medicines: Optional[List[Dict[str, Any]]] = None,
        latest_glucose: Optional[Dict[str, Any]] = None,
    ) -> str:
        """Intelligent offline fallback replies based on patient data."""
        q_lower = query.lower()

        # Medicine schedule query
        if any(w in q_lower for w in ["medicine", "tablet", "pill", "மருந்து", "दवा", "మందు"]):
            if medicines and len(medicines) > 0:
                first = medicines[0]
                name = first.get("name", "prescribed medicine")
                time = first.get("time", "scheduled time")
                food = first.get("food", "as advised")
                if lang == "ta":
                    return f"உங்கள் மருந்து அட்டவணையின்படி, அடுத்த மருந்து {name}. இதை {time} மணிக்கு ({food}) உட்கொள்ள வேண்டும்."
                elif lang == "hi":
                    return f"आपकी दवा अनुसूची के अनुसार, अगली दवा {name} है। इसे {time} पर ({food}) लेना है।"
                elif lang == "te":
                    return f"మీ మందుల షెడ్యూల్ ప్రకారం, తదుపరి మందు {name}. దీన్ని {time} వద్ద తీసుకోవాలి."
                else:
                    return f"According to your saved prescription schedule, your upcoming medicine is {name} at {time} ({food})."
            else:
                if lang == "ta":
                    return "உங்கள் தற்போதைய மருந்து அட்டவணையில் புதிய மருந்துகள் எதுவும் பதிவு செய்யப்படவில்லை. மருத்துவரை அணுகவும்."
                elif lang == "hi":
                    return "आपकी वर्तमान अनुसूची में कोई दवा दर्ज नहीं है। कृपया अपने डॉक्टर से संपर्क करें।"
                else:
                    return "There are no active medicines recorded on your schedule. Please verify with your doctor or pharmacist."

        # Blood sugar / Glucose query
        if any(w in q_lower for w in ["sugar", "glucose", "சர்க்கரை", "शुगर", "గ్లూకోజ్"]):
            if latest_glucose:
                val = latest_glucose.get("glucose_value") or latest_glucose.get("value")
                if lang == "ta":
                    return f"உங்கள் சமீபத்திய ரத்த சர்க்கரை அளவு {val} mg/dL ஆகும். சீரான உணவு முறையைப் பின்பற்றி தொடர்ந்து கண்காணிக்கவும்."
                elif lang == "hi":
                    return f"आपका नवीनतम रक्त शर्करा स्तर {val} mg/dL है। नियमित आहार लें और समय पर जांच करते रहें।"
                else:
                    return f"Your latest logged blood glucose reading is {val} mg/dL. Please continue following your recommended meal schedule."
            else:
                if lang == "ta":
                    return "சமீபத்திய சர்க்கரை அளவு எதுவும் பதிவு செய்யப்படவில்லை. குளுக்கோஸ் பகுதியில் உங்கள் அளவை பதிவு செய்யவும்."
                else:
                    return "No recent blood sugar reading is currently logged. You can log your glucose levels in the Glucose Tracking portal."

        # General wellness query
        if lang == "ta":
            return "உங்கள் உடல்நலம் மிக முக்கியம். போதுமான அளவு தண்ணீர் குடித்து, சரியான நேரத்தில் உணவும் மருந்துகளும் எடுத்துக்கொள்ளுங்கள்."
        elif lang == "hi":
            return "आपका स्वास्थ्य महत्वपूर्ण है। पर्याप्त पानी पिएं, समय पर पौष्टिक भोजन करें और निर्धारित दवाएं लें।"
        else:
            return "Taking care of your health every day is important. Remember to drink adequate water, rest comfortably, and take your prescribed medicines on time."


medical_intelligence_engine = MedicalIntelligenceEngine()
