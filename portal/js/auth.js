import { auth } from "./firebase-config.js";
import {
  browserLocalPersistence,
  browserSessionPersistence,
  setPersistence,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

/* =========================
   Helpers base
========================= */

function normalizeEmail(email = "") {
  return String(email || "").trim().toLowerCase();
}

function normalizePassword(password = "") {
  return String(password || "");
}

function isValidEmailFormat(email = "") {
  const value = normalizeEmail(email);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function safeUrl(url, fallback = "./index.html") {
  const value = String(url || "").trim();
  return value || fallback;
}

function hasWindow() {
  return typeof window !== "undefined" && typeof window.location !== "undefined";
}

function redirectOnce(url) {
  if (!hasWindow()) return;
  window.location.replace(url);
}

/* =========================
   Helpers de mensajes
========================= */

function mapAuthError(error) {
  const code = error?.code || "";

  switch (code) {
    case "auth/invalid-email":
      return "El correo no tiene un formato válido.";

    case "auth/missing-password":
      return "Falta la contraseña.";

    case "auth/invalid-credential":
      return "Correo o contraseña incorrectos.";

    case "auth/user-not-found":
      return "No existe una cuenta con ese correo.";

    case "auth/wrong-password":
      return "La contraseña no coincide.";

    case "auth/user-disabled":
      return "Esta cuenta está deshabilitada.";

    case "auth/too-many-requests":
      return "Hubo demasiados intentos. Espera un momento e inténtalo otra vez.";

    case "auth/network-request-failed":
      return "No se pudo conectar. Revisa tu internet.";

    case "auth/internal-error":
      return "Hubo un problema interno autenticando la cuenta.";

    case "auth/missing-email":
      return "Debes escribir tu correo.";

    default:
      return error?.message || "No se pudo completar la autenticación.";
  }
}

/* =========================
   Validaciones
========================= */

function assertLoginPayload(email, password) {
  const cleanEmail = normalizeEmail(email);
  const cleanPassword = normalizePassword(password);

  if (!cleanEmail) {
    throw new Error("Debes ingresar tu correo.");
  }

  if (!isValidEmailFormat(cleanEmail)) {
    throw new Error("El correo no tiene un formato válido.");
  }

  if (!cleanPassword) {
    throw new Error("Debes ingresar tu contraseña.");
  }

  return {
    email: cleanEmail,
    password: cleanPassword
  };
}

function assertResetEmail(email) {
  const cleanEmail = normalizeEmail(email);

  if (!cleanEmail) {
    throw new Error("Escribe tu correo para recuperar la contraseña.");
  }

  if (!isValidEmailFormat(cleanEmail)) {
    throw new Error("El correo no tiene un formato válido.");
  }

  return cleanEmail;
}

/* =========================
   API pública
========================= */

export async function loginUser(email, password, remember = false) {
  const payload = assertLoginPayload(email, password);

  const persistence = remember
    ? browserLocalPersistence
    : browserSessionPersistence;

  try {
    await setPersistence(auth, persistence);

    const credential = await signInWithEmailAndPassword(
      auth,
      payload.email,
      payload.password
    );

    return credential.user;
  } catch (error) {
    throw new Error(mapAuthError(error));
  }
}

export async function logoutUser() {
  try {
    await signOut(auth);
    return true;
  } catch (error) {
    throw new Error(mapAuthError(error));
  }
}

export async function resetUserPassword(email, options = {}) {
  const cleanEmail = assertResetEmail(email);

  const actionCodeSettings = options?.continueUrl
    ? {
        url: String(options.continueUrl),
        handleCodeInApp: false
      }
    : undefined;

  try {
    if (actionCodeSettings) {
      await sendPasswordResetEmail(auth, cleanEmail, actionCodeSettings);
    } else {
      await sendPasswordResetEmail(auth, cleanEmail);
    }

    return true;
  } catch (error) {
    throw new Error(mapAuthError(error));
  }
}

export function watchAuthState(callback) {
  if (typeof callback !== "function") {
    throw new Error("watchAuthState necesita una función callback.");
  }

  return onAuthStateChanged(auth, callback);
}

export function getCurrentUser() {
  return auth.currentUser || null;
}

/**
 * Espera a que Firebase resuelva el estado inicial de autenticación.
 * Útil cuando no quieren actuar antes de que auth termine de hidratar sesión.
 */
export function waitForAuthReady() {
  return new Promise((resolve) => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      unsubscribe();
      resolve(user || null);
    });
  });
}

/**
 * Requiere autenticación.
 * - Si hay usuario, llama onAuthenticated(user)
 * - Si no hay usuario, llama onUnauthenticated() o redirige
 *
 * Devuelve la función unsubscribe de Firebase.
 */
export function requireAuth({
  onAuthenticated,
  onUnauthenticated,
  redirectTo = "./index.html"
} = {}) {
  let handled = false;

  const unsubscribe = onAuthStateChanged(auth, (user) => {
    if (handled) return;

    if (user) {
      handled = true;
      unsubscribe();

      if (typeof onAuthenticated === "function") {
        onAuthenticated(user);
      }
      return;
    }

    handled = true;
    unsubscribe();

    if (typeof onUnauthenticated === "function") {
      onUnauthenticated();
      return;
    }

    redirectOnce(safeUrl(redirectTo, "./index.html"));
  });

  return unsubscribe;
}

/**
 * Si ya existe sesión, redirige o ejecuta callback.
 * Útil en login/index para que no vuelvan a entrar donde no toca.
 */
export function redirectIfAuthenticated({
  to = "./hub.html",
  callback
} = {}) {
  let handled = false;

  const unsubscribe = onAuthStateChanged(auth, (user) => {
    if (handled || !user) return;

    handled = true;
    unsubscribe();

    if (typeof callback === "function") {
      callback(user);
      return;
    }

    redirectOnce(safeUrl(to, "./hub.html"));
  });

  return unsubscribe;
}

/* =========================
   Utilidades expuestas
========================= */

export function getFriendlyAuthError(error) {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return mapAuthError(error);
}

export function getUserSessionInfo(user = auth.currentUser) {
  if (!user) return null;

  return {
    uid: user.uid || "",
    email: user.email || "",
    displayName: user.displayName || "",
    emailVerified: !!user.emailVerified,
    isAnonymous: !!user.isAnonymous
  };
}

export function isUserEmailVerified(user = auth.currentUser) {
  return !!user?.emailVerified;
}