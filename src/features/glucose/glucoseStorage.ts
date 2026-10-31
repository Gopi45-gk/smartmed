import { GlucoseReading, GlucoseAlert, LocalAlertEvaluationResult, DEFAULT_THRESHOLDS } from './types';
import { submitGlucoseReadingApi, fetchGlucoseReadingsApi } from './api';

const DB_NAME = 'smartmed_glucose_db';
const DB_VERSION = 1;
const STORE_READINGS = 'readings';
const STORE_OUTBOX = 'outbox';
const STORE_ALERTS = 'alerts';

// ─── IndexedDB Promise Helpers ──────────────────────────────────────────────

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      reject(new Error('IndexedDB not supported'));
      return;
    }

    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_READINGS)) {
        const readingsStore = db.createObjectStore(STORE_READINGS, { keyPath: 'id' });
        readingsStore.createIndex('patientId', 'patientId', { unique: false });
        readingsStore.createIndex('measuredAt', 'measuredAt', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_OUTBOX)) {
        db.createObjectStore(STORE_OUTBOX, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_ALERTS)) {
        const alertsStore = db.createObjectStore(STORE_ALERTS, { keyPath: 'id' });
        alertsStore.createIndex('patient_id', 'patient_id', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// ─── LocalStorage Fallback ──────────────────────────────────────────────────

const LS_READINGS_KEY = 'smartmed_glucose_readings_backup';
const LS_OUTBOX_KEY = 'smartmed_glucose_outbox_backup';
const LS_ALERTS_KEY = 'smartmed_glucose_alerts_backup';

function getLocalStorage<T>(key: string, defaultVal: T[]): T[] {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : defaultVal;
  } catch {
    return defaultVal;
  }
}

function setLocalStorage<T>(key: string, val: T[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(val));
  } catch (err) {
    console.warn('localStorage write failed', err);
  }
}

// ─── Local Critical Alert Evaluator ─────────────────────────────────────────

export function evaluateLocalCriticalAlert(reading: GlucoseReading): LocalAlertEvaluationResult {
  const val = reading.value_mgdl;
  if (val < DEFAULT_THRESHOLDS.critical_low) {
    const alert: GlucoseAlert = {
      id: `local_alert_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      patient_id: reading.patientId,
      rule_id: 'critical_low',
      severity: 'critical',
      message: `Sugar reading ${val} mg/dL is low. Please take fast-acting sugar or juice, and contact doctor if needed.`,
      value_mgdl: val,
      context: reading.context,
      triggered_at: reading.measuredAt,
      acknowledged: false,
    };
    return { hasCriticalAlert: true, alert };
  }

  if (val > DEFAULT_THRESHOLDS.critical_high) {
    const alert: GlucoseAlert = {
      id: `local_alert_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      patient_id: reading.patientId,
      rule_id: 'critical_high',
      severity: 'critical',
      message: `Sugar reading ${val} mg/dL is high. Please contact the doctor or take prescribed action.`,
      value_mgdl: val,
      context: reading.context,
      triggered_at: reading.measuredAt,
      acknowledged: false,
    };
    return { hasCriticalAlert: true, alert };
  }

  return { hasCriticalAlert: false, alert: null };
}

// ─── GlucoseStorage Class ───────────────────────────────────────────────────

export class GlucoseStorage {
  private static instance: GlucoseStorage;
  private isSyncing = false;
  private syncListeners: Array<() => void> = [];

  public static getInstance(): GlucoseStorage {
    if (!GlucoseStorage.instance) {
      GlucoseStorage.instance = new GlucoseStorage();
    }
    return GlucoseStorage.instance;
  }

  public onSyncChange(listener: () => void): () => void {
    this.syncListeners.push(listener);
    return () => {
      this.syncListeners = this.syncListeners.filter((l) => l !== listener);
    };
  }

  private notifySyncChange() {
    this.syncListeners.forEach((l) => {
      try {
        l();
      } catch (err) {
        console.error(err);
      }
    });
  }

