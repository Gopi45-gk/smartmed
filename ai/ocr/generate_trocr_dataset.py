"""
SmartMed AI - TrOCR Medical Prescription Dataset Generator
Generates realistic handwritten line crops of doctor prescriptions, Indian pharmaceuticals,
dosages, and clinical shorthand for GPU fine-tuning of TrOCR.
"""

import os
import random
import csv
import numpy as np
import cv2
from PIL import Image, ImageDraw, ImageFont
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "data" / "trocr_dataset"
TRAIN_DIR = DATA_DIR / "train"
VAL_DIR = DATA_DIR / "val"

# System font paths to use for handwriting & doctor style variations
FONT_CANDIDATES = [
    "/usr/share/fonts/truetype/ubuntu/Ubuntu-RI.ttf",
    "/usr/share/fonts/truetype/ubuntu/Ubuntu-BI.ttf",
    "/usr/share/fonts/truetype/ubuntu/Ubuntu-Italic.ttf",
    "/usr/share/fonts/truetype/ubuntu/UbuntuSans-Italic[wdth,wght].ttf",
    "/usr/share/fonts/truetype/gentium-basic/GenBasI.ttf",
    "/usr/share/fonts/truetype/gentium-basic/GenBkBasI.ttf",
    "/usr/share/fonts/truetype/ubuntu/Ubuntu-R.ttf",
    "/usr/share/fonts/truetype/ubuntu/Ubuntu-M.ttf",
]

# Vocabulary & clinical lines
MEDICINES = [
    "5% Dextrose", "Dextrose 5%", "ORS", "Metformin 500mg", "Pantoprazole 40mg",
    "Paracetamol 650mg", "Amoxicillin 500mg", "Azithromycin 500mg", "Cetirizine 10mg",
    "Ciprofloxacin 500mg", "Atorvastatin 10mg", "Telmisartan 40mg", "Amlodipine 5mg",
    "Clopidogrel 75mg", "Omeprazole 20mg", "Ranitidine 150mg", "Ibuprofen 400mg",
    "Diclofenac 50mg", "IV RL 500ml", "IV NS 500ml", "Ondansetron 4mg", "Tramadol 50mg",
    "Tab Metformin", "Tab Pantoprazole", "Tab Paracetamol", "Cap Amoxicillin", "Tab PCM 650"
]

INSTRUCTIONS = [
    "stat.", "1-0-1", "1-0-0", "0-0-1", "1-1-1", "BD", "TDS", "OD", "HS", "SOS",
    "after food", "before breakfast", "at bedtime", "x 5 days", "x 7 days", "x 3 days",
    "(iv) stat.", "IV stat.", "2 sachets", "1 tablet", "1 capsule", "5 ml TDS"
]

CLINICAL_LINES = [
    "Adv: 5% Dextrose (iv) stat.",
    "Adv: 10 5% Dextrose (iv) stat.",
    "ORS 2 sachets.",
    "Adequate fluid intake",
    "Drink ORS in 1 liter boiled water",
    "Plenty of oral fluids",
    "Light bland diet",
    "Review SOS / after 3 days",
    "Name: Vivek S. 19/M",
    "UHID: 10193",
    "BP - 110/70 mmHg",
    "PR - 60 bpm",
    "CRBS - 108 mg/dl",
    "Giddiness, Weakness",
    "Acute Gastroenteritis",
    "1. Tab Metformin 500mg 1-0-1 after food",
    "2. Tab Pantoprazole 40mg 1-0-0 before food",
    "3. Tab Paracetamol 650mg SOS fever",
    "4. Cap Amoxicillin 500mg 1-1-1 x 5 days",
    "5. Tab Cetirizine 10mg 0-0-1 night",
    "IV RL 500 ml stat over 4 hours",
    "Inj Ondansetron 4mg IV stat",
    "Inj Pantocid 40mg IV stat",
]


def get_available_fonts():
    available = []
    for fp in FONT_CANDIDATES:
        if os.path.exists(fp):
            available.append(fp)
    if not available:
        # Fallback to default
        available = [None]
    return available


def generate_text_line():
    """Selects or composes a realistic prescription text line."""
    mode = random.random()
    if mode < 0.40:
        return random.choice(CLINICAL_LINES)
    elif mode < 0.70:
        med = random.choice(MEDICINES)
        instr = random.choice(INSTRUCTIONS)
        return f"{med} {instr}"
    else:
        med = random.choice(MEDICINES)
        dose = random.choice(["1 tab", "1 cap", "2 tabs", "500 ml", "2 sachets", "10 units"])
        freq = random.choice(["1-0-1", "OD", "BD", "TDS", "stat."])
        return f"{med} {dose} {freq}"


