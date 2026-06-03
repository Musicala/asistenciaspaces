/* firebase/auth.js — Asistencia Spaces
   Login con Google + allowlist de correos. Sin contraseñas que gestionar.
   El gate "duro" está en firestore.rules; esto es el gate de UX en el cliente.
*/

import {
  signInWithPopup,
  signOut as fbSignOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

import { auth, googleProvider } from "./config.js";
import { AUTHORIZED_EMAILS, ROLE_BY_EMAIL, ROLE_DEFAULT } from "../core/constants.js";

const allowSet = new Set(AUTHORIZED_EMAILS.map((e) => e.toLowerCase()));

export function isAuthorized(email) {
  return allowSet.has(String(email || "").toLowerCase());
}

export function roleForEmail(email) {
  return ROLE_BY_EMAIL[String(email || "").toLowerCase()] || ROLE_DEFAULT;
}

// Usuario actual normalizado (o null).
export function currentUser() {
  const u = auth.currentUser;
  if (!u) return null;
  return {
    uid: u.uid,
    email: u.email,
    nombre: u.displayName || u.email,
    foto: u.photoURL || "",
    rol: roleForEmail(u.email),
    autorizado: isAuthorized(u.email),
  };
}

/**
 * Inicia sesión con Google. Si el correo no está en el allowlist,
 * cierra sesión inmediatamente y lanza un error claro.
 */
export async function signInGoogle() {
  const cred = await signInWithPopup(auth, googleProvider);
  const email = cred.user?.email || "";
  if (!isAuthorized(email)) {
    await fbSignOut(auth);
    throw new Error(`El correo ${email} no está autorizado para esta aplicación.`);
  }
  return currentUser();
}

export async function signOut() {
  await fbSignOut(auth);
}

/**
 * Observa cambios de sesión. Llama cb(user|null).
 * Si hay un usuario logueado pero NO autorizado, lo desloguea y emite null.
 */
export function onAuth(cb) {
  return onAuthStateChanged(auth, async (u) => {
    if (u && !isAuthorized(u.email)) {
      await fbSignOut(auth);
      cb(null);
      return;
    }
    cb(u ? currentUser() : null);
  });
}
