# SmartMed Offline AI Setup Guide

Complete guide to setting up the local MNN-powered AI assistant for SmartMed.

## Overview

SmartMed's offline AI assistant runs entirely on your local machine using the **MNN framework** from Alibaba. No medical conversation data is sent to any external service.

**Architecture:**
```
SmartMed Web UI (React, port 3000)
  ↓ HTTP POST /api/ai/chat
FastAPI Server (Python, port 8100)
  ↓
MNN-LLM Runtime (Python bindings)
  ↓
Local MNN Model (on disk)
  ↓
Generated Response
  ↓
FastAPI → SmartMed UI
```

---

## Prerequisites

- **Python 3.10+** (with pip)
- **Node.js 18+** (with npm)
- **4GB+ RAM** (8GB+ recommended for larger models)
- **~500MB disk space** for the smallest model

---

## Step 1: Install Python Dependencies

```bash
# From the project root
cd ai

# Create a virtual environment
python3 -m venv .venv

# Activate it
source .venv/bin/activate   # Linux/macOS
# .venv\Scripts\activate    # Windows

# Install dependencies
pip install -r requirements.txt
```

This installs:
- `fastapi` + `uvicorn` — Local API server
- `MNN` — MNN Python bindings (includes LLM support)
- `pydantic` — Request validation
- `python-dotenv` — Environment configuration

---

## Step 2: Download & Prepare an MNN Model

### Option A: Automatic Download (Easiest)

We provide a download helper script that downloads the pre-converted Qwen2.5-0.5B MNN model from Hugging Face into `ai/mnn/model/`:

```bash
cd ai
python download_model.py
```

### Option B: Clone via Git LFS

You can also clone the pre-converted model repository directly:
- `taobao-mnn/Qwen2.5-0.5B-Instruct-MNN` (~500MB, fastest)
- `taobao-mnn/Qwen2.5-1.5B-Instruct-MNN` (~900MB, better quality)

```bash
# Example: Download using git lfs
git lfs install
git clone https://huggingface.co/taobao-mnn/Qwen2.5-0.5B-Instruct-MNN ai/mnn/model
```

### Option C: Convert a Hugging Face Model Yourself

If pre-converted models aren't available, convert one using MNN's export tool:

```bash
# 1. Clone the MNN repository (for the export tool)
git clone https://github.com/JedLee6/MNN.git /tmp/MNN

# 2. Download the source model
git clone https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct /tmp/Qwen2.5-0.5B-Instruct

# 3. Export to MNN format (4-bit quantized)
cd /tmp/MNN/transformers/llm/export
python llmexport.py \
    --path /tmp/Qwen2.5-0.5B-Instruct \
    --export mnn \
    --quant_bit 4 \
    --dst_path /path/to/smart_med/ai/mnn/model
```

### Expected Model Directory Structure

After setup, `ai/mnn/model/` should contain:
```
ai/mnn/model/
├── config.json          # Runtime configuration
├── llm.mnn              # Model graph
├── llm.mnn.weight       # Model weights
├── embeddings_bf16.bin  # Embedding weights
├── tokenizer.txt        # Tokenizer vocabulary
└── llm_config.json      # Model architecture config
```

---

## Step 3: Configure Environment

```bash
# Copy the example env file
cp ai/.env.example ai/.env

# Edit ai/.env and adjust if needed:
# - MNN_MODEL_PATH (default: ./ai/mnn/model)
# - MNN_DEVICE (cpu/cuda/opencl)
# - MNN_THREAD_NUM (default: 4, increase for more cores)
```

---

## Step 4: Start the AI Backend

```bash
cd ai
source .venv/bin/activate   # Activate venv
python server.py
```

You should see:
```
SmartMed AI - Local Inference Server
Model: Qwen2.5-0.5B-Instruct-MNN
Model exists: True
Device: cpu
Port: 8100
✓ Model files found. Model will be loaded on first request.
INFO: Uvicorn running on http://0.0.0.0:8100
```

---

## Step 5: Start the Frontend

In a separate terminal:
```bash
# From project root
npm run dev
```

Open http://localhost:3000 in your browser.

---

## Step 6: Test the Integration

### Quick API Test
```bash
# Health check
curl http://localhost:8100/api/ai/health

# Status check
curl http://localhost:8100/api/ai/status

# Chat test
curl -X POST http://localhost:8100/api/ai/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "What are common symptoms of dehydration?"}'
```

### Run the Automated Test Suite
```bash
cd ai
source .venv/bin/activate
python test_api.py
```

### UI Testing
1. Navigate to the **AI Chat** tab in SmartMed
2. Check that the header shows **"● Local AI Ready"** (green dot)
3. Type a medical question and press Enter
4. Verify the response appears from the local model
5. Refresh the page — conversation should persist
6. Click the trash icon to clear the conversation

---

## Step 7: Offline Testing

1. Disconnect from the internet
2. Ensure both servers are still running:
   - AI backend: `http://localhost:8100`
   - Frontend: `http://localhost:3000`
3. Open SmartMed and use the AI chat
4. Verify responses are generated locally (no network requests to external services)

---

## Troubleshooting

### "Offline AI Unavailable" in the UI
- **Cause:** The AI backend (port 8100) is not running
- **Fix:** Start the backend: `cd ai && source .venv/bin/activate && python server.py`

### "Model files not found"
- **Cause:** Model files are not in `ai/mnn/model/`
- **Fix:** Download a model (see Step 2)

### "Cannot import MNN.llm"
- **Cause:** MNN package installed without LLM support
- **Fix:** `pip install --upgrade MNN` or build from source with `-DMNN_BUILD_LLM=true`

### "Connection refused" errors
- **Cause:** AI backend crashed or wrong port
- **Fix:** Check terminal for errors, restart with `python server.py`

### Slow responses
- Increase `MNN_THREAD_NUM` in `ai/.env`
- Use a smaller model (0.5B instead of 1.5B)
- If you have NVIDIA GPU: set `MNN_DEVICE=cuda`

### Out of memory
- Use a smaller model
- Reduce `MNN_CONTEXT_LENGTH`
- Reduce `MNN_MAX_NEW_TOKENS`
- Close other applications

---

## Security & Privacy Notes

1. **All AI inference runs locally** — no data leaves your machine
2. **Model path is server-side only** — the frontend cannot specify file paths
3. **No external AI APIs** — OpenAI, Gemini, Claude, etc. are NOT used
4. **Conversation history** — stored only in browser localStorage, never transmitted
5. **The AI is NOT a doctor** — it provides general health information only
6. **Model files** — gitignored, never committed to version control

---

## Development Commands Reference

```bash
# ─── Frontend ───────────────────────
npm install          # Install JS dependencies
npm run dev          # Start frontend dev server (port 3000)
npm run build        # Build for production

# ─── AI Backend ─────────────────────
cd ai
python3 -m venv .venv                  # Create Python venv
source .venv/bin/activate              # Activate venv
pip install -r requirements.txt        # Install Python deps
python server.py                       # Start AI server (port 8100)
python test_api.py                     # Run API tests

# ─── Both Together ──────────────────
# Terminal 1:
cd ai && source .venv/bin/activate && python server.py

# Terminal 2:
npm run dev
```
