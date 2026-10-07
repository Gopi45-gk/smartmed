import { useState, useEffect, useRef, useCallback } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { motion } from 'motion/react';
import { Medicine, TranslationStrings, Language, PatientProfile } from '../types';
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
  patientProfile?: PatientProfile;
}

type CallState = 'incoming' | 'connected' | 'responded';
type VoiceState = 'idle' | 'listening' | 'processing' | 'speaking' | 'error';
type VoicePromptType = 'GREETING' | 'TAKEN_ACK' | 'DELAY_ACK' | 'SKIP_ACK' | 'CLARIFY' | 'MAX_CLARIFY';
type MedicationIntent = 'TAKEN' | 'NOT_TAKEN' | 'DELAYED' | 'SKIPPED' | 'CLINICAL_QUERY' | 'UNCLEAR';

// ─── Voice Script Generator (User Registered Data Only - No Hallucinations) ──
function buildVoiceScript(
  type: VoicePromptType,
  patientName: string,
  lang: Language,
  medicineName?: string,
): string {
  const pName = patientName.trim();
  const med = medicineName?.trim();

  switch (type) {
    case 'GREETING':
      if (lang === 'ta') {
        const greeting = pName ? `வணக்கம் ${pName}.` : 'வணக்கம்.';
        const medPart = med ? ` உங்கள் ${med} மருந்தை எடுத்துக்கொள்ள வேண்டிய நேரம் இது.` : ' உங்கள் மருந்தை எடுத்துக்கொள்ள வேண்டிய நேரம் இது.';
        return `${greeting} இது உங்கள் SmartMed AI உதவியாளர்.${medPart}`;
      } else if (lang === 'hi') {
        const greeting = pName ? `नमस्ते ${pName}।` : 'नमस्ते।';
        const medPart = med ? ` आपकी ${med} दवा लेने का समय हो गया है।` : ' आपकी दवा लेने का समय हो गया है।';
        return `${greeting} यह आपका SmartMed AI सहायक है।${medPart}`;
      } else if (lang === 'te') {
        const greeting = pName ? `నమస్కారం ${pName}.` : 'నమస్కారం.';
        const medPart = med ? ` మీ ${med} మందు వేసుకునే సమయం ఇది.` : ' మీ మందు వేసుకునే సమయం ఇది.';
        return `${greeting} ఇది మీ SmartMed AI సహాయకుడు.${medPart}`;
      } else if (lang === 'kn') {
        const greeting = pName ? `ನಮಸ್ಕಾರ ${pName}.` : 'ನಮಸ್ಕಾರ.';
        const medPart = med ? ` ನಿಮ್ಮ ${med} ಔಷಧಿ ತೆಗೆದುಕೊಳ್ಳುವ ಸಮಯವಿದು.` : ' ನಿಮ್ಮ ಔಷಧಿ ತೆಗೆದುಕೊಳ್ಳುವ ಸಮಯವಿದು.';
        return `${greeting} ಇದು ನಿಮ್ಮ SmartMed AI ಸಹಾಯಕ.${medPart}`;
      } else if (lang === 'ml') {
        const greeting = pName ? `നമസ്കാരം ${pName}.` : 'നമസ്കാരം.';
        const medPart = med ? ` നിങ്ങളുടെ ${med} മരുന്ന് കഴിക്കാനുള്ള സമയമായി.` : ' നിങ്ങളുടെ മരുന്ന് കഴിക്കാനുള്ള സമയമായി.';
        return `${greeting} ഇത് നിങ്ങളുടെ SmartMed AI സഹായിയാണ്.${medPart}`;
      } else {
        const greeting = pName ? `Hello ${pName}.` : 'Hello.';
        const medPart = med ? ` It is time to take your ${med}.` : ' It is time to take your medicine.';
        return `${greeting} This is your SmartMed AI assistant.${medPart}`;
      }

    case 'TAKEN_ACK':
      if (lang === 'ta') {
        return pName
          ? `மிக்க நன்றி ${pName}! உங்கள் மருந்து உட்கொள்ளல் பதிவு செய்யப்பட்டது. உடலை நன்றாகப் பார்த்துக் கொள்ளுங்கள்.`
          : 'மிக்க நன்றி! உங்கள் மருந்து உட்கொள்ளல் பதிவு செய்யப்பட்டது. உடலை நன்றாகப் பார்த்துக் கொள்ளுங்கள்.';
      } else if (lang === 'hi') {
        return pName
          ? `धन्यवाद ${pName}! आपकी दवा लेने की पुष्टि दर्ज कर ली गई है। अपना ख्याल रखें।`
          : 'धन्यवाद! आपकी दवा लेने की पुष्टि दर्ज कर ली गई है। अपना ख्याल रखें।';
      } else if (lang === 'te') {
        return pName
          ? `ధన్యవాదాలు ${pName}! మీ మందుల వివరాలు నమోదు చేయబడ్డాయి. జాగ్రత్తగా ఉండండి.`
          : 'ధన్యవాదాలు! మీ మందుల వివరాలు నమోదు చేయబడ్డాయి. జాగ్రత్తగా ఉండండి.';
      } else if (lang === 'kn') {
        return pName
          ? `ಧನ್ಯವಾದಗಳು ${pName}! ನಿಮ್ಮ ಔಷಧಿ ವಿವರ ದಾಖಲಾಗಿದೆ. ಆರೋಗ್ಯವಾಗಿರಿ.`
          : 'ಧನ್ಯವಾದಗಳು! ನಿಮ್ಮ ಔಷಧಿ ವಿವರ ದಾಖಲಾಗಿದೆ. ಆರೋಗ್ಯವಾಗಿರಿ.';
      } else if (lang === 'ml') {
        return pName
          ? `നന്ദി ${pName}! നിങ്ങൾ മരുന്ന് കഴിച്ചത് രേഖപ്പെടുത്തി. ആരോഗ്യം ശ്രദ്ധിക്കുക.`
          : 'നന്ദി! നിങ്ങൾ മരുന്ന് കഴിച്ചത് രേഖപ്പെടുത്തി. ആരോഗ്യം ശ്രദ്ധിക്കുക.';
      } else {
        return pName
          ? `Thank you ${pName}! Your medication has been marked as taken. Take care!`
          : 'Thank you! Your medication has been marked as taken. Take care!';
      }

    case 'DELAY_ACK':
      if (lang === 'ta') {
        return pName
          ? `சரி ${pName}, 15 நிமிடங்களுக்குப் பிறகு மீண்டும் நினைவூட்டுகிறேன். தயவுசெய்து விரைவில் மருந்தை எடுத்துக் கொள்ளுங்கள்.`
          : 'சரி, 15 நிமிடங்களுக்குப் பிறகு மீண்டும் நினைவூட்டுகிறேன். தயவுசெய்து விரைவில் மருந்தை எடுத்துக் கொள்ளுங்கள்.';
      } else if (lang === 'hi') {
        return pName
          ? `समझ गया ${pName}। मैं 15 मिनट बाद दोबारा याद दिलाऊंगा। कृपया समय पर दवा लें।`
          : 'समझ गया। मैं 15 मिनट बाद दोबारा याद दिलाऊंगा। कृपया समय पर दवा लें।';
      } else if (lang === 'te') {
        return pName
          ? `సరే ${pName}, 15 నిమిషాల తర్వాత మళ్లీ గుర్తుచేస్తాను. దయచేసి త్వరగా మందు తీసుకోండి.`
          : 'సరే, 15 నిమిషాల తర్వాత మళ్లీ గుర్తుచేస్తాను. దయచేసి త్వరగా మందు తీసుకోండి.';
      } else if (lang === 'kn') {
        return pName
          ? `ಸರಿ ${pName}, 15 ನಿಮಿಷಗಳ ನಂತರ ಮತ್ತೆ ನೆನಪಿಸುತ್ತೇನೆ. ದಯವಿಟ್ಟು ಬೇಗ ಔಷಧಿ ತೆಗೆದುಕೊಳ್ಳಿ.`
          : 'ಸರಿ, 15 ನಿಮಿಷಗಳ ನಂತರ ಮತ್ತೆ ನೆನಪಿಸುತ್ತೇನೆ. ದಯವಿಟ್ಟು ಬೇಗ ಔಷಧಿ ತೆಗೆದುಕೊಳ್ಳಿ.';
      } else if (lang === 'ml') {
        return pName
          ? `ശരി ${pName}, 15 മിനിറ്റിനു ശേഷം വീണ്ടും ഓർമ്മിപ്പിക്കാം. ദയവായി വേഗം മരുന്ന് കഴിക്കുക.`
          : 'ശരി, 15 മിനിറ്റിനു ശേഷം വീണ്ടും ഓർമ്മിപ്പിക്കാം. ദയവായി വേഗം മരുന്ന് കഴിക്കുക.';
      } else {
        return pName
          ? `Understood ${pName}. I will remind you again in 15 minutes. Please remember to take your medicine.`
          : 'Understood. I will remind you again in 15 minutes. Please remember to take your medicine.';
      }

    case 'SKIP_ACK':
      if (lang === 'ta') return 'சரி, இந்த முறை மருந்து தவிர்க்கப்பட்டதாகக் குறிக்கப்பட்டுள்ளது. தேவைப்பட்டால் மருத்துவரை அணுகவும்.';
      if (lang === 'hi') return 'समझ गया। इस खुराक को छोड़ दिया गया है। अधिक खुराक छूटने पर डॉक्टर से परामर्श करें।';
      if (lang === 'te') return 'సరే, ఈ మోతాదు తీసుకోలేదని నమోదు చేయబడింది.';
      if (lang === 'kn') return 'ಸರಿ, ಈ ಡೋಸ್ ತೆಗೆದುಕೊಳ್ಳಲಾಗಿಲ್ಲ ಎಂದು ನಮೂದಿಸಲಾಗಿದೆ.';
      if (lang === 'ml') return 'ശരി, ഈ ഡോസ് ഒഴിവാക്കിയതായി രേഖപ്പെടുത്തി.';
      return 'Understood. I have recorded this dose as skipped. Please consult your physician if you miss multiple doses.';

    case 'CLARIFY':
      if (lang === 'ta') return 'மன்னிக்கவும், எனக்கு புரியவில்லை. உங்கள் மருந்தை எடுத்துவிட்டீர்களா?';
      if (lang === 'hi') return 'क्षमा करें, मुझे समझ नहीं आया। क्या आपने अपनी दवा ले ली है?';
      if (lang === 'te') return 'క్షమించండి, నాకు అర్థం కాలేదు. మీరు మీ మందులు వేసుకున్నారా?';
      if (lang === 'kn') return 'ಕ್ಷಮಿಸಿ, ಅರ್ಥವಾಗಲಿಲ್ಲ. ನೀವು ಔಷಧಿ ತೆಗೆದುಕೊಂಡಿದ್ದೀರಾ?';
      if (lang === 'ml') return 'ക്ഷമിക്കണം, വ്യക്തമായില്ല. നിങ്ങൾ മരുന്ന് കഴിച്ചോ?';
      return "Sorry, I didn't understand. Did you take your medicine?";

    case 'MAX_CLARIFY':
      if (lang === 'ta') return 'உங்கள் பதிலை உறுதிப்படுத்த முடியவில்லை. திரையில் உள்ள பொத்தான்களைப் பயன்படுத்தி உறுதிப்படுத்தவும்.';
      if (lang === 'hi') return 'दवा लेने की पुष्टि नहीं हो सकी। कृपया स्क्रीन पर दिए गए बटन का उपयोग करें।';
      if (lang === 'te') return 'స్పష్టత రాలేదు. దయచేసి స్క్రీన్‌పై ఉన్న బటన్లను ఉపయోగించండి.';
      if (lang === 'kn') return 'ಖಚಿತಪಡಿಸಲು ಸಾಧ್ಯವಾಗಲಿಲ್ಲ. ದಯವಿಟ್ಟು ಪರದೆಯ ಮೇಲಿನ ಬಟನ್ ಬಳಸಿ.';
      if (lang === 'ml') return 'സ്ഥിരീകരിക്കാൻ കഴിഞ്ഞില്ല. ദയവായി സ്ക്രീനിലെ ബട്ടണുകൾ ഉപയോഗിക്കുക.';
      return 'I could not confirm if you took your medicine. Please use the buttons on your screen.';
  }
}

