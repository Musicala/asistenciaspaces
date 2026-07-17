/* hub-data.js — Portal Spaces (capa de datos Firestore)
   Reemplaza al Apps Script: lee directo de Firestore (proyecto spaces-hub,
   el mismo de Asistencia Spaces) y devuelve el "shape" que hub.js ya sabe
   renderizar (empresa / resumen / talleres / participantes / sesiones /
   asistencias), mapeando el modelo nuevo:
     cliente → empresa · paquete → taller · reserva → sesión ·
     asistente → participante · reservas/{id}/asistencia → asistencias
   Además expone `pagos` (nuevo) para el panel de bolsa.

   Seguridad: firestore.rules solo permite leer documentos cuyo clienteId
   coincide con portalUsers/{correo}.clienteId (correo verificado y activo).
*/

import { db } from "./firebase-config.js";
import {
  collection, doc, getDoc, getDocs, query, where,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

/* ── helpers ── */

const num = (v, f = 0) => (Number.isFinite(Number(v)) ? Number(v) : f);
const minToHoras = (min) => Math.round((num(min) / 60) * 100) / 100;

function docData(snap) {
  return snap && snap.exists() ? { id: snap.id, ...snap.data() } : null;
}
function listData(qs) {
  const out = [];
  qs.forEach((s) => out.push({ id: s.id, ...s.data() }));
  return out;
}
async function listByCliente(colName, clienteId) {
  const qs = await getDocs(
    query(collection(db, colName), where("clienteId", "==", clienteId))
  );
  return listData(qs);
}

/* ── mapeos modelo nuevo → shape del hub ── */

function mapEstadoPaquete(estado = "") {
  const s = String(estado || "").toLowerCase();
  if (s === "activo" || s === "por_agotarse") return "ACTIVO";
  if (s === "agotado" || s === "excedido") return "FINALIZADO";
  if (s === "vencido") return "FINALIZADO";
  return String(estado || "").toUpperCase();
}

function mapEstadoAsistencia(estado = "") {
  const s = String(estado || "").toLowerCase();
  if (s === "presente") return "ASISTIÓ";
  if (s === "tarde") return "ASISTIÓ";
  if (s === "ausente") return "AUSENTE";
  return "";
}

function mapPaqueteToTaller(p) {
  return {
    tallerNombre: p.nombre || "Paquete de horas",
    estado: mapEstadoPaquete(p.estado),
    fechaInicio: p.fechaCompra || "",
    fechaFin: p.fechaVencimiento || "",
    sede: "",
    facilitador: "",
  };
}

function mapAsistenteToParticipante(a) {
  return {
    nombreCompleto: a.nombreCompleto || "",
    participanteNombre: a.nombreCompleto || "",
    activo: "SI",
    empresaInternaArea: "",
    correo: a.email || "",
    telefono: a.telefono || "",
  };
}

function mapReservaToSesion(r, nombrePaquete) {
  return {
    fecha: r.fecha || "",
    horaInicio: r.horaInicioProgramada || "",
    horaFin: r.horaFinProgramada || "",
    horaInicioReal: r.horaInicioReal || "",
    horaFinReal: r.horaFinReal || "",
    duracionMin: num(r.minutosProgramados),
    duracionRealMin: num(r.minutosReales),
    duracionEfectivaMin: num(r.minutosCobrados),
    duracionFuente: r.minutosCobrados ? "REAL" : (r.minutosReales ? "REAL" : "PLAN"),
    tema: r.actividad || "",
    tallerNombre: nombrePaquete || "",
    facilitador: r.responsable || "",
    sede: r.espacioId || "",
    observaciones: r.observaciones || "",
    estado: r.estado || "",
  };
}

/* ── carga principal ── */

/**
 * Devuelve { ok, found, accessState, message?, ...data } donde accessState es:
 *  'ok' | 'no-portal-doc' | 'revoked'
 */
export async function fetchHubDataFromFirestore(user) {
  const email = String(user?.email || "").trim().toLowerCase();
  if (!email) throw new Error("El usuario autenticado no tiene correo disponible.");

  // 1. Resolver acceso: portalUsers/{correo} → clienteId
  const acceso = docData(await getDoc(doc(db, "portalUsers", email)));
  if (!acceso) {
    return {
      ok: true, found: false, accessState: "no-portal-doc",
      message: "Este correo todavía no tiene un espacio autorizado. Escríbenos para activarlo.",
    };
  }
  if (acceso.activo !== true || !acceso.clienteId) {
    return {
      ok: true, found: false, accessState: "revoked",
      message: "El acceso de este correo está desactivado. Contacta a Musicala si crees que es un error.",
    };
  }
  const clienteId = String(acceso.clienteId);

  // 2. Datos del cliente (en paralelo)
  const [clienteSnap, paquetes, asistentes, reservasAll, pagos] = await Promise.all([
    getDoc(doc(db, "clientes", clienteId)),
    listByCliente("paquetes", clienteId),
    listByCliente("asistentes", clienteId),
    listByCliente("reservas", clienteId),
    listByCliente("pagos", clienteId),
  ]);

  const cliente = docData(clienteSnap) || {};
  const nombrePaquete = new Map(paquetes.map((p) => [p.id, p.nombre || "Paquete de horas"]));

  // Reservas ordenadas por fecha desc (excluye canceladas del consumo visible)
  const reservas = reservasAll
    .filter((r) => r.estado !== "cancelada")
    .sort((a, b) => String(b.fecha || "").localeCompare(String(a.fecha || "")));

  // 3. Asistencia de las últimas sesiones (limitado para no disparar lecturas)
  const MAX_RESERVAS_CON_ASISTENCIA = 25;
  const recientes = reservas.slice(0, MAX_RESERVAS_CON_ASISTENCIA);
  const asistenciaPorReserva = await Promise.all(
    recientes.map(async (r) => {
      try {
        const qs = await getDocs(collection(db, "reservas", r.id, "asistencia"));
        return { reserva: r, marcas: listData(qs) };
      } catch (_) {
        return { reserva: r, marcas: [] };
      }
    })
  );

  const asistencias = [];
  let marcasTotal = 0;
  let marcasPresentes = 0;
  for (const { reserva, marcas } of asistenciaPorReserva) {
    for (const m of marcas) {
      const estado = mapEstadoAsistencia(m.estado);
      if (!estado) continue;
      marcasTotal++;
      if (estado === "ASISTIÓ") marcasPresentes++;
      asistencias.push({
        fecha: reserva.fecha || "",
        estado,
        participanteNombre: m.nombreSnapshot || "",
        tallerNombre: nombrePaquete.get(reserva.paqueteId) || "",
        tema: reserva.actividad || "",
        horaInicio: reserva.horaInicioReal || reserva.horaInicioProgramada || "",
        horaFin: reserva.horaFinReal || reserva.horaFinProgramada || "",
        nota: m.observaciones || "",
        sede: reserva.espacioId || "",
        facilitador: reserva.responsable || "",
      });
    }
  }

  // 4. Resumen (bolsa de horas agregada de todos los paquetes)
  const minutosComprados = paquetes.reduce((a, p) => a + num(p.minutosComprados), 0);
  const minutosConsumidos = paquetes.reduce((a, p) => a + num(p.minutosConsumidos), 0);
  const minutosRestantes = Math.max(0, minutosComprados - minutosConsumidos);
  const minutosExcedidos = paquetes.reduce((a, p) => a + num(p.minutosExcedidos), 0);

  const hoy = new Date().toISOString().slice(0, 10);
  const cerradasOFuturas = reservas.filter((r) => r.fecha);
  const pasadas = cerradasOFuturas.filter((r) => r.fecha <= hoy);
  const futuras = cerradasOFuturas.filter((r) => r.fecha > hoy).sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)));

  const paquetesActivos = paquetes.filter((p) =>
    ["activo", "por_agotarse"].includes(String(p.estado || "").toLowerCase())).length;

  const resumen = {
    horasCompradas: minToHoras(minutosComprados),
    horasUsadas: minToHoras(minutosConsumidos),
    horasPendientes: minToHoras(minutosRestantes),
    horasExcedidas: minToHoras(minutosExcedidos),
    minutosConsumidos,
    porcentajeConsumo: minutosComprados
      ? Math.round((minutosConsumidos / minutosComprados) * 100)
      : 0,
    totalTalleres: paquetes.length,
    talleresActivos: paquetesActivos,
    totalParticipantes: asistentes.length,
    participantesActivos: asistentes.length,
    totalSesiones: reservas.length,
    porcentajeAsistencia: marcasTotal ? Math.round((marcasPresentes / marcasTotal) * 100) : 0,
    ultimaSesionFecha: pasadas[0]?.fecha || "",
    proximaSesionFecha: futuras[0]?.fecha || "",
    vigenciaInicio: paquetes.map((p) => p.fechaCompra).filter(Boolean).sort()[0] || "",
  };

  return {
    ok: true,
    found: true,
    accessState: "ok",
    empresa: {
      empresaNombre: cliente.nombre || "",
      contactoNombre: cliente.contactoPrincipal || "",
      contactoTelefono: cliente.telefono || "",
      contactoEmail: cliente.email || email,
    },
    resumen,
    talleres: paquetes.map(mapPaqueteToTaller),
    participantes: asistentes.map(mapAsistenteToParticipante),
    sesiones: reservas.map((r) => mapReservaToSesion(r, nombrePaquete.get(r.paqueteId))),
    asistencias,
    pagos: pagos
      .sort((a, b) => String(b.fecha || "").localeCompare(String(a.fecha || "")))
      .map((p) => ({
        fecha: p.fecha || "",
        concepto: p.concepto || "",
        monto: num(p.monto),
        metodo: p.metodo || "",
        estado: p.estado || "",
        notas: p.notas || "",
      })),
  };
}
