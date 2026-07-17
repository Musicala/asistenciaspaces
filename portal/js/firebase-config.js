/* =========================================
   Firebase Config
   Inicialización segura de Firebase
========================================= */

import {
  initializeApp,
  getApps,
  getApp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";

import {
  getAuth
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

import {
  getFirestore
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

/* =========================================
   Configuración del proyecto Firebase
========================================= */

const firebaseConfig = {
  apiKey: "AIzaSyCmVl-xYhFgInKF3tEF9TshytEterjscAY",
  authDomain: "spaces-hub.firebaseapp.com",
  projectId: "spaces-hub",
  storageBucket: "spaces-hub.firebasestorage.app",
  messagingSenderId: "631134291513",
  appId: "1:631134291513:web:10c1b902809e5f64222fe8"
};

/* =========================================
   Inicialización segura
   (evita reinicializar Firebase)
========================================= */

const app = getApps().length
  ? getApp()
  : initializeApp(firebaseConfig);

/* =========================================
   Servicios Firebase
========================================= */

const auth = getAuth(app);

/*
Firestore queda disponible por si en el futuro
vuelven a usarlo. El HUB actual ya no depende
de Firestore para los datos principales.
*/
const db = getFirestore(app);

/* =========================================
   Helpers útiles
========================================= */

function getCurrentUser() {
  return auth.currentUser || null;
}

/*
Permite saber si Firebase ya tiene una sesión
activa sin esperar listeners.
*/
function hasActiveSession() {
  return !!auth.currentUser;
}

/* =========================================
   Exports
========================================= */

export {
  app,
  auth,
  db,
  getCurrentUser,
  hasActiveSession
};