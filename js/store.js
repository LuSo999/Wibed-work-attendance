// Firestore: data vázaná na uživatele.
//   users/{uid}/attendance/{YYYY-MM-DD}  – záznam dne
//   users/{uid}/overtimeBank/{autoId}    – výběr náhradního volna z banky
//   users/{uid}/settings/plan            – nastavení plánu docházky
//   users/{uid}/planOverrides/{YYYY-MM-DD} – výjimky dnů pro plán
import {
  collection, doc, onSnapshot, setDoc, deleteDoc, addDoc, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/12.8.0/firebase-firestore.js';
import { db } from './firebase.js';

const attendanceCol = (uid) => collection(db, 'users', uid, 'attendance');
const bankCol = (uid) => collection(db, 'users', uid, 'overtimeBank');
const overridesCol = (uid) => collection(db, 'users', uid, 'planOverrides');
const settingsDoc = (uid) => doc(db, 'users', uid, 'settings', 'plan');

/**
 * Živě sleduje docházku i výběry. Callbacky dostávají kompletní pole dat.
 * Vrací funkci pro odhlášení odběru.
 */
export function subscribe(uid, {
  onAttendance, onBank, onSettings, onOverrides, onError,
}) {
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

/** Uloží výjimku dne pro plán. */
export function saveOverride(uid, {
  date, absenceType, absenceHours, arriveAt, leaveAt, workedHours, note,
}) {
  return setDoc(doc(overridesCol(uid), date), {
    absenceType: absenceType || null,
    absenceHours: absenceType ? hoursOrNull(absenceHours) : null,
    arriveAt: arriveAt || null,
    leaveAt: leaveAt || null,
    workedHours: hoursOrNull(workedHours),
    note: note?.trim() || '',
    updatedAt: serverTimestamp(),
  });
}

export function deleteOverride(uid, date) {
  return deleteDoc(doc(overridesCol(uid), date));
}
