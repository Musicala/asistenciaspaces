/* firebase/config.js — Asistencia Spaces
   Inicializa Firebase (ESM por CDN, sin build/bundler).
   ───────────────────────────────────────────────────────────
   ⚠️ PEGA AQUÍ tu firebaseConfig real (Consola Firebase → Configuración del
   proyecto → Tus apps → SDK web). Estos valores son PÚBLICOS por diseño;
   la seguridad real vive en firestore.rules + el allowlist de correos.
   ─────────────────────────────────────────────────────────── */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { getAuth, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getFunctions } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js";
import { FUNCTIONS_REGION } from "../core/constants.js";

export const firebaseConfig = {
  apiKey: "AIzaSyCmVl-xYhFgInKF3tEF9TshytEterjscAY",
  authDomain: "spaces-hub.firebaseapp.com",
  projectId: "spaces-hub",
  storageBucket: "spaces-hub.firebasestorage.app",
  messagingSenderId: "631134291513",
  appId: "1:631134291513:web:10c1b902809e5f64222fe8",
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
export const functions = getFunctions(app, FUNCTIONS_REGION);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });

// Aviso temprano si olvidaron pegar el config.
if (firebaseConfig.apiKey === "PEGAR_API_KEY") {
  console.warn(
    "[Spaces Manager] Falta pegar tu firebaseConfig en js/firebase/config.js"
  );
}
