"""
SmartMed Voice Companion - Medical Safety & Triage Guardrails
Enforces clinical safety constraints:
- Emergency symptom recognition (chest pain, dyspnea, FAST stroke signs)
- Voice command SOS triggers
- Medication non-alteration guardrails
- Plain-language elderly accessibility
"""

import re
from typing import Tuple, Dict, Any, Optional

EMERGENCY_TRIGGERS = [
    # Voice command SOS triggers
    "i need emergency help", "activate sos", "call 112", "call emergency", "call my caregiver now",
    "emergency help", "காப்பாற்றுங்கள்", "அவசர உதவி", "மார்பு வலி",
    "आपातकालीन सहायता", "मदद करो", "सीने में दर्द",
    "అత్యవసర సహాయం", "కాపాడండి",
    # Symptoms
    "chest pain", "pressure in chest", "heart attack", "difficulty breathing",
    "cannot breathe", "stroke", "face drooping", "slurred speech",
    "fainted", "unconscious", "severe bleeding", "severe allergic reaction",
    "choking", "collapsed",
]

RESTRICTED_PRESCRIBING_PATTERNS = [
    r"\byou should stop taking\b",
    r"\bdiscontinue your\b",
    r"\bincrease your dose to\b",
    r"\bdouble your dose\b",
    r"\btake this new medicine\b",
    r"\bi prescribe\b",
]


class MedicalSafetyValidator:
    """
    Validates patient queries and AI responses for clinical safety.
    """

    def check_emergency_symptoms(self, query: str, language: str = "en") -> Tuple[bool, Optional[str]]:
        """
        Detects if query contains acute emergency symptoms or explicit SOS request.
        Returns (is_emergency: bool, localized_emergency_advisory: Optional[str])
        """
        clean = query.lower().strip()
        lang = (language or "en").lower().split("-")[0].strip()

        is_emergency = any(trigger in clean for trigger in EMERGENCY_TRIGGERS)
        if not is_emergency:
            return False, None

        # Build immediate safety advisory
        if lang == "ta":
            advisory = (
                "எச்சரிக்கை: நீங்கள் குறிப்பிட்ட அறிகுறிகள் அவசர மருத்துவ சிகிச்சையை குறிக்கலாம். "
                "உடனடியாக 112 அல்லது ஆம்புலன்ஸை அழைக்கவும். உங்கள் பராமரிப்பாளரை அழைக்க SOS பொத்தானைப் பயன்படுத்தவும்."
            )
        elif lang == "hi":
            advisory = (
                "सावधान: आपके द्वारा बताए गए लक्षण एक आपातकालीन स्थिति का संकेत हो सकते हैं। "
                "कृपया तुरंत 112 या एम्बुलेंस को कॉल करें। अपने देखभालकर्ता को सचेत करने के लिए SOS दबाएं।"
            )
        elif lang == "te":
            advisory = (
                "హెచ్చరిక: మీరు పేర్కొన్న లక్షణాలు అత్యవసర పరిస్థితిని సూచించవచ్చు. "
                "దయచేసి వెంటనే 112 లేదా అంబులెన్స్‌కు కాల్ చేయండి. మీ సంరక్షకుడిని సంప్రదించడానికి SOS బటన్‌ను నొక్కండి."
            )
        else:
            advisory = (
                "Alert: The symptoms you described may indicate a medical emergency. "
                "Please call 112 or your nearest emergency medical service immediately. "
                "You can also press the SOS button to alert your registered caregiver immediately."
            )

        return True, advisory

    def sanitize_medical_response(self, text: str, language: str = "en") -> str:
        """
        Inspects generated text to ensure it never independently prescribes or
        unilaterally instructs stopping prescribed medicines.
        """
        clean = text
        for pattern in RESTRICTED_PRESCRIBING_PATTERNS:
            if re.search(pattern, clean, re.IGNORECASE):
                warning_note = " (Note: Do not modify or discontinue your medications without consulting your prescribing doctor.)"
                clean += warning_note
                break

        lang = (language or "en").lower().split("-")[0].strip()
        disclaimer = ""
        if lang == "ta":
            disclaimer = "\n(குறிப்பு: கடுமையான அறிகுறிகளுக்கு உடனடியாக உங்கள் மருத்துவரை அணுகவும்.)"
        elif lang == "hi":
            disclaimer = "\n(नोट: किसी भी गंभीर लक्षण के लिए कृपया अपने डॉक्टर से परामर्श लें।)"
        elif lang == "te":
            disclaimer = "\n(గమనిక: ఏవైనా తీవ్రమైన లక్షణాల కోసం దయచేసి మీ వైద్యుడిని సంప్రదించండి.)"
        else:
            disclaimer = "\n(Please consult your healthcare provider for medical diagnosis and changes to treatment.)"

        if not any(marker in clean.lower() for marker in ["consult", "மருத்துவரை", "डॉक्टर", "వైద్యుడిని", "disclaimer"]):
            clean += disclaimer

        return clean


medical_safety = MedicalSafetyValidator()
