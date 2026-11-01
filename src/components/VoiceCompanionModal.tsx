import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Mic, MicOff, Volume2, VolumeX, Sparkles, AlertOctagon, 
  X, RefreshCw, MessageSquare, ChevronDown, Activity, Heart, ShieldAlert
} from 'lucide-react';
import { PatientProfile, Caregiver, Medicine } from '../types';
import { soundManager } from '../utils/audio';
import { hybridSttProvider } from '../utils/speech';
import { 
  startVoiceSessionApi, sendVoiceMessageApi, endVoiceSessionApi,
  VoiceSessionStartResponse, VoiceSessionMessageResponse
} from '../utils/aiClient';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  patientProfile: PatientProfile;
  caregivers?: Caregiver[];
  medicines?: Medicine[];
  language?: string;
  onTriggerSOS?: () => void;
}

type CompanionState = 'IDLE' | 'LISTENING' | 'THINKING' | 'SPEAKING';

interface ConversationTurn {
  id: string;
  sender: 'ai' | 'patient';
  text: string;
  time: string;
  engine?: string;
  isEmergency?: boolean;
}

export function VoiceCompanionModal({
  isOpen,
  onClose,
  patientProfile,
  caregivers = [],
  medicines = [],
  language = 'en',
  onTriggerSOS,
}: Props) {
  const [companionState, setCompanionState] = useState<CompanionState>('IDLE');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [currentTranscript, setCurrentTranscript] = useState<string>('');
  const [turns, setTurns] = useState<ConversationTurn[]>([]);
  const [isPaused, setIsPaused] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [emergencyDetected, setEmergencyDetected] = useState(false);

  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
  const currentLang = patientProfile.preferred_language || language || 'en';

  // Initialize session when modal opens
  useEffect(() => {
    if (isOpen) {
      setEmergencyDetected(false);
      setTurns([]);
      setCurrentTranscript('');
      setIsPaused(false);
      startNewSession();
    } else {
      cleanup();
    }
    return () => {
      cleanup();
    };
  }, [isOpen]);

  const cleanup = () => {
    stopCurrentAudio();
    hybridSttProvider.stopListening();
    if (sessionId) {
      endVoiceSessionApi(sessionId).catch(() => {});
    }
  };

  const stopCurrentAudio = () => {
    if (audioPlayerRef.current) {
      audioPlayerRef.current.pause();
      audioPlayerRef.current = null;
    }
  };

  const playAudio = (audioBase64?: string, onComplete?: () => void) => {
    stopCurrentAudio();
    if (!audioBase64) {
      onComplete?.();
      return;
    }

    try {
      const audio = new Audio(audioBase64);
      audioPlayerRef.current = audio;
      setCompanionState('SPEAKING');

      audio.onended = () => {
        setCompanionState('IDLE');
        onComplete?.();
      };
      audio.onerror = () => {
        setCompanionState('IDLE');
        onComplete?.();
      };
      audio.play().catch(() => {
        setCompanionState('IDLE');
        onComplete?.();
      });
    } catch {
      setCompanionState('IDLE');
      onComplete?.();
    }
  };

  const startNewSession = async () => {
    setCompanionState('THINKING');
    try {
      const res: VoiceSessionStartResponse = await startVoiceSessionApi(
        patientProfile.phone || 'guest',
        currentLang,
        patientProfile
      );

      setSessionId(res.session_id);
      const greetingTurn: ConversationTurn = {
        id: `turn-${Date.now()}`,
        sender: 'ai',
        text: res.greeting_text,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        engine: res.engine_used,
      };
      setTurns([greetingTurn]);

      // Play audio then start listening automatically
      if (res.audio_base64) {
        playAudio(res.audio_base64, () => {
          activateListening(res.session_id);
        });
      } else {
        setTimeout(() => {
          activateListening(res.session_id);
        }, 1500);
      }
    } catch (err) {
      console.error('Failed to start voice companion session:', err);
      setCompanionState('IDLE');
    }
  };

  const activateListening = (activeSessionId?: string | null) => {
    if (isPaused) return;
    const targetSession = activeSessionId || sessionId;
    if (!targetSession) return;

    setCompanionState('LISTENING');
    setCurrentTranscript('');

    hybridSttProvider.startListening({
      lang: currentLang,
      onStart: () => setCompanionState('LISTENING'),
      onResult: (transcript, isFinal) => {
        setCurrentTranscript(transcript);
        if (isFinal && transcript.trim().length > 1) {
          hybridSttProvider.stopListening();
          handleSendMessage(targetSession, transcript.trim());
        }
      },
      onError: (err) => {
        console.warn('STT note:', err);
        setCompanionState('IDLE');
      },
      onEnd: () => {
        // If not thinking or speaking, reset to idle
        setCompanionState((prev) => (prev === 'LISTENING' ? 'IDLE' : prev));
      },
    });
  };

  const handleSendMessage = async (activeSessionId: string, text: string) => {
    setCompanionState('THINKING');
    soundManager.playClick();

    // Append user turn
    const userTurn: ConversationTurn = {
      id: `turn-u-${Date.now()}`,
      sender: 'patient',
      text,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    setTurns((prev) => [...prev, userTurn]);
    setCurrentTranscript('');

    try {
      const res: VoiceSessionMessageResponse = await sendVoiceMessageApi({
        session_id: activeSessionId,
        user_text: text,
        language: currentLang,
        patient_profile: patientProfile,
        medicines: medicines,
        caregivers: caregivers,
      });

      const aiTurn: ConversationTurn = {
        id: `turn-ai-${Date.now()}`,
        sender: 'ai',
        text: res.response_text,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        engine: res.engine_used,
        isEmergency: res.is_emergency,
      };
      setTurns((prev) => [...prev, aiTurn]);

      if (res.is_emergency || res.suggest_sos) {
        setEmergencyDetected(true);
        soundManager.playAlarmBeep();
      }

      // Speak response then seamlessly restart microphone loop!
      if (res.audio_base64) {
        playAudio(res.audio_base64, () => {
          // If not paused, listen again for the patient's next question!
          if (!isPaused) {
            activateListening(activeSessionId);
          }
        });
      } else {
        setTimeout(() => {
          if (!isPaused) {
            activateListening(activeSessionId);
          }
        }, 2000);
      }
    } catch (err) {
      console.error('Failed to get voice reply:', err);
      setCompanionState('IDLE');
    }
  };

  const handleToggleListening = () => {
    if (companionState === 'LISTENING') {
      hybridSttProvider.stopListening();
      setCompanionState('IDLE');
      setIsPaused(true);
    } else {
      setIsPaused(false);
      stopCurrentAudio();
      activateListening(sessionId);
    }
  };

  const handleStopSpeaking = () => {
    stopCurrentAudio();
    setCompanionState('IDLE');
  };

  const latestAiTurn = [...turns].reverse().find((t) => t.sender === 'ai');

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md">
      <motion.div
        initial={{ scale: 0.92, opacity: 0, y: 15 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.92, opacity: 0, y: 15 }}
        className="w-full max-w-lg bg-white rounded-3xl shadow-2xl overflow-hidden border border-blue-100 flex flex-col max-h-[92vh]"
      >
        {/* Top Header */}
        <div className="bg-gradient-to-r from-blue-700 via-indigo-700 to-sky-700 text-white px-5 py-4 flex items-center justify-between shadow-md shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-white/20 flex items-center justify-center border border-white/20 text-white">
              <Sparkles className="w-5 h-5 text-blue-200" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <h2 className="text-lg font-bold tracking-tight">SmartMed Voice Companion</h2>
                <span className="text-[10px] bg-blue-400/30 text-blue-100 font-bold px-2 py-0.5 rounded-full">
                  AI
                </span>
              </div>
              <p className="text-xs text-blue-100 font-medium">Continuous Two-Way Medical Consultation</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 flex-1 flex flex-col overflow-y-auto">
          {/* Emergency Alert Banner if Emergency Symptoms Detected */}
          <AnimatePresence>
            {emergencyDetected && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="mb-4 p-4 rounded-2xl bg-red-600 text-white shadow-lg flex items-center justify-between gap-3 animate-pulse"
              >
                <div className="flex items-center gap-2.5">
                  <ShieldAlert className="w-6 h-6 text-yellow-300 shrink-0" />
                  <div>
                    <h4 className="font-extrabold text-xs uppercase tracking-wider text-yellow-200">
                      Emergency Alert Triggered
                    </h4>
                    <p className="text-xs text-red-50 mt-0.5">Critical symptoms detected in consultation.</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    cleanup();
                    onTriggerSOS?.();
                  }}
                  className="px-3.5 py-2 rounded-xl bg-yellow-400 text-gray-950 font-black text-xs shadow-md active:scale-95 transition-all shrink-0"
                >
                  ACTIVATE SOS
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Central Animated Visual State Sphere */}
          <div className="flex flex-col items-center justify-center py-6 shrink-0">
            <div className="relative flex items-center justify-center">
              {/* Concentric ripple waves when listening or speaking */}
              {(companionState === 'LISTENING' || companionState === 'SPEAKING') && (
                <>
                  <span
                    className={`absolute w-36 h-36 rounded-full opacity-30 animate-ping ${
                      companionState === 'LISTENING' ? 'bg-blue-400' : 'bg-emerald-400'
                    }`}
                  />
                  <span
                    className={`absolute w-48 h-48 rounded-full opacity-20 animate-pulse ${
                      companionState === 'LISTENING' ? 'bg-indigo-300' : 'bg-teal-300'
                    }`}
                  />
                </>
              )}

              {/* Main Interactive AI Orb Button */}
              <button
                type="button"
                onClick={handleToggleListening}
                className={`w-28 h-28 rounded-full flex flex-col items-center justify-center text-white shadow-xl transition-all duration-300 active:scale-95 z-10 ${
                  companionState === 'LISTENING'
                    ? 'bg-gradient-to-tr from-blue-600 to-indigo-600 shadow-blue-500/40 ring-4 ring-blue-300'
                    : companionState === 'SPEAKING'
                    ? 'bg-gradient-to-tr from-emerald-600 to-teal-600 shadow-emerald-500/40 ring-4 ring-emerald-300'
                    : companionState === 'THINKING'
                    ? 'bg-gradient-to-tr from-amber-500 to-orange-600 shadow-amber-500/40 animate-spin'
                    : 'bg-gradient-to-tr from-slate-700 to-slate-900 shadow-slate-900/30'
                }`}
                title="Tap to pause or resume listening"
              >
                {companionState === 'LISTENING' ? (
                  <>
                    <Mic className="w-10 h-10 animate-bounce" />
                    <span className="text-[10px] font-extrabold uppercase mt-1 tracking-wider">Listening</span>
                  </>
                ) : companionState === 'SPEAKING' ? (
                  <>
                    <Volume2 className="w-10 h-10 animate-pulse" />
                    <span className="text-[10px] font-extrabold uppercase mt-1 tracking-wider">Speaking</span>
                  </>
                ) : companionState === 'THINKING' ? (
                  <>
                    <RefreshCw className="w-9 h-9" />
                    <span className="text-[10px] font-extrabold uppercase mt-1 tracking-wider">Thinking</span>
                  </>
                ) : (
                  <>
                    <MicOff className="w-9 h-9 opacity-80" />
                    <span className="text-[10px] font-bold uppercase mt-1 tracking-wider">Paused</span>
                  </>
                )}
              </button>
            </div>

            {/* State Status Description */}
            <div className="mt-5 text-center">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
                {companionState === 'LISTENING' && 'Listening to your voice... Speak naturally'}
                {companionState === 'SPEAKING' && 'SmartMed is speaking (Kokoro TTS)'}
                {companionState === 'THINKING' && 'Analyzing medical clinical context...'}
                {companionState === 'IDLE' && 'Microphone paused • Tap button to resume conversation'}
              </span>
            </div>
          </div>

          {/* Live Transcript / Response Card */}
          <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 shadow-inner flex-1 min-h-[120px] flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between text-xs text-slate-500 font-bold uppercase mb-2">
                <span>{companionState === 'LISTENING' ? 'Live Speech' : 'Latest Medical Advice'}</span>
                {latestAiTurn?.engine && (
                  <span className="text-[10px] text-blue-600 font-semibold bg-blue-100/60 px-2 py-0.5 rounded-full">
                    Engine: {latestAiTurn.engine}
                  </span>
                )}
              </div>

              {companionState === 'LISTENING' ? (
                <p className="text-base font-semibold text-blue-900 italic">
                  {currentTranscript ? `"${currentTranscript}"` : 'Listening for your question...'}
                </p>
              ) : (
                <p className="text-sm font-medium text-slate-800 leading-relaxed">
                  {latestAiTurn?.text || 'Hello! How can I assist you with your health and medications today?'}
                </p>
              )}
            </div>

            {/* Controls Bar */}
            <div className="mt-3 pt-3 border-t border-slate-200 flex items-center justify-between">
              {companionState === 'SPEAKING' ? (
                <button
                  type="button"
                  onClick={handleStopSpeaking}
                  className="text-xs text-red-600 font-bold hover:underline flex items-center gap-1"
                >
                  <VolumeX className="w-3.5 h-3.5" />
                  <span>Stop Speaking</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleToggleListening}
                  className="text-xs text-blue-600 font-bold hover:underline flex items-center gap-1"
                >
                  <Mic className="w-3.5 h-3.5" />
                  <span>{companionState === 'LISTENING' ? 'Pause Mic' : 'Resume Mic'}</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => setShowHistory(!showHistory)}
                className="text-xs text-slate-600 font-semibold flex items-center gap-1 hover:text-slate-900"
              >
                <MessageSquare className="w-3.5 h-3.5" />
                <span>Transcript ({turns.length})</span>
                <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showHistory ? 'rotate-180' : ''}`} />
              </button>
            </div>
          </div>

          {/* Expandable Conversation Transcript Log */}
          <AnimatePresence>
            {showHistory && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 160 }}
                exit={{ opacity: 0, height: 0 }}
                className="mt-3 p-3 bg-white rounded-2xl border border-slate-200 overflow-y-auto space-y-2 text-xs"
              >
                {turns.map((t) => (
                  <div
                    key={t.id}
                    className={`p-2 rounded-xl ${
                      t.sender === 'patient'
                        ? 'bg-blue-50 text-blue-950 ml-4 border border-blue-100'
                        : 'bg-slate-100 text-slate-900 mr-4 border border-slate-200'
                    }`}
                  >
                    <div className="flex items-center justify-between font-bold text-[10px] text-slate-500 mb-0.5">
                      <span>{t.sender === 'patient' ? 'You' : 'SmartMed AI'}</span>
                      <span>{t.time}</span>
                    </div>
                    <p className="leading-snug">{t.text}</p>
                  </div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Action Footer */}
          <div className="mt-5 grid grid-cols-2 gap-3 shrink-0">
            <button
              type="button"
              onClick={() => {
                cleanup();
                onTriggerSOS?.();
              }}
              className="py-3 px-4 rounded-xl bg-red-50 hover:bg-red-100 active:scale-95 text-red-600 font-bold text-xs flex items-center justify-center gap-1.5 border border-red-200 transition-all"
            >
              <AlertOctagon className="w-4 h-4 text-red-600" />
              <span>Emergency SOS</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="py-3 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 active:scale-95 text-slate-700 font-bold text-xs flex items-center justify-center transition-all"
            >
              End Conversation
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
