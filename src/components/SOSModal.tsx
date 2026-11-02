import { useState, useEffect, useRef, useTransition } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  AlertOctagon, Phone, PhoneCall, ShieldAlert, CheckCircle2, 
  Volume2, Mic, MicOff, X, MapPin, AlertTriangle, UserCheck, RefreshCw, Clock, PhoneForwarded
} from 'lucide-react';
import { PatientProfile, Caregiver, Medicine, TranslationStrings } from '../types';
import { useLanguage } from '../context/LanguageContext';
import { soundManager } from '../utils/audio';
import { hybridSttProvider } from '../utils/speech';
import { 
  activateSOSApi, cancelSOSApi, resolveSOSApi, 
  sendSOSDialogueApi, getSOSStatusApi, retrySOSCallApi, 
  SOSActivateResponse 
} from '../utils/aiClient';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  patientProfile: PatientProfile;
  caregivers?: Caregiver[];
  medicines?: Medicine[];
  language?: string;
  t?: TranslationStrings;
  onSOSResolved?: () => void;
}

type SOSStep = 'CONFIRMATION' | 'ACTIVE_EMERGENCY' | 'RESOLVED';

export type EmergencyCallStatus = 
  | 'SOS ACTIVATED'
  | 'CALLING CAREGIVER'
  | 'CAREGIVER CALL CONNECTED'
  | 'CAREGIVER ACKNOWLEDGED'
  | 'CALL FAILED'
  | 'ALTERNATE ALERT SENT'
  | 'EMERGENCY RESOLVED';

