import { useState } from 'react';
import { motion } from 'motion/react';
import { TranslationStrings, PatientProfile, defaultPatientProfile } from '../types';
import { ShieldCheck, ArrowRight, User, Phone, Calendar, HeartPulse, Activity } from 'lucide-react';

interface Props {
  next: (profile?: PatientProfile) => void;
  t: TranslationStrings;
  currentProfile?: PatientProfile;
}

export function LoginScreen({ next, t, currentProfile }: Props) {
  const initial = currentProfile || defaultPatientProfile;

  const [mode, setMode] = useState<'register' | 'login'>('register');
  const [name, setName] = useState(initial.name || 'Ravi Kumar');
  const [phone, setPhone] = useState(initial.phone || '+91 98765 43210');
  const [age, setAge] = useState(String(initial.age || '64'));
  const [gender, setGender] = useState(initial.gender || 'Male');
  const [condition, setCondition] = useState(initial.condition || 'Hypertension & Diabetes');
  const [bloodGroup, setBloodGroup] = useState(initial.bloodGroup || 'B+');

  const [otpSent, setOtpSent] = useState(false);
  const [otp, setOtp] = useState(['4', '8', '2', '9']);

  const handleContinue = () => {
    if (!otpSent) {
      setOtpSent(true);
    } else {
      const profile: PatientProfile = {
        name: name.trim() || 'Ravi Kumar',
        phone: phone.trim() || '+91 98765 43210',
        age: age.trim() || '64',
        gender,
        condition: condition.trim() || 'Hypertension & Diabetes',
        bloodGroup,
        registeredAt: new Date().toISOString(),
      };
      try {
        localStorage.setItem('smartmed_patient_profile', JSON.stringify(profile));
      } catch {
        // ignore storage errors
      }
      next(profile);
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }} 
      animate={{ opacity: 1, y: 0 }} 
      exit={{ opacity: 0, y: -20 }}
      className="flex flex-col h-full p-6 justify-between bg-white overflow-y-auto"
    >
      <div className="mt-4">
        {/* Top Header Logo */}
        <div className="w-14 h-14 rounded-2xl overflow-hidden shadow-sm mb-4 border border-blue-100 bg-white p-1.5 flex items-center justify-center">
          <img 
            src="/app-logo.png" 
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).src = 'https://www.image2url.com/r2/default/images/1788602801147-04408589-eef8-4f09-b739-692ee2b681ae.png';
            }}
            alt="SmartMed Logo" 
            className="w-full h-full object-contain rounded-xl"
            referrerPolicy="no-referrer"
          />
        </div>

        {/* Tab Toggle: Register / Login */}
        <div className="flex bg-[#F5F5F7] p-1 rounded-xl mb-4 border border-gray-200/60 max-w-sm">
          <button
            type="button"
            onClick={() => setMode('register')}
            className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all ${
              mode === 'register' ? 'bg-white text-[#1D1D1F] shadow-xs' : 'text-[#86868B]'
            }`}
          >
            Register Patient
          </button>
          <button
            type="button"
            onClick={() => setMode('login')}
            className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all ${
              mode === 'login' ? 'bg-white text-[#1D1D1F] shadow-xs' : 'text-[#86868B]'
            }`}
          >
            Patient Login
          </button>
        </div>

        <h2 className="text-2xl font-bold text-[#1D1D1F] tracking-tight">
          {otpSent ? 'Verify Phone Number' : (mode === 'register' ? 'Patient Registration' : t.enterMobile)}
        </h2>
        <p className="text-[#86868B] text-xs mt-1 leading-relaxed">
          {otpSent 
            ? `Enter the 4-digit code sent to ${phone} to activate your dashboard.`
            : (mode === 'register' 
                ? 'Register patient primary medical profile for personalized AI care.'
                : t.enterMobileSub)}
        </p>

        {!otpSent ? (
          <div className="mt-5 space-y-3.5">
            {/* Full Name Field */}
            <div>
              <label className="text-[11px] font-semibold text-[#86868B] uppercase tracking-wider block mb-1">
                Patient Full Name
              </label>
              <div className="relative">
                <input 
                  type="text" 
                  value={name} 
                  onChange={(e) => setName(e.target.value)} 
                  placeholder="e.g. Ravi Kumar" 
                  className="w-full p-3 pl-10 bg-[#F5F5F7] rounded-xl border border-gray-200 text-sm font-medium text-[#1D1D1F] focus:outline-none focus:border-[#0071E3] focus:bg-white transition-all shadow-inner" 
                />
                <User className="w-4 h-4 text-gray-400 absolute left-3.5 top-3.5" />
              </div>
            </div>

            {/* Mobile Number Field */}
            <div>
              <label className="text-[11px] font-semibold text-[#86868B] uppercase tracking-wider block mb-1">
                {t.mobileLabel}
              </label>
              <div className="relative">
                <input 
                  type="tel" 
                  value={phone} 
                  onChange={(e) => setPhone(e.target.value)} 
                  placeholder="+91 98765 43210" 
                  className="w-full p-3 pl-10 bg-[#F5F5F7] rounded-xl border border-gray-200 text-sm font-medium text-[#1D1D1F] focus:outline-none focus:border-[#0071E3] focus:bg-white transition-all shadow-inner" 
                />
                <Phone className="w-4 h-4 text-gray-400 absolute left-3.5 top-3.5" />
              </div>
            </div>

            {mode === 'register' && (
              <>
                {/* Age & Gender Row */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] font-semibold text-[#86868B] uppercase tracking-wider block mb-1">
                      Age
                    </label>
                    <div className="relative">
                      <input 
                        type="number" 
                        value={age} 
                        onChange={(e) => setAge(e.target.value)} 
                        placeholder="64" 
                        min="1" 
                        max="120"
                        className="w-full p-3 pl-10 bg-[#F5F5F7] rounded-xl border border-gray-200 text-sm font-medium text-[#1D1D1F] focus:outline-none focus:border-[#0071E3] focus:bg-white transition-all shadow-inner" 
                      />
                      <Calendar className="w-4 h-4 text-gray-400 absolute left-3.5 top-3.5" />
                    </div>
                  </div>

                  <div>
                    <label className="text-[11px] font-semibold text-[#86868B] uppercase tracking-wider block mb-1">
                      Gender
                    </label>
                    <select
                      value={gender}
                      onChange={(e) => setGender(e.target.value)}
                      className="w-full p-3 bg-[#F5F5F7] rounded-xl border border-gray-200 text-sm font-medium text-[#1D1D1F] focus:outline-none focus:border-[#0071E3] focus:bg-white transition-all shadow-inner"
                    >
                      <option value="Male">Male</option>
                      <option value="Female">Female</option>
                      <option value="Other">Other</option>
                    </select>
                  </div>
                </div>

                {/* Primary Condition & Blood Group */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-2">
                    <label className="text-[11px] font-semibold text-[#86868B] uppercase tracking-wider block mb-1">
                      Primary Condition
                    </label>
                    <div className="relative">
                      <input 
                        type="text" 
                        value={condition} 
                        onChange={(e) => setCondition(e.target.value)} 
                        placeholder="Hypertension & Diabetes" 
                        className="w-full p-3 pl-9 bg-[#F5F5F7] rounded-xl border border-gray-200 text-xs font-medium text-[#1D1D1F] focus:outline-none focus:border-[#0071E3] focus:bg-white transition-all shadow-inner truncate" 
                      />
                      <Activity className="w-3.5 h-3.5 text-gray-400 absolute left-3 top-3.5" />
                    </div>
                  </div>

                  <div>
                    <label className="text-[11px] font-semibold text-[#86868B] uppercase tracking-wider block mb-1">
                      Blood Group
                    </label>
                    <select
                      value={bloodGroup}
                      onChange={(e) => setBloodGroup(e.target.value)}
                      className="w-full p-3 bg-[#F5F5F7] rounded-xl border border-gray-200 text-xs font-bold text-[#1D1D1F] focus:outline-none focus:border-[#0071E3] focus:bg-white transition-all shadow-inner"
                    >
                      <option value="B+">B+</option>
                      <option value="O+">O+</option>
                      <option value="A+">A+</option>
                      <option value="AB+">AB+</option>
                      <option value="B-">B-</option>
                      <option value="O-">O-</option>
                      <option value="A-">A-</option>
                      <option value="AB-">AB-</option>
                    </select>
                  </div>
                </div>
              </>
            )}

            <div className="pt-1 flex items-center gap-2 text-xs text-[#86868B]">
              <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>Used exclusively for your scheduled AI care calls & dashboard tracking</span>
            </div>
          </div>
        ) : (
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-6"
          >
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-[#86868B] uppercase tracking-wider">
                Verification Code
              </label>
              <button 
                type="button"
                onClick={() => setOtpSent(false)} 
                className="text-xs text-[#0071E3] font-medium"
              >
                Change Details
              </button>
            </div>
            <p className="text-xs text-[#86868B] mb-3">Sent 4-digit code to {phone}</p>
            <div className="flex gap-3 justify-between max-w-xs">
              {otp.map((digit, idx) => (
                <input
                  key={idx}
                  type="text"
                  maxLength={1}
                  value={digit}
                  onChange={(e) => {
                    const newOtp = [...otp];
                    newOtp[idx] = e.target.value;
                    setOtp(newOtp);
                  }}
                  className="w-14 h-14 bg-[#F5F5F7] rounded-2xl border border-gray-200 text-center text-xl font-bold text-[#1D1D1F] focus:border-[#0071E3] focus:bg-white focus:outline-none"
                />
              ))}
            </div>
          </motion.div>
        )}
      </div>

      <div className="pt-6 pb-2">
        <button 
          type="button"
          onClick={handleContinue} 
          className="w-full py-4 bg-[#0071E3] hover:bg-[#0062c4] text-white rounded-2xl font-semibold shadow-lg shadow-blue-500/25 active:scale-98 transition-all flex items-center justify-center gap-2"
        >
          <span>{otpSent ? 'Verify & Continue' : (mode === 'register' ? 'Register & Continue' : t.getOtpBtn)}</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </motion.div>
  );
}