  // Save reading locally immediately (IndexedDB + Outbox)
  public async saveReadingLocally(reading: GlucoseReading): Promise<LocalAlertEvaluationResult> {
    const criticalCheck = evaluateLocalCriticalAlert(reading);

    try {
      const db = await openDatabase();
      const tx = db.transaction([STORE_READINGS, STORE_OUTBOX], 'readwrite');
      tx.objectStore(STORE_READINGS).put(reading);
      if (!reading.syncedAt) {
        tx.objectStore(STORE_OUTBOX).put(reading);
      }
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch {
      // Fallback to localStorage
      const all = getLocalStorage<GlucoseReading>(LS_READINGS_KEY, []);
      const updated = [reading, ...all.filter((r) => r.id !== reading.id)];
      setLocalStorage(LS_READINGS_KEY, updated);

      if (!reading.syncedAt) {
        const outbox = getLocalStorage<GlucoseReading>(LS_OUTBOX_KEY, []);
        setLocalStorage(LS_OUTBOX_KEY, [reading, ...outbox.filter((r) => r.id !== reading.id)]);
      }
    }

    if (criticalCheck.hasCriticalAlert && criticalCheck.alert) {
      await this.saveAlertLocally(criticalCheck.alert);
    }

    // Trigger asynchronous background sync
    this.triggerSync();

    return criticalCheck;
  }

  // Get all readings for patient
  public async getReadings(patientId: string): Promise<GlucoseReading[]> {
    let readings: GlucoseReading[] = [];

    try {
      const db = await openDatabase();
      const tx = db.transaction(STORE_READINGS, 'readonly');
      const store = tx.objectStore(STORE_READINGS);
      const req = store.getAll();
      readings = await new Promise<GlucoseReading[]>((resolve, reject) => {
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
    } catch {
      readings = getLocalStorage<GlucoseReading>(LS_READINGS_KEY, []);
    }

    return readings
      .filter((r) => !patientId || r.patientId === patientId || r.patientId === 'default')
      .sort((a, b) => new Date(b.measuredAt).getTime() - new Date(a.measuredAt).getTime());
  }

  // Save an alert locally
  public async saveAlertLocally(alert: GlucoseAlert): Promise<void> {
    try {
      const db = await openDatabase();
      const tx = db.transaction(STORE_ALERTS, 'readwrite');
      tx.objectStore(STORE_ALERTS).put(alert);
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch {
      const alerts = getLocalStorage<GlucoseAlert>(LS_ALERTS_KEY, []);
      setLocalStorage(LS_ALERTS_KEY, [alert, ...alerts.filter((a) => a.id !== alert.id)]);
    }
  }

  // Get alerts for patient
  public async getAlerts(patientId: string): Promise<GlucoseAlert[]> {
    let alerts: GlucoseAlert[] = [];
    try {
      const db = await openDatabase();
      const tx = db.transaction(STORE_ALERTS, 'readonly');
      const store = tx.objectStore(STORE_ALERTS);
      const req = store.getAll();
      alerts = await new Promise<GlucoseAlert[]>((resolve, reject) => {
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
    } catch {
      alerts = getLocalStorage<GlucoseAlert>(LS_ALERTS_KEY, []);
    }

    return alerts
      .filter((a) => !patientId || a.patient_id === patientId || a.patient_id === 'default')
      .sort((a, b) => new Date(b.triggered_at).getTime() - new Date(a.triggered_at).getTime());
  }

  // Delete reading locally
  public async deleteReading(id: string): Promise<void> {
    try {
      const db = await openDatabase();
      const tx = db.transaction([STORE_READINGS, STORE_OUTBOX], 'readwrite');
      tx.objectStore(STORE_READINGS).delete(id);
      tx.objectStore(STORE_OUTBOX).delete(id);
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch {
      const all = getLocalStorage<GlucoseReading>(LS_READINGS_KEY, []);
      setLocalStorage(LS_READINGS_KEY, all.filter((r) => r.id !== id));
      const outbox = getLocalStorage<GlucoseReading>(LS_OUTBOX_KEY, []);
      setLocalStorage(LS_OUTBOX_KEY, outbox.filter((r) => r.id !== id));
    }
  }

  // Get pending outbox count
  public async getPendingSyncCount(): Promise<number> {
    try {
      const db = await openDatabase();
      const tx = db.transaction(STORE_OUTBOX, 'readonly');
      const req = tx.objectStore(STORE_OUTBOX).count();
      return await new Promise<number>((resolve) => {
        req.onsuccess = () => resolve(req.result || 0);
        req.onerror = () => resolve(0);
      });
    } catch {
      return getLocalStorage<GlucoseReading>(LS_OUTBOX_KEY, []).length;
    }
  }

  // Trigger background sync with retry & backoff
  public async triggerSync(): Promise<{ syncedCount: number; remainingCount: number }> {
    if (this.isSyncing) {
      return { syncedCount: 0, remainingCount: await this.getPendingSyncCount() };
    }

    this.isSyncing = true;
    this.notifySyncChange();

    let outboxItems: GlucoseReading[] = [];
    try {
      const db = await openDatabase();
      const tx = db.transaction(STORE_OUTBOX, 'readonly');
      const req = tx.objectStore(STORE_OUTBOX).getAll();
      outboxItems = await new Promise<GlucoseReading[]>((resolve) => {
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      });
    } catch {
      outboxItems = getLocalStorage<GlucoseReading>(LS_OUTBOX_KEY, []);
    }

    let syncedCount = 0;

    for (const item of outboxItems) {
      const res = await submitGlucoseReadingApi(item);
      if (res.success) {
        syncedCount++;
        const syncedItem: GlucoseReading = {
          ...item,
          syncedAt: new Date().toISOString(),
        };

        // If backend returned alerts, save them locally too
        if (res.alerts && res.alerts.length > 0) {
          for (const alert of res.alerts) {
            await this.saveAlertLocally(alert);
          }
        }

        // Update item in readings, remove from outbox
        try {
          const db = await openDatabase();
          const tx = db.transaction([STORE_READINGS, STORE_OUTBOX], 'readwrite');
          tx.objectStore(STORE_READINGS).put(syncedItem);
          tx.objectStore(STORE_OUTBOX).delete(item.id);
          await new Promise<void>((resolve) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => resolve();
          });
        } catch {
          const all = getLocalStorage<GlucoseReading>(LS_READINGS_KEY, []);
          setLocalStorage(
            LS_READINGS_KEY,
            all.map((r) => (r.id === item.id ? syncedItem : r))
          );
          const outbox = getLocalStorage<GlucoseReading>(LS_OUTBOX_KEY, []);
          setLocalStorage(
            LS_OUTBOX_KEY,
            outbox.filter((r) => r.id !== item.id)
          );
        }
      } else {
        // Stop early if server is unreachable
        break;
      }
    }

    this.isSyncing = false;
    this.notifySyncChange();

    const remaining = await this.getPendingSyncCount();
    return { syncedCount, remainingCount: remaining };
  }

  // Pull latest readings from server and merge into local DB
  public async pullAndMerge(patientId: string): Promise<GlucoseReading[]> {
    const res = await fetchGlucoseReadingsApi(patientId);
    if (res.success && res.readings.length > 0) {
      for (const serverReading of res.readings) {
        try {
          const db = await openDatabase();
          const tx = db.transaction(STORE_READINGS, 'readwrite');
          tx.objectStore(STORE_READINGS).put(serverReading);
          await new Promise<void>((resolve) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => resolve();
          });
        } catch {
          const all = getLocalStorage<GlucoseReading>(LS_READINGS_KEY, []);
          const existingIdx = all.findIndex((r) => r.id === serverReading.id);
          if (existingIdx >= 0) {
            all[existingIdx] = serverReading;
          } else {
            all.push(serverReading);
          }
          setLocalStorage(LS_READINGS_KEY, all);
        }
      }
    }
    return this.getReadings(patientId);
  }
}

export const glucoseStorage = GlucoseStorage.getInstance();
