import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Language, TranslationStrings } from '../types';
import { ArrowLeft, Globe, Check, Sparkles } from 'lucide-react';
import { soundManager } from '../utils/audio';

interface Props {
  currentLang: Language;
  setLang: (lang: Language) => void;
  next: () => void;
  onBack?: () => void;
  t: TranslationStrings;
}

interface LanguageOption {
  code: Language;
  native: string;
  label: string;
  headingText: string;
  gradient: string;
  topSheen: string;
  bottomTone: string;
  shadowColor: string;
}

export function LanguageScreen({ currentLang, setLang, next, onBack }: Props) {
  const [selectedCode, setSelectedCode] = useState<Language>(currentLang);

  // Supported languages with SmartMed iOS color palette & tactile texture
  const languageOptions: LanguageOption[] = [
    {
      code: 'ta',
      native: 'தமிழ்',
      label: 'TAMIL',
      headingText: 'உங்கள் மொழியைத் தேர்ந்தெடுக்கவும்',
      gradient: 'from-[#059669] via-[#10B981] to-[#047857]',
      topSheen: 'bg-white/20',
      bottomTone: 'bg-black/15',
      shadowColor: 'shadow-emerald-600/25'
    },
    {
      code: 'en',
      native: 'ENGLISH',
      label: 'ENGLISH',
      headingText: 'Select Your Language',
      gradient: 'from-[#0071E3] via-[#0A84FF] to-[#0055B3]',
      topSheen: 'bg-white/25',
      bottomTone: 'bg-black/15',
      shadowColor: 'shadow-blue-600/30'
    },
    {
      code: 'hi',
      native: 'हिंदी',
      label: 'HINDI',
      headingText: 'अपनी भाषा का चयन करें',
      gradient: 'from-[#D97706] via-[#F59E0B] to-[#B45309]',
      topSheen: 'bg-white/20',
      bottomTone: 'bg-black/15',
      shadowColor: 'shadow-amber-600/30'
    },
    {
      code: 'te',
      native: 'తెలుగు',
      label: 'TELUGU',
      headingText: 'మీ భాషను ఎంచుకోండి',
      gradient: 'from-[#0284C7] via-[#0EA5E9] to-[#0369A1]',
      topSheen: 'bg-white/20',
      bottomTone: 'bg-black/15',
      shadowColor: 'shadow-sky-600/25'
    },
    {
      code: 'bn',
      native: 'বাংলা',
      label: 'BENGALI',
      headingText: 'আপনার ভাষা নির্বাচন করুন',
      gradient: 'from-[#E11D48] via-[#F43F5E] to-[#BE123C]',
      topSheen: 'bg-white/20',
      bottomTone: 'bg-black/15',
      shadowColor: 'shadow-rose-600/25'
    },
    {
      code: 'mr',
      native: 'मराठी',
      label: 'MARATHI',
      headingText: 'आपली भाषा निवडा',
      gradient: 'from-[#EA580C] via-[#F97316] to-[#C2410C]',
      topSheen: 'bg-white/20',
      bottomTone: 'bg-black/15',
      shadowColor: 'shadow-orange-600/25'
    },
    {
      code: 'kn',
      native: 'ಕನ್ನಡ',
      label: 'KANNADA',
      headingText: 'ನಿಮ್ಮ ಭಾಷೆಯನ್ನು ಆಯ್ಕೆಮಾಡಿ',
      gradient: 'from-[#4F46E5] via-[#6366F1] to-[#3730A3]',
      topSheen: 'bg-white/20',
      bottomTone: 'bg-black/15',
      shadowColor: 'shadow-indigo-600/25'
    },
    {
      code: 'ml',
      native: 'മലയാളം',
      label: 'MALAYALAM',
      headingText: 'നിങ്ങളുടെ ഭാഷ തിരഞ്ഞെടുക്കുക',
      gradient: 'from-[#0D9488] via-[#14B8A6] to-[#0F766E]',
      topSheen: 'bg-white/20',
      bottomTone: 'bg-black/15',
      shadowColor: 'shadow-teal-600/25'
    }
  ];

  const currentOption = languageOptions.find((l) => l.code === selectedCode) || languageOptions[0];

  const handleSelect = (lang: LanguageOption) => {
    setSelectedCode(lang.code);
    setLang(lang.code);
    soundManager.playSuccessChime();
    setTimeout(() => {
      next();
    }, 380);
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 12 }} 
      animate={{ opacity: 1, y: 0 }} 
      exit={{ opacity: 0, scale: 0.98 }} 
      className="flex flex-col h-full justify-between bg-gradient-to-b from-[#FFFFFF] via-[#F8FAFC] to-[#EEF5FF] px-4 pt-3 pb-5 overflow-y-auto scrollbar-none select-none text-slate-800 relative"
    >
      {/* Background Soft Glow Orbs matching SmartMed aesthetic */}
      <div className="absolute top-10 -left-16 w-52 h-52 bg-blue-400/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute top-1/2 -right-16 w-52 h-52 bg-emerald-400/10 rounded-full blur-3xl pointer-events-none" />

      {/* Top Bar with SmartMed Apple-Styled Elements */}
      <div className="flex items-center justify-between z-20 mb-1">
        <motion.button 
          whileTap={{ scale: 0.92 }}
          onClick={onBack || next}
          className="w-10 h-10 rounded-full bg-white shadow-sm border border-gray-200/70 flex items-center justify-center text-[#1D1D1F] hover:bg-gray-50 transition-colors"
          title="Back"
          aria-label="Back"
        >
          <ArrowLeft className="w-5 h-5 stroke-[2.2]" />
        </motion.button>

        {/* SmartMed Blue Pill Badge */}
        <div className="bg-[#0071E3] text-white px-3.5 py-1.5 rounded-full flex items-center gap-1.5 shadow-sm shadow-blue-500/30 border border-white/20">
          <Globe className="w-3.5 h-3.5 text-blue-100" />
          <span className="text-[10px] font-extrabold tracking-wider uppercase">
            SELECT LANGUAGE
          </span>
        </div>
      </div>

      {/* Hero Illustration: Alternative Image provided by user */}
      <div className="relative w-full max-w-[340px] mx-auto flex flex-col items-center justify-center my-auto py-1 z-10">
        <div className="relative w-full flex items-center justify-center">
          <motion.img 
            src="/language-hero.webp"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).src = 'https://www.image2url.com/r2/default/images/1788603115255-24afe850-2809-46f8-aac2-4b7d2c2d4756.webp';
            }}
            alt="Language Selection"
            className="w-full max-h-[170px] sm:max-h-[185px] object-contain select-none drop-shadow-sm rounded-2xl"
            referrerPolicy="no-referrer"
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.4 }}
          />
        </div>

        {/* Heading in High-Contrast Apple Display Typography */}
        <motion.div 
          key={selectedCode}
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mt-2.5 mb-1 px-2"
        >
          <h2 className="text-[21px] sm:text-[23px] font-black text-[#1D1D1F] tracking-tight leading-tight drop-shadow-xs">
            {currentOption.headingText}
          </h2>
          <p className="text-[11.5px] font-semibold text-slate-500 mt-0.5 tracking-tight flex items-center justify-center gap-1">
            <Sparkles className="w-3 h-3 text-[#0071E3]" />
            <span>AI Voice & Reminders in Your Mother Tongue</span>
          </p>
        </motion.div>
      </div>

      {/* 2x3 Grid with SmartMed Color Texture & Tactile Two-Tone Split */}
      <div className="grid grid-cols-2 gap-3 max-w-[340px] mx-auto w-full mb-1 z-10">
        {languageOptions.map((item) => {
          const isSelected = selectedCode === item.code;
          return (
            <motion.button
              key={item.code}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => handleSelect(item)}
              className={`h-20 sm:h-22 rounded-[22px] relative overflow-hidden transition-all flex flex-col justify-center items-center p-2 shadow-md ${item.shadowColor} bg-gradient-to-b ${item.gradient} ${
                isSelected 
                  ? 'ring-4 ring-[#0071E3]/40 ring-offset-2 scale-[1.02] shadow-xl' 
                  : 'hover:opacity-95'
              }`}
            >
              {/* Glossy Top Sheen (Tactile split) */}
              <div className={`absolute top-0 left-0 right-0 h-1/2 ${item.topSheen} pointer-events-none rounded-t-[24px]`}>
                {/* Diagonal Glass Flare Reflection */}
                <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/20 to-transparent" />
              </div>

              {/* Clean Subtle Horizontal Divider */}
              <div className="absolute top-1/2 left-0 right-0 h-[1px] bg-black/10 pointer-events-none" />

              {/* Bottom Depth Tone */}
              <div className={`absolute bottom-0 left-0 right-0 h-1/2 ${item.bottomTone} pointer-events-none rounded-b-[24px]`} />

              {/* Language Typography */}
              <div className="relative z-10 flex flex-col items-center justify-center text-center">
                <span className="text-2xl font-black text-white tracking-wide drop-shadow-sm leading-none mb-1">
                  {item.native}
                </span>
                <span className="text-[10.5px] font-extrabold text-white/95 uppercase tracking-widest drop-shadow-xs">
                  {item.label}
                </span>
              </div>

              {/* Selection Checkmark Badge */}
              <AnimatePresence>
                {isSelected && (
                  <motion.div 
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    exit={{ scale: 0 }}
                    className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-white text-[#0071E3] flex items-center justify-center shadow-md z-20"
                  >
                    <Check className="w-3.5 h-3.5 stroke-[3]" />
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.button>
          );
        })}
      </div>
    </motion.div>
  );
}
