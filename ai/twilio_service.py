"""
SmartMed AI - Twilio Cloud Telephony & Background Job Scheduler
Enables automated, web-scheduled medication reminder calls via Twilio Voice API and APScheduler.
"""

import os
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional, Dict, Any
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger("smartmed.twilio")

# Twilio Credentials (loaded from environment or .env file)
TWILIO_ACCOUNT_SID = os.getenv("TWILIO_ACCOUNT_SID", "")
TWILIO_AUTH_TOKEN = os.getenv("TWILIO_AUTH_TOKEN", "")
TWILIO_API_KEY = os.getenv("TWILIO_API_KEY", "")
TWILIO_API_SECRET = os.getenv("TWILIO_API_SECRET", "")
TWILIO_PHONE_NUMBER = os.getenv("TWILIO_PHONE_NUMBER", "")

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


LANGUAGE_VOICE_CONFIG = {
    "ta": {
        "voice": "Polly.Valluvar",
        "language": "ta-IN",
        "greeting": lambda name: f"வணக்கம் {name}," if name else "வணக்கம்,",
        "body": lambda med, dose: (
            f"இது ஸ்மார்ட்மெட் தானியங்கி மருத்துவ எச்சரிக்கை அழைப்பு. உங்கள் மாத்திரைகளை சரியான நேரத்தில் எடுத்துக் கொள்ளுங்கள். "
            f"உங்கள் மருந்து: {med}, அளவு: {dose}. மருத்துவர் பரிந்துரைத்தபடி மாத்திரைகளை சரியான நேரத்தில் எடுப்பது உங்கள் உடல்நலத்திற்கு மிகவும் முக்கியம். "
            f"இப்போது ஒரு டம்ளர் தண்ணீருடன் உங்கள் மாத்திரைகளை எடுத்துக் கொள்ளவும். நன்றி!"
        ),
        "footer": "முக்கிய மருத்துவ எச்சரிக்கை: மாத்திரைகளை சரியான நேரத்தில் எடுப்பதை உறுதிப்படுத்தவும். உடலை நன்றாகப் பார்த்துக் கொள்ளுங்கள்!"
    },
    "hi": {
        "voice": "Polly.Kajal",
        "language": "hi-IN",
        "greeting": lambda name: f"नमस्ते {name}," if name else "नमस्ते,",
        "body": lambda med, dose: (
            f"यह स्मार्टमेड स्वचालित स्वास्थ्य चेतावनी कॉल है। कृपया अपनी दवाएं सही समय पर लें। "
            f"आपकी निर्धारित दवा है {med}, खुराक: {dose}। डॉक्टर के निर्देशानुसार समय पर दवा लेना आपके स्वास्थ्य के लिए अनिवार्य है। "
            f"कृपया अभी अपनी दवा पानी के साथ लें। धन्यवाद!"
        ),
        "footer": "महत्वपूर्ण स्वास्थ्य चेतावनी: कृपया सुनिश्चित करें कि दवाएं सही समय पर ली गई हैं। अपना ध्यान रखें!"
    },
    "te": {
        "voice": "Polly.Aditi",
        "language": "te-IN",
        "greeting": lambda name: f"నమస్కారం {name}," if name else "నమస్కారం,",
        "body": lambda med, dose: (
            f"ఇది స్మార్ట్‌మెడ్ ఆటోమేటెడ్ హెల్త్‌కేర్ అలర్ట్ కాల్. దయచేసి మీ మందులను సరైన సమయానికి తీసుకోండి. "
            f"మీ మందు: {med}, మోతాదు: {dose}. డాక్టర్ సూచించిన విధంగా సమయానికి మందులు వేసుకోవడం మీ ఆరోగ్యానికి ఎంతో ముఖ్యం. "
            f"దయచేసి ఇప్పుడే మీ మందులను నీటితో తీసుకోండి. ధన్యవాదాలు!"
        ),
        "footer": "ముఖ్యమైన ఆరోగ్య హెచ్చరిక: దయచేసి మీ మందులు సరైన సమయానికి తీసుకున్నారని నిర్ధారించుకోండి. జాగ్రత్తగా ఉండండి!"
    },
    "kn": {
        "voice": "Polly.Aditi",
        "language": "kn-IN",
        "greeting": lambda name: f"ನಮಸ್ಕಾರ {name}," if name else "ನಮಸ್ಕಾರ,",
        "body": lambda med, dose: (
            f"ಇದು ಸ್ಮಾರ್ಟ್‌ಮೆಡ್ ಸ್ವಯಂಚಾಲಿತ ಆರೋಗ್ಯ ಎಚ್ಚರಿಕೆ ಕರೆ. ದಯವಿಟ್ಟು ನಿಮ್ಮ ಔಷಧಿಗಳನ್ನು ಸರಿಯಾದ ಸಮಯಕ್ಕೆ ತೆಗೆದುಕೊಳ್ಳಿ. "
            f"ನಿಮ್ಮ ಔಷಧಿ: {med}, ಪ್ರಮಾಣ: {dose}. ವೈದ್ಯರು ಸೂಚಿಸಿದಂತೆ ಸರಿಯಾದ ಸಮಯಕ್ಕೆ ಔಷಧಿ ತೆಗೆದುಕೊಳ್ಳುವುದು ನಿಮ್ಮ ಆರೋಗ್ಯಕ್ಕೆ ಅತ್ಯಗತ್ಯ. "
            f"ದಯವಿಟ್ಟು ಈಗಲೇ ನೀರಿನೊಂದಿಗೆ ಔಷಧಿ ತೆಗೆದುಕೊಳ್ಳಿ. ಧನ್ಯವಾದಗಳು!"
        ),
        "footer": "ಪ್ರಮುಖ ಆರೋಗ್ಯ ಎಚ್ಚರಿಕೆ: ದಯವಿಟ್ಟು ನಿಮ್ಮ ಔಷಧಿಗಳನ್ನು ಸರಿಯಾದ ಸಮಯಕ್ಕೆ ತೆಗೆದುಕೊಂಡಿರುವುದನ್ನು ಖಚಿತಪಡಿಸಿಕೊಳ್ಳಿ. ಕಾಳಜಿ ವಹಿಸಿ!"
    },
    "ml": {
        "voice": "Polly.Aditi",
        "language": "ml-IN",
        "greeting": lambda name: f"നമസ്കാരം {name}," if name else "നമസ്കാരം,",
        "body": lambda med, dose: (
            f"ഇത് സ്മാർട്ട്മെഡ് ഓട്ടോമേറ്റഡ് ഹെൽത്ത് അലർട്ട് കോൾ ആണ്. നിങ്ങളുടെ മരുന്നുകൾ കൃത്യസമയത്ത് കഴിക്കാൻ ശ്രദ്ധിക്കുക. "
            f"നിങ്ങളുടെ മരുന്ന്: {med}, അളവ്: {dose}. ഡോക്ടറുടെ നിർദ്ദേശപ്രകാരം കൃത്യസമയത്ത് മരുന്ന് കഴിക്കുന്നത് നിങ്ങളുടെ ആരോഗ്യത്തിന് അത്യന്താപേക്ഷിതമാണ്. "
            f"ദയവായി ഇപ്പോൾ തന്നെ മരുന്ന് കഴിക്കുക. നന്ദി!"
        ),
        "footer": "പ്രധാന ആരോഗ്യ മുന്നറിയിപ്പ്: ഗുളികകൾ കൃത്യസമയത്ത് കഴിച്ചുവെന്ന് ഉറപ്പാക്കുക. ആരോഗ്യത്തോടെ ഇരിക്കുക!"
    },
    "en": {
        "voice": "Polly.Aditi",
        "language": "en-IN",
        "greeting": lambda name: f"Hello {name}," if name else "Hello,",
        "body": lambda med, dose: (
            f"this is your SmartMed automated healthcare alert. "
            f"Please ensure your tablets are taken at the right time. "
            f"Your scheduled prescription is {med}, dosage: {dose}. "
            f"Taking your tablets at the right time as directed by your doctor is essential for your recovery and well-being. "
            f"Please take your prescribed tablets now with plain water. Thank you and stay healthy!"
        ),
        "footer": "Important healthcare alert: Please verify your tablets are taken at the right time. Take care!"
    }
}


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


