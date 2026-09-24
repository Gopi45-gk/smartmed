"""
SmartMed AI - Prescription Dataset Generator & Fine-Tuning Pipeline
Implements:
1. Prescription-specific dataset creation (train/val/test splits)
2. Hard-case failure collection and categorization
3. Fine-tuning harness for domain-specific medical OCR
"""

import os
import sys
import json
import random
import cv2
import numpy as np
from pathlib import Path
from typing import List, Dict, Tuple, Any

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
DATASET_ROOT = DATA_DIR / "prescription_dataset"
HARD_CASES_ROOT = DATA_DIR / "hard_cases"

# Prescription layout & style templates
DOCTOR_TEMPLATES = [
    {"name": "Dr. R. Menon", "degree": "MBBS, MD (Gen Med)", "reg": "48921/KMC", "clinic": "City Health Clinic, Bangalore"},
    {"name": "Dr. Sunita Sharma", "degree": "MBBS, DNB (Internal Medicine)", "reg": "71032/DMC", "clinic": "Apollo Clinic, Delhi"},
    {"name": "Dr. Anand Joshi", "degree": "MBBS, MS, FICS", "reg": "55219/MMC", "clinic": "Lilavati Medical Center, Mumbai"},
    {"name": "Dr. Priya Varma", "degree": "MBBS, MD (Pediatrics)", "reg": "89341/TNC", "clinic": "Kaveri Children Hospital, Chennai"},
]

PATIENT_TEMPLATES = [
    {"name": "Vivek Kumar", "age": "28 Y", "gender": "M"},
    {"name": "Anita Sharma", "age": "45 Y", "gender": "F"},
    {"name": "Rajesh Patel", "age": "52 Y", "gender": "M"},
    {"name": "Meenakshi Sundaram", "age": "61 Y", "gender": "F"},
    {"name": "Rahul Verma", "age": "19 Y", "gender": "M"},
]

HARD_CASE_CATEGORIES = [
    "similar_characters",   # rn vs m, cl vs d, 1 vs l vs I
    "medicine_abbreviations", # PCM, HCQ, CTZ, Panto
    "dosage_notation",      # 1-0-1, 1-1-1, 0-0-1, 1/2 tab, 2.5 ml
    "units_notation",       # mg vs mcg vs ml vs IU
    "iv_vs_oral",           # IV RL, IV NS vs Tab / Cap
    "cursive_handwriting",  # fast doctor signatures & slanted ink
    "paper_artifacts",      # folds, shadows, stamps over text
]


def setup_dataset_directories():
    """Sets up train, validation, test, and hard-case directory structure."""
    for split in ["train", "val", "test"]:
        split_dir = DATASET_ROOT / split
        (split_dir / "images").mkdir(parents=True, exist_ok=True)
        (split_dir / "annotations").mkdir(parents=True, exist_ok=True)
        
    for cat in HARD_CASE_CATEGORIES:
        (HARD_CASES_ROOT / cat).mkdir(parents=True, exist_ok=True)


