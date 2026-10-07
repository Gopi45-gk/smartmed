import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { translations } from './data/translations';
import { Language } from './types';

// Convert existing translations object to i18next resources format
const resources = {
  en: { translation: translations.en },
  ta: { translation: translations.ta },
  hi: { translation: translations.hi },
  te: { translation: translations.te },
  kn: { translation: translations.kn },
  ml: { translation: translations.ml },
  ur: { translation: translations.ur },
};

const getInitialLanguage = (): Language => {
  if (typeof window === 'undefined') return 'en';
  try {
    const saved = localStorage.getItem('smartmed_preferred_language') as Language;
    if (saved && ['ta', 'en', 'hi', 'te', 'kn', 'ml', 'ur'].includes(saved)) {
      return saved;
    }
    const profile = localStorage.getItem('smartmed_patient_profile');
    if (profile) {
      const parsed = JSON.parse(profile);
      if (parsed.preferred_language && ['ta', 'en', 'hi', 'te', 'kn', 'ml', 'ur'].includes(parsed.preferred_language)) {
        return parsed.preferred_language;
      }
    }
  } catch {
    // ignore
  }
  return 'en';
};

const initialLang = getInitialLanguage();

i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: initialLang,
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false, // React already escapes values
    },
    react: {
      useSuspense: false, // Offline immediate synchronous rendering
    },
  });

export default i18n;
