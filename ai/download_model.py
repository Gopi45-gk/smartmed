"""
SmartMed AI - Model Downloader
Downloads the pre-converted Qwen2.5-0.5B-Instruct-MNN model from Hugging Face
into the local ai/mnn/model directory.

Usage:
    python download_model.py
"""

import os
import sys
import urllib.request
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
TARGET_DIR = BASE_DIR / "mnn" / "model"

REPO = "taobao-mnn/Qwen2.5-0.5B-Instruct-MNN"
BASE_URL = f"https://huggingface.co/{REPO}/resolve/main"

FILES = [
    "config.json",
    "llm_config.json",
    "tokenizer.txt",
    "llm.mnn",
    "llm.mnn.json",
    "embeddings_bf16.bin",
    "llm.mnn.weight",
]


def download_file(url: str, dest_path: Path):
    """Download a file with progress indicator."""
    print(f"Downloading {dest_path.name}...")

    def progress(block_num, block_size, total_size):
        if total_size <= 0:
            return
        downloaded = block_num * block_size
        percent = min(100.0, downloaded * 100.0 / total_size)
        mb_down = downloaded / (1024 * 1024)
        mb_total = total_size / (1024 * 1024)
        sys.stdout.write(
            f"\r  [{percent:5.1f}%] {mb_down:.1f} MB / {mb_total:.1f} MB"
        )
        sys.stdout.flush()

    dest_path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = dest_path.with_suffix(".tmp")
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req) as resp, open(temp_path, "wb") as out:
            total_size = int(resp.headers.get("Content-Length", 0))
            block_size = 1024 * 64
            block_num = 0
            while True:
                chunk = resp.read(block_size)
                if not chunk:
                    break
                out.write(chunk)
                block_num += 1
                progress(block_num, block_size, total_size)
        print()
        temp_path.rename(dest_path)
    except Exception as e:
        if temp_path.exists():
            temp_path.unlink()
        raise e


def main():
    print("=" * 60)
    print("SmartMed AI - Model Downloader")
    print(f"Repository: {REPO}")
    print(f"Target Directory: {TARGET_DIR}")
    print("=" * 60)

    TARGET_DIR.mkdir(parents=True, exist_ok=True)

    for filename in FILES:
        dest = TARGET_DIR / filename
        if dest.exists() and dest.stat().st_size > 0:
            print(f"✓ {filename} already exists, skipping.")
            continue

        url = f"{BASE_URL}/{filename}"
        try:
            download_file(url, dest)
            print(f"✓ {filename} downloaded successfully.")
        except Exception as e:
            print(f"\n✗ Failed to download {filename}: {e}")
            print("You can download it manually from:")
            print(f"  {url}")
            sys.exit(1)

    print("=" * 60)
    print("✓ All model files are ready!")
    print(f"Location: {TARGET_DIR}")
    print("You can now start the server with: python server.py")
    print("=" * 60)


if __name__ == "__main__":
    main()
