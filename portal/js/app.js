import {
  loginUser,
  resetUserPassword,
  redirectIfAuthenticated,
  getFriendlyAuthError
} from "./auth.js";

/* =========================
   Helpers DOM
========================= */

const $ = (selector) => document.querySelector(selector);

const els = {
  loginForm: $("#loginForm"),
  email: $("#email"),
  password: $("#password"),
  rememberSession: $("#rememberSession"),
  togglePassword: $("#togglePassword"),
  resetPasswordBtn: $("#resetPasswordBtn"),
  loginBtn: $("#loginBtn"),
  authMessage: $("#authMessage")
};

/* =========================
   Estado UI
========================= */

const state = {
  loading: false,
  passwordVisible: false
};

/* =========================
   Helpers generales
========================= */

function normalizeEmail(email = "") {
  return String(email || "").trim().toLowerCase();
}

function normalizePassword(password = "") {
  return String(password || "");
}

function isValidEmail(email = "") {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(email));
}

function hasText(value = "") {
  return String(value || "").trim().length > 0;
}

function goToHub() {
  window.location.replace("./hub.html");
}

/* =========================
   UI helpers
========================= */

function clearMessage() {
  setMessage("", "info");
}

function setMessage(message = "", type = "error") {
  if (!els.authMessage) return;

  const cleanMessage = String(message || "").trim();

  els.authMessage.textContent = cleanMessage;
  els.authMessage.dataset.type = type || "info";
  els.authMessage.hidden = !cleanMessage;

  if (!cleanMessage) {
    els.authMessage.style.color = "";
    return;
  }

  if (type === "success") {
    els.authMessage.style.color = "#059669";
    return;
  }

  if (type === "info") {
    els.authMessage.style.color = "#2563eb";
    return;
  }

  els.authMessage.style.color = "#dc2626";
}

function setLoading(isLoading) {
  state.loading = Boolean(isLoading);

  if (els.loginBtn) {
    els.loginBtn.classList.toggle("loading", state.loading);
    els.loginBtn.disabled = state.loading;
    els.loginBtn.setAttribute("aria-busy", String(state.loading));
  }

  if (els.email) els.email.disabled = state.loading;
  if (els.password) els.password.disabled = state.loading;
  if (els.rememberSession) els.rememberSession.disabled = state.loading;
  if (els.resetPasswordBtn) els.resetPasswordBtn.disabled = state.loading;
  if (els.togglePassword) els.togglePassword.disabled = state.loading;
}

function updatePasswordToggleUI() {
  if (!els.password || !els.togglePassword) return;

  els.password.type = state.passwordVisible ? "text" : "password";
  els.togglePassword.textContent = state.passwordVisible ? "Ocultar" : "Mostrar";
  els.togglePassword.setAttribute("aria-pressed", String(state.passwordVisible));
}

function focusEmail() {
  els.email?.focus();
}

function focusPassword() {
  els.password?.focus();
}

function getEmailValue() {
  return normalizeEmail(els.email?.value || "");
}

function getPasswordValue() {
  return normalizePassword(els.password?.value || "");
}

function setFormDisabled(disabled) {
  const isDisabled = Boolean(disabled);

  if (els.email) els.email.disabled = isDisabled;
  if (els.password) els.password.disabled = isDisabled;
  if (els.rememberSession) els.rememberSession.disabled = isDisabled;
  if (els.resetPasswordBtn) els.resetPasswordBtn.disabled = isDisabled;
  if (els.togglePassword) els.togglePassword.disabled = isDisabled;
  if (els.loginBtn) els.loginBtn.disabled = isDisabled;
}

/* =========================
   Validación
========================= */

function validateLoginForm() {
  const email = getEmailValue();
  const password = getPasswordValue();

  if (!email) {
    throw new Error("Escribe tu correo.");
  }

  if (!isValidEmail(email)) {
    throw new Error("Escribe un correo válido.");
  }

  if (!hasText(password)) {
    throw new Error("Escribe tu contraseña.");
  }

  return { email, password };
}

/* =========================
   Handlers
========================= */

async function handleLoginSubmit(event) {
  event.preventDefault();

  if (state.loading) return;

  try {
    clearMessage();
    setLoading(true);

    const { email, password } = validateLoginForm();
    const remember = Boolean(els.rememberSession?.checked);

    setMessage("Validando acceso...", "info");

    await loginUser(email, password, remember);

    setMessage("Ingreso exitoso. Entrando al HUB...", "success");

    // pequeño respiro para que el usuario sí vea feedback
    setTimeout(() => {
      goToHub();
    }, 250);

  } catch (error) {
    const friendly = getFriendlyAuthError(error);
    setMessage(friendly || "No se pudo iniciar sesión.", "error");

    if (!getEmailValue()) {
      focusEmail();
    } else {
      focusPassword();
    }
  } finally {
    setLoading(false);
  }
}

function handleTogglePassword() {
  if (state.loading) return;

  state.passwordVisible = !state.passwordVisible;
  updatePasswordToggleUI();
  els.password?.focus();
}

async function handleResetPassword() {
  if (state.loading) return;

  try {
    const email = getEmailValue();

    if (!email) {
      setMessage(
        "Escribe tu correo arriba para enviarte el enlace de recuperación.",
        "info"
      );
      focusEmail();
      return;
    }

    if (!isValidEmail(email)) {
      setMessage("Escribe un correo válido para recuperar tu contraseña.", "error");
      focusEmail();
      return;
    }

    setMessage("Enviando enlace de recuperación...", "info");
    setFormDisabled(true);

    await resetUserPassword(email, {
      continueUrl: window.location.origin + window.location.pathname
    });

    setMessage(
      "Te enviamos un correo para restablecer tu contraseña.",
      "success"
    );
  } catch (error) {
    const friendly = getFriendlyAuthError(error);
    setMessage(
      friendly || "No se pudo enviar el correo de recuperación.",
      "error"
    );
  } finally {
    setFormDisabled(false);
    updatePasswordToggleUI();
  }
}

function handleInputClearMessage() {
  const type = els.authMessage?.dataset?.type || "";
  if (!els.authMessage?.textContent?.trim()) return;

  // solo limpiamos si era error o info. El success de login dura poquito igual.
  if (type === "error" || type === "info") {
    clearMessage();
  }
}

function handlePasswordKeydown(event) {
  if (event.key !== "Enter") return;
  if (state.loading) {
    event.preventDefault();
  }
}

/* =========================
   Init
========================= */

function bindEvents() {
  els.loginForm?.addEventListener("submit", handleLoginSubmit);
  els.togglePassword?.addEventListener("click", handleTogglePassword);
  els.resetPasswordBtn?.addEventListener("click", handleResetPassword);

  els.email?.addEventListener("input", handleInputClearMessage);
  els.password?.addEventListener("input", handleInputClearMessage);
  els.password?.addEventListener("keydown", handlePasswordKeydown);
}

function initUiState() {
  clearMessage();
  setLoading(false);
  state.passwordVisible = false;
  updatePasswordToggleUI();
}

function initRedirectGuard() {
  redirectIfAuthenticated({
    to: "./hub.html"
  });
}

function init() {
  initUiState();
  initRedirectGuard();
  bindEvents();
}

init();