// ─── Intent Detection Classifier (Natural Multilingual Conversational STT) ─
function classifyVoiceIntent(spokenText: string): MedicationIntent {
  const lower = spokenText.toLowerCase().trim();
  const tokens = lower.split(/[\s,?.!]+/);

  // Negative / NOT TAKEN
  const negativeKeywords = [
    'haven\'t', 'havent', 'not yet', 'have not', 'didn\'t', 'did not', 'no', 'nope',
    'not now', 'not taken', 'still not', 'wont', 'won\'t',
    'இல்லை', 'இல்ல', 'இன்னும் எடுக்கவில்லை', 'இன்னும் இல்லை', 'இன்னும் இல்ல', 'எடுக்கல', 'சாப்பிடல', 'போடல',
    'illa', 'illai', 'edukala', 'sappidala',
    'नहीं', 'नहीं ली', 'अभी नहीं', 'nahi', 'nahi li', 'abhi nahi',
    'లేదు', 'ఇంకా తీసుకోలేదు', 'ledu', 'inka ledu',
    'ಇಲ್ಲ', 'ಇನ್ನೂ ತೆಗೆದುಕೊಂಡಿಲ್ಲ',
    'ഇല്ല', 'ഇതുവരെ കഴിച്ചില്ല',
  ];

  const hasNegative = negativeKeywords.some(kw => lower.includes(kw) || tokens.includes(kw));

  // Delay / Snooze Keywords
  const delayKeywords = [
    'later', 'remind', 'snooze', '15 min', '30 min', 'after', 'busy',
    'பிறகு', 'நினைவூட்டு', 'அப்புறம்',
    'बाद में', 'याद',
    'తర్వాత', 'గుర్తు',
    'ಆಮೇಲೆ', 'ನೆನ',
    'പിന്നെ', 'ഓർമ്മി',
  ];

  const hasDelay = delayKeywords.some(kw => lower.includes(kw));

  if (hasNegative && hasDelay) return 'DELAYED';
  if (hasNegative) return 'NOT_TAKEN';
  if (hasDelay) return 'DELAYED';

  // Positive / TAKEN Keywords
  const takenKeywords = [
    'took', 'already taken', 'already took', 'had my', 'finished', 'done',
    'yes', 'yeah', 'yup', 'yes i did', 'mark taken', 'swallowed', 'taken',
    'i took it', 'i have taken',
    'எடுத்துக்கிட்டேன்', 'எடுத்துட்டேன்', 'எடுத்தாச்சு', 'சாப்பிட்டேன்', 'சாப்பிட்டாச்சு',
    'குடிச்சேன்', 'குடிச்சாச்சு', 'போட்டேன்', 'போட்டாச்சு', 'முடிஞ்சது', 'ஆம்', 'ஆமாம்',
    'eduthen', 'eduthuten', 'eduthachu', 'aamam', 'aam',
    'ले ली', 'खा ली', 'ले लिया', 'खा लिया', 'हाँ', 'हो गया', 'दवा ले ली', 'haa', 'haan',
    'తీసుకున్నాను', 'వేసుకున్నాను', 'అవును', 'అయింది', 'తీసుకున్నా', 'avunu', 'teesukunna',
    'ತಗೊಂಡೆ', 'ತೆಗೆದುಕೊಂಡೆ', 'ಹೌದು', 'ಆಯಿತು', 'haudu',
    'കഴിച്ചു', 'എടുത്തു', 'ഉവ്വ്', 'കഴിഞ്ഞു', 'athe', 'kazhichu',
  ];

  const hasTaken = takenKeywords.some(kw => lower.includes(kw) || tokens.includes(kw));
  if (hasTaken) return 'TAKEN';

  // Skip Keywords
  const skipKeywords = [
    'skip', 'skipped', 'missed', 'won\'t take',
    'தவிர்த்து', 'வேண்டாம்', 'छोड़', 'వద్దు', 'ಬೇಡ', 'വേണ്ട'
  ];
  if (skipKeywords.some(kw => lower.includes(kw))) return 'SKIPPED';

  // Clinical / Informational Queries (delegated to local AI)
  const queryKeywords = [
    'what', 'why', 'how', 'when', 'side effect', 'food', 'water', 'doctor', 'fever', 'pain',
    'என்ன', 'எப்படி', 'எப்போது', 'வலி', 'சாப்பாடு',
    'क्या', 'कैसे', 'कब', 'दर्द',
    'ఏమిటి', 'ఎలా', 'ఎప్పుడు',
    'ಏನು', 'ಹೇಗೆ', 'ಯಾವಾಗ',
    'എന്ത്', 'എങ്ങനെ', 'എപ്പോൾ'
  ];
  if (queryKeywords.some(kw => lower.includes(kw))) return 'CLINICAL_QUERY';

  return 'UNCLEAR';
}

