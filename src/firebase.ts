import { initializeApp } from "firebase/app";
import { getFirestore, doc, setDoc, getDoc } from "firebase/firestore";
import type { PatientProfile } from "./types";

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
 * Features automatic offline-first caching for resilience when offline.
 */
export async function registerPatient(
  patientData: PatientProfile & { password: string }
): Promise<{ success: boolean; error?: string }> {
  const docId = phoneToDocId(patientData.phone);
  const patientRecord: StoredPatientRecord = {
    profile: {
      name: patientData.name,
      phone: patientData.phone,
      age: patientData.age,
      gender: patientData.gender,
      condition: patientData.condition || "",
      bloodGroup: patientData.bloodGroup || "",
      registeredAt: new Date().toISOString(),
    },
    password: patientData.password,
  };

  // Cache locally immediately
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
 * Returns the patient profile on success.
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
