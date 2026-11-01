"""
Unit and Integration Tests for SOS Emergency System & Interactive Voice Companion
"""

import pytest
from fastapi.testclient import TestClient

from server import app
from modules.emergency.caregiver_alert import generate_multilingual_alert_text
from modules.voice_assistant.medical_safety import medical_safety
from modules.voice_assistant.language_handler import normalize_language_code, get_greeting_text

client = TestClient(app)


# ═════════════════════════════════════════════════════════════════════════════
# 1. SOS EMERGENCY SYSTEM TESTS
# ═════════════════════════════════════════════════════════════════════════════

def test_sos_status_idle():
    """Verify initial or resolved status is returned cleanly."""
    res = client.get("/api/emergency/sos/status")
    assert res.status_code == 200
    data = res.json()
    assert "active" in data
    assert "emergency" in data


def test_sos_full_lifecycle():
    """Test full SOS workflow: activate -> status -> dialogue -> acknowledge -> resolve."""
    # 1. Activate
    payload = {
        "patient_name": "Test Senior Citizen",
        "phone_number": "+91 98888 77777",
        "language": "en",
        "caregiver": {
            "name": "Dr. Ramesh",
            "phone": "+91 98400 12345",
            "relation": "Doctor",
        },
        "location": {
            "latitude": 12.9716,
            "longitude": 77.5946,
        },
        "vital_info": {
            "bloodGroup": "B+",
            "condition": "Hypertension",
        },
    }
    act_res = client.post("/api/emergency/sos/activate", json=payload)
    assert act_res.status_code == 200
    act_data = act_res.json()
    assert act_data["success"] is True
    assert "emergency_id" in act_data
    assert act_data["status"] in ("SOS ACTIVATED", "CALLING CAREGIVER", "ALERT_SENT")
    emergency_id = act_data["emergency_id"]

    # 2. Status verification
    status_res = client.get(f"/api/emergency/sos/status?emergency_id={emergency_id}")
    assert status_res.status_code == 200
    status_data = status_res.json()
    assert status_data["active"] is True
    assert status_data["emergency"]["id"] == emergency_id

    # 3. Interactive Dialogue turn with Critical Symptom (Chest Pain)
    diag_res = client.post(
        "/api/emergency/sos/dialogue",
        json={
            "emergency_id": emergency_id,
            "patient_message": "I feel sudden chest pain and pressure",
            "language": "en",
        },
    )
    assert diag_res.status_code == 200
    diag_data = diag_res.json()
    assert diag_data["success"] is True
    assert diag_data["is_critical"] is True
    assert "chest pain" in diag_data["ai_response_text"].lower()

    # 3b. Interactive Dialogue turn with Dizziness
    diag2_res = client.post(
        "/api/emergency/sos/dialogue",
        json={
            "emergency_id": emergency_id,
            "patient_message": "I am feeling dizzy",
            "language": "en",
        },
    )
    assert diag2_res.status_code == 200
    diag2_data = diag2_res.json()
    assert "112" in diag2_data["ai_response_text"]
    assert "seated or lie down" in diag2_data["ai_response_text"].lower()

    # 4. Caregiver acknowledgment
    ack_res = client.post(
        "/api/emergency/sos/acknowledge",
        json={
            "emergency_id": emergency_id,
            "caregiver_id": "Dr. Ramesh",
            "note": "Reaching in 10 minutes",
        },
    )
    assert ack_res.status_code == 200
    assert ack_res.json()["status"] in ("CAREGIVER ACKNOWLEDGED", "ASSISTANCE_ACKNOWLEDGED")

    # 5. Resolve
    res_res = client.post(
        "/api/emergency/sos/resolve",
        json={
            "emergency_id": emergency_id,
            "notes": "Patient attended by doctor",
        },
    )
    assert res_res.status_code == 200
    assert res_res.json()["status"] in ("EMERGENCY RESOLVED", "RESOLVED")


def test_sos_cancellation():
    """Test SOS activation followed by accidental trigger cancellation."""
    act_res = client.post(
        "/api/emergency/sos/activate",
        json={
            "patient_name": "Accidental Test",
            "phone_number": "+91 90000 00000",
            "language": "ta",
        },
    )
    assert act_res.status_code == 200
    eid = act_res.json()["emergency_id"]

    cancel_res = client.post(
        "/api/emergency/sos/cancel",
        json={
            "emergency_id": eid,
            "reason": "False alarm button press",
        },
    )
    assert cancel_res.status_code == 200
    assert cancel_res.json()["emergency"]["status"] == "CANCELLED"


# ═════════════════════════════════════════════════════════════════════════════
# 2. MULTILINGUAL CAREGIVER ALERT TESTS
# ═════════════════════════════════════════════════════════════════════════════

