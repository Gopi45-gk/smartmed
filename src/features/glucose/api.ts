import { GlucoseReading, GlucoseAlert, GlucoseThresholds, GlucoseCorrelationInsight, DEFAULT_THRESHOLDS } from './types';

function getApiBaseUrl(): string {
  if (typeof window === 'undefined') return 'http://localhost:8100';
  if ((import.meta as any).env?.VITE_API_BASE_URL) return (import.meta as any).env.VITE_API_BASE_URL;
  if ((import.meta as any).env?.VITE_AWS_API_URL) return (import.meta as any).env.VITE_AWS_API_URL;
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    return window.location.port === '8100' ? '' : 'http://localhost:8100';
  }
  return '';
}

const API_TIMEOUT_MS = 8000;

async function fetchWithTimeout(url: string, options: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timeoutId);
    return res;
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

export async function submitGlucoseReadingApi(reading: GlucoseReading): Promise<{ success: boolean; alerts?: GlucoseAlert[]; error?: string }> {
  const base = getApiBaseUrl();
  try {
    const payload = {
      id: reading.id,
      patient_id: reading.patientId,
      value_mgdl: reading.value_mgdl,
      unit_entered: reading.unit_entered,
      context: reading.context,
      measured_at: reading.measuredAt,
      source: reading.source,
      created_at: reading.createdAt,
    };

    const res = await fetchWithTimeout(`${base}/api/glucose`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text();
      return { success: false, error: `HTTP ${res.status}: ${errText}` };
    }

    const data = await res.json();
    return {
      success: true,
      alerts: data.alerts || [],
    };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Network connection failed' };
  }
}

export async function fetchGlucoseReadingsApi(patientId: string, fromDate?: string, toDate?: string): Promise<{ success: boolean; readings: GlucoseReading[]; error?: string }> {
  const base = getApiBaseUrl();
  try {
    const params = new URLSearchParams({ patientId });
    if (fromDate) params.append('from', fromDate);
    if (toDate) params.append('to', toDate);

    const res = await fetchWithTimeout(`${base}/api/glucose?${params.toString()}`);
    if (!res.ok) {
      return { success: false, readings: [], error: `HTTP ${res.status}` };
    }

    const data = await res.json();
    const items: GlucoseReading[] = (data.items || []).map((item: any) => ({
      id: item.id,
      patientId: item.patient_id,
      value_mgdl: Number(item.value_mgdl),
      unit_entered: item.unit_entered || 'mg/dL',
      context: item.context || 'random',
      measuredAt: item.measured_at,
      source: item.source || 'manual',
      createdAt: item.created_at,
      syncedAt: item.synced_at || new Date().toISOString(),
    }));

    return { success: true, readings: items };
  } catch (err: any) {
    return { success: false, readings: [], error: err?.message || 'Server offline' };
  }
}

export async function deleteGlucoseReadingApi(id: string): Promise<boolean> {
  const base = getApiBaseUrl();
  try {
    const res = await fetchWithTimeout(`${base}/api/glucose/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function fetchGlucoseAlertsApi(patientId: string): Promise<GlucoseAlert[]> {
  const base = getApiBaseUrl();
  try {
    const res = await fetchWithTimeout(`${base}/api/glucose/alerts?patientId=${encodeURIComponent(patientId)}`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.alerts || [];
  } catch {
    return [];
  }
}

export async function fetchThresholdsApi(patientId: string): Promise<GlucoseThresholds> {
  const base = getApiBaseUrl();
  try {
    const res = await fetchWithTimeout(`${base}/api/glucose/thresholds?patientId=${encodeURIComponent(patientId)}`);
    if (!res.ok) return { ...DEFAULT_THRESHOLDS, patient_id: patientId };
    return await res.json();
  } catch {
    return { ...DEFAULT_THRESHOLDS, patient_id: patientId };
  }
}

export async function saveThresholdsApi(thresholds: GlucoseThresholds): Promise<boolean> {
  const base = getApiBaseUrl();
  try {
    const res = await fetchWithTimeout(`${base}/api/glucose/thresholds`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(thresholds),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function fetchCorrelationInsightApi(patientId: string): Promise<GlucoseCorrelationInsight | null> {
  const base = getApiBaseUrl();
  try {
    const res = await fetchWithTimeout(`${base}/api/glucose/correlation?patientId=${encodeURIComponent(patientId)}`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}
