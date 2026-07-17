import { requireAuth, logoutUser } from "./auth.js";
import { sendEmailVerification } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { fetchHubDataFromFirestore } from "./hub-data.js";

/* =========================
   Helpers DOM
========================= */

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

function getEls() {
  return {
    userEmail: $("#userEmail"),
    logoutBtn: $("#logoutBtn"),

    horasTotales: $("#horasTotales"),
    horasUsadas: $("#horasUsadas"),
    horasPendientes: $("#horasPendientes"),
    vigencia: $("#vigencia"),

    progressFill: $("#progressFill"),
    progressText: $("#progressText"),

    consumoHeroValue: $("#consumoHeroValue"),
    consumoHeroSubtext: $("#consumoHeroSubtext"),
    progressPercentLabel: $("#progressPercentLabel"),
    progressPercentInline: $("#progressPercentInline"),
    consumoMetricUsadas: $("#consumoMetricUsadas"),
    consumoMetricDisponibles: $("#consumoMetricDisponibles"),
    consumoMetricSesiones: $("#consumoMetricSesiones"),
    consumoMetricTalleres: $("#consumoMetricTalleres"),
    consumoMetricParticipantes: $("#consumoMetricParticipantes"),
    consumoMetricVigencia: $("#consumoMetricVigencia"),
    progressNote: $("#progressNote"),

    usageTable: $("#usageTable"),
    infoGrid: $("#infoGrid"),
    termsContainer: $("#termsContainer"),

    infoPanelEmpresa: $("#infoPanelEmpresa"),
    infoPanelBolsa: $("#infoPanelBolsa"),
    infoPanelTalleres: $("#infoPanelTalleres"),
    infoPanelParticipantes: $("#infoPanelParticipantes"),

    toggleHistoryBtn: $("#toggleHistoryBtn"),
    historyCollapse: $("#historyCollapse")
  };
}

let els = getEls();

/* =========================
   State
========================= */

const state = {
  user: null,
  hub: null,
  loading: false,
  usageRows: [],
  infoCards: [],
  infoPanels: {
    empresa: [],
    bolsa: [],
    talleres: [],
    participantes: []
  },
  listenersBound: false
};

/* =========================
   Helpers generales
========================= */

function refreshEls() {
  els = getEls();
  return els;
}

function safeText(value, fallback = "—") {
  if (value === null || value === undefined || value === "") return fallback;
  return String(value);
}

function toNumber(value, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;

  const cleaned = String(value ?? "")
    .trim()
    .replace(/\s+/g, "")
    .replace(",", ".");

  const num = Number(cleaned);
  return Number.isFinite(num) ? num : fallback;
}

function clamp(value, min = 0, max = 100) {
  return Math.min(Math.max(value, min), max);
}

function round1(value) {
  const num = toNumber(value, 0);
  return Math.round(num * 10) / 10;
}

function round2(value) {
  const num = toNumber(value, 0);
  return Math.round(num * 100) / 100;
}

function formatHours(value) {
  const num = round1(value);
  return Number.isInteger(num) ? String(num) : num.toFixed(1);
}

function formatHoursCompact(value) {
  const num = round1(value);
  return `${Number.isInteger(num) ? String(num) : num.toFixed(1)} h`;
}

function formatMinutes(value) {
  const num = Math.round(toNumber(value, 0));
  return String(num);
}

function formatDurationHuman(value) {
  const total = Math.round(toNumber(value, 0));
  if (!total || total <= 0) return "—";

  const hours = Math.floor(total / 60);
  const minutes = total % 60;

  if (hours > 0 && minutes > 0) return `${hours} h ${minutes} min`;
  if (hours > 0) return `${hours} h`;
  return `${minutes} min`;
}

