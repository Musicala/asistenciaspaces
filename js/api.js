/* api.js — Asistencia Spaces (v1.3)
   Cliente HTTP para Apps Script Web App API

   ✅ Evita CORS/preflight usando POST form-urlencoded (NO JSON)
   ✅ Timeout + AbortController
   ✅ Mensajes de error decentes (con detalle cuando sirve)
   ✅ Reintento suave en fallos de red (1 intento extra por defecto)
   ✅ Normaliza respuestas { ok:true, ... } y lanza Error si ok !== true
   ✅ Overrides por window.__ASISTENCIA_SPACES_API__ (sin hacks)
   ✅ NUEVO: updateSesion()
*/

(() => {
  'use strict';

  // =============================
  // CONFIG BASE (puedes sobre-escribir por window.__ASISTENCIA_SPACES_API__)
  // =============================
  const BASE = {
    webappUrl:
      "https://script.google.com/macros/s/AKfycbySWVHSZe6mGGfzXvEqUWGFaw0noO9Vsux95CX_hdwYD1BNaaULtfGFxa3gvB3dKnU5/exec",
    token: "MUSICALA-SECRET-2026",
    timeoutMs: 18000,
    retries: 1,
    debug: false,
  };

  // =============================
  // Runtime config (override-friendly)
  // =============================
  function cfg_() {
    const o = (window.__ASISTENCIA_SPACES_API__ && typeof window.__ASISTENCIA_SPACES_API__ === "object")
      ? window.__ASISTENCIA_SPACES_API__
      : {};

    return {
      webappUrl: (typeof o.webappUrl === "string" && o.webappUrl.trim()) ? o.webappUrl.trim() : BASE.webappUrl,
      token: (typeof o.token === "string" && o.token.trim()) ? o.token.trim() : BASE.token,
      timeoutMs: Number.isFinite(Number(o.timeoutMs)) ? Math.max(2000, Number(o.timeoutMs)) : BASE.timeoutMs,
      retries: Number.isFinite(Number(o.retries)) ? Math.max(0, Math.min(3, Number(o.retries))) : BASE.retries,
      debug: (typeof o.debug === "boolean") ? o.debug : BASE.debug,
    };
  }

  const log_ = (...args) => {
    const c = cfg_();
    if (c.debug) console.log("[API]", ...args);
  };

  function assertConfigured_() {
    const c = cfg_();
    if (!c.webappUrl || c.webappUrl.includes("PEGAR_WEBAPP_URL_AQUI")) {
      throw new Error("API no configurada: pega tu WEBAPP_URL en api.js o en window.__ASISTENCIA_SPACES_API__");
    }
    if (!c.token) throw new Error("API no configurada: define TOKEN en api.js o en window.__ASISTENCIA_SPACES_API__");
  }

  // =============================
  // Helpers
  // =============================
  function withTimeoutFetch_(url, opts, ms) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    const promise = fetch(url, { ...opts, signal: ctrl.signal })
      .finally(() => clearTimeout(t));
    return { ctrl, promise };
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
    const p = new URLSearchParams();
    Object.entries(obj || {}).forEach(([k, v]) => {
      if (v === undefined || v === null) return;
      p.set(k, String(v));
    });
    return p.toString();
  }

  function isNetworkishError_(err) {
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

    const parts = [base];
    if (extra.action) parts.push(`(action: ${extra.action})`);
    if (extra.httpStatus) parts.push(`(HTTP: ${extra.httpStatus})`);
    return parts.join(" ");
  }

  async function parseResponse_(res) {
    const text = await res.text();
    let json = null;

    try {
      json = text ? JSON.parse(text) : {};
    } catch (_) {
      const raw = (text || "").slice(0, 600);
      return {
        ok: false,
        error: "Respuesta no-JSON del servidor",
        raw,
        httpStatus: res.status
      };
    }

    if (json && typeof json === "object" && typeof json.ok === "boolean") {
      json.httpStatus = res.status;
      return json;
    }

    return {
      ok: false,
      error: "Respuesta inválida del servidor (sin campo ok).",
      raw: (text || "").slice(0, 600),
      httpStatus: res.status
    };
  }

  function serializeObjects_(obj) {
    // Serializa arrays/objetos a JSON string para POST form-urlencoded.
    // Ojo: Date no lo tocamos, solo lo String().
    const out = { ...(obj || {}) };
    Object.entries(out).forEach(([k, v]) => {
      if (v === undefined || v === null) return;
      if (typeof v === "object") {
        // si es Date => string ISO
        if (v instanceof Date) out[k] = v.toISOString();
        else out[k] = JSON.stringify(v);
      } else {
        out[k] = String(v);
      }
    });
    return out;
  }

  // =============================
  // Core request
  // =============================
  async function fetchJsonWithRetry_(url, opts, meta) {
    const c = cfg_();
    let lastErr = null;

    for (let attempt = 0; attempt <= c.retries; attempt++) {
      try {
        log_("fetch", { url, opts, attempt, meta });
        const { promise } = withTimeoutFetch_(url, opts, c.timeoutMs);
        const res = await promise;

        const json = await parseResponse_(res);

        if (!json || json.ok !== true) {
          const msg = (json && (json.error || json.message)) || "Error desconocido";
          const e = new Error(msg);
          e._api = {
            ...(meta || {}),
            httpStatus: json && json.httpStatus,
            raw: json && json.raw
          };
          throw e;
        }

        return json;

      } catch (err) {
        lastErr = err;

        const net = isNetworkishError_(err);
        if (net && attempt < c.retries) {
          log_("retrying after networkish error", err);
          await new Promise(r => setTimeout(r, 350));
          continue;
        }

        // Error final
        const extra = {
          action: meta && meta.action,
          httpStatus: err && err._api && err._api.httpStatus
        };

        // Si venía raw (HTML, etc), lo metemos en consola si debug
        if (c.debug && err && err._api && err._api.raw) {
          console.warn("[API raw]", err._api.raw);
        }

        throw new Error(friendlyError_(err, extra));
      }
    }

    throw new Error(friendlyError_(lastErr, { action: meta && meta.action }));
  }

  async function request_(kind, action, paramsOrBody) {
    assertConfigured_();
    const c = cfg_();

    if (kind === "GET") {
      const query = qs_({ action, token: c.token, ...(paramsOrBody || {}) });
      const url = `${c.webappUrl}?${query}`;
      return await fetchJsonWithRetry_(url, { method: "GET" }, { action });
    }

    // POST form-urlencoded
    const bodyObj = serializeObjects_({ action, token: c.token, ...(paramsOrBody || {}) });

    return await fetchJsonWithRetry_(
      c.webappUrl,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
        body: form_(bodyObj),
      },
      { action }
    );
  }

  // =============================
  // Public API
  // =============================
  const API = {
    // health
    async ping() {
      return await request_("GET", "ping");
    },

    // Empresas
    async listEmpresas() {
      const r = await request_("GET", "listEmpresas");
      return r.empresas || [];
    },

    async createEmpresa(data) {
      return await request_("POST", "createEmpresa", data);
    },

    // Talleres
    async listTalleresByEmpresa(empresaId) {
      const r = await request_("GET", "listTalleresByEmpresa", { empresaId });
      return r.talleres || [];
    },

    async createTaller(data) {
      return await request_("POST", "createTaller", data);
    },

    // Participantes
    async listParticipantesByTaller(tallerId) {
      const r = await request_("GET", "listParticipantesByTaller", { tallerId });
      return r.participantes || [];
    },

    async createParticipante(data) {
      return await request_("POST", "createParticipante", data);
    },

    async updateParticipante(data) {
      return await request_("POST", "updateParticipante", data);
    },

    // Sesiones
    async listSesionesByTaller(tallerId) {
      const r = await request_("GET", "listSesionesByTaller", { tallerId });
      return r.sesiones || [];
    },

    async createSesion(data) {
      return await request_("POST", "createSesion", data);
    },

    // ✅ NUEVO: updateSesion (tiempo real)
    async updateSesion(data) {
      // data: { sesionId, horaInicioReal?, horaFinReal?, duracionRealMin?, tema?, observaciones?, ... }
      return await request_("POST", "updateSesion", data);
    },

    // Asistencias
    async getAsistenciaBySesion(sesionId) {
      const r = await request_("GET", "getAsistenciaBySesion", { sesionId });
      return r.asistencias || [];
    },

    async saveAsistenciaBatch(payload) {
      // payload: { sesionId, tallerId, marcadoPor?, rows:[{participanteId,estado,nota?}] }
      return await request_("POST", "saveAsistenciaBatch", payload);
    },

    // Debug helper (opcional)
    _getConfig() {
      return cfg_();
    }
  };

  // Expose global
  window.API = API;

})();