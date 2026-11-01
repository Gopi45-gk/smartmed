"""
SmartMed Emergency Assistance System - Interactive Emergency Voice Module
Provides empathetic multilingual voice prompts using Kokoro TTS,
critical emergency symptom recognition, and immediate safety guidance.
"""

import base64
import logging
from typing import Dict, Any, Tuple, Optional
from tts.manager import tts_manager

logger = logging.getLogger("smartmed.ai.emergency.voice")

# Emergency Reassurance Voice Prompts by Language
# Emergency Reassurance Voice Prompts by Language (Strictly matching SmartMed SOS spec)
EMERGENCY_REASSURANCE_PROMPTS = {
    "en": (
        "Your SOS emergency request has been activated. I am contacting your caregiver now. "
        "Please stay calm. Help is being requested. Can you tell me what happened?"
    ),
    "ta": (
        "உங்கள் அவசர உதவி கோரிக்கை செயல்படுத்தப்பட்டுள்ளது. "
        "உங்கள் பராமரிப்பாளரை இப்போது தொடர்பு கொள்கிறேன். தயவுசெய்து அமைதியாக இருங்கள். "
        "என்ன நடந்தது என்று என்னிடம் சொல்லுங்கள்."
    ),
    "hi": (
        "आपका आपातकालीन अनुरोध सक्रिय कर दिया गया है। "
        "मैं आपके देखभालकर्ता से संपर्क कर रहा हूँ। कृपया शांत रहें। मदद का अनुरोध किया जा रहा है। "
        "क्या आप मुझे बता सकते हैं कि क्या हुआ?"
    ),
    "te": (
        "మీ అత్యవసర అభ్యర్థన సక్రియం చేయబడింది. "
        "నేను మీ సంరక్షకుడిని ఇప్పుడు సంప్రదిస్తున్నాను. దయచేసి ప్రశాంతంగా ఉండండి. సహాయం అభ్యర్థించబడుతోంది. "
        "ఏమి జరిగిందో నాకు చెప్పగలరా?"
    ),
    "bn": (
        "আপনার SOS জরুরি অনুরোধ সক্রিয় করা হয়েছে। "
        "আমি আপনার যত্নশীল ব্যক্তির সাথে যোগাযোগ করছি। দয়া করে শান্ত থাকুন। "
        "কি হয়েছে আমাকে বলতে পারেন?"
    ),
    "mr": (
        "तुमची SOS आणीबाणी विनंती सक्रिय केली आहे. "
        "मी तुमच्या काळजीवाहूशी संपर्क साधत आहे. कृपया शांत राहा. "
        "काय झाले ते मला सांगू शकता का?"
    ),
    "ur": (
        "آپ کی SOS ہنگامی درخواست فعال کر دی گئی ہے۔ "
        "میں آپ کے نگہداشت کنندہ سے رابطہ کر رہا ہوں۔ براہ کرم پرسکون رہیں۔ "
        "کیا آپ مجھے بتا سکتے ہیں کہ کیا ہوا؟"
    ),
    "kn": (
        "ನಿಮ್ಮ SOS ತುರ್ತು ವಿನಂತಿಯನ್ನು ಸಕ್ರಿಯಗೊಳಿಸಲಾಗಿದೆ. "
        "ನಾನು ನಿಮ್ಮ ಆರೈಕೆದಾರರನ್ನು ಸಂಪರ್ಕಿಸುತ್ತಿದ್ದೇನೆ. ದಯವಿಟ್ಟು ಶಾಂತರಾಗಿರಿ. "
        "ಏನಾಯಿತು ಎಂದು ನನಗೆ ಹೇಳಬಹುದೇ?"
    ),
}

# Critical Life-Threat Symptoms & Guidance
CHEST_PAIN_KEYWORDS = [
    "chest pain", "heart attack", "chest pressure", "chest tightness", "pain in chest",
    "நெஞ்சு வலி", "மார்பு வலி", "இதய வலி",
    "सीने में दर्द", "छाती में दर्द", "दिल का दौरा",
    "ఛాతీ నొప్పి", "గుండె నొప్పి",
]

DIZZY_KEYWORDS = [
    "dizzy", "dizziness", "lightheaded", "feeling faint", "spinning head",
    "தலைச்சுற்றல்", "மயக்கம்", "மயக்கமாக உள்ளது",
    "चक्कर", "सिर घूम रहा है", "बेहोशी",
    "తల తిరుగుతోంది", "కళ్ళు తిరుగుతున్నాయి",
]