function parseFlexibleDate(value) {
  if (!value) return null;

  const raw = String(value).trim();
  if (!raw) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const d = new Date(`${raw}T00:00:00`);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const dmY = raw.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if (dmY) {
    const [, dd, mm, yyyy] = dmY;
    const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseFlexibleDateTime(dateValue, timeValue = "") {
  const base = parseFlexibleDate(dateValue);
  if (!base) return null;

  const timeInfo = parseTimeValue(timeValue);
  if (!timeInfo) return base;

  base.setHours(timeInfo.hours, timeInfo.minutes, timeInfo.seconds, 0);
  return base;
}

function toIsoDateLocal(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function formatDate(dateStr) {
  if (!dateStr) return "—";

  const date = parseFlexibleDate(dateStr);
  if (!date) return String(dateStr);

  return new Intl.DateTimeFormat("es-CO", {
    year: "numeric",
    month: "short",
    day: "numeric"
  }).format(date);
}

function formatDateTime(dateStr) {
  if (!dateStr) return "—";

  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return String(dateStr);

  return new Intl.DateTimeFormat("es-CO", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

function formatDateRange(start, end) {
  if (!start && !end) return "—";
  if (start && end) return `${formatDate(start)} → ${formatDate(end)}`;
  if (start) return `Desde ${formatDate(start)}`;
  return `Hasta ${formatDate(end)}`;
}

function escapeHtml(text = "") {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeStatus(status) {
  const s = String(status || "").trim().toUpperCase();
  if (!s) return "";

  if (s === "ASISTIO" || s === "ASISTIÓ" || s === "PRESENTE") return "ASISTIÓ";
  if (s === "AUSENTE" || s === "NO ASISTIO" || s === "NO ASISTIÓ" || s === "FALTA") return "AUSENTE";
  if (s === "EXCUSADO" || s === "EXCUSADA" || s === "JUSTIFICADO" || s === "JUSTIFICADA") return "EXCUSADO";

  return s;
}

function titleCase(text = "") {
  return String(text)
    .toLowerCase()
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function joinParts(parts = [], separator = " • ") {
  return parts
    .map((x) => String(x || "").trim())
    .filter(Boolean)
    .join(separator);
}

function statusBadgeLabel(value) {
  const s = String(value || "").trim().toUpperCase();
  if (!s) return "Sin estado";
  if (s === "ACTIVO") return "Activo";
  if (s === "FINALIZADO") return "Finalizado";
  if (s === "PAUSADO") return "Pausado";
  return titleCase(s);
}

function normalizeDuracionFuente(value = "") {
  const s = String(value || "").trim().toUpperCase();
  if (!s) return "";
  if (s === "REAL") return "Real";
  if (s === "PLAN") return "Planeada";
  if (s === "PLAN_LEGACY") return "Planeada (legacy)";
  if (s === "REAL_RANGO") return "Real por rango";
  if (s === "PLAN_RANGO") return "Planeada por rango";
  return titleCase(s.replaceAll("_", " "));
}

function isProbablyExcelTimeSerial(value) {
  const num = toNumber(value, NaN);
  return Number.isFinite(num) && num >= 0 && num < 1;
}

function parseTimeValue(value) {
  if (value === null || value === undefined || value === "") return null;

  const raw = String(value).trim();
  if (!raw) return null;

  const hms = raw.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (hms) {
    return {
      hours: Number(hms[1]),
      minutes: Number(hms[2]),
      seconds: Number(hms[3] || 0)
    };
  }

  const ampm = raw.match(/^(\d{1,2}):(\d{2})\s*(a\.?\s*m\.?|p\.?\s*m\.?)$/i);
  if (ampm) {
    let hours = Number(ampm[1]);
    const minutes = Number(ampm[2]);
    const meridian = ampm[3].toLowerCase().replace(/\s|\./g, "");

    if (meridian === "pm" && hours < 12) hours += 12;
    if (meridian === "am" && hours === 12) hours = 0;

    return { hours, minutes, seconds: 0 };
  }

  if (isProbablyExcelTimeSerial(raw)) {
    const serial = toNumber(raw, 0);
    const totalSeconds = Math.round(serial * 24 * 60 * 60);
    const hours = Math.floor(totalSeconds / 3600) % 24;
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return { hours, minutes, seconds };
  }

  if (/1899/i.test(raw) || /gmt/i.test(raw)) {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) {
      return {
        hours: parsed.getHours(),
        minutes: parsed.getMinutes(),
        seconds: parsed.getSeconds()
      };
    }
  }

  return null;
}

function formatTimeOnly(value) {
  const timeInfo = parseTimeValue(value);
  if (!timeInfo) {
    const raw = String(value || "").trim();
    return raw || "—";
  }

  const temp = new Date();
  temp.setHours(timeInfo.hours, timeInfo.minutes, timeInfo.seconds || 0, 0);

  return new Intl.DateTimeFormat("es-CO", {
    hour: "numeric",
    minute: "2-digit"
  }).format(temp);
}

function getEffectiveMinutes(row = {}) {
  const duracionEfectivaMin = toNumber(row?.duracionEfectivaMin, NaN);
  if (Number.isFinite(duracionEfectivaMin) && duracionEfectivaMin > 0) {
    return duracionEfectivaMin;
  }

  const duracionRealMin = toNumber(row?.duracionRealMin, NaN);
  if (Number.isFinite(duracionRealMin) && duracionRealMin > 0) {
    return duracionRealMin;
  }

  const duracionMin = toNumber(row?.duracionMin, NaN);
  if (Number.isFinite(duracionMin) && duracionMin > 0) {
    return duracionMin;
  }

  const hi = parseTimeValue(row?.horaInicioReal || row?.horaInicio || "");
  const hf = parseTimeValue(row?.horaFinReal || row?.horaFin || "");
  if (hi && hf) {
    const start = hi.hours * 60 + hi.minutes;
    const end = hf.hours * 60 + hf.minutes;
    const diff = end - start;
    if (diff > 0) return diff;
  }

  return 0;
}

function getDuracionFuente(row = {}) {
  if (row?.duracionFuente) return normalizeDuracionFuente(row.duracionFuente);
  if (toNumber(row?.duracionEfectivaMin, 0) > 0) return "Efectiva";
  if (toNumber(row?.duracionRealMin, 0) > 0) return "Real";
  if (toNumber(row?.duracionMin, 0) > 0) return "Planeada";
  return "";
}

function buildScheduleLabel(row = {}) {
  const hiRaw = row?.horaInicioReal || row?.horaInicio || "";
  const hfRaw = row?.horaFinReal || row?.horaFin || "";
  const hi = formatTimeOnly(hiRaw);
  const hf = formatTimeOnly(hfRaw);
  const dm = getEffectiveMinutes(row);

  const hasHi = hi !== "—";
  const hasHf = hf !== "—";

  if (hasHi && hasHf) return `${hi} - ${hf}`;
  if (dm > 0) return formatDurationHuman(dm);
  if (hasHi) return hi;
  return "—";
}

function buildDurationDetail(row = {}) {
  const dm = getEffectiveMinutes(row);
  const fuente = getDuracionFuente(row);

  if (dm <= 0) return "";

  return joinParts([
    `Duración: ${formatDurationHuman(dm)}`,
    fuente ? `Fuente: ${fuente}` : ""
  ], " • ");
}

function buildTimeRangeDetail(row = {}) {
  const hiRaw = row?.horaInicioReal || row?.horaInicio || "";
  const hfRaw = row?.horaFinReal || row?.horaFin || "";
  const hi = formatTimeOnly(hiRaw);
  const hf = formatTimeOnly(hfRaw);

  if (hi !== "—" && hf !== "—") return `${hi} - ${hf}`;
  if (hi !== "—") return hi;
  return "";
}

function buildPanelCardHtml(title, content) {
  return `
    <div class="info-panel-card">
      <h3>${escapeHtml(safeText(title, "Información"))}</h3>
      <p>${escapeHtml(safeText(content, "Sin detalle disponible."))}</p>
    </div>
  `;
}

/* =========================
   Vigencia fija del año actual
========================= */

function getFixedVigenciaFromData(data = {}) {
  const talleres = Array.isArray(data?.talleres) ? data.talleres : [];
  const sesiones = Array.isArray(data?.sesiones) ? data.sesiones : [];
  const resumen = data?.resumen || {};

  const candidates = [
    ...talleres.map((t) => t?.fechaInicio),
    ...sesiones.map((s) => s?.fecha),
    resumen?.vigenciaInicio,
    resumen?.ultimaSesionFecha,
    resumen?.proximaSesionFecha
  ]
    .map(parseFlexibleDate)
    .filter(Boolean)
    .sort((a, b) => a.getTime() - b.getTime());

  if (!candidates.length) {
    return { inicio: "", fin: "" };
  }

  const inicio = candidates[0];
  const currentYear = new Date().getFullYear();
  const fin = new Date(currentYear, 11, 31);

  return {
    inicio: toIsoDateLocal(inicio),
    fin: toIsoDateLocal(fin)
  };
}

/* =========================
   API
========================= */

// Los datos ahora vienen directo de Firestore (mismo proyecto que Asistencia
// Spaces). Ver hub-data.js: resuelve el clienteId vía portalUsers/{correo} y
// arma el mismo shape que este archivo siempre ha renderizado.
async function fetchHubData(user) {
  return fetchHubDataFromFirestore(user);
}

/* =========================
   UI base
========================= */

function setText(el, value, fallback = "—") {
  if (!el) return;
  el.textContent = safeText(value, fallback);
}

function setHTML(el, html) {
  if (!el) return;
  el.innerHTML = html;
}

function setUserEmail(email) {
  refreshEls();
  setText(els.userEmail, email, "Sin correo");
}

function setProgress(progress = 0) {
  refreshEls();

  const safeProgress = clamp(toNumber(progress, 0), 0, 100);

  if (els.progressFill) {
    els.progressFill.style.width = `${safeProgress}%`;
  }

  const progressbar = els.progressFill?.parentElement;
  if (progressbar) {
    progressbar.setAttribute("aria-valuenow", String(Math.round(safeProgress)));
  }

  setText(els.progressPercentLabel, `${Math.round(safeProgress)}%`);
  setText(els.progressPercentInline, `Consumo actual: ${Math.round(safeProgress)}%`);
}

function setLoadingState(isLoading) {
  refreshEls();

  state.loading = Boolean(isLoading);

  if (els.logoutBtn) {
    els.logoutBtn.disabled = state.loading;
  }

  if (state.loading && !state.hub) {
    setText(els.progressText, "Cargando información del servicio...");
    setText(els.consumoHeroValue, "Cargando...");
    setText(els.consumoHeroSubtext, "Preparando el resumen general del paquete.");
    setHTML(els.usageTable, `
      <tr>
        <td colspan="4">Cargando historial...</td>
      </tr>
    `);
  }
}

function renderEmptySummary(message = "Aún no hay información disponible.") {
  refreshEls();

  setText(els.horasTotales, "0");
  setText(els.horasUsadas, "0");
  setText(els.horasPendientes, "0");
  setText(els.vigencia, "—");

  setProgress(0);

  setText(els.consumoHeroValue, "Sin datos");
  setText(els.consumoHeroSubtext, "Todavía no hay suficiente información para calcular el estado del paquete.");
  setText(els.consumoMetricUsadas, "0 h");
  setText(els.consumoMetricDisponibles, "0 h");
  setText(els.consumoMetricSesiones, "0");
  setText(els.consumoMetricTalleres, "0");
  setText(els.consumoMetricParticipantes, "0");
  setText(els.consumoMetricVigencia, "—");
  setText(els.progressNote, "Cuando existan sesiones, talleres o horas cargadas, aquí verás un resumen rápido del servicio.");
  setText(els.progressText, message);
}

/* =========================
   Summary empresarial
========================= */

function renderSummaryFromHub(data = {}) {
  refreshEls();

  const resumen = data?.resumen || {};
  const empresa = data?.empresa || {};

  const horasCompradas = toNumber(resumen.horasCompradas, 0);
  const horasUsadas = toNumber(resumen.horasUsadas, 0);
  const horasPendientes = toNumber(resumen.horasPendientes, 0);
  const horasExcedidas = toNumber(resumen.horasExcedidas, 0);
  const minutosConsumidos = toNumber(resumen.minutosConsumidos, 0);
  const porcentajeConsumoRaw = toNumber(resumen.porcentajeConsumo, 0);
  const porcentajeConsumo = clamp(porcentajeConsumoRaw, 0, 999);
  const totalTalleres = toNumber(resumen.totalTalleres, 0);
  const talleresActivos = toNumber(resumen.talleresActivos, 0);
  const totalParticipantes = toNumber(resumen.totalParticipantes, 0);
  const participantesActivos = toNumber(resumen.participantesActivos, 0);
  const totalSesiones = toNumber(resumen.totalSesiones, 0);
  const porcentajeAsistencia = toNumber(resumen.porcentajeAsistencia, 0);

  const vigenciaCalculada = getFixedVigenciaFromData(data);
  const vigenciaTexto = formatDateRange(
    vigenciaCalculada.inicio,
    vigenciaCalculada.fin
  );

  setText(els.horasTotales, formatHours(horasCompradas));
  setText(els.horasUsadas, formatHours(horasUsadas));
  setText(els.horasPendientes, formatHours(horasPendientes));

  setText(
    els.vigencia,
    vigenciaTexto !== "—"
      ? vigenciaTexto
      : (empresa?.empresaNombre ? "Servicio sin vigencia definida" : "—")
  );

  setProgress(clamp(porcentajeConsumo, 0, 100));

  if (horasCompradas > 0) {
    setText(
      els.consumoHeroValue,
      `${formatHours(horasUsadas)} h de ${formatHours(horasCompradas)} h`
    );
    setText(
      els.consumoHeroSubtext,
      `${Math.round(clamp(porcentajeConsumo, 0, 100))}% del paquete utilizado hasta ahora.`
    );
  } else if (horasUsadas > 0) {
    setText(els.consumoHeroValue, `${formatHours(horasUsadas)} h registradas`);
    setText(
      els.consumoHeroSubtext,
      "Hay consumo registrado, pero el total contratado no está definido correctamente en el resumen."
    );
  } else {
    setText(els.consumoHeroValue, "Sin consumo registrado");
    setText(
      els.consumoHeroSubtext,
      "Todavía no aparecen horas usadas para este servicio."
    );
  }

  setText(els.consumoMetricUsadas, formatHoursCompact(horasUsadas));
  setText(els.consumoMetricDisponibles, formatHoursCompact(horasPendientes));
  setText(els.consumoMetricSesiones, String(totalSesiones));
  setText(els.consumoMetricTalleres, String(totalTalleres));
  setText(els.consumoMetricParticipantes, String(participantesActivos || totalParticipantes));
  setText(els.consumoMetricVigencia, vigenciaTexto);

  const noteParts = [
    empresa?.empresaNombre ? `Empresa: ${empresa.empresaNombre}` : "",
    totalTalleres > 0 ? `${talleresActivos} talleres activos de ${totalTalleres}` : "",
    totalParticipantes > 0 ? `${participantesActivos || totalParticipantes} participantes vinculados` : "",
    totalSesiones > 0 ? `${totalSesiones} sesiones registradas` : ""
  ].filter(Boolean);

  setText(
    els.progressNote,
    noteParts.length
      ? joinParts(noteParts)
      : "Este resumen te ayuda a ver el estado del paquete sin revisar tablas ni reportes completos."
  );

  if (horasCompradas > 0 || horasUsadas > 0 || totalSesiones > 0 || totalTalleres > 0) {
    setText(
      els.progressText,
      joinParts([
        empresa?.empresaNombre ? `Empresa: ${empresa.empresaNombre}` : "",
        `Horas compradas: ${formatHours(horasCompradas)}`,
        `Horas usadas: ${formatHours(horasUsadas)}`,
        `Disponibles: ${formatHours(horasPendientes)}`,
        horasExcedidas > 0 ? `Excedidas: ${formatHours(horasExcedidas)}` : "",
        `Minutos consumidos: ${formatMinutes(minutosConsumidos)}`,
        `Sesiones: ${totalSesiones}`,
        `Talleres: ${totalTalleres}`,
        `Activos: ${talleresActivos}`,
        `Participantes: ${totalParticipantes}`,
        `Participantes activos: ${participantesActivos}`,
        `Asistencia: ${Math.round(porcentajeAsistencia)}%`,
        `Consumo: ${Math.round(porcentajeConsumoRaw)}%`
      ])
    );
  } else {
    setText(
      els.progressText,
      "Todavía no hay horas asignadas ni sesiones registradas para esta empresa."
    );
  }
}

/* =========================
   Tabla / historial
========================= */

function sortRowsByFechaDesc(rows = []) {
  return [...rows].sort((a, b) => {
    const db = parseFlexibleDateTime(
      b?.fecha || b?.fechaOrden || b?.markedAt || "",
      b?.horaInicioReal || b?.horaInicio || b?.hora || ""
    );
    const da = parseFlexibleDateTime(
      a?.fecha || a?.fechaOrden || a?.markedAt || "",
      a?.horaInicioReal || a?.horaInicio || a?.hora || ""
    );

    const tb = db ? db.getTime() : 0;
    const ta = da ? da.getTime() : 0;

    return tb - ta;
  });
}

function buildUsageRowsFromHub(data = {}) {
  const historial = Array.isArray(data?.historialReciente) ? data.historialReciente : [];
  if (historial.length) return sortRowsByFechaDesc(historial);

  const asistencias = Array.isArray(data?.asistencias) ? data.asistencias : [];
  const sesiones = Array.isArray(data?.sesiones) ? data.sesiones : [];

  if (asistencias.length) {
    return sortRowsByFechaDesc(asistencias);
  }

  return sortRowsByFechaDesc(sesiones);
}

function renderUsageRows(rows = []) {
  refreshEls();

  if (!els.usageTable) return;

  state.usageRows = Array.isArray(rows) ? rows : [];

  if (!rows.length) {
    els.usageTable.innerHTML = `
      <tr>
        <td colspan="4">Todavía no hay registros visibles del servicio.</td>
      </tr>
    `;
    return;
  }

  els.usageTable.innerHTML = rows
    .map((row) => {
      const isHistorialItem = Boolean(row?.tipo);
      const fecha = row?.fecha || row?.markedAt || "";
      const tipo = String(row?.tipo || "").trim().toLowerCase();

      let col2 = "Registro";
      let col3 = "—";
      let col4 = "Sin detalle";

      if (isHistorialItem) {
        col2 = safeText(row?.titulo, "Movimiento");
        col3 = safeText(row?.subtitulo || row?.hora || "—");
        col4 = safeText(row?.detalle, "Sin detalle");
      } else if (row?.estado || row?.estadoNormalizado) {
        const estado = normalizeStatus(row.estado || row.estadoNormalizado || "");
        col2 = estado || safeText(row?.tallerNombre, "Asistencia");
        col3 = safeText(
          row?.participanteNombre || buildScheduleLabel(row),
          "—"
        );

        const timeRange = buildTimeRangeDetail(row);
        const detalleParts = [
          row?.tallerNombre ? `Taller: ${row.tallerNombre}` : "",
          row?.tema ? `Tema: ${row.tema}` : "",
          timeRange ? `Horario: ${timeRange}` : "",
          buildDurationDetail(row),
          row?.nota ? `Nota: ${row.nota}` : "",
          row?.sede ? `Sede: ${row.sede}` : "",
          row?.facilitador ? `Facilitador: ${row.facilitador}` : "",
          row?.markedAt ? `Marcado: ${formatDateTime(row.markedAt)}` : ""
        ].filter(Boolean);

        col4 = safeText(detalleParts.join(" • "), "Sin detalle");
      } else {
        col2 = safeText(row?.tema || row?.tallerNombre || "Sesión");
        col3 = buildScheduleLabel(row);

        const timeRange = buildTimeRangeDetail(row);
        const detalleParts = [
          row?.tallerNombre ? `Taller: ${row.tallerNombre}` : "",
          timeRange ? `Horario: ${timeRange}` : "",
          buildDurationDetail(row),
          row?.sede ? `Sede: ${row.sede}` : "",
          row?.facilitador ? `Facilitador: ${row.facilitador}` : "",
          row?.observaciones ? `Obs: ${row.observaciones}` : ""
        ].filter(Boolean);

        col4 = safeText(detalleParts.join(" • "), "Sin detalle");
      }

      return `
        <tr data-kind="${escapeHtml(tipo || "row")}">
          <td>${escapeHtml(formatDate(fecha))}</td>
          <td>${escapeHtml(col2)}</td>
          <td>${escapeHtml(col3)}</td>
          <td>${escapeHtml(col4)}</td>
        </tr>
      `;
    })
    .join("");
}

/* =========================
   Tarjetas info
========================= */

function buildInfoCardsFromHub(data = {}) {
  const cards = [];

  const empresa = data?.empresa || null;
  const talleres = Array.isArray(data?.talleres) ? data.talleres : [];
  const participantes = Array.isArray(data?.participantes) ? data.participantes : [];
  const resumen = data?.resumen || {};
  const sesiones = Array.isArray(data?.sesiones) ? data.sesiones : [];
  const vigenciaCalculada = getFixedVigenciaFromData(data);

  if (empresa) {
    cards.push({
      titulo: "Empresa cliente",
      contenido: joinParts([
        empresa.empresaNombre ? `${empresa.empresaNombre}` : "",
        empresa.contactoNombre ? `Contacto: ${empresa.contactoNombre}` : "",
        empresa.contactoTelefono ? `Tel: ${empresa.contactoTelefono}` : "",
        empresa.contactoEmail ? `Correo: ${empresa.contactoEmail}` : ""
      ])
    });
  }

  cards.push({
    titulo: "Bolsa de horas",
    contenido: joinParts([
      `Horas compradas: ${formatHours(resumen.horasCompradas)}`,
      `Horas usadas: ${formatHours(resumen.horasUsadas)}`,
      `Disponibles: ${formatHours(resumen.horasPendientes)}`,
      toNumber(resumen.horasExcedidas, 0) > 0
        ? `Excedidas: ${formatHours(resumen.horasExcedidas)}`
        : "",
      `Consumo: ${Math.round(toNumber(resumen.porcentajeConsumo, 0))}%`,
      `Minutos registrados: ${formatMinutes(resumen.minutosConsumidos)}`
    ])
  });

  if (talleres.length) {
    const activos = talleres.filter((t) => String(t?.estado || "").toUpperCase() === "ACTIVO");
    const topTalleres = talleres.slice(0, 3);

    cards.push({
      titulo: "Talleres vinculados",
      contenido: joinParts([
        `Total: ${talleres.length}`,
        `Activos: ${activos.length}`,
        ...topTalleres.map((t) => {
          const nombre = safeText(t?.tallerNombre, "Taller");
          const estado = statusBadgeLabel(t?.estado);
          const fechas = formatDateRange(t?.fechaInicio, t?.fechaFin);
          return `${nombre} (${estado}${fechas !== "—" ? `, ${fechas}` : ""})`;
        })
      ])
    });
  }

  if (participantes.length) {
    const activos = participantes.filter((p) => String(p?.activo || "").toUpperCase() === "SI");
    const areas = Array.from(
      new Set(
        participantes
          .map((p) => String(p?.empresaInternaArea || "").trim())
          .filter(Boolean)
      )
    ).slice(0, 4);

    cards.push({
      titulo: "Participantes",
      contenido: joinParts([
        `Registrados: ${participantes.length}`,
        `Activos: ${activos.length}`,
        areas.length ? `Áreas: ${areas.join(", ")}` : "",
        participantes[0]?.nombreCompleto ? `Ejemplo: ${participantes[0].nombreCompleto}` : ""
      ])
    });
  }

  if (sesiones.length || resumen?.ultimaSesionFecha || resumen?.proximaSesionFecha) {
    const ultimaSesion = sesiones[0] || {};
    const ultimaDuracion = getEffectiveMinutes(ultimaSesion);
    const ultimaFuente = getDuracionFuente(ultimaSesion);

    cards.push({
      titulo: "Calendario del servicio",
      contenido: joinParts([
        vigenciaCalculada.inicio || vigenciaCalculada.fin
          ? `Vigencia: ${formatDateRange(vigenciaCalculada.inicio, vigenciaCalculada.fin)}`
          : "",
        resumen?.ultimaSesionFecha ? `Última sesión: ${formatDate(resumen.ultimaSesionFecha)}` : "",
        resumen?.proximaSesionFecha ? `Próxima sesión: ${formatDate(resumen.proximaSesionFecha)}` : "",
        ultimaDuracion > 0
          ? `Última duración registrada: ${formatDurationHuman(ultimaDuracion)}`
          : "",
        ultimaFuente ? `Fuente duración: ${ultimaFuente}` : ""
      ])
    });
  }

  const pagosResumen = Array.isArray(data?.pagos) ? data.pagos : [];
  if (pagosResumen.length) {
    const totalPagado = pagosResumen.reduce((a, p) => a + toNumber(p.monto, 0), 0);
    cards.push({
      titulo: "Pagos",
      contenido: joinParts([
        `Total pagado: $${Math.round(totalPagado).toLocaleString("es-CO")}`,
        `Pagos registrados: ${pagosResumen.length}`,
        pagosResumen[0]?.fecha ? `Último pago: ${formatDate(pagosResumen[0].fecha)}` : ""
      ])
    });
  }

  const totalSesiones = toNumber(resumen.totalSesiones, 0);
  if (totalSesiones > 0) {
    const promedioMin = round1(
      toNumber(resumen.minutosConsumidos, 0) / Math.max(totalSesiones, 1)
    );

    cards.push({
      titulo: "Uso del servicio",
      contenido: joinParts([
        `Sesiones registradas: ${totalSesiones}`,
        `Tiempo promedio por sesión: ${formatDurationHuman(promedioMin)}`,
        `Asistencia marcada: ${toNumber(resumen.porcentajeAsistencia, 0)}%`
      ])
    });
  }

  return cards;
}

function buildInfoPanelsFromHub(data = {}) {
  const empresa = data?.empresa || {};
  const talleres = Array.isArray(data?.talleres) ? data.talleres : [];
  const participantes = Array.isArray(data?.participantes) ? data.participantes : [];
  const resumen = data?.resumen || {};
  const sesiones = Array.isArray(data?.sesiones) ? data.sesiones : [];
  const vigenciaCalculada = getFixedVigenciaFromData(data);

  const activosTalleres = talleres.filter((t) => String(t?.estado || "").toUpperCase() === "ACTIVO");
  const activosParticipantes = participantes.filter((p) => String(p?.activo || "").toUpperCase() === "SI");

  const empresaCards = [
    {
      titulo: "Empresa cliente",
      contenido: joinParts([
        empresa.empresaNombre ? `Nombre: ${empresa.empresaNombre}` : "",
        empresa.contactoNombre ? `Contacto principal: ${empresa.contactoNombre}` : "",
        empresa.contactoTelefono ? `Teléfono: ${empresa.contactoTelefono}` : "",
        empresa.contactoEmail ? `Correo: ${empresa.contactoEmail}` : ""
      ])
    }
  ];

  const bolsaCards = [
    {
      titulo: "Estado de la bolsa",
      contenido: joinParts([
        `Horas compradas: ${formatHours(resumen.horasCompradas)}`,
        `Horas usadas: ${formatHours(resumen.horasUsadas)}`,
        `Horas disponibles: ${formatHours(resumen.horasPendientes)}`,
        toNumber(resumen.horasExcedidas, 0) > 0 ? `Horas excedidas: ${formatHours(resumen.horasExcedidas)}` : "",
        `Consumo actual: ${Math.round(toNumber(resumen.porcentajeConsumo, 0))}%`,
        `Minutos registrados: ${formatMinutes(resumen.minutosConsumidos)}`
      ])
    },
    {
      titulo: "Vigencia del servicio",
      contenido: joinParts([
        vigenciaCalculada.inicio || vigenciaCalculada.fin
          ? `Vigencia general: ${formatDateRange(vigenciaCalculada.inicio, vigenciaCalculada.fin)}`
          : "",
        resumen?.ultimaSesionFecha ? `Última sesión: ${formatDate(resumen.ultimaSesionFecha)}` : "",
        resumen?.proximaSesionFecha ? `Próxima sesión: ${formatDate(resumen.proximaSesionFecha)}` : ""
      ]) || "No hay vigencia consolidada disponible todavía."
    }
  ];

  const pagosList = Array.isArray(data?.pagos) ? data.pagos : [];
  if (pagosList.length) {
    const totalPagado = pagosList.reduce((a, p) => a + toNumber(p.monto, 0), 0);
    const money = (n) => `$${Math.round(toNumber(n, 0)).toLocaleString("es-CO")}`;
    bolsaCards.push({
      titulo: "Pagos registrados",
      contenido: joinParts([
        `Total pagado: ${money(totalPagado)}`,
        `Pagos: ${pagosList.length}`,
        ...pagosList.slice(0, 6).map((p) =>
          `${formatDate(p.fecha)}: ${money(p.monto)}${p.concepto ? ` (${p.concepto})` : ""}${p.metodo ? ` · ${p.metodo}` : ""}`)
      ])
    });
  }

  const talleresCards = talleres.length
    ? [
        {
          titulo: "Resumen de talleres",
          contenido: joinParts([
            `Total vinculados: ${talleres.length}`,
            `Activos: ${activosTalleres.length}`,
            `Finalizados o en otro estado: ${Math.max(talleres.length - activosTalleres.length, 0)}`
          ])
        },
        ...talleres.slice(0, 6).map((taller) => ({
          titulo: safeText(taller?.tallerNombre, "Taller"),
          contenido: joinParts([
            `Estado: ${statusBadgeLabel(taller?.estado)}`,
            `Fechas: ${formatDateRange(taller?.fechaInicio, taller?.fechaFin)}`,
            taller?.sede ? `Sede: ${taller.sede}` : "",
            taller?.facilitador ? `Facilitador: ${taller.facilitador}` : ""
          ])
        }))
      ]
    : [
        {
          titulo: "Sin talleres vinculados",
          contenido: "Todavía no hay talleres registrados para esta empresa."
        }
      ];

  const areas = Array.from(
    new Set(
      participantes
        .map((p) => String(p?.empresaInternaArea || "").trim())
        .filter(Boolean)
    )
  );

  const participantesCards = participantes.length
    ? [
        {
          titulo: "Resumen de participantes",
          contenido: joinParts([
            `Registrados: ${participantes.length}`,
            `Activos: ${activosParticipantes.length}`,
            areas.length ? `Áreas: ${areas.join(", ")}` : "",
            sesiones.length ? `Sesiones disponibles para cruce: ${sesiones.length}` : ""
          ])
        },
        ...participantes.slice(0, 8).map((p) => ({
          titulo: safeText(p?.nombreCompleto || p?.participanteNombre, "Participante"),
          contenido: joinParts([
            p?.activo ? `Activo: ${String(p.activo).toUpperCase() === "SI" ? "Sí" : safeText(p.activo)}` : "",
            p?.empresaInternaArea ? `Área: ${p.empresaInternaArea}` : "",
            p?.correo ? `Correo: ${p.correo}` : "",
            p?.telefono ? `Teléfono: ${p.telefono}` : ""
          ])
        }))
      ]
    : [
        {
          titulo: "Sin participantes vinculados",
          contenido: "Todavía no hay participantes registrados para esta empresa."
        }
      ];

  return {
    empresa: empresaCards.filter(Boolean),
    bolsa: bolsaCards.filter(Boolean),
    talleres: talleresCards.filter(Boolean),
    participantes: participantesCards.filter(Boolean)
  };
}

function renderInfoCards(items = []) {
  refreshEls();

  if (!els.infoGrid) return;

  state.infoCards = Array.isArray(items) ? items : [];

  if (!items.length) {
    els.infoGrid.innerHTML = `
      <div class="info-card">
        <h3>Información próximamente</h3>
        <p>Pronto verás aquí detalles útiles del servicio contratado en Spaces.</p>
      </div>
    `;
    return;
  }

  els.infoGrid.innerHTML = items
    .map((item) => {
      return `
        <div class="info-card">
          <h3>${escapeHtml(safeText(item.titulo, "Información"))}</h3>
          <p>${escapeHtml(safeText(item.contenido, ""))}</p>
        </div>
      `;
    })
    .join("");
}

function renderInfoPanels(panels = {}) {
  refreshEls();

  state.infoPanels = {
    empresa: Array.isArray(panels?.empresa) ? panels.empresa : [],
    bolsa: Array.isArray(panels?.bolsa) ? panels.bolsa : [],
    talleres: Array.isArray(panels?.talleres) ? panels.talleres : [],
    participantes: Array.isArray(panels?.participantes) ? panels.participantes : []
  };

  const panelMap = [
    { el: els.infoPanelEmpresa, items: state.infoPanels.empresa, emptyTitle: "Empresa", emptyText: "No hay información de empresa disponible." },
    { el: els.infoPanelBolsa, items: state.infoPanels.bolsa, emptyTitle: "Bolsa de horas", emptyText: "No hay información de bolsa disponible." },
    { el: els.infoPanelTalleres, items: state.infoPanels.talleres, emptyTitle: "Talleres", emptyText: "No hay información de talleres disponible." },
    { el: els.infoPanelParticipantes, items: state.infoPanels.participantes, emptyTitle: "Participantes", emptyText: "No hay información de participantes disponible." }
  ];

  panelMap.forEach(({ el, items, emptyTitle, emptyText }) => {
    if (!el) return;

    if (!items.length) {
      el.innerHTML = buildPanelCardHtml(emptyTitle, emptyText);
      return;
    }

    el.innerHTML = items
      .map((item) => buildPanelCardHtml(item.titulo, item.contenido))
      .join("");
  });
}

/* =========================
   Terms
========================= */

async function loadTermsHtml() {
  refreshEls();

  if (!els.termsContainer) return;

  try {
    const response = await fetch("./data/terms.html", { cache: "no-store" });

    if (!response.ok) {
      throw new Error(`No se pudo cargar terms.html (${response.status})`);
    }

    const html = await response.text();
    els.termsContainer.innerHTML = html && html.trim()
      ? html
      : "Aún no fue posible cargar los términos y condiciones.";
  } catch (error) {
    console.warn("No se pudieron cargar los términos:", error);
    els.termsContainer.textContent =
      "Aún no fue posible cargar los términos y condiciones.";
  }
}

/* =========================
   Load hub
========================= */

async function renderVerifyEmailNotice(user) {
  renderEmptySummary("Debes verificar tu correo para ver la información de tu servicio.");
  renderUsageRows([]);

  let enviado = false;
  try {
    if (!sessionStorage.getItem("spacesVerifSent")) {
      await sendEmailVerification(user);
      sessionStorage.setItem("spacesVerifSent", "1");
      enviado = true;
    }
  } catch (error) {
    console.warn("No se pudo enviar el correo de verificación:", error);
  }

  const instrucciones = enviado
    ? `Te enviamos un correo de verificación a ${user?.email || "tu correo"}. Ábrelo, toca el enlace y vuelve a entrar al portal.`
    : `Revisa tu bandeja (y spam) en ${user?.email || "tu correo"} por el enlace de verificación. Si no llega, cierra sesión y vuelve a entrar para reenviarlo.`;

  renderInfoCards([{ titulo: "Verifica tu correo", contenido: instrucciones }]);
  renderInfoPanels({
    empresa: [{ titulo: "Verifica tu correo", contenido: instrucciones }],
    bolsa: [], talleres: [], participantes: []
  });
}

async function loadHubData(user) {
  try {
    state.user = user || null;
    setUserEmail(user?.email || "Sin correo");
    setLoadingState(true);

    if (user && !user.emailVerified) {
      await renderVerifyEmailNotice(user);
      return;
    }

    const data = await fetchHubData(user);
    state.hub = data;

    if (!data?.found) {
      renderEmptySummary(
        data?.message || "No encontramos información asociada a este correo."
      );
      renderUsageRows([]);
      renderInfoCards([
        {
          titulo: "Sin empresa vinculada",
          contenido:
            "Este correo todavía no tiene un espacio autorizado en el portal. El equipo de Musicala puede activarlo desde Asistencia Spaces (botón “Acceso al portal” en la ficha del cliente)."
        }
      ]);
      renderInfoPanels({
        empresa: [{
          titulo: "Sin empresa vinculada",
          contenido: "No se encontró una empresa asociada al correo autenticado."
        }],
        bolsa: [],
        talleres: [],
        participantes: []
      });
      return;
    }

    renderSummaryFromHub(data);

    const usageRows = buildUsageRowsFromHub(data);
    renderUsageRows(usageRows);

    const infoCards = buildInfoCardsFromHub(data);
    renderInfoCards(infoCards);

    const infoPanels = buildInfoPanelsFromHub(data);
    renderInfoPanels(infoPanels);
  } catch (error) {
    console.error("Error cargando el HUB:", error);

    renderEmptySummary(
      "No fue posible cargar toda la información del servicio en este momento."
    );
    renderUsageRows([]);
    renderInfoCards([
      {
        titulo: "Sin conexión de datos",
        contenido:
          "No se logró consultar la base de datos de Spaces. Revisa tu conexión a internet e intenta de nuevo; si el problema continúa, escríbenos."
      }
    ]);
    renderInfoPanels({
      empresa: [{
        titulo: "Sin conexión de datos",
        contenido: "No se logró consultar la información específica de empresa."
      }],
      bolsa: [{
        titulo: "Sin conexión de datos",
        contenido: "No fue posible consultar el estado de la bolsa de horas."
      }],
      talleres: [{
        titulo: "Sin conexión de datos",
        contenido: "No fue posible consultar los talleres vinculados."
      }],
      participantes: [{
        titulo: "Sin conexión de datos",
        contenido: "No fue posible consultar los participantes vinculados."
      }]
    });
  } finally {
    setLoadingState(false);
    await loadTermsHtml();
  }
}

/* =========================
   Logout
========================= */

async function handleLogout() {
  refreshEls();

  try {
    if (els.logoutBtn) {
      els.logoutBtn.disabled = true;
      els.logoutBtn.textContent = "Cerrando...";
    }

    await logoutUser();
    window.location.replace("./index.html");
  } catch (error) {
    console.error("Error al cerrar sesión:", error);

    if (els.logoutBtn) {
      els.logoutBtn.disabled = false;
      els.logoutBtn.textContent = "Cerrar sesión";
    }

    alert("No fue posible cerrar sesión. Intenta nuevamente.");
  }
}

/* =========================
   Refresh manual
========================= */

function handleKeyRefresh(event) {
  const key = String(event?.key || "").toLowerCase();
  const isReloadKey = key === "r";
  const withCmdCtrl = event?.metaKey || event?.ctrlKey;

  if (!withCmdCtrl || !isReloadKey) return;
  if (!state.user || state.loading) return;

  event.preventDefault();
  loadHubData(state.user);
}

/* =========================
   UI interactions
========================= */

function ensureHistoryInitialState() {
  refreshEls();

  if (!els.historyCollapse || !els.toggleHistoryBtn) return;

  els.historyCollapse.classList.remove("is-open");
  els.historyCollapse.setAttribute("aria-hidden", "true");
  els.toggleHistoryBtn.setAttribute("aria-expanded", "false");
  els.toggleHistoryBtn.textContent = "Ver historial completo";
}

function toggleHistoryVisibility(forceOpen = null) {
  refreshEls();

  const button = els.toggleHistoryBtn;
  const panel = els.historyCollapse;

  if (!button || !panel) {
    console.warn("No se encontró el botón o el contenedor del historial.");
    return;
  }

  const shouldOpen = typeof forceOpen === "boolean"
    ? forceOpen
    : !panel.classList.contains("is-open");

  panel.classList.toggle("is-open", shouldOpen);
  panel.hidden = !shouldOpen;
  panel.setAttribute("aria-hidden", String(!shouldOpen));
  button.setAttribute("aria-expanded", String(shouldOpen));
  button.textContent = shouldOpen ? "Ocultar historial" : "Ver historial completo";
}

function setupHistoryToggle() {
  ensureHistoryInitialState();
}

function activateInfoTab(targetId) {
  const tabButtons = $$("[data-tab-group='info']");
  const tabPanels = $$("#infoPanelResumen, #infoPanelEmpresa, #infoPanelBolsa, #infoPanelTalleres, #infoPanelParticipantes");

  if (!tabButtons.length || !tabPanels.length || !targetId) return;

  tabButtons.forEach((btn) => {
    const isTarget = btn.getAttribute("data-tab-target") === targetId;
    btn.classList.toggle("is-active", isTarget);
    btn.setAttribute("aria-selected", String(isTarget));
  });

  tabPanels.forEach((panel) => {
    panel.classList.toggle("is-active", panel.id === targetId);
  });
}

function setupInfoTabs() {
  const firstActive = document.querySelector("[data-tab-group='info'].is-active");
  const firstTarget = firstActive?.getAttribute("data-tab-target") || "infoPanelResumen";
  activateInfoTab(firstTarget);
}

function handleDocumentClick(event) {
  const historyBtn = event.target.closest("#toggleHistoryBtn");
  if (historyBtn) {
    event.preventDefault();
    toggleHistoryVisibility();
    return;
  }

  const tabBtn = event.target.closest("[data-tab-group='info']");
  if (tabBtn) {
    const targetId = tabBtn.getAttribute("data-tab-target");
    if (!targetId) return;
    event.preventDefault();
    activateInfoTab(targetId);
  }
}

/* =========================
   Init
========================= */

function bindEvents() {
  if (state.listenersBound) return;

  document.addEventListener("click", handleDocumentClick);
  window.addEventListener("keydown", handleKeyRefresh);
  els.logoutBtn?.addEventListener("click", handleLogout);

  state.listenersBound = true;
}

function initUI() {
  refreshEls();
  setupHistoryToggle();
  setupInfoTabs();
}

function init() {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      refreshEls();
      bindEvents();
      initUI();

      requireAuth({
        onAuthenticated: (user) => {
          loadHubData(user);
        },
        redirectTo: "./index.html"
      });
    }, { once: true });
    return;
  }

  refreshEls();
  bindEvents();
  initUI();

  requireAuth({
    onAuthenticated: (user) => {
      loadHubData(user);
    },
    redirectTo: "./index.html"
  });
}

init();