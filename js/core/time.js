/* core/time.js — Asistencia Spaces (Firebase edition)
   Matemática de tiempo/minutos. Pura, sin dependencias, fácil de testear.
   Reglas de cálculo de consumo viven aquí (gracia + redondeo).
*/

// "HH:MM" (24h) -> minutos desde medianoche. null si inválido.
export function hhmmToMin(hhmm) {
  const s = String(hhmm || "").trim();
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}

// minutos -> "HH:MM"
export function minToHHMM(min) {
  const m = Number(min);
  if (!Number.isFinite(m) || m < 0) return "";
  const hh = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

// Duración en minutos entre dos "HH:MM". No cruza medianoche.
// Devuelve null si inválido o fin <= inicio.
export function duracionMin(horaInicio, horaFin) {
  const a = hhmmToMin(horaInicio);
  const b = hhmmToMin(horaFin);
  if (a === null || b === null) return null;
  const d = b - a;
  return d > 0 ? d : null;
}

// minutos -> "1h 30m" / "45m"
export function fmtHM(min) {
  const m = Number(min);
  if (!Number.isFinite(m) || m <= 0) return "0m";
  const hh = Math.floor(m / 60);
  const mm = m % 60;
  if (!hh) return `${mm}m`;
  return `${hh}h ${String(mm).padStart(2, "0")}m`;
}

// minutos -> horas decimales (2 decimales)
export function minToHoras(min) {
  const m = Number(min) || 0;
  return Math.round((m / 60) * 100) / 100;
}

// horas -> minutos
export function horasToMin(horas) {
  return Math.round((Number(horas) || 0) * 60);
}

/**
 * Aplica reglaCobro a una duración bruta de minutos.
 * 1. Resta gracia.
 * 2. Redondea hacia arriba por bloques de redondeoMin.
 * @returns {number} minutos cobrables (>= 0)
 */
export function aplicarReglaCobro(minutosBrutos, regla = {}) {
  const bruto = Math.max(0, Math.round(Number(minutosBrutos) || 0));
  const gracia = Math.max(0, Number(regla.graciaMin) || 0);
  const bloque = Math.max(1, Number(regla.redondeoMin) || 1);

  let m = bruto - gracia;
  if (m <= 0) return 0;

  // redondeo hacia arriba por bloque
  return Math.ceil(m / bloque) * bloque;
}

// "YYYY-MM-DD" de hoy (local)
export function todayISO() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// "YYYY-MM-DD" -> "DD/MM/YYYY"
export function fmtFecha(iso) {
  const s = String(iso || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const [y, m, d] = s.split("-");
  return `${d}/${m}/${y}`;
}

// ¿la fecha (YYYY-MM-DD) ya pasó respecto a hoy?
export function esVencida(fechaISO) {
  const s = String(fechaISO || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  return s < todayISO();
}

/**
 * Genera fechas recurrentes para reservas masivas.
 * @param {string} desdeISO  "YYYY-MM-DD"
 * @param {string} hastaISO  "YYYY-MM-DD"
 * @param {number[]} diasSemana  0=Dom ... 6=Sáb. Vacío = todos los días.
 * @returns {string[]} fechas ISO
 */
export function fechasRecurrentes(desdeISO, hastaISO, diasSemana = []) {
  const out = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(desdeISO) || !/^\d{4}-\d{2}-\d{2}$/.test(hastaISO)) return out;

  const start = new Date(desdeISO + "T00:00:00");
  const end = new Date(hastaISO + "T00:00:00");
  if (start > end) return out;

  const set = new Set(diasSemana.map(Number));
  const p = (n) => String(n).padStart(2, "0");

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    if (set.size === 0 || set.has(d.getDay())) {
      out.push(`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`);
    }
  }
  return out;
}
