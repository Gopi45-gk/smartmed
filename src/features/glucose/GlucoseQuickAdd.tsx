import { useState, useRef } from 'react';
import { GlucoseReading, GlucoseContext, GlucoseUnit, GlucoseSource } from './types';
import { glucoseStorage } from './glucoseStorage';
import { parseVoiceGlucoseUtterance, ParsedVoiceGlucose } from './voiceParser';
import { sttProvider, ttsProvider } from '../../utils/speech';
import { soundManager } from '../../utils/audio';
import { Plus, Mic, MicOff, Check, AlertCircle, Sparkles, RefreshCw, Volume2 } from 'lucide-react';
import confetti from 'canvas-confetti';

interface Props {
  patientId: string;
  lang?: string;
  onAdded: (reading: GlucoseReading) => void;
}

export function GlucoseQuickAdd({ patientId, lang = 'en', onAdded }: Props) {
  const [valueStr, setValueStr] = useState<string>('');
  const [unit, setUnit] = useState<GlucoseUnit>('mg/dL');
  const [context, setContext] = useState<GlucoseContext>('fasting');
  const [measuredAt, setMeasuredAt] = useState<string>(() => new Date().toISOString().slice(0, 16));
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<{ text: string; isError?: boolean } | null>(null);

  // Voice state
  const [isListening, setIsListening] = useState<boolean>(false);
  const [voiceParsed, setVoiceParsed] = useState<ParsedVoiceGlucose | null>(null);
  const [showVoiceConfirmModal, setShowVoiceConfirmModal] = useState<boolean>(false);

  const contextOptions: { id: GlucoseContext; label: string; icon: string }[] = [
    { id: 'fasting', label: 'Fasting', icon: '🌅' },
    { id: 'before_meal', label: 'Before Meal', icon: '🥗' },
    { id: 'after_meal', label: 'After Meal', icon: '🍽️' },
    { id: 'bedtime', label: 'Bedtime', icon: '🌙' },
    { id: 'random', label: 'Random', icon: '⏱️' },
  ];

  // Quick preset buttons for common numbers
  const presetValues = [95, 110, 130, 150, 180, 210];

  const handleSaveReading = async (
    customVal?: number,
    customUnit?: GlucoseUnit,
    customContext?: GlucoseContext,
    customSource: GlucoseSource = 'manual'
  ) => {
    const rawNum = customVal !== undefined ? customVal : parseFloat(valueStr);
    const useUnit = customUnit || unit;
    const useContext = customContext || context;

    if (isNaN(rawNum) || rawNum <= 0) {
      setStatusMessage({ text: 'Please enter a valid glucose number', isError: true });
      soundManager.playError();
      return;
    }

    const value_mgdl = useUnit === 'mmol/L' ? Math.round(rawNum * 18.016) : Math.round(rawNum);

    if (value_mgdl < 20 || value_mgdl > 800) {
      setStatusMessage({
        text: `Value ${value_mgdl} mg/dL is out of plausible physiological range (20–800 mg/dL). Please verify.`,
        isError: true,
      });
      soundManager.playError();
      return;
    }

    setIsSubmitting(true);
    setStatusMessage(null);

    const reading: GlucoseReading = {
      id: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `gluc_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      patientId: patientId || 'default',
      value_mgdl,
      unit_entered: useUnit,
      context: useContext,
      measuredAt: new Date(measuredAt).toISOString(),
      source: customSource,
      createdAt: new Date().toISOString(),
      syncedAt: null,
    };

    try {
      const alertResult = await glucoseStorage.saveReadingLocally(reading);
      soundManager.playSuccessChime();
      confetti({ particleCount: 30, spread: 50, origin: { y: 0.6 } });

      if (alertResult.hasCriticalAlert && alertResult.alert) {
        setStatusMessage({
          text: `⚠️ CRITICAL: ${alertResult.alert.message}`,
          isError: true,
        });
        soundManager.playError();
      } else {
        setStatusMessage({
          text: `✓ Saved ${value_mgdl} mg/dL (${useContext.replace('_', ' ')}). Saved locally and queued for sync.`,
        });
      }

      setValueStr('');
      onAdded(reading);
    } catch (err: any) {
      setStatusMessage({ text: `Failed to save: ${err.message}`, isError: true });
      soundManager.playError();
    } finally {
      setIsSubmitting(false);
      setTimeout(() => {
        setStatusMessage((curr) => (curr?.isError ? curr : null));
      }, 5000);
    }
  };

  // Voice recording handler
  const handleStartVoice = () => {
    if (isListening) {
      sttProvider.stopListening();
      setIsListening(false);
      return;
    }

    if (!sttProvider.isSupported()) {
      setStatusMessage({ text: 'Speech recognition is not supported in this browser.', isError: true });
      return;
    }

    setIsListening(true);
    setStatusMessage({ text: 'Listening... Say e.g. "Sugar 140" or "Fasting sugar 110"' });

    sttProvider.startListening({
      lang: lang || 'en',
      onResult: (transcript: string, isFinal: boolean) => {
        if (isFinal && transcript.trim()) {
          setIsListening(false);
          const parsed = parseVoiceGlucoseUtterance(transcript, lang);
          setVoiceParsed(parsed);
          setShowVoiceConfirmModal(true);

          // Prompt via TTS for senior friendliness
          if (parsed.isValid && parsed.isPlausible && parsed.confirmationPrompt) {
            ttsProvider.speak(parsed.confirmationPrompt, { lang });
          } else if (parsed.clarificationMessage) {
            ttsProvider.speak(parsed.clarificationMessage, { lang });
          }
        }
      },
      onError: (err) => {
        setIsListening(false);
        setStatusMessage({ text: `Voice input error: ${err}`, isError: true });
      },
      onEnd: () => {
        setIsListening(false);
      },
    });
  };

  const handleConfirmVoice = () => {
    if (!voiceParsed || !voiceParsed.value_mgdl) return;
    handleSaveReading(voiceParsed.value_mgdl, voiceParsed.unit, voiceParsed.context, 'voice');
    setShowVoiceConfirmModal(false);
    setVoiceParsed(null);
  };

  return (
    <div className="bg-white rounded-3xl p-5 shadow-sm border border-gray-100/90 relative">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-bold text-base text-[#1D1D1F] tracking-tight">Log Blood Sugar</h3>
          <p className="text-xs text-[#86868B] mt-0.5">Offline-first • Stored securely on this device</p>
        </div>

        {/* Voice Input Trigger Button */}
        <button
          type="button"
          onClick={handleStartVoice}
          className={`px-3.5 py-2 rounded-2xl text-xs font-bold flex items-center gap-1.5 shadow-sm active:scale-95 transition-all ${
            isListening
              ? 'bg-rose-500 text-white animate-pulse'
              : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200/80'
          }`}
          title="Log by speaking (English, Hindi, Tamil, Telugu)"
        >
          {isListening ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
          <span>{isListening ? 'Listening…' : 'Voice Log'}</span>
        </button>
      </div>

      {/* Main Big Number Input */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <input
            type="number"
            step={unit === 'mmol/L' ? '0.1' : '1'}
            placeholder={unit === 'mmol/L' ? 'e.g. 7.5' : 'e.g. 135'}
            value={valueStr}
            onChange={(e) => setValueStr(e.target.value)}
            className="w-full text-3xl font-extrabold text-[#1D1D1F] bg-[#F5F5F7] px-4 py-3 rounded-2xl border border-gray-200 focus:outline-none focus:border-[#0071E3] focus:bg-white transition-all text-center placeholder:text-gray-300"
          />
        </div>

        {/* Unit Selector Toggle */}
        <div className="flex flex-col bg-gray-100 p-1 rounded-2xl border border-gray-200/80">
          <button
            type="button"
            onClick={() => setUnit('mg/dL')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
              unit === 'mg/dL' ? 'bg-[#0071E3] text-white shadow-xs' : 'text-gray-600 hover:text-black'
            }`}
          >
            mg/dL
          </button>
          <button
            type="button"
            onClick={() => setUnit('mmol/L')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
              unit === 'mmol/L' ? 'bg-[#0071E3] text-white shadow-xs' : 'text-gray-600 hover:text-black'
            }`}
          >
            mmol/L
          </button>
        </div>
      </div>

      {/* Quick Tap Presets */}
      <div className="mt-3 flex items-center gap-1.5 overflow-x-auto pb-1">
        <span className="text-[10px] uppercase font-bold text-gray-400 shrink-0 mr-1">Quick:</span>
        {presetValues.map((val) => (
          <button
            key={val}
            type="button"
            onClick={() => setValueStr(val.toString())}
            className="px-2.5 py-1 bg-gray-50 hover:bg-gray-100 text-gray-700 text-xs font-semibold rounded-lg border border-gray-200/80 active:scale-95 transition-all"
          >
            {val}
          </button>
        ))}
      </div>

      {/* Context Chips (Fasting, Before meal, After meal, Bedtime, Random) */}
      <div className="mt-4">
        <label className="text-[11px] uppercase font-bold text-gray-500 mb-1.5 block">
          Measurement Timing Context
        </label>
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5">
          {contextOptions.map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => setContext(opt.id)}
              className={`py-2 px-2 rounded-xl text-xs font-bold flex flex-col items-center justify-center gap-0.5 border transition-all active:scale-95 ${
                context === opt.id
                  ? 'bg-blue-50 border-[#0071E3] text-[#0071E3] shadow-xs'
                  : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
            >
              <span className="text-sm">{opt.icon}</span>
              <span className="text-[11px]">{opt.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Timestamp selector (defaults to current) */}
      <div className="mt-3 flex items-center justify-between text-xs text-gray-500">
        <span>Recorded Time:</span>
        <input
          type="datetime-local"
          value={measuredAt}
          onChange={(e) => setMeasuredAt(e.target.value)}
          className="text-xs bg-[#F5F5F7] border border-gray-200 rounded-lg px-2 py-1 text-gray-700 font-medium"
        />
      </div>

      {/* Status or Alert Notification */}
      {statusMessage && (
        <div
          className={`mt-3 p-3 rounded-2xl text-xs font-semibold flex items-center gap-2 ${
            statusMessage.isError
              ? 'bg-rose-50 text-rose-800 border border-rose-200'
              : 'bg-emerald-50 text-emerald-800 border border-emerald-200'
          }`}
        >
          {statusMessage.isError ? (
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
          ) : (
            <Check className="w-4 h-4 shrink-0 text-emerald-600" />
          )}
          <span>{statusMessage.text}</span>
        </div>
      )}

      {/* Big Action Submit Button */}
      <button
        type="button"
        disabled={isSubmitting || !valueStr}
        onClick={() => handleSaveReading()}
        className="w-full mt-4 py-3.5 bg-[#0071E3] hover:bg-[#005bb5] disabled:opacity-50 text-white font-bold rounded-2xl text-sm shadow-md active:scale-98 transition-all flex items-center justify-center gap-2"
      >
        <Plus className="w-4 h-4" />
        <span>{isSubmitting ? 'Saving Reading…' : 'Save Blood Sugar Reading'}</span>
      </button>

      {/* Voice Confirmation Modal */}
      {showVoiceConfirmModal && voiceParsed && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 w-full max-w-sm shadow-2xl space-y-4 border border-gray-100">
            <div className="flex items-center gap-2.5">
              <div className="w-10 h-10 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
                <Volume2 className="w-5 h-5 animate-pulse" />
              </div>
              <div>
                <h4 className="font-bold text-base text-[#1D1D1F]">Voice Confirmation</h4>
                <p className="text-xs text-gray-500">Heard: &quot;{voiceParsed.rawTranscript}&quot;</p>
              </div>
            </div>

            {voiceParsed.isPlausible && voiceParsed.value_mgdl ? (
              <div className="bg-blue-50 border border-blue-200/80 rounded-2xl p-4 text-center">
                <div className="text-3xl font-black text-[#0071E3]">
                  {voiceParsed.value_mgdl} <span className="text-sm font-bold">mg/dL</span>
                </div>
                <div className="text-xs font-semibold text-blue-800 capitalize mt-1">
                  Context: {voiceParsed.context.replace('_', ' ')}
                </div>
                <p className="text-xs text-slate-700 mt-2 font-medium">
                  {voiceParsed.confirmationPrompt}
                </p>
              </div>
            ) : (
              <div className="bg-rose-50 border border-rose-200 rounded-2xl p-3 text-xs text-rose-800">
                {voiceParsed.clarificationMessage || 'Unable to detect a plausible blood sugar value.'}
              </div>
            )}

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  setShowVoiceConfirmModal(false);
                  setVoiceParsed(null);
                }}
                className="flex-1 py-3 bg-gray-100 text-gray-700 font-semibold rounded-xl text-xs hover:bg-gray-200 transition-colors"
              >
                Cancel / Re-speak
              </button>
              {voiceParsed.isPlausible && (
                <button
                  type="button"
                  onClick={handleConfirmVoice}
                  className="flex-1 py-3 bg-[#0071E3] text-white font-bold rounded-xl text-xs shadow-md active:scale-95 transition-all flex items-center justify-center gap-1.5"
                >
                  <Check className="w-4 h-4" />
                  <span>Confirm & Save</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
