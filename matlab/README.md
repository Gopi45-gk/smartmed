# SmartMed™ MATLAB Chromium Workstation & ICU Healthcare AI
Comprehensive MATLAB desktop integration: Embedded Chromium runtime, MathWorks® Diabetes Mellitus ML, Prescription OCR, and Twilio Telephony.

---

## 🌟 Overview
SmartMed is a unified clinical healthcare platform that can be operated **entirely inside MATLAB Desktop** using its **embedded Chromium (CEF) runtime**.

### What Runs Inside MATLAB:
1. **SmartMed Web Frontend (Embedded Chromium View)**: Full React 19 application loaded directly in a MATLAB `uifigure` via the `uihtml` Chromium component, or opened in MATLAB's dedicated Chromium browser tab (`web(url, '-new')`).
2. **Prescription OCR Pipeline**: Trigger high-precision PaddleOCR and TrOCR handwriting recognition on prescription images from the MATLAB command window or UI, returning structured medication regimens validated against the WHO Model List of Essential Medicines (EML).
3. **Interactive Telephony (Twilio Voice Engine)**: Initiate real-time interactive multilingual phone reminder calls to patients in 6 languages (English, Hindi, Tamil, Telugu, Kannada, Malayalam) and monitor 5-minute confirmation adherence directly in MATLAB.
4. **MathWorks Diabetes Mellitus Classifier**: ICU diabetes detection based on the [MathWorks Predicting Diabetes Mellitus](https://github.com/mathworks/predicting-diabetes-mellitus) repository, computing risk scores, risk categories (Euglycemic, Prediabetic, Diabetic), and clinical evidence recommendations.
5. **Clinical AI Medical Triage**: Query the medical assistant and pharmacology knowledge base directly within MATLAB.

---

## 🚀 Quick Start in MATLAB

Make sure MATLAB is open and run:

```matlab
% 1. Launch the Master Embedded Chromium Workstation
RunSmartMed
```
Or use targeted commands:

| Command | Action | Description |
|:---|:---|:---|
| `RunSmartMed` or `RunSmartMed('app')` | **Launch Chromium App** | Full workstation with embedded web view, OCR, Telephony, and ML tabs |
| `RunSmartMed('web')` | **MATLAB Chromium Browser Tab** | Opens the web app in MATLAB's internal browser tab (`web(url, '-new')`) |
| `RunSmartMed('status')` | **Health Diagnostics** | Real-time status ping of all 5 platform microservices |
| `RunSmartMed('gui')` | **Clinical Diabetes GUI** | Standalone interactive vitals slider dashboard |
| `RunSmartMed('predict')` | **Run Diabetes ML** | Tests sample ICU patient vitals against the calibrated model |
| `RunSmartMed('ocr', img)` | **Prescription OCR** | Runs PaddleOCR/TrOCR on prescription image and outputs medicines |
| `RunSmartMed('call', phone, med)` | **Dispatch Phone Call** | Triggers interactive Twilio reminder call to the patient |
| `RunSmartMed('chat', msg)` | **Clinical AI Query** | Queries the medical triage intelligence system |

---

## 🖥 Embedded Chromium Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│                      MATLAB Desktop Environment                        │
│                                                                        │
│  ┌─────────────────────── SmartMedApp.m ────────────────────────────┐  │
│  │ Top Ribbon: [Status Badge] [🌐 Browser Tab] [⚡ Health] [↻ Reload] │  │
│  │                                                                  │  │
│  │ ┌─ Tab 1: Web App (Chromium uihtml) ───────────────────────────┐ │  │
│  │ │  Loads http://localhost:3000 inside Chromium frame           │ │  │
│  │ │  Full React SPA: Dashboard, Prescriptions, Reminders, Chat   │ │  │
│  │ └──────────────────────────────────────────────────────────────┘ │  │
│  │ ┌─ Tab 2: MathWorks Diabetes ML ───┬─ Tab 3: Prescription OCR ─┐ │  │
│  │ │ Vitals sliders, Gauge, Evidence  │ PaddleOCR + TrOCR Viewer  │ │  │
│  │ ├─ Tab 4: Twilio Telephony ────────┼─ Tab 5: AI Medical Triage ┤ │  │
│  │ │ Live Phone Call Dispatcher       │ Clinical Diagnosis Chat   │ │  │
│  │ └──────────────────────────────────┴───────────────────────────┘ │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                 ▲                                      │
│                         REST / JSON Base64                             │
│                                 ▼                                      │
│  ┌──────────────────── SmartMed Backend (:8100) ────────────────────┐  │
│  │  • /api/clinical/diabetes-predict   • /api/ocr/prescription       │  │
│  │  • /api/call/trigger_now            • /api/ai/chat                │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 📋 Example Command Line Usage in MATLAB

### 1. Health Diagnostics
```matlab
>> RunSmartMed('status')

=== SmartMed System Health Check (from MATLAB) ===
  [PASS] Backend API Health             : ONLINE (http://localhost:8100/api/ai/health)
  [PASS] Prescription OCR Pipeline      : ONLINE (http://localhost:8100/api/ocr/status)
  [PASS] Twilio Call Telephony          : ONLINE (http://localhost:8100/api/call/status)
  [PASS] MathWorks Diabetes Service     : ONLINE (http://localhost:8100/api/clinical/diabetes-status)
  [PASS] Frontend Web Application       : ONLINE (http://localhost:3000)
==================================================
```

### 2. Predict Patient Diabetes Status
```matlab
patient = struct('glucose', 190, 'bmi', 32.5, 'age', 61, 'systolic_bp', 148);
PredictDiabetes(patient);
```

### 3. Run Prescription OCR
```matlab
RunSmartMed('ocr', 'ai/user_test_prescription.jpeg');
```

### 4. Trigger Outbound Twilio Voice Reminder
```matlab
RunSmartMed('call', '+919999999999', 'Metformin', '500mg', 'Ramesh Kumar', 'en');
```

### 5. Query Clinical AI
```matlab
RunSmartMed('chat', 'What are first-line treatments for Type 2 Diabetes with HbA1c 8.2%?');
```
