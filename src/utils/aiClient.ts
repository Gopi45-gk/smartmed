/**
 * SmartMed AI Client
 * Handles communication between the frontend and the local MNN inference server.
 * All data stays local — no external API calls.
 */

const AI_BASE_URL = typeof window !== 'undefined'
  ? ((import.meta as any).env?.VITE_API_BASE_URL ?? (window.location.port === '8100' ? 'http://localhost:8100' : ''))
  : 'http://localhost:8100';
const STORAGE_KEY = 'smartmed-mnn-v1';
const FETCH_TIMEOUT = 130_000; // 130s (slightly longer than server's 120s inference timeout)

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
  timing?: string;
}

export interface AIStatusResponse {
  status: string;
  model_name: string;
  device: string;
  model_exists: boolean;
  error?: string | null;
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

// ─── API Client ─────────────────────────────────────────────────────────────

/**
 * Send a voice query to the local AI inference server (/api/ai/voice).
 * Shares the exact same MNN LLM model and inference pipeline.
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
      // If /api/ai/voice is not yet reloaded on server, gracefully try /api/ai/chat
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
      error: 'Cannot connect to the local AI server. Please make sure "python server.py" is running in the ai/ directory.',
      model: 'local-mnn-model',
      offline: true,
    };
  }

  return {
    success: false,
    error: `Connection error: ${error instanceof Error ? error.message : 'Unknown error'}. Is the local AI server running?`,
    model: 'local-mnn-model',
    offline: true,
  };
}

/**
 * Send a chat message to the local AI inference server.
 */
export async function sendMessageToLocalAI(
  message: string,
  conversationHistory: AIMessage[] = [],
): Promise<AIChatResponse> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

  try {
    const response = await fetch(`${AI_BASE_URL}/api/ai/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        conversationId: getConversationId(),
        history: conversationHistory.slice(-20), // Send last 20 messages as context
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

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
    clearTimeout(timeoutId);
    return handleFetchError(error);
  }
}

/**
 * Append a single user-assistant turn to the shared conversation history.
 * Allows Phone Call AI and Chat AI to share the same conversational memory.
 */
export function appendTurnToSharedHistory(userText: string, aiText: string): void {
  const current = loadConversationHistory();
  const updated: AIMessage[] = [
    ...current,
    { role: 'user', content: userText },
    { role: 'assistant', content: aiText },
  ];
  saveConversationHistory(updated.slice(-30));
}

/**
 * Check the status of the local AI service.
 * Returns null if the service is unreachable.
 */
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

/**
 * Simple health check — returns true if the AI server is reachable.
 */
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

/**
 * Asynchronously process a prescription image with PaddleOCR pipeline.
 * Accepts File, Blob, or base64 string.
 */
export async function processPrescriptionOCR(
  fileOrBase64: File | Blob | string
): Promise<PrescriptionOCRResponse> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60_000);

  try {
    let response: Response;

    if (typeof fileOrBase64 === 'string') {
      // Base64 JSON payload
      response = await fetch(`${AI_BASE_URL}/api/ocr/prescription`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_base64: fileOrBase64 }),
        signal: controller.signal,
      });
    } else {
      // Multipart form data
      const formData = new FormData();
      formData.append('file', fileOrBase64);
      response = await fetch(`${AI_BASE_URL}/api/ocr/prescription`, {
        method: 'POST',
        body: formData,
        signal: controller.signal,
      });
    }

    clearTimeout(timeoutId);

    if (!response.ok) {
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

// ─── Local Storage ──────────────────────────────────────────────────────────

/**
 * Get or create a local conversation ID.
 */
function getConversationId(): string {
  let id = localStorage.getItem('smartmed-conversation-id');
  if (!id) {
    id = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    localStorage.setItem('smartmed-conversation-id', id);
  }
  return id;
}

/**
 * Save conversation history to localStorage.
 */
export function saveConversationHistory(messages: AIMessage[]): void {
  try {
    const data = {
      conversationId: getConversationId(),
      messages,
      updatedAt: new Date().toISOString(),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // localStorage may be full or unavailable — fail silently
  }
}

/**
 * Load conversation history from localStorage.
 * Automatically purges stale mock data from previous runs.
 */
export function loadConversationHistory(): AIMessage[] {
  try {
    // Purge legacy mock data stored under old key
    if (localStorage.getItem('smartmed-chat-history')) {
      localStorage.removeItem('smartmed-chat-history');
    }

    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw);
    if (!Array.isArray(data?.messages)) return [];

    // Filter out any stale mock responses
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

/**
 * Clear conversation history from localStorage.
 */
export function clearConversationHistory(): void {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem('smartmed-chat-history');
  localStorage.removeItem('smartmed-conversation-id');
}
