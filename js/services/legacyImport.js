/* services/legacyImport.js — Migración del Sheets/Apps Script antiguo a Firestore
   Reconstruye el grafo preservando relaciones (datos reales del Excel 2026):

     empresa      → cliente + 1 paquete (con sus horasCompradas)
     taller       → se usa como actividad/responsable de la reserva (no crea doc)
     participante → asistente (clienteId = empresa de su taller)
     sesion       → reserva (clienteId + paqueteId del taller)
     Asistencias  → reservas/{reservaId}/asistencia/{asistenteId}

   Fuentes:
   - loadIncludedData(): lee ./migration-data.json (generado desde tu Excel).
   - fetchLegacyFromAppsScript(url, token): jala todo desde la Web App vieja.
*/

import {
  db, writeBatch, doc, collection, serverTimestamp,
} from "../data/base.js";
import { createCliente } from "../data/clientesRepo.js";
import { createPaquete } from "../data/paquetesRepo.js";
import { createAsistente } from "../data/asistentesRepo.js";
import { createReserva } from "../data/reservasRepo.js";
import { COLLECTIONS, TIPO_CLIENTE, ESTADO_RESERVA, ESTADO_ASISTENCIA } from "../core/constants.js";
import { duracionMin } from "../core/time.js";

export const LEGACY_DEFAULTS = {
  url: "https://script.google.com/macros/s/AKfycbySWVHSZe6mGGfzXvEqUWGFaw0noO9Vsux95CX_hdwYD1BNaaULtfGFxa3gvB3dKnU5/exec",
  token: "MUSICALA-SECRET-2026",
};

/** Lee el JSON incluido (convertido desde tu Excel). */
export async function loadIncludedData() {
  const url = new URL("migration-data.json", window.location.href);
  const res = await fetch(url.href, { cache: "no-store" });
  if (!res.ok) throw new Error(`No se encontro migration-data.json junto al index.html (${url.pathname})`);
  return res.json();
}

/** Descarga TODO el grafo desde la Web App de Apps Script (solo GET). */
export async function fetchLegacyFromAppsScript(url, token, { onProgress } = {}) {
  const base = (url || LEGACY_DEFAULTS.url).trim();
  const tok = (token || LEGACY_DEFAULTS.token).trim();
  const get = async (action, params = {}) => {
    const qs = new URLSearchParams({ action, token: tok, ...params });
    const res = await fetch(`${base}?${qs.toString()}`);
    const json = await res.json();
    if (!json || json.ok !== true) throw new Error(json?.error || `Falló ${action}`);
    return json;
  };

  onProgress?.("Leyendo empresas…");
  const empresas = (await get("listEmpresas")).empresas || [];
  const talleres = [], participantes = [], sesiones = [], asistencias = [];
  for (const e of empresas) {
    const ts = (await get("listTalleresByEmpresa", { empresaId: e.empresaId })).talleres || [];
    talleres.push(...ts);
    for (const t of ts) {
      onProgress?.(`Leyendo ${t.tallerNombre || t.tallerId}…`);
      participantes.push(...((await get("listParticipantesByTaller", { tallerId: t.tallerId })).participantes || []));
      const ss = (await get("listSesionesByTaller", { tallerId: t.tallerId })).sesiones || [];
      sesiones.push(...ss);
      for (const s of ss) {
        asistencias.push(...((await get("getAsistenciaBySesion", { sesionId: s.sesionId })).asistencias || []));
      }
    }
  }
  return { empresas, talleres, participantes, sesiones, asistencias };
}

const ESTADO_MAP = {
  ASISTIO: ESTADO_ASISTENCIA.PRESENTE,
  NO_ASISTIO: ESTADO_ASISTENCIA.AUSENTE,
  TARDE: ESTADO_ASISTENCIA.TARDE,
};

