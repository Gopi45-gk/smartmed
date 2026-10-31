import { useState } from 'react';
import type { FormEvent } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Caregiver, TranslationStrings } from '../types';
import { initialCaregivers } from '../data/initialData';
import { Users, Phone, ShieldCheck, Plus, Check, BellRing, MessageSquareText, AlertTriangle, Activity, ChevronRight } from 'lucide-react';
import { soundManager } from '../utils/audio';

interface Props {
  t: TranslationStrings;
  onOpenGlucosePortal?: () => void;
}

export function CaregiverScreen({ t, onOpenGlucosePortal }: Props) {
  const [caregivers, setCaregivers] = useState<Caregiver[]>(initialCaregivers);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [newRelation, setNewRelation] = useState('Daughter');
  const [newPhone, setNewPhone] = useState('+91 98123 45678');
  const [alertSent, setAlertSent] = useState<string | null>(null);

  const handleAddCaregiver = (e: FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;

    const newCaregiver: Caregiver = {
      id: Date.now(),
      name: newName.trim(),
      relation: newRelation,
      phone: newPhone,
      isPrimary: caregivers.length === 0,
      alertEnabled: true
    };

    setCaregivers(prev => [...prev, newCaregiver]);
    setNewName('');
    setShowAddModal(false);
    soundManager.playSuccessChime();
  };

  const handleTestAlert = (caregiverName: string) => {
    soundManager.playSuccessChime();
    setAlertSent(`Simulated WhatsApp SOS & SMS alert dispatched to ${caregiverName}`);
    setTimeout(() => {
      setAlertSent(null);
    }, 4000);
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }} 
      animate={{ opacity: 1 }} 
      exit={{ opacity: 0 }}
      className="p-5 pb-8"
    >
      <div className="pt-2 mb-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center">
            <Users className="w-4 h-4" />
          </div>
          <h2 className="text-2xl font-bold text-[#1D1D1F] tracking-tight">{t.caregiver}</h2>
        </div>
        <p className="text-xs text-[#86868B] mt-1">{t.caregiverSub}</p>
      </div>

      {/* Alert Banner simulation */}
      <AnimatePresence>
        {alertSent && (
          <motion.div 
            initial={{ opacity: 0, y: -10 }} 
            animate={{ opacity: 1, y: 0 }} 
            exit={{ opacity: 0, y: -10 }}
            className="mb-4 p-3 bg-emerald-50 border border-emerald-200 rounded-2xl flex items-center gap-2.5 text-xs text-emerald-800 font-semibold"
          >
            <BellRing className="w-4 h-4 text-emerald-600 shrink-0 animate-bounce" />
            <span>{alertSent}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Caregiver List */}
      <div className="space-y-3.5 mt-2">
        {caregivers.map((cg) => (
          <div 
            key={cg.id} 
            className="bg-white p-4.5 rounded-3xl shadow-sm border border-gray-100 flex flex-col justify-between"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3.5">
                <div className="w-12 h-12 bg-gradient-to-tr from-purple-50 to-purple-100 rounded-2xl flex items-center justify-center text-xl font-bold text-purple-700">
                  {cg.name.charAt(0)}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold text-base text-[#1D1D1F]">{cg.name}</h3>
                    {cg.isPrimary && (
                      <span className="text-[10px] bg-emerald-100 text-emerald-800 font-bold px-2 py-0.5 rounded-full">
                        {t.primaryBadge}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-[#86868B]">{cg.relation} • {cg.phone}</p>
                </div>
              </div>

              <a 
                href={`tel:${cg.phone}`}
                className="w-10 h-10 rounded-xl bg-[#F5F5F7] hover:bg-gray-200 flex items-center justify-center text-[#0071E3] transition-colors"
                title="Call Caregiver"
              >
                <Phone className="w-4 h-4" />
              </a>
            </div>

            <div className="mt-3.5 pt-3 border-t border-gray-100 flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-[11px] text-gray-600 font-medium">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                <span>{t.alertOnMissed}</span>
              </div>

              <button 
                onClick={() => handleTestAlert(cg.name)}
                className="text-xs font-bold text-[#0071E3] hover:underline flex items-center gap-1"
              >
                <MessageSquareText className="w-3 h-3" />
                <span>Test Alert</span>
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Add Caregiver Trigger */}
      <button 
        onClick={() => setShowAddModal(true)}
        className="w-full mt-4 py-4 bg-white border border-gray-200/90 text-[#0071E3] font-bold rounded-2xl text-sm shadow-sm active:scale-98 transition-all flex items-center justify-center gap-2 hover:bg-gray-50"
      >
        <Plus className="w-4 h-4" />
        <span>{t.addCaregiver}</span>
      </button>

      {/* Glucose & Lab Reports Caregiver Card (Feature Flag Guarded) */}
      {((import.meta as any).env?.VITE_ENABLE_GLUCOSE_FEATURES !== 'false') && onOpenGlucosePortal && (
        <div 
          onClick={onOpenGlucosePortal}
          className="mt-4 p-4 bg-gradient-to-r from-purple-900 to-indigo-950 text-white rounded-3xl shadow-sm border border-purple-800/80 flex items-center justify-between cursor-pointer active:scale-98 transition-all group"
        >
          <div className="flex items-center gap-3.5">
            <div className="w-11 h-11 bg-white/10 rounded-2xl flex items-center justify-center text-purple-200 border border-white/10 group-hover:scale-105 transition-transform">
              <Activity className="w-5 h-5 text-purple-200" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <h3 className="font-bold text-xs text-white">Glucose Trends &amp; Clinical Alerts</h3>
                <span className="text-[9px] bg-purple-500/30 text-purple-200 px-1.5 py-0.5 rounded-full font-bold">
                  LIVE
                </span>
              </div>
              <p className="text-[11px] text-purple-200 mt-0.5">
                Monitor glycemic ranges, automated rules, and lab reports
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1 text-xs text-purple-200 font-semibold group-hover:translate-x-0.5 transition-transform">
            <span>View</span>
            <ChevronRight className="w-4 h-4" />
          </div>
        </div>
      )}

      {/* Safety Protocol Note */}
      <div className="mt-6 p-4 bg-amber-50/70 border border-amber-200/70 rounded-2xl flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
        <div>
          <h4 className="text-xs font-bold text-amber-900">Safety Escalation Ladder</h4>
          <p className="text-[11px] text-amber-800/90 mt-0.5 leading-relaxed">
            If a patient fails to answer the AI call after 2 attempts within 30 minutes, an automated high-priority alert with live GPS is sent to primary caregivers.
          </p>
        </div>
      </div>

      {/* Add Modal */}
      <AnimatePresence>
        {showAddModal && (
          <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-4">
            <motion.div 
              initial={{ y: 100, opacity: 0 }} 
              animate={{ y: 0, opacity: 1 }} 
              exit={{ y: 100, opacity: 0 }}
              className="bg-white rounded-3xl p-6 w-full max-w-sm shadow-2xl space-y-4"
            >
              <h3 className="font-bold text-lg text-[#1D1D1F]">Add Family or Doctor</h3>
              <form onSubmit={handleAddCaregiver} className="space-y-3">
                <div>
                  <label className="text-xs font-semibold text-gray-500 uppercase">Full Name</label>
                  <input 
                    type="text" 
                    placeholder="e.g. Meena Kumar" 
                    value={newName} 
                    onChange={(e) => setNewName(e.target.value)} 
                    required 
                    className="w-full mt-1 p-3 bg-[#F5F5F7] rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-[#0071E3]"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-gray-500 uppercase">Relationship</label>
                    <select 
                      value={newRelation} 
                      onChange={(e) => setNewRelation(e.target.value)}
                      className="w-full mt-1 p-2.5 bg-[#F5F5F7] rounded-xl border border-gray-200 text-xs focus:outline-none"
                    >
                      <option value="Daughter">Daughter</option>
                      <option value="Son">Son</option>
                      <option value="Spouse">Spouse</option>
                      <option value="Doctor">Doctor</option>
                      <option value="Nurse">Nurse / Carer</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-gray-500 uppercase">Phone Number</label>
                    <input 
                      type="tel" 
                      value={newPhone} 
                      onChange={(e) => setNewPhone(e.target.value)}
                      className="w-full mt-1 p-2.5 bg-[#F5F5F7] rounded-xl border border-gray-200 text-xs focus:outline-none"
                    />
                  </div>
                </div>

                <div className="pt-3 flex gap-2">
                  <button 
                    type="button" 
                    onClick={() => setShowAddModal(false)}
                    className="flex-1 py-3 bg-gray-100 text-gray-700 font-semibold rounded-xl text-xs"
                  >
                    Cancel
                  </button>
                  <button 
                    type="submit" 
                    className="flex-1 py-3 bg-[#0071E3] text-white font-semibold rounded-xl text-xs flex items-center justify-center gap-1.5 shadow-md"
                  >
                    <Check className="w-4 h-4" />
                    <span>Save Contact</span>
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
