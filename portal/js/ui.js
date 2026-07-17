/* =========================
   Selectores
========================= */

export const $ = (selector, scope = document) => scope?.querySelector?.(selector) || null;

export const $$ = (selector, scope = document) =>
  Array.from(scope?.querySelectorAll?.(selector) || []);

/* =========================
   Texto / HTML
========================= */

export function safeText(value, fallback = "—") {
  if (value === null || value === undefined || value === "") return fallback;
  return String(value);
}

export function textOrEmpty(value) {
  if (value === null || value === undefined) return "";
  return String(value);
}

export function setText(element, value, fallback = "—") {
  if (!element) return;
  element.textContent = safeText(value, fallback);
}

export function setHTML(element, html = "") {
  if (!element) return;
  element.innerHTML = String(html ?? "");
}

export function clearHTML(element) {
  if (!element) return;
  element.innerHTML = "";
}

export function appendHTML(element, html = "") {
  if (!element) return;
  element.insertAdjacentHTML("beforeend", String(html ?? ""));
}

export function escapeHtml(text = "") {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function joinParts(parts = [], separator = " • ") {
  return (parts || [])
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join(separator);
}

/* =========================
   Mostrar / ocultar
========================= */

export function show(element, display = "") {
  if (!element) return;
  element.hidden = false;
  element.style.display = display;
  element.removeAttribute("aria-hidden");
}

export function hide(element) {
  if (!element) return;
  element.hidden = true;
  element.style.display = "none";
  element.setAttribute("aria-hidden", "true");
}

export function toggle(element, shouldShow, display = "") {
  if (!element) return;
  if (shouldShow) show(element, display);
  else hide(element);
}

export function setHidden(element, isHidden = true) {
  if (isHidden) hide(element);
  else show(element);
}

/* =========================
   Clases / atributos
========================= */

export function addClass(element, className) {
  if (!element || !className) return;
  element.classList.add(className);
}

export function removeClass(element, className) {
  if (!element || !className) return;
  element.classList.remove(className);
}

export function toggleClass(element, className, force) {
  if (!element || !className) return;
  element.classList.toggle(className, force);
}

export function setAttr(element, name, value) {
  if (!element || !name) return;
  if (value === null || value === undefined || value === false) {
    element.removeAttribute(name);
    return;
  }
  element.setAttribute(name, value === true ? "" : String(value));
}

export function removeAttr(element, name) {
  if (!element || !name) return;
  element.removeAttribute(name);
}

/* =========================
   Botones loading
========================= */

export function setButtonLoading(button, isLoading, options = {}) {
  if (!button) return;

  const {
    loadingText = "Cargando...",
    defaultText = button.dataset.defaultText || button.textContent || "Continuar",
    disable = true,
    loadingClass = "loading"
  } = options;

  if (!button.dataset.defaultText) {
    button.dataset.defaultText = defaultText;
  }

  const label = button.querySelector(".btn-label");

  if (isLoading) {
    button.classList.add(loadingClass);
    button.dataset.loading = "true";
    if (disable) button.disabled = true;
    button.setAttribute("aria-busy", "true");

    if (label) label.textContent = loadingText;
    else button.textContent = loadingText;

    return;
  }

  button.classList.remove(loadingClass);
  button.dataset.loading = "false";
  if (disable) button.disabled = false;
  button.removeAttribute("aria-busy");

  if (label) label.textContent = button.dataset.defaultText;
  else button.textContent = button.dataset.defaultText;
}

export function disableButton(button, disabled = true) {
  if (!button) return;
  button.disabled = !!disabled;
}

/* =========================
   Mensajes de estado
========================= */

const MESSAGE_COLORS = {
  success: "#059669",
  info: "#2563eb",
  warning: "#d97706",
  error: "#dc2626",
  neutral: "#6b7280"
};

export function setMessage(element, message = "", type = "error") {
  if (!element) return;

  const resolvedType = MESSAGE_COLORS[type] ? type : "error";
  const cleanMessage = String(message || "");

  element.textContent = cleanMessage;
  element.dataset.type = resolvedType;
  element.hidden = !cleanMessage.trim();

  if (!cleanMessage.trim()) {
    element.style.removeProperty("color");
    element.removeAttribute("role");
    return;
  }

  element.style.color = MESSAGE_COLORS[resolvedType];
  element.setAttribute("role", resolvedType === "error" || resolvedType === "warning" ? "alert" : "status");
}

export function clearMessage(element) {
  setMessage(element, "", "neutral");
}

/* =========================
   Formato numérico
========================= */

export function toNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

export function toFiniteOrNull(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

export function clamp(value, min = 0, max = 100) {
  return Math.min(Math.max(value, min), max);
}

export function round1(value) {
  const num = toNumber(value, 0);
  return Math.round(num * 10) / 10;
}

export function round2(value) {
  const num = toNumber(value, 0);
  return Math.round(num * 100) / 100;
}

export function formatHours(value) {
  const num = round1(value);
  return Number.isInteger(num) ? String(num) : num.toFixed(1);
}

export function formatMinutes(value) {
  const num = toNumber(value, NaN);
  if (!Number.isFinite(num)) return "—";
  return `${Math.round(num)} min`;
}

export function formatPercent(value, decimals = 0) {
  const num = toNumber(value, 0);
  return `${num.toFixed(decimals)}%`;
}

export function formatDurationHuman(value) {
  const total = Math.round(toNumber(value, 0));
  if (!total || total <= 0) return "—";

  const hours = Math.floor(total / 60);
  const minutes = total % 60;

  if (hours > 0 && minutes > 0) return `${hours}h ${minutes}min`;
  if (hours > 0) return `${hours}h`;
  return `${minutes}min`;
}

/* =========================
   Fechas
========================= */

export function formatDate(dateStr, locale = "es-CO") {
  if (!dateStr) return "—";

  const raw = String(dateStr).trim();
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(raw)
    ? `${raw}T00:00:00`
    : raw;

  const date = new Date(normalized);

  if (Number.isNaN(date.getTime())) {
    return raw;
  }

  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric"
  }).format(date);
}

