"""
SmartMed AI - TrOCR GPU Fine-Tuning Pipeline
Fine-tunes microsoft/trocr-small-handwritten on NVIDIA GeForce RTX 3050 Laptop GPU
using PyTorch Mixed Precision (FP16) for high-accuracy prescription transcription.
"""

import os
import sys
import argparse
import json
import time
import pandas as pd
from pathlib import Path
from PIL import Image
import torch
from torch.utils.data import Dataset, DataLoader
from transformers import (
    TrOCRProcessor,
    VisionEncoderDecoderModel,
    AutoImageProcessor,
    XLMRobertaTokenizer,
)

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data" / "trocr_dataset"
OUTPUT_DIR = BASE_DIR / "ocr" / "models" / "fine_tuned_trocr"


class PrescriptionLineDataset(Dataset):
    """PyTorch Dataset for paired line images and transcription targets."""

    def __init__(self, metadata_csv: Path, img_dir: Path, processor, max_target_length: int = 64):
        self.df = pd.read_csv(metadata_csv)
        self.img_dir = img_dir
        self.processor = processor
        self.max_target_length = max_target_length

    def __len__(self):
        return len(self.df)

    def __getitem__(self, idx):
        row = self.df.iloc[idx]
        img_path = self.img_dir / row["file_name"]
        text = str(row["text"])

        image = Image.open(img_path).convert("RGB")
        pixel_values = self.processor(image, return_tensors="pt").pixel_values.squeeze(0)

        labels = self.processor.tokenizer(
            text,
            padding="max_length",
            max_length=self.max_target_length,
            truncation=True,
            return_tensors="pt",
        ).input_ids.squeeze(0)

        # Replace pad tokens with -100 so they are ignored in CrossEntropyLoss
        labels[labels == self.processor.tokenizer.pad_token_id] = -100

        return {"pixel_values": pixel_values, "labels": labels, "text": text}


def load_processor_and_model(model_name: str, hf_token: str, device: torch.device):
    """Loads TrOCR processor and model with compatible XLMRobertaTokenizer."""
    print(f"Loading base model '{model_name}'...")
    tokenizer = XLMRobertaTokenizer.from_pretrained(model_name, token=hf_token)
    image_processor = AutoImageProcessor.from_pretrained(model_name, token=hf_token)
    processor = TrOCRProcessor(image_processor=image_processor, tokenizer=tokenizer)

    model = VisionEncoderDecoderModel.from_pretrained(model_name, token=hf_token)

    # Set special token configs explicitly for transformers 5.x
    model.config.pad_token_id = processor.tokenizer.pad_token_id
    model.config.decoder_start_token_id = processor.tokenizer.cls_token_id or 0
    model.config.eos_token_id = processor.tokenizer.sep_token_id or 2
    model.config.vocab_size = model.decoder.config.vocab_size

    # Set parameters on generation_config for evaluation beam search
    if hasattr(model, "generation_config") and model.generation_config is not None:
        model.generation_config.pad_token_id = processor.tokenizer.pad_token_id
        model.generation_config.decoder_start_token_id = processor.tokenizer.cls_token_id or 0
        model.generation_config.eos_token_id = processor.tokenizer.sep_token_id or 2
        model.generation_config.max_length = 64
        model.generation_config.early_stopping = True
        model.generation_config.no_repeat_ngram_size = 3
        model.generation_config.length_penalty = 2.0
        model.generation_config.num_beams = 4

    model = model.to(device)
    return processor, model


def compute_cer(preds, targets):
    """Calculates Character Error Rate across predictions."""
    total_chars = 0
    total_dist = 0

    def edit_distance(s1, s2):
        try:
            from rapidfuzz.distance import Levenshtein
            return Levenshtein.distance(s1, s2)
        except Exception:
            # Simple Wagner-Fischer DP fallback
            m, n = len(s1), len(s2)
            dp = [[0] * (n + 1) for _ in range(m + 1)]
            for i in range(m + 1):
                dp[i][0] = i
            for j in range(n + 1):
                dp[0][j] = j
            for i in range(1, m + 1):
                for j in range(1, n + 1):
                    cost = 0 if s1[i - 1] == s2[j - 1] else 1
                    dp[i][j] = min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost)
            return dp[m][n]

    for p, t in zip(preds, targets):
        p_clean = p.lower().strip()
        t_clean = t.lower().strip()
        total_dist += edit_distance(p_clean, t_clean)
        total_chars += max(1, len(t_clean))

    return total_dist / total_chars if total_chars > 0 else 0.0


