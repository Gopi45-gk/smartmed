"""
SmartMed AI - Voice Model Downloader
Downloads offline neural voice models for Piper ONNX and Kokoro TTS.

Usage:
    python ai/download_voice_models.py --engine piper    # Downloads Piper voice (~60MB)
    python ai/download_voice_models.py --engine kokoro   # Downloads Kokoro voice (~320MB)
    python ai/download_voice_models.py --all             # Downloads both
"""

import sys
import argparse
import urllib.request
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
PIPER_DIR = BASE_DIR / "tts" / "models" / "piper"
KOKORO_DIR = BASE_DIR / "tts" / "models" / "kokoro"

PIPER_FILES = [
    (
        "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx",
        PIPER_DIR / "en_US-lessac-medium.onnx",
    ),
    (
        "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx.json",
        PIPER_DIR / "en_US-lessac-medium.onnx.json",
    ),
]

KOKORO_FILES = [
    (
        "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files/kokoro-v0_19.onnx",
        KOKORO_DIR / "kokoro-v0_19.onnx",
    ),
    (
        "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files/voices.json",
        KOKORO_DIR / "voices.json",
    ),
]


def download_file(url: str, dest: Path):
    """Download a file with progress output."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and dest.stat().st_size > 1000:
        print(f"  ✓ {dest.name} already exists ({dest.stat().st_size / (1024*1024):.1f} MB), skipping.")
        return

    print(f"  Downloading {dest.name} from {url}...")
    temp_path = dest.with_suffix(".tmp")

    def progress(block_num, block_size, total_size):
        if total_size <= 0:
            return
        downloaded = block_num * block_size
        pct = min(100.0, downloaded * 100.0 / total_size)
        mb_down = downloaded / (1024 * 1024)
        mb_total = total_size / (1024 * 1024)
        sys.stdout.write(f"\r  [{pct:5.1f}%] {mb_down:.1f} MB / {mb_total:.1f} MB")
        sys.stdout.flush()

    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req) as resp, open(temp_path, "wb") as f:
            total_size = int(resp.headers.get("Content-Length", 0))
            block_size = 1024 * 64
            block_num = 0
            while True:
                chunk = resp.read(block_size)
                if not chunk:
                    break
                f.write(chunk)
                block_num += 1
                progress(block_num, block_size, total_size)

        temp_path.rename(dest)
        print(f"\n  ✓ Saved {dest.name}")
    except Exception as e:
        if temp_path.exists():
            temp_path.unlink()
        print(f"\n  ✗ Error downloading {dest.name}: {e}")
        raise


def download_piper():
    print("\n--- Downloading Piper ONNX Voice (en_US-lessac-medium) ---")
    for url, path in PIPER_FILES:
        download_file(url, path)


def download_kokoro():
    print("\n--- Downloading Kokoro TTS Models ---")
    for url, path in KOKORO_FILES:
        download_file(url, path)


def main():
    parser = argparse.ArgumentParser(description="Download SmartMed Offline TTS Voice Models")
    parser.add_argument("--engine", choices=["piper", "kokoro", "all"], default="piper",
                        help="Voice engine to download (default: piper)")
    parser.add_argument("--all", action="store_true", help="Download both engines")
    args = parser.parse_args()

    if args.all or args.engine == "all":
        download_piper()
        download_kokoro()
    elif args.engine == "kokoro":
        download_kokoro()
    else:
        download_piper()

    print("\n✓ Voice models download process complete!")


if __name__ == "__main__":
    main()
