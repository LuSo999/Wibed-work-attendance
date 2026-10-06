// Firestore: data vázaná na uživatele.
//   users/{uid}/attendance/{YYYY-MM-DD}  – záznam dne
//   users/{uid}/overtimeBank/{autoId}    – výběr náhradního volna z banky
import {
  collection, doc, onSnapshot, setDoc, deleteDoc, addDoc, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/12.8.0/firebase-firestore.js';
import { db } from './firebase.js';

const attendanceCol = (uid) => collection(db, 'users', uid, 'attendance');
const bankCol = (uid) => collection(db, 'users', uid, 'overtimeBank');

/**
 * Živě sleduje docházku i výběry. Callbacky dostávají kompletní pole dat.
 * Vrací funkci pro odhlášení odběru.
 */
export function subscribe(uid, { onAttendance, onBank, onError }) {
  const unsubs = [
    onSnapshot(attendanceCol(uid), (snap) => {
      onAttendance(snap.docs.map((d) => ({ ...d.data(), date: d.id })));
    }, onError),
    onSnapshot(bankCol(uid), (snap) => {
      onBank(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    }, onError),
  ];
  return () => unsubs.forEach((u) => u());
}

/** Uloží (přepíše) záznam dne. */
export function saveDay(uid, record) {
  const data = {
    type: record.type,
    arrival: record.type === 'work' ? record.arrival || null : null,
    departure: record.type === 'work' ? record.departure || null : null,
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
