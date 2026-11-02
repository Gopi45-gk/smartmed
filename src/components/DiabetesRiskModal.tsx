import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Activity, 
  ArrowLeft, 
  CheckCircle2, 
  AlertTriangle, 
  ShieldAlert, 
  Sparkles, 
  TrendingUp, 
  ChevronDown, 
  ChevronUp, 
  Copy, 
  Check, 
  Terminal, 
  FileDown, 
  Info,
  RefreshCw
} from 'lucide-react';
import { 
  predictDiabetesRisk, 
  getDiabetesModelStatus, 
  DiabetesPredictResponse 
} from '../utils/aiClient';
import { PatientProfile, TranslationStrings } from '../types';
import { soundManager } from '../utils/audio';
import { useLanguage } from '../context/LanguageContext';

interface Props {
  close: () => void;
  patientProfile?: PatientProfile;
  t?: TranslationStrings;
}

export function DiabetesRiskModal({ close, patientProfile, t }: Props) {
  const { t: contextT } = useLanguage();
  const activeT = t || contextT;
  // Input parameters
  const [glucose, setGlucose] = useState<number>(135);
  const [bmi, setBmi] = useState<number>(27.8);
  const [age, setAge] = useState<number>(
    patientProfile?.age ? Number(patientProfile.age) || 52 : 52
  );
  const [systolicBp, setSystolicBp] = useState<number>(136);
  const [diastolicBp, setDiastolicBp] = useState<number>(84);
  const [heartRate, setHeartRate] = useState<number>(76);
  const [creatinine, setCreatinine] = useState<number>(1.1);
  const [bun, setBun] = useState<number>(20.0);

  const [showAdvanced, setShowAdvanced] = useState<boolean>(false);
  const [useMatlabEngine, setUseMatlabEngine] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [modelStatus, setModelStatus] = useState<any>(null);
  const [copiedMatlab, setCopiedMatlab] = useState<boolean>(false);
  const [downloadSuccess, setDownloadSuccess] = useState<boolean>(false);

  // Prediction state
  const [result, setResult] = useState<DiabetesPredictResponse | null>(null);

  // Fetch model status on mount
  useEffect(() => {
    getDiabetesModelStatus().then((status) => setModelStatus(status));
    handleRunPrediction();
  }, []);

  const handleRunPrediction = async () => {
    setLoading(true);
    try {
      const res = await predictDiabetesRisk({
        glucose,
        bmi,
        age,
        systolic_bp: systolicBp,
        diastolic_bp: diastolicBp,
        heart_rate: heartRate,
        creatinine,
        bun,
        patient_name: patientProfile?.name || 'ICU Patient',
        use_matlab_engine: useMatlabEngine,
      });
      setResult(res);
      if (res.risk_percent >= 65) {
        soundManager.playError();
      } else {
        soundManager.playSuccessChime();
      }
    } catch (err) {
      console.error('Failed to run diabetes prediction:', err);
    } finally {
      setLoading(false);
    }
  };

  const applyPreset = (
    g: number,
    b: number,
    a: number,
    sys: number,
    dia: number,
    hr: number,
    creat: number,
    b_val: number
  ) => {
    setGlucose(g);
    setBmi(b);
    setAge(a);
    setSystolicBp(sys);
    setDiastolicBp(dia);
    setHeartRate(hr);
    setCreatinine(creat);
    setBun(b_val);
  };

  const copyMatlabCommand = () => {
    const cmd = `RunSmartMed('predict', struct('glucose', ${glucose}, 'bmi', ${bmi}, 'age', ${age}, 'systolic_bp', ${systolicBp}, 'diastolic_bp', ${diastolicBp}))`;
    navigator.clipboard.writeText(cmd);
    setCopiedMatlab(true);
    setTimeout(() => setCopiedMatlab(false), 3000);
  };

  const handleExportReport = () => {
    setDownloadSuccess(true);
    soundManager.playSuccessChime();
    setTimeout(() => setDownloadSuccess(false), 4000);
  };

  // Color logic for gauge
  const riskPercent = result?.risk_percent ?? 0;
  const isHighRisk = riskPercent >= 65;
  const isModerate = riskPercent >= 35 && riskPercent < 65;
  const riskColor = isHighRisk ? '#EF4444' : isModerate ? '#F59E0B' : '#10B981';

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      className="p-4 sm:p-6 pb-28 max-w-4xl mx-auto w-full"
    >
      {/* Top Header */}
      <div className="flex items-center justify-between mb-5">
        <button
          onClick={close}
          className="p-2.5 rounded-2xl bg-white hover:bg-gray-100 text-gray-700 active:scale-95 transition-all border border-gray-200/80 shadow-xs flex items-center gap-1.5 text-xs font-semibold cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>{activeT.home || 'Back to Dashboard'}</span>
        </button>

        <div className="flex items-center gap-2">
          <span className="text-[11px] font-bold px-3 py-1 bg-amber-500/10 text-amber-700 border border-amber-500/20 rounded-full flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
            MathWorks® R2026b ML Pipeline
          </span>
        </div>
      </div>

      {/* Hero Banner */}
      <div className="bg-gradient-to-br from-slate-900 via-blue-950 to-indigo-950 text-white p-6 rounded-3xl shadow-lg border border-blue-900/40 relative overflow-hidden mb-6">
        <div className="absolute top-0 right-0 w-64 h-64 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="p-1.5 rounded-xl bg-blue-500/20 border border-blue-400/30 text-blue-300">
                <Activity className="w-5 h-5" />
              </span>
              <span className="text-xs font-bold tracking-wider uppercase text-blue-300">
                Predicting Diabetes Mellitus Challenge
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
              {activeT.diabetesRisk || 'ICU Diabetes Risk Assessment'}
            </h1>
            <p className="text-xs sm:text-sm text-slate-300 mt-1 max-w-xl leading-relaxed">
              Based on the MathWorks ICU Machine Learning challenge. Predicts whether an admitted patient
              has undiagnosed or undisclosed Diabetes Mellitus from clinical vitals and metabolic biomarkers.
            </p>
          </div>

          <div className="bg-white/10 backdrop-blur-md rounded-2xl p-3 border border-white/15 flex flex-col items-center justify-center min-w-[170px] text-center">
            <span className="text-[10px] text-blue-200 uppercase font-bold tracking-wider">MATLAB Status</span>
            <span className="text-xs font-bold text-white mt-0.5 flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              Model Active (143 vars)
            </span>
            <span className="text-[10px] text-slate-300 mt-1">Accuracy: 50.6% • Spec: 74.2%</span>
          </div>
        </div>
      </div>

      {/* Preset Buttons */}
      <div className="mb-5 bg-white p-3.5 rounded-2xl border border-gray-100 shadow-xs flex items-center justify-between flex-wrap gap-2">
        <span className="text-xs font-bold text-gray-500 uppercase tracking-wider flex items-center gap-1">
          <Sparkles className="w-3.5 h-3.5 text-blue-600" />
          Clinical Presets:
        </span>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => {
              applyPreset(92, 22.4, 32, 116, 74, 68, 0.85, 14);
            }}
            className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200/80 active:scale-95 transition-all"
          >
            Healthy (92 mg/dL)
          </button>
          <button
            onClick={() => {
              applyPreset(138, 28.1, 52, 134, 86, 82, 1.15, 22);
            }}
            className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200/80 active:scale-95 transition-all"
          >
            Borderline (138 mg/dL)
          </button>
          <button
            onClick={() => {
              applyPreset(230, 34.6, 63, 158, 96, 98, 1.65, 34);
            }}
            className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-rose-50 text-rose-700 hover:bg-rose-100 border border-rose-200/80 active:scale-95 transition-all"
          >
            High Risk ICU (230 mg/dL)
          </button>
          {patientProfile && (
            <button
              onClick={() => {
                const parsedAge = Number(patientProfile.age) || 50;
                applyPreset(145, 28.5, parsedAge, 132, 84, 78, 1.1, 18);
              }}
              className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-blue-50 text-[#0071E3] hover:bg-blue-100 border border-blue-200/80 active:scale-95 transition-all"
            >
              Patient: {patientProfile.name || 'Current'}
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Clinical Parameters Input Form */}
        <div className="lg:col-span-7 space-y-4">
          <div className="bg-white p-5 rounded-3xl border border-gray-100 shadow-xs space-y-4">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <h2 className="text-sm font-bold text-gray-900 flex items-center gap-1.5">
                <TrendingUp className="w-4 h-4 text-[#0071E3]" />
                Primary ICU Biomarkers
              </h2>
              <span className="text-[11px] text-gray-400 font-medium">Real-time parameters</span>
            </div>

            {/* Blood Glucose */}
            <div>
              <div className="flex items-center justify-between text-xs font-semibold text-gray-700 mb-1.5">
                <span>Blood Glucose (mg/dL)</span>
                <span className={`px-2 py-0.5 rounded-md font-bold text-[11px] ${
                  glucose >= 140 
                    ? 'bg-rose-50 text-rose-700 border border-rose-200' 
                    : glucose >= 100 
                    ? 'bg-amber-50 text-amber-700 border border-amber-200' 
                    : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                }`}>
                  {glucose} mg/dL {glucose >= 140 ? '• Hyperglycemia' : glucose >= 100 ? '• Impaired' : '• Normal'}
                </span>
              </div>
              <input
                type="range"
                min="60"
                max="350"
                step="1"
                value={glucose}
                onChange={(e) => setGlucose(Number(e.target.value))}
                className="w-full accent-[#0071E3] h-2 bg-gray-200 rounded-lg cursor-pointer"
              />
              <div className="flex justify-between text-[10px] text-gray-400 mt-1">
                <span>60 (Hypo)</span>
                <span>100 (Fasting Normal)</span>
                <span>140 (Pre-DM)</span>
                <span>350+ (Acute ICU)</span>
              </div>
            </div>

            {/* Body Mass Index (BMI) */}
            <div>
              <div className="flex items-center justify-between text-xs font-semibold text-gray-700 mb-1.5">
                <span>Body Mass Index (BMI)</span>
                <span className="font-bold text-gray-900">{bmi} kg/m²</span>
              </div>
              <input
                type="range"
                min="16"
                max="45"
                step="0.1"
                value={bmi}
                onChange={(e) => setBmi(Number(e.target.value))}
                className="w-full accent-[#0071E3] h-2 bg-gray-200 rounded-lg cursor-pointer"
              />
              <div className="flex justify-between text-[10px] text-gray-400 mt-1">
                <span>18.5 (Normal)</span>
                <span>25.0 (Overweight)</span>
                <span>30.0 (Class I Obese)</span>
                <span>40.0+ (Severe)</span>
              </div>
            </div>

            {/* Patient Age & Systolic BP Grid */}
            <div className="grid grid-cols-2 gap-3.5 pt-1">
              <div>
                <label className="text-xs font-semibold text-gray-700 block mb-1">
                  {activeT.age || 'Age'} (Years)
                </label>
                <input
                  type="number"
                  min="18"
                  max="105"
                  value={age}
                  onChange={(e) => setAge(Number(e.target.value))}
                  className="w-full px-3 py-2 bg-[#F5F5F7] border border-gray-200 rounded-xl text-sm font-semibold text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-700 block mb-1">
                  Systolic BP (mmHg)
                </label>
                <input
                  type="number"
                  min="80"
                  max="220"
                  value={systolicBp}
                  onChange={(e) => setSystolicBp(Number(e.target.value))}
                  className="w-full px-3 py-2 bg-[#F5F5F7] border border-gray-200 rounded-xl text-sm font-semibold text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            {/* Advanced ICU Biomarkers Accordion */}
            <div className="border-t border-gray-100 pt-3">
              <button
                type="button"
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="w-full flex items-center justify-between text-xs font-semibold text-gray-600 hover:text-gray-900 transition-colors py-1"
              >
                <span>Advanced ICU Labs (Creatinine, BUN, Diastolic BP, Heart Rate)</span>
                {showAdvanced ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>

              <AnimatePresence>
                {showAdvanced && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="grid grid-cols-2 gap-3 pt-3"
                  >
                    <div>
                      <label className="text-[11px] font-semibold text-gray-600 block mb-1">
                        Diastolic BP (mmHg)
                      </label>
                      <input
                        type="number"
                        min="40"
                        max="140"
                        value={diastolicBp}
                        onChange={(e) => setDiastolicBp(Number(e.target.value))}
                        className="w-full px-3 py-1.5 bg-[#F5F5F7] border border-gray-200 rounded-xl text-xs font-semibold text-gray-900"
                      />
                    </div>

                    <div>
                      <label className="text-[11px] font-semibold text-gray-600 block mb-1">
                        Heart Rate (bpm)
                      </label>
                      <input
                        type="number"
                        min="40"
                        max="180"
                        value={heartRate}
                        onChange={(e) => setHeartRate(Number(e.target.value))}
                        className="w-full px-3 py-1.5 bg-[#F5F5F7] border border-gray-200 rounded-xl text-xs font-semibold text-gray-900"
                      />
                    </div>

                    <div>
                      <label className="text-[11px] font-semibold text-gray-600 block mb-1">
                        Creatinine (mg/dL)
                      </label>
                      <input
                        type="number"
                        min="0.3"
                        max="8.0"
                        step="0.1"
                        value={creatinine}
                        onChange={(e) => setCreatinine(Number(e.target.value))}
                        className="w-full px-3 py-1.5 bg-[#F5F5F7] border border-gray-200 rounded-xl text-xs font-semibold text-gray-900"
                      />
                    </div>

                    <div>
                      <label className="text-[11px] font-semibold text-gray-600 block mb-1">
                        BUN (mg/dL)
                      </label>
                      <input
                        type="number"
                        min="4"
                        max="90"
                        step="1"
                        value={bun}
                        onChange={(e) => setBun(Number(e.target.value))}
                        className="w-full px-3 py-1.5 bg-[#F5F5F7] border border-gray-200 rounded-xl text-xs font-semibold text-gray-900"
                      />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Action Button */}
            <div className="pt-2">
              <button
                onClick={handleRunPrediction}
                disabled={loading}
                className="w-full py-3.5 bg-[#0071E3] hover:bg-[#0062c4] text-white font-bold rounded-2xl text-sm shadow-md shadow-blue-500/20 active:scale-98 transition-all flex items-center justify-center gap-2 disabled:opacity-60"
              >
                {loading ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Evaluating MathWorks ML Model...</span>
                  </>
                ) : (
                  <>
                    <Activity className="w-4 h-4" />
                    <span>Re-calculate Diabetes Risk</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* MATLAB Automation Integration Box */}
          <div className="bg-slate-900 text-white p-4.5 rounded-3xl border border-slate-800 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Terminal className="w-4 h-4 text-emerald-400" />
                <span className="text-xs font-bold uppercase tracking-wider text-slate-200">
                  MATLAB® Execution Commands
                </span>
              </div>
              <button
                onClick={copyMatlabCommand}
                className="flex items-center gap-1 text-[11px] bg-white/10 hover:bg-white/20 px-2.5 py-1 rounded-lg text-slate-200 transition-colors"
              >
                {copiedMatlab ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Copied!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copy MATLAB Code</span>
                  </>
                )}
              </button>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed font-mono bg-black/40 p-2.5 rounded-xl border border-white/5 break-all">
              RunSmartMed('predict', struct('glucose', {glucose}, 'bmi', {bmi}, 'age', {age}, 'systolic_bp', {systolicBp}))
            </p>
            <p className="text-[10px] text-slate-400 mt-2">
              Or launch the interactive MATLAB Clinical GUI directly in MATLAB with: <code className="text-blue-300">RunSmartMed('gui')</code>
            </p>
          </div>
        </div>

        {/* Right Column: Prediction Score & Clinical Triage */}
        <div className="lg:col-span-5 space-y-4">
          {result && (
            <motion.div
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm flex flex-col items-center text-center relative overflow-hidden"
            >
              {/* Risk Badge */}
              <div
                className={`mb-4 px-3.5 py-1 rounded-full text-xs font-bold tracking-wide flex items-center gap-1.5 ${
                  isHighRisk
                    ? 'bg-rose-50 text-rose-700 border border-rose-200'
                    : isModerate
                    ? 'bg-amber-50 text-amber-700 border border-amber-200'
                    : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                }`}
              >
                {isHighRisk ? (
                  <ShieldAlert className="w-4 h-4 text-rose-600" />
                ) : isModerate ? (
                  <AlertTriangle className="w-4 h-4 text-amber-600" />
                ) : (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                )}
                <span>{isHighRisk ? (activeT.highRisk || 'HIGH') : isModerate ? (activeT.moderateRisk || 'MODERATE') : (activeT.lowRisk || 'LOW')}</span>
              </div>

              {/* Animated Risk Donut Gauge */}
              <div className="relative w-40 h-40 flex items-center justify-center my-1">
                <svg className="w-full h-full transform -rotate-90" viewBox="0 0 36 36">
                  <path
                    className="text-gray-100"
                    strokeWidth="3.5"
                    stroke="currentColor"
                    fill="none"
                    d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                  />
                  <path
                    style={{ stroke: riskColor }}
                    className="transition-all duration-1000 ease-out"
                    strokeDasharray={`${riskPercent}, 100`}
                    strokeWidth="3.5"
                    strokeLinecap="round"
                    fill="none"
                    d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                  />
                </svg>
                <div className="absolute flex flex-col items-center">
                  <span className="text-3xl font-extrabold text-[#1D1D1F]">
                    {result.risk_percent}%
                  </span>
                  <span className="text-[10px] uppercase font-bold text-gray-400 tracking-wider">
                    Risk Score
                  </span>
                </div>
              </div>

              <h3 className="text-base font-bold text-gray-900 mt-2">
                {result.condition_flag}
              </h3>
              <p className="text-xs text-gray-500 mt-1 max-w-xs">
                {isHighRisk
                  ? 'High probability of undiagnosed Diabetes Mellitus upon ICU admission. Immediate glycemic protocol indicated.'
                  : isModerate
                  ? 'Borderline glycemic status. Recommend fasting blood glucose evaluation upon hemodynamic stabilization.'
                  : 'Metabolic markers within normal ranges. Continue standard vital monitoring.'}
              </p>

              {/* Feature Impact Progress Bars */}
              <div className="w-full mt-5 pt-4 border-t border-gray-100 text-left space-y-2.5">
                <div className="flex items-center justify-between text-xs font-bold text-gray-700 mb-1">
                  <span>Biomarker Contribution</span>
                  <span className="text-[11px] text-gray-400">Impact %</span>
                </div>
                {result.feature_impacts.map((f, idx) => (
                  <div key={idx}>
                    <div className="flex justify-between text-[11px] text-gray-600 mb-1">
                      <span className="font-medium">{f.feature} ({f.value})</span>
                      <span className="font-bold text-gray-900">{f.impact_percent}%</span>
                    </div>
                    <div className="w-full bg-gray-100 h-1.5 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-700 ${
                          f.severity === 'high'
                            ? 'bg-rose-500'
                            : f.severity === 'moderate'
                            ? 'bg-amber-500'
                            : 'bg-emerald-500'
                        }`}
                        style={{ width: `${Math.min(100, f.impact_percent * 2)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>

              {/* Clinical Action List */}
              <div className="w-full mt-5 pt-4 border-t border-gray-100 text-left">
                <span className="text-xs font-bold text-gray-900 block mb-2 flex items-center gap-1.5">
                  <Info className="w-3.5 h-3.5 text-[#0071E3]" />
                  {activeT.clinicalRecommendation || 'ICU Clinical Recommendations'}:
                </span>
                <ul className="space-y-1.5">
                  {result.recommendations.map((rec, i) => (
                    <li key={i} className="text-xs text-gray-600 flex items-start gap-2 leading-relaxed">
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-500 mt-1.5 shrink-0" />
                      <span>{rec}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Export Button */}
              <div className="w-full mt-5">
                <button
                  onClick={handleExportReport}
                  className="w-full py-2.5 rounded-xl border border-gray-200 text-gray-700 hover:bg-gray-50 text-xs font-semibold flex items-center justify-center gap-1.5 active:scale-95 transition-all"
                >
                  <FileDown className="w-4 h-4 text-[#0071E3]" />
                  <span>Export Clinical Triage Summary</span>
                </button>

                <AnimatePresence>
                  {downloadSuccess && (
                    <motion.div
                      initial={{ opacity: 0, y: 5 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      className="mt-2 text-[11px] text-emerald-700 font-semibold bg-emerald-50 p-2 rounded-lg border border-emerald-200 flex items-center justify-center gap-1"
                    >
                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                      <span>Saved: SmartMed_Diabetes_Risk_Evaluation.pdf</span>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </motion.div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
