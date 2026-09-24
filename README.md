# 🩺 SmartMed — AI-Powered Elderly Care & Medication Companion

[![React](https://img.shields.io/badge/React-19.0-61dafb.svg?logo=react)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue.svg?logo=typescript)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-6.2-646CFF.svg?logo=vite)](https://vitejs.dev/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-4.1-38B2AC.svg?logo=tailwind-css)](https://tailwindcss.com/)
[![Python](https://img.shields.io/badge/Python-3.10+-3776AB.svg?logo=python)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115+-009688.svg?logo=fastapi)](https://fastapi.tiangolo.com/)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

SmartMed is a multilingual, voice-first health and medication adherence companion designed specifically for seniors and their caregivers. It bridges the digital divide through empathetic voice interactions, offline-first artificial intelligence, automated prescription scanning (OCR), and synchronized caregiver monitoring.

---

## ✨ Key Features

### 🎙️ Multilingual Voice Companion
- **Hands-Free Speech Interaction**: Conversational speech-to-text (STT) and text-to-speech (TTS) powered by Kokoro and Piper neural voice models.
- **Multilingual Support**: Tailored for regional and international languages including English, Hindi, Telugu, Tamil, Bengali, Marathi, and more.
- **Simulated Incoming Medication Calls**: Realistic incoming phone call reminders that interact with elderly users, confirm pill ingestion, and record mood/symptoms.

### 📷 Prescription OCR & Medication Extraction
- **Handwritten Rx Recognition**: Integrated fine-tuned TrOCR model for reading doctors' handwritten prescriptions and printed labels.
- **Automated Schedule Parsing**: Extracts medicine names, dosages, timings (morning/afternoon/night), food instructions (before/after food), and duration.
- **EML & Drug Interaction RAG**: Built-in Knowledge Base referencing the Essential Medicines List to cross-verify contraindications and provide plain-language usage instructions.

### 🛡️ Privacy & Offline-First AI
- **Edge Inference via MNN**: Run quantized LLMs (e.g., Qwen2.5-Instruct) locally using Alibaba's MNN framework — zero health data leaves the local network.
- **Hybrid Cloud Fallback**: Optional seamless integration with Google Gemini AI for advanced medical insights when online.

### 📱 Senior-Centric Experience & Native Android App
- **Accessible UI**: Large touch targets (thumb zone), high contrast, simplified navigation, and RTL support.
- **Native Android Background Service**: Native Kotlin companion with `AlarmManager`, `Room` SQLite persistence, and `BootReceiver` for reliable alarm triggers even after phone restarts.
- **Caregiver & Family Portal**: Live medication adherence tracking, missed dose alerts, and single-tap emergency SOS notifications.

---

## 🏛️ System Architecture

```text
┌────────────────────────────────────────────────────────┐
│                   SmartMed Frontend                     │
│         (React 19 + TypeScript + Tailwind CSS)         │
│          Port: 3000 | PWA & Responsive Web             │
└──────────────────────────┬─────────────────────────────┘
                           │ HTTP / REST / WebSocket
                           ▼
┌────────────────────────────────────────────────────────┐
│                   SmartMed AI Engine                   │
│             (FastAPI / Python, Port: 8100)             │
│                                                        │
│  ┌─────────────────┐ ┌────────────────┐ ┌───────────┐  │
│  │   TrOCR OCR     │ │ Kokoro / Piper │ │ MNN LLM   │  │
│  │  Prescriptions  │ │ MultilingualTTS│ │ Edge Model│  │
│  └─────────────────┘ └────────────────┘ └───────────┘  │
│  ┌──────────────────────────────────────────────────┐  │
│  │     EML Knowledge Base & RAG Pipeline            │  │
│  └──────────────────────────────────────────────────┘  │
└──────────────────────────▲─────────────────────────────┘
                           │
┌──────────────────────────┴─────────────────────────────┐
│                 Native Android Module                   │
│      (Kotlin, Room DB, AlarmManager, Call UI)          │
└────────────────────────────────────────────────────────┘
```

---

## 🚀 Quick Start

### 1. Clone the Repository

```bash
git clone https://github.com/Gopi45-gk/smartmed.git
cd smartmed
```

### 2. Frontend Setup

```bash
# Install dependencies
npm install

# Start development server
npm run dev
```

The web application will be live at `http://localhost:3000`.

### 3. AI Backend Setup (Optional for Offline / OCR / TTS)

```bash
# Navigate to AI backend
cd ai

# Create and activate virtual environment
python3 -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate

# Install requirements
pip install -r requirements.txt

# Start FastAPI server
python server.py
```

The AI server will be available at `http://localhost:8100`.

---

## ⚙️ Configuration (.env)

Copy `.env.example` to `.env` in the root directory:

```env
# Google Gemini API Key (optional for cloud AI features)
VITE_GEMINI_API_KEY=your_gemini_api_key_here

# AI Backend Server URL
VITE_AI_SERVER_URL=http://localhost:8100
```

---

## 📦 Deployment Guides

Comprehensive setup and deployment guides are available in the repository:

- 🐳 **[Vercel, Render & Docker Deployment Guide](VERCEL_RENDER_DEPLOYMENT.md)**
- ☁️ **[AWS EC2 & CloudFormation Deployment Guide](AWS_DEPLOYMENT_GUIDE.md)**
- 🧠 **[Offline MNN AI Setup Guide](OFFLINE_AI_SETUP.md)**
- 📊 **[Prescription OCR Evaluation Report](OCR_EVALUATION_REPORT.md)**
- 📱 **[Android Native Companion Guide](android/README.md)**

---

## 🛠️ Tech Stack

- **Frontend**: React 19, TypeScript, Vite, Tailwind CSS v4, Lucide Icons, Motion
- **AI & Backend**: Python 3.10+, FastAPI, Uvicorn, PyTorch, Hugging Face Transformers (TrOCR), Alibaba MNN, Kokoro TTS, Piper TTS
- **Mobile**: Android (Kotlin, Jetpack, Room, AlarmManager, Foreground Services)
- **DevOps**: Docker, Docker Compose, Nginx, Render YAML, Vercel, AWS CloudFormation

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
