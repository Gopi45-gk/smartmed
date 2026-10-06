import { useState } from 'react';
import type { Dispatch, SetStateAction, FormEvent, MouseEvent } from 'react';
import { motion } from 'motion/react';
import { Medicine, ScreenType, TranslationStrings } from '../types';
import { Plus, CheckCircle2, Clock, Trash2 } from 'lucide-react';
import confetti from 'canvas-confetti';
import { soundManager } from '../utils/audio';
import { scheduleTwilioCall } from '../utils/aiClient';

interface Props {
  medicines: Medicine[];
  setMedicines: Dispatch<SetStateAction<Medicine[]>>;
  navigate: (screen: ScreenType) => void;
  t: TranslationStrings;
}

export function MedicinesScreen({ medicines, setMedicines, navigate, t }: Props) {
  const [filter, setFilter] = useState<'all' | 'upcoming' | 'taken'>('all');
  const [showAddManual, setShowAddManual] = useState(false);
  const [newMedName, setNewMedName] = useState('');
  const [newMedTime, setNewMedTime] = useState('02:00 PM');
  const [newMedDose, setNewMedDose] = useState('1 Tablet');
  const [newMedFood, setNewMedFood] = useState('After Food');
  const [newMedType, setNewMedType] = useState<Medicine['type']>('tablet');

  const filteredMeds = medicines.filter(m => {
    if (filter === 'upcoming') return m.status === 'upcoming';
    if (filter === 'taken') return m.status === 'taken';
    return true;
  });

  const handleToggleTaken = (id: number) => {
    soundManager.playSuccessChime();
    confetti({ particleCount: 30, spread: 50, origin: { y: 0.6 } });
    setMedicines(prev => prev.map(m => {
      if (m.id === id) {
        return {
          ...m,
          status: m.status === 'taken' ? 'upcoming' : 'taken',
          takenAt: m.status === 'taken' ? undefined : new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };
      }
      return m;
    }));
  };

  const handleDelete = (id: number, e: MouseEvent) => {
    e.stopPropagation();
    setMedicines(prev => prev.filter(m => m.id !== id));
  };

  const handleAddManual = (e: FormEvent) => {
    e.preventDefault();
    if (!newMedName.trim()) return;

    const newMed: Medicine = {
      id: Date.now(),
      name: newMedName.trim(),
      time: newMedTime,
      dose: newMedDose,
      food: newMedFood,
      status: 'upcoming',
      type: newMedType
    };

    setMedicines(prev => [...prev, newMed]);

    // Schedule Twilio voice reminder
    try {
      let patientPhone = '+919876543210';
      let patientName = 'Patient';
      try {
        const storedProfile = localStorage.getItem('smartmed_patient_profile');
        if (storedProfile) {
          const profile = JSON.parse(storedProfile);
          if (profile.phone) patientPhone = profile.phone;
          if (profile.name) patientName = profile.name;
        }
      } catch {}

      const now = new Date();
      let triggerIso = new Date(Date.now() + 5 * 60 * 1000).toISOString();
      const match = newMedTime.trim().match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
      if (match) {
        let hours = parseInt(match[1], 10);
        const minutes = parseInt(match[2], 10);
        const meridiem = match[3] ? match[3].toUpperCase() : null;
        if (meridiem === 'PM' && hours < 12) hours += 12;
        if (meridiem === 'AM' && hours === 12) hours = 0;
        const target = new Date();
        target.setHours(hours, minutes, 0, 0);
        if (target.getTime() <= now.getTime()) {
          target.setDate(target.getDate() + 1);
        }
        triggerIso = target.toISOString();
      }

      scheduleTwilioCall({
        phone_number: patientPhone,
        medicine: newMedName.trim(),
        dosage: newMedDose.trim(),
        trigger_time: triggerIso,
        patient_name: patientName,
      }).catch(err => console.warn('[Twilio Manual Schedule Error]', err));
    } catch (e) {
      console.warn('[Twilio] Error scheduling manual call:', e);
    }

    setNewMedName('');
    setShowAddManual(false);
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }} 
      animate={{ opacity: 1 }} 
      exit={{ opacity: 0 }}
      className="p-5 pb-8"
    >
      <div className="flex items-center justify-between pt-2 mb-4">
        <div>
          <h2 className="text-2xl font-bold text-[#1D1D1F] tracking-tight">{t.medicines}</h2>
          <p className="text-xs text-[#86868B] mt-0.5">Manage dosage schedules & reminders</p>
        </div>
        <button 
          onClick={() => navigate('add_prescription')}
          className="px-3 py-2 bg-[#0071E3] text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow-sm active:scale-95 transition-transform"
        >
          <Plus className="w-4 h-4" />
          <span>Scan Rx</span>
        </button>
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-2 p-1 bg-gray-200/70 rounded-xl mb-4 text-xs font-semibold">
        {(['all', 'upcoming', 'taken'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setFilter(tab)}
            className={`flex-1 py-1.5 rounded-lg capitalize transition-all ${
              filter === tab ? 'bg-white text-[#1D1D1F] shadow-sm' : 'text-gray-600 hover:text-black'
            }`}
          >
            {tab === 'all' ? 'All Meds' : tab === 'upcoming' ? t.upcoming : t.taken}
          </button>
        ))}
      </div>

      {/* Medicine List */}
      <div className="space-y-3">
        {filteredMeds.length === 0 ? (
          <div className="p-8 text-center bg-white rounded-2xl border border-gray-100 text-gray-400">
            <p className="text-sm">No medicines found in this category.</p>
          </div>
        ) : (
          filteredMeds.map((med) => {
            const isTaken = med.status === 'taken';
            return (
              <div 
                key={med.id}
                onClick={() => handleToggleTaken(med.id)}
                className={`p-4 bg-white rounded-2xl border transition-all shadow-sm cursor-pointer ${
                  isTaken ? 'border-emerald-100 bg-emerald-50/20' : 'border-gray-100 hover:border-gray-200'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`w-11 h-11 rounded-xl flex items-center justify-center text-lg ${
                      isTaken ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-50 text-blue-600'
                    }`}>
                      {med.type === 'liquid' ? '🧪' : med.type === 'capsule' ? '💊' : '⚪'}
                    </div>
                    <div>
                      <h3 className={`font-bold text-base ${isTaken ? 'text-gray-500 line-through' : 'text-[#1D1D1F]'}`}>
                        {med.name}
                      </h3>
                      <div className="flex items-center gap-2 text-xs text-[#86868B] mt-0.5">
                        <span className="font-semibold text-blue-600">{med.time}</span>
                        <span>•</span>
                        <span>{med.dose}</span>
                        <span>•</span>
                        <span className="font-medium text-gray-700">{med.food}</span>
                      </div>
                    </div>
                  </div>

                  <button 
                    onClick={(e) => handleDelete(med.id, e)}
                    className="p-1.5 text-gray-400 hover:text-red-500 transition-colors"
                    title="Delete medicine"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                <div className="mt-3 pt-3 border-t border-gray-100 flex items-center justify-between text-xs">
                  <span className={`px-2.5 py-1 rounded-full font-semibold flex items-center gap-1 ${
                    isTaken ? 'bg-emerald-100 text-[#34C759]' : 'bg-amber-100 text-[#FF9500]'
                  }`}>
                    {isTaken ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Clock className="w-3.5 h-3.5" />}
                    <span>{isTaken ? `Taken at ${med.takenAt || med.time}` : 'Scheduled'}</span>
                  </span>

                  <button className="font-semibold text-[#0071E3] hover:underline">
                    {isTaken ? 'Undo Mark' : t.markTaken}
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Manual Add Trigger */}
      {!showAddManual ? (
        <button 
          onClick={() => setShowAddManual(true)}
          className="w-full mt-4 py-3 bg-[#F5F5F7] border border-dashed border-gray-300 rounded-2xl text-xs font-bold text-[#0071E3] flex items-center justify-center gap-2 hover:bg-gray-100 transition-colors"
        >
          <Plus className="w-4 h-4" />
          <span>+ Add Custom Medicine Manually</span>
        </button>
      ) : (
        <form onSubmit={handleAddManual} className="mt-4 p-4 bg-white rounded-2xl border border-gray-200 shadow-md space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="font-bold text-sm text-[#1D1D1F]">Add New Medicine</h4>
            <button 
              type="button" 
              onClick={() => setShowAddManual(false)} 
              className="text-xs text-gray-500 font-semibold"
            >
              Cancel
            </button>
          </div>

          <div>
            <label className="text-[11px] font-semibold text-gray-500 uppercase">Medicine Name</label>
            <input 
              type="text" 
              placeholder="e.g. Paracetamol 650mg" 
              value={newMedName} 
              onChange={(e) => setNewMedName(e.target.value)} 
              required
              className="w-full mt-1 p-2.5 bg-[#F5F5F7] rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-[#0071E3]"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[11px] font-semibold text-gray-500 uppercase">Timing</label>
              <input 
                type="text" 
                value={newMedTime} 
                onChange={(e) => setNewMedTime(e.target.value)} 
                className="w-full mt-1 p-2.5 bg-[#F5F5F7] rounded-xl border border-gray-200 text-xs focus:outline-none"
              />
            </div>
            <div>
              <label className="text-[11px] font-semibold text-gray-500 uppercase">Dosage</label>
              <input 
                type="text" 
                value={newMedDose} 
                onChange={(e) => setNewMedDose(e.target.value)} 
                className="w-full mt-1 p-2.5 bg-[#F5F5F7] rounded-xl border border-gray-200 text-xs focus:outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[11px] font-semibold text-gray-500 uppercase">Food Relation</label>
              <select 
                value={newMedFood} 
                onChange={(e) => setNewMedFood(e.target.value)}
                className="w-full mt-1 p-2 bg-[#F5F5F7] rounded-xl border border-gray-200 text-xs focus:outline-none"
              >
                <option value="After Food">After Food</option>
                <option value="Before Food">Before Food</option>
                <option value="With Meal">With Meal</option>
                <option value="Empty Stomach">Empty Stomach</option>
              </select>
            </div>
            <div>
              <label className="text-[11px] font-semibold text-gray-500 uppercase">Form</label>
              <select 
                value={newMedType} 
                onChange={(e) => setNewMedType(e.target.value as Medicine['type'])}
                className="w-full mt-1 p-2 bg-[#F5F5F7] rounded-xl border border-gray-200 text-xs focus:outline-none"
              >
                <option value="tablet">Tablet</option>
                <option value="capsule">Capsule</option>
                <option value="liquid">Syrup / Liquid</option>
                <option value="injection">Injection</option>
              </select>
            </div>
          </div>

          <button 
            type="submit" 
            className="w-full py-2.5 bg-[#0071E3] text-white text-xs font-bold rounded-xl shadow-md"
          >
            Save Medicine
          </button>
        </form>
      )}
    </motion.div>
  );
}
