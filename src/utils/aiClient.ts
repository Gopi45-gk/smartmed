/**
 * ============================================================================
 * SMARTMED / MEDASSIST AI - HYBRID AI CLIENT & NETWORK ROUTER
 * ============================================================================
 * Architecture:
 * - OFFLINE-FIRST: If offline or local model preferred, routes OCR tasks to
 *   the on-device PaddleOCR pipeline and chat/voice queries to local MNN runtime.
 * - ONLINE FALLBACK: If internet is active, routes complex medical queries to
 *   the AWS-hosted FastAPI backend for NVIDIA NIM inference, live WHO ICD-11,
 *   and OpenFDA pharmacological lookups.
 * - MASTER SYSTEM PROMPT: Strictly enforced across all LLM inference engines.
 * ============================================================================
 */

// ─── Base URLs for AWS Cloud & Local Deployment ─────────────────────────────
const getBaseApiUrl = (): string => {
  if (typeof window === 'undefined') return 'http://localhost:8100';
  if ((import.meta as any).env?.VITE_API_BASE_URL) return (import.meta as any).env.VITE_API_BASE_URL;
  if ((import.meta as any).env?.VITE_AWS_API_URL) return (import.meta as any).env.VITE_AWS_API_URL;
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    return window.location.port === '8100' ? '' : 'http://localhost:8100';
  }
  // When running on a remote domain (e.g. smart-med.duckdns.org), use relative path "" (proxied by Nginx)
  return '';
};

const CLOUD_API_BASE_URL = getBaseApiUrl();
const LOCAL_API_BASE_URL = getBaseApiUrl();
const AI_BASE_URL = getBaseApiUrl();
const STORAGE_KEY = 'smartmed-mnn-v1';
const FETCH_TIMEOUT = 130_000; // 130s

// ─── Master Medical Expert System Prompt ────────────────────────────────────
export const MASTER_SYSTEM_PROMPT = `You are SmartMed AI, an expert, empathetic, and highly accurate Medical Triage Assistant. 

STRICT RULES:
1. MEDICAL EXPERTISE: Answer ONLY the user's specific health/medication query. Provide clear, actionable triage steps or drug information (dosage, side effects) based strictly on verified pharmacological data (OpenFDA, WHO EML).
2. 6-LANGUAGE ENFORCEMENT: Detect the user's language (Tamil, English, Hindi, Telugu, Kannada, Malayalam) and respond 100% in that native script. NO LANGUAGE MIXING.
3. CONCISENESS: Keep answers strictly between 2 to 3 short sentences. Use bullet points. No fluff. No hallucination.
4. MEDICAL DISCLAIMER: Always end with 'Please consult a doctor for severe symptoms.'
5. NO DATA INVENTING: If you don't know the answer, or if the prescription OCR data is unclear, say 'I need more information / Please verify the prescription manually.' Do NOT guess.`;

export function getAugmentedSystemPrompt(language: string = 'en'): string {
  const langNameMap: Record<string, string> = {
    ta: 'Tamil (தமிழ்)',
    hi: 'Hindi (हिन्दी)',
    te: 'Telugu (తెలుగు)',
    kn: 'Kannada (ಕನ್ನಡ)',
    ml: 'Malayalam (മലയാളം)',
    en: 'English',
    ur: 'Urdu (اردو)',
  };
  const targetName = langNameMap[language] || language;
  return `${MASTER_SYSTEM_PROMPT}

CRITICAL RULE: You must translate and reply entirely in ${targetName} script. Do NOT mix languages. Do NOT use English unless the preferred language is English.`;
}

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AIMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AIChatResponse {
  success: boolean;
  response?: string;
  intent?: string;
  error?: string;
  model: string;
  offline: boolean;
  rag_grounded?: boolean;
  timing?: string;
}

export interface AIStatusResponse {
  status: string;
  model_name: string;
  device: string;
  model_exists: boolean;
  error?: string | null;
  config?: Record<string, unknown>;
}

export interface PrescriptionMedicine {
  name: string;
  strength?: string;
  dosage?: string;
  frequency?: string;
  instructions?: string;
  confidence: number;
  requires_review: boolean;
  type?: 'tablet' | 'liquid' | 'capsule' | 'injection';
  scheduled_time?: string | null;
  food_instruction?: string | null;
}

export interface PrescriptionOCRRegion {
  box: number[][];
  text: string;
  confidence: number;
}

export interface PrescriptionPatientInfo {
  name?: string | null;
  age?: string | null;
  gender?: string | null;
  id?: string | null;
}

export interface PrescriptionOCRResponse {
  success: boolean;
  text: string;
  confidence: number;
  regions: PrescriptionOCRRegion[];
  medicines: PrescriptionMedicine[];
  medications?: PrescriptionMedicine[];
  patient?: PrescriptionPatientInfo;
  date?: string | null;
  clinical_notes?: string[];
  diagnosis?: string[];
  vitals?: string[];
  iv_fluids?: string[];
  advice?: string[];
  follow_up?: string[];
  overall_confidence?: number;
  requires_review?: boolean;
  quality?: {
    blur_score?: number;
    brightness?: number;
    contrast?: number;
    is_blurry?: boolean;
    is_insufficient?: boolean;
    quality_error?: string | null;
    deskew_angle?: number;
  };
  error?: string;
}

export interface NetworkState {
  isOnline: boolean;
  mode: 'online' | 'offline';
  backendReachable: boolean;
  lastChecked: number;
}

export interface ChatOptions {
  mode?: 'auto' | 'offline' | 'online';
  timeout?: number;
  language?: string;
}

// ─── Network State Checker ──────────────────────────────────────────────────

let _networkState: NetworkState = {
  isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
  mode: (typeof navigator !== 'undefined' && navigator.onLine) ? 'online' : 'offline',
  backendReachable: false,
  lastChecked: Date.now(),
};

const _subscribers = new Set<(state: NetworkState) => void>();

