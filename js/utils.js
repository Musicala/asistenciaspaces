/* utils.js — Asistencia Spaces (v1.0)
   Helpers pequeños para UI/fechas/toasts/debounce
*/

(() => {
  'use strict';

  const $ = (s) => document.querySelector(s);

  // =========================
  // Debounce
  // =========================
  function debounce(fn, wait = 150) {
    let t = null;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), wait);
    };
  }

  // =========================
  // Dates
  // =========================
  function pad2(n) { return String(n).padStart(2, "0"); }

  function todayISO() {
    const d = new Date();
    const y = d.getFullYear();
    const m = pad2(d.getMonth() + 1);
    const day = pad2(d.getDate());
    return `${y}-${m}-${day}`;
  }

  function fmtDate(d) {
    // recibe Date o string YYYY-MM-DD (simple)
    if (!d) return "";
    if (d instanceof Date) {
      return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
    }
    const s = String(d);
    // si es YYYY-MM-DD -> DD/MM/YYYY
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      const [y,m,dd] = s.split("-");
      return `${dd}/${m}/${y}`;
    }
    return s;
  }

  // =========================
  // Toasts
  // =========================
  function toast(msg, type = "ok", opts = {}) {
    const host = $("#toastHost");
    if (!host) {
      console.log("[toast]", type, msg);
      return;
    }

    const t = document.createElement("div");
    t.className = `toast ${type}`;
    const dot = document.createElement("div");
    dot.className = "dot";

    const m = document.createElement("div");
    m.className = "msg";
    m.textContent = String(msg || "");

    t.appendChild(dot);
    t.appendChild(m);
    host.appendChild(t);

    const duration = Number(opts.duration || 3200);

    // animación simple
    t.animate(
      [
        { transform: "translateY(6px)", opacity: 0 },
        { transform: "translateY(0px)", opacity: 1 }
      ],
      { duration: 140, easing: "ease-out" }
    );

    setTimeout(() => {
      t.animate(
        [
          { transform: "translateY(0px)", opacity: 1 },
          { transform: "translateY(6px)", opacity: 0 }
        ],
        { duration: 160, easing: "ease-in" }
      ).onfinish = () => t.remove();
    }, duration);
  }

  // =========================
  // JSON safety
  // =========================
  function safeJsonParse(text, fallback = null) {
    try { return JSON.parse(text); } catch (_) { return fallback; }
  }

  function safeJsonStringify(obj, fallback = "{}") {
    try { return JSON.stringify(obj); } catch (_) { return fallback; }
  }

  // =========================
  // Misc
  // =========================
  function clamp(n, a, b) {
    const x = Number(n);
    if (Number.isNaN(x)) return a;
    return Math.min(b, Math.max(a, x));
  }

  function uid(prefix = "id") {
    return `${prefix}_${Math.random().toString(16).slice(2, 10)}${Date.now().toString(16).slice(-4)}`;
  }

  // Expose
  window.Utils = {
    debounce,
    todayISO,
    fmtDate,
    toast,
    safeJsonParse,
    safeJsonStringify,
    clamp,
    uid
  };

})();