@pytest.mark.parametrize("lang,expected_keyword", [
    ("en", "EMERGENCY ALERT"),
    ("ta", "அவசர எச்சரிக்கை"),
    ("hi", "आपातकालीन चेतावनी"),
    ("te", "అత్యవసర హెచ్చరిక"),
    ("bn", "জরুরি সতর্কতা"),
    ("mr", "आणीबाणी सूचना"),
    ("ur", "ہنگامی الرٹ"),
    ("kn", "ತುರ್ತು ಎಚ್ಚರಿಕೆ"),
])
def test_multilingual_alert_generation(lang, expected_keyword):
    """Test caregiver message templates across all supported languages."""
    msg = generate_multilingual_alert_text(
        patient_name="Ravi Kumar",
        phone_number="+91 98765 43210",
        language=lang,
        location={"latitude": 13.08, "longitude": 80.27},
        vital_info={"bloodGroup": "O+", "condition": "Diabetes"},
    )
    assert expected_keyword in msg
    assert "Ravi Kumar" in msg
    assert "+91 98765 43210" in msg


# ═════════════════════════════════════════════════════════════════════════════
# 3. INTERACTIVE VOICE COMPANION TESTS
# ═════════════════════════════════════════════════════════════════════════════

def test_voice_session_start_en():
    """Verify voice session starts with localized greeting and Kokoro speech."""
    res = client.post(
        "/api/voice/session/start",
        json={"patient_id": "test-user-1", "language": "en"},
    )
    assert res.status_code == 200
    data = res.json()
    assert data["success"] is True
    assert "session_id" in data
    assert "greeting_text" in data
    assert "audio_base64" in data
    assert data["language"] == "en"


def test_voice_session_start_ta():
    """Verify voice session starts in Tamil with localized greeting."""
    res = client.post(
        "/api/voice/session/start",
        json={"patient_id": "test-user-ta", "language": "ta"},
    )
    assert res.status_code == 200
    data = res.json()
    assert data["success"] is True
    assert "வணக்கம்" in data["greeting_text"]
    assert data["language"] == "ta"


def test_voice_message_medication_query():
    """Verify voice companion answers medication inquiry with prescription schedule."""
    # Start session
    s_res = client.post("/api/voice/session/start", json={"patient_id": "p-med", "language": "en"})
    sid = s_res.json()["session_id"]

    # Send medicine query
    m_res = client.post(
        "/api/voice/session/message",
        json={
            "session_id": sid,
            "user_text": "What medicine should I take?",
            "language": "en",
            "medicines": [
                {
                    "name": "Metformin 500mg",
                    "time": "9:00 PM",
                    "dose": "1 Tablet",
                    "food": "With Dinner",
                }
            ],
        },
    )
    assert m_res.status_code == 200
    m_data = m_res.json()
    assert m_data["success"] is True
    assert "Metformin 500mg" in m_data["response_text"]
    assert "9:00 PM" in m_data["response_text"]
    assert m_data["is_emergency"] is False


def test_voice_message_emergency_symptom_triage():
    """Verify voice companion identifies emergency symptoms and recommends 112 / SOS."""
    s_res = client.post("/api/voice/session/start", json={"patient_id": "p-emer", "language": "en"})
    sid = s_res.json()["session_id"]

    m_res = client.post(
        "/api/voice/session/message",
        json={
            "session_id": sid,
            "user_text": "SmartMed, I need emergency help! I have severe chest pain and arm numbness",
            "language": "en",
        },
    )
    assert m_res.status_code == 200
    m_data = m_res.json()
    assert m_data["success"] is True
    assert m_data["is_emergency"] is True
    assert m_data["suggest_sos"] is True
    assert m_data["emergency_number"] == "112"


def test_voice_speak_direct():
    """Test direct speech synthesis endpoint."""
    res = client.post(
        "/api/voice/session/speak",
        json={"text": "SmartMed is speaking.", "language": "en", "speed": 1.0},
    )
    assert res.status_code == 200
    data = res.json()
    assert data["success"] is True
    assert data["audio_base64"] is not None


def test_voice_session_end():
    """Test ending an active voice session."""
    s_res = client.post("/api/voice/session/start", json={"patient_id": "p-end", "language": "en"})
    sid = s_res.json()["session_id"]

    e_res = client.post("/api/voice/session/end", json={"session_id": sid})
    assert e_res.status_code == 200
    assert e_res.json()["success"] is True


# ═════════════════════════════════════════════════════════════════════════════
# 4. MEDICAL SAFETY VALIDATOR TESTS
# ═════════════════════════════════════════════════════════════════════════════

def test_safety_validator_emergency():
    is_em, adv = medical_safety.check_emergency_symptoms("I think I am having a stroke, half my face is drooping", "en")
    assert is_em is True
    assert adv is not None
    assert "112" in adv


def test_safety_validator_sanitize():
    unsafe_text = "You should stop taking Telmisartan immediately."
    safe_text = medical_safety.sanitize_medical_response(unsafe_text, "en")
    assert "prescribing doctor" in safe_text.lower()
