// ============================================================================
//  KONFIGURACE FIREBASE – ZDE VYPLŇTE ÚDAJE SVÉHO PROJEKTU
// ============================================================================
//  Kde je najdete:
//    Firebase Console → ⚙ Project settings → General → Your apps → Web app
//    → „SDK setup and configuration“ → volba „Config“.
//  Zkopírujte hodnoty a nahraďte jimi placeholdery níže (postup viz README.md).
//
//  Tyto hodnoty NEJSOU tajné – identifikují projekt, data chrání pravidla
//  ve firestore.rules a přihlášení. Soubor je proto v pořádku commitnout.
// ============================================================================

export const firebaseConfig = {
  apiKey: 'YOUR_API_KEY',
  authDomain: 'YOUR_PROJECT_ID.firebaseapp.com',
  projectId: 'YOUR_PROJECT_ID',
  storageBucket: 'YOUR_PROJECT_ID.firebasestorage.app',
  messagingSenderId: 'YOUR_MESSAGING_SENDER_ID',
  appId: 'YOUR_APP_ID',
};