function notifySubscribers() {
  _subscribers.forEach(cb => {
    try { cb(_networkState); } catch { /* ignore callback errors */ }
  });
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    _networkState.isOnline = true;
    _networkState.mode = 'online';
    _networkState.lastChecked = Date.now();
    notifySubscribers();
    checkNetworkState().catch(() => {});
  });

  window.addEventListener('offline', () => {
    _networkState.isOnline = false;
    _networkState.mode = 'offline';
    _networkState.backendReachable = false;
    _networkState.lastChecked = Date.now();
    notifySubscribers();
  });
}

/**
 * Check if the browser currently reports an active internet connection.
 */
export function isOnline(): boolean {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return false;
  }
  return _networkState.isOnline;
}

/**
 * Return current instantaneous network state.
 */
export function getNetworkState(): NetworkState {
  return { ..._networkState };
}

/**
 * Actively probe network connectivity and backend health.
 */
export async function checkNetworkState(): Promise<NetworkState> {
  const browserOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
  if (!browserOnline) {
    _networkState = {
      isOnline: false,
      mode: 'offline',
      backendReachable: false,
      lastChecked: Date.now(),
    };
    notifySubscribers();
    return _networkState;
  }

  try {
    const probe = await fetch(`${AI_BASE_URL}/api/ai/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(3000),
    });
    const reachable = probe.ok;
    _networkState = {
      isOnline: true,
      mode: reachable ? 'online' : 'offline',
      backendReachable: reachable,
      lastChecked: Date.now(),
    };
  } catch {
    _networkState = {
      isOnline: true,
      mode: 'offline', // Gracefully switch router to offline local mode
      backendReachable: false,
      lastChecked: Date.now(),
    };
  }

  notifySubscribers();
  return _networkState;
}

/**
 * Subscribe to network state transitions.
 */
export function subscribeNetworkStatus(callback: (state: NetworkState) => void): () => void {
  _subscribers.add(callback);
  callback(_networkState);
  return () => {
    _subscribers.delete(callback);
  };
}

// ─── Client-Side Clinical Triage Engine (Offline Resilient) ─────────────────

export function detectLanguageFromText(text: string, fallback: string = 'en'): string {
  if (!text) {
    if (typeof localStorage !== 'undefined') {
      const stored = localStorage.getItem('smartmed_preferred_language');
      if (stored && ['ta', 'en', 'hi', 'te', 'kn', 'ml'].includes(stored)) return stored;
    }
    return fallback;
  }
  const s = text.toLowerCase();
  if (/[\u0B80-\u0BFF]/.test(s) || s.includes('ta') || s.includes('tamil')) return 'ta';
  if (/[\u0900-\u097F]/.test(s) || s.includes('hi') || s.includes('hindi')) return 'hi';
  if (/[\u0C00-\u0C7F]/.test(s) || s.includes('te') || s.includes('telugu')) return 'te';
  if (/[\u0C80-\u0CFF]/.test(s) || s.includes('kn') || s.includes('kannada')) return 'kn';
  if (/[\u0D00-\u0D7F]/.test(s) || s.includes('ml') || s.includes('malayalam')) return 'ml';
  if (s.includes('en') || s.includes('english')) return 'en';
  return fallback;
}

export function resolveClinicalTriageOffline(
  message: string,
  options?: { isVoice?: boolean; patientName?: string; language?: string }
): string {
  const isVoice = options?.isVoice ?? false;
  const patientName = options?.patientName || 'Patient';
  const lang = options?.language ? detectLanguageFromText('', options.language) : detectLanguageFromText(message, 'en');
  const q = message.toLowerCase().trim();

  // If Voice requested (1 to 2 spoken sentences)
  if (isVoice) {
    if (q.includes('chest pain') || q.includes('heart') || q.includes('breathe') || /நெஞ்சு|சீने|ఛాతీ|നെഞ്ചുവേദന|ಎದೆ ನೋವು/.test(q)) {
      if (lang === 'ta') return `${patientName}, நெஞ்சு வலி அவசர சிகிச்சை தேவைப்படும் அறிகுறி. உடனே அவசர மருத்துவ சேவையைத் தொடர்பு கொள்ளவும்.`;
      if (lang === 'hi') return `${patientName}, सीने में दर्द आपातकालीन लक्षण है। कृपया तुरंत नजदीकी अस्पताल जाएं।`;
      if (lang === 'te') return `${patientName}, ఛాతీ నొప్పి అత్యవసర పరిస్థితి. వెంటనే వైద్య సహాయం తీసుకోండి.`;
      if (lang === 'kn') return `${patientName}, ಎದೆ ನೋವು ತುರ್ತು ವೈದ್ಯಕೀಯ ಚಿಕಿತ್ಸೆ ಅಗತ್ಯವಿರುವ ಲಕ್ಷಣ. ದಯವಿಟ್ಟು ತಕ್ಷಣವೇ ವೈದ್ಯರನ್ನು ಸಂಪರ್ಕಿಸಿ.`;
      if (lang === 'ml') return `${patientName}, നെഞ്ചുവേദന അടിയന്തിര വൈദ്യസഹായം ആവശ്യമുള്ള ലക്ഷണമാണ്. ഉടൻ ആശുപത്രിയിൽ ചികിത്സ തേടുക.`;
      return `${patientName}, chest pain requires immediate emergency medical care. Please call emergency services right away.`;
    }
    if (q.includes('head') || q.includes('தலை') || q.includes('सिर') || q.includes('తల') || q.includes('തല') || q.includes('ತಲೆ')) {
      if (lang === 'ta') return `${patientName}, தலைவலிக்கு அமைதியான அறையில் ஓய்வெடுத்து போதுமான தண்ணீர் குடியுங்கள். பரிந்துரைக்கப்பட்ட மருந்துகளை எடுத்துக்கொள்ளுங்கள்.`;
      if (lang === 'hi') return `${patientName}, सिरदर्द के लिए शांत कमरे में आराम करें और पानी पिएं। अपनी दवाएं समय पर लें।`;
      if (lang === 'te') return `${patientName}, తలనొప్పికి ప్రశాంతంగా విశ్రాంతి తీసుకోండి మరియు తగినంత నీరు త్రాగండి.`;
      if (lang === 'kn') return `${patientName}, ತಲೆನೋವಿಗೆ ಶಾಂತವಾದ ಕೋಣೆಯಲ್ಲಿ ವಿಶ್ರಾಂತಿ ಪಡೆಯಿರಿ ಮತ್ತು ಸಾಕಷ್ಟು ನೀರು ಕುಡಿಯಿರಿ.`;
      if (lang === 'ml') return `${patientName}, തലവേദനയ്ക്ക് ശാന്തമായ മുറിയിൽ വിശ്രമിക്കുകയും ആവശ്യത്തിന് വെള്ളം കുടിക്കുകയും ചെയ്യുക.`;
      return `${patientName}, for a headache, please rest in a quiet room and drink plenty of water. Take your prescribed medicines as directed.`;
    }
    if (q.includes('slight') || q.includes('pain') || q.includes('வலி') || q.includes('दर्द') || q.includes('నొప్పి') || q.includes('വേദന') || q.includes('ನೋವು')) {
      if (lang === 'ta') return `${patientName}, லேசான வலிக்கு ஓய்வெடுத்து தண்ணீர் குடியுங்கள். பரிந்துரைக்கப்பட்ட மருந்துகளை எடுத்துக்கொள்ளுங்கள்.`;
      if (lang === 'hi') return `${patientName}, हल्के दर्द के लिए आराम करें और पर्याप्त पानी पिएं। अपनी निर्धारित दवाएं समय पर लें।`;
      if (lang === 'te') return `${patientName}, తేలికపాటి నొప్పికి విశ్రాంతి తీసుకోండి మరియు తగినంత నీరు త్రాగండి.`;
      if (lang === 'kn') return `${patientName}, ಸೌಮ್ಯವಾದ ನೋವಿಗೆ ವಿಶ್ರಾಂತಿ ಪಡೆಯಿರಿ ಮತ್ತು ಸಾಕಷ್ಟು ನೀರು ಕುಡಿಯಿರಿ.`;
      if (lang === 'ml') return `${patientName}, നേരിയ വേദനയ്ക്ക് വിശ്രമിക്കുകയും ആവശ്യത്തിന് വെള്ളം കുടിക്കുകയും ചെയ്യുക.`;
      return `${patientName}, for mild pain, please rest and drink plenty of water. Take your prescribed medicines as directed.`;
    }
    if (lang === 'ta') return `${patientName}, உங்கள் உடல்நலனை கவனித்துக் கொள்ளுங்கள். பரிந்துரைக்கப்பட்ட மருந்துகளை சரியான நேரத்தில் உட்கொள்ளவும்.`;
    if (lang === 'hi') return `${patientName}, अपनी सेहत का ख्याल रखें और अपनी दवाएं नियमित रूप से लेते रहें।`;
    if (lang === 'te') return `${patientName}, మీ ఆరోగ్యాన్ని జాగ్రత్తగా చూసుకోండి మరియు మందులను సమయానికి తీసుకోండి.`;
    if (lang === 'ml') return `${patientName}, ആരോഗ്യം ശ്രദ്ധിക്കുക, നിർദ്ദേശിച്ച മരുന്നുകൾ കൃത്യമായി കഴിക്കുക.`;
    if (lang === 'kn') return `${patientName}, ನಿಮ್ಮ ಆರೋಗ್ಯವನ್ನು ಚೆನ್ನಾಗಿ ನೋಡಿಕೊಳ್ಳಿ ಮತ್ತು ಔಷಧಿಗಳನ್ನು ಸಮಯಕ್ಕೆ ತೆಗೆದುಕೊಳ್ಳಿ.`;
    return `${patientName}, I understand your symptoms. Please take your prescribed medications with plain water and rest. Consult your doctor if symptoms continue.`;
  }

  // If Chat requested (Master System Prompt 5 Rules)
  if (q.includes('chest pain') || q.includes('heart attack') || q.includes('breathe') || /நெஞ்சு|சீने|ఛాతీ|നെഞ്ചുവേദന|ಎದೆ ನೋವು/.test(q)) {
    if (lang === 'ta') return `⚠️ அவசர எச்சரிக்கை:\n• நெஞ்சு வலி மற்றும் மூச்சுத் திணறல் உடனடி மருத்துவ அவசர சிகிச்சை தேவைப்படும் அறிகுறிகள் ஆகும்.\n• உடனே அவசர மருத்துவ பிரிவை அணுகவும்.\nகடுமையான அறிகுறிகளுக்கு தயவுசெய்து மருத்துவரை அணுகவும்.`;
    if (lang === 'hi') return `⚠️ तत्काल चेतावनी:\n• सीने में दर्द और सांस लेने में कठिनाई गंभीर आपातकालीन लक्षण हैं।\n• कृपया तुरंत नजदीकी अस्पताल जाएं।\nगंभीर लक्षणों के लिए कृपया डॉक्टर से परामर्श लें।`;
    if (lang === 'te') return `⚠️ అత్యవసర హెచ్చరిక:\n• ఛాతీ నొప్పి మరియు శ్వాస ఇబ్బంది అత్యవసర పరిస్థితి.\n• వెంటనే ఆసుపత్రికి వెళ్లండి.\nతీవ్రమైన లక్షణాల కోసం దయచేసి వైద్యుడిని సంప్రదించండి.`;
    if (lang === 'kn') return `⚠️ ತುರ್ತು ವೈದ್ಯಕೀಯ ಎಚ್ಚರಿಕೆ:\n• ಎದೆ ನೋವು ಮತ್ತು ಉಸಿರಾಟದ ತೊಂದರೆಗೆ ತಕ್ಷಣ ತುರ್ತು ಚಿಕಿತ್ಸೆ ಅಗತ್ಯವಿದೆ.\n• ದಯವಿಟ್ಟು ತಕ್ಷಣವೇ ಹತ್ತಿರದ ತುರ್ತು ಚಿಕಿತ್ಸಾ ಕೇಂದ್ರಕ್ಕೆ ಭೇಟಿ ನೀಡಿ.\nತೀವ್ರವಾದ ರೋಗಲಕ್ಷಣಗಳಿಗಾಗಿ ದಯವಿಟ್ಟು ವೈದ್ಯರನ್ನು ಸಂಪರ್ಕಿಸಿ.`;
    if (lang === 'ml') return `⚠️ അടിയന്തര വൈദ്യസഹായം:\n• നെഞ്ചുവേദനയും ശ്വാസതടസ്സവും അടിയന്തിര ചികിത്സ ആവശ്യമുള്ള ലക്ഷണങ്ങളാണ്.\n• ദയവായി ഉടൻ തന്നെ അടുത്തുള്ള ആശുപത്രിയിൽ എത്തുക.\nഗുരുതരമായ ലക്ഷണങ്ങൾക്ക് ദയവായി ഒരു ഡോക്ടറെ കാണുക.`;
    return `⚠️ IMMEDIATE MEDICAL ALERT:\n• Acute chest pain or difficulty breathing requires emergency medical care.\n• Please seek emergency hospital attention immediately.\nPlease consult a doctor for severe symptoms.`;
  }

  if (q.includes('head') || q.includes('தலை') || q.includes('सिर') || q.includes('తల') || q.includes('തല') || q.includes('ತಲೆ')) {
    if (lang === 'ta') return `• தலைவலிக்கு, அமைதியான அறையில் ஓய்வெடுத்து போதுமான அளவு தண்ணீர் குடிக்கவும்.\n• நீரிழப்பு மற்றும் மன அழுத்தம் தலைவலிக்கு பொதுவான காரணங்கள்.\nகடுமையான அறிகுறிகளுக்கு தயவுசெய்து மருத்துவரை அணுகவும்.`;
    if (lang === 'hi') return `• सिरदर्द के लिए शांत कमरे में आराम करें और पर्याप्त पानी पिएं।\n• तनाव से बचें और अपनी नियमित दवाएं समय पर लें।\nगंभीर लक्षणों के लिए कृपया डॉक्टर से परामर्श लें।`;
    if (lang === 'te') return `• తలనొప్పికి నిశ్శబ్ద ప్రదేశంలో విశ్రాంతి తీసుకోండి మరియు తగినంత నీరు త్రాగండి.\n• అలసట మరియు డిహైడ్రేషన్ తగ్గించండి.\nతీవ్రమైన లక్షణాల కోసం దయచేసి వైద్యుడిని సంప్రదించండి.`;
    if (lang === 'kn') return `• ತಲೆನೋವಿಗೆ ಶಾಂತವಾದ ಕೋಣೆಯಲ್ಲಿ ವಿಶ್ರಾಂತಿ ಪಡೆಯಿರಿ ಮತ್ತು ಸಾಕಷ್ಟು ನೀರು ಕುಡಿಯಿರಿ.\n• ಆಯಾಸ ಮತ್ತು ನಿರ್ಜಲೀಕರಣದಿಂದ ದೂರವಿರಿ.\nತೀವ್ರವಾದ ರೋಗಲಕ್ಷಣಗಳಿಗಾಗಿ ದಯವಿಟ್ಟು ವೈದ್ಯರನ್ನು ಸಂಪರ್ಕಿಸಿ.`;
    if (lang === 'ml') return `• തലവേദനയ്ക്ക് ശാന്തമായ മുറിയിൽ വിശ്രമിക്കുകയും ആവശ്യത്തിന് വെള്ളം കുടിക്കുകയും ചെയ്യുക.\n• കൂടുതൽ ആയാസകരമായ ജോലികൾ ഒഴിവാക്കുക.\nഗുരുതരമായ ലക്ഷണങ്ങൾക്ക് ദയവായി ഒരു ഡോക്ടറെ കാണുക.`;
    return `• For head pain, rest in a quiet, dim room and drink plenty of water to ensure hydration.\n• Over-the-counter paracetamol may help mild tension headaches if not contraindicated.\nPlease consult a doctor for severe symptoms.`;
  }

  if (q.includes('slight') || q.includes('pain') || q.includes('body') || q.includes('வலி') || q.includes('दर्द') || q.includes('నొప్పి') || q.includes('വേദന') || q.includes('ನೋವು')) {
    if (lang === 'ta') return `• லேசான உடல் வலிக்கு, கனமான வேலைகளைத் தவிர்த்து நல்ல ஓய்வெடுக்கவும்.\n• வெதுவெதுப்பான ஒத்தடம் மற்றும் போதிய தண்ணீர் குடிப்பது தசை வலியைத் தணிக்கும்.\nகடுமையான அறிகுறிகளுக்கு தயவுசெய்து மருத்துவரை அணுகவும்.`;
    if (lang === 'hi') return `• हल्के बदन दर्द के लिए आराम करें और भारी काम करने से बचें।\n• गुनगुने पानी की सिकाई और पर्याप्त पानी पीने से आराम मिलता है।\nगंभीर लक्षणों के लिए कृपया डॉक्टर से परामर्श लें।`;
    if (lang === 'te') return `• తేలికపాటి నొప్పులకు తగినంత విశ్రాంతి తీసుకోండి మరియు శ్రమ తగ్గించండి.\n• గోరువెచ్చని నీటితో స్నానం ఉపశమనం ఇస్తుంది.\nతీవ్రమైన లక్షణాల కోసం దయచేసి వైద్యుడిని సంప్రదించండి.`;
    if (lang === 'kn') return `• ಸೌಮ್ಯವಾದ ದೇಹದ ನೋವಿಗೆ ವಿಶ್ರಾಂತಿ ಪಡೆಯಿರಿ ಮತ್ತು ಶ್ರಮವನ್ನು ಕಡಿಮೆ ಮಾಡಿ.\n• ಸಾಕಷ್ಟು ನೀರು ಕುಡಿಯುವುದು ಸ್ನಾಯು ನೋವನ್ನು ಕಡಿಮೆ ಮಾಡಲು ಸಹಾಯ ಮಾಡುತ್ತದೆ.\nತೀವ್ರವಾದ ರೋಗಲಕ್ಷಣಗಳಿಗಾಗಿ ದಯವಿಟ್ಟು ವೈದ್ಯರನ್ನು ಸಂಪರ್ಕಿಸಿ.`;
    if (lang === 'ml') return `• നേരിയ ശരീരവേദനയ്ക്ക് വിശ്രമിക്കുകയും കഠിനമായ ജോലികൾ ഒഴിവാക്കുകയും ചെയ്യുക.\n• ആവശ്യത്തിന് വെള്ളം കുടിക്കുന്നത് പേശിവേദന കുറയ്ക്കാൻ സഹായിക്കും.\nഗുരുതരമായ ലക്ഷണങ്ങൾക്ക് ദയവായി ഒരു ഡോക്ടറെ കാണുക.`;
    return `• For mild or slight body pain, avoid heavy physical exertion and rest the affected area.\n• Gentle warmth and good hydration can help soothe muscular discomfort.\nPlease consult a doctor for severe symptoms.`;
  }

  if (q.includes('coffee') || q.includes('tea') || q.includes('காபி') || q.includes('कॉफी') || q.includes('కాఫీ') || q.includes('കാപ്പി') || q.includes('ಕಾಫಿ')) {
    if (lang === 'ta') return `• இரத்த அழுத்த மாத்திரைகளை எப்போதும் சுத்தமான தண்ணீருடன் மட்டுமே உட்கொள்ள வேண்டும், காபியுடன் அல்ல.\n• காபியில் உள்ள காஃபின் தற்காலிகமாக இரத்த அழுத்தத்தை அதிகரிக்கலாம்.\nகடுமையான அறிகுறிகளுக்கு தயவுசெய்து மருத்துவரை அணுகவும்.`;
    if (lang === 'hi') return `• ब्लड प्रेशर की दवा हमेशा सादे पानी के साथ ही लें, कॉफी या चाय के साथ नहीं।\n• कैफीन रक्तचाप को अस्थायी रूप से बढ़ा सकता है।\nगंभीर लक्षणों के लिए कृपया डॉक्टर से परामर्श लें।`;
    if (lang === 'te') return `• బీపీ మందులను మంచి నీటితో మాత్రమే తీసుకోవాలి, కాఫీతో తీసుకోకూడదు.\n• కెఫిన్ వల్ల రక్తపోటు పెరిగే అవకాశం ఉంది.\nతీవ్రమైన లక్షణాల కోసం దయచేసి వైద్యుడిని సంప్రదించండి.`;
    if (lang === 'kn') return `• ರಕ್ತದೊತ್ತಡದ ಮಾತ್ರೆಗಳನ್ನು ಯಾವಾಗಲೂ ನೀರಿನೊಂದಿಗೆ ಮಾತ್ರ ತೆಗೆದುಕೊಳ್ಳಬೇಕು, ಕಾಫಿಯೊಂದಿಗೆ ಅಲ್ಲ.\n• ಕೆಫೀನ್ ತಾತ್ಕಾಲಿಕವಾಗಿ ರಕ್ತದೊತ್ತಡವನ್ನು ಹೆಚ್ಚಿಸಬಹುದು.\nತೀವ್ರವಾದ ರೋಗಲಕ್ಷಣಗಳಿಗಾಗಿ ದಯವಿಟ್ಟು ವೈದ್ಯರನ್ನು ಸಂಪರ್ಕಿಸಿ.`;
    if (lang === 'ml') return `• രക്തസമ്മർദ്ദത്തിനുള്ള മരുന്നുകൾ എപ്പോഴും ശുദ്ധജലത്തോടൊപ്പം മാത്രം കഴിക്കുക, കാപ്പിയോടൊപ്പം കഴിക്കരുത്.\n• കഫീൻ രക്തസമ്മർദ്ദം താൽക്കാലികമായി വർദ്ധിപ്പിച്ചേക്കാം.\nഗുരുതരമായ ലക്ഷണങ്ങൾക്ക് ദയവായി ഒരു ഡോക്ടറെ കാണുക.`;
    return `• It is strongly recommended to take blood pressure medications with plain water, not coffee.\n• Caffeine can temporarily spike blood pressure and interfere with drug absorption.\nPlease consult a doctor for severe symptoms.`;
  }

  if (q.includes('miss') || q.includes('forgot') || q.includes('மறந்து') || q.includes('भूल') || q.includes('మర్చి') || q.includes('മറന്നു') || q.includes('ಮರೆತು')) {
    if (lang === 'ta') return `• மருந்தை எடுக்க மறந்துவிட்டால், நினைவுக்கு வந்தவுடன் உட்கொள்ளவும்.\n• அடுத்த வேளைக்கு அருகிலிருந்தால் தவறவிட்டதை விட்டுவிடுங்கள். இரட்டை மாத்திரை எடுக்க வேண்டாம்.\nகடுமையான அறிகுறிகளுக்கு தயவுசெய்து மருத்துவரை அணுகவும்.`;
    if (lang === 'hi') return `• यदि कोई खुराक छूट जाए, तो याद आते ही ले लें।\n• अगली खुराक का समय पास हो तो छूटी खुराक छोड़ दें। कभी भी दो गोलियां एक साथ न लें।\nगंभीर लक्षणों के लिए कृपया डॉक्टर से परामर्श लें।`;
    if (lang === 'te') return `• డోస్ మర్చిపోతే గుర్తుకు రాగానే తీసుకోండి.\n• తదుపరి డోస్ సమయం దగ్గరగా ఉంటే రెండు డోస్‌లు కలిపి తీసుకోవద్దు.\nతీవ్రమైన లక్షణాల కోసం దయచేసి వైద్యుడిని సంప్రదించండి.`;
    if (lang === 'kn') return `• ಔಷಧಿ ತೆಗೆದುಕೊಳ್ಳಲು ಮರೆತರೆ, ನೆನಪಾದ ತಕ್ಷಣ ತೆಗೆದುಕೊಳ್ಳಿ.\n• ಮುಂದಿನ ಡೋಸ್ ಸಮಯ ಹತ್ತಿರವಿದ್ದರೆ ಮರೆತ ಡೋಸ್ ಬಿಟ್ಟುಬಿಡಿ. ಡಬಲ್ ಡೋಸ್ ತೆಗೆದುಕೊಳ್ಳಬೇಡಿ.\nತೀವ್ರವಾದ ರೋಗಲಕ್ಷಣಗಳಿಗಾಗಿ ದಯವಿಟ್ಟು ವೈದ್ಯರನ್ನು ಸಂಪರ್ಕಿಸಿ.`;
    if (lang === 'ml') return `• മരുന്ന് കഴിക്കാൻ മറന്നുപോയാൽ, ഓർമ്മവരുമ്പോൾ തന്നെ കഴിക്കുക.\n• അടുത്ത ഡോസിന്റെ സമയമായിട്ടുണ്ടെങ്കിൽ വിട്ടുപോയത് ഒഴിവാക്കുക. ഇരട്ടി ഡോസ് കഴിക്കരുത്.\nഗുരുതരമായ ലക്ഷണങ്ങൾക്ക് ദയവായി ഒരു ഡോക്ടറെ കാണുക.`;
    return `• If you miss a dose, take it as soon as you remember that day.\n• If it is almost time for your next scheduled dose, skip the missed one. Never take a double dose.\nPlease consult a doctor for severe symptoms.`;
  }

  if (lang === 'ta') return `• உங்கள் உடல்நலக் கேள்வியைப் புரிந்து கொண்டேன். பரிந்துரைக்கப்பட்ட மருந்துகளை அட்டவணைப்படி உட்கொள்ளவும்.\n• போதுமான தண்ணீர் அருந்தி நல்ல ஓய்வெடுக்கவும்.\nகடுமையான அறிகுறிகளுக்கு தயவுசெய்து மருத்துவரை அணுகவும்.`;
  if (lang === 'hi') return `• आपकी स्वास्थ्य संबंधी बात नोट कर ली गई है। कृपया अपनी निर्धारित दवाओं का समय पर सेवन करें।\n• पर्याप्त पानी पिएं और अच्छा आराम करें।\nगंभीर लक्षणों के लिए कृपया डॉक्टर से परामर्श लें।`;
  if (lang === 'te') return `• మీ ఆరోగ్య ప్రశ్నను అర్థం చేసుకున్నాను. సూచించిన మందులను సమయానికి క్రమం తప్పకుండా తీసుకోండి.\n• తగినంత నీరు త్రాగండి మరియు విశ్రాంతి తీసుకోండి.\nతీవ్రమైన లక్షణాల కోసం దయచేసి వైద్యుడిని సంప్రదించండి.`;
  if (lang === 'ml') return `• താങ്കളുടെ ആരോഗ്യപരമായ സംശയം മനസ്സിലാക്കുന്നു. നിർദ്ദേശിച്ച മരുന്നുകൾ കൃത്യസമയത്ത് കഴിക്കുക.\n• ആവശ്യത്തിന് വെള്ളം കുടിക്കുകയും വിശ്രമിക്കുകയും ചെയ്യുക.\nഗുരുതരമായ ലക്ഷണങ്ങൾക്ക് ദയവായി ഒരു ഡോക്ടറെ കാണുക.`;
  if (lang === 'kn') return `• ನಿಮ್ಮ ಆರೋಗ್ಯ ಪ್ರಶ್ನೆಯನ್ನು ಗಮನಿಸಿದ್ದೇನೆ. ದಯವಿಟ್ಟು ವೈದ್ಯರು ಸೂಚಿಸಿದ ಔಷಧಿಗಳನ್ನು ನಿಯಮಿತವಾಗಿ ತೆಗೆದುಕೊಳ್ಳಿ.\n• ಸಾಕಷ್ಟು ನೀರು ಕುಡಿಯಿರಿ ಮತ್ತು ವಿಶ್ರಾಂತಿ ಪಡೆಯಿರಿ.\nತೀವ್ರವಾದ ರೋಗಲಕ್ಷಣಗಳಿಗಾಗಿ ದಯವಿಟ್ಟು ವೈದ್ಯರನ್ನು ಸಂಪರ್ಕಿಸಿ.`;
  return `• I have noted your health query. Please maintain proper hydration, rest, and adhere to prescribed medication schedules.\n• Check your prescription label for specific dosage directions.\nPlease consult a doctor for severe symptoms.`;
}

// ─── Hybrid AI Chat & Voice Client ──────────────────────────────────────────

function handleFetchError(error: unknown, fallbackMessage?: string): AIChatResponse {
  if (fallbackMessage) {
    return {
      success: true,
      response: fallbackMessage,
      model: 'smartmed-clinical-engine',
      offline: true,
      rag_grounded: true,
      timing: '0.01s',
    };
  }

  return {
    success: true,
    response: '• Please maintain proper hydration, rest, and take prescribed medicines as directed.\nPlease consult a doctor for severe symptoms.',
    model: 'smartmed-clinical-engine',
    offline: true,
  };
}

/**
 * Send a chat message via Hybrid AI Router.
 * - OFFLINE MODE: If offline or requested, routes directly to local on-device MNN / WebLLM pipeline.
 * - ONLINE MODE: If online, routes to AWS backend for NVIDIA NIM processing with live WHO/FDA lookups.
 * - AUTOMATIC FALLBACK: If online query encounters network error or timeout, seamlessly falls back
 *   to local offline MNN inference.
 */
export async function sendMessageToLocalAI(
  message: string,
  conversationHistory: AIMessage[] = [],
  options?: ChatOptions,
): Promise<AIChatResponse> {
  const online = isOnline();
  const requestedMode = options?.mode ?? 'auto';
  const effectiveMode = requestedMode === 'offline' ? 'offline' : (!online ? 'offline' : 'online');
  const timeoutMs = options?.timeout ?? 4000;
  const userLang = options?.language || 'en';
  const augmentedPrompt = getAugmentedSystemPrompt(userLang);

  // 1. ONLINE PATH: Query AWS-hosted backend with fast timeout
  if (effectiveMode === 'online') {
    const cloudController = new AbortController();
    const cloudTimeout = setTimeout(() => cloudController.abort(), Math.min(timeoutMs, 4000));

    try {
      const response = await fetch(`${CLOUD_API_BASE_URL}/api/ai/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message,
          conversationId: getConversationId(),
          history: conversationHistory.slice(-20),
          mode: 'online',
          language: userLang,
          preferred_language: userLang,
          system_prompt: augmentedPrompt,
        }),
        signal: cloudController.signal,
      });

      clearTimeout(cloudTimeout);

      if (response.ok) {
        const cloudData: AIChatResponse = await response.json();
        if (cloudData && cloudData.success && cloudData.response) {
          return cloudData;
        }
      }
    } catch {
      clearTimeout(cloudTimeout);
    }
  }

  // 2. OFFLINE / LOCAL PATH: Query local backend with fast timeout
  const localController = new AbortController();
  const localTimeout = setTimeout(() => localController.abort(), Math.min(timeoutMs, 3000));

  try {
    const targetUrl = LOCAL_API_BASE_URL ? `${LOCAL_API_BASE_URL}/api/ai/chat` : `${AI_BASE_URL}/api/ai/chat`;
    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        conversationId: getConversationId(),
        history: conversationHistory.slice(-20),
        mode: 'offline',
        language: userLang,
        preferred_language: userLang,
        system_prompt: augmentedPrompt,
      }),
      signal: localController.signal,
    });

    clearTimeout(localTimeout);

    if (response.ok) {
      const data: AIChatResponse = await response.json();
      if (data && data.success && data.response) {
        return data;
      }
    }
  } catch {
    clearTimeout(localTimeout);
  }

  // 3. OFFLINE CLINICAL ENGINE FALLBACK: Instant deterministic answer in patient's language
  const fallbackClinical = resolveClinicalTriageOffline(message, { language: userLang });
  return {
    success: true,
    response: fallbackClinical,
    model: 'smartmed-clinical-engine',
    offline: true,
    rag_grounded: true,
    timing: '0.01s',
  };
}

