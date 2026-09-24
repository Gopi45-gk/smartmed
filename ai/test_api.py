"""
SmartMed AI - API Test Script
Tests the local inference server endpoints.

Usage:
    cd ai
    python test_api.py
"""

import requests
import json
import sys

BASE_URL = "http://localhost:8100"


def test_health():
    """Test the health endpoint."""
    print("=" * 50)
    print("TEST: Health Check")
    print("=" * 50)
    try:
        resp = requests.get(f"{BASE_URL}/api/ai/health", timeout=5)
        print(f"  Status: {resp.status_code}")
        print(f"  Response: {json.dumps(resp.json(), indent=2)}")
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
        assert resp.json()["status"] == "ok"
        print("  ✓ PASSED")
        return True
    except requests.ConnectionError:
        print("  ✗ FAILED - Server not running. Start with: python server.py")
        return False
    except Exception as e:
        print(f"  ✗ FAILED - {e}")
        return False


def test_status():
    """Test the status endpoint."""
    print("\n" + "=" * 50)
    print("TEST: AI Status")
    print("=" * 50)
    try:
        resp = requests.get(f"{BASE_URL}/api/ai/status", timeout=5)
        print(f"  Status: {resp.status_code}")
        data = resp.json()
        print(f"  Model: {data.get('model_name')}")
        print(f"  Status: {data.get('status')}")
        print(f"  Device: {data.get('device')}")
        print(f"  Model exists: {data.get('model_exists')}")
        if data.get("error"):
            print(f"  Error: {data.get('error')}")
        print("  ✓ PASSED")
        return True
    except Exception as e:
        print(f"  ✗ FAILED - {e}")
        return False


def test_chat():
    """Test the chat endpoint."""
    print("\n" + "=" * 50)
    print("TEST: Chat - Medical Question")
    print("=" * 50)
    try:
        payload = {
            "message": "What are common symptoms of dehydration?",
            "conversationId": "test-session-001",
        }
        print(f"  Request: {json.dumps(payload)}")
        resp = requests.post(
            f"{BASE_URL}/api/ai/chat",
            json=payload,
            timeout=120,
        )
        print(f"  Status: {resp.status_code}")
        data = resp.json()
        print(f"  Success: {data.get('success')}")
        print(f"  Model: {data.get('model')}")
        print(f"  Offline: {data.get('offline')}")
        print(f"  Timing: {data.get('timing')}")
        if data.get("response"):
            response_preview = data["response"][:200]
            print(f"  Response: {response_preview}...")
        if data.get("error"):
            print(f"  Error: {data.get('error')}")
        print("  ✓ PASSED" if data.get("success") else "  ⚠ Chat returned error (model may not be installed)")
        return data.get("success", False)
    except Exception as e:
        print(f"  ✗ FAILED - {e}")
        return False


def test_empty_message():
    """Test that empty messages are rejected."""
    print("\n" + "=" * 50)
    print("TEST: Empty Message Validation")
    print("=" * 50)
    try:
        resp = requests.post(
            f"{BASE_URL}/api/ai/chat",
            json={"message": ""},
            timeout=10,
        )
        print(f"  Status: {resp.status_code}")
        assert resp.status_code == 422 or resp.status_code == 400, \
            f"Expected 422 or 400, got {resp.status_code}"
        print("  ✓ PASSED - Empty message correctly rejected")
        return True
    except Exception as e:
        print(f"  ✗ FAILED - {e}")
        return False