/** Escribe el grafo en Firestore preservando relaciones. */
export async function migrateLegacy(
  { empresas = [], talleres = [], participantes = [], sesiones = [], asistencias = [] },
  { onProgress } = {}
) {
  const report = { clientes: 0, paquetes: 0, asistentes: 0, reservas: 0, asistencias: 0, errores: [] };
  const empMap = new Map(); // empresaId -> { clienteId, paqueteId }
  const talMap = new Map(); // tallerId  -> { clienteId, paqueteId, nombre, facilitador }
  const partMap = new Map(); // participanteId -> { asistenteId, clienteId, nombre, documento }
  const sesMap = new Map();  // sesionId -> reservaId

  // 1) empresas -> cliente + paquete
  for (const e of empresas) {
    try {
      onProgress?.(`Cliente: ${e.empresaNombre}`);
      const c = await createCliente({
        nombre: e.empresaNombre || "(Sin nombre)",
        tipo: TIPO_CLIENTE.EMPRESA,
        contactoPrincipal: e.contactoNombre || "",
        telefono: e.contactoTelefono || "",
        email: e.contactoEmail || "",
        notas: e.notas || "Importado del Sheets 2026",
      });
      const p = await createPaquete({
        clienteId: c.id,
        nombre: `Horas contratadas — ${e.empresaNombre || ""}`.trim(),
        horasCompradas: Number(e.horasCompradas) || 0,
      });
      empMap.set(String(e.empresaId), { clienteId: c.id, paqueteId: p.id });
      report.clientes++; report.paquetes++;
    } catch (err) { report.errores.push(`empresa ${e.empresaId}: ${err.message}`); }
  }

  // 2) talleres -> lookup (cliente/paquete heredados de su empresa)
  for (const t of talleres) {
    const emp = empMap.get(String(t.empresaId));
    talMap.set(String(t.tallerId), {
      clienteId: emp?.clienteId || "",
      paqueteId: emp?.paqueteId || "",
      nombre: t.tallerNombre || "",
      facilitador: t.facilitador || "",
    });
  }

  // 3) participantes -> asistentes
  for (const pa of participantes) {
    try {
      const link = talMap.get(String(pa.tallerId));
      onProgress?.(`Asistente: ${pa.nombreCompleto}`);
      const a = await createAsistente({
        clienteId: link?.clienteId || "",
        nombreCompleto: pa.nombreCompleto || "",
        documento: pa.documento || "",
        telefono: pa.telefono || "",
        email: pa.email || "",
        activo: String(pa.activo || "SI").toUpperCase() !== "NO",
      }, { forzar: true });
      partMap.set(String(pa.participanteId), {
        asistenteId: a.id, clienteId: link?.clienteId || "",
        nombre: a.nombreCompleto, documento: a.documento,
      });
      report.asistentes++;
    } catch (err) { report.errores.push(`participante ${pa.participanteId}: ${err.message}`); }
  }

  // 4) sesiones -> reservas (históricas; no recalculan consumo)
  for (const s of sesiones) {
    try {
      const link = talMap.get(String(s.tallerId)) || {};
      const real = duracionMin(s.horaInicioReal, s.horaFinReal) || Number(s.duracionRealMin) || 0;
      const actividad = [link.nombre, s.tema].filter(Boolean).join(" · ");
      onProgress?.(`Reserva: ${s.fecha}`);
      const r = await createReserva({
        clienteId: link.clienteId || "",
        paqueteId: link.paqueteId || "",
        fecha: s.fecha || "",
        horaInicioProgramada: s.horaInicio || "",
        horaFinProgramada: s.horaFin || "",
        horaInicioReal: s.horaInicioReal || "",
        horaFinReal: s.horaFinReal || "",
        minutosReales: real,
        actividad,
        responsable: link.facilitador || "",
        observaciones: s.observaciones || "",
        estado: real ? ESTADO_RESERVA.CERRADA : ESTADO_RESERVA.PROGRAMADA,
      });
      sesMap.set(String(s.sesionId), r.id);
      report.reservas++;
    } catch (err) { report.errores.push(`sesion ${s.sesionId}: ${err.message}`); }
  }

  // 5) asistencias -> subcolección (en lotes de 400)
  let batch = writeBatch(db);
  let n = 0;
  const flush = async () => { if (n) { await batch.commit(); batch = writeBatch(db); n = 0; } };
  for (const a of asistencias) {
    const reservaId = sesMap.get(String(a.sesionId));
    const asis = partMap.get(String(a.participanteId));
    if (!reservaId || !asis) continue;
    const ref = doc(db, COLLECTIONS.reservas, reservaId, COLLECTIONS.asistencia, asis.asistenteId);
    batch.set(ref, {
      asistenteId: asis.asistenteId,
      nombreSnapshot: asis.nombre || "",
      documentoSnapshot: asis.documento || "",
      estado: ESTADO_MAP[String(a.estado || "").toUpperCase()] || ESTADO_ASISTENCIA.SIN_MARCAR,
      horaLlegada: "", horaSalida: "",
      observaciones: a.nota || "",
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    });
    report.asistencias++; n++;
    if (n >= 400) { onProgress?.(`Asistencias: ${report.asistencias}…`); await flush(); }
  }
  await flush();

  return report;
}