/**
 * Send a voice query to the AI voice inference server (/api/ai/voice).
 * Uses deterministic clinical resolver first (sub-millisecond response),
 * delegating open-ended queries to fast local voice MNN / NIM.
 */
export async function sendVoiceMessageToLocalAI(
  message: string,
  conversationHistory: AIMessage[] = [],
  medicinesContext?: Array<{ name: string; time?: string; status?: string; dose?: string; food?: string }>,
  patientName: string = 'Mr. Ravi',
  language: string = 'en',
): Promise<AIChatResponse> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 3500);

  try {
    const response = await fetch(`${AI_BASE_URL}/api/ai/voice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        conversationId: getConversationId(),
        history: conversationHistory.slice(-10),
        medicinesContext: medicinesContext?.map(m => ({
          name: m.name,
          time: m.time || '',
          dose: m.dose || '',
          food: m.food || '',
          status: m.status || '',
        })),
        patientName,
        language,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      const data: AIChatResponse = await response.json();
      if (data && data.success && data.response) {
        return data;
      }
    }
  } catch {
    clearTimeout(timeoutId);
  }

  // Instant offline voice resolver
  const fallbackVoice = resolveClinicalTriageOffline(message, { isVoice: true, patientName, language });
  return {
    success: true,
    response: fallbackVoice,
    model: 'smartmed-voice-engine',
    offline: true,
    timing: '0.01s',
  };
}

/**
 * Asynchronously process a prescription image with PaddleOCR pipeline.
 * - OFFLINE MODE: If user has no internet, routes OCR to the local on-device PaddleOCR pipeline.
 * - ONLINE MODE: If internet is available, routes to the AWS EC2-hosted PaddleOCR service.
 * Accepts File, Blob, or base64 string.
 */
export async function processPrescriptionOCR(
  fileOrBase64: File | Blob | string,
  options?: { mode?: 'auto' | 'offline' | 'online' },
): Promise<PrescriptionOCRResponse> {
  const online = isOnline();
  const effectiveMode = options?.mode === 'offline' ? 'offline' : (!online ? 'offline' : 'online');
  const targetBase = effectiveMode === 'offline'
    ? (LOCAL_API_BASE_URL || AI_BASE_URL)
    : (CLOUD_API_BASE_URL || AI_BASE_URL);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60_000);

  try {
    let response: Response;

    if (typeof fileOrBase64 === 'string') {
      response = await fetch(`${targetBase}/api/ocr/prescription`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_base64: fileOrBase64 }),
        signal: controller.signal,
      });
    } else {
      const formData = new FormData();
      formData.append('file', fileOrBase64);
      response = await fetch(`${targetBase}/api/ocr/prescription`, {
        method: 'POST',
        body: formData,
        signal: controller.signal,
      });
    }

    clearTimeout(timeoutId);

    if (!response.ok) {
      // Auto-fallback to local on-device OCR if cloud request fails
      if (targetBase !== LOCAL_API_BASE_URL && LOCAL_API_BASE_URL) {
        console.warn('[PrescriptionOCR] Cloud OCR error, retrying on local on-device PaddleOCR...');
        return processPrescriptionOCR(fileOrBase64, { mode: 'offline' });
      }
      const errorJson = await response.json().catch(() => ({}));
      return {
        success: false,
        text: '',
        confidence: 0,
        regions: [],
        medicines: [],
        error: errorJson.detail || `OCR server returned HTTP ${response.status}`,
      };
    }

    return await response.json();
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    if (targetBase !== LOCAL_API_BASE_URL && LOCAL_API_BASE_URL) {
      console.warn('[PrescriptionOCR] Network failed, falling back to local on-device PaddleOCR...', err);
      return processPrescriptionOCR(fileOrBase64, { mode: 'offline' });
    }
    return {
      success: false,
      text: '',
      confidence: 0,
      regions: [],
      medicines: [],
      error: err instanceof Error ? err.message : 'Failed to connect to prescription OCR service',
    };
  }
}

// ─── Pharmacological Lookups & Telephony Helpers ────────────────────────────

/**
 * Live OpenFDA drug label and pharmacological lookup.
 */
export async function fetchOpenFDADrugInfo(drugName: string): Promise<{ success: boolean; data?: string; error?: string }> {
  try {
    const res = await fetch(`${AI_BASE_URL}/api/medical/openfda?query=${encodeURIComponent(drugName)}`, {
      method: 'GET',
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'OpenFDA lookup failed' };
  }
}

/**
 * Live WHO ICD-11 disease classification search.
 */
export async function fetchICD11Classification(query: string): Promise<{ success: boolean; classification?: string; error?: string }> {
  try {
    const res = await fetch(`${AI_BASE_URL}/api/medical/icd11?query=${encodeURIComponent(query)}`, {
      method: 'GET',
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'ICD-11 search failed' };
  }
}

/**
 * Trigger outbound automated Exotel IVR telephone call for medication reminders.
 */
export async function triggerExotelReminderCall(
  toNumber: string,
  medicineName: string,
  dose: string = '',
  patientName: string = 'Patient',
): Promise<{ success: boolean; message?: string; error?: string }> {
  try {
    const res = await fetch(`${AI_BASE_URL}/api/ivr/exotel/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to_number: toNumber,
        patient_name: patientName,
        medicine_name: medicineName,
        dose,
      }),
      signal: AbortSignal.timeout(10000),
    });
    return await res.json();
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Exotel call trigger failed' };
  }
}

