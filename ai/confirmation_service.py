"""
SmartMed AI - 5-Minute Medication Confirmation Workflow
======================================================
Independent confirmation service that executes 5 minutes after
the existing medication reminder alert has completed.

Rules:
1. Existing alert informs the patient: "Your medicine time has arrived. Please take your medicine."
2. 5 minutes later, this confirmation system calls the patient and asks: "Did you take your medicine?"
3. In patient's preferred language (ta, en, hi, te, kn, ml).
4. Patient confirms (TAKEN) -> medicationStatus = TAKEN, takenAt, confirmationMethod = TWILIO_VOICE.
5. Patient has not taken it (NOT_TAKEN) -> Asks "When should we remind you again?", reschedules for 10 or 30 mins.
"""

import os
import re
import json
import logging
import threading
from datetime import datetime, timezone, timedelta
from typing import Dict, Any, Optional, Tuple, List
from urllib.parse import quote

logger = logging.getLogger("smartmed.confirmation")

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
os.makedirs(DATA_DIR, exist_ok=True)
CONFIRMATIONS_FILE = os.path.join(DATA_DIR, "confirmations.json")
_storage_lock = threading.Lock()

BASE_WEBHOOK_URL = os.getenv("TWILIO_WEBHOOK_URL", "https://smart-med.duckdns.org").rstrip("/")


# ─── Multilingual Confirmation Voice & Prompts ──────────────────────────────