def train(
    epochs: int = 3,
    batch_size: int = 4,
    learning_rate: float = 4e-5,
    model_name: str = "microsoft/trocr-small-handwritten",
    hf_token: str | None = None,
):
    hf_token = hf_token or os.environ.get("HF_TOKEN") or os.environ.get("HUGGINGFACE_HUB_TOKEN")
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print("=" * 60)
    print(f"SmartMed TrOCR GPU Training Engine")
    print(f"Device: {device} ({torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'CPU'})")
    if torch.cuda.is_available():
        vram_mb = torch.cuda.get_device_properties(0).total_memory / (1024 * 1024)
        print(f"Total GPU VRAM: {vram_mb:.0f} MB")
    print("=" * 60)

    processor, model = load_processor_and_model(model_name, hf_token, device)

    train_dataset = PrescriptionLineDataset(
        DATA_DIR / "train" / "metadata.csv",
        DATA_DIR / "train",
        processor,
    )
    val_dataset = PrescriptionLineDataset(
        DATA_DIR / "val" / "metadata.csv",
        DATA_DIR / "val",
        processor,
    )

    train_loader = DataLoader(train_dataset, batch_size=batch_size, shuffle=True, drop_last=True)
    val_loader = DataLoader(val_dataset, batch_size=batch_size, shuffle=False)

    print(f"Train samples: {len(train_dataset)} | Val samples: {len(val_dataset)}")
    print(f"Batches per epoch: {len(train_loader)} (batch_size={batch_size})")

    optimizer = torch.optim.AdamW(model.parameters(), lr=learning_rate, weight_decay=0.01)
    scaler = torch.amp.GradScaler("cuda", enabled=device.type == "cuda")

    best_val_loss = float("inf")
    metrics_history = []

    for epoch in range(1, epochs + 1):
        model.train()
        running_loss = 0.0
        start_time = time.time()

        for step, batch in enumerate(train_loader, 1):
            pixel_values = batch["pixel_values"].to(device)
            labels = batch["labels"].to(device)

            optimizer.zero_grad()

            with torch.amp.autocast("cuda", enabled=device.type == "cuda", dtype=torch.float16):
                outputs = model(pixel_values=pixel_values, labels=labels)
                loss = outputs.loss

            scaler.scale(loss).backward()
            scaler.step(optimizer)
            scaler.update()

            running_loss += loss.item()

            if step % 25 == 0 or step == len(train_loader):
                allocated_vram = torch.cuda.memory_allocated(0) / (1024 * 1024) if device.type == "cuda" else 0
                avg_step_loss = running_loss / step
                print(
                    f"Epoch [{epoch}/{epochs}] Step [{step}/{len(train_loader)}] "
                    f"Loss: {avg_step_loss:.4f} | VRAM: {allocated_vram:.0f} MB"
                )

        epoch_loss = running_loss / len(train_loader)
        epoch_time = time.time() - start_time

        # Validation phase
        model.eval()
        val_loss = 0.0
        preds_list = []
        targets_list = []

        with torch.no_grad():
            for batch in val_loader:
                pixel_values = batch["pixel_values"].to(device)
                labels = batch["labels"].to(device)

                with torch.amp.autocast("cuda", enabled=device.type == "cuda", dtype=torch.float16):
                    outputs = model(pixel_values=pixel_values, labels=labels)
                    val_loss += outputs.loss.item()

                # Generate transcription for subset
                if len(preds_list) < 20:
                    generated_ids = model.generate(pixel_values, max_new_tokens=32)
                    decoded_preds = processor.batch_decode(generated_ids, skip_special_tokens=True)
                    preds_list.extend(decoded_preds)
                    targets_list.extend(batch["text"])

        avg_val_loss = val_loss / len(val_loader)
        cer = compute_cer(preds_list, targets_list) if targets_list else 1.0

        print("-" * 60)
        print(f"Epoch {epoch} Completed in {epoch_time:.1f}s")
        print(f"Train Loss: {epoch_loss:.4f} | Val Loss: {avg_val_loss:.4f} | Val CER: {cer * 100:.2f}%")
        if preds_list:
            print(f"Sample Pred:   '{preds_list[0]}'")
            print(f"Sample Target: '{targets_list[0]}'")
        print("-" * 60)

        metrics_history.append({
            "epoch": epoch,
            "train_loss": epoch_loss,
            "val_loss": avg_val_loss,
            "val_cer": cer,
            "time_sec": epoch_time,
        })

        if avg_val_loss < best_val_loss:
            best_val_loss = avg_val_loss
            print(f"New best checkpoint! Saving to {OUTPUT_DIR}...")
            OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
            model.save_pretrained(OUTPUT_DIR)
            processor.save_pretrained(OUTPUT_DIR)
            with open(OUTPUT_DIR / "training_metrics.json", "w") as f:
                json.dump(metrics_history, f, indent=2)

    print("\nTraining complete! Fine-tuned model is saved at:")
    print(f"  {OUTPUT_DIR}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Train TrOCR on GPU for Medical Prescriptions")
    parser.add_argument("--epochs", type=int, default=3, help="Number of training epochs")
    parser.add_argument("--batch-size", type=int, default=4, help="Batch size per step (4 recommended for 4GB VRAM)")
    parser.add_argument("--lr", type=float, default=4e-5, help="Learning rate")
    args = parser.parse_args()

    train(epochs=args.epochs, batch_size=args.batch_size, learning_rate=args.lr)