export function formatDateTime(dateStr, locale = "es-CO") {
  if (!dateStr) return "—";

  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) {
    return String(dateStr);
  }

  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

export function formatDateRange(start, end, locale = "es-CO") {
  if (!start && !end) return "—";
  if (start && end) return `${formatDate(start, locale)} → ${formatDate(end, locale)}`;
  if (start) return `Desde ${formatDate(start, locale)}`;
  return `Hasta ${formatDate(end, locale)}`;
}

/* =========================
   Normalizadores
========================= */

export function normalizeStatus(status) {
  const s = String(status || "").trim().toUpperCase();
  if (!s) return "";

  if (s === "ASISTIO" || s === "ASISTIÓ" || s === "PRESENTE") return "ASISTIÓ";
  if (s === "AUSENTE" || s === "NO ASISTIO" || s === "NO ASISTIÓ" || s === "FALTA") return "AUSENTE";
  if (s === "EXCUSADO" || s === "EXCUSADA" || s === "JUSTIFICADO" || s === "JUSTIFICADA") return "EXCUSADO";

  return s;
}

export function normalizeYesNo(value) {
  const s = String(value || "").trim().toUpperCase();
  if (s === "SI") return "Sí";
  if (s === "NO") return "No";
  return safeText(value);
}

export function normalizeDuracionFuente(value = "") {
  const s = String(value || "").trim().toUpperCase();
  if (!s) return "";
  if (s === "REAL") return "Real";
  if (s === "PLAN") return "Planeada";
  if (s === "PLAN_LEGACY") return "Planeada (legacy)";
  if (s === "REAL_RANGO") return "Real por rango";
  if (s === "PLAN_RANGO") return "Planeada por rango";
  return titleCase(s.replaceAll("_", " "));
}