BREATHING_STROKE_KEYWORDS = [
    "difficulty breathing", "shortness of breath", "cannot breathe", "breathless", "choking",
    "மூச்சு திணறல்", "மூச்சு விட முடியவில்லை",
    "सांस लेने में तकलीफ", "सांस फूलना",
    "శ్వాస తీసుకోవడంలో ఇబ్బంది",
    "paralysis", "face drooping", "arm weakness", "slurred speech", "stroke",
    "பக்கவாதம்", "பேச முடியவில்லை",
    "लकवा", "बोलने में दिक्कत",
    "పక్షవాతం",
    "unconscious", "severe bleeding", "fell down and cannot get up",
    "அதிக ரத்தப்போக்கு", "கீழே விழுந்துவிட்டேன்",
    "खून बह रहा है", "गिर गया",
]


def analyze_emergency_symptoms(text: str, language: str = "en") -> Tuple[bool, str, str]:
    """
    Analyzes patient's spoken symptoms during an emergency.
    Returns: (is_critical: bool, risk_level: str, ai_response_text: str)
    Strictly follows SmartMed Emergency Dialogue Specification:
    - Never delay emergency escalation.
    - Never claim an ambulance or caregiver has arrived.
    - Short, clear, empathetic communication.
    """
    clean_text = text.lower().strip()
    lang = (language or "en").lower().split("-")[0].strip()

    # 1. Chest Pain
    if any(kw in clean_text for kw in CHEST_PAIN_KEYWORDS):
        if lang == "ta":
            resp = (
                "புரிந்துகொண்டேன். உங்கள் அவசர எச்சரிக்கை அனுப்பப்படுகிறது. நெஞ்சு வலி தீவிரமாக இருக்கலாம். "
                "உடனடியாக அவசர மருத்துவ உதவியை நாடவும். தீவிர அறிகுறிகள் இருந்தால் பராமரிப்பாளர் வரும் வரை காத்திருக்க வேண்டாம்."
            )
        elif lang == "hi":
            resp = (
                "मैं समझ गया। आपका आपातकालीन अलर्ट संसाधित किया जा रहा है। सीने में दर्द गंभीर हो सकता है। "
                "कृपया तत्काल आपातकालीन चिकित्सा सहायता लें। यदि गंभीर लक्षण हैं तो देखभालकर्ता की प्रतीक्षा न करें।"
            )
        elif lang == "te":
            resp = (
                "నేను అర్థం చేసుకున్నాను. మీ అత్యవసర హెచ్చరిక ప్రాసెస్ చేయబడుతోంది. ఛాతీ నొప్పి తీవ్రమైనది కావచ్చు. "
                "దయచేసి తక్షణ అత్యవసర వైద్య సహాయం తీసుకోండి. తీవ్రమైన లక్షణాలు ఉంటే సంరక్షకుడి కోసం వేచి ఉండకండి."
            )
        else:
            resp = (
                "I understand. Your emergency alert is being processed. Chest pain can be serious. "
                "Please seek immediate emergency medical assistance. Do not wait for the caregiver if you are experiencing severe symptoms."
            )
        return True, "CRITICAL", resp

    # 2. Dizziness / Fainting
    if any(kw in clean_text for kw in DIZZY_KEYWORDS):
        if lang == "ta":
            resp = (
                "தயவுசெய்து பாதுகாப்பாக அமரவும் அல்லது படுக்கவும். நான் உங்களுக்கு உதவ இங்கே இருக்கிறேன். "
                "உங்களுக்கு உடனடி அவசர உதவி தேவைப்பட்டால் 112-ஐ அழைக்கவும்."
            )
        elif lang == "hi":
            resp = (
                "कृपया सुरक्षित रूप से बैठें या लेट जाएं। मैं आपकी सहायता के लिए यहाँ हूँ। "
                "यदि आपको तत्काल आपातकालीन सहायता की आवश्यकता है, तो 112 पर कॉल करें।"
            )
        elif lang == "te":
            resp = (
                "దయచేసి సురక్షితంగా కూర్చోండి లేదా పడుకోండి. మీకు సహాయం చేయడానికి నేను ఇక్కడ ఉన్నాను. "
                "మీకు తక్షణ అత్యవసర సహాయం కావాలంటే, 112కి కాల్ చేయండి."
            )
        else:
            resp = (
                "Please remain seated or lie down safely. I am here to assist you. "
                "If you need immediate emergency help, call 112."
            )
        return False, "MODERATE", resp

    # 3. Other Critical Life Threats (Breathing, Stroke, Severe Bleeding)
    if any(kw in clean_text for kw in BREATHING_STROKE_KEYWORDS):
        if lang == "ta":
            resp = (
                "இது மிக முக்கியமான அவசர நிலை. உடனடியாக 112 அல்லது ஆம்புலன்ஸை அழைக்கவும். "
                "பராமரிப்பாளர் வரும் வரை காத்திருக்க வேண்டாம். பாதுகாப்பாக இருங்கள்."
            )
        elif lang == "hi":
            resp = (
                "यह एक गंभीर आपातकालीन स्थिति हो सकती है। कृपया तुरंत 112 या एम्बुलेंस को कॉल करें। "
                "देखभालकर्ता की प्रतीक्षा न करें। आराम से बैठें और शांत रहें।"
            )
        else:
            resp = (
                "This could be a serious emergency. Please call 112 or your emergency ambulance immediately. "
                "Do not wait for your caregiver to arrive. Remain still and breathe slowly."
            )
        return True, "CRITICAL", resp

    # 4. General / Mild Symptom / Qwen2.5 MNN Fallback
    try:
        from mnn.inference import MNNInference
        mnn = MNNInference()
        prompt = (
            f"You are SmartMed Emergency AI assisting a patient who pressed SOS. "
            f"Patient says: '{text}'. "
            f"Give a short 1-2 sentence calm, empathetic response in language '{lang}'. "
            f"Never claim an ambulance or caregiver has arrived. Never delay emergency escalation. "
            f"Advise them to sit down safely and call 112 if condition worsens."
        )
        ai_reply = mnn.generate(prompt=prompt, max_new_tokens=60, temperature=0.3)
        if ai_reply and len(ai_reply.strip()) > 10:
            return False, "MODERATE", ai_reply.strip()
    except Exception as mnn_err:
        logger.debug(f"MNN emergency dialogue fallback: {mnn_err}")

    if lang == "ta":
        default_resp = (
            "புரிந்துகொண்டேன். உங்கள் அவசர உதவி கோரிக்கை செயல்படுத்தப்பட்டு வருகிறது. "
            "தயவுசெய்து அமைதியாக அமரவும். நிலைமை மோசமடைந்தால் 112-ஐ அழைக்கவும்."
        )
    elif lang == "hi":
        default_resp = (
            "मैं समझ गया। आपकी आपातकालीन सहायता प्रक्रिया में है। "
            "कृपया शांत रहें और सुरक्षित बैठें। स्थिति बिगड़ने पर 112 पर कॉल करें।"
        )
    else:
        default_resp = (
            "I understand. Your emergency alert is being processed. "
            "Please remain seated and stay calm. If you feel worse, call 112 immediately."
        )
    return False, "MODERATE", default_resp


