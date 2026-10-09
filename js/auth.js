// Přihlášení: e-mail/heslo a Google.
import {
  onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  sendPasswordResetEmail, signOut, GoogleAuthProvider, signInWithPopup,
  signInWithRedirect, getRedirectResult,
} from 'https://www.gstatic.com/firebasejs/12.8.0/firebase-auth.js';
import { auth } from './firebase.js';
import { t } from './i18n.js';

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

/** Jazyk e-mailů a oken Firebase Auth podle jazyka aplikace. */
export function setAuthLanguage(lang) {
  auth.languageCode = lang;
}

/** Chybové kódy Firebase Auth se známým překladem (klíč 'auth.err.<kód bez auth/>'). */
const KNOWN_ERRORS = new Set([
  'invalid-email', 'missing-password', 'invalid-credential', 'wrong-password', 'user-not-found', 'user-disabled',
  'email-already-in-use', 'weak-password', 'too-many-requests', 'network-request-failed', 'popup-closed-by-user',
  'cancelled-popup-request', 'unauthorized-domain', 'operation-not-allowed', 'configuration-not-found',
  'api-key-not-valid.-please-pass-a-valid-api-key.',
]);

export function authErrorMessage(err) {
  const code = String(err?.code ?? '').replace(/^auth\//, '');
  if (KNOWN_ERRORS.has(code)) return t(`auth.err.${code}`);
  return t('auth.err.generic', { code: err?.code ?? err?.message ?? String(err) });
}
