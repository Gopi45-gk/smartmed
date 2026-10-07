"""
SmartMed AI - Twilio Cloud Telephony & Interactive Medication Reminder Engine
Supports 6 languages (Tamil, English, Hindi, Telugu, Kannada, Malayalam),
APScheduler background jobs, Twilio Voice API interactive speech gathering,
voice intent classification, adherence tracking, and automated retries.
"""

import os
import re
import json
import logging
import threading
from datetime import datetime, timezone, timedelta
from typing import Optional, Dict, Any, Tuple, List
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger("smartmed.twilio")

# Twilio Credentials (loaded strictly from environment or .env file)
TWILIO_ACCOUNT_SID = os.getenv("TWILIO_ACCOUNT_SID", "")
TWILIO_AUTH_TOKEN = os.getenv("TWILIO_AUTH_TOKEN", "")
TWILIO_API_KEY = os.getenv("TWILIO_API_KEY", "")
TWILIO_API_SECRET = os.getenv("TWILIO_API_SECRET", "")
TWILIO_PHONE_NUMBER = os.getenv("TWILIO_PHONE_NUMBER", "")
BASE_WEBHOOK_URL = os.getenv("TWILIO_WEBHOOK_BASE_URL", "https://smart-med.duckdns.org")

# Data directory for persistent reminders & adherence tracking
DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
os.makedirs(DATA_DIR, exist_ok=True)
REMINDERS_FILE = os.path.join(DATA_DIR, "reminders.json")
ADHERENCE_FILE = os.path.join(DATA_DIR, "adherence.json")

_storage_lock = threading.Lock()

