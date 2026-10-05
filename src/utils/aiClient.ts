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
const CLOUD_API_BASE_URL = typeof window !== 'undefined'
  ? ((import.meta as any).env?.VITE_AWS_API_URL ?? (import.meta as any).env?.VITE_API_BASE_URL ?? (window.location.port === '8100' ? 'http://localhost:8100' : ''))
  : 'http://localhost:8100';

const LOCAL_API_BASE_URL = typeof window !== 'undefined'
  ? ((import.meta as any).env?.VITE_LOCAL_API_URL ?? 'http://localhost:8100')
  : 'http://localhost:8100';

const AI_BASE_URL = CLOUD_API_BASE_URL;
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

// ─── Hybrid AI Chat & Voice Client ──────────────────────────────────────────

function handleFetchError(error: unknown): AIChatResponse {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return {
      success: false,
      error: 'Inference timed out. The local MNN model took too long to generate a response.',
      model: 'local-mnn-model',
      offline: true,
    };
  }

  if (error instanceof TypeError && (error.message.includes('fetch') || error.message.includes('network'))) {
    return {
      success: false,
      error: 'Cannot connect to the AI server. Please make sure "python server.py" is running or AWS EC2 is reachable.',
      model: 'local-mnn-model',
      offline: true,
    };
  }

  return {
    success: false,
    error: `Connection error: ${error instanceof Error ? error.message : 'Unknown error'}. Is the AI server running?`,
    model: 'local-mnn-model',
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
  const timeoutMs = options?.timeout ?? FETCH_TIMEOUT;

  // 1. ONLINE PATH: Query AWS-hosted backend with NVIDIA NIM router & verified pharmacological RAG
  if (effectiveMode === 'online') {
    const cloudController = new AbortController();
    const cloudTimeout = setTimeout(() => cloudController.abort(), Math.min(timeoutMs, 45_000));

    try {
      const response = await fetch(`${CLOUD_API_BASE_URL}/api/ai/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message,
          conversationId: getConversationId(),
          history: conversationHistory.slice(-20),
          mode: 'online',
        }),
        signal: cloudController.signal,
      });

      clearTimeout(cloudTimeout);

      if (response.ok) {
        const cloudData: AIChatResponse = await response.json();
        return cloudData;
      }
      console.warn(`[HybridRouter] Cloud NIM returned HTTP ${response.status}, falling back to local MNN...`);
    } catch (cloudErr) {
      clearTimeout(cloudTimeout);
      console.warn('[HybridRouter] Cloud NIM request failed, falling back to local MNN...', cloudErr);
    }
  }

  // 2. OFFLINE PATH: Local on-device MNN inference
  const localController = new AbortController();
  const localTimeout = setTimeout(() => localController.abort(), timeoutMs);

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
      }),
      signal: localController.signal,
    });

    clearTimeout(localTimeout);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return {
        success: false,
        error: errorData?.detail || `Server error: ${response.status}`,
        model: 'local-mnn-model',
        offline: true,
      };
    }

    return await response.json();
  } catch (error: unknown) {
    clearTimeout(localTimeout);
    return handleFetchError(error);
  }
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
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

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

    if (!response.ok) {
      if (response.status === 404) {
        return sendMessageToLocalAI(message, conversationHistory);
      }
      const errorData = await response.json().catch(() => ({}));
      return {
        success: false,
        error: errorData?.detail || `Server error: ${response.status}`,
        model: 'local-mnn-model',
        offline: true,
      };
    }

    return await response.json();
  } catch (error: unknown) {
    clearTimeout(timeoutId);
    return handleFetchError(error);
  }
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
