// ═══════════════════════════════════════════════════
// KA-KALAKBAY — Firebase Configuration
// ⚠️  DO NOT MODIFY — Auth is working
// ═══════════════════════════════════════════════════
import { initializeApp }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, GoogleAuthProvider }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey:            "AIzaSyDzgEphNMCf_PbogL1ZQ2wH1XRbHC0xtBE",
  authDomain:        "ka-kalakbay.firebaseapp.com",
  projectId:         "ka-kalakbay",
  storageBucket:     "ka-kalakbay.firebasestorage.app",
  messagingSenderId: "39498160197",
  appId:             "1:39498160197:web:28916ce149fd81f9a8eb2c",
  measurementId:     "G-T3D4GX8ZL5",
};

const app = initializeApp(firebaseConfig);

export const auth      = getAuth(app);
export const db        = getFirestore(app);
export const gProvider = new GoogleAuthProvider();
gProvider.setCustomParameters({ prompt: "select_account" });
