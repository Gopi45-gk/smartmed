import { useState, useEffect } from 'react';
import type { FormEvent } from 'react';
import { GlucoseReading, GlucoseAlert, GlucoseThresholds, GlucoseCorrelationInsight, DEFAULT_THRESHOLDS } from './types';
import { GlucoseTrendChart } from './GlucoseTrendChart';
import { fetchGlucoseAlertsApi, fetchThresholdsApi, saveThresholdsApi, fetchCorrelationInsightApi } from './api';
import { glucoseStorage } from './glucoseStorage';
import { soundManager } from '../../utils/audio';
import {
  BellRing,
  ShieldAlert,
  AlertTriangle,
  Sliders,
  Check,
  TrendingUp,
  Activity,
  HeartPulse,
  RefreshCw,
  Info,
} from 'lucide-react';

interface Props {
  patientId: string;
  readings: GlucoseReading[];
}

export function CaregiverGlucoseView({ patientId, readings }: Props) {
  const [alerts, setAlerts] = useState<GlucoseAlert[]>([]);
  const [thresholds, setThresholds] = useState<GlucoseThresholds>(DEFAULT_THRESHOLDS);
  const [insight, setInsight] = useState<GlucoseCorrelationInsight | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [showSettingsModal, setShowSettingsModal] = useState<boolean>(false);
  const [savingSettings, setSavingSettings] = useState<boolean>(false);
  const [settingsSuccess, setSettingsSuccess] = useState<boolean>(false);

  // Edit threshold state
  const [editCritLow, setEditCritLow] = useState<number>(DEFAULT_THRESHOLDS.critical_low);
  const [editCritHigh, setEditCritHigh] = useState<number>(DEFAULT_THRESHOLDS.critical_high);
  const [editFastingMax, setEditFastingMax] = useState<number>(DEFAULT_THRESHOLDS.fasting_target_max);
  const [editRandomMax, setEditRandomMax] = useState<number>(DEFAULT_THRESHOLDS.random_target_max);
  const [editSuddenDelta, setEditSuddenDelta] = useState<number>(DEFAULT_THRESHOLDS.sudden_change_delta);

  const loadData = async () => {
    setLoading(true);
    try {
      // 1. Fetch server alerts and local alerts combined
      const [serverAlerts, localAlerts, threshData, corrInsight] = await Promise.all([
        fetchGlucoseAlertsApi(patientId),
        glucoseStorage.getAlerts(patientId),
        fetchThresholdsApi(patientId),
        fetchCorrelationInsightApi(patientId),
      ]);

      // Deduplicate alerts by id or message + rule
      const alertMap = new Map<string, GlucoseAlert>();
      localAlerts.forEach((a) => alertMap.set(a.id, a));
      serverAlerts.forEach((a) => alertMap.set(a.id, a));
      const combinedAlerts = Array.from(alertMap.values()).sort(
        (a, b) => new Date(b.triggered_at).getTime() - new Date(a.triggered_at).getTime()
      );

      setAlerts(combinedAlerts);
      setThresholds(threshData);
      setInsight(corrInsight);

      // Populate edit fields
      setEditCritLow(threshData.critical_low);
      setEditCritHigh(threshData.critical_high);
      setEditFastingMax(threshData.fasting_target_max);
      setEditRandomMax(threshData.random_target_max);
      setEditSuddenDelta(threshData.sudden_change_delta);
    } catch (err) {
      console.warn('Caregiver data load error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [patientId]);

  const handleSaveThresholds = async (e: FormEvent) => {
    e.preventDefault();
    setSavingSettings(true);
    setSettingsSuccess(false);

    const updated: GlucoseThresholds = {
      ...thresholds,
      patient_id: patientId || 'default',
      critical_low: editCritLow,
      critical_high: editCritHigh,
      fasting_target_max: editFastingMax,
      random_target_max: editRandomMax,
      sudden_change_delta: editSuddenDelta,
    };

    const ok = await saveThresholdsApi(updated);
    if (ok) {
      setThresholds(updated);
      setSettingsSuccess(true);
      soundManager.playSuccessChime();
      setTimeout(() => {
        setShowSettingsModal(false);
        setSettingsSuccess(false);
      }, 1500);
    } else {
      soundManager.playError();
    }
    setSavingSettings(false);
  };

  return (
    <div className="space-y-4">
      {/* Top Header Card for Caregiver Mode */}
      <div className="bg-gradient-to-r from-purple-900 to-indigo-900 text-white rounded-3xl p-5 shadow-sm flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-white/10 flex items-center justify-center text-purple-200 border border-white/10">
            <HeartPulse className="w-6 h-6 text-purple-200 animate-pulse" />
          </div>
          <div>
            <h3 className="font-bold text-base text-white">Caregiver Glycemic Oversight</h3>
            <p className="text-xs text-purple-200 mt-0.5">
              Automated rules • Real-time alerts • Threshold controls
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setShowSettingsModal(true)}
          className="px-3 py-2 bg-white/15 hover:bg-white/20 active:scale-95 transition-all text-white font-bold text-xs rounded-xl flex items-center gap-1.5 border border-white/20 shadow-xs"
        >
          <Sliders className="w-3.5 h-3.5" />
          <span>Alert Rules</span>
        </button>
      </div>

      {/* Active Glucose Alerts Banner List */}
      <div className="bg-white rounded-3xl p-5 shadow-sm border border-gray-100/90">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <BellRing className="w-4 h-4 text-purple-600" />
            <h4 className="font-bold text-sm text-[#1D1D1F]">Active Trend & Critical Alerts</h4>
          </div>
          <button
            type="button"
            onClick={loadData}
            className="text-xs text-blue-600 hover:underline flex items-center gap-1"
          >
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>

        {alerts.length === 0 ? (
          <div className="p-4 bg-emerald-50/70 border border-emerald-200/80 rounded-2xl flex items-center gap-2.5 text-xs text-emerald-800 font-semibold">
            <Check className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>No active alerts. All blood sugar readings within monitored parameters.</span>
          </div>
        ) : (
          <div className="space-y-2.5">
            {alerts.slice(0, 5).map((alert) => {
              const isCrit = alert.severity === 'critical';
              return (
                <div
                  key={alert.id}
                  className={`p-3.5 rounded-2xl border flex items-start gap-3 transition-all ${
                    isCrit
                      ? 'bg-rose-50 border-rose-200 text-rose-900'
                      : 'bg-amber-50 border-amber-200 text-amber-900'
                  }`}
                >
                  <div
                    className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 mt-0.5 ${
                      isCrit ? 'bg-rose-200 text-rose-700' : 'bg-amber-200 text-amber-700'
                    }`}
                  >
                    {isCrit ? (
                      <ShieldAlert className="w-4 h-4 animate-bounce" />
                    ) : (
                      <AlertTriangle className="w-4 h-4" />
                    )}
                  </div>

                  <div className="flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-xs uppercase tracking-wider">
                        {alert.rule_id.replace('_', ' ')}
                      </span>
                      <span className="text-[10px] text-gray-500 font-medium">
                        {new Date(alert.triggered_at).toLocaleString([], {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                    <p className="text-xs font-medium mt-1 leading-relaxed">{alert.message}</p>
                    {alert.value_mgdl && (
                      <div className="mt-1.5 inline-block text-[11px] font-bold bg-white/80 px-2 py-0.5 rounded-md border border-black/10">
                        Trigger Value: {alert.value_mgdl} mg/dL
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Embedded Glucose Trend Chart */}
      <GlucoseTrendChart readings={readings} />

      {/* Medication Adherence & Glucose Correlation Insight Card */}
      {insight && (
        <div className="bg-white rounded-3xl p-5 shadow-sm border border-gray-100/90">
          <div className="flex items-center gap-2 mb-2">
            <Activity className="w-4 h-4 text-indigo-600" />
            <h4 className="font-bold text-sm text-[#1D1D1F]">
              Medication Adherence Correlation
            </h4>
          </div>

          <div className="p-3.5 bg-indigo-50/70 border border-indigo-200/70 rounded-2xl text-xs text-indigo-900 space-y-2">
            <p className="font-medium leading-relaxed">{insight.insight_summary}</p>
            {insight.avg_glucose_after_missed && (
              <div className="grid grid-cols-2 gap-2 pt-1 border-t border-indigo-200/60 text-center">
                <div className="bg-white/80 p-2 rounded-xl">
                  <div className="text-[10px] uppercase font-bold text-indigo-500">
                    Post-Missed Dose Avg
                  </div>
                  <div className="text-sm font-extrabold text-rose-600 mt-0.5">
                    {insight.avg_glucose_after_missed} mg/dL
                  </div>
                </div>
                <div className="bg-white/80 p-2 rounded-xl">
                  <div className="text-[10px] uppercase font-bold text-indigo-500">
                    Adherent Baseline Avg
                  </div>
                  <div className="text-sm font-extrabold text-emerald-600 mt-0.5">
                    {insight.avg_glucose_normal || '--'} mg/dL
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Thresholds Settings Modal */}
      {showSettingsModal && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 w-full max-w-md shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-lg text-[#1D1D1F]">Configurable Alert Thresholds</h3>
              <button
                type="button"
                onClick={() => setShowSettingsModal(false)}
                className="text-gray-400 hover:text-gray-600 text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-gray-500">
              Customize threshold parameters that trigger urgent caregiver alerts. Safe medical defaults are pre-populated.
            </p>

            <form onSubmit={handleSaveThresholds} className="space-y-3.5">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-bold text-rose-700 uppercase">
                    Critical Low (&lt; mg/dL)
                  </label>
                  <input
                    type="number"
                    min="40"
                    max="100"
                    value={editCritLow}
                    onChange={(e) => setEditCritLow(Number(e.target.value))}
                    className="w-full mt-1 p-2.5 bg-[#F5F5F7] rounded-xl border border-gray-200 text-sm font-bold text-rose-700 focus:outline-none"
                    required
                  />
                </div>
                <div>
                  <label className="text-[11px] font-bold text-rose-700 uppercase">
                    Critical High (&gt; mg/dL)
                  </label>
                  <input
                    type="number"
                    min="180"
                    max="450"
                    value={editCritHigh}
                    onChange={(e) => setEditCritHigh(Number(e.target.value))}
                    className="w-full mt-1 p-2.5 bg-[#F5F5F7] rounded-xl border border-gray-200 text-sm font-bold text-rose-700 focus:outline-none"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-bold text-gray-700 uppercase">
                    Fasting Max (mg/dL)
                  </label>
                  <input
                    type="number"
                    min="90"
                    max="200"
                    value={editFastingMax}
                    onChange={(e) => setEditFastingMax(Number(e.target.value))}
                    className="w-full mt-1 p-2.5 bg-[#F5F5F7] rounded-xl border border-gray-200 text-sm font-bold text-gray-800 focus:outline-none"
                    required
                  />
                </div>
                <div>
                  <label className="text-[11px] font-bold text-gray-700 uppercase">
                    Random/Post Max (mg/dL)
                  </label>
                  <input
                    type="number"
                    min="140"
                    max="300"
                    value={editRandomMax}
                    onChange={(e) => setEditRandomMax(Number(e.target.value))}
                    className="w-full mt-1 p-2.5 bg-[#F5F5F7] rounded-xl border border-gray-200 text-sm font-bold text-gray-800 focus:outline-none"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="text-[11px] font-bold text-gray-700 uppercase">
                  Sudden Change Delta (&gt; mg/dL in 3h)
                </label>
                <input
                  type="number"
                  min="50"
                  max="200"
                  value={editSuddenDelta}
                  onChange={(e) => setEditSuddenDelta(Number(e.target.value))}
                  className="w-full mt-1 p-2.5 bg-[#F5F5F7] rounded-xl border border-gray-200 text-sm font-bold text-gray-800 focus:outline-none"
                  required
                />
              </div>

              {settingsSuccess && (
                <div className="p-2.5 bg-emerald-50 text-emerald-800 rounded-xl text-xs font-bold flex items-center gap-2">
                  <Check className="w-4 h-4 text-emerald-600" />
                  <span>Thresholds updated successfully!</span>
                </div>
              )}

              <div className="pt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowSettingsModal(false)}
                  className="flex-1 py-3 bg-gray-100 text-gray-700 font-semibold rounded-xl text-xs hover:bg-gray-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingSettings}
                  className="flex-1 py-3 bg-[#0071E3] hover:bg-[#005bb5] text-white font-bold rounded-xl text-xs flex items-center justify-center gap-1.5 shadow-md active:scale-95"
                >
                  <Check className="w-4 h-4" />
                  <span>{savingSettings ? 'Saving…' : 'Save Rules'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
