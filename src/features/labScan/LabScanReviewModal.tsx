import { useState, useRef, ChangeEvent } from 'react';
import { LabScanField, LabScanResponse } from './types';
import { scanLabReportApi } from './api';
import { predictDiabetesRisk, DiabetesPredictResponse } from '../../utils/aiClient';
import { glucoseStorage } from '../glucose/glucoseStorage';
import { soundManager } from '../../utils/audio';
import { PatientProfile } from '../../types';
import {
  FileText,
  Camera,
  Upload,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  ShieldAlert,
  ChevronRight,
  X,
  Edit2,
  Check,
  Sparkles,
  Info,
  Activity,
} from 'lucide-react';
import confetti from 'canvas-confetti';

interface Props {
  close: () => void;
  patientProfile?: PatientProfile;
  onGlucoseExtracted?: (value: number) => void;
}

type ScanStage = 'upload' | 'scanning' | 'review' | 'result';

export function LabScanReviewModal({ close, patientProfile, onGlucoseExtracted }: Props) {
  const [stage, setStage] = useState<ScanStage>('upload');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [scanWarnings, setScanWarnings] = useState<string[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [alsoLogGlucose, setAlsoLogGlucose] = useState<boolean>(true);

  // Extracted field values (editable)
  const [fields, setFields] = useState<Record<string, number>>({
    glucose: 135,
    bmi: 27.5,
    age: patientProfile?.age ? Number(patientProfile.age) || 52 : 52,
    systolic_bp: 130,
    diastolic_bp: 82,
    creatinine: 1.1,
    bun: 18.0,
    hba1c: 6.8,
  });

  const [fieldReviewFlags, setFieldReviewFlags] = useState<Record<string, boolean>>({});
  const [rawText, setRawText] = useState<string>('');

  // Result state
  const [predictionResult, setPredictionResult] = useState<DiabetesPredictResponse | null>(null);
  const [isCalculating, setIsCalculating] = useState<boolean>(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate size (8 MB max)
    if (file.size > 8 * 1024 * 1024) {
      setErrorMessage('File size exceeds 8 MB limit. Please select a smaller file.');
      return;
    }

    setSelectedFile(file);
    setErrorMessage(null);

    // Create preview if image
    if (file.type.startsWith('image/')) {
      const url = URL.createObjectURL(file);
      setPreviewUrl(url);
    } else {
      setPreviewUrl(null);
    }

    // Trigger scan
    executeScan(file);
  };

  const executeScan = async (file: File) => {
    setStage('scanning');
    setErrorMessage(null);

    const res = await scanLabReportApi(file);

    if (res.success && res.data) {
      const data: LabScanResponse = res.data;
      setRawText(data.raw_text);
      setScanWarnings(data.warnings || []);

      const newValues: Record<string, number> = { ...fields };
      const newReviewFlags: Record<string, boolean> = {};

      data.fields.forEach((f) => {
        if (f.value !== null && !isNaN(f.value)) {
          newValues[f.key] = f.value;
          newReviewFlags[f.key] = f.needs_review || f.confidence < 0.75;
        }
      });

      setFields(newValues);
      setFieldReviewFlags(newReviewFlags);
      setStage('review');
      soundManager.playSuccessChime();
    } else {
      // Fallback: offline or server down -> allow manual review/entry
      setErrorMessage(
        res.error || 'AI Server is offline. You can manually enter your lab report values below.'
      );
      setStage('review');
    }
  };

  const handleFieldChange = (key: string, val: string) => {
    const num = parseFloat(val);
    setFields((prev) => ({
      ...prev,
      [key]: isNaN(num) ? 0 : num,
    }));
  };

  const handleConfirmAndPredict = async () => {
    setIsCalculating(true);
    setErrorMessage(null);

    try {
      // 1. If alsoLogGlucose is true and glucose is present, save to local glucose log
      if (alsoLogGlucose && fields.glucose && fields.glucose > 0) {
        const glucReading = {
          id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `lab_${Date.now()}`,
          patientId: patientProfile?.name || 'default',
          value_mgdl: Math.round(fields.glucose),
          unit_entered: 'mg/dL' as const,
          context: 'fasting' as const,
          measuredAt: new Date().toISOString(),
          source: 'lab_scan' as const,
          createdAt: new Date().toISOString(),
          syncedAt: null,
        };
        await glucoseStorage.saveReadingLocally(glucReading);
        if (onGlucoseExtracted) onGlucoseExtracted(fields.glucose);
      }

      // 2. Call existing diabetes predictor endpoint
      const result = await predictDiabetesRisk({
        glucose: fields.glucose || 135,
        bmi: fields.bmi || 27.0,
        age: fields.age || 50,
        systolic_bp: fields.systolic_bp || 130,
        diastolic_bp: fields.diastolic_bp || 80,
        creatinine: fields.creatinine || 1.0,
        bun: fields.bun || 16.0,
        patient_name: patientProfile?.name || 'Lab Patient',
      });

      setPredictionResult(result);
      setStage('result');
      if (result.risk_percent >= 65) {
        soundManager.playError();
      } else {
        soundManager.playSuccessChime();
        confetti({ particleCount: 35, spread: 60, origin: { y: 0.6 } });
      }
    } catch (err: any) {
      setErrorMessage(`Failed to calculate risk: ${err.message || 'Error occurred'}`);
    } finally {
      setIsCalculating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-3xl p-6 w-full max-w-xl shadow-2xl my-6 border border-gray-100 flex flex-col max-h-[92vh]">
        {/* Modal Top Header */}
        <div className="flex items-center justify-between pb-3 border-b border-gray-100 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-blue-50 text-[#0071E3] flex items-center justify-center shrink-0">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base text-[#1D1D1F]">
                Lab Report Scan → Risk Auto-fill
              </h3>
              <p className="text-xs text-[#86868B]">In-memory OCR • Zero cloud transmission</p>
            </div>
          </div>
          <button
            type="button"
            onClick={close}
            className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-500 flex items-center justify-center active:scale-95 transition-all"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Content Area */}
        <div className="overflow-y-auto flex-1 py-4 space-y-4">
          {/* STAGE 1: UPLOAD / CAMERA SELECTION */}
          {stage === 'upload' && (
            <div className="space-y-4">
              <div className="p-4 bg-blue-50/60 border border-blue-200/60 rounded-2xl text-xs text-blue-900 leading-relaxed">
                Scan or upload a clinical laboratory report (Blood Sugar, HbA1c, Metabolic Panel).
                Biomarkers are extracted in-memory and deleted immediately.
              </div>

              <div className="grid grid-cols-2 gap-3 pt-2">
                {/* Take Photo Button */}
                <button
                  type="button"
                  onClick={() => cameraInputRef.current?.click()}
                  className="p-5 bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-200 rounded-2xl flex flex-col items-center justify-center text-center text-[#0071E3] active:scale-95 transition-all shadow-xs group"
                >
                  <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center mb-2 shadow-sm text-[#0071E3] group-hover:scale-110 transition-transform">
                    <Camera className="w-6 h-6" />
                  </div>
                  <span className="font-bold text-xs text-[#1D1D1F]">Take Photo</span>
                  <span className="text-[10px] text-gray-500 mt-0.5">Use device camera</span>
                </button>

                {/* Upload Document Button */}
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="p-5 bg-gradient-to-br from-emerald-50 to-teal-50 border border-emerald-200 rounded-2xl flex flex-col items-center justify-center text-center text-emerald-700 active:scale-95 transition-all shadow-xs group"
                >
                  <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center mb-2 shadow-sm text-emerald-600 group-hover:scale-110 transition-transform">
                    <Upload className="w-6 h-6" />
                  </div>
                  <span className="font-bold text-xs text-[#1D1D1F]">Upload Report</span>
                  <span className="text-[10px] text-gray-500 mt-0.5">Image or PDF (max 8MB)</span>
                </button>
              </div>

              {/* Hidden file inputs */}
              <input
                ref={cameraInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handleFileSelect}
                className="hidden"
              />
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                onChange={handleFileSelect}
                className="hidden"
              />

              {errorMessage && (
                <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 text-xs rounded-xl flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>{errorMessage}</span>
                </div>
              )}
            </div>
          )}

          {/* STAGE 2: SCANNING PROGRESS */}
          {stage === 'scanning' && (
            <div className="py-12 flex flex-col items-center justify-center text-center space-y-4">
              <div className="w-16 h-16 rounded-3xl bg-blue-50 border border-blue-200 flex items-center justify-center text-[#0071E3] animate-spin">
                <RefreshCw className="w-8 h-8" />
              </div>
              <div>
                <h4 className="font-bold text-base text-[#1D1D1F]">
                  Analyzing Laboratory Report…
                </h4>
                <p className="text-xs text-gray-500 mt-1 max-w-xs mx-auto">
                  Applying deskew, running TrOCR neural text extraction, and parsing clinical biomarkers.
                </p>
              </div>
              <div className="text-[11px] font-semibold text-emerald-600 bg-emerald-50 px-3 py-1 rounded-full border border-emerald-200">
                🔒 Privacy: Processing in-memory only
              </div>
            </div>
          )}

          {/* STAGE 3: EDITABLE VALUES REVIEW */}
          {stage === 'review' && (
            <div className="space-y-4">
              {previewUrl && (
                <div className="relative rounded-2xl overflow-hidden border border-gray-200 max-h-36 bg-gray-50 flex items-center justify-center">
                  <img src={previewUrl} alt="Report Preview" className="object-contain max-h-36" />
                  <button
                    type="button"
                    onClick={() => {
                      setPreviewUrl(null);
                      setSelectedFile(null);
                      setStage('upload');
                    }}
                    className="absolute top-2 right-2 px-2.5 py-1 bg-black/60 hover:bg-black/80 text-white rounded-lg text-[10px] font-bold backdrop-blur-xs flex items-center gap-1"
                  >
                    <RefreshCw className="w-3 h-3" />
                    <span>Retake</span>
                  </button>
                </div>
              )}

              {errorMessage && (
                <div className="p-3 bg-amber-50 border border-amber-200 text-amber-900 text-xs rounded-xl flex items-start gap-2">
                  <Info className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold">Offline / Manual Mode: </span>
                    <span>{errorMessage}</span>
                  </div>
                </div>
              )}

              {scanWarnings.length > 0 && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800 space-y-1">
                  <span className="font-bold">Extraction Notice:</span>
                  {scanWarnings.map((w, idx) => (
                    <p key={idx}>• {w}</p>
                  ))}
                </div>
              )}

              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-gray-700 uppercase">
                  Extracted Biomarkers (Editable)
                </span>
                <span className="text-[10px] text-gray-400 font-medium">
                  Review values before confirmation
                </span>
              </div>

              {/* Form Grid */}
              <div className="grid grid-cols-2 gap-3">
                {/* Glucose */}
                <div
                  className={`p-3 rounded-2xl border ${
                    fieldReviewFlags['glucose']
                      ? 'bg-amber-50/80 border-amber-300'
                      : 'bg-[#F5F5F7] border-gray-200'
                  }`}
                >
                  <div className="flex items-center justify-between text-xs font-bold text-gray-700 mb-1">
                    <span>Blood Glucose</span>
                    <span className="text-[10px] text-gray-400">mg/dL</span>
                  </div>
                  <input
                    type="number"
                    value={fields.glucose || ''}
                    onChange={(e) => handleFieldChange('glucose', e.target.value)}
                    className="w-full text-base font-extrabold text-[#1D1D1F] bg-white px-2.5 py-1.5 rounded-xl border border-gray-200 focus:outline-none focus:border-[#0071E3]"
                  />
                  {fieldReviewFlags['glucose'] && (
                    <span className="text-[9px] font-bold text-amber-700 mt-1 block">
                      ⚠️ Please verify extracted value
                    </span>
                  )}
                </div>

                {/* HbA1c */}
                <div
                  className={`p-3 rounded-2xl border ${
                    fieldReviewFlags['hba1c']
                      ? 'bg-amber-50/80 border-amber-300'
                      : 'bg-[#F5F5F7] border-gray-200'
                  }`}
                >
                  <div className="flex items-center justify-between text-xs font-bold text-gray-700 mb-1">
                    <span>HbA1c</span>
                    <span className="text-[10px] text-gray-400">%</span>
                  </div>
                  <input
                    type="number"
                    step="0.1"
                    value={fields.hba1c || ''}
                    onChange={(e) => handleFieldChange('hba1c', e.target.value)}
                    className="w-full text-base font-extrabold text-[#1D1D1F] bg-white px-2.5 py-1.5 rounded-xl border border-gray-200 focus:outline-none focus:border-[#0071E3]"
                  />
                </div>

                {/* BMI */}
                <div className="p-3 rounded-2xl bg-[#F5F5F7] border border-gray-200">
                  <div className="flex items-center justify-between text-xs font-bold text-gray-700 mb-1">
                    <span>BMI</span>
                    <span className="text-[10px] text-gray-400">kg/m²</span>
                  </div>
                  <input
                    type="number"
                    step="0.1"
                    value={fields.bmi || ''}
                    onChange={(e) => handleFieldChange('bmi', e.target.value)}
                    className="w-full text-base font-extrabold text-[#1D1D1F] bg-white px-2.5 py-1.5 rounded-xl border border-gray-200 focus:outline-none focus:border-[#0071E3]"
                  />
                </div>

                {/* Age */}
                <div className="p-3 rounded-2xl bg-[#F5F5F7] border border-gray-200">
                  <div className="flex items-center justify-between text-xs font-bold text-gray-700 mb-1">
                    <span>Age</span>
                    <span className="text-[10px] text-gray-400">yrs</span>
                  </div>
                  <input
                    type="number"
                    value={fields.age || ''}
                    onChange={(e) => handleFieldChange('age', e.target.value)}
                    className="w-full text-base font-extrabold text-[#1D1D1F] bg-white px-2.5 py-1.5 rounded-xl border border-gray-200 focus:outline-none focus:border-[#0071E3]"
                  />
                </div>

                {/* Systolic BP */}
                <div className="p-3 rounded-2xl bg-[#F5F5F7] border border-gray-200">
                  <div className="flex items-center justify-between text-xs font-bold text-gray-700 mb-1">
                    <span>Systolic BP</span>
                    <span className="text-[10px] text-gray-400">mmHg</span>
                  </div>
                  <input
                    type="number"
                    value={fields.systolic_bp || ''}
                    onChange={(e) => handleFieldChange('systolic_bp', e.target.value)}
                    className="w-full text-base font-extrabold text-[#1D1D1F] bg-white px-2.5 py-1.5 rounded-xl border border-gray-200 focus:outline-none focus:border-[#0071E3]"
                  />
                </div>

                {/* Diastolic BP */}
                <div className="p-3 rounded-2xl bg-[#F5F5F7] border border-gray-200">
                  <div className="flex items-center justify-between text-xs font-bold text-gray-700 mb-1">
                    <span>Diastolic BP</span>
                    <span className="text-[10px] text-gray-400">mmHg</span>
                  </div>
                  <input
                    type="number"
                    value={fields.diastolic_bp || ''}
                    onChange={(e) => handleFieldChange('diastolic_bp', e.target.value)}
                    className="w-full text-base font-extrabold text-[#1D1D1F] bg-white px-2.5 py-1.5 rounded-xl border border-gray-200 focus:outline-none focus:border-[#0071E3]"
                  />
                </div>

                {/* Creatinine */}
                <div className="p-3 rounded-2xl bg-[#F5F5F7] border border-gray-200">
                  <div className="flex items-center justify-between text-xs font-bold text-gray-700 mb-1">
                    <span>Creatinine</span>
                    <span className="text-[10px] text-gray-400">mg/dL</span>
                  </div>
                  <input
                    type="number"
                    step="0.1"
                    value={fields.creatinine || ''}
                    onChange={(e) => handleFieldChange('creatinine', e.target.value)}
                    className="w-full text-base font-extrabold text-[#1D1D1F] bg-white px-2.5 py-1.5 rounded-xl border border-gray-200 focus:outline-none focus:border-[#0071E3]"
                  />
                </div>

                {/* BUN */}
                <div className="p-3 rounded-2xl bg-[#F5F5F7] border border-gray-200">
                  <div className="flex items-center justify-between text-xs font-bold text-gray-700 mb-1">
                    <span>BUN</span>
                    <span className="text-[10px] text-gray-400">mg/dL</span>
                  </div>
                  <input
                    type="number"
                    step="0.1"
                    value={fields.bun || ''}
                    onChange={(e) => handleFieldChange('bun', e.target.value)}
                    className="w-full text-base font-extrabold text-[#1D1D1F] bg-white px-2.5 py-1.5 rounded-xl border border-gray-200 focus:outline-none focus:border-[#0071E3]"
                  />
                </div>
              </div>

              {/* Checkbox: Also log extracted glucose */}
              <label className="flex items-center gap-2 pt-1 text-xs text-gray-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={alsoLogGlucose}
                  onChange={(e) => setAlsoLogGlucose(e.target.checked)}
                  className="rounded text-[#0071E3] focus:ring-[#0071E3] w-4 h-4"
                />
                <span className="font-semibold">
                  Also log blood glucose ({fields.glucose} mg/dL) to daily glucose history
                </span>
              </label>

              {/* Action Buttons */}
              <div className="pt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => setStage('upload')}
                  className="py-3 px-4 bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold rounded-2xl text-xs"
                >
                  Back
                </button>
                <button
                  type="button"
                  disabled={isCalculating}
                  onClick={handleConfirmAndPredict}
                  className="flex-1 py-3 px-4 bg-[#0071E3] hover:bg-[#005bb5] text-white font-bold rounded-2xl text-xs flex items-center justify-center gap-1.5 shadow-md active:scale-95 transition-all"
                >
                  <Check className="w-4 h-4" />
                  <span>
                    {isCalculating
                      ? 'Evaluating MathWorks Model…'
                      : 'Confirm Values & Predict Diabetes Risk'}
                  </span>
                </button>
              </div>
            </div>
          )}

          {/* STAGE 4: PREDICTION RISK RESULT */}
          {stage === 'result' && predictionResult && (
            <div className="space-y-4">
              {/* Risk Banner */}
              <div
                className={`p-5 rounded-3xl border text-center ${
                  predictionResult.risk_percent >= 65
                    ? 'bg-rose-50 border-rose-200 text-rose-900'
                    : predictionResult.risk_percent >= 35
                    ? 'bg-amber-50 border-amber-200 text-amber-900'
                    : 'bg-emerald-50 border-emerald-200 text-emerald-900'
                }`}
              >
                <div className="text-4xl font-black tracking-tight">
                  {predictionResult.risk_percent}%
                </div>
                <div className="text-xs uppercase font-extrabold tracking-wider mt-1">
                  {predictionResult.risk_category} Risk
                </div>
                <div className="text-sm font-bold mt-1">
                  {predictionResult.condition_flag}
                </div>
              </div>

              {/* Feature Impact Breakdown */}
              <div className="bg-[#F5F5F7] p-4 rounded-2xl space-y-2">
                <h5 className="font-bold text-xs text-gray-700 uppercase">
                  Biomarker Contribution Analysis
                </h5>
                <div className="space-y-1.5">
                  {predictionResult.feature_impacts.map((feat, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between text-xs bg-white p-2.5 rounded-xl border border-gray-200/60"
                    >
                      <div>
                        <span className="font-bold text-[#1D1D1F]">{feat.feature}: </span>
                        <span className="text-blue-600 font-semibold">{feat.value}</span>
                        <span className="text-[10px] text-gray-400 ml-1">
                          (Normal: {feat.baseline})
                        </span>
                      </div>
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          feat.severity === 'high'
                            ? 'bg-rose-100 text-rose-800'
                            : feat.severity === 'moderate'
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-emerald-100 text-emerald-800'
                        }`}
                      >
                        {feat.impact_percent}% impact
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Clinical Recommendations */}
              <div className="bg-white p-4 rounded-2xl border border-gray-200 space-y-2">
                <h5 className="font-bold text-xs text-gray-700 uppercase">
                  Clinical Recommendations
                </h5>
                <ul className="text-xs text-gray-600 space-y-1 list-disc list-inside">
                  {predictionResult.recommendations.map((rec, i) => (
                    <li key={i}>{rec}</li>
                  ))}
                </ul>
              </div>

              {/* Mandatory Medical Disclaimer */}
              <div className="p-3 bg-gray-50 border border-gray-200 rounded-2xl text-[11px] text-gray-500 leading-relaxed">
                <strong>Disclaimer: </strong> This assessment is an AI-assisted screening aid based on the MathWorks Predicting Diabetes Mellitus model. It does not replace a clinical laboratory test or direct physician diagnosis.
              </div>

              <div className="pt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => setStage('review')}
                  className="flex-1 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold rounded-2xl text-xs"
                >
                  Adjust Values
                </button>
                <button
                  type="button"
                  onClick={close}
                  className="flex-1 py-3 bg-[#0071E3] hover:bg-[#005bb5] text-white font-bold rounded-2xl text-xs shadow-md"
                >
                  Done
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
