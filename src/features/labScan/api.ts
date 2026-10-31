import { LabScanResponse } from './types';

function getApiBaseUrl(): string {
  if (typeof window === 'undefined') return 'http://localhost:8100';
  if ((import.meta as any).env?.VITE_API_BASE_URL) return (import.meta as any).env.VITE_API_BASE_URL;
  if ((import.meta as any).env?.VITE_AWS_API_URL) return (import.meta as any).env.VITE_AWS_API_URL;
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    return window.location.port === '8100' ? '' : 'http://localhost:8100';
  }
  return '';
}

const SCAN_TIMEOUT_MS = 25000;

export async function scanLabReportApi(fileOrBlob: File | Blob): Promise<{ success: boolean; data?: LabScanResponse; error?: string }> {
  const base = getApiBaseUrl();
  const formData = new FormData();
  formData.append('report', fileOrBlob, 'report_upload');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SCAN_TIMEOUT_MS);

  try {
    const res = await fetch(`${base}/api/clinical/lab-scan`, {
      method: 'POST',
      body: formData,
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      const errText = await res.text();
      return { success: false, error: `Scan failed (HTTP ${res.status}): ${errText}` };
    }

    const data: LabScanResponse = await res.json();
    return { success: true, data };
  } catch (err: any) {
    clearTimeout(timer);
    return {
      success: false,
      error: err?.name === 'AbortError' ? 'Scan timed out' : 'Server is unreachable or offline',
    };
  }
}

export async function fetchDiabetesSchemaApi(): Promise<any> {
  const base = getApiBaseUrl();
  try {
    const res = await fetch(`${base}/api/clinical/diabetes-schema`);
    if (res.ok) return await res.json();
  } catch {}
  return null;
}
