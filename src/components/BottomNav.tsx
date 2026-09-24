import { TabType, TranslationStrings } from '../types';
import { Home, Pill, Phone, MessageSquare, User } from 'lucide-react';

interface Props {
  activeTab: TabType;
  setActiveTab: (tab: TabType) => void;
  onCallAI: () => void;
  t: TranslationStrings;
}

export function BottomNav({ activeTab, setActiveTab, onCallAI, t }: Props) {
  return (
    <nav 
      className="fixed bottom-0 left-0 right-0 h-20 bg-white/95 backdrop-blur-xl border-t border-gray-200/90 z-40 shadow-[0_-4px_20px_rgba(0,0,0,0.04)]"
      aria-label="Bottom Navigation"
    >
      <div className="w-full max-w-4xl mx-auto h-full flex items-center justify-around px-2">
        {/* 1. Home */}
        <button 
          onClick={() => setActiveTab('home')}
          className={`flex-1 flex flex-col items-center justify-center transition-all active:scale-95 py-1 ${
            activeTab === 'home' ? 'text-[#0071E3]' : 'text-[#86868B] hover:text-gray-900'
          }`}
        >
          <Home className={`w-5 h-5 ${activeTab === 'home' ? 'stroke-[2.4]' : 'stroke-[1.8]'}`} />
          <span className={`text-[11px] mt-1 tracking-tight ${activeTab === 'home' ? 'font-bold' : 'font-medium'}`}>
            {t.home}
          </span>
        </button>

        {/* 2. Medicines */}
        <button 
          onClick={() => setActiveTab('medicines')}
          className={`flex-1 flex flex-col items-center justify-center transition-all active:scale-95 py-1 ${
            activeTab === 'medicines' ? 'text-[#0071E3]' : 'text-[#86868B] hover:text-gray-900'
          }`}
        >
          <Pill className={`w-5 h-5 -rotate-45 ${activeTab === 'medicines' ? 'stroke-[2.4]' : 'stroke-[1.8]'}`} />
          <span className={`text-[11px] mt-1 tracking-tight ${activeTab === 'medicines' ? 'font-bold' : 'font-medium'}`}>
            {t.medicines}
          </span>
        </button>

        {/* 3. Call AI (Center Spotlight Hero Button) */}
        <div className="flex-1 flex flex-col items-center justify-center relative -top-3.5">
          <button 
            onClick={onCallAI}
            className="w-14 h-14 rounded-full bg-[#0071E3] hover:bg-[#0062c4] text-white flex items-center justify-center shadow-[0_8px_20px_rgba(0,113,227,0.35)] active:scale-90 transition-all ring-4 ring-white border border-blue-400/20"
            title="SmartMed AI Voice Call"
            aria-label="SmartMed AI Voice Call"
          >
            <Phone className="w-6 h-6 stroke-[2.2] animate-pulse" />
          </button>
          <span className="text-[11px] font-bold text-[#0071E3] mt-1 tracking-tight">
            Call AI
          </span>
        </div>

        {/* 4. AI Chat */}
        <button 
          onClick={() => setActiveTab('chat')}
          className={`flex-1 flex flex-col items-center justify-center transition-all active:scale-95 py-1 ${
            activeTab === 'chat' ? 'text-[#0071E3]' : 'text-[#86868B] hover:text-gray-900'
          }`}
        >
          <MessageSquare className={`w-5 h-5 ${activeTab === 'chat' ? 'stroke-[2.4]' : 'stroke-[1.8]'}`} />
          <span className={`text-[11px] mt-1 tracking-tight ${activeTab === 'chat' ? 'font-bold' : 'font-medium'}`}>
            {t.chat}
          </span>
        </button>

        {/* 5. Profile */}
        <button 
          onClick={() => setActiveTab('profile')}
          className={`flex-1 flex flex-col items-center justify-center transition-all active:scale-95 py-1 ${
            activeTab === 'profile' ? 'text-[#0071E3]' : 'text-[#86868B] hover:text-gray-900'
          }`}
        >
          <User className={`w-5 h-5 ${activeTab === 'profile' ? 'stroke-[2.4]' : 'stroke-[1.8]'}`} />
          <span className={`text-[11px] mt-1 tracking-tight ${activeTab === 'profile' ? 'font-bold' : 'font-medium'}`}>
            {t.profile}
          </span>
        </button>
      </div>
    </nav>
  );
}
