# SmartMed - Glucose Log + Trend Alerts & Lab Report Scan

## 1. Overview & Architecture

This additive module introduces two major clinical intelligence features to SmartMed:
1. **Lab Report Scan → Risk Auto-fill**: Camera capture or PDF/image upload of clinical biochemistry reports, in-memory TrOCR / OCR text extraction, noise-tolerant biomarker parsing, and one-tap auto-fill into the MathWorks-based Diabetes Mellitus ICU risk classifier (`/api/clinical/diabetes-predict`).
2. **Glucose Log + Trend Alerts**: Offline-first glycemic tracking with IndexedDB, automated critical and trend alert rules, lightweight inline SVG trend charts with normal target bands (70–140 mg/dL), caregiver oversight, and multilingual voice logging (English, Hindi, Tamil, Telugu).

### Zero-Cloud Privacy Guarantee
- **No Health Data Leaves the Local Network**: Biomarkers, lab images, and glucose readings are never transmitted to external clouds or third-party APIs (no Gemini, no cloud OCR).
- **In-Memory Disposal**: Uploaded lab report images and rendered PDF pages exist solely in RAM during OCR processing and are purged immediately. Nothing is written to permanent media or logged.
- **Local-First Storage**: Patient glucose data is stored in the browser's IndexedDB (`smartmed_glucose_db`) with outbox queue sync to local SQLite (`ai/data/glucose.db`).

---

## 2. Feature Flags

All new capabilities are gated by feature flags (default `true`). Setting either flag to `false` disables the feature cleanly without altering existing behavior:

| Environment Variable | Target | Default | Description |
|---|---|---|---|
| `ENABLE_GLUCOSE_FEATURES` | Backend (`ai/.env`) | `true` | When `false`, `/api/clinical/lab-scan` and `/api/glucose` routers are not mounted. |
| `VITE_ENABLE_GLUCOSE_FEATURES` | Frontend (`.env`) | `true` | When `false`, navigation cards and the Glucose & Lab portal are hidden. |

---

## 3. Backend API Reference

Base URL: `http://localhost:8100`

### A. Lab Report Scanning (`/api/clinical`)

#### `POST /api/clinical/lab-scan`
Extracts glycemic and metabolic biomarkers from a clinical laboratory report.
- **Request**: `multipart/form-data` with field `report` (or `file`).
- **Supported Formats**: JPEG (`\xff\xd8\xff`), PNG (`\x89PNG`), WebP (`RIFF...WEBP`), PDF (`%PDF`).
- **Size Limit**: 8 MB max. Magic bytes validated; extensions are not trusted.
- **Response**:
```json
{
  "fields": [
    {
      "key": "glucose",
      "label": "Blood Glucose (Fasting / Random)",
      "value": 152.0,
      "unit": "mg/dL",
      "confidence": 0.92,
      "source_text": "Fasting Blood Sugar (FBS) 152 mg/dL",
      "needs_review": false
    },
    {
      "key": "hba1c",
      "label": "Glycated Hemoglobin (HbA1c)",
      "value": 7.8,
      "unit": "%",
      "confidence": 0.92,
      "source_text": "Glycated Hemoglobin (HbA1c) 7.8 %",
      "needs_review": false
    }
  ],
  "raw_text": "...",
  "warnings": []
}
```

#### `GET /api/clinical/diabetes-schema`
Returns the expected feature schema for the MathWorks Diabetes prediction model:
```json
{
  "model": "MathWorks Predicting Diabetes Mellitus (ICU Random Forest / Ensemble)",
  "features": [
    { "name": "glucose", "label": "Blood Glucose", "unit": "mg/dL", "default": 135.0, "normal_range": "70-99" },
    { "name": "bmi", "label": "Body Mass Index", "unit": "kg/m²", "default": 27.8, "normal_range": "18.5-24.9" },
    { "name": "age", "label": "Patient Age", "unit": "years", "default": 52.0, "normal_range": "<45" },
    { "name": "systolic_bp", "label": "Systolic Blood Pressure", "unit": "mmHg", "default": 136.0, "normal_range": "<120" },
    { "name": "diastolic_bp", "label": "Diastolic Blood Pressure", "unit": "mmHg", "default": 84.0, "normal_range": "<80" },
    { "name": "creatinine", "label": "Serum Creatinine", "unit": "mg/dL", "default": 1.1, "normal_range": "0.7-1.3" },
    { "name": "bun", "label": "Blood Urea Nitrogen", "unit": "mg/dL", "default": 20.0, "normal_range": "7-20" }
  ]
}
```

---

### B. Glucose Monitoring (`/api/glucose`)