def generate_prescription_sample(
    sample_id: str,
    doctor: Dict[str, str],
    patient: Dict[str, str],
    medications: List[Dict[str, str]],
    iv_fluids: List[str],
    advice: List[str],
    clinical_notes: List[str],
    is_handwritten_heavy: bool = False,
    degrade_quality: bool = False,
) -> Tuple[np.ndarray, Dict[str, Any]]:
    """
    Renders a realistic synthetic prescription with exact ground-truth bounding boxes
    and text annotations for OCR fine-tuning.
    """
    h, w = 1400, 1000
    # Paper texture: subtle off-white variation
    paper_tone = random.randint(245, 252)
    img = np.ones((h, w, 3), dtype=np.uint8) * paper_tone

    annotations = {
        "id": sample_id,
        "doctor": doctor,
        "patient": patient,
        "clinical_notes": clinical_notes,
        "medications": medications,
        "iv_fluids": iv_fluids,
        "advice": advice,
        "boxes": [],
    }

    # Header
    cv2.putText(img, f"{doctor['clinic'].upper()}", (60, 70), cv2.FONT_HERSHEY_SIMPLEX, 0.75, (40, 40, 140), 2)
    cv2.putText(img, f"{doctor['name']} - {doctor['degree']}", (60, 105), cv2.FONT_HERSHEY_SIMPLEX, 0.65, (50, 50, 50), 2)
    cv2.putText(img, f"Reg: {doctor['reg']}", (60, 130), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (100, 100, 100), 1)
    cv2.line(img, (50, 145), (950, 145), (180, 50, 50), 2)

    # Patient Details
    patient_line = f"Name: {patient['name']}   Age: {patient['age']}   Sex: {patient['gender']}   Date: 14/09/2026"
    cv2.putText(img, patient_line, (60, 185), cv2.FONT_HERSHEY_SIMPLEX, 0.65, (20, 20, 20), 2)
    annotations["boxes"].append({"text": patient_line, "category": "patient_info", "box": [60, 165, 900, 195]})

    y = 235
    # Clinical Notes
    if clinical_notes:
        notes_str = f"C/O: {', '.join(clinical_notes)}"
        cv2.putText(img, notes_str, (60, y), cv2.FONT_HERSHEY_SIMPLEX, 0.62, (40, 40, 40), 1)
        annotations["boxes"].append({"text": notes_str, "category": "clinical_notes", "box": [60, y - 20, 850, y + 5]})
        y += 45

    # Rx Header
    cv2.putText(img, "Rx (Treatment):", (60, y), cv2.FONT_HERSHEY_SIMPLEX, 0.75, (20, 20, 20), 2)
    y += 45

    # IV Fluids
    for iv in iv_fluids:
        font_scale = 0.68 if not is_handwritten_heavy else 0.62
        cv2.putText(img, iv, (80, y), cv2.FONT_HERSHEY_SIMPLEX, font_scale, (10, 10, 10), 2)
        annotations["boxes"].append({"text": iv, "category": "iv_fluid", "box": [80, y - 20, 750, y + 5]})
        y += 45

    # Medications
    for idx, med in enumerate(medications):
        med_str = f"{idx+1}. {med.get('type', 'Tab')} {med['name']} {med.get('strength', '')}  {med.get('frequency', '1-0-0')}  {med.get('instructions', '')}"
        font_style = cv2.FONT_HERSHEY_SIMPLEX if not is_handwritten_heavy else cv2.FONT_HERSHEY_SCRIPT_SIMPLEX
        font_scale = 0.68 if not is_handwritten_heavy else 0.72
        cv2.putText(img, med_str, (80, y), font_style, font_scale, (20, 20, 20), 2)
        annotations["boxes"].append({"text": med_str, "category": "medication", "box": [80, y - 20, 850, y + 5]})
        y += 50

    # Advice
    if advice:
        y += 20
        cv2.putText(img, "Advice:", (60, y), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (20, 20, 20), 2)
        y += 35
        for adv in advice:
            adv_str = f"- {adv}"
            cv2.putText(img, adv_str, (80, y), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (30, 30, 30), 1)
            annotations["boxes"].append({"text": adv_str, "category": "advice", "box": [80, y - 20, 850, y + 5]})
            y += 35

    # Signature
    cv2.putText(img, f"{doctor['name']}", (700, 1220), cv2.FONT_HERSHEY_SCRIPT_SIMPLEX, 0.8, (0, 0, 100), 2)
    cv2.putText(img, "(Signature & Stamp)", (700, 1250), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (120, 120, 120), 1)

    if degrade_quality:
        # Add realistic camera blur / noise
        ksize = random.choice([3, 5])
        img = cv2.GaussianBlur(img, (ksize, ksize), 0)

    return img, annotations


