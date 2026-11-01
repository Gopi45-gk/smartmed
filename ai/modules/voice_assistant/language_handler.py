"""
SmartMed Voice Companion - Language Handler
Manages language normalization, multilingual greetings, and localized prompts.
"""

from typing import Dict, Any

LANGUAGE_METADATA: Dict[str, Dict[str, str]] = {
    "en": {
        "code": "en",
        "name": "English",
        "native_name": "English",
        "whisper_code": "en",
        "tts_code": "en",
    },
    "ta": {
        "code": "ta",
        "name": "Tamil",
        "native_name": "தமிழ்",
        "whisper_code": "ta",
        "tts_code": "ta",
    },
    "hi": {
        "code": "hi",
        "name": "Hindi",
        "native_name": "हिन्दी",
        "whisper_code": "hi",
        "tts_code": "hi",
    },
    "te": {
        "code": "te",
        "name": "Telugu",
        "native_name": "తెలుగు",
        "whisper_code": "te",
        "tts_code": "te",
    },
    "ur": {
        "code": "ur",
        "name": "Urdu",
        "native_name": "اردو",
        "whisper_code": "ur",
        "tts_code": "ur",
    },
    "kn": {
        "code": "kn",
        "name": "Kannada",
        "native_name": "ಕನ್ನಡ",
        "whisper_code": "kn",
        "tts_code": "kn",
    },
    "ml": {
        "code": "ml",
        "name": "Malayalam",
        "native_name": "മലയാളം",
        "whisper_code": "ml",
        "tts_code": "ml",
    },
    "bn": {
        "code": "bn",
        "name": "Bengali",
        "native_name": "বাংলা",
        "whisper_code": "bn",
        "tts_code": "bn",
    },
    "mr": {
        "code": "mr",
        "name": "Marathi",
        "native_name": "मराठी",
        "whisper_code": "mr",
        "tts_code": "mr",
    },
}

GREETINGS: Dict[str, str] = {
    "en": "Hello! I am your SmartMed medical companion. How are you feeling today? How can I help you?",
    "ta": "வணக்கம்! நான் உங்கள் SmartMed மருத்துவ உதவியாளர். இன்று நீங்கள் எப்படி உணர்கிறீர்கள்? நான் உங்களுக்கு எப்படி உதவ முடியும்?",
    "hi": "नमस्ते! मैं आपका SmartMed मेडिकल सहायक हूँ। आज आप कैसा महसूस कर रहे हैं? मैं आपकी कैसे मदद कर सकता हूँ?",
    "te": "నమస్కారం! నేను మీ SmartMed వైద్య సహచరుడిని. ఈ రోజు మీరు ఎలా ఉన్నారు? నేను మీకు ఎలా సహాయపడగలను?",
    "ur": "ہیلو! میں آپ کا اسمارٹ میڈ طبی ساتھی ہوں۔ آج آپ کیسا محسوس کر رہے ہیں؟ میں آپ کی کیا مدد کر سکتا ہوں؟",
    "kn": "ನಮಸ್ಕಾರ! ನಾನು ನಿಮ್ಮ SmartMed ವೈದ್ಯಕೀಯ ಸಹಾಯಕ. ಇಂದು ನೀವು ಹೇಗಿದ್ದೀರಿ? ನಾನು ನಿಮಗೆ ಹೇಗೆ ಸಹಾಯ ಮಾಡಲಿ?",
    "ml": "നമസ്കാരം! ഞാൻ നിങ്ങളുടെ SmartMed മെഡിക്കൽ സഹായിയാണ്. ഇന്ന് നിങ്ങൾക്ക് എങ്ങനെയുണ്ട്? ഞാൻ നിങ്ങളെ എങ്ങനെ സഹായിക്കണം?",
    "bn": "হ্যালো! আমি আপনার SmartMed চিকিৎসা সহকারী। আজ আপনি কেমন আছেন? আমি আপনাকে কিভাবে সাহায্য করতে পারি?",
    "mr": "नमस्कार! मी तुमचा SmartMed वैद्यकीय सहकारी आहे. आज तुम्हाला कसे वाटत आहे? मी तुम्हाला कशी मदत करू शकेन?",
}


def normalize_language_code(lang: str) -> str:
    """Normalize input language tag to primary 2-letter code."""
    if not lang:
        return "en"
    clean = lang.lower().split("-")[0].split("_")[0].strip()
    return clean if clean in LANGUAGE_METADATA else "en"


def get_greeting_text(lang: str) -> str:
    """Get localized greeting in native script."""
    code = normalize_language_code(lang)
    return GREETINGS.get(code, GREETINGS["en"])


def get_language_name(lang: str) -> str:
    """Get human-readable language name."""
    code = normalize_language_code(lang)
    return LANGUAGE_METADATA.get(code, LANGUAGE_METADATA["en"])["name"]