export function SOSModal({
  isOpen,
  onClose,
  patientProfile,
  caregivers = [],
  medicines = [],
  language = 'en',
  t,
  onSOSResolved,
}: Props) {
  const { t: contextT } = useLanguage();
  const activeT = t || contextT;
  const [step, setStep] = useState<SOSStep>('CONFIRMATION');
  const [loading, setLoading] = useState(false);
  const [retryingCall, setRetryingCall] = useState(false);
  const [emergencyData, setEmergencyData] = useState<SOSActivateResponse | null>(null);
  
  // Strict Emergency States required by Section 5
  const [emergencyStatus, setEmergencyStatus] = useState<EmergencyCallStatus>('SOS ACTIVATED');
  const [activationTime, setActivationTime] = useState<string>('');

  // Interactive Emergency Voice & Speech states
  const [isAiSpeaking, setIsAiSpeaking] = useState(false);
  const [aiSpokenText, setAiSpokenText] = useState<string>('');
  const [isListening, setIsListening] = useState(false);
  const [patientSpeech, setPatientSpeech] = useState<string>('');
  const [triageAdvice, setTriageAdvice] = useState<string | null>(null);
  const [isCriticalLifeThreat, setIsCriticalLifeThreat] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const pollTimerRef = useRef<any>(null);

  const primaryCaregiver = caregivers.find(c => c.isPrimary) || caregivers[0] || {
    id: 1,
    name: 'Primary Caregiver',
    phone: '+91 98765 12345',
    relation: 'Family',
  };

  const maskedCaregiverPhone = (phone: string) => {
    if (!phone || phone.length < 6) return '****';
    const clean = phone.trim();
    return `${clean.slice(0, 4)} **** ${clean.slice(-2)}`;
  };

  // Reset state when modal opens or closes
  useEffect(() => {
    if (isOpen) {
      setStep('CONFIRMATION');
      setEmergencyData(null);
      setEmergencyStatus('SOS ACTIVATED');
      setTriageAdvice(null);
      setIsCriticalLifeThreat(false);
      setPatientSpeech('');
      setAiSpokenText('');
      setRetryingCall(false);
    } else {
      stopAllAudio();
      hybridSttProvider.stopListening();
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    }
  }, [isOpen]);

  // Clean up polling timer on unmount
  useEffect(() => {
    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, []);

  // Poll live call status from backend when in ACTIVE_EMERGENCY
  useEffect(() => {
    if (step === 'ACTIVE_EMERGENCY' && emergencyData?.emergency_id) {
      const emergencyId = emergencyData.emergency_id;
      
      const pollStatus = async () => {
        try {
          const res = await getSOSStatusApi(emergencyId);
          if (res?.emergency?.status) {
            const rawStatus = res.emergency.status;
            // Normalize backend status to valid EmergencyCallStatus
            if (rawStatus === 'CAREGIVER ACKNOWLEDGED' || rawStatus === 'ASSISTANCE_ACKNOWLEDGED') {
              setEmergencyStatus('CAREGIVER ACKNOWLEDGED');
            } else if (rawStatus === 'CAREGIVER CALL CONNECTED' || rawStatus === 'CAREGIVER_CONTACTED') {
              setEmergencyStatus('CAREGIVER CALL CONNECTED');
            } else if (rawStatus === 'CALL FAILED') {
              setEmergencyStatus('CALL FAILED');
            } else if (rawStatus === 'ALTERNATE ALERT SENT') {
              setEmergencyStatus('ALTERNATE ALERT SENT');
            } else if (rawStatus === 'EMERGENCY RESOLVED' || rawStatus === 'RESOLVED') {
              setEmergencyStatus('EMERGENCY RESOLVED');
            } else if (rawStatus === 'CALLING CAREGIVER' || rawStatus === 'ALERT_SENT') {
              setEmergencyStatus(prev => prev === 'SOS ACTIVATED' ? 'CALLING CAREGIVER' : prev);
            }
          }
        } catch (e) {
          // ignore transient polling errors
        }
      };

      pollTimerRef.current = setInterval(pollStatus, 1800);
      return () => {
        if (pollTimerRef.current) {
          clearInterval(pollTimerRef.current);
          pollTimerRef.current = null;
        }
      };
    }
  }, [step, emergencyData?.emergency_id]);

  const stopAllAudio = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setIsAiSpeaking(false);
  };

  const playBase64Audio = (audioBase64?: string, onEnded?: () => void) => {
    stopAllAudio();
    if (!audioBase64) {
      onEnded?.();
      return;
    }
    try {
      const audio = new Audio(audioBase64);
      audioRef.current = audio;
      setIsAiSpeaking(true);
      audio.onended = () => {
        setIsAiSpeaking(false);
        onEnded?.();
      };
      audio.onerror = () => {
        setIsAiSpeaking(false);
        onEnded?.();
      };
      audio.play().catch(() => {
        setIsAiSpeaking(false);
        onEnded?.();
      });
    } catch {
      setIsAiSpeaking(false);
      onEnded?.();
    }
  };

  // STEP 1 -> STEP 2: Patient Confirms SOS
  // PATH A (Caregiver phone call) and PATH B (Patient voice alert) run SIMULTANEOUSLY & INDEPENDENTLY!
  const handleConfirmEmergency = async () => {
    setLoading(true);
    try {
      soundManager.playAlarmBeep();
    } catch (e) {
      console.warn('Alarm beep error:', e);
    }
    const timeNow = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
    setActivationTime(timeNow);

    // 1. Get GPS coordinates non-blockingly
    let locationCoords: { latitude?: number; longitude?: number } | undefined = undefined;
    if (typeof navigator !== 'undefined' && navigator.geolocation) {
      try {
        const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 3000 });
        }).catch(() => null);
        if (pos) {
          locationCoords = {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
          };
        }
      } catch {
        // location not permitted or timed out
      }
    }

    try {
      // Transition immediately to ACTIVE_EMERGENCY
      setStep('ACTIVE_EMERGENCY');
      setEmergencyStatus('CALLING CAREGIVER');

      const patLang = patientProfile.preferred_language || language || 'en';
      const patName = patientProfile.name?.trim() || 'Gopikrishna';

      // 2. Dispatch activateSOSApi: backend spawns Caregiver Phone Call asynchronously & returns Kokoro Voice Alert
      const res = await activateSOSApi({
        patient_name: patName,
        phone_number: patientProfile.phone || '+91 98765 43210',
        language: patLang,
        caregiver: {
          name: primaryCaregiver.name,
          phone: primaryCaregiver.phone,
          relation: primaryCaregiver.relation,
        },
        location: locationCoords,
        vital_info: {
          bloodGroup: patientProfile.bloodGroup || 'O+',
          condition: patientProfile.condition || 'Hypertension, Diabetes',
        },
      });

      setEmergencyData(res);
      setEmergencyStatus('CALLING CAREGIVER');

      // PATH B: Immediately speak directly to the patient via Kokoro TTS
      // Does NOT wait for caregiver call to finish or connect!
      const initialSpokenText = res.voice_prompt?.text || (
        patLang.startsWith('ta')
          ? 'உங்கள் அவசர உதவி கோரிக்கை செயல்படுத்தப்பட்டுள்ளது. உங்கள் பராமரிப்பாளரை இப்போது தொடர்பு கொள்கிறேன். தயவுசெய்து அமைதியாக இருங்கள். என்ன நடந்தது என்று என்னிடம் சொல்லுங்கள்.'
          : 'Your SOS emergency request has been activated. I am contacting your caregiver now. Please stay calm. Help is being requested. Can you tell me what happened?'
      );
      setAiSpokenText(initialSpokenText);

      if (res.voice_prompt?.audio_base64) {
        playBase64Audio(res.voice_prompt.audio_base64, () => {
          // Once initial Kokoro announcement completes, auto-listen for patient response
          startPatientSpeechListening(res.emergency_id);
        });
      } else {
        setTimeout(() => {
          startPatientSpeechListening(res.emergency_id);
        }, 1500);
      }
    } catch (err) {
      console.error('Failed to trigger emergency:', err);
      setEmergencyStatus('CALL FAILED');
    } finally {
      setLoading(false);
    }
  };

  // Automated Microphone Listening for Patient Dialogue
  const startPatientSpeechListening = (emergencyId: string) => {
    setIsListening(true);
    hybridSttProvider.startListening({
      lang: patientProfile.preferred_language || language,
      onStart: () => setIsListening(true),
      onResult: (transcript, isFinal) => {
        setPatientSpeech(transcript);
        if (isFinal && transcript.trim().length > 2) {
          hybridSttProvider.stopListening();
          setIsListening(false);
          handleSendPatientDialogue(emergencyId, transcript);
        }
      },
      onError: () => {
        setIsListening(false);
      },
      onEnd: () => {
        setIsListening(false);
      },
    });
  };

  // Interactive Dialogue Turn: Qwen2.5 MNN + Clinical Emergency Triage + Kokoro Voice
  const handleSendPatientDialogue = async (emergencyId: string, text: string) => {
    if (!text.trim()) return;
    setLoading(true);
    try {
      const res = await sendSOSDialogueApi(
        emergencyId,
        text,
        patientProfile.preferred_language || language
      );
      setAiSpokenText(res.ai_response_text);
      if (res.is_critical) {
        setIsCriticalLifeThreat(true);
        setTriageAdvice(res.ai_response_text);
        try { soundManager.playAlarmBeep(); } catch {}
      }
      if (res.audio_base64) {
        playBase64Audio(res.audio_base64, () => {
          // Continue listening for patient interactive response
          startPatientSpeechListening(emergencyId);
        });
      }
    } catch (err) {
      console.warn('Dialogue error:', err);
    } finally {
      setLoading(false);
    }
  };

  // Caregiver Call Retry
  const handleRetryCall = async () => {
    if (!emergencyData?.emergency_id) return;
    setRetryingCall(true);
    setEmergencyStatus('CALLING CAREGIVER');
    try { soundManager.playAlarmBeep(); } catch {}
    try {
      await retrySOSCallApi(emergencyData.emergency_id);
    } catch (err) {
      console.warn('Retry call error:', err);
    } finally {
      setRetryingCall(false);
    }
  };

  const handleResolve = async () => {
    setLoading(true);
    stopAllAudio();
    hybridSttProvider.stopListening();
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
    }
    try {
      if (emergencyData?.emergency_id) {
        await resolveSOSApi(emergencyData.emergency_id, 'Assistance confirmed and patient safe.');
      }
      setEmergencyStatus('EMERGENCY RESOLVED');
      setStep('RESOLVED');
      soundManager.playSuccessChime();
      onSOSResolved?.();
      setTimeout(() => {
        onClose();
      }, 2500);
    } catch {
      onClose();
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = async () => {
    stopAllAudio();
    hybridSttProvider.stopListening();
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
    }
    if (emergencyData?.emergency_id) {
      await cancelSOSApi(emergencyData.emergency_id, 'False alarm cancelled by patient.');
    }
    onClose();
  };

  // Status badge styling helper
  const getStatusBadgeStyle = (status: EmergencyCallStatus) => {
    switch (status) {
      case 'SOS ACTIVATED':
      case 'CALLING CAREGIVER':
        return 'bg-amber-100 text-amber-900 border-amber-300';
      case 'CAREGIVER CALL CONNECTED':
        return 'bg-blue-100 text-blue-900 border-blue-300';
      case 'CAREGIVER ACKNOWLEDGED':
        return 'bg-emerald-100 text-emerald-900 border-emerald-300';
      case 'CALL FAILED':
        return 'bg-rose-100 text-rose-900 border-rose-300';
      case 'ALTERNATE ALERT SENT':
        return 'bg-purple-100 text-purple-900 border-purple-300';
      case 'EMERGENCY RESOLVED':
        return 'bg-green-100 text-green-900 border-green-300';
      default:
        return 'bg-red-100 text-red-900 border-red-300';
    }
  };

  // Critical contact status text rule:
  const isCaregiverContacted = 
    emergencyStatus === 'CAREGIVER CALL CONNECTED' || emergencyStatus === 'CAREGIVER ACKNOWLEDGED';

  const caregiverHeadingText = isCaregiverContacted 
    ? (activeT.sosCaregiverContacted || 'Your caregiver has been contacted.')
    : emergencyStatus === 'CALL FAILED'
    ? (activeT.sosCaregiverFailed || 'Caregiver call failed. Alternate alert sent.')
    : (activeT.sosCallingCaregiver || 'Calling your caregiver...');

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
      <motion.div
        initial={{ scale: 0.9, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.9, opacity: 0, y: 20 }}
        className="w-full max-w-lg bg-white rounded-3xl shadow-2xl overflow-hidden border border-red-200 flex flex-col"
      >
        {/* Top Header Banner */}
        <div className="bg-gradient-to-r from-red-600 via-rose-600 to-red-700 text-white px-6 py-4 flex items-center justify-between shadow-md">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-white/20 flex items-center justify-center text-white border border-white/20 animate-pulse">
              <AlertOctagon className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-black tracking-tight uppercase">{activeT.sosActivated || 'SOS EMERGENCY ACTIVATED'}</h2>
              <p className="text-xs text-red-100 font-medium">{activeT.sosAutoCallVoice || 'Automatic Caregiver Phone Call & Voice Alert'}</p>
            </div>
          </div>
          <button
            onClick={step === 'ACTIVE_EMERGENCY' ? handleCancel : onClose}
            className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Content */}
        <div className="p-6">
          {/* STEP 1: CONFIRMATION POPUP */}
          {step === 'CONFIRMATION' && (
            <div className="flex flex-col items-center text-center py-4">
              <div className="w-24 h-24 rounded-full bg-red-100 border-4 border-red-200 flex items-center justify-center text-red-600 mb-5 animate-pulse shadow-inner">
                <ShieldAlert className="w-12 h-12" />
              </div>
              <h3 className="text-2xl font-black text-gray-900 leading-snug">
                {activeT.sosConfirmTitle || 'Confirm Emergency SOS?'}
              </h3>
              <p className="text-sm text-gray-600 mt-2.5 max-w-sm">
                {activeT.sosConfirmDesc
                  ? activeT.sosConfirmDesc
                      .replace('{name}', primaryCaregiver.name)
                      .replace('{phone}', maskedCaregiverPhone(primaryCaregiver.phone))
                  : `Confirming will immediately initiate an automated phone call to your registered caregiver ${primaryCaregiver.name} (${maskedCaregiverPhone(primaryCaregiver.phone)}) and launch your interactive voice alert.`}
              </p>

              <div className="w-full grid grid-cols-1 gap-3.5 mt-8">
                <button
                  type="button"
                  onClick={handleConfirmEmergency}
                  disabled={loading}
                  className="w-full py-4 px-6 rounded-2xl bg-red-600 hover:bg-red-700 active:scale-98 text-white font-extrabold text-lg shadow-xl shadow-red-600/35 flex items-center justify-center gap-3 transition-all cursor-pointer"
                >
                  <AlertOctagon className="w-6 h-6" />
                  <span>{loading ? (activeT.sosCallingCaregiver || 'INITIATING CALL...') : (activeT.sosConfirmBtn || 'CONFIRM EMERGENCY')}</span>
                </button>

                <button
                  type="button"
                  onClick={onClose}
                  disabled={loading}
                  className="w-full py-3.5 px-6 rounded-2xl bg-gray-100 hover:bg-gray-200 active:scale-98 text-gray-800 font-bold text-base transition-all cursor-pointer"
                >
                  {activeT.sosCancelBtn || 'Cancel (False Alarm)'}
                </button>
              </div>
            </div>
          )}

          {/* STEP 2: ACTIVE EMERGENCY DASHBOARD */}
          {step === 'ACTIVE_EMERGENCY' && (
            <div className="space-y-4">
              {/* Visible Emergency Notification on Dashboard */}
              <div className="p-4 rounded-2xl bg-red-50 border border-red-200 shadow-xs">
                <div className="flex items-center justify-between border-b border-red-200/60 pb-2.5 mb-2.5">
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full bg-red-600 animate-ping" />
                    <span className="text-xs font-black tracking-wider text-red-700 uppercase">
                      {activeT.sosActivated || 'SOS ACTIVATED'}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-red-800 font-semibold">
                    <Clock className="w-3.5 h-3.5 text-red-600" />
                    <span>{activationTime || 'Just now'}</span>
                  </div>
                </div>

                {/* Calling Status Text */}
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-base font-extrabold text-gray-900">
                      {caregiverHeadingText}
                    </h3>
                    <p className="text-xs text-gray-600 mt-0.5">
                      {activeT.primaryCaregiverHeader || 'Caregiver'}: <span className="font-bold text-gray-900">{primaryCaregiver.name}</span> • {maskedCaregiverPhone(primaryCaregiver.phone)}
                    </p>
                  </div>
                  <span className={`text-xs px-2.5 py-1 rounded-full border font-bold ${getStatusBadgeStyle(emergencyStatus)}`}>
                    {emergencyStatus}
                  </span>
                </div>
              </div>

              {/* Call Control Card (with Retry & Native Dialer Fallback) */}
              <div className="p-4 rounded-2xl bg-white border border-gray-200 shadow-xs flex items-center justify-between">
                <div>
                  <span className="text-[11px] text-gray-500 font-bold uppercase tracking-wider">
                    {activeT.primaryCaregiverHeader || 'Caregiver Telephony'}
                  </span>
                  <p className="text-sm font-extrabold text-gray-900 mt-0.5">
                    {emergencyStatus === 'CAREGIVER ACKNOWLEDGED' 
                      ? (activeT.sosCaregiverAck || 'Caregiver Acknowledged Call')
                      : emergencyStatus === 'CAREGIVER CALL CONNECTED'
                      ? (activeT.sosCaregiverCallConnected || 'Call In Progress')
                      : emergencyStatus === 'CALL FAILED'
                      ? (activeT.sosCallFailed || 'Call Unanswered / Failed')
                      : (activeT.sosTelephonyActive || 'Twilio Cloud Telephony Active')}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  {/* Retry Button if Call Failed */}
                  {emergencyStatus === 'CALL FAILED' && (
                    <button
                      type="button"
                      onClick={handleRetryCall}
                      disabled={retryingCall}
                      className="py-2.5 px-3 rounded-xl bg-amber-500 hover:bg-amber-600 active:scale-95 text-white font-extrabold text-xs flex items-center gap-1.5 shadow-md shadow-amber-500/25 transition-all cursor-pointer"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${retryingCall ? 'animate-spin' : ''}`} />
                      <span>{retryingCall ? (activeT.sosCallingCaregiver || 'Retrying...') : (activeT.sosRetryCall || 'Retry Call')}</span>
                    </button>
                  )}

                  {/* Native Android Dialer Fallback */}
                  <a
                    href={`tel:${primaryCaregiver.phone}`}
                    className="py-2.5 px-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white font-bold text-xs flex items-center gap-1.5 shadow-md shadow-emerald-600/20"
                    title={activeT.sosDialPhone || 'Direct Phone Call'}
                  >
                    <PhoneForwarded className="w-3.5 h-3.5" />
                    <span>{activeT.sosDialPhone || 'Dial Phone'}</span>
                  </a>
                </div>
              </div>

              {/* Critical Life-Threat Warning Banner (Chest pain / Dizziness / 112) */}
              {isCriticalLifeThreat && (
                <div className="p-4 rounded-2xl bg-rose-700 text-white shadow-md border border-rose-800 animate-pulse">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="w-6 h-6 shrink-0 text-yellow-300 mt-0.5" />
                    <div>
                      <h4 className="font-black text-sm text-yellow-200 uppercase tracking-wide">
                        {activeT.sosCriticalGuidance || 'CRITICAL MEDICAL GUIDANCE'}
                      </h4>
                      <p className="text-xs mt-1 text-white leading-relaxed">
                        {triageAdvice || 'Chest pain can be serious. Please seek immediate emergency medical assistance. Do not wait for the caregiver if you are experiencing severe symptoms.'}
                      </p>
                      <a
                        href="tel:112"
                        className="mt-2.5 inline-flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-yellow-400 text-gray-950 font-black text-xs shadow-md hover:bg-yellow-300 active:scale-95 transition-all"
                      >
                        <Phone className="w-3.5 h-3.5" />
                        <span>{activeT.sosDialAmbulance || 'DIAL 108 / 112 (AMBULANCE)'}</span>
                      </a>
                    </div>
                  </div>
                </div>
              )}

              {/* SIMULTANEOUS PATIENT VOICE ALERT & INTERACTIVE EMERGENCY CONVERSATION */}
              <div className="p-4 rounded-2xl bg-slate-900 text-white relative overflow-hidden shadow-inner border border-slate-800">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Volume2 className={`w-4 h-4 ${isAiSpeaking ? 'text-emerald-400 animate-pulse' : 'text-slate-400'}`} />
                    <span className="text-xs font-bold text-slate-300">
                      {isAiSpeaking ? (activeT.sosSpeaking || 'SmartMed Speaking (Kokoro TTS)...') : (activeT.sosInteractiveVoice || 'Interactive Emergency Voice')}
                    </span>
                  </div>
                  {isAiSpeaking && (
                    <button
                      type="button"
                      onClick={stopAllAudio}
                      className="text-[10px] bg-slate-800 hover:bg-slate-700 px-2 py-0.5 rounded-md text-slate-300 font-semibold cursor-pointer"
                    >
                      {activeT.sosMuteVoice || 'Mute Voice'}
                    </button>
                  )}
                </div>

                <p className="text-sm font-medium text-slate-100 italic leading-relaxed">
                  "{aiSpokenText || 'Your SOS emergency request has been activated. I am contacting your caregiver now. Please stay calm. Help is being requested. Can you tell me what happened?'}"
                </p>

                {/* Patient Speech Recognition & Interactive Response */}
                <div className="mt-3.5 pt-3 border-t border-slate-800 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs text-slate-300 truncate max-w-[280px]">
                    <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${isListening ? 'bg-red-500 animate-ping' : 'bg-slate-600'}`} />
                    <span className="truncate">
                      {isListening 
                        ? (activeT.sosListeningNow || 'Listening to you now...') 
                        : patientSpeech 
                        ? `${activeT.patientRepliedLabel || 'You'}: "${patientSpeech}"` 
                        : (activeT.sosTapSpeak || 'Tap Speak or reply naturally')}
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      if (isListening) {
                        hybridSttProvider.stopListening();
                        setIsListening(false);
                      } else if (emergencyData?.emergency_id) {
                        startPatientSpeechListening(emergencyData.emergency_id);
                      }
                    }}
                    className={`py-2 px-3 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                      isListening
                        ? 'bg-red-500 text-white animate-pulse'
                        : 'bg-blue-600 hover:bg-blue-500 text-white shadow-md shadow-blue-600/30'
                    }`}
                  >
                    {isListening ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
                    <span>{isListening ? (activeT.sosStop || 'Stop') : (activeT.sosSpeak || 'Speak')}</span>
                  </button>
                </div>
              </div>

              {/* Status Footer Indicators */}
              <div className="flex items-center justify-between text-xs text-gray-500 px-1 pt-1">
                <span className="flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                  <span>{activeT.sosCallAlertsActive || 'Call & Alerts Active'}</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5 text-blue-600" />
                  <span>{activeT.sosEventRecorded || 'Emergency Event Recorded'}</span>
                </span>
              </div>

              {/* Action Buttons: Assistance Arrived or Resolve */}
              <div className="pt-2 grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={handleResolve}
                  disabled={loading}
                  className="py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white font-extrabold text-sm shadow-md shadow-emerald-600/25 flex items-center justify-center gap-2 transition-all cursor-pointer"
                >
                  <UserCheck className="w-4 h-4" />
                  <span>{activeT.sosAssistanceArrived || 'Assistance Arrived'}</span>
                </button>

                <button
                  type="button"
                  onClick={handleCancel}
                  disabled={loading}
                  className="py-3 px-4 rounded-xl bg-gray-100 hover:bg-gray-200 active:scale-95 text-gray-700 font-bold text-sm flex items-center justify-center gap-2 transition-all cursor-pointer"
                >
                  <span>{activeT.sosResolveClose || 'Resolve / Close'}</span>
                </button>
              </div>
            </div>
          )}

          {/* STEP 3: RESOLVED SAFELY */}
          {step === 'RESOLVED' && (
            <div className="flex flex-col items-center text-center py-6">
              <div className="w-20 h-20 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mb-4 shadow-inner">
                <CheckCircle2 className="w-10 h-10" />
              </div>
              <h3 className="text-xl font-black text-gray-900">{activeT.sosResolvedSafely || 'Emergency Resolved Safely'}</h3>
              <p className="text-sm text-gray-600 mt-1 max-w-xs">
                {activeT.sosResolvedDesc || 'Your caregiver alert and call status have been marked as resolved. We are glad you are safe!'}
              </p>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}