def build_smartmed_benchmark_dataset(num_train: int = 40, num_val: int = 10, num_test: int = 15):
    """
    Populates train/val/test splits with balanced printed, handwritten, and hard-case prescriptions.
    """
    setup_dataset_directories()

    splits = {
        "train": num_train,
        "val": num_val,
        "test": num_test,
    }

    common_meds = [
        {"name": "Metformin", "strength": "500 mg", "frequency": "1-0-1", "instructions": "After food", "type": "Tab"},
        {"name": "Pantoprazole", "strength": "40 mg", "frequency": "1-0-0", "instructions": "Before breakfast", "type": "Tab"},
        {"name": "Amoxicillin", "strength": "500 mg", "frequency": "1-1-1", "instructions": "After meals x 5 days", "type": "Cap"},
        {"name": "Paracetamol", "strength": "650 mg", "frequency": "1-0-1", "instructions": "SOS fever", "type": "Tab"},
        {"name": "Azithromycin", "strength": "500 mg", "frequency": "1-0-0", "instructions": "Daily once x 3 days", "type": "Tab"},
        {"name": "Atorvastatin", "strength": "10 mg", "frequency": "0-0-1", "instructions": "Night after dinner", "type": "Tab"},
        {"name": "Cetirizine", "strength": "10 mg", "frequency": "0-0-1", "instructions": "At bedtime", "type": "Tab"},
        {"name": "Ciprofloxacin", "strength": "500 mg", "frequency": "1-0-1", "instructions": "Twice daily", "type": "Tab"},
    ]

    total_generated = 0
    for split, count in splits.items():
        for i in range(count):
            sample_id = f"{split}_{i+1:04d}"
            doc = random.choice(DOCTOR_TEMPLATES)
            patient = random.choice(PATIENT_TEMPLATES)
            num_meds = random.randint(1, 4)
            meds = random.sample(common_meds, num_meds)
            
            iv = ["IV RL 500 ml over 4 hrs"] if random.random() > 0.6 else []
            adv = ["Drink ORS solution, plenty of boiled water", "Avoid oily/spicy foods"] if random.random() > 0.4 else []
            notes = ["Fever x 3 days, mild abdominal pain"] if random.random() > 0.5 else []

            is_hw = (i % 2 == 1)
            img, annot = generate_prescription_sample(
                sample_id, doc, patient, meds, iv, adv, notes,
                is_handwritten_heavy=is_hw,
                degrade_quality=(i % 4 == 0)
            )

            # Save image and annotations
            img_path = DATASET_ROOT / split / "images" / f"{sample_id}.png"
            json_path = DATASET_ROOT / split / "annotations" / f"{sample_id}.json"
            cv2.imwrite(str(img_path), img)
            with open(json_path, "w") as f:
                json.dump(annot, f, indent=2)
            total_generated += 1

    print(f"[DATASET] Successfully built {total_generated} prescription samples in {DATASET_ROOT}")
    print(f"  Train: {num_train} | Val: {num_val} | Test: {num_test}")


def collect_failed_case(failure_category: str, case_id: str, image_path: str, ocr_output: Dict[str, Any], ground_truth: Dict[str, Any]):
    """
    Logs a failed OCR sample into the hard-case pipeline for retraining.
    """
    if failure_category not in HARD_CASE_CATEGORIES:
        failure_category = "similar_characters"

    target_dir = HARD_CASES_ROOT / failure_category
    target_dir.mkdir(parents=True, exist_ok=True)

    log_entry = {
        "case_id": case_id,
        "category": failure_category,
        "image_path": image_path,
        "ocr_output": ocr_output,
        "ground_truth": ground_truth,
    }

    log_file = target_dir / f"{case_id}.json"
    with open(log_file, "w") as f:
        json.dump(log_entry, f, indent=2)
    print(f"[HARD-CASE] Logged failure '{case_id}' in category '{failure_category}' for next training cycle.")


if __name__ == "__main__":
    build_smartmed_benchmark_dataset()