export function titleCase(text = "") {
  return String(text)
    .toLowerCase()
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

/* =========================
   Duración efectiva
========================= */

export function getEffectiveMinutes(row = {}) {
  const duracionEfectivaMin = toFiniteOrNull(row?.duracionEfectivaMin);
  if (duracionEfectivaMin && duracionEfectivaMin > 0) return Math.round(duracionEfectivaMin);

  const duracionRealMin = toFiniteOrNull(row?.duracionRealMin);
  if (duracionRealMin && duracionRealMin > 0) return Math.round(duracionRealMin);

  const duracionMin = toFiniteOrNull(row?.duracionMin);
  if (duracionMin && duracionMin > 0) return Math.round(duracionMin);

  const duracionPlanMin = toFiniteOrNull(row?.duracionPlanMin);
  if (duracionPlanMin && duracionPlanMin > 0) return Math.round(duracionPlanMin);

  return 0;
}

export function getDurationSource(row = {}) {
  if (row?.duracionFuente) return normalizeDuracionFuente(row.duracionFuente);

  if (toNumber(row?.duracionEfectivaMin, 0) > 0) return "Efectiva";
  if (toNumber(row?.duracionRealMin, 0) > 0) return "Real";
  if (toNumber(row?.duracionMin, 0) > 0) return "Planeada";
  if (toNumber(row?.duracionPlanMin, 0) > 0) return "Planeada (legacy)";
  return "";
}

/* =========================
   Progress bar
========================= */

export function setProgress(fillElement, percent = 0) {
  if (!fillElement) return;
  const safePercent = clamp(toNumber(percent, 0), 0, 100);
  fillElement.style.width = `${safePercent}%`;
  fillElement.setAttribute("aria-valuenow", String(Math.round(safePercent)));
}

/* =========================
   Estados vacíos
========================= */

export function renderEmptyRow(message = "No hay datos disponibles.", colspan = 1) {
  return `
    <tr>
      <td colspan="${Number(colspan) || 1}">${escapeHtml(message)}</td>
    </tr>
  `;
}

export function renderEmptyCard({
  title = "Sin información",
  text = "Todavía no hay contenido disponible."
} = {}) {
  return `
    <div class="info-card">
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(text)}</p>
    </div>
  `;
}

export function renderLoadingCard({
  title = "Cargando",
  text = "Estamos preparando la información."
} = {}) {
  return `
    <div class="info-card">
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(text)}</p>
    </div>
  `;
}

/* =========================
   Render helpers HUB
========================= */

export function renderInfoCard({
  title = "Información",
  text = "",
  className = ""
} = {}) {
  return `
    <div class="info-card ${escapeHtml(className)}">
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(text)}</p>
    </div>
  `;
}

export function renderBadge(label = "", variant = "neutral") {
  const safeVariant = String(variant || "neutral").trim().toLowerCase();
  return `
    <span class="ui-badge ui-badge-${escapeHtml(safeVariant)}">
      ${escapeHtml(label || "—")}
    </span>
  `;
}

export function renderKeyValueList(items = []) {
  const html = (items || [])
    .filter((item) => item && item.label)
    .map((item) => {
      return `
        <div class="ui-kv-row">
          <span class="ui-kv-label">${escapeHtml(item.label)}</span>
          <span class="ui-kv-value">${escapeHtml(safeText(item.value, "—"))}</span>
        </div>
      `;
    })
    .join("");

  return html || `
    <div class="ui-kv-row">
      <span class="ui-kv-label">Información</span>
      <span class="ui-kv-value">—</span>
    </div>
  `;
}

export function renderTableRows(rows = [], mapRow, emptyMessage = "No hay datos disponibles.", colspan = 1) {
  if (!Array.isArray(rows) || !rows.length) {
    return renderEmptyRow(emptyMessage, colspan);
  }

  return rows.map((row, index) => mapRow(row, index)).join("");
}

export function renderDefinitionList(items = []) {
  const html = (items || [])
    .filter((item) => item && item.term)
    .map((item) => `
      <div class="ui-def-row">
        <dt class="ui-def-term">${escapeHtml(item.term)}</dt>
        <dd class="ui-def-desc">${escapeHtml(safeText(item.description, "—"))}</dd>
      </div>
    `)
    .join("");

  return html || `
    <div class="ui-def-row">
      <dt class="ui-def-term">Información</dt>
      <dd class="ui-def-desc">—</dd>
    </div>
  `;
}

/* =========================
   Micro utilidades
========================= */

export function debounce(fn, wait = 250) {
  let timer = null;
  return function debounced(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), wait);
  };
}

export function raf(fn) {
  if (typeof requestAnimationFrame === "function") {
    return requestAnimationFrame(fn);
  }
  return setTimeout(fn, 16);
}

export function nextTick(fn) {
  return Promise.resolve().then(fn);
}

export function scrollIntoViewIfNeeded(element, options = { behavior: "smooth", block: "start" }) {
  if (!element?.scrollIntoView) return;
  element.scrollIntoView(options);
}