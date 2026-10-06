// Přihlášení: e-mail/heslo a Google.
import {
  onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  sendPasswordResetEmail, signOut, GoogleAuthProvider, signInWithPopup,
  signInWithRedirect, getRedirectResult,
} from 'https://www.gstatic.com/firebasejs/12.8.0/firebase-auth.js';
import { auth } from './firebase.js';

export function watchUser(callback) {
  return onAuthStateChanged(auth, callback);
}

export function loginEmail(email, password) {
  return signInWithEmailAndPassword(auth, email, password);
}

export function registerEmail(email, password) {
  return createUserWithEmailAndPassword(auth, email, password);
}

export function resetPassword(email) {
  return sendPasswordResetEmail(auth, email);
}

export async function loginGoogle() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try {
    return await signInWithPopup(auth, provider);
  } catch (err) {
    // Zablokované okno (časté v mobilních prohlížečích) → přesměrování.
    if (err.code === 'auth/popup-blocked' || err.code === 'auth/operation-not-supported-in-this-environment') {
      return signInWithRedirect(auth, provider);
    }
    throw err;
  }
}

/** Zachytí případnou chybu po návratu z přihlášení přesměrováním. */
export function checkRedirectResult() {
  return getRedirectResult(auth);
}

export function logout() {
  return signOut(auth);
}

const MESSAGES = {
  'auth/invalid-email': 'Neplatná e-mailová adresa.',
  'auth/missing-password': 'Zadejte heslo.',
  'auth/invalid-credential': 'Nesprávný e-mail nebo heslo.',
  'auth/wrong-password': 'Nesprávný e-mail nebo heslo.',
  'auth/user-not-found': 'Nesprávný e-mail nebo heslo.',
  'auth/user-disabled': 'Účet je zablokovaný.',
  'auth/email-already-in-use': 'Účet s tímto e-mailem už existuje.',
  'auth/weak-password': 'Heslo je příliš slabé (alespoň 6 znaků).',
  'auth/too-many-requests': 'Příliš mnoho pokusů. Zkuste to za chvíli.',
  'auth/network-request-failed': 'Chyba sítě. Zkontrolujte připojení.',
  'auth/popup-closed-by-user': 'Přihlašovací okno bylo zavřeno.',
  'auth/cancelled-popup-request': 'Přihlášení bylo zrušeno.',
  'auth/unauthorized-domain': 'Tato doména není povolena. Přidejte ji ve Firebase Console → Authentication → Settings → Authorized domains.',
  'auth/operation-not-allowed': 'Tento způsob přihlášení není ve Firebase zapnutý.',
  'auth/configuration-not-found': 'Authentication není ve Firebase projektu zapnuté.',
  'auth/api-key-not-valid.-please-pass-a-valid-api-key.': 'Neplatný apiKey v js/firebase-config.js.',
};

export function authErrorMessage(err) {
  return MESSAGES[err?.code] ?? `Přihlášení se nezdařilo (${err?.code ?? err?.message ?? err}).`;
}