# Initialize Twilio Client
_client = None
try:
    from twilio.rest import Client
    if TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN:
        _client = Client(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
        logger.info("✓ Twilio Client initialized successfully.")
    else:
        logger.warning("Twilio credentials missing.")
except Exception as e:
    logger.warning(f"Could not initialize Twilio client: {e}")

# Initialize APScheduler BackgroundScheduler
_scheduler = None
try:
    from apscheduler.schedulers.background import BackgroundScheduler
    _scheduler = BackgroundScheduler(daemon=True)
    _scheduler.start()
    logger.info("✓ APScheduler BackgroundScheduler started successfully.")
except Exception as e:
    logger.error(f"Failed to initialize APScheduler: {e}")


def get_scheduler():
    global _scheduler
    if _scheduler is None or not _scheduler.running:
        try:
            from apscheduler.schedulers.background import BackgroundScheduler
            _scheduler = BackgroundScheduler(daemon=True)
            _scheduler.start()
        except Exception as e:
            logger.error(f"Error starting APScheduler: {e}")
    return _scheduler


def get_twilio_client():
    global _client
    if _client is None:
        try:
            from twilio.rest import Client
            if TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN:
                _client = Client(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
        except Exception as e:
            logger.error(f"Error obtaining Twilio client: {e}")
    return _client


def format_e164_phone(phone: str) -> str:
    """Formats phone number to E.164 standard (+91... default for 10-digit Indian numbers)."""
    cleaned = "".join(c for c in phone if c.isdigit() or c == "+")
    if cleaned.startswith("+"):
        return cleaned
    if len(cleaned) == 10:
        return f"+91{cleaned}"
    if len(cleaned) == 12 and cleaned.startswith("91"):
        return f"+{cleaned}"
    return f"+{cleaned}" if not cleaned.startswith("+") else cleaned


def mask_phone_number(phone: str) -> str:
    """Mask phone number in logs for privacy and HIPAA compliance."""
    if not phone or len(phone) < 6:
        return "***"
    return f"{phone[:3]}****{phone[-4:]}"


def normalize_language_code(lang: Optional[str]) -> str:
    if not lang:
        return "en"
    clean = lang.lower().strip()
    if clean.startswith("ta") or "tamil" in clean:
        return "ta"
    if clean.startswith("hi") or "hindi" in clean:
        return "hi"
    if clean.startswith("te") or "telugu" in clean:
        return "te"
    if clean.startswith("kn") or "kannada" in clean:
        return "kn"
    if clean.startswith("ml") or "malayalam" in clean:
        return "ml"
    return "en"


def get_locale_for_language(lang: Optional[str]) -> str:
    mapping = {
        "ta": "ta-IN",
        "hi": "hi-IN",
        "te": "te-IN",
        "kn": "kn-IN",
        "ml": "ml-IN",
        "en": "en-IN",
    }
    return mapping.get(normalize_language_code(lang), "en-IN")


# ─── Multilingual Interactive Telephony Prompts & Voices ─────────────────────

LANGUAGE_VOICE_CONFIG = {
    "ta": {
        "voice": "Polly.Valluvar",
        "language": "ta-IN",
        "greeting": lambda name: f"வணக்கம் {name}," if name else "வணக்கம்,",
        "notice": lambda med, dose, meal: (
            f"இது ஸ்மார்ட்மெட் நினைவூட்டல். உங்களுடைய மாத்திரை {med}, அளவு {dose}"
            + (f", {meal}" if meal else "")
            + " எடுக்க வேண்டிய நேரம் இது."
        ),
        "question": "நீங்கள் இப்போது மருந்தை எடுத்துக்கொண்டீர்களா?",
        "no_speech": "விடை கிடைக்கவில்லை. தயவுசெய்து உங்கள் மாத்திரையை சரியான நேரத்தில் எடுத்துக்கொள்ளுங்கள். நன்றி!",
        "taken_ack": "நன்றி! உங்கள் மருந்து உட்கொள்ளல் பதிவு செய்யப்பட்டது. உடலை நன்றாகப் பார்த்துக் கொள்ளுங்கள்.",
        "will_take_now_ack": "சரி, தயவுசெய்து உடனே மாத்திரையை எடுத்துக்கொள்ளுங்கள். நன்றி!",
        "delayed_ack": lambda d: f"சரி, {d} நிமிடங்கள் கழித்து மீண்டும் அழைக்கிறேன். நன்றி!",
        "skipped_ack": "காரணம் பதிவு செய்யப்பட்டது. உங்கள் மருத்துவரிடம் ஆலோசிக்கவும். உடலை நன்றாகப் பார்த்துக் கொள்ளுங்கள்.",
        "medical_safety_ack": "மருத்துவ தகவல்: மருத்துவர் பரிந்துரைத்தபடி மாத்திரைகளை எடுக்கவும். சந்தேகம் இருந்தால் உடனே மருத்துவரை அணுகவும்.",
        "unclear_clarify": "மன்னிக்கவும், உங்கள் பதில் தெளிவாகக் கேட்கவில்லை. நீங்கள் இப்போது மருந்தை எடுத்துக்கொண்டீர்களா? ஆம் அல்லது இல்லை என்று கூறவும்.",
        "footer": "முக்கிய மருத்துவ எச்சரிக்கை: மாத்திரைகளை சரியான நேரத்தில் எடுப்பதை உறுதிப்படுத்தவும். உடலை நன்றாகப் பார்த்துக் கொள்ளுங்கள்!"
    },
    "hi": {
        "voice": "Polly.Kajal",
        "language": "hi-IN",
        "greeting": lambda name: f"नमस्ते {name}," if name else "नमस्ते,",
        "notice": lambda med, dose, meal: (
            f"यह स्मार्टमेड स्वास्थ्य अनुस्मारक है। आपकी दवा {med}, खुराक {dose}"
            + (f", {meal}" if meal else "")
            + " लेने का समय हो गया है।"
        ),
        "question": "क्या आपने अभी अपनी दवा ले ली है?",
        "no_speech": "कोई उत्तर नहीं मिला। कृपया समय पर अपनी दवा अवश्य लें। धन्यवाद!",
        "taken_ack": "धन्यवाद! आपकी दवा लेने की पुष्टि दर्ज कर ली गई है। अपना ख्याल रखें।",
        "will_take_now_ack": "ठीक है, कृपया तुरंत अपनी दवा पानी के साथ ले लें। धन्यवाद!",
        "delayed_ack": lambda d: f"समझ गया। हम आपको {d} मिनट बाद दोबारा कॉल करेंगे। धन्यवाद!",
        "skipped_ack": "दवा छोड़ना दर्ज किया गया। कृपया आवश्यकता पड़ने पर अपने डॉक्टर से संपर्क करें। अपना ध्यान रखें।",
        "medical_safety_ack": "चिकित्सा सलाह: कृपया अपनी दवा डॉक्टर के निर्देशानुसार ही लें। किसी भी समस्या के लिए डॉक्टर से संपर्क करें।",
        "unclear_clarify": "क्षमा करें, बात स्पष्ट नहीं हुई। क्या आपने दवा ली? कृपया हाँ या नहीं कहें।",
        "footer": "महत्वपूर्ण स्वास्थ्य चेतावनी: कृपया सुनिश्चित करें कि दवाएं सही समय पर ली गई हैं। अपना ध्यान रखें!"
    },
    "te": {
        "voice": "Polly.Aditi",
        "language": "te-IN",
        "greeting": lambda name: f"నమస్కారం {name}," if name else "నమస్కారం,",
        "notice": lambda med, dose, meal: (
            f"ఇది స్మార్ట్‌మెడ్ మందుల రిమైండర్. మీ మందు {med}, మోతాదు {dose}"
            + (f", {meal}" if meal else "")
            + " తీసుకునే సమయం ఇది."
        ),
        "question": "మీరు ఇప్పుడు మీ మందులు వేసుకున్నారా?",
        "no_speech": "సమాధానం రాలేదు. దయచేసి మీ మందులను సమయానికి తీసుకోండి. ధన్యవాదాలు!",
        "taken_ack": "ధన్యవాదాలు! మీ మందుల వివరాలు నమోదు చేయబడ్డాయి. జాగ్రత్తగా ఉండండి.",
        "will_take_now_ack": "సరే, దయచేసి వెంటనే మీ మందులు వేసుకోండి. ధన్యవాదాలు!",
        "delayed_ack": lambda d: f"సరే, {d} నిమిషాల తర్వాత మళ్లీ కాల్ చేస్తాము. ధన్యవాదాలు!",
        "skipped_ack": "మందులు తీసుకోలేదని నమోదు చేయబడింది. దయచేసి మీ వైద్యుడిని సంప్రదించండి. జాగ్రత్తగా ఉండండి.",
        "medical_safety_ack": "వైద్య సలహా: డాక్టర్ సూచించిన విధంగానే మందులు వాడండి. ఏవైనా సమస్యలు ఉంటే వైద్యుడిని సంప్రదించండి.",
        "unclear_clarify": "క్షమించండి, స్పష్టంగా వినిపించలేదు. మీరు మందులు వేసుకున్నారా? అవును లేదా కాదు అని చెప్పండి.",
        "footer": "ముఖ్యమైన ఆరోగ్య హెచ్చరిక: దయచేసి మీ మందులు సరైన సమయానికి తీసుకున్నారని నిర్ధారించుకోండి. జాగ్రత్తగా ఉండండి!"
    },
    "kn": {
        "voice": "Polly.Aditi",
        "language": "kn-IN",
        "greeting": lambda name: f"ನಮಸ್ಕಾರ {name}," if name else "ನಮಸ್ಕಾರ,",
        "notice": lambda med, dose, meal: (
            f"ಇದು ಸ್ಮಾರ್ಟ್‌ಮೆಡ್ ಔಷಧಿ ಜ್ಞಾಪನೆ. ನಿಮ್ಮ ಔಷಧಿ {med}, ಪ್ರಮಾಣ {dose}"
            + (f", {meal}" if meal else "")
            + " ತೆಗೆದುಕೊಳ್ಳುವ ಸಮಯವಿದು."
        ),
        "question": "ನೀವು ಈಗ ನಿಮ್ಮ ಔಷಧಿಯನ್ನು ತೆಗೆದುಕೊಂಡಿದ್ದೀರಾ?",
        "no_speech": "ಯಾವುದೇ ಪ್ರತಿಕ್ರಿಯೆ ಬಂದಿಲ್ಲ. ದಯವಿಟ್ಟು ನಿಮ್ಮ ಔಷಧಿಯನ್ನು ಸರಿಯಾದ ಸಮಯಕ್ಕೆ ತೆಗೆದುಕೊಳ್ಳಿ. ಧನ್ಯವಾದಗಳು!",
        "taken_ack": "ಧನ್ಯವಾದಗಳು! ನಿಮ್ಮ ಔಷಧಿ ಸೇವನೆಯನ್ನು ದಾಖಲಿಸಲಾಗಿದೆ. ಕಾಳಜಿ ವಹಿಸಿ.",
        "will_take_now_ack": "ಸರಿ, ದಯವಿಟ್ಟು ಈಗಲೇ ಔಷಧಿ ತೆಗೆದುಕೊಳ್ಳಿ. ಧನ್ಯವಾದಗಳು!",
        "delayed_ack": lambda d: f"ಸರಿ, {d} ನಿಮಿಷಗಳ ನಂತರ ಮತ್ತೊಮ್ಮೆ ಕರೆ ಮಾಡುತ್ತೇವೆ. ಧನ್ಯವಾದಗಳು!",
        "skipped_ack": "ಔಷಧಿ ಬಿಟ್ಟಿರುವುದನ್ನು ದಾಖಲಿಸಲಾಗಿದೆ. ದಯವಿಟ್ಟು ನಿಮ್ಮ ವೈದ್ಯರನ್ನು ಸಂಪರ್ಕಿಸಿ. ಕಾಳಜಿ ವಹಿಸಿ.",
        "medical_safety_ack": "ವೈದ್ಯಕೀಯ ಸಲಹೆ: ವೈದ್ಯರ ಸೂಚನೆಯಂತೆ ಔಷಧಿ ತೆಗೆದುಕೊಳ್ಳಿ. ಯಾವುದೇ ತೊಂದರೆ ಇದ್ದಲ್ಲಿ ವೈದ್ಯರನ್ನು ಸಂಪರ್ಕಿಸಿ.",
        "unclear_clarify": "ಕ್ಷಮಿಸಿ, ಸರಿಯಾಗಿ ಕೇಳಿಸಲಿಲ್ಲ. ನೀವು ಔಷಧಿ ತೆಗೆದುಕೊಂಡಿದ್ದೀರಾ? ಹೌದು ಅಥವಾ ಇಲ್ಲ ಎಂದು ಹೇಳಿ.",
        "footer": "ಪ್ರಮುಖ ಆರೋಗ್ಯ ಎಚ್ಚರಿಕೆ: ದಯವಿಟ್ಟು ನಿಮ್ಮ ಔಷಧಿಗಳನ್ನು ಸರಿಯಾದ ಸಮಯಕ್ಕೆ ತೆಗೆದುಕೊಂಡಿರುವುದನ್ನು ಖಚಿತಪಡಿಸಿಕೊಳ್ಳಿ. ಕಾಳಜಿ ವಹಿಸಿ!"
    },
    "ml": {
        "voice": "Polly.Aditi",
        "language": "ml-IN",
        "greeting": lambda name: f"നമസ്കാരം {name}," if name else "നമസ്കാരം,",
        "notice": lambda med, dose, meal: (
            f"ഇത് സ്മാർട്ട്മെഡ് മെഡിക്കേഷൻ റിമൈൻഡർ ആണ്. നിങ്ങളുടെ മരുന്ന് {med}, അളവ് {dose}"
            + (f", {meal}" if meal else "")
            + " കഴിക്കേണ്ട സമയമാണിത്."
        ),
        "question": "നിങ്ങൾ ഇപ്പോൾ മരുന്ന് കഴിച്ചോ?",
        "no_speech": "മറുപടി ലഭിച്ചില്ല. ദയവായി കൃത്യസമയത്ത് മരുന്ന് കഴിക്കുക. നന്ദി!",
        "taken_ack": "നന്ദി! നിങ്ങളുടെ മരുന്ന് കഴിച്ച വിവരം രേഖപ്പെടുത്തി. ആരോഗ്യം ശ്രദ്ധിക്കുക.",
        "will_take_now_ack": "ശരി, ദയവായി ഇപ്പോൾ തന്നെ മരുന്ന് കഴിക്കുക. നന്ദി!",
        "delayed_ack": lambda d: f"ശരി, {d} മിനിറ്റിനു ശേഷം വീണ്ടും വിളിക്കാം. നന്ദി!",
        "skipped_ack": "രേഖപ്പെടുത്തി. ആവശ്യമെങ്കിൽ ഡോക്ടറോട് സംസാരിക്കുക. ആരോഗ്യം ശ്രദ്ധിക്കുക.",
        "medical_safety_ack": "വൈദ്യോപദേശം: ഡോക്ടറുടെ നിർദ്ദേശപ്രകാരം മാത്രം മരുന്ന് കഴിക്കുക. ബുദ്ധിമുട്ടുണ്ടെങ്കിൽ ഡോക്ടറെ കാണുക.",
        "unclear_clarify": "ക്ഷമിക്കണം, വ്യക്തമായി കേട്ടില്ല. നിങ്ങൾ മരുന്ന് കഴിച്ചോ? അതെ അല്ലെങ്കിൽ ഇല്ല എന്ന് പറയുക.",
        "footer": "പ്രധാന ആരോഗ്യ മുന്നറിയിപ്പ്: ഗുളികകൾ കൃത്യസമയത്ത് കഴിച്ചുവെന്ന് ഉറപ്പാക്കുക. ആരോഗ്യത്തോടെ ഇരിക്കുക!"
    },
    "en": {
        "voice": "Polly.Aditi",
        "language": "en-IN",
        "greeting": lambda name: f"Hello {name}," if name else "Hello,",
        "notice": lambda med, dose, meal: (
            f"this is your SmartMed medication reminder. It is time to take your {med}, dosage: {dose}"
            + (f", {meal}" if meal else "")
            + "."
        ),
        "question": "Have you taken your medicine now?",
        "no_speech": "We did not receive a response. Please ensure you take your prescribed medication on time. Thank you and stay healthy!",
        "taken_ack": "Thank you! Your medication adherence has been recorded. Take care and stay healthy!",
        "will_take_now_ack": "Alright, please take your medication right away with plain water. Thank you!",
        "delayed_ack": lambda d: f"Understood. We will call you again in {d} minutes. Take care!",
        "skipped_ack": "Recorded as skipped. Please consult your doctor if you feel unwell. Take care!",
        "medical_safety_ack": "Medical note: Please follow your prescription as directed by your doctor. Consult your physician if you experience any adverse symptoms.",
        "unclear_clarify": "Sorry, I could not hear your answer clearly. Have you taken your medicine now? Please say yes or no.",
        "footer": "Important healthcare alert: Please verify your tablets are taken at the right time. Take care!"
    }
}


# ─── Persistent Storage for Reminders & Adherence ────────────────────────────

def load_reminders() -> Dict[str, Dict[str, Any]]:
    with _storage_lock:
        if not os.path.exists(REMINDERS_FILE):
            return {}
        try:
            with open(REMINDERS_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            logger.warning(f"Error loading reminders file: {e}")
            return {}


def save_reminders(data: Dict[str, Dict[str, Any]]):
    with _storage_lock:
        try:
            with open(REMINDERS_FILE, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
        except Exception as e:
            logger.error(f"Error saving reminders file: {e}")


def get_reminder_by_id(reminder_id: str) -> Optional[Dict[str, Any]]:
    reminders = load_reminders()
    return reminders.get(reminder_id)


def update_reminder_status(reminder_id: str, status: str, extra: Optional[Dict[str, Any]] = None):
    reminders = load_reminders()
    if reminder_id in reminders:
        reminders[reminder_id]["reminder_status"] = status
        reminders[reminder_id]["updated_at"] = datetime.now(timezone.utc).isoformat()
        if extra:
            reminders[reminder_id].update(extra)
        save_reminders(reminders)
        logger.info(f"[Reminder DB] Updated {reminder_id} -> {status}")


def load_adherence() -> List[Dict[str, Any]]:
    with _storage_lock:
        if not os.path.exists(ADHERENCE_FILE):
            return []
        try:
            with open(ADHERENCE_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            logger.warning(f"Error loading adherence file: {e}")
            return []


def save_adherence_record(record: Dict[str, Any]):
    with _storage_lock:
        data = []
        if os.path.exists(ADHERENCE_FILE):
            try:
                with open(ADHERENCE_FILE, "r", encoding="utf-8") as f:
                    data = json.load(f)
            except Exception:
                data = []
        data.append(record)
        try:
            with open(ADHERENCE_FILE, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            logger.info(f"[Adherence DB] Recorded adherence for {record.get('reminderId')}: {record.get('status')}")
        except Exception as e:
            logger.error(f"Error saving adherence file: {e}")


# ─── Natural Speech Intent Classification ───────────────────────────────────

def extract_delay_minutes(text: str) -> int:
    """Extract delay minutes from natural speech response across languages."""
    t = text.lower()
    if "half an hour" in t or "அரை மணி" in t or "आधा घंटा" in t or "30" in t:
        return 30
    if "one hour" in t or "1 hour" in t or "ஒரு மணி" in t or "एक घंटा" in t or "60" in t:
        return 60
    match = re.search(r"(\d+)\s*(?:min|minute|minutes|நிமி|मिनट|నిమి|ನಿಮಿ|മിനി)?", t)
    if match:
        try:
            val = int(match.group(1))
            if 1 <= val <= 180:
                return val
        except Exception:
            pass
    if "10" in t or "ten" in t or "பத்து" in t or "दस" in t:
        return 10
    if "20" in t or "twenty" in t or "இருபது" in t or "बीस" in t:
        return 20
    return 15


def classify_call_response(speech_text: str, language: str = "en") -> Tuple[str, Dict[str, Any]]:
    """
    Classifies natural voice response into:
    - TAKEN
    - WILL_TAKE_NOW
    - DELAYED (with extracted delayMinutes)
    - SKIPPED
    - MEDICAL_SAFETY_QUERY
    - UNCLEAR
    """
    if not speech_text or not speech_text.strip():
        return "UNCLEAR", {}

    t = speech_text.lower().strip()
    words = t.split()
    tokens = set(re.findall(r'\w+', t, re.UNICODE))

    def matches(kw: str) -> bool:
        if " " in kw:
            return kw in t
        if len(kw) <= 3:
            return kw in tokens or kw in words
        return kw in t or kw in tokens

    # 1. WILL_TAKE_NOW keywords
    will_take_keywords = [
        "taking now", "will take now", "going to take", "taking it", "right now", "right away", "just now taking",
        "இப்போ எடுக்குறேன்", "இப்பவே போடுறேன்", "உடனே எடுக்கிறேன்", "இப்போ போடுறேன்", "ippo edukiren", "udane edukiren", "ippove edukiren",
        "अभी ले रहा हूँ", "अभी खाता हूँ", "तुरंत लेता हूँ", "अभी लेता हूँ", "abhi leta hu", "abhi kha raha hu",
        "ఇప్పుడే వేసుకుంటాను", "ఇప్పుడే తీసుకుంటాను", "వెంటనే వేసుకుంటాను", "ippude vesukunta",
        "ಈಗಲೇ ತೆಗೆದುಕೊಳ್ಳುತ್ತೇನೆ", "ಈಗ ತಗೊಳ್ತೀನಿ", "eegale thagolthini",
        "ഇപ്പോൾ കഴിക്കാം", "ഉടൻ കഴിക്കാം", "ippol kazhikkam", "udan kazhikkam"
    ]
    for kw in will_take_keywords:
        if matches(kw):
            return "WILL_TAKE_NOW", {"matched": kw}

    # 2. DELAYED keywords
    delay_keywords = [
        "later", "snooze", "busy", "call back", "after some time", "minutes", "minute", "half an hour", "delay", "not now",
        "அப்புறம்", "பிறகு", "நேரம் கழித்து", "வேலை இருக்கு", "நிமிஷம்", "நிமிடம்", "கழித்து", "appuram", "piragu", "konjam neram",
        "बाद में", "थोड़ी देर में", "काम है", "बाद", "मिनट", "घंटा", "घंटे", "आधा घंटा", "baad mein", "baad", "thodi der",
        "తర్వాత", "కాసేపటి తర్వాత", "నిమిషాలు", "tharvatha",
        "ಆಮೇಲೆ", "ನಂತರ", "ನಿಮಿಷ", "aamele", "nanthara",
        "പിന്നെ", "ശേഷം", "മിനിറ്റ്", "pinne", "shesham"
    ]
    for kw in delay_keywords:
        if matches(kw):
            delay = extract_delay_minutes(t)
            return "DELAYED", {"delayMinutes": delay, "matched": kw}

    # 3. SKIPPED keywords
    skipped_keywords = [
        "no", "not taken", "not taking", "skip", "skipping", "don't want", "cannot take", "declined", "stopped", "wont take", "won't take",
        "இல்லை", "வேண்டாம்", "எடுக்கல", "இல்ல", "போடல", "முடியாது", "illa", "illai", "vendaam", "edukala",
        "नहीं", "नहीं ली", "नहीं लेना", "नहीं खाऊंगा", "nahi", "nahi li", "nahi lena", "nahi khani",
        "లేదు", "వద్దు", "వేయను", "తీసుకోలేదు", "ledu", "vaddu", "teesukoledu",
        "ಇಲ್ಲ", "ಬೇಡ", "ತೆಗೆದುಕೊಳ್ಳುವುದಿಲ್ಲ", "illa", "beda",
        "ഇല്ല", "വേണ്ട", "കഴിച്ചില്ല", "illa", "venda", "kazhichilla"
    ]
    for kw in skipped_keywords:
        if matches(kw):
            return "SKIPPED", {"matched": kw}

    # 4. TAKEN keywords
    taken_keywords = [
        "yes", "taken", "took", "had it", "already taken", "done", "consumed", "swallowed", "i have taken", "i took it", "finished", "yeah", "yep",
        "எடுத்துக்கிட்டேன்", "போட்டுட்டேன்", "ஆமாம்", "எடுத்தாச்சு", "சாப்பிட்டாச்சு", "முடிஞ்சிது", "ஆம்", "ஆமா", "எடுத்துட்டேன்", "eduthuten", "aam", "potuten", "eduthachu",
        "हाँ", "ले ली", "खा ली", "ले लिया", "खा लिया", "haan", "haa", "le li", "kha li", "le liya",
        "అవును", "వేసుకున్నాను", "తీసుకున్నాను", "avunu", "vesukunna", "teesukunna", "vesukunnanu",
        "ಹೌದು", "ತೆಗೆದುಕೊಂಡೆ", "ತಗೊಂಡೆ", "haudu", "thogonde", "aayithu", "thegedukonde",
        "അതെ", "കഴിച്ചു", "എടുത്തു", "athe", "kazhichu", "eduthu", "kazhicho"
    ]
    for kw in taken_keywords:
        if matches(kw):
            return "TAKEN", {"matched": kw}

    # 5. MEDICAL_SAFETY_QUERY keywords
    medical_keywords = [
        "side effect", "side effects", "pain", "headache", "fever", "vomiting", "dizziness", "milk", "empty stomach", "food", "allergy", "doubt", "problem",
        "பக்கவிளைவு", "வலி", "தலைவலி", "பால்", "சாப்பாடு", "வாந்தி", "மயக்கம்",
        "साइड इफेक्ट", "दर्द", "सिरदर्द", "दूध", "उल्टी", "चक्कर",
        "నొప్పి", "తలనొప్పి", "వాంతి",
        "ನೋವು", "ತಲೆನೋವು",
        "വേദന", "തലവേദന"
    ]
    for kw in medical_keywords:
        if matches(kw):
            return "MEDICAL_SAFETY_QUERY", {"matched": kw}

    return "UNCLEAR", {}


# ─── TwiML Generation (Interactive Speech Gather) ───────────────────────────

def generate_interactive_twiml(
    medicine: str,
    dosage: str,
    patient_name: Optional[str] = None,
    meal_relation: Optional[str] = None,
    preferred_language: Optional[str] = "en",
    reminder_id: Optional[str] = None,
    attempt: int = 1
) -> str:
    """
    Generate TwiML XML with interactive <Gather input="speech"> in the patient's preferred language.
    Contains personalized greeting, medication details, and question 'Have you taken your medicine now?'.
    """
    from urllib.parse import quote

    lang_key = normalize_language_code(preferred_language)
    cfg = LANGUAGE_VOICE_CONFIG.get(lang_key, LANGUAGE_VOICE_CONFIG["en"])
    voice = cfg["voice"]
    locale = cfg["language"]

    greeting = cfg["greeting"](patient_name)
    notice = cfg["notice"](medicine, dosage, meal_relation)
    question = cfg["question"]
    no_speech_text = cfg["no_speech"]

    spoken_prompt = f"{greeting} {notice} {question}"

    action_params = f"reminder_id={quote(reminder_id or '')}&medicine={quote(medicine)}&dosage={quote(dosage)}&lang={quote(lang_key)}&attempt={attempt}"
    action_url = f"{BASE_WEBHOOK_URL}/api/call/response?{action_params}"

    return f"""<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="speech" action="{action_url}" method="POST" language="{locale}" timeout="6" speechTimeout="auto">
    <Say voice="{voice}" language="{locale}">{spoken_prompt}</Say>
  </Gather>
  <Say voice="{voice}" language="{locale}">{no_speech_text}</Say>
  <Hangup/>
</Response>"""


def generate_twiml(
    medicine: str,
    dosage: str,
    patient_name: Optional[str] = None,
    preferred_language: Optional[str] = "en"
) -> str:
    """Backward-compatible fallback TwiML generator."""
    return generate_interactive_twiml(
        medicine=medicine,
        dosage=dosage,
        patient_name=patient_name,
        preferred_language=preferred_language
    )


def generate_ack_twiml(
    intent: str,
    language: str = "en",
    delay_minutes: int = 15,
    reminder_id: Optional[str] = None,
    attempt: int = 1
) -> str:
    """Generates confirmation ack TwiML in the exact matching language."""
    from urllib.parse import quote

    lang_key = normalize_language_code(language)
    cfg = LANGUAGE_VOICE_CONFIG.get(lang_key, LANGUAGE_VOICE_CONFIG["en"])
    voice = cfg["voice"]
    locale = cfg["language"]

    if intent == "TAKEN":
        ack_text = cfg["taken_ack"]
        return f"""<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="{voice}" language="{locale}">{ack_text}</Say>
  <Hangup/>
</Response>"""

    elif intent == "WILL_TAKE_NOW":
        ack_text = cfg["will_take_now_ack"]
        return f"""<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="{voice}" language="{locale}">{ack_text}</Say>
  <Hangup/>
</Response>"""

    elif intent == "DELAYED":
        ack_text = cfg["delayed_ack"](delay_minutes)
        return f"""<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="{voice}" language="{locale}">{ack_text}</Say>
  <Hangup/>
</Response>"""

    elif intent == "SKIPPED":
        ack_text = cfg["skipped_ack"]
        return f"""<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="{voice}" language="{locale}">{ack_text}</Say>
  <Hangup/>
</Response>"""

    elif intent == "MEDICAL_SAFETY_QUERY":
        ack_text = cfg["medical_safety_ack"]
        return f"""<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="{voice}" language="{locale}">{ack_text}</Say>
  <Hangup/>
</Response>"""

    else:  # UNCLEAR
        if attempt < 2:
            clarify_text = cfg["unclear_clarify"]
            action_params = f"reminder_id={quote(reminder_id or '')}&lang={quote(lang_key)}&attempt={attempt + 1}"
            action_url = f"{BASE_WEBHOOK_URL}/api/call/response?{action_params}"
            return f"""<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="speech" action="{action_url}" method="POST" language="{locale}" timeout="5" speechTimeout="auto">
    <Say voice="{voice}" language="{locale}">{clarify_text}</Say>
  </Gather>
  <Say voice="{voice}" language="{locale}">{cfg["no_speech"]}</Say>
  <Hangup/>
</Response>"""
        else:
            return f"""<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="{voice}" language="{locale}">{cfg["no_speech"]}</Say>
  <Hangup/>
</Response>"""


# ─── Outbound Call Execution ────────────────────────────────────────────────

def make_twilio_call(
    phone: str,
    medicine: str,
    dosage: str,
    patient_name: Optional[str] = None,
    preferred_language: Optional[str] = "en",
    meal_relation: Optional[str] = None,
    reminder_id: Optional[str] = None,
    patient_id: Optional[str] = None
) -> Dict[str, Any]:
    """
    Executes client.calls.create(...) using Twilio Voice API and interactive TwiML.
    Enforces idempotency, state transitions, and server-side secret isolation.
    """
    from urllib.parse import quote

    client = get_twilio_client()
    formatted_phone = format_e164_phone(phone)
    masked_phone = mask_phone_number(formatted_phone)
    lang_key = normalize_language_code(preferred_language)

    # 1. Idempotency Check & State Transition
    if reminder_id:
        existing = get_reminder_by_id(reminder_id)
        if existing and existing.get("reminder_status") in ("CALLING", "COMPLETED"):
            logger.info(f"[Twilio Idempotency] Reminder {reminder_id} is already in state '{existing.get('reminder_status')}'. Skipping duplicate call.")
            return {
                "success": True,
                "skipped": True,
                "reason": f"Already {existing.get('reminder_status')}",
                "reminder_id": reminder_id
            }
        update_reminder_status(reminder_id, "CALLING")

    logger.info(
        f"[Twilio Outbound] Calling -> To: {masked_phone}, From: {TWILIO_PHONE_NUMBER}, "
        f"Med: {medicine} ({dosage}), Meal: {meal_relation or 'N/A'}, Lang: {lang_key}"
    )

    twiml_xml = generate_interactive_twiml(
        medicine=medicine,
        dosage=dosage,
        patient_name=patient_name,
        meal_relation=meal_relation,
        preferred_language=lang_key,
        reminder_id=reminder_id
    )

    if client is None:
        logger.warning(f"[Mock Telephony Mode] Twilio client not configured. Simulated call to {masked_phone}.")
        if reminder_id:
            update_reminder_status(reminder_id, "COMPLETED")
        return {
            "success": True,
            "mock": True,
            "to": masked_phone,
            "from": TWILIO_PHONE_NUMBER,
            "medicine": medicine,
            "dosage": dosage,
            "preferred_language": lang_key,
            "status": "simulated",
            "reminder_id": reminder_id
        }

    try:
        query_str = (
            f"?medicine={quote(medicine)}&dosage={quote(dosage)}"
            f"&patient_name={quote(patient_name or 'Patient')}"
            f"&preferred_language={quote(lang_key)}"
            f"&meal_relation={quote(meal_relation or '')}"
            f"&reminder_id={quote(reminder_id or '')}"
        )
        webhook_url = f"{BASE_WEBHOOK_URL}/api/call/twiml{query_str}"
        status_callback_url = f"{BASE_WEBHOOK_URL}/api/call/webhook/status?reminder_id={quote(reminder_id or '')}"

        # Twilio trial accounts require strictly standard parameters: to, from_, and url
        call = client.calls.create(
            to=formatted_phone,
            from_=TWILIO_PHONE_NUMBER,
            url=webhook_url
        )

        logger.info(f"✓ Twilio Call Created! SID: {call.sid}, Status: {call.status}")
        if reminder_id:
            update_reminder_status(reminder_id, "CALLING", {"call_sid": call.sid})

        return {
            "success": True,
            "call_sid": call.sid,
            "to": masked_phone,
            "from": TWILIO_PHONE_NUMBER,
            "status": call.status,
            "medicine": medicine,
            "dosage": dosage,
            "preferred_language": lang_key,
            "reminder_id": reminder_id
        }
    except Exception as e:
        logger.error(f"Twilio call failed for {masked_phone}: {e}")
        if reminder_id:
            update_reminder_status(reminder_id, "FAILED", {"error": str(e)})
        return {
            "success": False,
            "error": str(e),
            "to": masked_phone,
            "from": TWILIO_PHONE_NUMBER,
            "medicine": medicine,
            "dosage": dosage,
            "preferred_language": lang_key,
            "reminder_id": reminder_id
        }


# ─── Scheduled Background Jobs via APScheduler ──────────────────────────────

def execute_scheduled_reminder(reminder_id: str):
    """Callback executed at exact scheduled time by APScheduler."""
    logger.info(f"[APScheduler Worker] Triggering reminder job: {reminder_id}")
    reminder = get_reminder_by_id(reminder_id)
    if not reminder:
        logger.warning(f"Reminder {reminder_id} not found in DB.")
        return

    # Check idempotency
    status = reminder.get("reminder_status")
    if status in ("CALLING", "COMPLETED"):
        logger.info(f"Reminder {reminder_id} already executed (status={status}). Skipping duplicate.")
        return

    make_twilio_call(
        phone=reminder.get("phone_number", ""),
        medicine=reminder.get("medicine", ""),
        dosage=reminder.get("dosage", ""),
        patient_name=reminder.get("patient_name", ""),
        preferred_language=reminder.get("preferred_language", "en"),
        meal_relation=reminder.get("meal_relation"),
        reminder_id=reminder_id,
        patient_id=reminder.get("patient_id")
    )

    # Safe Hook: Schedule separate 5-minute confirmation check after alert has informed patient
    try:
        from confirmation_service import schedule_confirmation_task
        schedule_confirmation_task(reminder_id=reminder_id, delay_minutes=5)
    except Exception as conf_err:
        logger.warning(f"[Confirmation Hook] Error scheduling 5min check for {reminder_id}: {conf_err}")


def schedule_call_job(
    phone: str,
    medicine: str,
    dosage: str,
    trigger_time_str: Optional[str] = None,
    patient_name: Optional[str] = None,
    preferred_language: Optional[str] = "en",
    patient_id: Optional[str] = None,
    medicine_id: Optional[Any] = None,
    meal_relation: Optional[str] = None,
    reminder_id: Optional[str] = None
) -> Dict[str, Any]:
    """
    Schedules an interactive medication reminder call.
    Stores record in persistent reminders DB with idempotency check.
    """
    scheduler = get_scheduler()
    formatted_phone = format_e164_phone(phone)
    lang_key = normalize_language_code(preferred_language)

    # 1. Parse run_date
    run_date = None
    if trigger_time_str:
        try:
            clean_str = trigger_time_str.replace("Z", "+00:00")
            parsed_dt = datetime.fromisoformat(clean_str)
            if parsed_dt.tzinfo is None:
                parsed_dt = parsed_dt.replace(tzinfo=timezone.utc)
            now_utc = datetime.now(timezone.utc)
            if parsed_dt <= now_utc:
                run_date = now_utc + timedelta(seconds=2)
            else:
                run_date = parsed_dt
        except Exception as parse_err:
            logger.warning(f"Could not parse trigger_time '{trigger_time_str}': {parse_err}. Defaulting to 2s.")
            run_date = datetime.now(timezone.utc) + timedelta(seconds=2)
    else:
        run_date = datetime.now(timezone.utc) + timedelta(seconds=2)

    # 2. Idempotency Key: patientId + medicineId + scheduledTime
    med_id_str = str(medicine_id) if medicine_id is not None else medicine
    patient_id_str = patient_id or formatted_phone
    idempotency_key = f"{patient_id_str}_{med_id_str}_{run_date.isoformat()}"

    reminders = load_reminders()
    for existing_id, r in reminders.items():
        if r.get("idempotency_key") == idempotency_key and r.get("reminder_status") in ("PENDING", "CALLING", "COMPLETED"):
            logger.info(f"[Scheduler Idempotency] Existing job found for {idempotency_key}: {existing_id}. Reusing.")
            return {
                "success": True,
                "reused": True,
                "job_id": existing_id,
                "reminder_id": existing_id,
                "scheduled_time": r.get("scheduled_time"),
                "phone_number": mask_phone_number(formatted_phone),
                "medicine": medicine,
                "dosage": dosage,
                "preferred_language": lang_key
            }

    # 3. Create Reminder Record
    actual_reminder_id = reminder_id or f"rem_{int(datetime.now().timestamp() * 1000)}"
    reminder_record = {
        "id": actual_reminder_id,
        "idempotency_key": idempotency_key,
        "patient_id": patient_id_str,
        "patient_name": patient_name or "Patient",
        "phone_number": formatted_phone,
        "medicine_id": med_id_str,
        "medicine": medicine,
        "dosage": dosage,
        "meal_relation": meal_relation or "",
        "scheduled_time": run_date.isoformat(),
        "preferred_language": lang_key,
        "locale": get_locale_for_language(lang_key),
        "timezone": "Asia/Kolkata",
        "reminder_status": "PENDING",
        "retry_count": 0,
        "source": "OCR_PRESCRIPTION",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat()
    }
    reminders[actual_reminder_id] = reminder_record
    save_reminders(reminders)

    # 4. Schedule via APScheduler
    if scheduler is None:
        logger.warning("APScheduler not available. Executing call directly.")
        execute_scheduled_reminder(actual_reminder_id)
        return {
            "success": True,
            "job_id": actual_reminder_id,
            "reminder_id": actual_reminder_id,
            "scheduled_time": run_date.isoformat(),
            "phone_number": mask_phone_number(formatted_phone),
            "medicine": medicine,
            "dosage": dosage,
            "preferred_language": lang_key
        }

    job = scheduler.add_job(
        execute_scheduled_reminder,
        'date',
        run_date=run_date,
        args=[actual_reminder_id],
        id=actual_reminder_id,
        replace_existing=True
    )

    logger.info(
        f"✓ [Medication Scheduler] Reminder created: {actual_reminder_id} for {mask_phone_number(formatted_phone)} "
        f"({medicine}) at {run_date.isoformat()} in {lang_key}"
    )

    return {
        "success": True,
        "job_id": job.id,
        "reminder_id": actual_reminder_id,
        "scheduled_time": run_date.isoformat(),
        "phone_number": mask_phone_number(formatted_phone),
        "medicine": medicine,
        "dosage": dosage,
        "patient_name": patient_name,
        "preferred_language": lang_key
    }


# ─── Twilio Speech Webhook & Adherence Processing ───────────────────────────

def process_call_speech_response(
    speech_result: str,
    confidence: float,
    call_sid: str,
    reminder_id: Optional[str] = None,
    language: Optional[str] = "en",
    attempt: int = 1
) -> str:
    """
    Handles Twilio <Gather> speech result:
    1. Classifies intent (TAKEN, WILL_TAKE_NOW, DELAYED, SKIPPED, MEDICAL_SAFETY_QUERY, UNCLEAR).
    2. Saves adherence record.
    3. If DELAYED: reschedules follow-up call.
    4. Returns responsive TwiML XML.
    """
    lang_key = normalize_language_code(language)
    reminder = get_reminder_by_id(reminder_id) if reminder_id else None
    patient_id = reminder.get("patient_id", "anonymous") if reminder else "anonymous"
    medicine = reminder.get("medicine", "Medication") if reminder else "Medication"
    medicine_id = reminder.get("medicine_id", "0") if reminder else "0"
    scheduled_time = reminder.get("scheduled_time", datetime.now(timezone.utc).isoformat()) if reminder else datetime.now(timezone.utc).isoformat()

    intent, meta = classify_call_response(speech_result, lang_key)
    logger.info(f"[Twilio Response] Speech='{speech_result}' -> Intent={intent}, Meta={meta}, Reminder={reminder_id}")

    # Build Adherence Record
    adherence_status_map = {
        "TAKEN": "TAKEN",
        "WILL_TAKE_NOW": "TAKEN",
        "DELAYED": "DELAYED",
        "SKIPPED": "SKIPPED",
        "MEDICAL_SAFETY_QUERY": "UNCLEAR",
        "UNCLEAR": "UNCLEAR",
    }
    adherence_status = adherence_status_map.get(intent, "UNCLEAR")
    delay_minutes = meta.get("delayMinutes", 15) if intent == "DELAYED" else None

    adherence_record = {
        "id": f"adh_{int(datetime.now().timestamp() * 1000)}",
        "reminderId": reminder_id or "",
        "patientId": patient_id,
        "medicineId": medicine_id,
        "medicineName": medicine,
        "scheduledTime": scheduled_time,
        "status": adherence_status,
        "confirmationMethod": "TWILIO_VOICE",
        "confirmedAt": datetime.now(timezone.utc).isoformat(),
        "patientResponse": speech_result,
        "callSid": call_sid,
        "language": lang_key,
        "delayMinutes": delay_minutes
    }
    save_adherence_record(adherence_record)

    # Update Reminder Status
    if reminder_id:
        if intent in ("TAKEN", "WILL_TAKE_NOW"):
            update_reminder_status(reminder_id, "COMPLETED")
        elif intent == "SKIPPED":
            update_reminder_status(reminder_id, "SKIPPED")
        elif intent == "DELAYED":
            update_reminder_status(reminder_id, "DELAYED")
            # Reschedule follow-up call!
            if reminder:
                reschedule_delayed_call(reminder, delay_minutes or 15)

    return generate_ack_twiml(
        intent=intent,
        language=lang_key,
        delay_minutes=delay_minutes or 15,
        reminder_id=reminder_id,
        attempt=attempt
    )


def reschedule_delayed_call(reminder: Dict[str, Any], delay_minutes: int):
    """Reschedules follow-up reminder call after patient requested delay."""
    scheduler = get_scheduler()
    if not scheduler:
        return
    followup_time = datetime.now(timezone.utc) + timedelta(minutes=delay_minutes)
    followup_id = f"{reminder.get('id', 'rem')}_delay_{int(followup_time.timestamp())}"

    # Update reminder in DB
    reminders = load_reminders()
    new_reminder = dict(reminder)
    new_reminder["id"] = followup_id
    new_reminder["scheduled_time"] = followup_time.isoformat()
    new_reminder["reminder_status"] = "PENDING"
    new_reminder["retry_count"] = 0
    new_reminder["updated_at"] = datetime.now(timezone.utc).isoformat()
    reminders[followup_id] = new_reminder
    save_reminders(reminders)

    scheduler.add_job(
        execute_scheduled_reminder,
        'date',
        run_date=followup_time,
        args=[followup_id],
        id=followup_id,
        replace_existing=True
    )
    logger.info(f"✓ Rescheduled follow-up call for reminder {followup_id} at {followup_time.isoformat()} ({delay_minutes} min delay)")


def handle_call_status_update(call_sid: str, call_status: str, reminder_id: Optional[str] = None):
    """
    Handles Twilio status callbacks (initiated, ringing, answered, completed, busy, no-answer, failed).
    Implements automated retry up to 2 times for no-answer.
    """
    logger.info(f"[Call Status Callback] CallSid={call_sid}, Status={call_status}, Reminder={reminder_id}")
    if not reminder_id:
        return

    reminder = get_reminder_by_id(reminder_id)
    if not reminder:
        return

    if call_status in ("no-answer", "busy", "failed"):
        retry_count = reminder.get("retry_count", 0)
        if retry_count < 2:
            retry_count += 1
            retry_time = datetime.now(timezone.utc) + timedelta(minutes=10)
            logger.info(f"[Telephony Retry] Call {call_status}. Scheduling retry {retry_count}/2 in 10 minutes.")
            update_reminder_status(reminder_id, "PENDING", {"retry_count": retry_count})
            scheduler = get_scheduler()
            if scheduler:
                scheduler.add_job(
                    execute_scheduled_reminder,
                    'date',
                    run_date=retry_time,
                    args=[reminder_id],
                    id=f"{reminder_id}_retry_{retry_count}",
                    replace_existing=True
                )
        else:
            logger.warning(f"[Telephony Retry Limit] Reminder {reminder_id} failed after {retry_count} retries.")
            update_reminder_status(reminder_id, "FAILED")
            save_adherence_record({
                "id": f"adh_{int(datetime.now().timestamp() * 1000)}",
                "reminderId": reminder_id,
                "patientId": reminder.get("patient_id", "anonymous"),
                "medicineId": reminder.get("medicine_id", "0"),
                "medicineName": reminder.get("medicine", "Medication"),
                "scheduledTime": reminder.get("scheduled_time", datetime.now(timezone.utc).isoformat()),
                "status": "NO_ANSWER",
                "confirmationMethod": "TWILIO_VOICE",
                "confirmedAt": datetime.now(timezone.utc).isoformat(),
                "patientResponse": f"Call ended with status {call_status}",
                "callSid": call_sid,
                "language": reminder.get("preferred_language", "en")
            })
