import { useState } from 'react';
import { motion } from 'motion/react';
import { TranslationStrings, PatientProfile, defaultPatientProfile, Language } from '../types';
import { ShieldCheck, ArrowRight, User, Phone, Calendar, HeartPulse, Activity, Lock, Loader2, AlertTriangle, Globe, ChevronDown } from 'lucide-react';
import { registerPatient, loginPatient } from '../firebase';
import { useLanguage } from '../context/LanguageContext';

interface Props {
  next: (profile?: PatientProfile) => void;
  t: TranslationStrings;
  currentProfile?: PatientProfile;
}

const SUPPORTED_LANGUAGES: { code: Language; name: string; native: string }[] = [
  { code: 'en', name: 'English', native: 'English' },
  { code: 'ta', name: 'Tamil', native: 'தமிழ்' },
  { code: 'hi', name: 'Hindi', native: 'हिन्दी' },
  { code: 'te', name: 'Telugu', native: 'తెలుగు' },
  { code: 'bn', name: 'Bengali', native: 'বাংলা' },
  { code: 'mr', name: 'Marathi', native: 'मराठी' },
  { code: 'kn', name: 'Kannada', native: 'ಕನ್ನಡ' },
  { code: 'ml', name: 'Malayalam', native: 'മലയാളം' },
  { code: 'ur', name: 'Urdu', native: 'اردو' }
];

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
  const [showLangMenu, setShowLangMenu] = useState(false);

  const currentLangObj = SUPPORTED_LANGUAGES.find(l => l.code === preferred_language) || SUPPORTED_LANGUAGES[0];

  const handleRegister = async () => {
    setError('');

    // Validation
    if (!name.trim()) { setError(t.nameRequired || 'Please enter your full name.'); return; }
    if (!phone.trim() || phone.replace(/[\s+\-()]/g, '').length < 10) { setError(t.phoneRequired || 'Please enter a valid phone number.'); return; }
    if (!age.trim() || isNaN(Number(age)) || Number(age) < 1 || Number(age) > 120) { setError(t.ageRequired || 'Please enter a valid age (1-120).'); return; }
    if (!password.trim() || password.length < 4) { setError(t.passwordRequired || 'Password must be at least 4 characters.'); return; }
    if (password !== confirmPassword) { setError(t.passwordMismatch || 'Passwords do not match.'); return; }

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
      setError(result.error || t.regFailed || 'Registration failed.');
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

    if (!loginPhone.trim() || loginPhone.replace(/[\s+\-()]/g, '').length < 10) { setError(t.phoneRequired || 'Please enter a valid phone number.'); return; }
    if (!loginPassword.trim()) { setError(t.passwordRequired || 'Please enter your password.'); return; }

    setLoading(true);
    const result = await loginPatient(loginPhone.trim(), loginPassword);
    setLoading(false);

    if (!result.success) {
      setError(result.error || t.loginFailed || 'Login failed.');
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
      <div className="mt-2">
        {/* Top Header Bar: Logo + Pre-Authentication Language Switcher */}
        <div className="flex items-center justify-between mb-4">
          <div className="w-13 h-13 rounded-2xl overflow-hidden shadow-xs border border-blue-100 bg-white p-1.5 flex items-center justify-center">
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

          {/* Language Selector Pill */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowLangMenu(!showLangMenu)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#F5F5F7] hover:bg-gray-200/80 active:scale-95 text-xs font-bold text-gray-800 border border-gray-200 transition-all cursor-pointer shadow-2xs"
              aria-label="Change Language"
            >
              <Globe className="w-3.5 h-3.5 text-[#0071E3]" />
              <span>{currentLangObj.native}</span>
              <ChevronDown className="w-3 h-3 text-gray-500" />
            </button>

            {showLangMenu && (
              <div className="absolute right-0 mt-1.5 w-48 bg-white rounded-2xl shadow-xl border border-gray-200/80 py-1.5 z-50 animate-in fade-in zoom-in-95 duration-150">
                <div className="px-3 py-1 text-[10px] font-bold text-gray-400 uppercase tracking-wider border-b border-gray-100 mb-1">
                  {t.selectLanguage || 'Select Language'}
                </div>
                <div className="max-h-60 overflow-y-auto">
                  {SUPPORTED_LANGUAGES.map((item) => (
                    <button
                      key={item.code}
                      type="button"
                      onClick={() => {
                        setLanguage(item.code);
                        setShowLangMenu(false);
                      }}
                      className={`w-full px-3 py-1.5 text-left text-xs flex items-center justify-between hover:bg-blue-50 transition-colors ${
                        preferred_language === item.code ? 'font-bold text-[#0071E3] bg-blue-50/60' : 'text-gray-700 font-medium'
                      }`}
                    >
                      <span>{item.native}</span>
                      <span className="text-[10px] text-gray-400 font-normal">{item.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
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
            {t.registerPatientTab || 'Register Patient'}
          </button>
          <button
            type="button"
            onClick={() => { setMode('login'); setError(''); }}
            className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all ${
              mode === 'login' ? 'bg-white text-[#1D1D1F] shadow-xs' : 'text-[#86868B]'
            }`}
          >
            {t.patientLoginTab || 'Patient Login'}
          </button>
        </div>

        <h2 className="text-2xl font-bold text-[#1D1D1F] tracking-tight">
          {mode === 'register' ? (t.patientRegTitle || 'Patient Registration') : t.enterMobile}
        </h2>
        <p className="text-[#86868B] text-xs mt-1 leading-relaxed">
          {mode === 'register' 
            ? (t.patientRegSub || 'Register patient primary medical profile for personalized AI care.')
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
                {t.patientFullName || 'Patient Full Name'}
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
                  {t.age || 'Age'}
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
                  {t.genderLabel || 'Gender'}
                </label>
                <select
                  value={gender}
                  onChange={(e) => setGender(e.target.value)}
                  className="w-full p-3 bg-[#F5F5F7] rounded-xl border border-gray-200 text-sm font-medium text-[#1D1D1F] focus:outline-none focus:border-[#0071E3] focus:bg-white transition-all shadow-inner"
                >
                  <option value="Male">{t.male || 'Male'}</option>
                  <option value="Female">{t.female || 'Female'}</option>
                  <option value="Other">{t.other || 'Other'}</option>
                </select>
              </div>
            </div>

            {/* Primary Condition & Blood Group */}
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <label className="text-[11px] font-semibold text-[#86868B] uppercase tracking-wider block mb-1">
                  {t.primaryConditionLabel || 'Primary Condition'}
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
                  {t.bloodGroup || 'Blood Group'}
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
                  {t.passwordLabel || 'Password'}
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
                  {t.confirmPasswordLabel || 'Confirm Password'}
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
              <span>{t.securityNotice || 'Used exclusively for your scheduled AI care calls & dashboard tracking'}</span>
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
                {t.passwordLabel || 'Password'}
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
              <span>{t.securityNotice || 'Your data is securely stored and used for personalized AI care'}</span>
            </div>
          </div>
        )}
      </div>

      <div className="pt-6 pb-2">
        <button 
          type="button"
          onClick={handleContinue} 
          disabled={loading}
          className="w-full py-4 bg-[#0071E3] hover:bg-[#0062c4] disabled:opacity-60 disabled:cursor-not-allowed text-white rounded-2xl font-semibold shadow-lg shadow-blue-500/25 active:scale-98 transition-all flex items-center justify-center gap-2 cursor-pointer"
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>{mode === 'register' ? (t.registerContinueBtn || 'Registering…') : (t.loginContinueBtn || 'Logging in…')}</span>
            </>
          ) : (
            <>
              <span>{mode === 'register' ? (t.registerContinueBtn || 'Register & Continue') : (t.loginContinueBtn || t.getOtpBtn)}</span>
              <ArrowRight className="w-4 h-4" />
            </>
          )}
        </button>
      </div>
    </motion.div>
  );
}