class EmergencyVoiceService:
    """
    Synthesizes emergency speech using ultra-humanoid Neural TTS (Indic languages & English),
    with Kokoro af_bella local neural fallback for natural, warm, empathetic speech delivery.
    """

    def synthesize_reassurance_prompt(self, language: str = "en") -> Dict[str, Any]:
        """Synthesize the initial emergency voice reassurance with a humanoid, calming voice."""
        lang = (language or "en").lower().split("-")[0].strip()
        text = EMERGENCY_REASSURANCE_PROMPTS.get(lang, EMERGENCY_REASSURANCE_PROMPTS["en"])

        try:
            # Natural humanoid synthesis with warm, empathetic cadence
            audio_bytes, mime_type, engine_used = tts_manager.synthesize_neural_humanoid(
                text=text,
                voice="af_bella",
                speed=1.0,
                lang=lang,
            )
            audio_base64 = base64.b64encode(audio_bytes).decode("ascii")
            return {
                "success": True,
                "text": text,
                "audio_base64": f"data:{mime_type};base64,{audio_base64}",
                "engine_used": engine_used,
            }
        except Exception as e:
            logger.error(f"Failed to synthesize humanoid emergency voice reassurance: {e}")
            return {
                "success": False,
                "text": text,
                "audio_base64": None,
                "error": str(e),
                "engine_used": "text_fallback",
            }

    def process_emergency_speech(
        self,
        patient_message: str,
        language: str = "en",
    ) -> Dict[str, Any]:
        """
        Processes patient's voice response, checks for critical life threats,
        and returns spoken guidance via humanoid Neural/Kokoro TTS.
        """
        lang = (language or "en").lower().split("-")[0].strip()
        is_critical, risk_level, ai_response_text = analyze_emergency_symptoms(patient_message, language=lang)

        audio_data = None
        engine_used = "none"
        try:
            audio_bytes, mime_type, engine_used = tts_manager.synthesize_neural_humanoid(
                text=ai_response_text,
                voice="af_bella",
                speed=1.0,
                lang=lang,
            )
            audio_base64 = base64.b64encode(audio_bytes).decode("ascii")
            audio_data = f"data:{mime_type};base64,{audio_base64}"
        except Exception as e:
            logger.warning(f"Emergency response TTS synthesis error: {e}")

        return {
            "success": True,
            "patient_message": patient_message,
            "ai_response_text": ai_response_text,
            "is_critical": is_critical,
            "risk_level": risk_level,
            "audio_base64": audio_data,
            "engine_used": engine_used,
            "call_emergency_services": is_critical,
            "emergency_number": "112" if is_critical else None,
        }


emergency_voice_service = EmergencyVoiceService()
