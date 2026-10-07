import { initializeApp } from "firebase/app";
import { getFirestore, doc, setDoc, getDoc, updateDoc, collection, query, where, getDocs } from "firebase/firestore";
import type { PatientProfile, Language, MedicationReminder, MedicationAdherenceRecord, ReminderStatus } from "./types";

const firebaseConfig = {
  apiKey: "AIzaSyAhyJmP9eZvKIbO2Tb-GU_msRH3TmK1Mkw",
  authDomain: "smartmed-537cf.firebaseapp.com",
  projectId: "smartmed-537cf",
  storageBucket: "smartmed-537cf.firebasestorage.app",
  messagingSenderId: "594519168623",
  appId: "1:594519168623:web:724d2eb64cb1aeeb779f9a",
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);

/**
 * Normalize phone number to a Firestore-safe document ID.
 * Strips spaces, dashes, parentheses and the leading '+' sign.
 */
function phoneToDocId(phone: string): string {
  return phone.replace(/[\s+\-()]/g, "");
}

interface StoredPatientRecord {
  profile: PatientProfile;
  password: string;
}

function getLocalPatients(): Record<string, StoredPatientRecord> {
  try {
    const raw = localStorage.getItem("smartmed_offline_patients");
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveLocalPatient(docId: string, record: StoredPatientRecord): void {
  try {
    const records = getLocalPatients();
    records[docId] = record;
    localStorage.setItem("smartmed_offline_patients", JSON.stringify(records));
  } catch {
    // Ignore storage quota errors
  }
}

/**
 * Register a new patient.
 * Doc ID = normalized mobile number.
 * Features automatic offline-first caching and preferred_language persistence.
 */
export async function registerPatient(
  patientData: PatientProfile & { password: string }
): Promise<{ success: boolean; error?: string }> {
  const docId = phoneToDocId(patientData.phone);
  const preferredLang: Language = patientData.preferred_language || 'en';

  const patientRecord: StoredPatientRecord = {
    profile: {
      name: patientData.name,
      phone: patientData.phone,
      age: patientData.age,
      gender: patientData.gender,
      condition: patientData.condition || "",
      bloodGroup: patientData.bloodGroup || "",
      registeredAt: new Date().toISOString(),
      preferred_language: preferredLang,
    },
    password: patientData.password,
  };

  // Cache locally immediately (100% offline resilience)
  saveLocalPatient(docId, patientRecord);

  // Sync to Firestore if online
  try {
    const existingDoc = await getDoc(doc(db, "patients", docId));
    if (existingDoc.exists()) {
      return { success: false, error: "This phone number is already registered. Please login instead." };
    }
    await setDoc(doc(db, "patients", docId), {
      name: patientData.name,
      phone: patientData.phone,
      age: patientData.age,
      gender: patientData.gender,
      condition: patientData.condition || "",
      bloodGroup: patientData.bloodGroup || "",
      preferred_language: preferredLang,
      password: patientData.password,
      registeredAt: patientRecord.profile.registeredAt,
    });
    return { success: true };
  } catch (err: any) {
    console.warn("Firestore cloud registration unreachable/error, offline cache activated:", err);
    // If network or offline, local registration is successful!
    return { success: true };
  }
}

/**
 * Login a patient by verifying phone + password against Firestore (or local offline cache).
 * Returns the patient profile on success including preferred_language.
 */
export async function loginPatient(
  phone: string,
  password: string
): Promise<{ success: boolean; profile?: PatientProfile; error?: string }> {
  const docId = phoneToDocId(phone);

  // 1. Try Firestore lookup
  try {
    const snapshot = await getDoc(doc(db, "patients", docId));
    if (snapshot.exists()) {
      const data = snapshot.data();
      if (data.password !== password) {
        return { success: false, error: "Incorrect password. Please try again." };
      }
      const profile: PatientProfile = {
        name: data.name,
        phone: data.phone,
        age: data.age,
        gender: data.gender,
        condition: data.condition,
        bloodGroup: data.bloodGroup,
        registeredAt: data.registeredAt,
        preferred_language: (data.preferred_language as Language) || 'en',
      };
      // Update local cache
      saveLocalPatient(docId, { profile, password });
      return { success: true, profile };
    }
  } catch (err) {
    console.warn("Firestore unreachable during login, checking offline cache:", err);
  }

  // 2. Check offline local cache
  const localPatients = getLocalPatients();
  const cached = localPatients[docId];
  if (cached) {
    if (cached.password !== password) {
      return { success: false, error: "Incorrect password. Please try again." };
    }
    return { success: true, profile: cached.profile };
  }

  return { success: false, error: "No account found with this number. Please register first." };
}

/**
 * Update patient preferred language in Firestore and offline cache.
 */
export async function updatePatientLanguage(
  phone: string,
  preferred_language: Language
): Promise<void> {
  const docId = phoneToDocId(phone);

  // 1. Update offline cache
  const localPatients = getLocalPatients();
  if (localPatients[docId]) {
    localPatients[docId].profile.preferred_language = preferred_language;
    localStorage.setItem("smartmed_offline_patients", JSON.stringify(localPatients));
  }

  // 2. Update Firestore if online
  try {
    await updateDoc(doc(db, "patients", docId), {
      preferred_language,
    });
  } catch (err) {
    console.warn("Firestore language update skipped (offline/unreachable):", err);
  }
}

// ─── Medication Reminders & Adherence Persistence ───────────────────────────

/**
 * Save medication reminder to local cache and Firestore 'reminders' collection.
 */
export async function saveMedicationReminder(reminder: MedicationReminder): Promise<void> {
  // 1. Update offline cache
  try {
    const raw = localStorage.getItem("smartmed_offline_reminders");
    const list: MedicationReminder[] = raw ? JSON.parse(raw) : [];
    const idx = list.findIndex(r => r.id === reminder.id);
    if (idx >= 0) {
      list[idx] = reminder;
    } else {
      list.push(reminder);
    }
    localStorage.setItem("smartmed_offline_reminders", JSON.stringify(list));
  } catch (err) {
    console.warn("Error caching reminder locally:", err);
  }

  // 2. Persist to Firestore
  try {
    const docRef = doc(db, "reminders", reminder.id);
    await setDoc(docRef, { ...reminder }, { merge: true });
    console.log(`[Firestore] Reminder saved: ${reminder.id}`);
  } catch (err) {
    console.warn("Firestore save reminder skipped (offline/unreachable):", err);
  }
}

/**
 * Retrieve medication reminders from Firestore or fallback to offline cache.
 */
export async function getMedicationReminders(patientId?: string): Promise<MedicationReminder[]> {
  try {
    const remindersCol = collection(db, "reminders");
    const q = patientId ? query(remindersCol, where("patientId", "==", patientId)) : remindersCol;
    const snapshot = await getDocs(q);
    if (!snapshot.empty) {
      const records: MedicationReminder[] = [];
      snapshot.forEach(d => records.push(d.data() as MedicationReminder));
      // update offline cache
      try {
        localStorage.setItem("smartmed_offline_reminders", JSON.stringify(records));
      } catch {}
      return records;
    }
  } catch (err) {
    console.warn("Firestore getMedicationReminders failed, using offline cache:", err);
  }

  // Fallback to local cache
  try {
    const raw = localStorage.getItem("smartmed_offline_reminders");
    const list: MedicationReminder[] = raw ? JSON.parse(raw) : [];
    if (patientId) {
      return list.filter(r => r.patientId === patientId);
    }
    return list;
  } catch {
    return [];
  }
}

/**
 * Update status of a medication reminder.
 */
export async function updateMedicationReminderStatus(
  reminderId: string,
  status: ReminderStatus
): Promise<void> {
  const updatedAt = new Date().toISOString();
  try {
    const raw = localStorage.getItem("smartmed_offline_reminders");
    const list: MedicationReminder[] = raw ? JSON.parse(raw) : [];
    const item = list.find(r => r.id === reminderId);
    if (item) {
      item.reminderStatus = status;
      item.updatedAt = updatedAt;
      localStorage.setItem("smartmed_offline_reminders", JSON.stringify(list));
    }
  } catch {}

  try {
    const docRef = doc(db, "reminders", reminderId);
    await updateDoc(docRef, { reminderStatus: status, updatedAt });
  } catch (err) {
    console.warn("Firestore update reminder skipped (offline):", err);
  }
}

/**
 * Save adherence record to local cache and Firestore 'adherence' collection.
 */
export async function saveMedicationAdherence(adherence: MedicationAdherenceRecord): Promise<void> {
  // 1. Local cache
  try {
    const raw = localStorage.getItem("smartmed_offline_adherence");
    const list: MedicationAdherenceRecord[] = raw ? JSON.parse(raw) : [];
    const idx = list.findIndex(a => a.id === adherence.id);
    if (idx >= 0) {
      list[idx] = adherence;
    } else {
      list.push(adherence);
    }
    localStorage.setItem("smartmed_offline_adherence", JSON.stringify(list));
  } catch (err) {
    console.warn("Error caching adherence locally:", err);
  }

  // 2. Persist to Firestore
  try {
    const docRef = doc(db, "adherence", adherence.id);
    await setDoc(docRef, { ...adherence }, { merge: true });
    console.log(`[Firestore] Adherence record saved: ${adherence.id}`);
  } catch (err) {
    console.warn("Firestore save adherence skipped (offline/unreachable):", err);
  }
}

/**
 * Retrieve adherence records.
 */
export async function getMedicationAdherenceRecords(patientId?: string): Promise<MedicationAdherenceRecord[]> {
  try {
    const adherenceCol = collection(db, "adherence");
    const q = patientId ? query(adherenceCol, where("patientId", "==", patientId)) : adherenceCol;
    const snapshot = await getDocs(q);
    if (!snapshot.empty) {
      const records: MedicationAdherenceRecord[] = [];
      snapshot.forEach(d => records.push(d.data() as MedicationAdherenceRecord));
      try {
        localStorage.setItem("smartmed_offline_adherence", JSON.stringify(records));
      } catch {}
      return records;
    }
  } catch (err) {
    console.warn("Firestore getMedicationAdherenceRecords failed, using offline cache:", err);
  }

  try {
    const raw = localStorage.getItem("smartmed_offline_adherence");
    const list: MedicationAdherenceRecord[] = raw ? JSON.parse(raw) : [];
    if (patientId) {
      return list.filter(a => a.patientId === patientId);
    }
    return list;
  } catch {
    return [];
  }
}
