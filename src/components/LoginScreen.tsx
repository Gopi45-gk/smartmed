import { useState } from 'react';
import { motion } from 'motion/react';
import { TranslationStrings, PatientProfile, defaultPatientProfile } from '../types';
import { ShieldCheck, ArrowRight, User, Phone, Calendar, HeartPulse, Activity, Lock, Loader2, AlertTriangle } from 'lucide-react';
import { registerPatient, loginPatient } from '../firebase';
import { useLanguage } from '../context/LanguageContext';

interface Props {
  next: (profile?: PatientProfile) => void;
  t: TranslationStrings;
  currentProfile?: PatientProfile;
}

export function LoginScreen({ next, t, currentProfile }: Props) {
  const { preferred_language, setLanguage } = useLanguage();
  const initial = currentProfile || defaultPatientProfile;

  const [mode, setMode] = useState<'register' | 'login'>('register');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [age, setAge] = useState('');
  const [gender, setGender] = useState('Male');
  const [condition, setCondition] = useState('');
  const [bloodGroup, setBloodGroup] = useState('B+');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // Login-only fields
  const [loginPhone, setLoginPhone] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleRegister = async () => {
    setError('');

    // Validation
    if (!name.trim()) { setError('Please enter your full name.'); return; }
    if (!phone.trim() || phone.replace(/[\s+\-()]/g, '').length < 10) { setError('Please enter a valid phone number.'); return; }
    if (!age.trim() || isNaN(Number(age)) || Number(age) < 1 || Number(age) > 120) { setError('Please enter a valid age (1-120).'); return; }
    if (!password.trim() || password.length < 4) { setError('Password must be at least 4 characters.'); return; }
    if (password !== confirmPassword) { setError('Passwords do not match.'); return; }

    setLoading(true);
    const result = await registerPatient({
      name: name.trim(),
      phone: phone.trim(),
      age: age.trim(),
      gender,
      condition: condition.trim(),
      bloodGroup,
      password,
      preferred_language,
    });
    setLoading(false);

    if (!result.success) {
      setError(result.error || 'Registration failed.');
      return;
    }

    // Build profile and proceed
    const profile: PatientProfile = {
      name: name.trim(),
      phone: phone.trim(),
      age: age.trim(),
      gender,
      condition: condition.trim() || 'N/A',
      bloodGroup,
      registeredAt: new Date().toISOString(),
      preferred_language,
    };
    try { localStorage.setItem('smartmed_patient_profile', JSON.stringify(profile)); } catch { /* ignore */ }
    next(profile);
  };

  const handleLogin = async () => {
    setError('');

    if (!loginPhone.trim() || loginPhone.replace(/[\s+\-()]/g, '').length < 10) { setError('Please enter a valid phone number.'); return; }
    if (!loginPassword.trim()) { setError('Please enter your password.'); return; }

    setLoading(true);
    const result = await loginPatient(loginPhone.trim(), loginPassword);
    setLoading(false);

    if (!result.success) {
      setError(result.error || 'Login failed.');
      return;
    }

    const profile = result.profile!;
    if (profile.preferred_language) {
      setLanguage(profile.preferred_language, profile.phone);
    }
    try { localStorage.setItem('smartmed_patient_profile', JSON.stringify(profile)); } catch { /* ignore */ }
    next(profile);
  };

  const handleContinue = () => {
    if (mode === 'register') {
      handleRegister();
    } else {
      handleLogin();
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
            onClick={() => { setMode('register'); setError(''); }}
            className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all ${
              mode === 'register' ? 'bg-white text-[#1D1D1F] shadow-xs' : 'text-[#86868B]'
            }`}
          >
            Register Patient
          </button>
          <button
            type="button"
            onClick={() => { setMode('login'); setError(''); }}
            className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all ${
              mode === 'login' ? 'bg-white text-[#1D1D1F] shadow-xs' : 'text-[#86868B]'
            }`}
          >
            Patient Login
          </button>
        </div>

        <h2 className="text-2xl font-bold text-[#1D1D1F] tracking-tight">
          {mode === 'register' ? 'Patient Registration' : t.enterMobile}
        </h2>
        <p className="text-[#86868B] text-xs mt-1 leading-relaxed">
          {mode === 'register' 
            ? 'Register patient primary medical profile for personalized AI care.'
            : t.enterMobileSub}
        </p>

        {/* Error Banner */}
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -5 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-3 p-3 bg-red-50 border border-red-200 rounded-xl flex items-start gap-2"
          >
            <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
            <span className="text-xs text-red-700 font-medium">{error}</span>
          </motion.div>
        )}

        {mode === 'register' ? (
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

            {/* Password Fields */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-semibold text-[#86868B] uppercase tracking-wider block mb-1">
                  Password
                </label>
                <div className="relative">
                  <input 
                    type="password" 
                    value={password} 
                    onChange={(e) => setPassword(e.target.value)} 
                    placeholder="Min 4 chars" 
                    className="w-full p-3 pl-10 bg-[#F5F5F7] rounded-xl border border-gray-200 text-sm font-medium text-[#1D1D1F] focus:outline-none focus:border-[#0071E3] focus:bg-white transition-all shadow-inner" 
                  />
                  <Lock className="w-4 h-4 text-gray-400 absolute left-3.5 top-3.5" />
                </div>
              </div>
              <div>
                <label className="text-[11px] font-semibold text-[#86868B] uppercase tracking-wider block mb-1">
                  Confirm Password
                </label>
                <div className="relative">
                  <input 
                    type="password" 
                    value={confirmPassword} 
                    onChange={(e) => setConfirmPassword(e.target.value)} 
                    placeholder="Re-enter" 
                    className="w-full p-3 pl-10 bg-[#F5F5F7] rounded-xl border border-gray-200 text-sm font-medium text-[#1D1D1F] focus:outline-none focus:border-[#0071E3] focus:bg-white transition-all shadow-inner" 
                  />
                  <Lock className="w-4 h-4 text-gray-400 absolute left-3.5 top-3.5" />
                </div>
              </div>
            </div>

            <div className="pt-1 flex items-center gap-2 text-xs text-[#86868B]">
              <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>Used exclusively for your scheduled AI care calls & dashboard tracking</span>
            </div>
          </div>
        ) : (
          /* ===== LOGIN MODE ===== */
          <div className="mt-5 space-y-3.5">
            {/* Mobile Number Field */}
            <div>
              <label className="text-[11px] font-semibold text-[#86868B] uppercase tracking-wider block mb-1">
                {t.mobileLabel}
              </label>
              <div className="relative">
                <input 
                  type="tel" 
                  value={loginPhone} 
                  onChange={(e) => setLoginPhone(e.target.value)} 
                  placeholder="+91 98765 43210" 
                  className="w-full p-3 pl-10 bg-[#F5F5F7] rounded-xl border border-gray-200 text-sm font-medium text-[#1D1D1F] focus:outline-none focus:border-[#0071E3] focus:bg-white transition-all shadow-inner" 
                />
                <Phone className="w-4 h-4 text-gray-400 absolute left-3.5 top-3.5" />
              </div>
            </div>

            {/* Password Field */}
            <div>
              <label className="text-[11px] font-semibold text-[#86868B] uppercase tracking-wider block mb-1">
                Password
              </label>
              <div className="relative">
                <input 
                  type="password" 
                  value={loginPassword} 
                  onChange={(e) => setLoginPassword(e.target.value)} 
                  placeholder="Enter your password" 
                  className="w-full p-3 pl-10 bg-[#F5F5F7] rounded-xl border border-gray-200 text-sm font-medium text-[#1D1D1F] focus:outline-none focus:border-[#0071E3] focus:bg-white transition-all shadow-inner" 
                />
                <Lock className="w-4 h-4 text-gray-400 absolute left-3.5 top-3.5" />
              </div>
            </div>

            <div className="pt-1 flex items-center gap-2 text-xs text-[#86868B]">
              <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>Your data is securely stored and used for personalized AI care</span>
            </div>
          </div>
        )}
      </div>

      <div className="pt-6 pb-2">
        <button 
          type="button"
          onClick={handleContinue} 
          disabled={loading}
          className="w-full py-4 bg-[#0071E3] hover:bg-[#0062c4] disabled:opacity-60 disabled:cursor-not-allowed text-white rounded-2xl font-semibold shadow-lg shadow-blue-500/25 active:scale-98 transition-all flex items-center justify-center gap-2"
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>{mode === 'register' ? 'Registering…' : 'Logging in…'}</span>
            </>
          ) : (
            <>
              <span>{mode === 'register' ? 'Register & Continue' : t.getOtpBtn}</span>
              <ArrowRight className="w-4 h-4" />
            </>
          )}
        </button>
      </div>
    </motion.div>
  );
}
