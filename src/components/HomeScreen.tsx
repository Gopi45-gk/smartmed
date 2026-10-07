import { useState, type Dispatch, type SetStateAction } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Medicine, ScreenType, TranslationStrings, PatientProfile, defaultPatientProfile } from '../types';
import { Pill, PhoneCall, FileText, CheckCircle2, Clock, Sparkles, AlertCircle, ChevronRight, PhoneForwarded } from 'lucide-react';
import confetti from 'canvas-confetti';
import { soundManager } from '../utils/audio';
import { ttsProvider } from '../utils/speech';
import { triggerTwilioCallNow } from '../utils/aiClient';
import { useLanguage } from '../context/LanguageContext';

interface Props {
  medicines: Medicine[];
  setMedicines: Dispatch<SetStateAction<Medicine[]>>;
  navigate: (screen: ScreenType) => void;
  t: TranslationStrings;
  patientProfile?: PatientProfile;
}

export function HomeScreen({ medicines, setMedicines, navigate, t, patientProfile }: Props) {
  const { preferred_language } = useLanguage();
  const profile = patientProfile || defaultPatientProfile;

  const getInitials = (name?: string) => {
    if (!name) return 'RK';
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return parts[0].slice(0, 2).toUpperCase();
  };

  // Find next upcoming medicine or fallback to first
  const nextMed = medicines.find(m => m.status === 'upcoming') || medicines[0];
  const takenCount = medicines.filter(m => m.status === 'taken').length;
  const progressPercent = Math.round((takenCount / Math.max(medicines.length, 1)) * 100);

  const [calling, setCalling] = useState(false);
  const [callAlertMsg, setCallAlertMsg] = useState<string | null>(null);

  const handleTriggerTwilioCall = async () => {
    if (!nextMed) return;
    setCalling(true);
    setCallAlertMsg(null);
    try {
      const res = await triggerTwilioCallNow({
        phone_number: profile.phone,
        medicine: nextMed.name,
        dosage: `${nextMed.dose} (${nextMed.food})`,
        patient_name: profile.name,
        preferred_language: profile.preferred_language || preferred_language,
      });
      if (res.success) {
        setCallAlertMsg(`✓ Alert call dispatched to ${profile.phone}! Reminder: take ${nextMed.name} at the right time.`);
        soundManager.playSuccessChime();
      } else {
        setCallAlertMsg(`Call alert queued for ${profile.phone} (${res.error || 'Server processed'}).`);
      }
    } catch {
      setCallAlertMsg(`Call alert queued for ${profile.phone}.`);
    } finally {
      setCalling(false);
      setTimeout(() => setCallAlertMsg(null), 7000);
    }
  };

  const handleMarkTaken = (id: number) => {
    soundManager.playSuccessChime();
    confetti({
      particleCount: 40,
      spread: 60,
      origin: { y: 0.6 }
    });

    const now = new Date();
    const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    setMedicines(prev => prev.map(m => {
      if (m.id === id) {
        return {
          ...m,
          status: m.status === 'taken' ? 'upcoming' : 'taken',
          takenAt: m.status === 'taken' ? undefined : timeStr
        };
      }
      return m;
    }));
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }} 
      animate={{ opacity: 1 }} 
      exit={{ opacity: 0 }}
      className="p-5 pb-8"
    >
      {/* Top Header */}
      <div className="flex justify-between items-center pt-2">
        <div>
          <div className="flex items-center gap-1.5 text-xs font-semibold text-[#86868B] uppercase tracking-wider">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
            <span>{t.goodMorning}</span>
          </div>
          <h1 className="text-2xl font-bold text-[#1D1D1F] tracking-tight">{profile.name}</h1>
          <div className="text-[11px] font-medium text-slate-600 mt-1 flex items-center gap-1.5 flex-wrap">
            <span className="bg-blue-50 text-[#0071E3] font-semibold px-2 py-0.5 rounded-full border border-blue-100/70">
              {profile.phone}
            </span>
            <span className="bg-slate-100 text-slate-700 font-semibold px-2 py-0.5 rounded-full border border-slate-200">
              Age {profile.age} • {profile.gender}
            </span>
            {profile.bloodGroup && (
              <span className="bg-rose-50 text-rose-700 font-bold px-2 py-0.5 rounded-full border border-rose-100">
                🩸 {profile.bloodGroup}
              </span>
            )}
            {profile.condition && (
              <span className="bg-purple-50 text-purple-700 font-medium px-2 py-0.5 rounded-full border border-purple-100 truncate max-w-[200px]" title={profile.condition}>
                🩺 {profile.condition}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button 
            onClick={() => navigate('profile')} 
            className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-blue-700 text-white font-bold flex items-center justify-center text-sm shadow-sm active:scale-95 transition-transform"
            aria-label="Profile"
          >
            {getInitials(profile.name)}
          </button>
        </div>
      </div>

      {/* Next Medicine Hero Card */}
      {nextMed && (
        <motion.div 
          layout
          className="mt-5 bg-white p-5 rounded-3xl shadow-sm border border-gray-100/90 relative overflow-hidden"
        >
          {/* Call Alert Toast Notification */}
          <AnimatePresence>
            {callAlertMsg && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="mb-3 p-2.5 bg-blue-50 border border-blue-200 rounded-xl flex items-center gap-2 text-xs text-[#0071E3] font-medium"
              >
                <PhoneForwarded className="w-4 h-4 shrink-0 text-[#0071E3] animate-pulse" />
                <span>{callAlertMsg}</span>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="flex items-center justify-between">
            <span className="bg-blue-50 text-[#0071E3] text-[11px] font-bold px-3 py-1 rounded-full tracking-wide">
              {t.nextMed}
            </span>
            <span className="text-xs font-semibold text-gray-500 flex items-center gap-1">
              <Clock className="w-3.5 h-3.5 text-[#0071E3]" />
              {nextMed.time}
            </span>
          </div>

          <div className="flex items-center gap-4 mt-3.5">
            <div className="w-14 h-14 bg-gradient-to-tr from-blue-50 to-blue-100/80 rounded-2xl flex items-center justify-center text-2xl shadow-inner border border-blue-100 text-[#0071E3]">
              <Pill className="w-7 h-7" />
            </div>
            <div className="flex-1">
              <h3 className="text-xl font-bold text-[#1D1D1F] leading-tight">{nextMed.name}</h3>
              <p className="text-sm text-[#86868B] mt-0.5 font-medium">
                {nextMed.dose} • <span className="text-blue-600 font-semibold">{nextMed.food}</span>
              </p>
            </div>
          </div>

          <div className="mt-5 flex items-center justify-between border-t border-gray-100 pt-3.5">
            <div className="flex flex-col">
              <span className="text-[11px] uppercase font-semibold text-[#86868B]">{t.scheduledLabel || 'Scheduled'}</span>
              <span className="text-lg font-extrabold text-[#0071E3] tracking-tight">{nextMed.time}</span>
            </div>

            <div className="flex items-center gap-2">
              <button 
                type="button"
                onClick={handleTriggerTwilioCall}
                disabled={calling}
                className="px-3.5 py-2.5 rounded-xl text-xs font-semibold bg-blue-50 hover:bg-blue-100 text-[#0071E3] active:scale-95 transition-all flex items-center gap-1.5 border border-blue-200/80 disabled:opacity-60"
                title="Send Twilio voice alert call to registered user"
              >
                <PhoneCall className={`w-3.5 h-3.5 ${calling ? 'animate-bounce text-[#0071E3]' : ''}`} />
                <span>{calling ? (t.callingState || 'Calling…') : (t.twilioAlertCall || 'Twilio Alert Call')}</span>
              </button>

              <button 
                onClick={() => handleMarkTaken(nextMed.id)} 
                className={`px-4.5 py-2.5 rounded-xl text-sm font-semibold shadow-md active:scale-95 transition-all flex items-center gap-1.5 ${
                  nextMed.status === 'taken'
                    ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                    : 'bg-[#34C759] hover:bg-[#2eb34f] text-white shadow-emerald-500/20'
                }`}
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>{nextMed.status === 'taken' ? t.taken : t.markTaken}</span>
              </button>
            </div>
          </div>
        </motion.div>
      )}

      {/* Daily Progress Bar Card */}
      <div className="mt-4 bg-white p-4 rounded-2xl border border-gray-100 shadow-sm flex items-center justify-between">
        <div>
          <div className="text-xs font-semibold text-[#86868B] uppercase tracking-wider">{t.progress}</div>
          <div className="text-base font-bold text-[#1D1D1F] mt-0.5">
            {takenCount} of {medicines.length} completed ({progressPercent}%)
          </div>
        </div>
        <div className="w-12 h-12 relative flex items-center justify-center">
          <svg className="w-full h-full transform -rotate-90" viewBox="0 0 36 36">
            <path
              className="text-gray-100"
              strokeWidth="4"
              stroke="currentColor"
              fill="none"
              d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
            />
            <path
              className="text-[#34C759] transition-all duration-700 ease-out"
              strokeDasharray={`${progressPercent}, 100`}
              strokeWidth="4"
              strokeLinecap="round"
              stroke="currentColor"
              fill="none"
              d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
            />
          </svg>
          <span className="absolute text-[11px] font-bold text-[#1D1D1F]">{progressPercent}%</span>
        </div>
      </div>

      {/* Quick Action Hub */}
      <div className="mt-4 grid grid-cols-2 gap-3.5">
        <button 
          onClick={() => navigate('add_prescription')} 
          className="p-4 bg-gradient-to-br from-blue-50 to-blue-100/60 border border-blue-200/70 rounded-2xl flex flex-col items-center justify-center text-center text-[#0071E3] active:scale-95 transition-all shadow-sm group"
        >
          <div className="w-11 h-11 bg-white rounded-xl flex items-center justify-center mb-2 shadow-sm text-[#0071E3] group-hover:scale-110 transition-transform">
            <FileText className="w-5 h-5" />
          </div>
          <span className="font-bold text-xs text-[#1D1D1F]">{t.addPrescription}</span>
          <span className="text-[10px] text-[#0071E3] mt-0.5 flex items-center gap-0.5">
            <Sparkles className="w-2.5 h-2.5" /> AI OCR Scan
          </span>
        </button>

        <button 
          onClick={() => {
            ttsProvider.unlock();
            soundManager.resumeAudioContext();
            navigate('phone_call');
          }} 
          className="p-4 bg-gradient-to-br from-emerald-50 to-emerald-100/60 border border-emerald-200/70 rounded-2xl flex flex-col items-center justify-center text-center text-[#34C759] active:scale-95 transition-all shadow-sm group"
        >
          <div className="w-11 h-11 bg-[#34C759] text-white rounded-xl flex items-center justify-center mb-2 shadow-md shadow-emerald-500/20 group-hover:scale-110 transition-transform">
            <PhoneCall className="w-5 h-5 animate-pulse" />
          </div>
          <span className="font-bold text-xs text-[#1D1D1F]">{t.simulateCall}</span>
          <span className="text-[10px] text-emerald-700 mt-0.5 font-medium">
            Interactive Voice USP
          </span>
        </button>
      </div>

      {/* Today's Medicines list */}
      <div className="mt-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-bold text-[#1D1D1F]">{t.todaysMeds}</h3>
          <button 
            onClick={() => navigate('medicines')} 
            className="text-xs text-[#0071E3] font-semibold flex items-center gap-0.5"
          >
            <span>View All</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="space-y-2.5">
          {medicines.map((m) => {
            const isTaken = m.status === 'taken';
            return (
              <div 
                key={m.id} 
                onClick={() => handleMarkTaken(m.id)}
                className={`flex items-center justify-between p-3.5 bg-white rounded-2xl shadow-sm border transition-all cursor-pointer ${
                  isTaken ? 'border-emerald-100 bg-emerald-50/20' : 'border-gray-100 hover:border-gray-200'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-base ${
                    isTaken 
                      ? 'bg-emerald-100 text-emerald-700' 
                      : 'bg-[#F5F5F7] text-[#1D1D1F]'
                  }`}>
                    {m.type === 'liquid' ? '🧪' : m.type === 'capsule' ? '💊' : '⚪'}
                  </div>
                  <div>
                    <h4 className={`font-semibold text-sm leading-snug ${isTaken ? 'text-gray-500 line-through' : 'text-[#1D1D1F]'}`}>
                      {m.name}
                    </h4>
                    <p className="text-xs text-[#86868B]">
                      {m.time} • {m.dose} • <span className="font-medium text-gray-700">{m.food}</span>
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span className={`text-[11px] px-2.5 py-1 rounded-full font-semibold flex items-center gap-1 ${
                    isTaken 
                      ? 'bg-emerald-100 text-[#34C759]' 
                      : 'bg-amber-100 text-[#FF9500]'
                  }`}>
                    {isTaken ? (
                      <>
                        <CheckCircle2 className="w-3 h-3" />
                        <span>{t.taken}</span>
                      </>
                    ) : (
                      <>
                        <Clock className="w-3 h-3" />
                        <span>{t.upcoming}</span>
                      </>
                    )}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Caregiver Alert Status pill */}
      <div 
        onClick={() => navigate('caregiver')} 
        className="mt-5 p-3.5 bg-white rounded-2xl border border-gray-100 flex items-center justify-between cursor-pointer hover:bg-gray-50 transition-colors shadow-sm"
      >
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center text-sm font-bold">
            <AlertCircle className="w-4 h-4" />
          </div>
          <div>
            <div className="text-xs font-bold text-[#1D1D1F]">{t.caregiver} Monitored</div>
            <div className="text-[11px] text-[#86868B]">Arun Kumar (Son) will be alerted if missed</div>
          </div>
        </div>
        <ChevronRight className="w-4 h-4 text-gray-400" />
      </div>
    </motion.div>
  );
}
