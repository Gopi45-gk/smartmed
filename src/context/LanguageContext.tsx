import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Language, TranslationStrings } from '../types';
import { translations } from '../data/translations';
import i18n from '../i18n';
import { updatePatientLanguage } from '../firebase';

export interface LanguageContextType {
  language: Language;
  preferred_language: Language;
  setLanguage: (lang: Language, phone?: string) => void;
  t: TranslationStrings;
  isRTL: boolean;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [language, setLanguageState] = useState<Language>(() => {
    try {
      const stored = localStorage.getItem('smartmed_preferred_language') as Language;
      if (stored && ['ta', 'en', 'hi', 'te', 'kn', 'ml', 'ur'].includes(stored)) {
        return stored;
      }
      const profileStr = localStorage.getItem('smartmed_patient_profile');
      if (profileStr) {
        const p = JSON.parse(profileStr);
        if (p.preferred_language && ['ta', 'en', 'hi', 'te', 'kn', 'ml', 'ur'].includes(p.preferred_language)) {
          return p.preferred_language;
        }
      }
    } catch {
      // ignore
    }
    return (i18n.language as Language) || 'en';
  });

  const { i18n: i18nInstance } = useTranslation();

  const setLanguage = useCallback((newLang: Language, phone?: string) => {
    if (!['ta', 'en', 'hi', 'te', 'kn', 'ml', 'ur'].includes(newLang)) return;
    
    setLanguageState(newLang);

    // 1. Persist to localStorage for offline UI
    try {
      localStorage.setItem('smartmed_preferred_language', newLang);
      const profileStr = localStorage.getItem('smartmed_patient_profile');
      if (profileStr) {
        const p = JSON.parse(profileStr);
        p.preferred_language = newLang;
        localStorage.setItem('smartmed_patient_profile', JSON.stringify(p));
        // If phone wasn't explicitly passed, try to get from local profile
        if (!phone && p.phone) {
          phone = p.phone;
        }
      }
    } catch {
      // ignore
    }

    // 2. Persist to Firebase Firestore if phone is available
    if (phone) {
      updatePatientLanguage(phone, newLang).catch((err) => {
        console.warn('[LanguageContext] Firestore update error:', err);
      });
    }

    // 3. Switch react-i18next language dynamically
    i18nInstance.changeLanguage(newLang);
  }, [i18nInstance]);

  // Synchronize with i18n instance
  useEffect(() => {
    if (i18n.language !== language) {
      i18n.changeLanguage(language);
    }
  }, [language]);

  const currentStrings = translations[language] || translations.en;
  const isRTL = language === 'ur';

  return (
    <LanguageContext.Provider
      value={{
        language,
        preferred_language: language,
        setLanguage,
        t: currentStrings,
        isRTL,
      }}
    >
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = (): LanguageContextType => {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
};