def render_line_image(text: str, font_paths: list, target_height: int = 64) -> np.ndarray:
    """Renders a text line onto an image with handwriting augmentations."""
    font_path = random.choice(font_paths)
    font_size = random.randint(28, 36)

    try:
        if font_path:
            font = ImageFont.truetype(font_path, font_size)
        else:
            font = ImageFont.load_default()
    except Exception:
        font = ImageFont.load_default()

    # Determine text size
    dummy_img = Image.new("RGB", (1, 1))
    draw = ImageDraw.Draw(dummy_img)
    bbox = draw.textbbox((0, 0), text, font=font)
    text_w = max(10, bbox[2] - bbox[0])
    text_h = max(10, bbox[3] - bbox[1])

    # Canvas dimensions with padding
    pad_x = random.randint(15, 30)
    pad_y = random.randint(10, 16)
    canvas_w = text_w + 2 * pad_x
    canvas_h = text_h + 2 * pad_y

    # Paper color: off-white variation (242-255)
    bg_color = (
        random.randint(240, 255),
        random.randint(240, 252),
        random.randint(235, 248),
    )

    # Ink color: dark blue, blue-black, black, or dark pen
    ink_choices = [
        (random.randint(10, 30), random.randint(10, 30), random.randint(30, 70)),   # dark blue
        (random.randint(15, 35), random.randint(15, 35), random.randint(15, 35)),   # black
        (random.randint(20, 45), random.randint(35, 60), random.randint(85, 120)),  # blue ballpoint
    ]
    ink_color = random.choice(ink_choices)

    img = Image.new("RGB", (canvas_w, canvas_h), color=bg_color)
    draw = ImageDraw.Draw(img)
    draw.text((pad_x, pad_y), text, fill=ink_color, font=font)

    # Convert to OpenCV for augmentations
    np_img = np.array(img)

    # 1. Random shear / slant simulating cursive handwriting
    shear_val = random.uniform(-0.18, 0.18)
    M_shear = np.float32([[1, shear_val, 0], [0, 1, 0]])
    np_img = cv2.warpAffine(np_img, M_shear, (canvas_w, canvas_h), borderValue=bg_color)

    # 2. Random slight rotation (-2 to +2 degrees)
    angle = random.uniform(-2.5, 2.5)
    center = (canvas_w // 2, canvas_h // 2)
    M_rot = cv2.getRotationMatrix2D(center, angle, 1.0)
    np_img = cv2.warpAffine(np_img, M_rot, (canvas_w, canvas_h), borderValue=bg_color)

    # 3. Add paper grain / noise
    noise = np.random.normal(0, random.uniform(1.0, 3.5), np_img.shape).astype(np.float32)
    noisy_img = np.clip(np_img.astype(np.float32) + noise, 0, 255).astype(np.uint8)

    # 4. Subtle blur
    if random.random() < 0.4:
        noisy_img = cv2.GaussianBlur(noisy_img, (3, 3), 0.5)

    # Resize to fixed height maintaining aspect ratio (TrOCR standard is 384x384 or normalized lines)
    h, w = noisy_img.shape[:2]
    aspect = w / h
    new_w = int(target_height * aspect)
    resized = cv2.resize(noisy_img, (new_w, target_height), interpolation=cv2.INTER_AREA)

    return resized


def build_dataset(num_train: int = 500, num_val: int = 80):
    """Builds the full paired TrOCR training and validation dataset."""
    TRAIN_DIR.mkdir(parents=True, exist_ok=True)
    VAL_DIR.mkdir(parents=True, exist_ok=True)

    fonts = get_available_fonts()
    print(f"Using {len(fonts)} available fonts for prescription rendering.")

    for split, count, out_dir in [("train", num_train, TRAIN_DIR), ("val", num_val, VAL_DIR)]:
        labels = []
        csv_path = out_dir / "metadata.csv"
        
        for idx in range(count):
            sample_id = f"{split}_{idx:04d}"
            text = generate_text_line()
            img = render_line_image(text, fonts)

            img_filename = f"{sample_id}.png"
            img_path = out_dir / img_filename
            cv2.imwrite(str(img_path), img)

            labels.append({"file_name": img_filename, "text": text})

        with open(csv_path, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=["file_name", "text"])
            writer.writeheader()
            writer.writerows(labels)

        print(f"Generated {count} samples in {out_dir}")

    print("Dataset generation complete!")


if __name__ == "__main__":
    build_dataset()