export function PhoneCallSimulation({ close, medicines, setMedicines, t, lang, patientProfile }: Props) {
  const [callState, setCallState] = useState<CallState>('connected');
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [aiMessage, setAiMessage] = useState<string>('');
  const [patientReply, setPatientReply] = useState<string>('');
  const [aiAvailable, setAiAvailable] = useState<boolean | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [transcriptInterim, setTranscriptInterim] = useState<string>('');
  const [clarificationAttempts, setClarificationAttempts] = useState<number>(0);

  const isComponentMounted = useRef<boolean>(true);
  const conversationHistoryRef = useRef<AIMessage[]>([]);

  // ─── Speak AI Response via TTS (Synchronized Spoken & UI Transcript) ──────
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

    // Registered patient name and upcoming medicine from patient database ONLY
    const registeredName = patientProfile?.name?.trim() || '';
    const upcomingMed = medicines.find(m => m.status === 'upcoming') || medicines[0];
    const greeting = buildVoiceScript('GREETING', registeredName, lang, upcomingMed?.name);

    // Exact synchronization between spoken text and UI transcript
    setAiMessage(greeting);

    const greetTimer = setTimeout(() => {
      speakAIResponse(greeting, () => {
        // After greeting finishes, automatically open microphone to listen
        if (isComponentMounted.current) {
          startListening();
        }
      });
    }, 150);

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
        if (!err.includes('No speech') && !err.includes('network') && !err.includes('aborted')) {
          setErrorMessage(err);
        }
      },
      onEnd: () => {
        if (!isComponentMounted.current) return;
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

  // ─── Process User Voice Input (Human-Like Intent Orchestration) ────────────
  const handleUserVoiceInput = async (spokenText: string) => {
    if (!spokenText.trim() || !isComponentMounted.current) return;

    setPatientReply(spokenText);
    setTranscriptInterim('');
    setVoiceState('processing');

    const registeredName = patientProfile?.name?.trim() || '';
    const intent = classifyVoiceIntent(spokenText);

    // 1. Explicit Confirmation: TAKEN
    if (intent === 'TAKEN') {
      setClarificationAttempts(0);
      handleMarkMedicineTaken();
      const ackMsg = buildVoiceScript('TAKEN_ACK', registeredName, lang);
      setAiMessage(ackMsg);
      speakAIResponse(ackMsg, () => {
        if (isComponentMounted.current) {
          setCallState('responded');
        }
      });
      return;
    }

    // 2. Delay / Snooze
    if (intent === 'DELAYED' || intent === 'NOT_TAKEN') {
      setClarificationAttempts(0);
      const ackMsg = buildVoiceScript('DELAY_ACK', registeredName, lang);
      setAiMessage(ackMsg);
      speakAIResponse(ackMsg);
      return;
    }

    // 3. Skip
    if (intent === 'SKIPPED') {
      setClarificationAttempts(0);
      const ackMsg = buildVoiceScript('SKIP_ACK', registeredName, lang);
      setAiMessage(ackMsg);
      speakAIResponse(ackMsg);
      return;
    }

    // 4. Clinical Query or General Health Question
    if (intent === 'CLINICAL_QUERY') {
      setClarificationAttempts(0);
      try {
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
          registeredName,
          lang
        );

        if (!isComponentMounted.current) return;

        if (result.success && result.response) {
          setAiAvailable(true);
          setAiMessage(result.response);

          appendTurnToSharedHistory(spokenText, result.response);
          conversationHistoryRef.current.push(
            { role: 'user', content: spokenText },
            { role: 'assistant', content: result.response }
          );

          speakAIResponse(result.response, () => {
            if (isComponentMounted.current && callState === 'connected') {
              startListening();
            }
          });
          return;
        }
      } catch (err) {
        console.warn('[PhoneCallSimulation] Local AI voice query error:', err);
      }
    }

    // 5. Unclear Intent - Failure Handling (Rule 18: Maximum 2 clarification attempts)
    if (clarificationAttempts < 2) {
      setClarificationAttempts(prev => prev + 1);
      const clarifyPrompt = buildVoiceScript('CLARIFY', registeredName, lang);
      setAiMessage(clarifyPrompt);
      speakAIResponse(clarifyPrompt, () => {
        if (isComponentMounted.current && callState === 'connected') {
          startListening();
        }
      });
    } else {
      // Reached maximum 2 clarification attempts: status = UNCLEAR, do not mark TAKEN
      const maxClarifyPrompt = buildVoiceScript('MAX_CLARIFY', registeredName, lang);
      setAiMessage(maxClarifyPrompt);
      speakAIResponse(maxClarifyPrompt);
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
    const registeredName = patientProfile?.name?.trim() || '';
    const upcomingMed = medicines.find(m => m.status === 'upcoming') || medicines[0];
    const greeting = buildVoiceScript('GREETING', registeredName, lang, upcomingMed?.name);
    setAiMessage(greeting);
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
              <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400 bg-emerald-950/40 px-2.5 py-0.5 rounded-full border border-emerald-500/30">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                SmartMed Voice Care (Offline Engine Active)
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
          <div className="w-full space-y-3">
            {/* Quick Touch/Voice Responses (Works Offline & Online) */}
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  ttsProvider.stop();
                  handleUserVoiceInput(t.replyTaken || "I took my medicine");
                }}
                className="py-2.5 px-3 bg-white/10 hover:bg-white/15 active:scale-95 border border-white/20 rounded-xl text-xs font-semibold text-emerald-300 flex items-center justify-center gap-1.5 transition-all shadow-sm"
              >
                <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
                <span className="truncate">{t.replyTaken || "I took my medicine"}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  ttsProvider.stop();
                  handleUserVoiceInput(t.replySnooze || "Remind me in 15 mins");
                }}
                className="py-2.5 px-3 bg-white/10 hover:bg-white/15 active:scale-95 border border-white/20 rounded-xl text-xs font-semibold text-amber-300 flex items-center justify-center gap-1.5 transition-all shadow-sm"
              >
                <Clock className="w-3.5 h-3.5 text-amber-400" />
                <span className="truncate">{t.replySnooze || "Remind in 15m"}</span>
              </button>
            </div>

            <button 
              onClick={handleEndCall} 
              className="w-full py-3.5 bg-red-600 hover:bg-red-700 text-white font-bold rounded-2xl shadow-lg shadow-red-500/30 active:scale-98 transition-all flex items-center justify-center gap-2 text-sm"
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
