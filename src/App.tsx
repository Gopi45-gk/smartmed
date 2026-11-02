import { useState, useEffect } from 'react';
import { AnimatePresence } from 'motion/react';
import { ScreenType, TabType, Language, Medicine, PatientProfile, Caregiver, defaultPatientProfile } from './types';
import { translations } from './data/translations';
import { initialMedicines } from './data/initialData';
import { SplashScreen } from './components/SplashScreen';
import { LanguageScreen } from './components/LanguageScreen';
import { LoginScreen } from './components/LoginScreen';
import { HomeScreen } from './components/HomeScreen';
import { MedicinesScreen } from './components/MedicinesScreen';
import { AddPrescriptionFlow } from './components/AddPrescriptionFlow';
import { PhoneCallSimulation } from './components/PhoneCallSimulation';
import { CaregiverScreen } from './components/CaregiverScreen';
import { ChatScreen } from './components/ChatScreen';
import { ReportsScreen } from './components/ReportsScreen';
import { ProfileScreen } from './components/ProfileScreen';
import { DiabetesRiskModal } from './components/DiabetesRiskModal';
import { GlucoseAndLabPortal } from './features/GlucoseAndLabPortal';
import { SOSModal } from './components/SOSModal';
import { BottomNav } from './components/BottomNav';
import { soundManager } from './utils/audio';
import { ttsProvider } from './utils/speech';
import { LanguageProvider, useLanguage } from './context/LanguageContext';
import { initialCaregivers } from './data/initialData';
import { AlertOctagon } from 'lucide-react';