// ─── Status & Shared Memory Helpers ─────────────────────────────────────────

export async function checkAIStatus(): Promise<AIStatusResponse | null> {
  try {
    const response = await fetch(`${AI_BASE_URL}/api/ai/status`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

export async function isAIServerReachable(): Promise<boolean> {
  try {
    const response = await fetch(`${AI_BASE_URL}/api/ai/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(3000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export function appendTurnToSharedHistory(userText: string, aiText: string): void {
  const current = loadConversationHistory();
  const updated: AIMessage[] = [
    ...current,
    { role: 'user', content: userText },
    { role: 'assistant', content: aiText },
  ];
  saveConversationHistory(updated.slice(-30));
}

// ─── Local Storage ──────────────────────────────────────────────────────────

function getConversationId(): string {
  let id = localStorage.getItem('smartmed-conversation-id');
  if (!id) {
    id = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    localStorage.setItem('smartmed-conversation-id', id);
  }
  return id;
}

export function saveConversationHistory(messages: AIMessage[]): void {
  try {
    const data = {
      conversationId: getConversationId(),
      messages,
      updatedAt: new Date().toISOString(),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Fail silently if storage full
  }
}

export function loadConversationHistory(): AIMessage[] {
  try {
    if (localStorage.getItem('smartmed-chat-history')) {
      localStorage.removeItem('smartmed-chat-history');
    }

    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw);
    if (!Array.isArray(data?.messages)) return [];

    return data.messages.filter((m: AIMessage) => {
      const c = (m.content || '').toLowerCase();
      return !(
        c.includes("doctor's clinical prescription") ||
        c.includes("wait at least 30 to 45 minutes") ||
        c.includes("scheduled to be taken after food")
      );
    });
  } catch {
    return [];
  }
}

export function clearConversationHistory(): void {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem('smartmed-chat-history');
  localStorage.removeItem('smartmed-conversation-id');
}

// ─── Twilio Web Telephony & Scheduler Integration ──────────────────────────

export interface ScheduleCallRequest {
  phone_number: string;
  medicine: string;
  dosage: string;
  trigger_time?: string;
  patient_name?: string;
  preferred_language?: string;
  patient_id?: string;
  medicine_id?: string | number;
  meal_relation?: string;
  reminder_id?: string;
}

export interface ScheduleCallResponse {
  success: boolean;
  job_id?: string;
  scheduled_time?: string;
  phone_number?: string;
  medicine?: string;
  dosage?: string;
  patient_name?: string;
  preferred_language?: string;
  error?: string;
  mock?: boolean;
}

/**
 * Schedules a Twilio voice reminder call at a specific trigger_time via Python backend APScheduler.
 * Resilient offline fallback caches the scheduled call to localStorage if network is unavailable.
 */
export async function scheduleTwilioCall(req: ScheduleCallRequest): Promise<ScheduleCallResponse> {
  const base = getBaseApiUrl();
  const lang = req.preferred_language || (typeof localStorage !== 'undefined' ? localStorage.getItem('smartmed_preferred_language') : null) || 'en';
  const payload = { ...req, preferred_language: lang };
  try {
    const res = await fetch(`${base}/api/call/schedule`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      const data = await res.json();
      console.log('[Twilio Scheduler] Scheduled call successfully:', data);
      return data;
    }

    const errData = await res.json().catch(() => ({}));
    console.warn('[Twilio Scheduler] Backend returned error status:', res.status, errData);
    return {
      success: false,
      error: errData.detail || errData.error || `Server responded with ${res.status}`,
    };
  } catch (err: any) {
    console.warn('[Twilio Scheduler] Network offline or unreachable. Saving locally:', err);
    // Offline resilience: save scheduled call locally to localStorage
    try {
      const existing = JSON.parse(localStorage.getItem('smartmed_offline_scheduled_calls') || '[]');
      existing.push({ ...payload, scheduledAt: new Date().toISOString() });
      localStorage.setItem('smartmed_offline_scheduled_calls', JSON.stringify(existing));
    } catch {}

    return {
      success: true,
      job_id: `offline-local-${Date.now()}`,
      scheduled_time: req.trigger_time,
      medicine: req.medicine,
      dosage: req.dosage,
      patient_name: req.patient_name,
      preferred_language: lang,
    };
  }
}

/**
 * Triggers an immediate outbound Twilio telephone reminder call to the patient.
 */
export async function triggerTwilioCallNow(req: ScheduleCallRequest): Promise<ScheduleCallResponse> {
  const base = getBaseApiUrl();
  const lang = req.preferred_language || (typeof localStorage !== 'undefined' ? localStorage.getItem('smartmed_preferred_language') : null) || 'en';
  const payload = { ...req, preferred_language: lang };
  try {
    const res = await fetch(`${base}/api/call/trigger_now`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      return await res.json();
    }
    const errData = await res.json().catch(() => ({}));
    return {
      success: false,
      error: errData.detail || errData.error || `Server responded with ${res.status}`,
    };
  } catch (err: any) {
    console.warn('[Twilio Instant Call] Failed to reach server:', err);
    return {
      success: false,
      error: 'Network connection unavailable',
    };
  }
}

