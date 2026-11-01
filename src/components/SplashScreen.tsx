import { useEffect } from 'react';
import { motion } from 'motion/react';
import { TranslationStrings } from '../types';
import { HeartPulse, Sparkles } from 'lucide-react';
import { soundManager } from '../utils/audio';

interface Props {
  t: TranslationStrings;
  onStart?: () => void;
}

export function SplashScreen({ t, onStart }: Props) {
  const handleStart = () => {
    soundManager.resumeAudioContext();
    soundManager.playSuccessChime();
    onStart?.();
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }} 
      animate={{ opacity: 1 }} 
      exit={{ opacity: 0, scale: 0.97 }} 
      transition={{ duration: 0.35 }}
      onClick={handleStart}
      className="relative flex-1 flex flex-col items-center justify-center w-full h-full min-h-full bg-gradient-to-b from-[#FFFFFF] via-[#F8FAFC] to-[#EEF4FF] px-6 overflow-hidden select-none cursor-pointer"
    >
      {/* Soft Ambient Radial Background Glows */}
      <motion.div 
        animate={{ 
          scale: [1, 1.25, 1],
          opacity: [0.3, 0.5, 0.3]
        }}
        transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
        className="absolute w-80 h-80 rounded-full bg-gradient-to-tr from-blue-400/25 to-sky-300/20 blur-3xl pointer-events-none"
      />

      <motion.div 
        animate={{ 
          scale: [1.2, 1, 1.2],
          opacity: [0.2, 0.4, 0.2]
        }}
        transition={{ duration: 5, repeat: Infinity, ease: "easeInOut", delay: 0.8 }}
        className="absolute w-72 h-72 rounded-full bg-gradient-to-br from-emerald-400/15 to-teal-300/15 blur-3xl pointer-events-none"
      />

      {/* Main Logo Container */}
      <div className="relative flex flex-col items-center justify-center z-10">
        {/* Outward Concentric Pulse Ring 1 */}
        <motion.div 
          animate={{ 
            scale: [1, 1.4, 1.7], 
            opacity: [0.5, 0.2, 0] 
          }}
          transition={{ 
            duration: 2.4, 
            repeat: Infinity, 
            ease: "easeOut" 
          }}
          className="absolute w-32 h-32 rounded-[42px] bg-blue-400/30 pointer-events-none"
        />

        {/* Outward Concentric Pulse Ring 2 */}
        <motion.div 
          animate={{ 
            scale: [1, 1.25, 1.5], 
            opacity: [0.6, 0.3, 0] 
          }}
          transition={{ 
            duration: 2.4, 
            repeat: Infinity, 
            ease: "easeOut",
            delay: 0.8
          }}
          className="absolute w-32 h-32 rounded-[42px] bg-[#0071E3]/25 pointer-events-none"
        />

        {/* 3D Glossy App Squircle Icon */}
        <motion.div 
          initial={{ scale: 0.5, opacity: 0, rotate: -6 }} 
          animate={{ scale: 1, opacity: 1, rotate: 0 }} 
          transition={{ 
            type: "spring", 
            stiffness: 280, 
            damping: 20, 
            delay: 0.08 
          }} 
          className="w-32 h-32 rounded-[36px] bg-white p-2 shadow-[0_20px_50px_rgba(0,113,227,0.35)] relative overflow-hidden flex items-center justify-center border-2 border-blue-50"
        >
          {/* Top Glass Sheen Highlight */}
          <div className="absolute top-0 left-0 right-0 h-1/2 bg-gradient-to-b from-white/70 via-white/20 to-transparent rounded-t-[34px] pointer-events-none z-10" />

          {/* Official App Logo */}
          <motion.img 
            src="/app-logo.png"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).src = 'https://www.image2url.com/r2/default/images/1788602801147-04408589-eef8-4f09-b739-692ee2b681ae.png';
            }}
            alt="SmartMed Logo" 
            className="w-full h-full object-contain rounded-[28px] select-none"
            referrerPolicy="no-referrer"
            animate={{ scale: [1, 1.04, 1] }}
            transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
          />

          {/* Active Pulse Radar Beacon */}
          <motion.div 
            animate={{ scale: [1, 1.35, 1], opacity: [0.8, 1, 0.8] }}
            transition={{ duration: 1.2, repeat: Infinity }}
            className="absolute bottom-2 right-2 w-4 h-4 bg-emerald-400 border-2 border-white rounded-full flex items-center justify-center shadow-md z-20"
          >
            <span className="w-1.5 h-1.5 bg-white rounded-full animate-ping" />
          </motion.div>
        </motion.div>

        {/* AI 2.0 Badge attached to bottom of logo */}
        <motion.div 
          initial={{ scale: 0, opacity: 0, y: 8 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          transition={{ delay: 0.3, type: "spring", stiffness: 350, damping: 20 }}
          className="absolute -bottom-3 px-3 py-1 bg-gradient-to-r from-emerald-500 to-teal-500 text-white text-[11px] font-extrabold rounded-full shadow-lg border-2 border-white flex items-center gap-1 z-20"
        >
          <Sparkles className="w-3.5 h-3.5 animate-spin" style={{ animationDuration: '4s' }} />
          <span>AI 2.0</span>
        </motion.div>
      </div>

      {/* App Name Title */}
      <motion.div
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25, duration: 0.4 }}
        className="mt-8 text-center z-10"
      >
        <h1 className="text-3xl font-extrabold text-[#1D1D1F] tracking-tight">
          {t.appName}
        </h1>
        <p className="text-xs font-semibold text-slate-400 tracking-wide mt-1">
          {t.tagline}
        </p>
      </motion.div>
    </motion.div>
  );
}
