import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { FeatureErrorBoundary } from './common/ErrorBoundary';
import { GlucoseQuickAdd } from './glucose/GlucoseQuickAdd';
import { GlucoseTrendChart } from './glucose/GlucoseTrendChart';
import { GlucoseHistoryList } from './glucose/GlucoseHistoryList';
import { CaregiverGlucoseView } from './glucose/CaregiverGlucoseView';
import { LabScanReviewModal } from './labScan/LabScanReviewModal';
import { glucoseStorage } from './glucose/glucoseStorage';
import { GlucoseReading } from './glucose/types';
import { PatientProfile, TranslationStrings, Language } from '../types';
import { soundManager } from '../utils/audio';
import {
  ArrowLeft,
  Activity,
  FileText,
  Users,
  ShieldCheck,
  Sparkles,
  CloudUpload,
  RefreshCw,
  Plus,
  HelpCircle,
  AlertCircle,
} from 'lucide-react';

interface Props {
  close: () => void;
  patientProfile?: PatientProfile;
  t: TranslationStrings;
  lang?: Language;
}

export function GlucoseAndLabPortal({ close, patientProfile, t, lang = 'en' }: Props) {
  // Feature flag check
  const isEnabled = (import.meta as any).env?.VITE_ENABLE_GLUCOSE_FEATURES !== 'false';

  const [activeTab, setActiveTab] = useState<'patient' | 'caregiver'>('patient');
  const [readings, setReadings] = useState<GlucoseReading[]>([]);
  const [pendingSyncCount, setPendingSyncCount] = useState<number>(0);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [showLabScanModal, setShowLabScanModal] = useState<boolean>(false);

  const patientId = patientProfile?.name || 'default';

  // Load readings on mount
  const refreshReadings = async () => {
    try {
      const local = await glucoseStorage.getReadings(patientId);
      setReadings(local);
      const pending = await glucoseStorage.getPendingSyncCount();
      setPendingSyncCount(pending);
    } catch (err) {
      console.warn('Failed to load glucose readings:', err);
    }
  };

  useEffect(() => {
    refreshReadings();
    // Try to pull and sync with server in background
    glucoseStorage.pullAndMerge(patientId).then((merged) => {
      setReadings(merged);
    });

    const unsubscribe = glucoseStorage.onSyncChange(() => {
      glucoseStorage.getPendingSyncCount().then(setPendingSyncCount);
    });

    return () => unsubscribe();
  }, [patientId]);

  const handleManualSync = async () => {
    setIsSyncing(true);
    try {
      const result = await glucoseStorage.triggerSync();
      await refreshReadings();
      if (result.syncedCount > 0) {
        soundManager.playSuccessChime();
      }
    } catch {
      soundManager.playError();
    } finally {
      setIsSyncing(false);
    }
  };

  if (!isEnabled) {
    return null;
  }

  return (
    <FeatureErrorBoundary fallbackTitle="Glucose & Lab Portal Error" onReset={refreshReadings}>
      <motion.div
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 15 }}
        className="p-4 sm:p-5 pb-12 max-w-2xl mx-auto w-full"
      >
        {/* Top Navigation Bar with Back Button */}
        <div className="flex items-center justify-between pb-3 mb-3 border-b border-gray-200/80">
          <button
            type="button"
            onClick={close}
            className="flex items-center gap-1.5 text-xs font-bold text-gray-700 hover:text-[#0071E3] active:scale-95 transition-all p-1.5 rounded-xl bg-white border border-gray-200 shadow-2xs"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Home</span>
          </button>

          {/* Sync Status Badge */}
          <div className="flex items-center gap-2">
            {pendingSyncCount > 0 ? (
              <button
                type="button"
                onClick={handleManualSync}
                disabled={isSyncing}
                className="flex items-center gap-1.5 text-[10px] font-bold text-amber-800 bg-amber-50 px-2.5 py-1 rounded-full border border-amber-200 shadow-2xs active:scale-95 transition-all"
                title="Tap to sync pending readings with server"
              >
                <CloudUpload className={`w-3 h-3 text-amber-600 ${isSyncing ? 'animate-bounce' : ''}`} />
                <span>{pendingSyncCount} pending sync</span>
              </button>
            ) : (
              <span className="flex items-center gap-1 text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <span>Synced</span>
              </span>
            )}

            {/* Senior vs Caregiver Tab Pill */}
            <div className="flex bg-gray-200/80 p-0.5 rounded-xl text-xs font-bold">
              <button
                type="button"
                onClick={() => setActiveTab('patient')}
                className={`px-2.5 py-1 rounded-lg transition-all ${
                  activeTab === 'patient'
                    ? 'bg-white text-[#0071E3] shadow-xs'
                    : 'text-gray-600 hover:text-black'
                }`}
              >
                Senior
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('caregiver')}
                className={`px-2.5 py-1 rounded-lg transition-all ${
                  activeTab === 'caregiver'
                    ? 'bg-white text-[#0071E3] shadow-xs'
                    : 'text-gray-600 hover:text-black'
                }`}
              >
                Caregiver
              </button>
            </div>
          </div>
        </div>

        {/* Hero Title & Lab Scan Action Banner */}
        <div className="bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-700 text-white rounded-3xl p-5 shadow-sm mb-4 relative overflow-hidden">
          <div className="relative z-10 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-blue-100 uppercase tracking-wider">
                <Activity className="w-3.5 h-3.5" />
                <span>Clinical Glycemic Care</span>
              </div>
              <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight mt-0.5">
                Glucose Log &amp; Lab Reports
              </h2>
              <p className="text-xs text-blue-100/90 mt-1">
                Offline log • Trend alerts • In-memory lab scan • Diabetes risk auto-fill
              </p>
            </div>

            {/* Launch Lab Scan Button */}
            <button
              type="button"
              onClick={() => setShowLabScanModal(true)}
              className="px-4 py-2.5 bg-white text-[#0071E3] font-bold text-xs rounded-2xl shadow-sm hover:bg-blue-50 active:scale-95 transition-all flex items-center justify-center gap-2 self-start sm:self-auto shrink-0"
            >
              <FileText className="w-4 h-4 text-[#0071E3]" />
              <span>Scan Lab Report</span>
            </button>
          </div>
        </div>

        {/* Tab 1: Senior View */}
        {activeTab === 'patient' && (
          <div className="space-y-4">
            {/* Quick Add Form */}
            <GlucoseQuickAdd
              patientId={patientId}
              lang={lang}
              onAdded={(newReading) => {
                setReadings((prev) => [newReading, ...prev.filter((r) => r.id !== newReading.id)]);
              }}
            />

            {/* Inline SVG Trend Chart */}
            <GlucoseTrendChart readings={readings} />

            {/* History List */}
            <GlucoseHistoryList
              readings={readings}
              onDeleted={(id) => {
                setReadings((prev) => prev.filter((r) => r.id !== id));
              }}
              onRefresh={refreshReadings}
            />
          </div>
        )}

        {/* Tab 2: Caregiver Oversight View */}
        {activeTab === 'caregiver' && (
          <CaregiverGlucoseView patientId={patientId} readings={readings} />
        )}

        {/* Lab Scan Modal */}
        {showLabScanModal && (
          <LabScanReviewModal
            close={() => {
              setShowLabScanModal(false);
              refreshReadings();
            }}
            patientProfile={patientProfile}
            onGlucoseExtracted={(val) => {
              refreshReadings();
            }}
          />
        )}

        {/* Safety & Compliance Disclaimer */}
        <div className="mt-6 p-3 bg-gray-100/80 rounded-2xl text-[10px] text-gray-500 leading-relaxed text-center">
          <strong>Medical Notice: </strong> SmartMed Glucose Log and Lab Scan are designed as personal screening and monitoring aids. They do not constitute formal medical diagnosis or prescription. Always consult a qualified physician for clinical decisions.
        </div>
      </motion.div>
    </FeatureErrorBoundary>
  );
}