#### `POST /api/glucose`
Submits a glucose reading. **Idempotent by client-generated UUID `id`**.
- **Request Body**:
```json
{
  "id": "c1f7a0b3-9e42-4f3b-85c1-84e9d5a71234",
  "patient_id": "Ramesh Kumar",
  "value_mgdl": 145.0,
  "unit_entered": "mg/dL",
  "context": "fasting",
  "measured_at": "2026-10-16T08:00:00Z",
  "source": "voice"
}
```
- **Validation**:
  - Value must be within physiological range `20.0 <= value_mgdl <= 800.0`.
  - Timestamps cannot be in the future (> 60s ahead).
- **Response**: Returns the saved reading along with any real-time alert rules triggered.

#### `GET /api/glucose`
Retrieves reading history.
- **Query Parameters**:
  - `patientId`: Filter by patient (optional).
  - `from`: ISO 8601 start date (optional).
  - `to`: ISO 8601 end date (optional).

#### `DELETE /api/glucose/{id}`
Deletes a specific reading by its UUID.

#### `GET /api/glucose/alerts`
Retrieves generated alerts for a patient.

#### `GET /api/glucose/thresholds` & `PUT /api/glucose/thresholds`
Fetches or updates custom alert thresholds for a patient:
```json
{
  "patient_id": "Ramesh Kumar",
  "critical_low": 70.0,
  "critical_high": 250.0,
  "fasting_target_max": 130.0,
  "random_target_max": 180.0,
  "sudden_change_delta": 100.0,
  "sudden_change_window_hours": 3,
  "trend_days_count": 3,
  "cooldown_minutes": 180
}
```

#### `GET /api/glucose/correlation`
Cross-correlates missed doses from existing medication adherence logs against post-dose blood sugar readings. Read-only; does not alter existing adherence tables.

---

## 4. Alert Engine Rules

The alert engine operates deterministically via pure functions and configurable thresholds:

| Rule Name | Trigger Condition | Severity | Plain-Language Notice Example |
|---|---|---|---|
| **Critical Low (Hypoglycemia)** | Reading `< 70 mg/dL` | `critical` | *"Sugar reading 58 mg/dL is low. Please take fast-acting sugar or juice, and contact doctor if needed."* |
| **Critical High (Hyperglycemia)** | Reading `> 250 mg/dL` | `critical` | *"Sugar reading 290 mg/dL is high. Please contact the doctor or take prescribed action."* |
| **Sudden Spike / Drop** | Difference `> 100 mg/dL` between consecutive readings within `3 hours` | `warning` | *"Blood sugar spiked rapidly by 125 mg/dL within 1.5 hours."* |
| **Consecutive Elevated Trend** | Fasting `> 130 mg/dL` or Any `> 180 mg/dL` for `≥ 3 consecutive days` | `warning` | *"Elevated blood sugar detected across 3 consecutive days (Fasting > 130 or Random > 180)."* |

### Alert Cooldown & De-duplication
To prevent alert fatigue, duplicate alerts for the same rule on the same patient are suppressed within a 3-hour cooldown window (`cooldown_minutes: 180`).

---

## 5. Multilingual Voice Integration

Senior citizens can log blood glucose completely hands-free:
1. Tap **Voice Log** or speak during calls.
2. The voice parser recognizes numerals in English, Hindi, Tamil, and Telugu:
   - *"sugar 140"* (English)
   - *"शुगर 180"* / *"खाली पेट शुगर 110"* (Hindi)
   - *"என் சுகர் 160"* / *"சாப்பாட்டுக்கு பின் 195"* (Tamil)
   - *"షుగర్ 130"* / *"ఉపవాసం షుగర్ 105"* (Telugu)
   - Native numerals (Devanagari `१४०`, Tamil `௧௮0`, Telugu `౧౨౦`) are normalized to standard numbers.
3. **Voice & Screen Confirmation**:
   - The system speaks a verification prompt: *"Sugar 140 mg/dL (fasting), is that correct?"* in the patient's language.
   - The reading is only persisted after the user confirms.
   - Values outside 20–800 mg/dL are rejected with a prompt to repeat.

---

## 6. Offline-First Verification & Manual Fallback

- **No Network Test**:
  1. Disconnect Wi-Fi / Ethernet or stop the backend.
  2. Enter a blood glucose reading or speak a value.
  3. The reading saves immediately to browser IndexedDB and appears on the trend chart and history list with an **Offline** badge.
  4. If a reading is `< 70` or `> 250`, the local evaluator triggers an immediate on-screen critical alert and chime even with zero internet.
  5. When network connectivity restores, the outbox syncs automatically with exponential backoff.
- **Server Offline Lab Scan Fallback**:
  If the AI backend is unreachable during lab scan, the modal displays a clear notification and allows direct review and manual biomarker entry without blocking the workflow.
