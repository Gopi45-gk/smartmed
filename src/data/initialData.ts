import { Medicine, Caregiver, ChatMessage } from '../types';

export const initialMedicines: Medicine[] = [
  { 
    id: 1, 
    name: 'Telmisartan 40mg', 
    time: '1:00 PM', 
    dose: '1 Tablet', 
    food: 'After Food', 
    status: 'upcoming', 
    type: 'tablet',
    color: '#0071E3'
  },
  { 
    id: 2, 
    name: 'Cough Syrup', 
    time: '8:00 PM', 
    dose: '10 ml', 
    food: 'After Food', 
    status: 'upcoming', 
    type: 'liquid',
    color: '#34C759'
  },
  { 
    id: 3, 
    name: 'Vitamin D3 60K', 
    time: '8:00 AM', 
    dose: '1 Capsule', 
    food: 'Before Food', 
    status: 'taken', 
    type: 'capsule',
    takenAt: '8:15 AM',
    color: '#FF9500'
  },
  { 
    id: 4, 
    name: 'Metformin 500mg', 
    time: '9:30 PM', 
    dose: '1 Tablet', 
    food: 'With Dinner', 
    status: 'upcoming', 
    type: 'tablet',
    color: '#AF52DE'
  }
];

export const initialCaregivers: Caregiver[] = [
  {
    id: 1,
    name: 'Arun Kumar',
    relation: 'Son',
    phone: '+91 98765 12345',
    isPrimary: true,
    alertEnabled: true
  },
  {
    id: 2,
    name: 'Dr. Priya Menon',
    relation: 'Cardiologist',
    phone: '+91 98401 98765',
    isPrimary: false,
    alertEnabled: true
  }
];

export const initialChatMessages: Record<string, ChatMessage[]> = {
  en: [
    { 
      id: '1', 
      sender: 'ai', 
      text: 'Hello! I am your SmartMed local offline AI assistant powered by MNN. How can I help you with your health or medications today?',
      time: 'Now'
    }
  ],
  ta: [
    { 
      id: '1', 
      sender: 'ai', 
      text: 'வணக்கம்! நான் உங்கள் SmartMed உள்ளூர் AI உதவியாளர். உங்கள் உடல்நலம் அல்லது மருந்துகள் குறித்து நான் எவ்வாறு உதவ முடியும்?',
      time: 'இப்போது'
    }
  ],
  hi: [
    { 
      id: '1', 
      sender: 'ai', 
      text: 'नमस्ते! मैं आपका SmartMed स्थानीय AI सहायक हूँ। आज मैं आपकी स्वास्थ्य या दवाओं के बारे में क्या मदद कर सकता हूँ?',
      time: 'अब'
    }
  ],
  ur: [
    { 
      id: '1', 
      sender: 'ai', 
      text: 'السلام علیکم! میں آپ کا SmartMed مقامی AI اسسٹنٹ ہوں۔ آج میں آپ کی صحت یا ادویات کے بارے میں کیا مدد کر سکتا ہوں?',
      time: 'ابھی'
    }
  ],
  te: [
    {
      id: '1',
      sender: 'ai',
      text: 'నమస్కారం! నేను మీ SmartMed AI ఆరోగ్య సహాయకుడిని. ఈ రోజు మీ ఆరోగ్యం లేదా మందుల గురించి నేను ఎలా సహాయపడగలను?',
      time: 'ఇప్పుడు'
    }
  ],
  kn: [
    {
      id: '1',
      sender: 'ai',
      text: 'ನಮಸ್ಕಾರ! ನಾನು ನಿಮ್ಮ SmartMed AI ಆರೋಗ್ಯ ಸಹಾಯಕ. ಇಂದು ನಿಮ್ಮ ಆರೋಗ್ಯ ಅಥವಾ ಔಷಧಿಗಳ ಬಗ್ಗೆ ನಾನು ಹೇಗೆ ಸಹಾಯ ಮಾಡಲಿ?',
      time: 'ಈಗ'
    }
  ],
  ml: [
    {
      id: '1',
      sender: 'ai',
      text: 'നമസ്കാരം! ഞാൻ നിങ്ങളുടെ SmartMed AI ആരോഗ്യ സഹായിയാണ്. ഇന്ന് നിങ്ങളുടെ ആരോഗ്യത്തെക്കുറിച്ചോ മരുന്നുകളെക്കുറിച്ചോ ഞാൻ എങ്ങനെ സഹായിക്കണം?',
      time: 'ഇപ്പോൾ'
    }
  ]
};
