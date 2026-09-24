"""
Live End-to-End Test for SmartMed Prescription OCR API
Tests against http://localhost:8100/api/ocr/prescription using a synthesized realistic prescription image.
"""

import sys
import os
import cv2
import numpy as np
import requests
import json

def generate_test_prescription_image(filename="test_prescription_vivek.png"):
    # Create white canvas 1000 x 1400 (standard prescription aspect ratio)
    h, w = 1400, 1000
    img = np.ones((h, w, 3), dtype=np.uint8) * 255
    
    # Draw header line
    cv2.line(img, (50, 140), (950, 140), (200, 50, 50), 2)
    
    # Text lines
    lines = [
        (50, 80, "CITY HEALTH CLINIC - DR. R. MENON MBBS MD", 0.9, (50, 50, 150), 2),
        (50, 120, "Reg No: 48921/KMC | Ph: +91-9876543210", 0.6, (100, 100, 100), 1),
        (50, 180, "Name: Vivek     Age: 28 Yrs     Sex: Male     Date: 14/09/2026", 0.7, (20, 20, 20), 2),
        (50, 240, "C/O: High fever x 3 days, vomiting, loose stools", 0.7, (30, 30, 30), 2),
        (50, 290, "Vitals: BP 110/70 mmHg, Pulse 88/min, Temp 100 F", 0.65, (30, 30, 30), 1),
        (50, 340, "Diagnosis: Acute Gastroenteritis with mild dehydration", 0.7, (30, 30, 30), 2),
        (50, 410, "Rx / Treatment:", 0.75, (20, 20, 20), 2),
        (80, 470, "1. IV RL 500 ml stat over 4 hours", 0.75, (10, 10, 10), 2),
        (80, 540, "2. Tab Metformin 500 mg 1-0-1 after food x 5 days", 0.75, (10, 10, 10), 2),
        (80, 610, "3. Tab Pantoprazole 40 mg 1-0-0 before breakfast x 7 days", 0.75, (10, 10, 10), 2),
        (50, 720, "Advice:", 0.75, (20, 20, 20), 2),
        (80, 770, "- Drink ORS in 1 liter boiled water, drink plenty of fluids", 0.68, (20, 20, 20), 1),
        (80, 820, "- Light bland diet (khichdi, curd rice)", 0.68, (20, 20, 20), 1),
        (50, 920, "Review SOS / after 3 days", 0.65, (50, 50, 50), 1),
        (700, 1100, "Dr. R. Menon", 0.75, (0, 0, 120), 2),
        (700, 1130, "(Signature & Stamp)", 0.55, (100, 100, 100), 1)
    ]
    
    for x, y, text, scale, color, thickness in lines:
        cv2.putText(img, text, (x, y), cv2.FONT_HERSHEY_SIMPLEX, scale, color, thickness, cv2.LINE_AA)
        
    out_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), filename)
    cv2.imwrite(out_path, img)
    return out_path

def test_api():
    img_path = generate_test_prescription_image()
    print(f"[TEST] Generated realistic synthetic prescription at: {img_path}")
    
    url = "http://localhost:8100/api/ocr/prescription"
    print(f"[TEST] Sending POST request with image to {url}...")
    
    with open(img_path, "rb") as f:
        files = {"file": ("prescription.png", f, "image/png")}
        resp = requests.post(url, files=files, timeout=30)
        
    print(f"[TEST] Response Status Code: {resp.status_code}")
    if resp.status_code != 200:
        print(f"[FAIL] Error response: {resp.text}")
        sys.exit(1)
        
    data = resp.json()
    print("\n" + "="*50)
    print("PRESCRIPTION OCR RESULT SUMMARY:")
    print("="*50)
    print(f"Success: {data.get('success')}")
    print(f"Overall Confidence: {data.get('confidence')}")
    print(f"Requires Review: {data.get('requires_review')}")
    
    # 1. Check Patient Info
    patient = data.get("patient", {})
    print(f"\n[PATIENT INFO]: {patient}")
    assert patient and "Vivek" in str(patient.get("name")), f"Expected Vivek in patient name, got: {patient}"
    print("  PASS: Patient name correctly isolated as 'Vivek'")
    
    # 2. Check Medicines
    medications = data.get("medicines", [])
    print(f"\n[MEDICINES DETECTED ({len(medications)})]:")
    for idx, med in enumerate(medications):
        print(f"  {idx+1}. Name: {med.get('name')} | Strength: {med.get('strength')} | Dosage: {med.get('dosage')} | Freq: {med.get('frequency')} | Conf: {med.get('confidence')} | Review: {med.get('requires_review')}")
    
    # Check that Vivek is NEVER a medicine
    for med in medications:
        assert "vivek" not in med.get("name", "").lower(), f"CRITICAL FAIL: 'Vivek' was detected as a medicine! {med}"
        assert "name" not in med.get("name", "").lower(), f"CRITICAL FAIL: 'Name' was detected as a medicine! {med}"
    print("  PASS: 'Vivek' and 'Name' NEVER appear in medicine list")
    
    # Check that medicines count is NOT 9
    assert len(medications) != 9, f"CRITICAL FAIL: Claimed 9 medicines detected!"
    assert len(medications) in [2, 3], f"Expected 2 or 3 valid medications, got {len(medications)}"
    print(f"  PASS: Dynamic count correctly identified {len(medications)} medicines (NOT 9)")
    
    # 3. Check IV Fluids isolation
    iv_fluids = data.get("iv_fluids", [])
    print(f"\n[IV FLUIDS]: {iv_fluids}")
    assert any("iv rl" in str(iv).lower() for iv in iv_fluids), f"Expected IV RL in iv_fluids, got: {iv_fluids}"
    print("  PASS: IV RL correctly isolated in iv_fluids section")
    
    # 4. Check Advice / ORS isolation
    advice = data.get("advice", [])
    print(f"\n[ADVICE]: {advice}")
    assert any("ors" in str(adv).lower() for adv in advice), f"Expected ORS in advice, got: {advice}"
    print("  PASS: ORS advice correctly isolated in advice section")
    
    # 5. Check Clinical Notes
    notes = data.get("clinical_notes", [])
    print(f"\n[CLINICAL NOTES]: {notes}")
    
    print("\n" + "="*50)
    print("ALL VERIFICATIONS PASSED PERFECTLY!")
    print("="*50)

if __name__ == "__main__":
    test_api()
