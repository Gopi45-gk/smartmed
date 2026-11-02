export type Language = 'en' | 'ta' | 'hi' | 'te' | 'bn' | 'mr' | 'kn' | 'ml' | 'ur';

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
  | 'diabetes_risk'
  | 'glucose_portal'
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

export interface ChatSession {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  language: Language;
  messages: ChatMessage[];
  preview?: string;
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
  glucoseAndLabTitle?: string;
  glucoseAndLabSub?: string;

  // ─── Module 1, 2 & 3: Chatbot & History Translations ─────────────────────
  chatGreeting?: string;
  chatSubtitle?: string;
  newChat?: string;
  chatHistory?: string;
  suggestedQuestions?: string;
  promptMyMeds?: string;
  promptPrescription?: string;
  promptGlucose?: string;
  promptLabReport?: string;
  promptGeneralHealth?: string;
  promptCaregiver?: string;
  typeMessagePlaceholder?: string;
  clearInput?: string;
  voiceInput?: string;
  listening?: string;
  onlineStatus?: string;
  offlineStatus?: string;
  noConversations?: string;
  deleteChatConfirm?: string;
  backToChat?: string;
  copyMessage?: string;
  copied?: string;
  readAloud?: string;
  deleteConversation?: string;
  confirmDeleteTitle?: string;
  confirmDeleteText?: string;
  cancelBtn?: string;
  deleteBtn?: string;

  // ─── Medication Instructions & Timings ───────────────────────────────────
  beforeFood?: string;
  afterFood?: string;
  withWater?: string;
  emptyStomach?: string;
  daily?: string;
  twiceDaily?: string;
  morning?: string;
  afternoon?: string;
  night?: string;
  asNeeded?: string;
  takeWithWaterNotice?: string;
  medicationAdherenceNotice?: string;

  // ─── Prescription & OCR ──────────────────────────────────────────────────
  scanPrescription?: string;
  dragAndDrop?: string;
  processingOcr?: string;
  medicinesExtracted?: string;
  requiresReview?: string;
  confidenceLabel?: string;
  ocrAccuracyDisclaimer?: string;

  // ─── Diabetes & Glucose Monitoring ───────────────────────────────────────
  glucosePortal?: string;
  logGlucose?: string;
  fasting?: string;
  postPrandial?: string;
  random?: string;
  targetRange?: string;
  diabetesRisk?: string;
  lowRisk?: string;
  moderateRisk?: string;
  highRisk?: string;
  clinicalRecommendation?: string;
  glucoseAlertWarning?: string;

  // ─── SOS & Emergency ─────────────────────────────────────────────────────
  sosButton?: string;
  sosEmergency?: string;
  careAI?: string;
  callAI?: string;
  confirmEmergency?: string;
  callingCaregiver?: string;
  emergencyResolved?: string;
  cancelAlert?: string;
  emergencyInstructions?: string;

  // ─── Dashboard, Hub & Navigation ─────────────────────────────────────────
  viewAll?: string;
  aiOcrScan?: string;
  interactiveVoiceUsp?: string;
  of?: string;
  completed?: string;
  age?: string;
  genderLabel?: string;
  male?: string;
  female?: string;
  other?: string;
  activePatient?: string;
  allMeds?: string;
  noMedsFound?: string;
  undoMark?: string;

  // ─── Authentication & Registration ───────────────────────────────────────
  registerPatientTab?: string;
  patientLoginTab?: string;
  patientRegTitle?: string;
  patientRegSub?: string;
  patientFullName?: string;
  primaryConditionLabel?: string;
  passwordLabel?: string;
  confirmPasswordLabel?: string;
  registerContinueBtn?: string;
  loginContinueBtn?: string;
  securityNotice?: string;
  nameRequired?: string;
  phoneRequired?: string;
  ageRequired?: string;
  passwordRequired?: string;
  passwordMismatch?: string;
  regFailed?: string;
  loginFailed?: string;

  // ─── Full SOS Modal Interaction ──────────────────────────────────────────
  sosActivated?: string;
  sosAutoCallVoice?: string;
  sosConfirmTitle?: string;
  sosConfirmDesc?: string;
  sosConfirmBtn?: string;
  sosCancelBtn?: string;
  sosCaregiverContacted?: string;
  sosCaregiverFailed?: string;
  sosCallingCaregiver?: string;
  sosCaregiverCallConnected?: string;
  sosCaregiverAck?: string;
  sosCallFailed?: string;
  sosAlternateAlertSent?: string;
  sosTelephonyActive?: string;
  sosRetryCall?: string;
  sosDialPhone?: string;
  sosCriticalGuidance?: string;
  sosDialAmbulance?: string;
  sosInteractiveVoice?: string;
  sosSpeaking?: string;
  sosMuteVoice?: string;
  sosListeningNow?: string;
  sosTapSpeak?: string;
  sosSpeak?: string;
  sosStop?: string;
  sosCallAlertsActive?: string;
  sosEventRecorded?: string;
  sosAssistanceArrived?: string;
  sosResolveClose?: string;
  sosResolvedSafely?: string;
  sosResolvedDesc?: string;

  // ─── Profile & Emergency Contacts ────────────────────────────────────────
  accountEmergencyId?: string;
  paramedicNotice?: string;
  caregiverDoctorContacts?: string;
  emergencyRecipientsSub?: string;
  alterDetails?: string;
  primaryCaregiverHeader?: string;
  personalDoctorHeader?: string;
  alterCaregiverDoctorTitle?: string;
  alterCaregiverDoctorSub?: string;
  caregiverFullName?: string;
  relationshipLabel?: string;
  doctorFullName?: string;
  specialtyLabel?: string;
  doctorPhoneLabel?: string;
  saveContactDetails?: string;
  voiceAudioPrompts?: string;
  voiceAudioPromptsSub?: string;
  clinicalSafetyProtocol?: string;
  clinicalSafetyProtocolSub?: string;
  activeStatus?: string;
  knownAllergies?: string;
  noneReported?: string;

  // ─── Chatbot Disclaimer ──────────────────────────────────────────────────
  triageDisclaimer?: string;
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
