import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Language, TranslationStrings, PatientProfile, defaultPatientProfile, Caregiver } from '../types';
import { initialCaregivers } from '../data/initialData';
import { 
  Globe, LogOut, Heart, AlertCircle, ChevronRight, Check, 
  Volume2, ShieldCheck, Users, Pencil, Phone, Stethoscope, X 
} from 'lucide-react';
import { soundManager } from '../utils/audio';

interface Props {
  currentLang: Language;
  setLang: (lang: Language) => void;
  t: TranslationStrings;
  logout: () => void;
  onNavigateToCaregiver?: () => void;
  patientProfile?: PatientProfile;
  caregivers?: Caregiver[];
  onUpdateCaregivers?: (caregivers: Caregiver[]) => void;
}

export function ProfileScreen({ 
  currentLang, 
  setLang, 
  t, 
  logout, 
  onNavigateToCaregiver, 
  patientProfile,
  caregivers = initialCaregivers,
  onUpdateCaregivers 
}: Props) {
  const profile = patientProfile || defaultPatientProfile;
  const [showLangModal, setShowLangModal] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);

  // Retrieve current primary caregiver & doctor
  const primaryCaregiver = caregivers.find(c => c.isPrimary) || caregivers[0] || {
    id: 1,
    name: 'Arun Kumar',
    relation: 'Son',
    phone: '+91 98765 12345',
    isPrimary: true,
  };

  const doctor = caregivers.find(c => 
    c.relation?.toLowerCase().includes('doctor') || 
    c.relation?.toLowerCase().includes('cardio') || 
    c.relation?.toLowerCase().includes('physician') || 
    c.name?.toLowerCase().startsWith('dr')
  ) || caregivers[1] || {
    id: 2,
    name: 'Dr. Priya Menon',
    relation: 'Cardiologist',
    phone: '+91 98401 98765',
    isPrimary: false,
  };

  // Alter Caregiver & Doctor Details Modal Form State
  const [showAlterModal, setShowAlterModal] = useState(false);
  const [cgName, setCgName] = useState(primaryCaregiver.name);
  const [cgRelation, setCgRelation] = useState(primaryCaregiver.relation);
  const [cgPhone, setCgPhone] = useState(primaryCaregiver.phone);

  const [docName, setDocName] = useState(doctor.name);
  const [docSpecialty, setDocSpecialty] = useState(doctor.relation);
  const [docPhone, setDocPhone] = useState(doctor.phone);

  const handleOpenAlterModal = () => {
    setCgName(primaryCaregiver.name);
    setCgRelation(primaryCaregiver.relation);
    setCgPhone(primaryCaregiver.phone);
    setDocName(doctor.name);
    setDocSpecialty(doctor.relation);
    setDocPhone(doctor.phone);
    setShowAlterModal(true);
  };

  const handleSaveAlterDetails = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!cgName.trim() || !docName.trim()) return;

    const currentList = caregivers && caregivers.length > 0 ? caregivers : initialCaregivers;

    const updatedCg: Caregiver = {
      ...primaryCaregiver,
      id: primaryCaregiver.id || 1,
      name: cgName.trim(),
      relation: cgRelation.trim() || 'Family',
      phone: cgPhone.trim(),
      isPrimary: true,
      alertEnabled: true,
    };

    const updatedDoc: Caregiver = {
      ...doctor,
      id: doctor.id || 2,
      name: docName.trim(),
      relation: docSpecialty.trim() || 'Physician',
      phone: docPhone.trim(),
      isPrimary: false,
      alertEnabled: true,
    };

    const remaining = currentList.filter(
      c => c.id !== primaryCaregiver.id && c.id !== doctor.id
    );

    const fullUpdatedList: Caregiver[] = [updatedCg, updatedDoc, ...remaining];
    try {
      localStorage.setItem('smartmed_caregivers', JSON.stringify(fullUpdatedList));
    } catch (err) {
      console.warn('Failed to save updated caregivers:', err);
    }

    onUpdateCaregivers?.(fullUpdatedList);
    soundManager.playSuccessChime();
    setShowAlterModal(false);
  };

  const getInitials = (name?: string) => {
    if (!name) return 'RK';
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return parts[0].slice(0, 2).toUpperCase();
  };

  const languages: { code: Language; name: string; native: string }[] = [
    { code: 'en', name: 'English', native: 'English' },
    { code: 'ta', name: 'Tamil', native: 'தமிழ்' },
    { code: 'te', name: 'Telugu', native: 'తెలుగు' },
    { code: 'ml', name: 'Malayalam', native: 'മലയാളം' },
    { code: 'kn', name: 'Kannada', native: 'ಕನ್ನಡ' },
    { code: 'hi', name: 'Hindi', native: 'हिन्दी' },
    { code: 'ur', name: 'Urdu', native: 'اردو' }
  ];

  return (
    <motion.div 
      initial={{ opacity: 0 }} 
      animate={{ opacity: 1 }} 
      exit={{ opacity: 0 }}
      className="p-5 pb-8"
    >
      <div className="pt-2 mb-4">
        <h2 className="text-2xl font-bold text-[#1D1D1F] tracking-tight">{t.profile}</h2>
        <p className="text-xs text-[#86868B] mt-0.5">Account & Medical Emergency ID</p>
      </div>

      {/* User Card */}
      <div className="bg-white p-5 rounded-3xl shadow-sm border border-gray-100 flex items-center gap-4">
        <div className="w-16 h-16 bg-gradient-to-tr from-blue-500 to-blue-600 rounded-2xl flex items-center justify-center font-extrabold text-2xl text-white shadow-md shadow-blue-500/25">
          {getInitials(profile.name)}
        </div>
        <div>
          <h3 className="font-bold text-lg text-[#1D1D1F]">{profile.name}</h3>
          <p className="text-xs text-[#86868B] mt-0.5">{profile.phone}</p>
          <div className="flex items-center gap-1.5 mt-2 flex-wrap">
            <span className="text-[10px] bg-blue-50 text-[#0071E3] font-bold px-2.5 py-0.5 rounded-full border border-blue-100">
              Age {profile.age} • {profile.gender}
            </span>
            <span className="text-[10px] bg-emerald-50 text-emerald-700 font-bold px-2.5 py-0.5 rounded-full border border-emerald-100">
              Active Patient
            </span>
            {profile.condition && (
              <span className="text-[10px] bg-purple-50 text-purple-700 font-bold px-2.5 py-0.5 rounded-full border border-purple-100 truncate max-w-[150px]">
                {profile.condition}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Emergency Medical ID Card */}
      <div className="mt-4 bg-white p-5 rounded-3xl shadow-sm border border-red-100 relative overflow-hidden">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-7 h-7 rounded-lg bg-red-50 text-red-600 flex items-center justify-center">
            <Heart className="w-4 h-4 fill-red-500" />
          </div>
          <h4 className="text-xs font-bold text-red-900 uppercase tracking-wider">{t.emergencyInfo}</h4>
        </div>

        <div className="grid grid-cols-2 gap-3 text-xs">
          <div className="p-3 bg-red-50/50 rounded-xl border border-red-100/80">
            <span className="text-[10px] uppercase font-bold text-red-500 block">Blood Group</span>
            <span className="font-extrabold text-sm text-[#1D1D1F] mt-0.5 block">{profile.bloodGroup || t.bloodGroup}</span>
          </div>

          <div className="p-3 bg-red-50/50 rounded-xl border border-red-100/80">
            <span className="text-[10px] uppercase font-bold text-red-500 block">Known Allergies</span>
            <span className="font-bold text-xs text-[#1D1D1F] mt-0.5 block truncate">{t.allergies}</span>
          </div>
        </div>

        <div className="mt-3 flex items-center gap-2 text-[11px] text-gray-500">
          <AlertCircle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
          <span>Paramedics and emergency doctors can view this without unlocking</span>
        </div>
      </div>

      {/* Caregiver & Doctor Contacts Card with Alter Option */}
      <div className="mt-4 bg-white p-5 rounded-3xl shadow-sm border border-purple-100 relative overflow-hidden">
        <div className="flex items-center justify-between mb-3.5">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center">
              <Users className="w-4 h-4" />
            </div>
            <div>
              <h4 className="text-xs font-bold text-purple-900 uppercase tracking-wider">Caregiver & Doctor Contacts</h4>
              <p className="text-[10px] text-gray-500">Emergency call and medical consult recipients</p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleOpenAlterModal}
            className="px-3 py-1.5 rounded-xl bg-purple-50 hover:bg-purple-100 active:scale-95 text-purple-700 font-bold text-xs flex items-center gap-1.5 transition-all border border-purple-200/80 cursor-pointer"
          >
            <Pencil className="w-3.5 h-3.5" />
            <span>Alter Details</span>
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          {/* Primary Caregiver Box */}
          <div className="p-3.5 bg-purple-50/50 rounded-2xl border border-purple-100/80 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase font-bold text-purple-600 block">Primary Caregiver</span>
                <span className="text-[9px] bg-purple-200/70 text-purple-900 font-extrabold px-1.5 py-0.2 rounded-md">SOS Call</span>
              </div>
              <span className="font-extrabold text-sm text-[#1D1D1F] mt-1 block">
                {primaryCaregiver.name} <span className="text-xs font-medium text-gray-500">({primaryCaregiver.relation})</span>
              </span>
            </div>
            <div className="mt-2 text-xs font-bold text-blue-600 flex items-center gap-1">
              <Phone className="w-3 h-3 text-blue-500" />
              <span>{primaryCaregiver.phone}</span>
            </div>
          </div>

          {/* Primary Doctor Box */}
          <div className="p-3.5 bg-blue-50/50 rounded-2xl border border-blue-100/80 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase font-bold text-blue-600 block">Personal Doctor</span>
                <span className="text-[9px] bg-blue-200/70 text-blue-900 font-extrabold px-1.5 py-0.2 rounded-md">Medical</span>
              </div>
              <span className="font-extrabold text-sm text-[#1D1D1F] mt-1 block">
                {doctor.name} <span className="text-xs font-medium text-gray-500">({doctor.relation})</span>
              </span>
            </div>
            <div className="mt-2 text-xs font-bold text-blue-600 flex items-center gap-1">
              <Stethoscope className="w-3 h-3 text-blue-500" />
              <span>{doctor.phone}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Preferences & Settings */}
      <div className="mt-4 bg-white rounded-3xl border border-gray-100 shadow-sm divide-y divide-gray-100 overflow-hidden">
        <button 
          onClick={() => setShowLangModal(true)}
          className="w-full p-4 text-left flex items-center justify-between hover:bg-gray-50 transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-50 text-[#0071E3] flex items-center justify-center">
              <Globe className="w-4 h-4" />
            </div>
            <div>
              <div className="text-sm font-semibold text-[#1D1D1F]">{t.changeLanguage}</div>
              <div className="text-xs text-[#86868B] capitalize">Current: {languages.find(l => l.code === currentLang)?.native}</div>
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-gray-400" />
        </button>

        {onNavigateToCaregiver && (
          <div className="p-4 flex items-center justify-between hover:bg-gray-50 transition-colors">
            <button 
              onClick={onNavigateToCaregiver}
              className="flex items-center gap-3 text-left flex-1"
            >
              <div className="w-9 h-9 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center">
                <Users className="w-4 h-4" />
              </div>
              <div>
                <div className="text-sm font-semibold text-[#1D1D1F]">{t.caregiver} Network</div>
                <div className="text-xs text-[#86868B]">{primaryCaregiver.name} ({primaryCaregiver.relation}) • {doctor.name}</div>
              </div>
            </button>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleOpenAlterModal}
                className="px-2.5 py-1 rounded-lg bg-purple-50 hover:bg-purple-100 text-purple-700 font-bold text-xs transition-colors"
              >
                Alter
              </button>
              <ChevronRight 
                onClick={onNavigateToCaregiver} 
                className="w-4 h-4 text-gray-400 cursor-pointer" 
              />
            </div>
          </div>
        )}

        <div className="p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <Volume2 className="w-4 h-4" />
            </div>
            <div>
              <div className="text-sm font-semibold text-[#1D1D1F]">Voice & Audio Prompts</div>
              <div className="text-xs text-[#86868B]">Chimes & AI Speech Synthesis</div>
            </div>
          </div>
          <button 
            onClick={() => setSoundEnabled(!soundEnabled)}
            className={`w-12 h-7 rounded-full transition-colors relative p-1 ${
              soundEnabled ? 'bg-[#34C759]' : 'bg-gray-300'
            }`}
          >
            <div className={`w-5 h-5 rounded-full bg-white transition-transform ${
              soundEnabled ? 'translate-x-5' : 'translate-x-0'
            }`} />
          </button>
        </div>

        <div className="p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <div>
              <div className="text-sm font-semibold text-[#1D1D1F]">Clinical Safety Protocol</div>
              <div className="text-xs text-[#86868B]">HIPAA Compliant & End-to-End Encrypted</div>
            </div>
          </div>
          <span className="text-[10px] font-bold text-purple-700 bg-purple-50 px-2.5 py-1 rounded-full">
            Active
          </span>
        </div>
      </div>

      {/* App Branding & Logo */}
      <div className="mt-5 p-4 rounded-3xl bg-white border border-gray-100 shadow-sm flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-blue-50/80 p-1 border border-blue-100 flex items-center justify-center overflow-hidden">
            <img 
              src="/app-logo.png" 
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).src = 'https://www.image2url.com/r2/default/images/1788602801147-04408589-eef8-4f09-b739-692ee2b681ae.png';
              }}
              alt="SmartMed" 
              className="w-full h-full object-contain"
              referrerPolicy="no-referrer"
            />
          </div>
          <div>
            <div className="text-xs font-bold text-[#1D1D1F]">SmartMed AI Care Companion</div>
            <div className="text-[10px] text-[#86868B]">Version 2.4 (Build 2026.9) • Secure Care</div>
          </div>
        </div>
        <span className="text-[10px] font-extrabold text-[#0071E3] bg-blue-50 px-2 py-0.5 rounded-full border border-blue-100">
          Official
        </span>
      </div>

      {/* Logout button */}
      <button 
        onClick={logout} 
        className="w-full mt-5 py-4 bg-red-50 text-red-600 hover:bg-red-100 font-bold rounded-2xl text-xs flex items-center justify-center gap-2 transition-colors border border-red-100"
      >
        <LogOut className="w-4 h-4" />
        <span>{t.logout}</span>
      </button>

      {/* Alter Caregiver & Doctor Details Form Modal */}
      <AnimatePresence>
        {showAlterModal && (
          <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center p-4">
            <motion.div 
              initial={{ y: 100, opacity: 0 }} 
              animate={{ y: 0, opacity: 1 }} 
              exit={{ y: 100, opacity: 0 }}
              className="bg-white rounded-3xl p-6 w-full max-w-md shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto"
            >
              <div className="flex items-center justify-between border-b border-gray-100 pb-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center">
                    <Pencil className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="font-extrabold text-base text-[#1D1D1F]">Alter Caregiver & Doctor</h3>
                    <p className="text-[11px] text-gray-500">Update emergency SOS and physician contacts</p>
                  </div>
                </div>
                <button 
                  type="button"
                  onClick={() => setShowAlterModal(false)}
                  className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-500 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleSaveAlterDetails} className="space-y-4">
                {/* Caregiver Section */}
                <div className="p-4 bg-purple-50/50 rounded-2xl border border-purple-100/70 space-y-3">
                  <span className="text-xs font-bold text-purple-900 uppercase tracking-wide block">
                    1. Primary Caregiver (SOS Emergency Call)
                  </span>

                  <div>
                    <label className="text-[11px] font-bold text-gray-600 block mb-1">Caregiver Full Name</label>
                    <input 
                      type="text" 
                      required
                      placeholder="e.g. Arun Kumar" 
                      value={cgName} 
                      onChange={(e) => setCgName(e.target.value)} 
                      className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 bg-white text-sm font-semibold focus:outline-none focus:border-purple-600 focus:ring-1 focus:ring-purple-600"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2.5">
                    <div>
                      <label className="text-[11px] font-bold text-gray-600 block mb-1">Relationship</label>
                      <input 
                        type="text" 
                        required
                        placeholder="e.g. Son, Daughter" 
                        value={cgRelation} 
                        onChange={(e) => setCgRelation(e.target.value)} 
                        className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 bg-white text-sm font-semibold focus:outline-none focus:border-purple-600 focus:ring-1 focus:ring-purple-600"
                      />
                    </div>

                    <div>
                      <label className="text-[11px] font-bold text-gray-600 block mb-1">Phone Number</label>
                      <input 
                        type="tel" 
                        required
                        placeholder="e.g. +91 98765 12345" 
                        value={cgPhone} 
                        onChange={(e) => setCgPhone(e.target.value)} 
                        className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 bg-white text-sm font-semibold focus:outline-none focus:border-purple-600 focus:ring-1 focus:ring-purple-600"
                      />
                    </div>
                  </div>
                </div>

                {/* Doctor Section */}
                <div className="p-4 bg-blue-50/50 rounded-2xl border border-blue-100/70 space-y-3">
                  <span className="text-xs font-bold text-blue-900 uppercase tracking-wide block">
                    2. Primary Doctor / Physician
                  </span>

                  <div>
                    <label className="text-[11px] font-bold text-gray-600 block mb-1">Doctor Name</label>
                    <input 
                      type="text" 
                      required
                      placeholder="e.g. Dr. Priya Menon" 
                      value={docName} 
                      onChange={(e) => setDocName(e.target.value)} 
                      className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 bg-white text-sm font-semibold focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2.5">
                    <div>
                      <label className="text-[11px] font-bold text-gray-600 block mb-1">Specialty</label>
                      <input 
                        type="text" 
                        required
                        placeholder="e.g. Cardiologist" 
                        value={docSpecialty} 
                        onChange={(e) => setDocSpecialty(e.target.value)} 
                        className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 bg-white text-sm font-semibold focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
                      />
                    </div>

                    <div>
                      <label className="text-[11px] font-bold text-gray-600 block mb-1">Doctor Phone</label>
                      <input 
                        type="tel" 
                        required
                        placeholder="e.g. +91 98401 98765" 
                        value={docPhone} 
                        onChange={(e) => setDocPhone(e.target.value)} 
                        className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 bg-white text-sm font-semibold focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
                      />
                    </div>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="pt-2 flex items-center gap-3">
                  <button 
                    type="submit" 
                    className="flex-1 py-3 px-4 bg-[#0071E3] hover:bg-[#0077ED] active:scale-98 text-white font-extrabold text-sm rounded-xl shadow-md shadow-blue-500/25 transition-all"
                  >
                    Save Altered Details
                  </button>

                  <button 
                    type="button" 
                    onClick={() => setShowAlterModal(false)}
                    className="py-3 px-4 bg-gray-100 hover:bg-gray-200 active:scale-98 text-gray-700 font-bold text-sm rounded-xl transition-all"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Language Switch Modal */}
      <AnimatePresence>
        {showLangModal && (
          <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-4">
            <motion.div 
              initial={{ y: 100, opacity: 0 }} 
              animate={{ y: 0, opacity: 1 }} 
              exit={{ y: 100, opacity: 0 }}
              className="bg-white rounded-3xl p-6 w-full max-w-sm shadow-2xl space-y-4"
            >
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-lg text-[#1D1D1F]">{t.selectLanguage}</h3>
                <button 
                  onClick={() => setShowLangModal(false)}
                  className="text-xs font-semibold text-gray-500"
                >
                  Close
                </button>
              </div>

              <div className="space-y-2">
                {languages.map((l) => (
                  <button
                    key={l.code}
                    onClick={() => {
                      setLang(l.code);
                      setShowLangModal(false);
                    }}
                    className={`w-full p-3.5 rounded-xl border flex items-center justify-between text-left transition-all ${
                      currentLang === l.code 
                        ? 'border-[#0071E3] bg-blue-50/50 text-[#0071E3] font-bold' 
                        : 'border-gray-200 text-gray-800 hover:bg-gray-50'
                    }`}
                  >
                    <div>
                      <span className="text-base font-semibold block">{l.native}</span>
                      <span className="text-xs text-gray-500">{l.name}</span>
                    </div>
                    {currentLang === l.code && <Check className="w-5 h-5 text-[#0071E3] stroke-[2.5]" />}
                  </button>
                ))}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
