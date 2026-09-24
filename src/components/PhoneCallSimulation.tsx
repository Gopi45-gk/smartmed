import { useState, useEffect, useRef, useCallback } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { motion } from 'motion/react';
import { Medicine, TranslationStrings, Language } from '../types';
import { Phone, PhoneOff, Mic, MicOff, CheckCircle, Volume2, ShieldCheck, Clock, Sparkles, AlertCircle } from 'lucide-react';
import { soundManager } from '../utils/audio';
import { sttProvider, ttsProvider } from '../utils/speech';
import {
  sendVoiceMessageToLocalAI,
  isAIServerReachable,
  appendTurnToSharedHistory,
  loadConversationHistory,
  type AIMessage,
} from '../utils/aiClient';
import confetti from 'canvas-confetti';

interface Props {
  close: () => void;
  medicines: Medicine[];
  setMedicines: Dispatch<SetStateAction<Medicine[]>>;
  t: TranslationStrings;
  lang: Language;
}

type CallState = 'incoming' | 'connected' | 'responded';
type VoiceState = 'idle' | 'listening' | 'processing' | 'speaking' | 'error';

export function PhoneCallSimulation({ close, medicines, setMedicines, t, lang }: Props) {
  const [callState, setCallState] = useState<CallState>('connected');
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [aiMessage, setAiMessage] = useState<string>(t.aiSpeakingPrompt);
  const [patientReply, setPatientReply] = useState<string>('');
  const [aiAvailable, setAiAvailable] = useState<boolean | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [transcriptInterim, setTranscriptInterim] = useState<string>('');

  const isComponentMounted = useRef<boolean>(true);
  const conversationHistoryRef = useRef<AIMessage[]>([]);

  // ─── Speak AI Response via TTS ──────────────────────────────────────────────
  const speakAIResponse = useCallback((text: string, onDone?: () => void) => {
    if (!isComponentMounted.current) return;
    setVoiceState('speaking');

    ttsProvider.speak(text, {
      lang,
      rate: 1.0,
      pitch: 1.0,
      onStart: () => {
        if (isComponentMounted.current) setVoiceState('speaking');
      },
      onEnd: () => {
        if (!isComponentMounted.current) return;
        setVoiceState('idle');
        onDone?.();
      },
      onError: (err) => {
        console.warn('[PhoneCallSimulation] Speech error:', err);
        if (!isComponentMounted.current) return;
        setVoiceState('idle');
        onDone?.();
      },
    });
  }, [lang]);

  // Track component mounted state and trigger greeting immediately
  useEffect(() => {
    isComponentMounted.current = true;
    conversationHistoryRef.current = loadConversationHistory();

    // Check if local AI server is active
    isAIServerReachable().then(reachable => {
      if (isComponentMounted.current) {
        setAiAvailable(reachable);
      }
    });

    // Speak initial AI greeting prompt directly in user's interaction window
    const greeting = t.aiSpeakingPrompt.replace(/"/g, '');
    setAiMessage(t.aiSpeakingPrompt);

    const greetTimer = setTimeout(() => {
      speakAIResponse(greeting, () => {
        // After greeting finishes, automatically open microphone to listen!
        if (isComponentMounted.current) {
          startListening();
        }
      });
    }, 120);

    return () => {
      isComponentMounted.current = false;
      clearTimeout(greetTimer);
      sttProvider.stopListening();
      ttsProvider.stop();
      soundManager.stopRinging();
    };
  }, []);

  // ─── Start Microphone Listening (STT) ──────────────────────────────────────
  const startListening = useCallback(() => {
    if (!isComponentMounted.current) return;
    ttsProvider.stop();
    setErrorMessage(null);
    setTranscriptInterim('');
    setVoiceState('listening');

    if (!sttProvider.isSupported()) {
      setErrorMessage('Browser microphone not supported. Please use the quick response buttons.');
      setVoiceState('idle');
      return;
    }

    sttProvider.startListening({
      lang,
      onStart: () => {
        if (isComponentMounted.current) setVoiceState('listening');
      },
      onResult: (text: string, isFinal: boolean) => {
        if (!isComponentMounted.current) return;
        setTranscriptInterim(text);

        if (isFinal && text.trim()) {
          sttProvider.stopListening();
          handleUserVoiceInput(text.trim());
        }
      },
      onError: (err: string) => {
        if (!isComponentMounted.current) return;
        setVoiceState('idle');
        // If benign no-speech or network/offline transition, keep UI clean
        if (!err.includes('No speech') && !err.includes('network') && !err.includes('aborted')) {
          setErrorMessage(err);
        }
      },
      onEnd: () => {
        if (!isComponentMounted.current) return;
        // If transcript was captured but wasn't marked final, process it
        setTranscriptInterim(current => {
          if (current.trim()) {
            handleUserVoiceInput(current.trim());
          } else {
            setVoiceState(prev => prev === 'listening' ? 'idle' : prev);
          }
          return '';
        });
      },
    });
  }, [lang]);

  // ─── Process User Voice Input (MNN Pipeline) ──────────────────────────────
  const handleUserVoiceInput = async (spokenText: string) => {
    if (!spokenText.trim() || !isComponentMounted.current) return;

    setPatientReply(spokenText);
    setTranscriptInterim('');
    setVoiceState('processing');

    const lower = spokenText.toLowerCase();

    // Check if user confirmed taking medicine (multilingual support: en, ta, hi, te, ur, ml, kn)
    const isTakenIntent = (
      lower.includes('took') ||
      lower.includes('already taken') ||
      lower.includes('had my') ||
      lower.includes('finished') ||
      lower.includes('done') ||
      lower === 'yes' ||
      lower.includes('yes i did') ||
      lower.includes('mark taken') ||
      lower.includes('எடுத்து') ||
      lower.includes('சாப்பிட்') ||
      lower.includes('ஆமாம்') ||
      lower.includes('ஆம்') ||
      lower.includes('மாத்திரை') ||
      lower.includes('ले ली') ||
      lower.includes('खा ली') ||
      lower.includes('हाँ') ||
      lower.includes('दवा') ||
      lower.includes('తీసుకున్నా') ||
      lower.includes('వేసుకున్నా') ||
      lower.includes('అవును') ||
      lower.includes('لے لی') ||
      lower.includes('جی ہاں') ||
      lower.includes('കഴിച്ചു') ||
      lower.includes('ഉവ്വ്') ||
      lower.includes('ತಗೊಂಡೆ') ||
      lower.includes('ಹೌದು')
    );

    // Check if user requested reminder snooze (multilingual support)
    const isSnoozeIntent = (
      lower.includes('remind') ||
      lower.includes('15 min') ||
      lower.includes('later') ||
      lower.includes('snooze') ||
      lower.includes('not yet') ||
      lower.includes('not now') ||
      lower.includes('பிறகு') ||
      lower.includes('நினைவூட்டு') ||
      lower.includes('இல்லை') ||
      lower.includes('அப்புறம்') ||
      lower.includes('बाद में') ||
      lower.includes('याद') ||
      lower.includes('नहीं') ||
      lower.includes('తర్వాత') ||
      lower.includes('గుర్తు') ||
      lower.includes('వద్దు') ||
      lower.includes('بعد میں') ||
      lower.includes('یاد') ||
      lower.includes('نہیں') ||
      lower.includes('പിന്നെ') ||
      lower.includes('ഓർമ്മി') ||
      lower.includes('ಆಮೇಲೆ') ||
      lower.includes('ನೆನ')
    );

    if (isTakenIntent) {
      handleMarkMedicineTaken();
    }

    try {
      // Send to local MNN AI backend (/api/ai/voice) with user-selected language
      const medicinesContext = medicines.map(m => ({
        name: m.name,
        time: m.time,
        dose: m.dose,
        food: m.food,
        status: m.status,
      }));

      const result = await sendVoiceMessageToLocalAI(
        spokenText,
        conversationHistoryRef.current,
        medicinesContext,
        'Mr. Ravi',
        lang
      );

      if (!isComponentMounted.current) return;

      if (result.success && result.response) {
        setAiAvailable(true);
        setAiMessage(result.response);

        // Save to shared conversational memory
        appendTurnToSharedHistory(spokenText, result.response);
        conversationHistoryRef.current.push(
          { role: 'user', content: spokenText },
          { role: 'assistant', content: result.response }
        );

        // Speak the MNN response
        speakAIResponse(result.response, () => {
          // Continuous multi-turn conversation: automatically listen for follow-up
          if (isComponentMounted.current && callState === 'connected' && !isTakenIntent && !isSnoozeIntent) {
            startListening();
          }
        });
      } else {
        // Local AI returned an error or is offline
        const offlineMsg = "Local AI is currently offline. Please ensure 'python server.py' is running in the ai/ directory.";
        setAiMessage(offlineMsg);
        setAiAvailable(false);
        speakAIResponse("Local AI is currently offline. Please ensure the AI server is running.");
      }
    } catch {
      if (!isComponentMounted.current) return;
      const offlineMsg = "Cannot connect to local AI. Please start 'python server.py' in the ai/ directory.";
      setAiMessage(offlineMsg);
      setAiAvailable(false);
      speakAIResponse("Cannot connect to local AI. Please start the AI server.");
    }
  };

  // ─── Mark Medicine Taken Logic ─────────────────────────────────────────────
  const handleMarkMedicineTaken = () => {
    soundManager.playSuccessChime();
    confetti({ particleCount: 50, spread: 70, origin: { y: 0.5 } });
    const nowStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    setMedicines(prev => prev.map(m => {
      if (m.status === 'upcoming') {
        return { ...m, status: 'taken', takenAt: nowStr };
      }
      return m;
    }));
  };

  // ─── Answer Incoming Call ──────────────────────────────────────────────────
  const handleAnswerCall = () => {
    soundManager.stopRinging();
    setCallState('connected');
    ttsProvider.unlock();
    soundManager.resumeAudioContext();
    const greeting = t.aiSpeakingPrompt.replace(/"/g, '');
    setAiMessage(t.aiSpeakingPrompt);
    speakAIResponse(greeting, () => {
      if (isComponentMounted.current) {
        startListening();
      }
    });
  };

  // ─── End Call (Interrupt & Reset) ──────────────────────────────────────────
  const handleEndCall = () => {
    sttProvider.stopListening();
    ttsProvider.stop();
    soundManager.stopRinging();
    close();
  };

  // ─── Mic Center Button Click (Toggle Listening / Interrupt) ────────────────
  const handleMicClick = () => {
    ttsProvider.unlock();
    soundManager.resumeAudioContext();

    if (callState !== 'connected') return;

    if (voiceState === 'speaking') {
      // User interrupts AI speech
      ttsProvider.stop();
      startListening();
    } else if (voiceState === 'listening') {
      // Stop listening and process whatever was captured
      sttProvider.stopListening();
    } else {
      // Idle or error: start listening
      startListening();
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0, scale: 0.95 }} 
      animate={{ opacity: 1, scale: 1 }} 
      exit={{ opacity: 0, scale: 0.95 }} 
      className="fixed inset-0 bg-[#121214] text-white flex flex-col justify-between p-6 z-50 overflow-hidden font-sans"
    >
      {/* Top Bar Header */}
      <div className="text-center pt-8">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/10 text-gray-300 text-[11px] font-semibold tracking-wider uppercase backdrop-blur-md">
          <ShieldCheck className="w-3.5 h-3.5 text-blue-400" />
          <span>{t.aiVoiceAssistant}</span>
        </div>

        <h2 className="text-3xl font-extrabold mt-3 tracking-tight">
          {callState === 'incoming' ? t.incomingCall : 'SmartMed AI Care'}
        </h2>

        {/* Dynamic Voice Status Badge */}
        <p className="text-sm mt-1 flex items-center justify-center gap-1.5 font-medium">
          {callState === 'incoming' && (
            <span className="text-amber-400 animate-pulse">{t.connectingCall}</span>
          )}

          {callState === 'connected' && (
            <>
              {voiceState === 'listening' && (
                <span className="text-emerald-400 flex items-center gap-1.5 font-semibold">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping" />
                  Listening... Speak your question
                </span>
              )}
              {voiceState === 'processing' && (
                <span className="text-blue-400 flex items-center gap-1.5 font-semibold">
                  <Sparkles className="w-3.5 h-3.5 animate-spin" />
                  Processing with local MNN AI...
                </span>
              )}
              {voiceState === 'speaking' && (
                <span className="text-emerald-400 flex items-center gap-1.5 font-semibold">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  AI Speaking... (Tap mic to interrupt)
                </span>
              )}
              {voiceState === 'idle' && (
                <span className="text-gray-300 flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-emerald-400" />
                  Connected (Two-Way Voice) • Tap mic to speak
                </span>
              )}
              {voiceState === 'error' && (
                <span className="text-amber-400 flex items-center gap-1">
                  <AlertCircle className="w-3.5 h-3.5" />
                  Microphone idle • Tap mic to retry
                </span>
              )}
            </>
          )}

          {callState === 'responded' && (
            <span className="text-blue-400 font-semibold">{t.statusUpdated}</span>
          )}
        </p>

        {/* Offline local status pill */}
        {callState === 'connected' && (
          <div className="mt-1 flex items-center justify-center">
            {aiAvailable ? (
              <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400 bg-emerald-950/40 px-2.5 py-0.5 rounded-full border border-emerald-500/30">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Local MNN Inference Active (Offline)
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[10px] text-amber-400 bg-amber-950/40 px-2.5 py-0.5 rounded-full border border-amber-500/30">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                Offline AI Unavailable — Basic Mode
              </span>
            )}
          </div>
        )}
      </div>

      {/* Center Phone Visual / Interactive Microphone */}
      <div className="flex flex-col items-center justify-center my-auto space-y-6">
        <div className="relative">
          {/* Animated concentric pulse rings */}
          {(callState === 'incoming' || voiceState === 'listening' || voiceState === 'speaking') && (
            <>
              <motion.div 
                animate={{ scale: [1, 1.6], opacity: [0.6, 0] }}
                transition={{ duration: 1.5, repeat: Infinity, ease: "easeOut" }}
                className={`absolute inset-0 rounded-full ${
                  voiceState === 'listening' ? 'bg-emerald-500/40' : 'bg-[#0071E3]/40'
                }`}
              />
              <motion.div 
                animate={{ scale: [1, 1.9], opacity: [0.4, 0] }}
                transition={{ duration: 1.5, repeat: Infinity, ease: "easeOut", delay: 0.3 }}
                className={`absolute inset-0 rounded-full ${
                  voiceState === 'listening' ? 'bg-emerald-500/20' : 'bg-[#0071E3]/20'
                }`}
              />
            </>
          )}

          {/* Interactive Mic / Phone Action Button */}
          <button
            onClick={handleMicClick}
            disabled={callState !== 'connected'}
            aria-label={voiceState === 'speaking' ? 'Interrupt AI speech' : 'Toggle microphone'}
            className={`w-28 h-28 rounded-full flex items-center justify-center text-4xl shadow-2xl relative z-10 transition-all active:scale-95 ${
              callState === 'connected'
                ? voiceState === 'listening'
                  ? 'bg-gradient-to-tr from-emerald-500 to-teal-400 shadow-emerald-500/50 ring-4 ring-emerald-400/40 animate-pulse'
                  : voiceState === 'speaking'
                  ? 'bg-gradient-to-tr from-[#0071E3] to-[#4299e1] shadow-blue-500/40 ring-4 ring-blue-400/40'
                  : 'bg-gradient-to-tr from-[#0071E3] to-[#4299e1] shadow-blue-500/40 hover:brightness-110'
                : 'bg-gradient-to-tr from-[#0071E3] to-[#4299e1] shadow-blue-500/40'
            }`}
          >
            {callState === 'connected' ? (
              voiceState === 'listening' ? (
                <Mic className="w-12 h-12 text-white animate-pulse" />
              ) : voiceState === 'speaking' ? (
                <Volume2 className="w-12 h-12 text-white animate-bounce" />
              ) : voiceState === 'processing' ? (
                <Sparkles className="w-12 h-12 text-white animate-spin" />
              ) : (
                <Mic className="w-12 h-12 text-white" />
              )
            ) : (
              <Phone className="w-12 h-12 text-white animate-bounce" />
            )}
          </button>
        </div>

        {/* AI Speaking Speech Balloon */}
        <div className="bg-white/10 backdrop-blur-xl border border-white/15 p-5 rounded-3xl w-full max-w-sm text-center shadow-lg">
          <div className="flex items-center justify-center gap-1.5 text-xs text-blue-300 font-bold mb-1.5">
            <Volume2 className={`w-4 h-4 ${voiceState === 'speaking' ? 'animate-bounce text-emerald-400' : ''}`} />
            <span>AI Speaking (Natural Voice):</span>
          </div>

          <p className="text-sm font-medium text-gray-100 leading-relaxed min-h-[40px]">
            {aiMessage}
          </p>

          {/* Audio Waveform visualization (animates only when speaking) */}
          <div className="flex items-center justify-center gap-1 mt-3.5 h-6">
            {[40, 75, 100, 60, 90, 45, 80, 50, 70].map((h, i) => (
              <motion.span
                key={i}
                animate={voiceState === 'speaking' ? { height: [`${h * 0.2}%`, `${h}%`, `${h * 0.3}%`] } : { height: '18%' }}
                transition={{ duration: 0.6, repeat: Infinity, delay: i * 0.08 }}
                className={`w-1 rounded-full transition-all ${
                  voiceState === 'speaking' ? 'bg-[#34C759]' : 'bg-gray-600'
                }`}
                style={{ height: `${voiceState === 'speaking' ? h : 18}%` }}
              />
            ))}
          </div>
        </div>

        {/* Interim / Live Speech Recognition Preview */}
        {transcriptInterim && (
          <div className="bg-blue-500/20 text-blue-200 px-4 py-2 rounded-xl text-xs max-w-sm text-center border border-blue-400/30 animate-pulse">
            <span className="font-semibold text-blue-300">Hearing: </span>
            <span>"{transcriptInterim}"</span>
          </div>
        )}

        {/* Patient Speech Response Card */}
        {(callState === 'responded' || patientReply) && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-emerald-500/20 text-emerald-300 p-4 rounded-2xl w-full max-w-sm text-center border border-emerald-500/40 shadow-lg"
          >
            <p className="text-xs font-semibold text-emerald-400 uppercase tracking-wider">{t.patientRepliedLabel}:</p>
            <p className="text-sm font-bold mt-1 text-white">{patientReply}</p>
            <div className="flex items-center justify-center gap-1.5 text-xs mt-2 text-emerald-300 font-semibold">
              <CheckCircle className="w-4 h-4" />
              <span>{t.statusUpdated}</span>
            </div>
          </motion.div>
        )}

        {/* Error notification */}
        {errorMessage && (
          <div className="bg-red-500/20 text-red-300 px-4 py-2 rounded-xl text-xs max-w-sm text-center border border-red-500/30">
            {errorMessage}
          </div>
        )}
      </div>

      {/* Call Interaction Controls */}
      <div className="pb-6 w-full max-w-sm mx-auto">
        {callState === 'incoming' && (
          <div className="flex items-center justify-around">
            <button 
              onClick={handleEndCall}
              className="flex flex-col items-center gap-2"
            >
              <div className="w-16 h-16 rounded-full bg-red-600 flex items-center justify-center text-white shadow-lg active:scale-90 transition-transform">
                <PhoneOff className="w-7 h-7" />
              </div>
              <span className="text-xs font-medium text-gray-300">Decline</span>
            </button>

            <button 
              onClick={handleAnswerCall}
              className="flex flex-col items-center gap-2"
            >
              <div className="w-16 h-16 rounded-full bg-emerald-500 flex items-center justify-center text-white shadow-lg shadow-emerald-500/40 active:scale-90 transition-transform">
                <Phone className="w-7 h-7" />
              </div>
              <span className="text-xs font-medium text-gray-300">Answer</span>
            </button>
          </div>
        )}

        {(callState === 'connected' || callState === 'responded') && (
          <div className="w-full">
            <button 
              onClick={handleEndCall} 
              className="w-full py-4 bg-red-600 hover:bg-red-700 text-white font-bold rounded-2xl shadow-lg shadow-red-500/30 active:scale-98 transition-all flex items-center justify-center gap-2 text-sm"
            >
              <PhoneOff className="w-5 h-5" />
              <span>{t.endCall}</span>
            </button>
          </div>
        )}
      </div>
    </motion.div>
  );
}