CONFIRMATION_VOICE_CONFIG = {
    "ta": {
        "voice": "Polly.Valluvar",
        "language": "ta-IN",
        "question": "5 நிமிடங்களுக்கு முன்பு உங்கள் மருந்தை எடுத்துக்கொள்ள நினைவூட்டினோம். நீங்கள் மருந்தை எடுத்துவிட்டீர்களா?",
        "taken_ack": "நன்றி! உங்கள் மருந்து உட்கொள்ளல் பதிவு செய்யப்பட்டது. உடலை நன்றாகப் பார்த்துக் கொள்ளுங்கள்.",
        "not_taken_ask": "எப்போது மீண்டும் நினைவூட்ட வேண்டும்?",
        "reschedule_ack": lambda d: f"சரி, {d} நிமிடங்கள் கழித்து மீண்டும் அழைக்கிறேன். நன்றி!",
        "clarify": "மன்னிக்கவும், உங்கள் பதில் தெளிவாகக் கேட்கவில்லை. நீங்கள் மருந்தை எடுத்துவிட்டீர்களா? ஆம் அல்லது இல்லை என்று கூறவும்.",
        "no_speech": "நன்றி. தயவுசெய்து உங்கள் மாத்திரையை சரியான நேரத்தில் எடுத்துக்கொள்ளுங்கள்."
    },
    "en": {
        "voice": "Polly.Aditi",
        "language": "en-IN",
        "question": "We reminded you 5 minutes ago to take your medicine. Have you taken your medicine?",
        "taken_ack": "Thank you! Your medication has been marked as taken. Take care!",
        "not_taken_ask": "When should we remind you again?",
        "reschedule_ack": lambda d: f"Understood. We will call you again in {d} minutes. Thank you!",
        "clarify": "Sorry, I didn't catch that clearly. Have you taken your medicine? Please say yes or no.",
        "no_speech": "Thank you. Please remember to take your medication on time."
    },
    "hi": {
        "voice": "Polly.Kajal",
        "language": "hi-IN",
        "question": "हमने आपको 5 मिनट पहले अपनी दवा लेने के लिए याद दिलाया था। क्या आपने अपनी दवा ले ली है?",
        "taken_ack": "धन्यवाद! आपकी दवा लेने की पुष्टि दर्ज कर ली गई है। अपना ख्याल रखें।",
        "not_taken_ask": "हम आपको दोबारा कब याद दिलाएं?",
        "reschedule_ack": lambda d: f"समझ गया। हम आपको {d} मिनट बाद दोबारा कॉल करेंगे। धन्यवाद!",
        "clarify": "क्षमा करें, बात स्पष्ट नहीं हुई। क्या आपने दवा ली है? कृपया हाँ या नहीं कहें।",
        "no_speech": "धन्यवाद। कृपया समय पर अपनी दवा अवश्य लें।"
    },
    "te": {
        "voice": "Polly.Aditi",
        "language": "te-IN",
        "question": "మేము 5 నిమిషాల క్రితం మీ మందులు వేసుకోవాలని గుర్తుచేశాము. మీరు మీ మందులు వేసుకున్నారా?",
        "taken_ack": "ధన్యవాదాలు! మీ మందుల వివరాలు నమోదు చేయబడ్డాయి. జాగ్రత్తగా ఉండండి.",
        "not_taken_ask": "ఎప్పుడు మళ్లీ గుర్తు చేయాలి?",
        "reschedule_ack": lambda d: f"సరే, {d} నిమిషాల తర్వాత మళ్లీ కాల్ చేస్తాము. ధన్యవాదాలు!",
        "clarify": "క్షమించండి, స్పష్టంగా వినిపించలేదు. మీరు మందులు వేసుకున్నారా? అవును లేదా కాదు అని చెప్పండి.",
        "no_speech": "ధన్యవాదాలు. దయచేసి సమయానికి మందులు వేసుకోండి."
    },
    "kn": {
        "voice": "Polly.Aditi",
        "language": "kn-IN",
        "question": "ನಾವು 5 ನಿಮಿಷಗಳ ಹಿಂದೆ ನಿಮ್ಮ ಔಷಧಿಯನ್ನು ತೆಗೆದುಕೊಳ್ಳಲು ನೆನಪಿಸಿದ್ದೆವು. ನೀವು ಔಷಧಿಯನ್ನು ತೆಗೆದುಕೊಂಡಿದ್ದೀರಾ?",
        "taken_ack": "ಧನ್ಯವಾದಗಳು! ನಿಮ್ಮ ಔಷಧಿ ವಿವರ ದಾಖಲಾಗಿದೆ. ಆರೋಗ್ಯವಾಗಿರಿ.",
        "not_taken_ask": "ಮತ್ತೆ ಯಾವಾಗ ನೆನಪಿಸಬೇಕು?",
        "reschedule_ack": lambda d: f"ಸರಿ, {d} ನಿಮಿಷಗಳ ನಂತರ ಮತ್ತೆ ಕರೆ ಮಾಡುತ್ತೇವೆ. ಧನ್ಯವಾದಗಳು!",
        "clarify": "ಕ್ಷಮಿಸಿ, ಸ್ಪಷ್ಟವಾಗಿ ಕೇಳಿಸಲಿಲ್ಲ. ನೀವು ಔಷಧಿ ತೆಗೆದುಕೊಂಡಿದ್ದೀರಾ? ಹೌದು ಅಥವಾ ಇಲ್ಲ ಎಂದು ಹೇಳಿ.",
        "no_speech": "ಧನ್ಯವಾದಗಳು. ದಯವಿಟ್ಟು ಸಮಯಕ್ಕೆ ಔಷಧಿ ತೆಗೆದುಕೊಳ್ಳಿ."
    },
    "ml": {
        "voice": "Polly.Aditi",
        "language": "ml-IN",
        "question": "ഞങ്ങൾ 5 മിനിറ്റ് മുമ്പ് നിങ്ങളുടെ മരുന്ന് കഴിക്കാൻ ഓർമ്മിപ്പിച്ചിരുന്നു. നിങ്ങൾ മരുന്ന് കഴിച്ചോ?",
        "taken_ack": "നന്ദി! നിങ്ങൾ മരുന്ന് കഴിച്ചത് രേഖപ്പെടുത്തി. ആരോഗ്യം ശ്രദ്ധിക്കുക.",
        "not_taken_ask": "എപ്പോഴാണ് വീണ്ടും ഓർമ്മിപ്പിക്കേണ്ടത്?",
        "reschedule_ack": lambda d: f"ശരി, {d} മിനിറ്റിനു ശേഷം വീണ്ടും വിളിക്കാം. നന്ദി!",
        "clarify": "ക്ഷമിക്കണം, വ്യക്തമായില്ല. നിങ്ങൾ മരുന്ന് കഴിച്ചോ? അതെ അല്ലെങ്കിൽ ഇല്ല എന്ന് പറയുക.",
        "no_speech": "നന്ദി. ദയവായി കൃത്യസമയത്ത് മരുന്ന് കഴിക്കുക."
    }
}


# ─── Storage Helpers ─────────────────────────────────────────────────────────

