// Zkopírujte sem konfiguraci z Firebase Console:
// Project settings → Your apps → Web app → SDK setup and configuration.
export const firebaseConfig = {
  apiKey: "DOPLNIT",
  authDomain: "DOPLNIT.firebaseapp.com",
  databaseURL: "https://DOPLNIT-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "DOPLNIT",
  storageBucket: "DOPLNIT.firebasestorage.app",
  messagingSenderId: "DOPLNIT",
  appId: "DOPLNIT"
};

// Stejné adresy nastavte také v database.rules.json.
export const allowedEmails = [
  "prvni@gmail.com",
  "druhy@gmail.com"
];
