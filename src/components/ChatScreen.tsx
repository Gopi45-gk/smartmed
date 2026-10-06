import { useState, useRef, useEffect, useCallback } from 'react';
import { motion } from 'motion/react';
import { Medicine, ChatMessage, TranslationStrings, Language } from '../types';
import { initialChatMessages } from '../data/initialData';
import { Send, Bot, User, Sparkles, Trash2, RefreshCw, ShieldAlert } from 'lucide-react';
import { soundManager } from '../utils/audio';
import {
  sendMessageToLocalAI,
  resolveClinicalTriageOffline,
  isAIServerReachable,
  saveConversationHistory,
  loadConversationHistory,
  clearConversationHistory,
  type AIMessage,
} from '../utils/aiClient';

interface Props {
  medicines: Medicine[];
  t: TranslationStrings;
  lang: Language;
}

export function ChatScreen({ medicines, t, lang }: Props) {
  // Load persisted messages or fall back to initial welcome messages
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    const saved = loadConversationHistory();
    if (saved.length > 0) {
      // Convert saved AIMessage[] back to ChatMessage[]
      return saved.map((m, idx) => ({
        id: `saved-${idx}`,
        sender: m.role === 'user' ? 'user' as const : 'ai' as const,
        text: m.content,
      }));
    }
    return initialChatMessages[lang] || initialChatMessages.en;
  });
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [aiAvailable, setAiAvailable] = useState<boolean | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const quickPrompts = [
    "What medicines are due after lunch?",
    "Can I take BP tablet with coffee?",
    "Did I miss any medicine today?",
    "Tell my son I took my BP medicine"
  ];

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isTyping]);

  // Check AI server availability on mount and periodically
  useEffect(() => {
    const checkStatus = async () => {
      const reachable = await isAIServerReachable();
      setAiAvailable(reachable);
    };
    checkStatus();
    const interval = setInterval(checkStatus, 15000); // Check every 15s
    return () => clearInterval(interval);
  }, []);

  // Persist messages to localStorage whenever they change
  useEffect(() => {
    if (messages.length > 0) {
      const aiMessages: AIMessage[] = messages.map(m => ({
        role: m.sender === 'user' ? 'user' : 'assistant',
        content: m.text,
      }));
      saveConversationHistory(aiMessages);
    }
  }, [messages]);

  // Build conversation history for the API
  const getConversationHistory = useCallback((): AIMessage[] => {
    return messages
      .filter(m => m.sender === 'user' || m.sender === 'ai')
      .map(m => ({
        role: m.sender === 'user' ? 'user' as const : 'assistant' as const,
        content: m.text,
      }));
  }, [messages]);

  const handleSend = async (textToSend?: string) => {
    const text = textToSend || input;
    if (!text.trim()) return;

    setLastError(null);

    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      sender: 'user',
      text: text.trim(),
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsTyping(true);

    // Send to hybrid AI engine with offline fallback
    try {
      const history = getConversationHistory();
      const result = await sendMessageToLocalAI(text.trim(), history, { language: lang });

      const replyText = (result.success && result.response)
        ? result.response
        : resolveClinicalTriageOffline(text.trim(), { language: lang });

      const aiMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        sender: 'ai',
        text: replyText,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
      setMessages(prev => [...prev, aiMsg]);
      soundManager.playSuccessChime();
      setIsTyping(false);
    } catch {
      const fallbackText = resolveClinicalTriageOffline(text.trim(), { language: lang });
      const errorMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        sender: 'ai',
        text: fallbackText,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
      setMessages(prev => [...prev, errorMsg]);
      soundManager.playSuccessChime();
      setIsTyping(false);
    }
  };

  const handleClearChat = () => {
    clearConversationHistory();
    setMessages(initialChatMessages[lang] || initialChatMessages.en);
    setLastError(null);
  };

  const handleRetry = () => {
    // Find the last user message and retry it
    const lastUserMsg = [...messages].reverse().find(m => m.sender === 'user');
    if (lastUserMsg) {
      // Remove the error message
      setMessages(prev => prev.filter(m => !m.text.startsWith('⚠')));
      handleSend(lastUserMsg.text);
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }} 
      animate={{ opacity: 1 }} 
      exit={{ opacity: 0 }}
      className="flex flex-col h-full bg-[#F5F5F7]"
    >
      {/* Header */}
      <div className="p-4 bg-white border-b border-gray-200/80 shadow-xs flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-2xl bg-blue-50 text-[#0071E3] flex items-center justify-center">
            <Bot className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-[#1D1D1F] leading-tight">SmartMed</h2>
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-[#0071E3] border border-blue-200/60">
                Care AI
              </span>
            </div>
            <div className="flex items-center gap-1.5 mt-0.5 text-[11px] font-medium">
              {aiAvailable === null ? (
                <span className="text-gray-400">Checking AI status...</span>
              ) : aiAvailable ? (
                <span className="inline-flex items-center gap-1 text-emerald-600 font-semibold">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Local AI Ready (Offline MNN)
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-emerald-600 font-semibold">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  SmartMed Care AI (Offline Engine Ready)
                </span>
              )}
            </div>
          </div>
        </div>
        <button
          onClick={handleClearChat}
          className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-colors"
          title="Clear conversation"
          aria-label="Clear conversation"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      {/* Medical Safety Disclaimer */}
      <div className="px-4 py-2 bg-amber-50/70 border-b border-amber-100/80 flex items-center gap-2">
        <ShieldAlert className="w-3.5 h-3.5 text-amber-600 shrink-0" />
        <p className="text-[10px] text-amber-700 leading-tight">
          This AI provides general health information only. Not a substitute for professional medical advice.
        </p>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3.5">
        {messages.map((m) => {
          const isUser = m.sender === 'user';
          const isError = !isUser && m.text.startsWith('⚠');
          return (
            <div key={m.id} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
              <div className="flex items-end gap-2 max-w-[85%]">
                {!isUser && (
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 mb-1 text-xs ${
                    isError ? 'bg-red-100 text-red-500' : 'bg-blue-100 text-[#0071E3]'
                  }`}>
                    <Bot className="w-4 h-4" />
                  </div>
                )}
                <div 
                  className={`p-3.5 rounded-2xl text-xs leading-relaxed ${
                    isUser 
                      ? 'bg-[#0071E3] text-white rounded-br-none shadow-sm' 
                      : isError
                        ? 'bg-red-50 text-red-700 border border-red-200/80 shadow-xs rounded-bl-none'
                        : 'bg-white text-[#1D1D1F] border border-gray-200/80 shadow-xs rounded-bl-none'
                  }`}
                >
                  <p>{m.text}</p>
                  {m.time && (
                    <span className={`text-[10px] block mt-1 text-right ${
                      isUser ? 'text-blue-100' : isError ? 'text-red-300' : 'text-gray-400'
                    }`}>
                      {m.time}
                    </span>
                  )}
                </div>
                {isUser && (
                  <div className="w-7 h-7 rounded-full bg-gray-200 text-gray-700 flex items-center justify-center shrink-0 mb-1 text-xs">
                    <User className="w-4 h-4" />
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {isTyping && (
          <div className="flex items-center gap-2 text-xs text-gray-500 italic ml-2">
            <Bot className="w-4 h-4 text-[#0071E3] animate-pulse" />
            <span>SmartMed AI is thinking...</span>
          </div>
        )}

        {/* Retry button when there was an error */}
        {lastError && !isTyping && (
          <div className="flex justify-center">
            <button
              onClick={handleRetry}
              className="flex items-center gap-1.5 text-[11px] text-[#0071E3] font-semibold bg-blue-50 border border-blue-200 px-3 py-1.5 rounded-full hover:bg-blue-100 active:scale-95 transition-all"
            >
              <RefreshCw className="w-3 h-3" />
              <span>Retry</span>
            </button>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Quick Prompts */}
      <div className="px-4 py-2 bg-white/50 border-t border-gray-200/40 overflow-x-auto flex gap-2 scrollbar-none">
        {quickPrompts.slice(0, 3).map((prompt, idx) => (
          <button
            key={idx}
            onClick={() => handleSend(prompt)}
            className="text-[11px] whitespace-nowrap bg-white border border-gray-200 px-3 py-1.5 rounded-full text-gray-700 font-medium hover:border-[#0071E3] hover:text-[#0071E3] active:scale-95 transition-all shadow-xs flex items-center gap-1"
          >
            <Sparkles className="w-3 h-3 text-[#0071E3]" />
            <span>{prompt}</span>
          </button>
        ))}
      </div>

      {/* Input box */}
      <div className="p-3 bg-white border-t border-gray-200 flex items-center gap-2">
        <input 
          type="text" 
          value={input} 
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !isTyping) handleSend(); }}
          placeholder={t.askAnything} 
          className="flex-1 p-3 bg-[#F5F5F7] rounded-xl border border-gray-200 text-xs focus:outline-none focus:border-[#0071E3] focus:bg-white transition-all text-[#1D1D1F]" 
          disabled={isTyping}
        />
        <button 
          onClick={() => handleSend()}
          disabled={!input.trim() || isTyping}
          className="p-3 bg-[#0071E3] disabled:opacity-40 text-white rounded-xl shadow-md active:scale-90 transition-transform"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
    </motion.div>
  );
}