def load_confirmations() -> Dict[str, Dict[str, Any]]:
    with _storage_lock:
        if not os.path.exists(CONFIRMATIONS_FILE):
            return {}
        try:
            with open(CONFIRMATIONS_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            logger.warning(f"Error loading confirmations file: {e}")
            return {}


def save_confirmations(data: Dict[str, Dict[str, Any]]):
    with _storage_lock:
        try:
            with open(CONFIRMATIONS_FILE, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
        except Exception as e:
            logger.error(f"Error saving confirmations file: {e}")


def get_confirmation_by_id(confirmation_id: str) -> Optional[Dict[str, Any]]:
    confirmations = load_confirmations()
    return confirmations.get(confirmation_id)


def update_confirmation_status(confirmation_id: str, status: str, extra: Optional[Dict[str, Any]] = None):
    confirmations = load_confirmations()
    if confirmation_id in confirmations:
        confirmations[confirmation_id]["confirmation_status"] = status
        confirmations[confirmation_id]["updated_at"] = datetime.now(timezone.utc).isoformat()
        if extra:
            confirmations[confirmation_id].update(extra)
        save_confirmations(confirmations)
        logger.info(f"[Confirmation DB] Updated {confirmation_id} -> {status}")


# ─── Speech Classification for Confirmation ─────────────────────────────────

def classify_confirmation_intent(speech_text: str, language: str = "en") -> str:
    """
    Classifies patient response during the 5-minute confirmation call:
    - TAKEN: Patient confirmed taking medicine
    - NOT_TAKEN: Patient says not yet / hasn't taken
    - UNCLEAR: Could not determine
    """
    if not speech_text or not speech_text.strip():
        return "UNCLEAR"

    t = speech_text.lower().strip()
    words = t.split()
    tokens = set(re.findall(r'\w+', t, re.UNICODE))

    def matches(kw: str) -> bool:
        if " " in kw:
            return kw in t
        if len(kw) <= 3:
            return kw in tokens or kw in words
        return kw in t or kw in tokens

    # Negative / NOT TAKEN keywords (Checked FIRST to avoid false positives on 'haven't taken')
    not_taken_keywords = [
        # Tamil
        "இல்லை", "இல்ல", "இன்னும் எடுக்கவில்லை", "இன்னும் இல்லை", "இன்னும் இல்ல", "எடுக்கல",
        "சாப்பிடல", "போடல", "illa", "illai", "edukala", "sappidala", "innum illa",
        # English
        "haven't", "havent", "not yet", "i haven't taken it", "have not", "didn't", "did not",
        "no", "nope", "not now", "not taken", "i have not taken", "did not take", "didn't take",
        "later", "still not", "not yet taken", "wont", "won't",
        # Hindi
        "नहीं", "नहीं ली", "अभी नहीं", "nahi", "nahi li", "abhi nahi", "nahi li hai",
        # Telugu
        "లేదు", "ఇంకా తీసుకోలేదు", "ledu", "inka ledu",
        # Kannada
        "ಇಲ್ಲ", "ಇನ್ನೂ ತೆಗೆದುಕೊಂಡಿಲ್ಲ", "illa",
        # Malayalam
        "ഇല്ല", "ഇതുവരെ കഴിച്ചില്ല", "illa"
    ]

    for kw in not_taken_keywords:
        if matches(kw):
            return "NOT_TAKEN"

    # Positive / TAKEN keywords
    taken_keywords = [
        # Tamil
        "ஆம்", "ஆமாம்", "எடுத்துக்கிட்டேன்", "எடுத்துட்டேன்", "எடுத்தாச்சு", "சாப்பிட்டேன்",
        "சாப்பிட்டாச்சு", "குடிச்சேன்", "குடிச்சாச்சு", "போட்டேன்", "போட்டாச்சு", "முடிஞ்சது",
        "eduthen", "eduthuten", "eduthachu", "aamam", "aam", "sappitachu", "potachu",
        # English
        "yes", "yeah", "yup", "i took it", "taken", "already taken", "already took",
        "i have taken", "had it", "done", "took it", "took", "finished", "swallowed",
        # Hindi
        "हाँ", "हा", "ले ली", "खा ली", "ले लिया", "खा लिया", "हो गया", "haa", "haan",
        # Telugu
        "అవును", "తీసుకున్నాను", "వేశాను", "avunu", "teesukunna",
        # Kannada
        "ಹೌದು", "ತೆಗೆದುಕೊಂಡಿದ್ದೇನೆ", "haudu",
        # Malayalam
        "അതെ", "കഴിച്ചു", "athe", "kazhichu"
    ]

    for kw in taken_keywords:
        if matches(kw):
            return "TAKEN"

    return "UNCLEAR"


def parse_reschedule_delay(speech_text: str) -> int:
    """
    Parses reschedule time requested by patient when they haven't taken medicine yet:
    Supports 10 minutes, 30 minutes, or any number of minutes.
    """
    t = speech_text.lower().strip()
    if "10" in t or "ten" in t or "பத்து" in t or "दस" in t or "పది" in t or "ಹತ್ತು" in t or "പത്ത്" in t:
        return 10
    if "30" in t or "thirty" in t or "முப்பது" in t or "आधा घंटा" in t or "half an hour" in t or "അര മണിക്കൂർ" in t:
        return 30
    if "20" in t or "twenty" in t or "இருபது" in t or "बीस" in t:
        return 20
    if "15" in t or "fifteen" in t or "பதினைந்து" in t or "पंद्रह" in t:
        return 15

    match = re.search(r"\b(\d+)\b", t)
    if match:
        try:
            val = int(match.group(1))
            if 1 <= val <= 180:
                return val
        except Exception:
            pass

    return 10  # Default to 10 minutes follow-up


# ─── Confirmation Scheduler (+5 Minutes After Alert) ─────────────────────────

def schedule_confirmation_task(
    reminder_id: str,
    delay_minutes: int = 5,
    force: bool = False
) -> Dict[str, Any]:
    """
    Schedules an automated confirmation telephone call exactly +5 minutes
    after the existing reminder alert.
    """
    from twilio_service import get_scheduler, get_reminder_by_id, format_e164_phone, normalize_language_code, mask_phone_number

    reminder = get_reminder_by_id(reminder_id)
    if not reminder:
        logger.warning(f"[Confirmation] Reminder {reminder_id} not found.")
        return {"success": False, "error": "Reminder not found"}

    phone = reminder.get("phone_number", "")
    formatted_phone = format_e164_phone(phone)
    lang_key = normalize_language_code(reminder.get("preferred_language", "en"))
    medicine = reminder.get("medicine", "Medication")
    dosage = reminder.get("dosage", "")
    patient_name = reminder.get("patient_name", "Patient")

    # Idempotency check: Don't schedule duplicate confirmation if already pending
    confirmations = load_confirmations()
    if not force:
        for cid, c in confirmations.items():
            if c.get("reminder_id") == reminder_id and c.get("confirmation_status") in ("PENDING", "CALLING"):
                logger.info(f"[Confirmation Idempotency] Existing confirmation {cid} found for {reminder_id}. Reusing.")
                return {
                    "success": True,
                    "reused": True,
                    "confirmation_id": cid,
                    "scheduled_confirmation_time": c.get("scheduled_confirmation_time")
                }

    now_utc = datetime.now(timezone.utc)
    run_date = now_utc + timedelta(minutes=delay_minutes)
    confirmation_id = f"conf_{reminder_id}_{int(now_utc.timestamp())}"

    conf_record = {
        "id": confirmation_id,
        "reminder_id": reminder_id,
        "patient_id": reminder.get("patient_id", formatted_phone),
        "patient_name": patient_name,
        "phone_number": formatted_phone,
        "medicine_id": reminder.get("medicine_id", medicine),
        "medicine": medicine,
        "dosage": dosage,
        "meal_relation": reminder.get("meal_relation", ""),
        "preferred_language": lang_key,
        "scheduled_confirmation_time": run_date.isoformat(),
        "confirmation_status": "PENDING",
        "medication_status": "PENDING",
        "taken_at": None,
        "confirmation_method": None,
        "created_at": now_utc.isoformat(),
        "updated_at": now_utc.isoformat()
    }
    confirmations[confirmation_id] = conf_record
    save_confirmations(confirmations)

    scheduler = get_scheduler()
    if scheduler:
        scheduler.add_job(
            execute_confirmation_call,
            'date',
            run_date=run_date,
            args=[confirmation_id],
            id=confirmation_id,
            replace_existing=True
        )
        logger.info(f"✓ [Confirmation Scheduler] Scheduled confirmation call for reminder {reminder_id} at {run_date.isoformat()} ({delay_minutes} min delay)")
    else:
        logger.warning("[Confirmation Scheduler] APScheduler not running!")

    return {
        "success": True,
        "confirmation_id": confirmation_id,
        "reminder_id": reminder_id,
        "phone_number": mask_phone_number(formatted_phone),
        "scheduled_confirmation_time": run_date.isoformat()
    }


def execute_confirmation_call(confirmation_id: str):
    """
    Executes the outbound confirmation telephone call.
    Asks the patient: "Did you take your medicine?"
    """
    logger.info(f"[APScheduler Worker] Executing confirmation call: {confirmation_id}")
    conf = get_confirmation_by_id(confirmation_id)
    if not conf:
        logger.warning(f"[Confirmation] Record {confirmation_id} not found.")
        return

    from twilio_service import get_twilio_client, TWILIO_PHONE_NUMBER, mask_phone_number
    client = get_twilio_client()
    formatted_phone = conf.get("phone_number", "")
    masked_phone = mask_phone_number(formatted_phone)

    webhook_url = f"{BASE_WEBHOOK_URL}/api/call/confirmation/twiml?confirmation_id={quote(confirmation_id)}"

    if client is None:
        logger.warning(f"[Mock Telephony] Confirmation call simulated to {masked_phone}.")
        update_confirmation_status(confirmation_id, "COMPLETED")
        return

    try:
        call = client.calls.create(
            to=formatted_phone,
            from_=TWILIO_PHONE_NUMBER,
            url=webhook_url
        )
        logger.info(f"✓ Twilio Confirmation Call Created! SID: {call.sid}, Status: {call.status}")
        update_confirmation_status(confirmation_id, "CALLING", {"call_sid": call.sid})
    except Exception as e:
        logger.error(f"Failed to initiate Twilio confirmation call for {masked_phone}: {e}")
        update_confirmation_status(confirmation_id, "FAILED", {"error": str(e)})


# ─── TwiML Generation for Confirmation Call ──────────────────────────────────

def generate_confirmation_twiml(confirmation_id: str, attempt: int = 1) -> str:
    """
    Generates TwiML for the second (confirmation) call.
    Uses patient's selected language:
    e.g. Tamil: "5 நிமிடங்களுக்கு முன்பு உங்கள் மருந்தை எடுத்துக்கொள்ள நினைவூட்டினோம். நீங்கள் மருந்தை எடுத்துவிட்டீர்களா?"
    """
    conf = get_confirmation_by_id(confirmation_id)
    lang_key = conf.get("preferred_language", "en") if conf else "en"
    cfg = CONFIRMATION_VOICE_CONFIG.get(lang_key, CONFIRMATION_VOICE_CONFIG["en"])

    voice = cfg["voice"]
    locale = cfg["language"]
    question_text = cfg["question"]
    no_speech_text = cfg["no_speech"]

    action_url = f"{BASE_WEBHOOK_URL}/api/call/confirmation/response?confirmation_id={quote(confirmation_id)}&lang={quote(lang_key)}&attempt={attempt}"

    return f"""<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="speech" action="{action_url}" method="POST" language="{locale}" timeout="6" speechTimeout="auto">
    <Say voice="{voice}" language="{locale}">{question_text}</Say>
  </Gather>
  <Say voice="{voice}" language="{locale}">{no_speech_text}</Say>
  <Hangup/>
</Response>"""


def process_confirmation_speech_response(
    confirmation_id: str,
    speech_text: str,
    attempt: int = 1
) -> str:
    """
    Processes patient speech during confirmation call:
    1. TAKEN:
       medicationStatus = "TAKEN"
       takenAt = timestamp
       confirmationMethod = "TWILIO_VOICE"
    2. NOT_TAKEN:
       medicationStatus = "NOT_TAKEN"
       Asks "When should we remind you again?"
    3. UNCLEAR:
       Clarifies or exits.
    """
    conf = get_confirmation_by_id(confirmation_id)
    lang_key = conf.get("preferred_language", "en") if conf else "en"
    cfg = CONFIRMATION_VOICE_CONFIG.get(lang_key, CONFIRMATION_VOICE_CONFIG["en"])
    voice = cfg["voice"]
    locale = cfg["language"]

    intent = classify_confirmation_intent(speech_text, lang_key)
    logger.info(f"[Confirmation Speech] ConfId={confirmation_id}, Speech='{speech_text}' -> Intent={intent}")

    if intent == "TAKEN":
        now_iso = datetime.now(timezone.utc).isoformat()
        # 1. Update confirmation record
        update_confirmation_status(confirmation_id, "COMPLETED", {
            "medication_status": "TAKEN",
            "taken_at": now_iso,
            "confirmation_method": "TWILIO_VOICE",
            "patient_response": speech_text
        })

        # 2. Update parent reminder record
        from twilio_service import update_reminder_status, save_adherence_record
        if conf and conf.get("reminder_id"):
            update_reminder_status(conf["reminder_id"], "COMPLETED", {
                "medication_status": "TAKEN",
                "taken_at": now_iso,
                "confirmation_method": "TWILIO_VOICE"
            })

            # 3. Save Adherence record
            save_adherence_record({
                "id": f"adh_{int(datetime.now().timestamp() * 1000)}",
                "reminderId": conf["reminder_id"],
                "confirmationId": confirmation_id,
                "patientId": conf.get("patient_id", ""),
                "medicineId": conf.get("medicine_id", ""),
                "medicineName": conf.get("medicine", ""),
                "scheduledTime": conf.get("scheduled_confirmation_time", now_iso),
                "status": "TAKEN",
                "confirmationMethod": "TWILIO_VOICE",
                "confirmedAt": now_iso,
                "patientResponse": speech_text,
                "language": lang_key
            })

        ack_text = cfg["taken_ack"]
        return f"""<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="{voice}" language="{locale}">{ack_text}</Say>
  <Hangup/>
</Response>"""

    elif intent == "NOT_TAKEN":
        # Do NOT mark as TAKEN
        update_confirmation_status(confirmation_id, "NOT_TAKEN", {
            "medication_status": "NOT_TAKEN",
            "patient_response": speech_text
        })
        from twilio_service import update_reminder_status
        if conf and conf.get("reminder_id"):
            update_reminder_status(conf["reminder_id"], "NOT_TAKEN", {
                "medication_status": "NOT_TAKEN"
            })

        # Ask: "When should we remind you again?"
        ask_text = cfg["not_taken_ask"]
        reschedule_url = f"{BASE_WEBHOOK_URL}/api/call/confirmation/reschedule?confirmation_id={quote(confirmation_id)}&lang={quote(lang_key)}"

        return f"""<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="speech" action="{reschedule_url}" method="POST" language="{locale}" timeout="6" speechTimeout="auto">
    <Say voice="{voice}" language="{locale}">{ask_text}</Say>
  </Gather>
  <Say voice="{voice}" language="{locale}">{cfg["no_speech"]}</Say>
  <Hangup/>
</Response>"""

    else:  # UNCLEAR
        if attempt < 2:
            clarify_text = cfg["clarify"]
            action_url = f"{BASE_WEBHOOK_URL}/api/call/confirmation/response?confirmation_id={quote(confirmation_id)}&lang={quote(lang_key)}&attempt={attempt + 1}"
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


def process_confirmation_reschedule(confirmation_id: str, speech_text: str) -> str:
    """
    Handles patient's response when asked: "When should we remind you again?".
    Parses minutes (e.g. 10 or 30 mins) and schedules follow-up confirmation call.
    """
    conf = get_confirmation_by_id(confirmation_id)
    lang_key = conf.get("preferred_language", "en") if conf else "en"
    cfg = CONFIRMATION_VOICE_CONFIG.get(lang_key, CONFIRMATION_VOICE_CONFIG["en"])
    voice = cfg["voice"]
    locale = cfg["language"]

    delay_minutes = parse_reschedule_delay(speech_text)
    logger.info(f"[Reschedule Request] ConfId={confirmation_id}, Speech='{speech_text}' -> Delay={delay_minutes} mins")

    # Reschedule confirmation call
    if conf and conf.get("reminder_id"):
        schedule_confirmation_task(
            reminder_id=conf["reminder_id"],
            delay_minutes=delay_minutes,
            force=True
        )

    ack_text = cfg["reschedule_ack"](delay_minutes)
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="{voice}" language="{locale}">{ack_text}</Say>
  <Hangup/>
</Response>"""
