import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Medicine, ChatMessage, TranslationStrings, Language, PatientProfile } from '../types';
import { 
  Send, Bot, User, Sparkles, Trash2, ArrowLeft, History, Plus, 
  Volume2, VolumeX, Copy, Check, Mic, MicOff, ShieldAlert, X, MessageSquare, Clock
} from 'lucide-react';
import { soundManager } from '../utils/audio';
import { hybridSttProvider, ttsProvider } from '../utils/speech';
import {
  sendMessageToLocalAI,
  resolveClinicalTriageOffline,
  isAIServerReachable,
  getAllChatSessions,
  saveChatSession,
  deleteChatSession,
  createNewChatSession,
  type ChatSessionData,
} from '../utils/aiClient';

interface Props {
  medicines: Medicine[];
  t: TranslationStrings;
  lang: Language;
  patientProfile?: PatientProfile;
  onBack?: () => void;
}

export function ChatScreen({ medicines, t, lang, patientProfile, onBack }: Props) {
  // Navigation view: 'chat' or 'history'
  const [currentView, setCurrentView] = useState<'chat' | 'history'>('chat');

  // Start with a FRESH conversation session on mount (Modules 2.1 & 2.3)
  const [activeSession, setActiveSession] = useState<ChatSessionData>(() => {
    return createNewChatSession(lang);
  });

  // Saved history sessions list
  const [historySessions, setHistorySessions] = useState<ChatSessionData[]>(() => {
    return getAllChatSessions();
  });

  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [aiAvailable, setAiAvailable] = useState<boolean | null>(null);
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);
  const [speakingMsgId, setSpeakingMsgId] = useState<string | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [activeSession.messages, isTyping]);

  // Check AI server reachability periodically
  useEffect(() => {
    const checkStatus = async () => {
      const reachable = await isAIServerReachable();
      setAiAvailable(reachable);
    };
    checkStatus();
    const interval = setInterval(checkStatus, 15000);
    return () => clearInterval(interval);
  }, []);

  // Reload history sessions whenever viewing history
  const refreshHistory = useCallback(() => {
    setHistorySessions(getAllChatSessions());
  }, []);

  // Language name display helper
  const getLanguageDisplayName = (lCode: string): string => {
    const map: Record<string, string> = {
      en: 'English',
      ta: 'தமிழ்',
      hi: 'हिंदी',
      te: 'తెలుగు',
      bn: 'বাংলা',
      mr: 'मराठी',
      kn: 'ಕನ್ನಡ',
      ml: 'മലയാളം',
      ur: 'اردو',
    };
    return map[lCode] || lCode.toUpperCase();
  };

  // Welcome greeting per language matching Section 2.2 specifications
  const getWelcomeGreeting = (): string => {
    if (t.chatGreeting) return t.chatGreeting;
    if (lang === 'ta') return 'வணக்கம்! SmartMed AI-க்கு வரவேற்கிறோம். இன்று நான் உங்களுக்கு எப்படி உதவ முடியும்?';
    if (lang === 'hi') return 'नमस्ते! SmartMed AI में आपका स्वागत है। आज मैं आपकी कैसे मदद कर सकता हूँ?';
    if (lang === 'te') return 'నమస్కారం! SmartMed AI కి స్వాగతం. ఈరోజు నేను మీకు ఎలా సహాయపడగలను?';
    if (lang === 'bn') return 'নমস্কার! SmartMed AI-তে আপনাকে স্বাগতম। আজ আমি আপনাকে কীভাবে সাহায্য করতে পারি?';
    if (lang === 'mr') return 'नमस्कार! SmartMed AI मध्ये आपले स्वागत आहे. आज मी आपल्याला कशी मदत करू शकतो?';
    if (lang === 'kn') return 'ನಮಸ್ಕಾರ! SmartMed AI ಗೆ ಸುಸ್ವಾಗತ. ಇಂದು ನಾನು ನಿಮಗೆ ಹೇಗೆ ಸಹಾಯ ಮಾಡಲಿ?';
    if (lang === 'ml') return 'നമസ്കാരം! SmartMed AI-ലേക്ക് സ്വാഗതം. ഇന്ന് ഞാൻ നിങ്ങളെ എങ്ങനെ സഹായിക്കണം?';
    return 'Hello! Welcome to SmartMed AI. How can I help you today?';
  };

  // Suggested question chips translated per Section 2.2
  const suggestedPrompts = [
    { key: 'myMeds', text: t.promptMyMeds || 'What medicines are due today?' },
    { key: 'prescription', text: t.promptPrescription || 'Explain my prescription' },
    { key: 'glucose', text: t.promptGlucose || 'Check my glucose level' },
    { key: 'labReport', text: t.promptLabReport || 'Explain my lab report' },
    { key: 'generalHealth', text: t.promptGeneralHealth || 'Can I take BP tablet with coffee?' },
    { key: 'caregiver', text: t.promptCaregiver || 'Alert my caregiver I took my medicine' },
  ];

  // Send message logic
  const handleSend = async (textToSend?: string) => {
    const text = (textToSend || input).trim();
    if (!text || isTyping) return;

    soundManager.playClick();

    const userMsg: ChatMessage = {
      id: `msg_u_${Date.now()}`,
      sender: 'user',
      text,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    // Update active session with user message
    const updatedMessages = [...activeSession.messages, userMsg];
    const sessionWithUser: ChatSessionData = {
      ...activeSession,
      language: lang,
      messages: updatedMessages,
      title: activeSession.title === 'New Chat' ? text.slice(0, 32) : activeSession.title,
      updatedAt: new Date().toISOString(),
    };
    setActiveSession(sessionWithUser);
    saveChatSession(sessionWithUser);
    refreshHistory();

    setInput('');
    setIsTyping(true);

    try {
      // Build conversation history for API
      const historyApi = updatedMessages.map((m) => ({
        role: m.sender === 'user' ? ('user' as const) : ('assistant' as const),
        content: m.text,
      }));

      const result = await sendMessageToLocalAI(text, historyApi, {
        language: lang,
        patientName: patientProfile?.name,
        medicinesContext: medicines,
      });

      const replyText =
        result.success && result.response
          ? result.response
          : resolveClinicalTriageOffline(text, {
              language: lang,
              patientName: patientProfile?.name,
            });

      const aiMsg: ChatMessage = {
        id: `msg_a_${Date.now() + 1}`,
        sender: 'ai',
        text: replyText,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };

      const finalSession: ChatSessionData = {
        ...sessionWithUser,
        messages: [...sessionWithUser.messages, aiMsg],
        updatedAt: new Date().toISOString(),
      };

      setActiveSession(finalSession);
      saveChatSession(finalSession);
      refreshHistory();
      soundManager.playSuccessChime();
    } catch {
      const fallbackText = resolveClinicalTriageOffline(text, {
        language: lang,
        patientName: patientProfile?.name,
      });

      const aiMsg: ChatMessage = {
        id: `msg_a_${Date.now() + 1}`,
        sender: 'ai',
        text: fallbackText,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };

      const finalSession: ChatSessionData = {
        ...sessionWithUser,
        messages: [...sessionWithUser.messages, aiMsg],
        updatedAt: new Date().toISOString(),
      };

      setActiveSession(finalSession);
      saveChatSession(finalSession);
      refreshHistory();
      soundManager.playSuccessChime();
    } finally {
      setIsTyping(false);
    }
  };

  // Start a fresh, clean conversation session (Modules 2.1 & 3.3)
  const handleStartNewChat = () => {
    soundManager.playClick();
    const fresh = createNewChatSession(lang);
    setActiveSession(fresh);
    setCurrentView('chat');
    setInput('');
  };

  // Open an existing historical conversation (Module 3.2)
  const handleOpenHistoricalSession = (session: ChatSessionData) => {
    soundManager.playClick();
    setActiveSession(session);
    setCurrentView('chat');
  };

  // Delete a historical session with explicit confirmation
  const handleConfirmDelete = () => {
    if (!deleteConfirmId) return;
    deleteChatSession(deleteConfirmId);
    setHistorySessions(getAllChatSessions());
    if (activeSession.id === deleteConfirmId) {
      setActiveSession(createNewChatSession(lang));
    }
    setDeleteConfirmId(null);
    soundManager.playClick();
  };

  // Speech-to-Text Microphone toggle
  const toggleListening = () => {
    if (isListening) {
      hybridSttProvider.stopListening();
      setIsListening(false);
    } else {
      soundManager.playClick();
      setIsListening(true);
      hybridSttProvider.startListening({
        lang,
        onResult: (transcript, isFinal) => {
          setInput(transcript);
          if (isFinal && transcript.trim()) {
            setIsListening(false);
            handleSend(transcript.trim());
          }
        },
        onEnd: () => {
          setIsListening(false);
        },
        onError: () => {
          setIsListening(false);
        }
      });
    }
  };

  // Read aloud TTS helper
  const handleSpeak = (msgId: string, text: string) => {
    if (speakingMsgId === msgId) {
      ttsProvider.stop();
      setSpeakingMsgId(null);
      return;
    }
    setSpeakingMsgId(msgId);
    ttsProvider.speak(text, {
      lang: activeSession.language || lang,
      onEnd: () => setSpeakingMsgId(null),
      onError: () => setSpeakingMsgId(null)
    });
  };

  // Copy message helper
  const handleCopy = (id: string, text: string) => {
    try {
      navigator.clipboard.writeText(text);
      setCopiedMsgId(id);
      setTimeout(() => setCopiedMsgId(null), 2000);
    } catch {
      // ignore
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }} 
      animate={{ opacity: 1 }} 
      exit={{ opacity: 0 }}
      className="flex flex-col h-full bg-[#F5F7FB] relative overflow-hidden select-none"
    >
      {/* ─── Top Header (Section 2.2) ────────────────────────────────────── */}
      <header className="p-3.5 bg-white border-b border-slate-200/80 shadow-xs flex items-center justify-between z-20">
        <div className="flex items-center gap-2.5">
          {onBack && (
            <button
              onClick={onBack}
              className="w-9 h-9 rounded-full bg-slate-100 hover:bg-slate-200 active:scale-95 flex items-center justify-center text-slate-700 transition-all"
              title="Back"
              aria-label="Back"
            >
              <ArrowLeft className="w-4 h-4 stroke-[2.2]" />
            </button>
          )}

          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-[#0071E3] to-[#0A84FF] text-white flex items-center justify-center shadow-sm shadow-blue-500/25">
            <Bot className="w-5 h-5" />
          </div>

          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-black text-slate-900 leading-tight">SmartMed AI</h2>
              {/* Language pill indicator */}
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-black bg-blue-50 text-[#0071E3] border border-blue-200/70">
                {getLanguageDisplayName(lang)}
              </span>
            </div>
            <div className="flex items-center gap-1.5 mt-0.5 text-[11px] font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-emerald-700 font-bold">
                {aiAvailable ? (t.onlineStatus || 'Local MNN AI Ready') : (t.offlineStatus || 'Offline Engine Ready')}
              </span>
            </div>
          </div>
        </div>

        {/* Header Actions: New Chat & Chat History Button */}
        <div className="flex items-center gap-1.5">
          {currentView === 'history' ? (
            <button
              onClick={() => setCurrentView('chat')}
              className="px-3 py-1.5 rounded-xl bg-[#0071E3] text-white text-xs font-bold shadow-xs active:scale-95 transition-all flex items-center gap-1.5"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>{t.backToChat || 'Back to Chat'}</span>
            </button>
          ) : (
            <>
              {/* + New Chat Button */}
              <button
                onClick={handleStartNewChat}
                className="px-2.5 py-1.5 rounded-xl bg-blue-50 text-[#0071E3] hover:bg-blue-100 text-xs font-bold border border-blue-200/80 active:scale-95 transition-all flex items-center gap-1"
                title={t.newChat || 'New Chat'}
              >
                <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
                <span className="hidden sm:inline">{t.newChat || 'New Chat'}</span>
              </button>

              {/* Chat History Drawer Toggle Button */}
              <button
                onClick={() => {
                  refreshHistory();
                  setCurrentView('history');
                }}
                className="relative px-2.5 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold active:scale-95 transition-all flex items-center gap-1.5"
                title={t.chatHistory || 'Chat History'}
              >
                <History className="w-4 h-4 text-slate-600" />
                <span className="hidden sm:inline">{t.chatHistory || 'History'}</span>
                {historySessions.length > 0 && (
                  <span className="w-4 h-4 rounded-full bg-[#0071E3] text-white text-[9.5px] font-black flex items-center justify-center">
                    {historySessions.length}
                  </span>
                )}
              </button>
            </>
          )}
        </div>
      </header>

      {/* Medical Safety Disclaimer Alert Strip */}
      <div className="px-4 py-1.5 bg-amber-50/90 border-b border-amber-200/70 flex items-center gap-2 z-10">
        <ShieldAlert className="w-3.5 h-3.5 text-amber-600 shrink-0" />
        <p className="text-[10px] text-amber-800 font-semibold leading-tight">
          {t.triageDisclaimer || 'SmartMed AI provides verified medical triage. Always consult a physician for urgent diagnosis.'}
        </p>
      </div>

      {/* ─── Main Content Views: Chat or History ─────────────────────────── */}
      <AnimatePresence mode="wait">
        {currentView === 'history' ? (
          // ─── MODULE 3: CHAT HISTORY SCREEN ───────────────────────────────
          <motion.div
            key="history-view"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="flex-1 overflow-y-auto p-4 space-y-3"
          >
            <div className="flex items-center justify-between pb-1">
              <div>
                <h3 className="text-base font-extrabold text-slate-900 tracking-tight">
                  {t.chatHistory || 'Chat History'}
                </h3>
                <p className="text-xs text-slate-500 font-medium">
                  {historySessions.length} saved conversation{historySessions.length === 1 ? '' : 's'}
                </p>
              </div>

              <button
                onClick={handleStartNewChat}
                className="px-3.5 py-1.5 bg-[#0071E3] hover:bg-[#0A84FF] text-white font-extrabold text-xs rounded-xl shadow-xs active:scale-95 flex items-center gap-1.5"
              >
                <Plus className="w-4 h-4" />
                <span>{t.newChat || 'New Chat'}</span>
              </button>
            </div>

            {historySessions.length === 0 ? (
              <div className="bg-white rounded-2xl p-8 text-center border border-slate-200/80 shadow-xs mt-6 space-y-3">
                <div className="w-12 h-12 rounded-full bg-blue-50 text-[#0071E3] mx-auto flex items-center justify-center">
                  <MessageSquare className="w-6 h-6" />
                </div>
                <h4 className="text-sm font-bold text-slate-800">
                  {t.noConversations || 'No previous conversations found.'}
                </h4>
                <p className="text-xs text-slate-500 max-w-xs mx-auto">
                  Every new conversation you have with SmartMed AI will be saved here chronologically.
                </p>
                <button
                  onClick={handleStartNewChat}
                  className="mt-2 px-4 py-2 bg-[#0071E3] text-white font-bold text-xs rounded-xl shadow-sm"
                >
                  {t.newChat || 'Start a New Chat'}
                </button>
              </div>
            ) : (
              <div className="space-y-2.5">
                {historySessions.map((sess) => {
                  const isCurrent = sess.id === activeSession.id;
                  const dateStr = new Date(sess.updatedAt).toLocaleDateString([], {
                    month: 'short',
                    day: 'numeric',
                  });
                  const timeStr = new Date(sess.updatedAt).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  });

                  return (
                    <motion.div
                      key={sess.id}
                      whileHover={{ scale: 1.01 }}
                      className={`p-3.5 rounded-2xl border transition-all cursor-pointer bg-white relative ${
                        isCurrent 
                          ? 'border-[#0071E3] ring-2 ring-[#0071E3]/20 shadow-md' 
                          : 'border-slate-200/80 hover:border-slate-300 shadow-xs'
                      }`}
                      onClick={() => handleOpenHistoricalSession(sess)}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs font-black text-slate-900 truncate block">
                              {sess.title || 'Medical Consultation'}
                            </span>
                            <span className="text-[9.5px] font-extrabold uppercase px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-600">
                              {getLanguageDisplayName(sess.language || 'en')}
                            </span>
                            {isCurrent && (
                              <span className="text-[9.5px] font-black px-1.5 py-0.5 rounded-md bg-blue-50 text-[#0071E3]">
                                Active
                              </span>
                            )}
                          </div>

                          <p className="text-xs text-slate-600 line-clamp-2 leading-relaxed">
                            {sess.preview || (sess.messages[sess.messages.length - 1]?.text) || 'Empty conversation'}
                          </p>

                          <div className="flex items-center gap-3 mt-2 text-[10.5px] text-slate-400 font-semibold">
                            <span className="flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {dateStr} • {timeStr}
                            </span>
                            <span>•</span>
                            <span>{sess.messages.length} message{sess.messages.length === 1 ? '' : 's'}</span>
                          </div>
                        </div>

                        {/* Delete Session Button */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteConfirmId(sess.id);
                          }}
                          className="w-8 h-8 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 flex items-center justify-center transition-colors"
                          title="Delete Session"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            )}
          </motion.div>
        ) : (
          // ─── MODULE 2: ACTIVE CHATBOT SCREEN ─────────────────────────────
          <motion.div
            key="chat-view"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex-1 flex flex-col min-h-0"
          >
            {/* Messages Scroll Area */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3.5">
              {/* Section 2.2: Welcome Section for Fresh Chat */}
              {activeSession.messages.length === 0 ? (
                <div className="my-auto py-4 flex flex-col items-center text-center max-w-sm mx-auto">
                  {/* Glowing Medical AI Orb */}
                  <div className="relative mb-3">
                    <div className="w-16 h-16 rounded-3xl bg-gradient-to-tr from-[#0071E3] via-[#0A84FF] to-[#30B0C7] text-white flex items-center justify-center shadow-lg shadow-blue-500/30">
                      <Bot className="w-8 h-8" />
                    </div>
                    <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-emerald-500 text-white flex items-center justify-center shadow-md">
                      <Sparkles className="w-3.5 h-3.5" />
                    </div>
                  </div>

                  {/* Dynamic Welcome Greeting (Section 2.2) */}
                  <h3 className="text-base sm:text-lg font-black text-slate-900 tracking-tight leading-snug px-3">
                    {getWelcomeGreeting()}
                  </h3>
                  <p className="text-xs text-slate-500 font-semibold mt-1 px-4">
                    {t.chatSubtitle || 'Senior-friendly offline AI triage & medication guidance'}
                  </p>

                  {/* Section 2.2: Suggested Medical Questions Grid */}
                  <div className="w-full mt-6 space-y-2 text-left">
                    <span className="text-[11px] font-black uppercase text-slate-400 tracking-wider block px-1">
                      {t.suggestedQuestions || 'Suggested Questions'}
                    </span>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {suggestedPrompts.map((item) => (
                        <button
                          key={item.key}
                          onClick={() => handleSend(item.text)}
                          className="p-2.5 rounded-xl bg-white border border-slate-200/80 hover:border-[#0071E3] hover:bg-blue-50/40 text-slate-700 text-xs font-bold active:scale-98 transition-all shadow-2xs flex items-center gap-2 text-left"
                        >
                          <Sparkles className="w-3.5 h-3.5 text-[#0071E3] shrink-0" />
                          <span className="line-clamp-2">{item.text}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                /* Render Chat Conversation Messages */
                activeSession.messages.map((m) => {
                  const isUser = m.sender === 'user';
                  const isSpeaking = speakingMsgId === m.id;
                  const isCopied = copiedMsgId === m.id;

                  return (
                    <div 
                      key={m.id} 
                      className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
                    >
                      <div className="flex items-end gap-2 max-w-[88%] sm:max-w-[78%]">
                        {!isUser && (
                          <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-[#0071E3] to-[#0A84FF] text-white flex items-center justify-center shrink-0 mb-1 text-xs shadow-xs">
                            <Bot className="w-4 h-4" />
                          </div>
                        )}

                        <div
                          className={`p-3.5 rounded-2xl text-xs sm:text-[13px] leading-relaxed shadow-xs relative group ${
                            isUser
                              ? 'bg-gradient-to-r from-[#0071E3] to-[#0A84FF] text-white rounded-br-xs'
                              : 'bg-white text-slate-900 border border-slate-200/80 rounded-bl-xs'
                          }`}
                        >
                          <p className="whitespace-pre-line font-medium">{m.text}</p>

                          <div className={`flex items-center justify-between gap-3 mt-1.5 pt-1 text-[10px] ${
                            isUser ? 'text-blue-100 border-t border-white/10' : 'text-slate-400 border-t border-slate-100'
                          }`}>
                            <span>{m.time || 'Just now'}</span>

                            {/* Message actions for AI reply */}
                            {!isUser && (
                              <div className="flex items-center gap-1.5 opacity-90">
                                {/* TTS Speak Aloud */}
                                <button
                                  onClick={() => handleSpeak(m.id, m.text)}
                                  className="p-1 hover:text-[#0071E3] transition-colors rounded"
                                  title={t.readAloud || 'Read aloud'}
                                >
                                  {isSpeaking ? (
                                    <VolumeX className="w-3.5 h-3.5 text-blue-600 animate-pulse" />
                                  ) : (
                                    <Volume2 className="w-3.5 h-3.5" />
                                  )}
                                </button>

                                {/* Copy message */}
                                <button
                                  onClick={() => handleCopy(m.id, m.text)}
                                  className="p-1 hover:text-[#0071E3] transition-colors rounded"
                                  title={t.copyMessage || 'Copy message'}
                                >
                                  {isCopied ? (
                                    <Check className="w-3.5 h-3.5 text-emerald-600 stroke-[3]" />
                                  ) : (
                                    <Copy className="w-3.5 h-3.5" />
                                  )}
                                </button>
                              </div>
                            )}
                          </div>
                        </div>

                        {isUser && (
                          <div className="w-8 h-8 rounded-full bg-slate-200 text-slate-700 flex items-center justify-center shrink-0 mb-1 text-xs">
                            <User className="w-4 h-4" />
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })
              )}

              {/* Thinking Indicator */}
              {isTyping && (
                <div className="flex items-center gap-2 text-xs text-slate-500 italic ml-2">
                  <div className="w-6 h-6 rounded-full bg-blue-100 text-[#0071E3] flex items-center justify-center">
                    <Bot className="w-3.5 h-3.5 animate-spin" />
                  </div>
                  <span className="font-semibold">SmartMed AI is thinking...</span>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Listening Indicator overlay */}
            <AnimatePresence>
              {isListening && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 10 }}
                  className="px-4 py-2 bg-blue-50 border-t border-blue-200 flex items-center justify-between text-xs font-bold text-[#0071E3]"
                >
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-ping" />
                    <span>{t.listening || 'Listening... speak now'}</span>
                  </div>
                  <button
                    onClick={() => hybridSttProvider.stopListening()}
                    className="text-slate-500 hover:text-slate-700 text-[11px]"
                  >
                    Cancel
                  </button>
                </motion.div>
              )}
            </AnimatePresence>

            {/* ─── Chat Input Bar (Section 2.2) ────────────────────────────── */}
            <div className="p-3 bg-white border-t border-slate-200/80 flex items-center gap-2 z-20">
              {/* STT Microphone Button */}
              <button
                type="button"
                onClick={toggleListening}
                className={`w-11 h-11 rounded-xl flex items-center justify-center transition-all ${
                  isListening
                    ? 'bg-red-500 text-white shadow-md shadow-red-500/30 animate-pulse'
                    : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                }`}
                title={t.voiceInput || 'Tap to Speak'}
                aria-label="Voice Input"
              >
                {isListening ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
              </button>

              {/* Text Input with Clear button */}
              <div className="flex-1 relative flex items-center">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !isTyping) handleSend();
                  }}
                  placeholder={t.typeMessagePlaceholder || t.askAnything || 'Type your health or medicine question...'}
                  className="w-full px-3.5 py-3 pr-8 bg-slate-100/80 rounded-xl border border-slate-200 text-xs sm:text-sm font-medium focus:outline-none focus:border-[#0071E3] focus:bg-white transition-all text-slate-900"
                  disabled={isTyping}
                />
                {input.trim() && (
                  <button
                    type="button"
                    onClick={() => setInput('')}
                    className="absolute right-2.5 text-slate-400 hover:text-slate-600 p-0.5"
                    title={t.clearInput || 'Clear'}
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>

              {/* Send Button */}
              <button
                type="button"
                onClick={() => handleSend()}
                disabled={!input.trim() || isTyping}
                className="w-11 h-11 bg-[#0071E3] disabled:opacity-40 hover:bg-[#0A84FF] text-white rounded-xl shadow-md shadow-blue-500/25 flex items-center justify-center active:scale-95 transition-all"
                title={t.send || 'Send'}
                aria-label="Send"
              >
                <Send className="w-4 h-4 stroke-[2.5]" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ─── Delete Session Confirmation Modal ────────────────────────────── */}
      <AnimatePresence>
        {deleteConfirmId && (
          <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
            <motion.div
              initial={{ scale: 0.92, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.92, opacity: 0 }}
              className="bg-white rounded-2xl p-5 w-full max-w-sm shadow-xl space-y-3"
            >
              <div className="w-10 h-10 rounded-full bg-red-50 text-red-600 flex items-center justify-center mx-auto">
                <Trash2 className="w-5 h-5" />
              </div>
              <h3 className="text-center font-bold text-slate-900 text-base">
                {t.confirmDeleteTitle || 'Delete Conversation?'}
              </h3>
              <p className="text-center text-xs text-slate-500 leading-relaxed">
                {t.confirmDeleteText || 'This action cannot be undone. All messages in this session will be removed.'}
              </p>
              <div className="flex items-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setDeleteConfirmId(null)}
                  className="flex-1 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs transition-all"
                >
                  {t.cancelBtn || 'Cancel'}
                </button>
                <button
                  type="button"
                  onClick={handleConfirmDelete}
                  className="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold text-xs shadow-md shadow-red-600/25 transition-all"
                >
                  {t.deleteBtn || 'Delete'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