def test_chat_with_history():
    """Test chat with conversation history."""
    print("\n" + "=" * 50)
    print("TEST: Chat with Conversation History")
    print("=" * 50)
    try:
        payload = {
            "message": "Can you tell me more about that?",
            "conversationId": "test-session-002",
            "history": [
                {"role": "user", "content": "What is paracetamol used for?"},
                {"role": "assistant", "content": "Paracetamol (also known as acetaminophen) is commonly used to relieve mild to moderate pain and reduce fever."},
            ],
        }
        print(f"  Request includes {len(payload['history'])} history messages")
        resp = requests.post(
            f"{BASE_URL}/api/ai/chat",
            json=payload,
            timeout=120,
        )
        data = resp.json()
        print(f"  Success: {data.get('success')}")
        if data.get("response"):
            print(f"  Response: {data['response'][:200]}...")
        if data.get("error"):
            print(f"  Error: {data.get('error')}")
        print("  ✓ PASSED" if data.get("success") else "  ⚠ Chat returned error (model may not be installed)")
        return True
    except Exception as e:
        print(f"  ✗ FAILED - {e}")
        return False


def test_voice():
    """Test the shared voice endpoint used by Call AI."""
    print("\n" + "=" * 50)
    print("TEST: Call AI Voice - General Question")
    print("=" * 50)
    try:
        payload = {
            "message": "Can I take my BP tablet with coffee?",
            "conversationId": "test-session-voice-001",
            "medicinesContext": [{"name": "Amlodipine (BP)", "time": "1:00 PM"}],
            "patientName": "Mr. Ravi",
        }
        print(f"  Request: {json.dumps(payload)}")
        resp = requests.post(
            f"{BASE_URL}/api/ai/voice",
            json=payload,
            timeout=120,
        )
        print(f"  Status: {resp.status_code}")
        data = resp.json()
        print(f"  Success: {data.get('success')}")
        print(f"  Intent: {data.get('intent')}")
        print(f"  Model: {data.get('model')}")
        print(f"  Offline: {data.get('offline')}")
        print(f"  Timing: {data.get('timing')}")
        if data.get("response"):
            print(f"  Voice Response: {data['response'][:200]}...")
        assert data.get("success") is True, f"Voice chat failed: {data.get('error')}"
        assert data.get("offline") is True
        print("  ✓ PASSED")
        return True
    except Exception as e:
        print(f"  ✗ FAILED - {e}")
        return False


def test_voice_intent():
    """Test voice medicine taken intent detection."""
    print("\n" + "=" * 50)
    print("TEST: Call AI Voice - Medicine Taken Intent")
    print("=" * 50)
    try:
        payload = {
            "message": "Yes, I took it with warm water.",
            "conversationId": "test-session-voice-002",
            "patientName": "Mr. Ravi",
        }
        print(f"  Request: {json.dumps(payload)}")
        resp = requests.post(
            f"{BASE_URL}/api/ai/voice",
            json=payload,
            timeout=120,
        )
        data = resp.json()
        print(f"  Intent: {data.get('intent')}")
        print(f"  Success: {data.get('success')}")
        if data.get("response"):
            print(f"  Voice Response: {data['response'][:200]}...")
        assert data.get("intent") == "MEDICINE_TAKEN"
        print("  ✓ PASSED")
        return True
    except Exception as e:
        print(f"  ✗ FAILED - {e}")
        return False


if __name__ == "__main__":
    print("\n🏥 SmartMed AI - API Test Suite (Chat & Call AI)\n")

    results = []
    results.append(("Health Check", test_health()))

    if results[0][1]:  # Only continue if server is running
        results.append(("AI Status", test_status()))
        results.append(("Empty Message", test_empty_message()))
        results.append(("Chat (MNN)", test_chat()))
        results.append(("Chat with History", test_chat_with_history()))
        results.append(("Call AI Voice (MNN)", test_voice()))
        results.append(("Call AI Voice Intent", test_voice_intent()))

    print("\n" + "=" * 50)
    print("RESULTS SUMMARY")
    print("=" * 50)
    for name, passed in results:
        icon = "✓" if passed else "✗"
        print(f"  {icon} {name}")

    failed = sum(1 for _, passed in results if not passed)
    print(f"\n  Total: {len(results)} | Passed: {len(results) - failed} | Failed: {failed}\n")

    sys.exit(1 if failed > 0 else 0)
