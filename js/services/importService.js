/* services/importService.js — Asistencia Spaces
   Importa datos antiguos (Apps Script / Google Sheets) vía JSON o CSV.

   Mapeo del modelo viejo -> nuevo:
     empresa      -> cliente
     taller       -> paquete   (cada taller se vuelve un "paquete" contenedor)
     participante -> asistente (ligado al cliente)
     sesion       -> reserva   (ligada a cliente + paquete)

   El importador es tolerante: campos faltantes quedan vacíos/0 y se documentan
   en el reporte de resultado. NO borra nada existente.
*/

import { createCliente } from "../data/clientesRepo.js";
import { createPaquete } from "../data/paquetesRepo.js";
import { createAsistente } from "../data/asistentesRepo.js";
import { createReserva } from "../data/reservasRepo.js";
import { TIPO_CLIENTE } from "../core/constants.js";

/* ───────────────────────── CSV parsing ───────────────────────── */

/** Parser CSV simple con soporte de comillas. Devuelve array de objetos. */
export function parseCSV(text, { delimiter = "," } = {}) {
  const rows = [];
  let field = "";
  let row = [];
  let inQuotes = false;
  const s = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === delimiter) { row.push(field); field = ""; }
      else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
      else field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }

  if (!rows.length) return [];
  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1)
    .filter((r) => r.some((c) => String(c).trim() !== ""))
    .map((r) => {
      const o = {};
      headers.forEach((h, idx) => { o[h] = (r[idx] ?? "").trim(); });
      return o;
    });
}

/** Acepta string (CSV o JSON) o array ya parseado. */
export function parseAny(input) {
  if (Array.isArray(input)) return input;
  const t = String(input || "").trim();
  if (!t) return [];
  if (t[0] === "[" || t[0] === "{") {
    const j = JSON.parse(t);
    return Array.isArray(j) ? j : (j.data || j.rows || [j]);
  }
  return parseCSV(t);
}

/* ───────────────────────── Importadores ───────────────────────── */

async function importLoop(items, fn) {
  const res = { ok: 0, error: 0, errores: [], ids: [] };
  for (const it of items) {
    try {
      const created = await fn(it);
      res.ok++;
      if (created?.id) res.ids.push(created.id);
    } catch (e) {
      res.error++;
      res.errores.push({ item: it, error: e?.message || String(e) });
    }
  }
  return res;
}

/** Importa clientes. Campos esperados (flexibles): nombre/empresaNombre, etc. */
export async function importClientes(input) {
  const items = parseAny(input);
  return importLoop(items, (it) =>
    createCliente({
      nombre: it.nombre || it.empresaNombre || it.razonSocial || "",
      tipo: it.tipo || (it.empresaNombre ? TIPO_CLIENTE.EMPRESA : TIPO_CLIENTE.PERSONA),
      nitDocumento: it.nitDocumento || it.nit || it.documento || "",
      contactoPrincipal: it.contactoPrincipal || it.contactoNombre || "",
      telefono: it.telefono || it.contactoTelefono || "",
      email: it.email || it.contactoEmail || "",
      direccion: it.direccion || "",
      notas: it.notas || "",
    })
  );
}

/** Importa paquetes. Requiere clienteId resuelto (ver mapaClientes). */
export async function importPaquetes(input, { clienteIdPorDefecto = "" } = {}) {
  const items = parseAny(input);
  return importLoop(items, (it) =>
    createPaquete({
      clienteId: it.clienteId || clienteIdPorDefecto,
      nombre: it.nombre || it.tallerNombre || "Paquete importado",
      horasCompradas: Number(it.horasCompradas) || 0,
      minutosComprados: Number(it.minutosComprados) || 0,
      valorPagado: Number(it.valorPagado) || 0,
      valorHora: Number(it.valorHora) || 0,
      fechaCompra: it.fechaCompra || it.fechaInicio || "",
      fechaVencimiento: it.fechaVencimiento || it.fechaFin || "",
    })
  );
}

/** Importa asistentes (participantes viejos). */
export async function importAsistentes(input, { clienteIdPorDefecto = "" } = {}) {
  const items = parseAny(input);
  return importLoop(items, (it) =>
    createAsistente(
      {
        clienteId: it.clienteId || clienteIdPorDefecto,
        nombreCompleto: it.nombreCompleto || it.nombre || "",
        documento: it.documento || "",
        telefono: it.telefono || "",
        email: it.email || "",
        activo: String(it.activo || "SI").toUpperCase() !== "NO",
      },
      { forzar: true } // en importación masiva no bloqueamos por duplicado
    )
  );
}

/** Importa reservas (sesiones viejas). */
export async function importReservas(input, { clienteIdPorDefecto = "", paqueteIdPorDefecto = "" } = {}) {
  const items = parseAny(input);
  return importLoop(items, (it) =>
    createReserva({
      clienteId: it.clienteId || clienteIdPorDefecto,
      paqueteId: it.paqueteId || paqueteIdPorDefecto,
      espacioId: it.espacioId || "",
      fecha: it.fecha || "",
      horaInicioProgramada: it.horaInicioProgramada || it.horaInicio || "",
      horaFinProgramada: it.horaFinProgramada || it.horaFin || "",
      horaInicioReal: it.horaInicioReal || "",
      horaFinReal: it.horaFinReal || "",
      actividad: it.actividad || it.tema || "",
      responsable: it.responsable || it.facilitador || "",
      observaciones: it.observaciones || "",
    })
  );
}
