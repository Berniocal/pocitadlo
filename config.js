// Zkopírujte sem konfiguraci z Firebase Console:
// Project settings → Your apps → Web app → SDK setup and configuration.
export   const firebaseConfig = {
    apiKey: "AIzaSyDFAI8aooDX-v3NjexAbCQOwA-DVjQXAnA",
    authDomain: "pocitadlo-32be7.firebaseapp.com",
    databaseURL: "https://pocitadlo-32be7-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "pocitadlo-32be7",
    storageBucket: "pocitadlo-32be7.firebasestorage.app",
    messagingSenderId: "126699015808",
    appId: "1:126699015808:web:b1e5b58dafdb97a60ae065"
  };

// Stejné adresy nastavte také v database.rules.json.
export const allowedEmails = [
  "jendabernard@gmail.com",
  "klarabernardova7@gmail.com"
];
