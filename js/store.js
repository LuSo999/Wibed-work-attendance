// Firestore: data vázaná na uživatele.
//   users/{uid}/attendance/{YYYY-MM-DD}  – záznam dne
//   users/{uid}/overtimeBank/{autoId}    – výběr náhradního volna z banky
//   users/{uid}/settings/plan            – nastavení plánu docházky
//   users/{uid}/settings/app             – nastavení aplikace {language, czHolidays, onboardingDone}
//   users/{uid}/planOverrides/{YYYY-MM-DD} – výjimky dnů pro plán
import {
  collection, doc, onSnapshot, setDoc, deleteDoc, addDoc, serverTimestamp, writeBatch, getDocsFromServer, query, limit,
} from 'https://www.gstatic.com/firebasejs/12.8.0/firebase-firestore.js';
import { db } from './firebase.js';

const attendanceCol = (uid) => collection(db, 'users', uid, 'attendance');
const bankCol = (uid) => collection(db, 'users', uid, 'overtimeBank');
const overridesCol = (uid) => collection(db, 'users', uid, 'planOverrides');
const settingsDoc = (uid) => doc(db, 'users', uid, 'settings', 'plan');
const appSettingsDoc = (uid) => doc(db, 'users', uid, 'settings', 'app');

/**
 * Živě sleduje docházku i výběry. Callbacky dostávají kompletní pole dat.
 * Vrací funkci pro odhlášení odběru.
 */
export function subscribe(uid, {
  onAttendance, onBank, onSettings, onOverrides, onAppSettings, onSync, onError,
}) {
  // Stav synchronizace z metadat: čekající zápisy (hasPendingWrites) a data jen z cache (fromCache).
  const sync = new Map();
  const watchSync = (name, ref) => onSnapshot(ref, { includeMetadataChanges: true }, (snap) => {
    sync.set(name, snap.metadata);
    const all = [...sync.values()];
    onSync?.({ pending: all.some((m) => m.hasPendingWrites), fromCache: all.some((m) => m.fromCache) });
  }, onError);
  const unsubs = [
    onSnapshot(attendanceCol(uid), (snap) => {
      onAttendance(snap.docs.map((d) => ({ ...d.data(), date: d.id })));
    }, onError),
    onSnapshot(bankCol(uid), (snap) => {
      onBank(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    }, onError),
    onSnapshot(settingsDoc(uid), (snap) => {
      onSettings(snap.exists() ? snap.data() : {});
    }, onError),
    onSnapshot(overridesCol(uid), (snap) => {
      onOverrides(snap.docs.map((d) => ({ ...d.data(), date: d.id })));
    }, onError),
    // s metadaty: chybějící dokument je jistý až po odpovědi serveru (fromCache: false)
    onSnapshot(appSettingsDoc(uid), { includeMetadataChanges: true }, (snap) => {
      onAppSettings({ exists: snap.exists(), data: snap.exists() ? snap.data() : {}, fromCache: snap.metadata.fromCache });
    }, onError),
    watchSync('attendance', attendanceCol(uid)),
    watchSync('bank', bankCol(uid)),
    watchSync('overrides', overridesCol(uid)),
    watchSync('settings', settingsDoc(uid)),
  ];
  return () => unsubs.forEach((u) => u());
}

const hoursOrNull = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

/** Uloží (přepíše) záznam dne. */
export function saveDay(uid, record) {
  const absenceHours = record.type === 'work' ? null : hoursOrNull(record.absenceHours);
  // časy má pracovní den a částečná nepřítomnost
  const timed = record.type === 'work' || absenceHours !== null;
  const data = {
    type: record.type,
    arrival: timed ? record.arrival || null : null,
    departure: timed ? record.departure || null : null,
    absenceHours,
    filled: Boolean(record.filled),
    note: record.note?.trim() || '',
    updatedAt: serverTimestamp(),
  };
  return setDoc(doc(attendanceCol(uid), record.date), data);
}

export function deleteDay(uid, date) {
  return deleteDoc(doc(attendanceCol(uid), date));
}

export function addWithdrawal(uid, { date, minutes, note }) {
  return addDoc(bankCol(uid), { date, minutes, note: note?.trim() || '', createdAt: serverTimestamp() });
}

export function deleteWithdrawal(uid, id) {
  return deleteDoc(doc(bankCol(uid), id));
}

/** Uloží nastavení plánu. */
export function saveSettings(uid, settings) {
  return setDoc(settingsDoc(uid), { ...settings, updatedAt: serverTimestamp() });
}

/**
 * Má uživatel na SERVERU aspoň jeden záznam docházky? Dotaz jde vždy na server (ne do cache);
 * offline nebo při chybě vyhodí výjimku – volající pak průvodce nezobrazí.
 */
export async function hasAnyAttendanceOnServer(uid) {
  const snap = await getDocsFromServer(query(attendanceCol(uid), limit(1)));
  return !snap.empty;
}

/** Uloží (sloučí) nastavení aplikace: jazyk, státní svátky, průvodce. */
export function saveAppSettings(uid, patch) {
  return setDoc(appSettingsDoc(uid), { ...patch, updatedAt: serverTimestamp() }, { merge: true });
}

/** Data výjimky dne pro Firestore (poznámka max. 200 znaků, clearFixed jen platné hodnoty). */
function overrideData({
  absenceType, absenceHours, arriveAt, leaveAt, workedHours, clearFixed, note,
}) {
  return {
    absenceType: absenceType || null,
    absenceHours: absenceType ? hoursOrNull(absenceHours) : null,
    arriveAt: arriveAt || null,
    leaveAt: leaveAt || null,
    workedHours: hoursOrNull(workedHours),
    clearFixed: ['arrival', 'leave', 'both'].includes(clearFixed) ? clearFixed : null,
    note: (note ?? '').trim().slice(0, 200),
    updatedAt: serverTimestamp(),
  };
}

/** Uloží výjimku dne pro plán. */
export function saveOverride(uid, override) {
  return setDoc(doc(overridesCol(uid), override.date), overrideData(override));
}

/**
 * Zapíše více výjimek najednou (atomicky): [{date, data}] – data null = smazat.
 * Používá hromadné zrušení pevných časů i jeho vrácení.
 */
export function applyOverrides(uid, ops) {
  const batch = writeBatch(db);
  for (const { date, data } of ops) {
    const ref = doc(overridesCol(uid), date);
    if (data) batch.set(ref, overrideData({ ...data, date }));
    else batch.delete(ref);
  }
  return batch.commit();
}

export function deleteOverride(uid, date) {
  return deleteDoc(doc(overridesCol(uid), date));
}
