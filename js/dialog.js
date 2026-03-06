/* dialog.js — Asistencia Spaces (v1.3)
   Manejo de modales con <dialog>

   ✅ Cierre limpio (no guarda al cerrar)
   ✅ Enter = confirmar solo si pasa validación
   ✅ Escape/Cancelar = null
   ✅ Validaciones suaves + mensajes inline (sin regañar)
   ✅ Normalización (tel/email) + trim consistente
   ✅ Participante: agrega Acudiente (si aplica)
   ✅ Sesión: prompts rápidos (sin dialog dedicado)
   ✅ Tiempo real del salón: horaInicioReal/horaFinReal + duracionRealMin
*/

(() => {
  'use strict';

  const $ = (s) => document.querySelector(s);

  // ====== DOM refs ======
  const modalEmpresa = $("#modalEmpresa");
  const modalTaller = $("#modalTaller");
  const modalParticipante = $("#modalParticipante");

  // Inputs Empresa
  const inputEmpresaNombre = $("#inputEmpresaNombre");
  const inputEmpresaContacto = $("#inputEmpresaContacto");
  const inputEmpresaTelefono = $("#inputEmpresaTelefono");
  const inputEmpresaEmail = $("#inputEmpresaEmail");

  // Inputs Taller
  const inputTallerNombre = $("#inputTallerNombre");
  const inputFechaInicio = $("#inputFechaInicio");
  const inputFechaFin = $("#inputFechaFin");
  const inputFacilitador = $("#inputFacilitador");

  // Inputs Participante
  const inputParticipanteNombre = $("#inputParticipanteNombre");
  const inputParticipanteDocumento = $("#inputParticipanteDocumento");
  const inputParticipanteTelefono = $("#inputParticipanteTelefono");
  const inputParticipanteEmail = $("#inputParticipanteEmail");

  // Inputs Acudiente (pueden no existir en versiones viejas)
  const inputAcudienteNombre = $("#inputAcudienteNombre");
  const inputAcudienteDocumento = $("#inputAcudienteDocumento");
  const inputAcudienteRelacion = $("#inputAcudienteRelacion");
  const inputAcudienteTelefono = $("#inputAcudienteTelefono");
  const inputAcudienteEmail = $("#inputAcudienteEmail");

  // ====== Helpers base ======
  function val_(el) {
    return (el && typeof el.value === "string") ? el.value.trim() : "";
  }

  function set_(el, v) {
    if (!el) return;
    el.value = String(v ?? "");
  }

  function normTel_(s) {
    const x = String(s || "").trim();
    if (!x) return "";
    // mantiene + al inicio si existe, elimina espacios, guiones, paréntesis, etc.
    // ejemplo: "+57 310-123 4567" -> "+573101234567"
    const cleaned = x.replace(/[^\d+]/g, "");
    // si hay varios +, deja solo el primero al inicio
    return cleaned.replace(/\+(?=.+\+)/g, "");
  }

  function normEmail_(s) {
    const x = String(s || "").trim();
    if (!x) return "";
    return x.toLowerCase();
  }

  function isLikelyEmail_(s) {
    const x = String(s || "").trim();
    if (!x) return false;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x);
  }

  function isISODate_(s) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(s || "").trim());
  }

  function parseTimeToMin_(hhmm) {
    const s = String(hhmm || "").trim();
    if (!s) return null;
    const m = /^(\d{1,2}):(\d{2})$/.exec(s);
    if (!m) return null;

    const hh = Number(m[1]);
    const mm = Number(m[2]);
    if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
    if (hh < 0 || hh > 23) return null;
    if (mm < 0 || mm > 59) return null;

    return hh * 60 + mm;
  }

  function normHHMM_(s) {
    const m = parseTimeToMin_(s);
    if (m === null) return "";
    const hh = Math.floor(m / 60);
    const mm = m % 60;
    return String(hh).padStart(2, "0") + ":" + String(mm).padStart(2, "0");
  }

  function calcDuracionMin_(horaInicio, horaFin) {
    const a = parseTimeToMin_(horaInicio);
    const b = parseTimeToMin_(horaFin);
    if (a === null || b === null) return "";
    const d = b - a;
    if (d <= 0) return ""; // no soporta cruzar medianoche
    return d;
  }

  // ====== Mensajes inline (no depende de toast) ======
  function ensureMsg_(dialog) {
    if (!dialog) return null;
    let el = dialog.querySelector("[data-dialog-msg]");
    if (el) return el;

    // crea un bloque de mensaje arriba de los botones
    const box = document.createElement("div");
    box.setAttribute("data-dialog-msg", "1");
    box.setAttribute("role", "status");
    box.setAttribute("aria-live", "polite");
    box.className = "dialog-msg";
    box.style.display = "none";

    const actions = dialog.querySelector(".modal-actions");
    if (actions && actions.parentNode) actions.parentNode.insertBefore(box, actions);
    else dialog.querySelector("form")?.appendChild(box);

    return box;
  }

  function showMsg_(dialog, text) {
    const box = ensureMsg_(dialog);
    if (!box) return;
    if (!text) {
      box.textContent = "";
      box.style.display = "none";
      return;
    }
    box.textContent = text;
    box.style.display = "block";
  }

  // ====== Dialog core (sin “guardar por cerrar”) ======
  function openDialog_(dialog) {
    if (!dialog) return false;
    try {
      showMsg_(dialog, "");
      dialog.showModal();
      return true;
    } catch (_) {
      return false;
    }
  }

  function focusFirst_(dialog) {
    if (!dialog) return;
    const first = dialog.querySelector("input,textarea,select,button");
    first?.focus?.();
  }

  function closeDialog_(dialog, value) {
    try { dialog.close(value); } catch(_) {}
  }

  function waitDialog_(dialog) {
    return new Promise((resolve) => {
      const handler = () => {
        dialog.removeEventListener("close", handler);
        const rv = dialog.returnValue;
        resolve(rv === "cancel" ? null : rv); // rv puede ser "ok" o "cancel"
      };
      dialog.addEventListener("close", handler, { once: true });
    });
  }

  // Intercepta el submit del form: no deja que cierre si no pasa validateFn
  function bindDialogValidation_(dialog, validateFn) {
    if (!dialog) return () => {};
    const form = dialog.querySelector("form");
    if (!form) return () => {};

    const onSubmit = (ev) => {
      // El <form method="dialog"> intenta cerrar siempre. Aquí lo controlamos.
      ev.preventDefault();
      const msg = validateFn?.();
      if (typeof msg === "string" && msg) {
        showMsg_(dialog, msg);
        return;
      }
      // confirm OK
      showMsg_(dialog, "");
      closeDialog_(dialog, "ok");
    };

    const onKeydown = (ev) => {
      // Enter en inputs -> submit, Escape -> cancelar
      if (ev.key === "Escape") {
        // asegura retorno "cancel"
        ev.preventDefault();
        closeDialog_(dialog, "cancel");
      }
    };

    form.addEventListener("submit", onSubmit);
    dialog.addEventListener("keydown", onKeydown);

    return () => {
      form.removeEventListener("submit", onSubmit);
      dialog.removeEventListener("keydown", onKeydown);
    };
  }

  // ====== Resetters ======
  function resetEmpresa_() {
    set_(inputEmpresaNombre, "");
    set_(inputEmpresaContacto, "");
    set_(inputEmpresaTelefono, "");
    set_(inputEmpresaEmail, "");
  }

  function resetTaller_() {
    set_(inputTallerNombre, "");
    set_(inputFechaInicio, "");
    set_(inputFechaFin, "");
    set_(inputFacilitador, "");
  }

  function resetParticipante_() {
    set_(inputParticipanteNombre, "");
    set_(inputParticipanteDocumento, "");
    set_(inputParticipanteTelefono, "");
    set_(inputParticipanteEmail, "");

    // Acudiente (si existe)
    set_(inputAcudienteNombre, "");
    set_(inputAcudienteDocumento, "");
    set_(inputAcudienteRelacion, "");
    set_(inputAcudienteTelefono, "");
    set_(inputAcudienteEmail, "");
  }

  // ==========================================================
  // EMPRESA
  // ==========================================================
  async function promptEmpresa() {
    if (!modalEmpresa) return null;

    resetEmpresa_();

    const unbind = bindDialogValidation_(modalEmpresa, () => {
      const nombre = val_(inputEmpresaNombre);
      if (!nombre) return "Pon el nombre de la empresa para poder crearla.";
      const email = normEmail_(val_(inputEmpresaEmail));
      if (email && !isLikelyEmail_(email)) return "Ese email no se ve bien. Corrígelo o déjalo vacío.";
      return "";
    });

    const ok = openDialog_(modalEmpresa);
    if (!ok) { unbind(); return null; }
    focusFirst_(modalEmpresa);

    const res = await waitDialog_(modalEmpresa);
    unbind();
    if (!res) return null;

    const nombre = val_(inputEmpresaNombre);
    if (!nombre) return null;

    const tel = normTel_(val_(inputEmpresaTelefono));
    const email = normEmail_(val_(inputEmpresaEmail));
    const emailOk = !email || isLikelyEmail_(email);

    return {
      empresaNombre: nombre,
      contactoNombre: val_(inputEmpresaContacto),
      contactoTelefono: tel,
      contactoEmail: emailOk ? email : "",
    };
  }

  // ==========================================================
  // TALLER
  // ==========================================================
  async function promptTaller() {
    if (!modalTaller) return null;

    resetTaller_();

    const unbind = bindDialogValidation_(modalTaller, () => {
      const nombre = val_(inputTallerNombre);
      if (!nombre) return "Pon el nombre del taller para poder crearlo.";

      const fi = val_(inputFechaInicio);
      const ff = val_(inputFechaFin);

      if (fi && !isISODate_(fi)) return "Fecha inicio inválida. Usa el selector o formato YYYY-MM-DD.";
      if (ff && !isISODate_(ff)) return "Fecha fin inválida. Usa el selector o formato YYYY-MM-DD.";
      if (fi && ff && fi > ff) return "La fecha fin no puede ser antes de la fecha inicio.";
      return "";
    });

    const ok = openDialog_(modalTaller);
    if (!ok) { unbind(); return null; }
    focusFirst_(modalTaller);

    const res = await waitDialog_(modalTaller);
    unbind();
    if (!res) return null;

    const nombre = val_(inputTallerNombre);
    if (!nombre) return null;

    const fechaInicio = val_(inputFechaInicio);
    const fechaFin = val_(inputFechaFin);

    const fi = (!fechaInicio || isISODate_(fechaInicio)) ? fechaInicio : "";
    const ff = (!fechaFin || isISODate_(fechaFin)) ? fechaFin : "";

    return {
      tallerNombre: nombre,
      fechaInicio: fi,
      fechaFin: ff,
      facilitador: val_(inputFacilitador),
      estado: "ACTIVO"
    };
  }

  // ==========================================================
  // PARTICIPANTE (+ Acudiente)
  // ==========================================================
  async function promptParticipante() {
    if (!modalParticipante) return null;

    resetParticipante_();

    const unbind = bindDialogValidation_(modalParticipante, () => {
      const nombre = val_(inputParticipanteNombre);
      if (!nombre) return "Pon el nombre del participante para poder crearlo.";

      // Validación suave de correos
      const emailP = normEmail_(val_(inputParticipanteEmail));
      if (emailP && !isLikelyEmail_(emailP)) return "El email del participante no se ve bien. Corrígelo o déjalo vacío.";

      const emailA = normEmail_(val_(inputAcudienteEmail));
      if (emailA && !isLikelyEmail_(emailA)) return "El email del acudiente no se ve bien. Corrígelo o déjalo vacío.";

      // Si llenan algo del acudiente, pedimos por lo menos el nombre
      const anyAcud =
        !!val_(inputAcudienteNombre) ||
        !!val_(inputAcudienteDocumento) ||
        !!val_(inputAcudienteRelacion) ||
        !!val_(inputAcudienteTelefono) ||
        !!val_(inputAcudienteEmail);

      if (anyAcud && !val_(inputAcudienteNombre)) {
        return "Si vas a registrar acudiente, al menos pon el nombre.";
      }

      return "";
    });

    const ok = openDialog_(modalParticipante);
    if (!ok) { unbind(); return null; }
    focusFirst_(modalParticipante);

    const res = await waitDialog_(modalParticipante);
    unbind();
    if (!res) return null;

    const nombre = val_(inputParticipanteNombre);
    if (!nombre) return null;

    const tel = normTel_(val_(inputParticipanteTelefono));
    const email = normEmail_(val_(inputParticipanteEmail));
    const emailOk = !email || isLikelyEmail_(email);

    // Acudiente
    const acudienteNombre = val_(inputAcudienteNombre);
    const acudienteDocumento = val_(inputAcudienteDocumento);
    const acudienteRelacion = val_(inputAcudienteRelacion);
    const acudienteTelefono = normTel_(val_(inputAcudienteTelefono));
    const acudienteEmail = normEmail_(val_(inputAcudienteEmail));
    const acudienteEmailOk = !acudienteEmail || isLikelyEmail_(acudienteEmail);

    // Si no escribieron nada, queda todo vacío
    const anyAcud =
      !!acudienteNombre ||
      !!acudienteDocumento ||
      !!acudienteRelacion ||
      !!acudienteTelefono ||
      !!acudienteEmail;

    return {
      nombreCompleto: nombre,
      documento: val_(inputParticipanteDocumento),
      telefono: tel,
      email: emailOk ? email : "",
      activo: "SI",

      // Campos nuevos (planos, fáciles de guardar en Sheets)
      acudienteNombre: anyAcud ? acudienteNombre : "",
      acudienteDocumento: anyAcud ? acudienteDocumento : "",
      acudienteRelacion: anyAcud ? acudienteRelacion : "",
      acudienteTelefono: anyAcud ? acudienteTelefono : "",
      acudienteEmail: (anyAcud && acudienteEmailOk) ? acudienteEmail : ""
    };
  }

  // ==========================================================
  // SESIÓN (creación rápida sin dialog dedicado)
  // ==========================================================
  async function promptSesion({ fechaDefault } = {}) {
    const fecha = window.prompt(
      "Fecha de la sesión (YYYY-MM-DD):",
      (fechaDefault || "").trim()
    );
    if (!fecha) return null;

    const f = fecha.trim();
    if (!isISODate_(f)) {
      window.alert("La fecha debe estar en formato YYYY-MM-DD.");
      return null;
    }

    const tema = (window.prompt("Tema (opcional):", "") || "").trim();

    const horaInicioRaw = (window.prompt("Hora inicio (HH:MM, 24h) (opcional):", "") || "").trim();
    const horaFinRaw = (window.prompt("Hora fin (HH:MM, 24h) (opcional):", "") || "").trim();

    const hi = horaInicioRaw ? normHHMM_(horaInicioRaw) : "";
    const hf = horaFinRaw ? normHHMM_(horaFinRaw) : "";

    const duracionMin = (hi && hf) ? calcDuracionMin_(hi, hf) : "";

    return {
      fecha: f,
      tema,
      horaInicio: hi,
      horaFin: hf,
      duracionMin
    };
  }

  // ==========================================================
  // TIEMPO REAL USADO DEL SALÓN (para sesión existente)
  // ==========================================================
  async function promptTiempoRealSesion({
    fechaLabel,
    horaInicioSugerida,
    horaFinSugerida
  } = {}) {

    const label = fechaLabel ? ` (${fechaLabel})` : "";

    const hiRaw = (window.prompt(
      `Hora REAL de inicio${label} (HH:MM, 24h):`,
      (horaInicioSugerida || "").trim()
    ) || "").trim();

    if (!hiRaw) return null; // cancel/empty => no cambia nada

    const hfRaw = (window.prompt(
      `Hora REAL de fin${label} (HH:MM, 24h):`,
      (horaFinSugerida || "").trim()
    ) || "").trim();

    if (!hfRaw) return null;

    const hi = normHHMM_(hiRaw);
    const hf = normHHMM_(hfRaw);

    if (!hi || !hf) {
      window.alert("Horas inválidas. Usa formato HH:MM (24h).");
      return null;
    }

    const dur = calcDuracionMin_(hi, hf);
    if (!dur) {
      window.alert("La hora fin debe ser mayor a la hora inicio (sin cruzar medianoche).");
      return null;
    }

    const durRaw = (window.prompt(
      `Duración REAL en minutos (enter para usar ${dur}):`,
      String(dur)
    ) || "").trim();

    const durN = Number(durRaw);
    const duracionRealMin = (durRaw && Number.isFinite(durN) && durN > 0) ? Math.round(durN) : dur;

    return {
      horaInicioReal: hi,
      horaFinReal: hf,
      duracionRealMin
    };
  }

  // Expose global
  window.Dialogs = {
    promptEmpresa,
    promptTaller,
    promptParticipante,
    promptSesion,
    promptTiempoRealSesion
  };

})();