function MainApp() {
  const [screen, setScreen] = useState<ScreenType>('splash');
  const { language: lang, setLanguage: setLang, t, isRTL } = useLanguage();
  const [activeTab, setActiveTab] = useState<TabType>('home');
  const [medicines, setMedicines] = useState<Medicine[]>(initialMedicines);
  const [patientProfile, setPatientProfile] = useState<PatientProfile>(() => {
    try {
      const saved = localStorage.getItem('smartmed_patient_profile');
      return saved ? JSON.parse(saved) : defaultPatientProfile;
    } catch {
      return defaultPatientProfile;
    }
  });
  const [caregivers, setCaregivers] = useState<Caregiver[]>(() => {
    try {
      const saved = localStorage.getItem('smartmed_caregivers');
      return saved ? JSON.parse(saved) : initialCaregivers;
    } catch {
      return initialCaregivers;
    }
  });
  const [isSOSOpen, setIsSOSOpen] = useState(false);

  const handleUpdateCaregivers = (newCaregivers: Caregiver[]) => {
    setCaregivers(newCaregivers);
    try {
      localStorage.setItem('smartmed_caregivers', JSON.stringify(newCaregivers));
    } catch (e) {
      console.warn('Failed to save caregivers:', e);
    }
  };

  // Splash auto-transition
  useEffect(() => {
    if (screen === 'splash') {
      const timer = setTimeout(() => {
        setScreen('language');
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [screen]);

  const handleTabSwitch = (tab: TabType) => {
    setActiveTab(tab);
    setScreen(tab as ScreenType);
  };

  const renderScreen = () => {
    switch (screen) {
      case 'splash':
        return <SplashScreen t={t} onStart={() => setScreen('language')} />;
      case 'language':
        return (
          <LanguageScreen 
            currentLang={lang} 
            setLang={setLang} 
            next={() => setScreen('login')} 
            onBack={() => setScreen('splash')}
            t={t} 
          />
        );
      case 'login':
        return (
          <LoginScreen 
            next={(profile) => { 
              if (profile) setPatientProfile(profile);
              setScreen('home'); 
              setActiveTab('home'); 
            }} 
            t={t} 
            currentProfile={patientProfile}
          />
        );
      case 'home':
        return (
          <HomeScreen 
            medicines={medicines} 
            setMedicines={setMedicines} 
            patientProfile={patientProfile}
            navigate={(sc) => {
              setScreen(sc);
              if (sc === 'medicines' || sc === 'caregiver' || sc === 'chat' || sc === 'profile' || sc === 'reports') {
                setActiveTab(sc as TabType);
              }
            }} 
            t={t} 
          />
        );
      case 'medicines':
        return (
          <MedicinesScreen 
            medicines={medicines} 
            setMedicines={setMedicines} 
            navigate={setScreen} 
            t={t} 
          />
        );
      case 'add_prescription':
        return (
          <AddPrescriptionFlow 
            close={() => setScreen('home')} 
            setMedicines={setMedicines} 
            t={t} 
          />
        );
      case 'phone_call':
        return (
          <PhoneCallSimulation 
            close={() => setScreen('home')} 
            medicines={medicines} 
            setMedicines={setMedicines} 
            patientProfile={patientProfile}
            t={t} 
            lang={lang}
          />
        );
      case 'caregiver':
        return (
          <CaregiverScreen 
            t={t} 
            onOpenGlucosePortal={() => setScreen('glucose_portal')}
            caregivers={caregivers}
            onUpdateCaregivers={handleUpdateCaregivers}
          />
        );
      case 'chat':
        return <ChatScreen medicines={medicines} t={t} lang={lang} patientProfile={patientProfile} />;
      case 'reports':
        return <ReportsScreen medicines={medicines} t={t} />;
      case 'diabetes_risk':
        return (
          <DiabetesRiskModal 
            close={() => setScreen('home')} 
            patientProfile={patientProfile}
            t={t} 
            />
        );
      case 'glucose_portal':
        return (
          <GlucoseAndLabPortal 
            close={() => setScreen('home')} 
            patientProfile={patientProfile}
            t={t}
            lang={lang}
          />
        );
      case 'profile':
        return (
          <ProfileScreen 
            currentLang={lang} 
            setLang={setLang} 
            patientProfile={patientProfile}
            t={t} 
            logout={() => setScreen('login')} 
            onNavigateToCaregiver={() => setScreen('caregiver')}
            caregivers={caregivers}
            onUpdateCaregivers={handleUpdateCaregivers}
          />
        );
      default:
        return (
          <HomeScreen 
            medicines={medicines} 
            setMedicines={setMedicines} 
            patientProfile={patientProfile}
            navigate={setScreen} 
            t={t} 
          />
        );
    }
  };

  const isFullscreenModal = screen === 'phone_call' || screen === 'add_prescription' || screen === 'diabetes_risk' || screen === 'glucose_portal';
  const showBottomNav = !['splash', 'language', 'login', 'phone_call', 'add_prescription', 'diabetes_risk', 'glucose_portal'].includes(screen);

  return (
    <div 
      className={`min-h-screen w-full bg-[#F5F5F7] text-slate-900 flex flex-col relative selection:bg-blue-500 selection:text-white ${
        isRTL ? 'rtl font-urdu' : 'ltr'
      }`}
      dir={isRTL ? 'rtl' : 'ltr'}
    >
      {/* Top Application Header with Brand, Voice AI and Persistent SOS Access */}
      {screen !== 'splash' && screen !== 'phone_call' && (
        <header className="sticky top-0 z-30 w-full bg-white/95 backdrop-blur-md border-b border-gray-200/80 px-4 py-2.5 flex items-center justify-between text-xs shadow-xs">
          <div className="w-full max-w-5xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-2">
              <img 
                src="/app-logo.png" 
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).src = 'https://www.image2url.com/r2/default/images/1788602801147-04408589-eef8-4f09-b739-692ee2b681ae.png';
                }}
                alt="Logo" 
                className="w-6 h-6 rounded-md object-contain bg-white p-0.5 border border-gray-200"
                referrerPolicy="no-referrer"
              />
              <span className="font-bold text-gray-900 tracking-wide text-sm">SmartMed</span>
              <span className="text-[10px] bg-blue-500/15 text-[#0071E3] font-semibold px-2 py-0.5 rounded-full border border-blue-500/20">
                {t.careAI || 'Care AI'}
              </span>
            </div>

            {/* Red SOS Emergency Button */}
            <button
              type="button"
              onClick={() => {
                ttsProvider.unlock();
                soundManager.resumeAudioContext();
                setIsSOSOpen(true);
              }}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-red-600 hover:bg-red-700 active:scale-95 text-white font-extrabold text-xs shadow-md shadow-red-600/30 transition-all border border-red-500 cursor-pointer"
              aria-label={t.sosEmergency || 'SOS EMERGENCY'}
            >
              <AlertOctagon className="w-4 h-4 animate-pulse" />
              <span>{t.sosEmergency || 'SOS EMERGENCY'}</span>
            </button>
          </div>
        </header>
      )}

      {/* Main Screen Content */}
      <main className={`flex-1 w-full ${showBottomNav ? 'pb-24' : ''} flex flex-col`}>
        <div className="w-full max-w-4xl mx-auto flex-1 flex flex-col">
          <AnimatePresence mode="wait">
            <div key={screen} className="flex-1 flex flex-col h-full w-full">
              {renderScreen()}
            </div>
          </AnimatePresence>
        </div>
      </main>

      {/* Bottom Navigation Thumb-Zone */}
      {showBottomNav && !isFullscreenModal && (
        <BottomNav 
          activeTab={activeTab} 
          setActiveTab={handleTabSwitch} 
          onCallAI={() => {
            ttsProvider.unlock();
            soundManager.resumeAudioContext();
            setScreen('phone_call');
          }} 
          t={t} 
        />
      )}

      {/* SOS Emergency Modal */}
      <SOSModal
        isOpen={isSOSOpen}
        onClose={() => setIsSOSOpen(false)}
        patientProfile={patientProfile}
        caregivers={caregivers}
        medicines={medicines}
        language={lang}
        t={t}
        onSOSResolved={() => setIsSOSOpen(false)}
      />
    </div>
  );
}

export default function App() {
  return (
    <LanguageProvider>
      <MainApp />
    </LanguageProvider>
  );
}
