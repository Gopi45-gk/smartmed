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


def generate_twiml(medicine: str, dosage: str, patient_name: Optional[str] = None) -> str:
    """
    Generate TwiML XML string with Polly.Aditi voice for clear, natural speech.
    """
    greeting = f"Hello {patient_name}," if patient_name else "Hello,"
    spoken_text = (
        f"{greeting} this is your SmartMed automated care assistant. "
        f"It is time to take your scheduled medicine: {medicine}, dosage: {dosage}. "
        f"Please take it with a glass of water as directed by your doctor. Thank you and stay healthy!"
    )
    
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Aditi" language="en-IN">{spoken_text}</Say>
  <Pause length="1"/>
  <Say voice="Polly.Aditi" language="en-IN">Repeating: {dosage} of {medicine}. Take care!</Say>
</Response>"""


def make_twilio_call(phone: str, medicine: str, dosage: str, patient_name: Optional[str] = None) -> Dict[str, Any]:
    """
    Executes client.calls.create(...) using Twilio Voice API and inline TwiML.
    """
    client = get_twilio_client()
    formatted_phone = format_e164_phone(phone)
    twiml_xml = generate_twiml(medicine, dosage, patient_name)

    logger.info(f"Initiating Twilio Call -> To: {formatted_phone}, From: {TWILIO_PHONE_NUMBER}, Med: {medicine} ({dosage})")

    if client is None:
        logger.warning(f"[Mock Mode] Twilio client not available. Call to {formatted_phone} simulated.")
        return {
            "success": True,
            "mock": True,
            "to": formatted_phone,
            "from": TWILIO_PHONE_NUMBER,
            "medicine": medicine,
            "dosage": dosage,
            "status": "simulated"
        }

    try:
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
            "dosage": dosage
        }
    except Exception as e:
        logger.error(f"Twilio call failed for {formatted_phone}: {e}")
        return {
            "success": False,
            "error": str(e),
            "to": formatted_phone,
            "from": TWILIO_PHONE_NUMBER,
            "medicine": medicine,
            "dosage": dosage
        }


def schedule_call_job(
    phone: str,
    medicine: str,
    dosage: str,
    trigger_time_str: Optional[str] = None,
    patient_name: Optional[str] = None
) -> Dict[str, Any]:
    """
    Parses trigger_time and adds a job to APScheduler:
    scheduler.add_job(make_twilio_call, 'date', run_date=trigger_time, args=[...])
    """
    scheduler = get_scheduler()
    formatted_phone = format_e164_phone(phone)

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
        res = make_twilio_call(formatted_phone, medicine, dosage, patient_name)
        return {
            "success": res.get("success", False),
            "job_id": "direct-execution",
            "scheduled_time": run_date.isoformat(),
            "phone_number": formatted_phone,
            "medicine": medicine,
            "dosage": dosage,
            "result": res
        }

    job_id = f"twilio_call_{int(datetime.now().timestamp() * 1000)}"
    job = scheduler.add_job(
        make_twilio_call,
        'date',
        run_date=run_date,
        args=[formatted_phone, medicine, dosage, patient_name],
        id=job_id,
        replace_existing=True
    )

    logger.info(f"✓ APScheduler Job added [{job.id}] for {formatted_phone} at {run_date.isoformat()}")

    return {
        "success": True,
        "job_id": job.id,
        "scheduled_time": run_date.isoformat(),
        "phone_number": formatted_phone,
        "medicine": medicine,
        "dosage": dosage,
        "patient_name": patient_name
    }
