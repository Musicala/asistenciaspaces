/* api.js — Asistencia Spaces (v1.2)
   Cliente HTTP para Apps Script Web App API
   ✅ Evita CORS/preflight usando POST form-urlencoded (NO JSON)
   ✅ Timeout + AbortController
   ✅ Mensajes de error decentes (con detalle cuando sirve)
   ✅ Reintento suave en fallos de red (1 intento extra)
   ✅ Normaliza respuestas { ok:true, ... } y lanza Error si ok !== true
*/

(() => {
  'use strict';

  // =============================
  // CONFIG (EDITA ESTO)
  // =============================
  const WEBAPP_URL =
    "https://script.google.com/macros/s/AKfycbyFyPp9486wu_hUbMEhOkCn2dP4nYfWaKcGZZ3ZP4K5Z3rTEdbkgkbBItzrzEw_Y1Ja/exec";

  const TOKEN = "MUSICALA-SECRET-2026"; // debe coincidir con Code.gs

  // Tiempo máximo por request
  const TIMEOUT_MS = 18000;

  // Reintentos (solo red/timeout)
  const RETRIES = 1;

  // Debug (ponlo true si quieres ver trazas en consola)
  const DEBUG = false;

  // =============================
  // Helpers
  // =============================
  const log = (...args) => { if (DEBUG) console.log("[API]", ...args); };

  function assertConfigured_() {
    if (!WEBAPP_URL || WEBAPP_URL.includes("PEGAR_WEBAPP_URL_AQUI")) {
      throw new Error("API no configurada: pega tu WEBAPP_URL en api.js");
    }
    if (!TOKEN) throw new Error("API no configurada: define TOKEN en api.js");
  }

  function withTimeoutFetch_(url, opts, ms) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    const p = fetch(url, { ...opts, signal: ctrl.signal })
      .finally(() => clearTimeout(t));
    return { ctrl, promise: p };
  }

  function qs_(obj) {
    const p = new URLSearchParams();
    Object.entries(obj || {}).forEach(([k, v]) => {
      if (v === undefined || v === null) return;
      p.set(k, String(v));
    });
    return p.toString();
  }

  function form_(obj) {
    // x-www-form-urlencoded
    const p = new URLSearchParams();
    Object.entries(obj || {}).forEach(([k, v]) => {
      if (v === undefined || v === null) return;
      p.set(k, String(v));
    });
    return p.toString();
  }

  function isNetworkishError_(err) {
    // "Failed to fetch" (network/CORS), AbortError (timeout), TypeError en fetch
    if (!err) return false;
    if (err.name === "AbortError") return true;
    const msg = (err.message || String(err)).toLowerCase();
    return msg.includes("failed to fetch") || msg.includes("networkerror") || msg.includes("load failed");
  }

  function friendlyError_(err, extra = {}) {
    const base =
      (err && err.name === "AbortError") ? "Tiempo de espera agotado (timeout)." :
      (err && err.message) ? err.message :
      String(err);

    // Agrega contexto si existe
    const parts = [base];
    if (extra && extra.action) parts.push(`(action: ${extra.action})`);
    if (extra && extra.httpStatus) parts.push(`(HTTP: ${extra.httpStatus})`);
    return parts.join(" ");
  }

  async function parseResponse_(res) {
    const text = await res.text();
    let json = null;

    try {
      json = text ? JSON.parse(text) : {};
    } catch (_) {
      // Si el backend devolvió HTML/Texto, muéstralo (cortico)
      const raw = (text || "").slice(0, 500);
      return {
        ok: false,
        error: "Respuesta no-JSON del servidor",
        raw,
        httpStatus: res.status
      };
    }

    // Si Apps Script no respeta status codes, igual guardamos
    if (json && typeof json === "object" && typeof json.ok === "boolean") {
      json.httpStatus = res.status;
      return json;
    }

    // Si no tiene formato esperado
    return {
      ok: false,
      error: "Respuesta inválida del servidor (sin campo ok).",
      raw: (text || "").slice(0, 500),
      httpStatus: res.status
    };
  }

  async function request_(kind, action, paramsOrBody) {
    assertConfigured_();

    // GET siempre por querystring
    if (kind === "GET") {
      const query = qs_({ action, token: TOKEN, ...(paramsOrBody || {}) });
      const url = `${WEBAPP_URL}?${query}`;
      return await fetchJsonWithRetry_(url, { method: "GET" }, { action });
    }

    // POST: FORM-ENCODED para evitar CORS/preflight
    // Nota: si necesitas mandar objetos, los serializamos como JSON string
    const bodyObj = { action, token: TOKEN, ...(paramsOrBody || {}) };
    Object.entries(bodyObj).forEach(([k, v]) => {
      if (v && typeof v === "object") bodyObj[k] = JSON.stringify(v);
    });

    return await fetchJsonWithRetry_(
      WEBAPP_URL,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
        body: form_(bodyObj),
      },
      { action }
    );
  }

  async function fetchJsonWithRetry_(url, opts, meta) {
    let lastErr = null;

    for (let attempt = 0; attempt <= RETRIES; attempt++) {
      try {
        log("fetch", { url, opts, attempt });
        const { promise } = withTimeoutFetch_(url, opts, TIMEOUT_MS);
        const res = await promise;

        const json = await parseResponse_(res);

        // Si backend dice ok:false
        if (!json || json.ok !== true) {
          const msg = (json && (json.error || json.message)) || "Error desconocido";
          const e = new Error(msg);
          e._api = { ...(meta || {}), httpStatus: json && json.httpStatus, raw: json && json.raw };
          throw e;
        }

        return json;

      } catch (err) {
        lastErr = err;

        // Si es red/timeout y aún hay reintento, reintenta
        const net = isNetworkishError_(err);
        if (net && attempt < RETRIES) {
          log("retrying after networkish error", err);
          await new Promise(r => setTimeout(r, 350));
          continue;
        }

        // Error final
        const extra = {
          action: meta && meta.action,
          httpStatus: err && err._api && err._api.httpStatus
        };
        throw new Error(friendlyError_(err, extra));
      }
    }

    // No debería llegar acá, pero por si el universo quiere sufrir
    throw new Error(friendlyError_(lastErr, { action: meta && meta.action }));
  }

  // =============================
  // Public API
  // =============================
  const API = {
    // health
    async ping() {
      const r = await request_("GET", "ping");
      return r;
    },

    // Empresas
    async listEmpresas() {
      const r = await request_("GET", "listEmpresas");
      return r.empresas || [];
    },

    async createEmpresa(data) {
      // data: { nombre, nit?, contacto?, ... }
      const r = await request_("POST", "createEmpresa", data);
      return r; // { ok:true, empresa, note? }
    },

    // Talleres
    async listTalleresByEmpresa(empresaId) {
      const r = await request_("GET", "listTalleresByEmpresa", { empresaId });
      return r.talleres || [];
    },

    async createTaller(data) {
      const r = await request_("POST", "createTaller", data);
      return r; // { ok:true, taller }
    },

    // Participantes
    async listParticipantesByTaller(tallerId) {
      const r = await request_("GET", "listParticipantesByTaller", { tallerId });
      return r.participantes || [];
    },

    async createParticipante(data) {
      const r = await request_("POST", "createParticipante", data);
      return r; // { ok:true, participante }
    },

    async updateParticipante(data) {
      const r = await request_("POST", "updateParticipante", data);
      return r; // { ok:true, participante }
    },

    // Sesiones
    async listSesionesByTaller(tallerId) {
      const r = await request_("GET", "listSesionesByTaller", { tallerId });
      return r.sesiones || [];
    },

    async createSesion(data) {
      const r = await request_("POST", "createSesion", data);
      return r; // { ok:true, sesion, note? }
    },

    // Asistencias
    async getAsistenciaBySesion(sesionId) {
      const r = await request_("GET", "getAsistenciaBySesion", { sesionId });
      return r.asistencias || [];
    },

    async saveAsistenciaBatch(payload) {
      // payload: { sesionId, tallerId, marcadoPor?, rows:[{participanteId,estado,nota?}] }
      // Ojo: rows es objeto/array => se enviará serializado JSON automáticamente
      const r = await request_("POST", "saveAsistenciaBatch", payload);
      return r; // { ok:true, created, updated }
    },

    // Utilidad: cambia config en runtime si quieres (opcional)
    _setConfig({ webappUrl, token, debug } = {}) {
      if (typeof webappUrl === "string" && webappUrl.trim()) {
        // hack: sí, es const arriba. entonces guardamos override en window.
        window.__ASISTENCIA_SPACES_WEBAPP_URL__ = webappUrl.trim();
      }
      if (typeof token === "string" && token.trim()) {
        window.__ASISTENCIA_SPACES_TOKEN__ = token.trim();
      }
      if (typeof debug === "boolean") {
        window.__ASISTENCIA_SPACES_DEBUG__ = debug;
      }
    }
  };

  // Overrides opcionales (sin tocar el archivo)
  // window.__ASISTENCIA_SPACES_WEBAPP_URL__ = "https://script.googleusercontent.com/...."
  // window.__ASISTENCIA_SPACES_TOKEN__ = "...."
  // window.__ASISTENCIA_SPACES_DEBUG__ = true
  if (window.__ASISTENCIA_SPACES_WEBAPP_URL__) {
    // eslint-disable-next-line no-unused-vars
    const _ = 0; // placeholder para no llorar por "const"
  }
  // Truco simple: definimos getters sobre variables "const" usando wrappers
  // Pero para mantener esto simple, solo re-enrutamos request_ si hay override:
  const _origRequest = request_;
  request_ = async function(kind, action, paramsOrBody) { // eslint-disable-line no-func-assign
    if (window.__ASISTENCIA_SPACES_DEBUG__ === true && DEBUG !== true) {
      // no cambia DEBUG const, pero igual da contexto en errores al usuario
    }
    if (window.__ASISTENCIA_SPACES_WEBAPP_URL__) {
      // usamos una versión local copiando lógica pero con URL override
      assertConfigured_();
      const urlBase = window.__ASISTENCIA_SPACES_WEBAPP_URL__;
      const tok = window.__ASISTENCIA_SPACES_TOKEN__ || TOKEN;

      if (kind === "GET") {
        const query = qs_({ action, token: tok, ...(paramsOrBody || {}) });
        const url = `${urlBase}?${query}`;
        return await fetchJsonWithRetry_(url, { method: "GET" }, { action });
      }

      const bodyObj = { action, token: tok, ...(paramsOrBody || {}) };
      Object.entries(bodyObj).forEach(([k, v]) => {
        if (v && typeof v === "object") bodyObj[k] = JSON.stringify(v);
      });

      return await fetchJsonWithRetry_(
        urlBase,
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
          body: form_(bodyObj),
        },
        { action }
      );
    }

    return await _origRequest(kind, action, paramsOrBody);
  };

  // Expose global
  window.API = API;

})();