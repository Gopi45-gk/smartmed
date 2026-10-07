export type Language = 'en' | 'ta' | 'hi' | 'ur' | 'te' | 'ml' | 'kn';

export type ScreenType = 
  | 'splash' 
  | 'language' 
  | 'login' 
  | 'home' 
  | 'medicines'
  | 'add_prescription' 
  | 'phone_call' 
  | 'caregiver' 
  | 'chat' 
  | 'reports' 
  | 'profile';

export type TabType = 'home' | 'medicines' | 'caregiver' | 'chat' | 'reports' | 'profile';

export type MedicineStatus = 'upcoming' | 'taken' | 'missed';
export type MedicineType = 'tablet' | 'liquid' | 'capsule' | 'injection';

export interface Medicine {
  id: number;
  name: string;
  time: string;
  dose: string;
  food: string;
  status: MedicineStatus;
  type: MedicineType;
  color?: string;
  takenAt?: string;
}

export interface Caregiver {
  id: number;
  name: string;
  relation: string;
  phone: string;
  isPrimary: boolean;
  alertEnabled: boolean;
}

export interface ChatMessage {
  id: string;
  sender: 'ai' | 'user';
  text: string;
  time?: string;
}

export interface PatientProfile {
  name: string;
  phone: string;
  age: string | number;
  gender: string;
  condition?: string;
  bloodGroup?: string;
  registeredAt?: string;
  preferred_language?: Language;
}

export const defaultPatientProfile: PatientProfile = {
  name: '',
  phone: '',
  age: '',
  gender: '',
  condition: '',
  bloodGroup: '',
  preferred_language: 'en',
};

export interface TranslationStrings {
  appName: string;
  tagline: string;
  nextMed: string;
  markTaken: string;
  progress: string;
  todaysMeds: string;
  home: string;
  medicines: string;
  caregiver: string;
  chat: string;
  profile: string;
  reports: string;
  callTitle: string;
  simulateCall: string;
  addPrescription: string;
  uploadTitle: string;
  cameraTitle: string;
  confirmSave: string;
  adherence: string;
  taken: string;
  upcoming: string;
  missed: string;
  notTaken: string;
  goodMorning: string;
  streakDays: string;
  selectLanguage: string;
  selectLangSub: string;
  continueBtn: string;
  enterMobile: string;
  enterMobileSub: string;
  mobileLabel: string;
  getOtpBtn: string;
  incomingCall: string;
  aiVoiceAssistant: string;
  aiSpeakingPrompt: string;
  patientRepliedLabel: string;
  statusUpdated: string;
  replyTaken: string;
  replySnooze: string;
  endCall: string;
  connectingCall: string;
  connectedTwoWay: string;
  caregiverSub: string;
  addCaregiver: string;
  primaryBadge: string;
  alertOnMissed: string;
  askAnything: string;
  send: string;
  monthlyCompliance: string;
  excellentAdherence: string;
  exportPdf: string;
  changeLanguage: string;
  logout: string;
  emergencyInfo: string;
  allergies: string;
  bloodGroup: string;
  twilioAlertCall?: string;
  callingState?: string;
  scheduledLabel?: string;
}

export type ReminderStatus = 'PENDING' | 'CALLING' | 'COMPLETED' | 'DELAYED' | 'SKIPPED' | 'UNCERTAIN' | 'FAILED';

export interface MedicationReminder {
  id: string;
  patientId: string;
  patientName: string;
  phoneNumber: string;
  medicineId: string | number;
  medicineName: string;
  strength?: string;
  dosage: string;
  frequency?: string;
  scheduledTime: string;
  mealRelation?: string;
  startDate?: string;
  endDate?: string;
  language: Language;
  locale: string;
  timezone: string;
  reminderStatus: ReminderStatus;
  ocrConfidence?: number;
  source: 'OCR_PRESCRIPTION';
  createdAt: string;
  updatedAt: string;
}

export type AdherenceStatus = 'TAKEN' | 'WILL_TAKE_NOW' | 'DELAYED' | 'SKIPPED' | 'UNCERTAIN' | 'NO_ANSWER';

export interface MedicationAdherenceRecord {
  id: string;
  reminderId: string;
  patientId: string;
  medicineId: string | number;
  medicineName: string;
  scheduledTime: string;
  status: AdherenceStatus;
  confirmationMethod: 'TWILIO_VOICE' | 'MANUAL' | 'APP';
  confirmedAt: string;
  patientResponse?: string;
  callSid?: string;
  language: string;
  delayMinutes?: number;
}