def generate_twiml(
    medicine: str,
    dosage: str,
    patient_name: Optional[str] = None,
    preferred_language: Optional[str] = "en"
) -> str:
    """
    Generate TwiML XML string with dynamically mapped Amazon Polly Neural Voice
    for the user's preferred language (ta, hi, te, kn, ml, en).
    Explicitly alerts patient to ensure tablets are taken at the right time.
    """
    lang_key = normalize_language_code(preferred_language)
    cfg = LANGUAGE_VOICE_CONFIG.get(lang_key, LANGUAGE_VOICE_CONFIG["en"])
    
    greeting = cfg["greeting"](patient_name)
    body = cfg["body"](medicine, dosage)
    footer = cfg["footer"]
    voice = cfg["voice"]
    locale = cfg["language"]
    
    spoken_text = f"{greeting} {body}"
    
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="{voice}" language="{locale}">{spoken_text}</Say>
  <Pause length="1"/>
  <Say voice="{voice}" language="{locale}">{footer}</Say>
</Response>"""


def make_twilio_call(
    phone: str,
    medicine: str,
    dosage: str,
    patient_name: Optional[str] = None,
    preferred_language: Optional[str] = "en"
) -> Dict[str, Any]:
    """
    Executes client.calls.create(...) using Twilio Voice API and inline TwiML.
    Supports preferred_language dynamic Polly voice routing.
    """
    client = get_twilio_client()
    formatted_phone = format_e164_phone(phone)
    lang_key = normalize_language_code(preferred_language)
    twiml_xml = generate_twiml(medicine, dosage, patient_name, lang_key)

    logger.info(
        f"Initiating Twilio Call -> To: {formatted_phone}, From: {TWILIO_PHONE_NUMBER}, "
        f"Med: {medicine} ({dosage}), Lang: {lang_key}"
    )

    if client is None:
        logger.warning(f"[Mock Mode] Twilio client not available. Call to {formatted_phone} simulated.")
        return {
            "success": True,
            "mock": True,
            "to": formatted_phone,
            "from": TWILIO_PHONE_NUMBER,
            "medicine": medicine,
            "dosage": dosage,
            "preferred_language": lang_key,
            "status": "simulated"
        }

    try:
        from urllib.parse import quote
        webhook_url = (
            f"https://smart-med.duckdns.org/api/call/twiml"
            f"?medicine={quote(medicine)}&dosage={quote(dosage)}"
            f"&patient_name={quote(patient_name or 'Patient')}"
            f"&preferred_language={quote(lang_key)}"
        )
        try:
            call = client.calls.create(
                to=formatted_phone,
                from_=TWILIO_PHONE_NUMBER,
                url=webhook_url
            )
        except Exception as tw_url_err:
            logger.warning(f"Twilio call with url failed ({tw_url_err}), retrying with inline twiml...")
            call = client.calls.create(
                to=formatted_phone,
                from_=TWILIO_PHONE_NUMBER,
                twiml=twiml_xml
            )
        logger.info(f"✓ Twilio Call Created! SID: {call.sid}, Status: {call.status}")
        return {
            "success": True,
            "call_sid": call.sid,
            "to": formatted_phone,
            "from": TWILIO_PHONE_NUMBER,
            "status": call.status,
            "medicine": medicine,
            "dosage": dosage,
            "preferred_language": lang_key
        }
    except Exception as e:
        logger.error(f"Twilio call failed for {formatted_phone}: {e}")
        return {
            "success": False,
            "error": str(e),
            "to": formatted_phone,
            "from": TWILIO_PHONE_NUMBER,
            "medicine": medicine,
            "dosage": dosage,
            "preferred_language": lang_key
        }


def schedule_call_job(
    phone: str,
    medicine: str,
    dosage: str,
    trigger_time_str: Optional[str] = None,
    patient_name: Optional[str] = None,
    preferred_language: Optional[str] = "en"
) -> Dict[str, Any]:
    """
    Parses trigger_time and adds a job to APScheduler:
    scheduler.add_job(make_twilio_call, 'date', run_date=trigger_time, args=[...])
    """
    scheduler = get_scheduler()
    formatted_phone = format_e164_phone(phone)
    lang_key = normalize_language_code(preferred_language)

    run_date = None
    if trigger_time_str:
        try:
            clean_str = trigger_time_str.replace("Z", "+00:00")
            parsed_dt = datetime.fromisoformat(clean_str)
            if parsed_dt.tzinfo is None:
                parsed_dt = parsed_dt.replace(tzinfo=timezone.utc)
            
            now_utc = datetime.now(timezone.utc)
            # If trigger time is within 3 seconds or in the past, trigger shortly (2 seconds from now)
            if parsed_dt <= now_utc:
                run_date = now_utc + timedelta(seconds=2)
            else:
                run_date = parsed_dt
        except Exception as parse_err:
            logger.warning(f"Could not parse trigger_time '{trigger_time_str}': {parse_err}. Defaulting to 2s.")
            run_date = datetime.now(timezone.utc) + timedelta(seconds=2)
    else:
        run_date = datetime.now(timezone.utc) + timedelta(seconds=2)

    if scheduler is None:
        logger.warning("Scheduler not initialized. Executing call directly.")
        res = make_twilio_call(formatted_phone, medicine, dosage, patient_name, lang_key)
        return {
            "success": res.get("success", False),
            "job_id": "direct-execution",
            "scheduled_time": run_date.isoformat(),
            "phone_number": formatted_phone,
            "medicine": medicine,
            "dosage": dosage,
            "preferred_language": lang_key,
            "result": res
        }

    job_id = f"twilio_call_{int(datetime.now().timestamp() * 1000)}"
    job = scheduler.add_job(
        make_twilio_call,
        'date',
        run_date=run_date,
        args=[formatted_phone, medicine, dosage, patient_name, lang_key],
        id=job_id,
        replace_existing=True
    )

    logger.info(f"✓ APScheduler Job added [{job.id}] for {formatted_phone} in {lang_key} at {run_date.isoformat()}")

    return {
        "success": True,
        "job_id": job.id,
        "scheduled_time": run_date.isoformat(),
        "phone_number": formatted_phone,
        "medicine": medicine,
        "dosage": dosage,
        "patient_name": patient_name,
        "preferred_language": lang_key
    }
