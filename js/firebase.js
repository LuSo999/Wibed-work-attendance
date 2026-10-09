// Inicializace Firebase (SDK jako ES moduly z CDN). Importuje se dynamicky
// až po ověření configu, aby obrazovka s instrukcí fungovala i bez Firebase.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.8.0/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/12.8.0/firebase-auth.js';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
} from 'https://www.gstatic.com/firebasejs/12.8.0/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';
import { getLanguage } from './i18n.js';

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
auth.languageCode = getLanguage();

// Offline cache Firestore v IndexedDB – data jsou dostupná i bez připojení
// a zápisy se odešlou po obnovení spojení.
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});
