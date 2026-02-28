/* store.js — Asistencia Spaces (v1.0)
   Estado en memoria + persistencia en localStorage (selecciones + drafts)
*/

(() => {
  'use strict';

  const LS = {
    SELECTED_EMPRESA: "asx_selected_empresaId",
    SELECTED_TALLER: "asx_selected_tallerId",
    DRAFT_PREFIX: "asx_draft_asistencia:", // + sesionId
    USER_LABEL: "asx_user_label", // opcional
  };

  const state = {
    empresas: [],
    talleres: [],
    participantes: [],
    sesiones: [],

    selectedEmpresaId: "",
    selectedTallerId: "",

    // opcional: para marcadoPor
    userLabel: "",
  };

  // =========================
  // Load/Save lightweight
  // =========================
  function load() {
    try {
      state.selectedEmpresaId = localStorage.getItem(LS.SELECTED_EMPRESA) || "";
      state.selectedTallerId = localStorage.getItem(LS.SELECTED_TALLER) || "";
      state.userLabel = localStorage.getItem(LS.USER_LABEL) || "";
    } catch (_) {
      // sin localStorage disponible, seguimos en memoria
    }
  }

  function persistSelection_() {
    try {
      localStorage.setItem(LS.SELECTED_EMPRESA, state.selectedEmpresaId || "");
      localStorage.setItem(LS.SELECTED_TALLER, state.selectedTallerId || "");
    } catch (_) {}
  }

  function persistUserLabel_() {
    try {
      localStorage.setItem(LS.USER_LABEL, state.userLabel || "");
    } catch (_) {}
  }

  // =========================
  // Setters / Getters
  // =========================
  function setEmpresas(arr) { state.empresas = Array.isArray(arr) ? arr : []; }
  function getEmpresas() { return state.empresas; }

  function setTalleres(arr) { state.talleres = Array.isArray(arr) ? arr : []; }
  function getTalleres() { return state.talleres; }

  function setParticipantes(arr) { state.participantes = Array.isArray(arr) ? arr : []; }
  function getParticipantes() { return state.participantes; }

  function setSesiones(arr) { state.sesiones = Array.isArray(arr) ? arr : []; }
  function getSesiones() { return state.sesiones; }

  function setSelectedEmpresaId(id) {
    state.selectedEmpresaId = String(id || "");
    // al cambiar empresa, puede invalidar taller
    persistSelection_();
  }
  function getSelectedEmpresaId() { return state.selectedEmpresaId; }

  function setSelectedTallerId(id) {
    state.selectedTallerId = String(id || "");
    persistSelection_();
  }
  function getSelectedTallerId() { return state.selectedTallerId; }

  function setUserLabel(label) {
    state.userLabel = String(label || "").trim();
    persistUserLabel_();
  }
  function getUserLabel() { return state.userLabel || ""; }

  // =========================
  // Patch helpers
  // =========================
  function patchParticipanteActivo(participanteId, activoSIoNO) {
    const pid = String(participanteId);
    const val = String(activoSIoNO || "").toUpperCase() === "NO" ? "NO" : "SI";
    state.participantes = (state.participantes || []).map(p => {
      if (String(p.participanteId) !== pid) return p;
      return { ...p, activo: val };
    });
  }

  // =========================
  // Draft de asistencia por sesión
  // draft shape:
  // { sesionId, tallerId, map: { [participanteId]: { estado, nota } } }
  // =========================
  function draftKey_(sesionId) {
    return LS.DRAFT_PREFIX + String(sesionId || "");
  }

  function loadDraftAsistencia(sesionId) {
    const key = draftKey_(sesionId);
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      // sanity check
      if (!obj || String(obj.sesionId || "") !== String(sesionId || "")) return null;
      if (!obj.map || typeof obj.map !== "object") obj.map = {};
      return obj;
    } catch (_) {
      return null;
    }
  }

  function saveDraftAsistencia(sesionId, draftObj) {
    const key = draftKey_(sesionId);
    try {
      localStorage.setItem(key, JSON.stringify(draftObj || {}));
      return true;
    } catch (_) {
      return false;
    }
  }

  function clearDraftAsistencia(sesionId) {
    const key = draftKey_(sesionId);
    try {
      localStorage.removeItem(key);
      return true;
    } catch (_) {
      return false;
    }
  }

  // Limpieza opcional: por si acumulan drafts viejos
  function listDraftKeys() {
    try {
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(LS.DRAFT_PREFIX)) keys.push(k);
      }
      return keys;
    } catch (_) {
      return [];
    }
  }

  function clearAllDrafts() {
    const keys = listDraftKeys();
    keys.forEach(k => {
      try { localStorage.removeItem(k); } catch (_) {}
    });
    return keys.length;
  }

  // =========================
  // Expose global
  // =========================
  window.Store = {
    // lifecycle
    load,

    // data
    setEmpresas, getEmpresas,
    setTalleres, getTalleres,
    setParticipantes, getParticipantes,
    setSesiones, getSesiones,

    // selection
    setSelectedEmpresaId, getSelectedEmpresaId,
    setSelectedTallerId, getSelectedTallerId,

    // user label
    setUserLabel, getUserLabel,

    // patch
    patchParticipanteActivo,

    // drafts
    loadDraftAsistencia,
    saveDraftAsistencia,
    clearDraftAsistencia,
    listDraftKeys,
    clearAllDrafts
  };

})();