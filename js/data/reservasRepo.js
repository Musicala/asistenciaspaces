/* data/reservasRepo.js — CRUD de reservas + creación masiva */

import {
  db, collection, doc, getDoc, getDocs, addDoc, updateDoc, deleteDoc, writeBatch,
  query, where, orderBy, docData, listData, stampCreate, stampUpdate, serverTimestamp, writeAudit,
} from "./base.js";
import { COLLECTIONS, AUDIT_ACCION, ESTADO_RESERVA } from "../core/constants.js";
import { duracionMin } from "../core/time.js";

const col = () => collection(db, COLLECTIONS.reservas);

function buildReserva(data) {
  const minutosProgramados =
    Number(data.minutosProgramados) ||
    duracionMin(data.horaInicioProgramada, data.horaFinProgramada) ||
    0;

  return {
    clienteId: String(data.clienteId || ""),
    paqueteId: String(data.paqueteId || ""),
    espacioId: String(data.espacioId || ""),
    fecha: String(data.fecha || ""),
    horaInicioProgramada: String(data.horaInicioProgramada || ""),
    horaFinProgramada: String(data.horaFinProgramada || ""),
    minutosProgramados,
    horaInicioReal: String(data.horaInicioReal || ""),
    horaFinReal: String(data.horaFinReal || ""),
    minutosReales: Number(data.minutosReales) || 0,
    minutosCobrados: Number(data.minutosCobrados) || 0,
    minutosExcedidos: Number(data.minutosExcedidos) || 0,
    estado: data.estado || ESTADO_RESERVA.PROGRAMADA,
    actividad: String(data.actividad || "").trim(),
    responsable: String(data.responsable || "").trim(),
    observaciones: String(data.observaciones || "").trim(),
  };
}

export async function listReservas({ desde, hasta } = {}) {
  const qs = await getDocs(query(col(), orderBy("fecha", "desc")));
  let list = listData(qs);
  if (desde) list = list.filter((r) => r.fecha >= desde);
  if (hasta) list = list.filter((r) => r.fecha <= hasta);
  return list;
}

export async function listReservasByCliente(clienteId) {
  const qs = await getDocs(query(col(), where("clienteId", "==", clienteId)));
  return listData(qs).sort((a, b) => String(b.fecha || "").localeCompare(String(a.fecha || "")));
}

export async function listReservasByPaquete(paqueteId) {
  const qs = await getDocs(query(col(), where("paqueteId", "==", paqueteId)));
  return listData(qs).sort((a, b) => String(b.fecha || "").localeCompare(String(a.fecha || "")));
}

export async function getReserva(id) {
  return docData(await getDoc(doc(db, COLLECTIONS.reservas, id)));
}

export async function createReserva(data) {
  const payload = { ...buildReserva(data), ...stampCreate() };
  const ref = await addDoc(col(), payload);
  await writeAudit({ entidad: "reserva", entidadId: ref.id, accion: AUDIT_ACCION.CREATE, despues: payload });
  return { id: ref.id, ...payload };
}

/**
 * Crea muchas reservas (recurrentes) en un batch.
 * @param {object} base  datos comunes (clienteId, paqueteId, horas, etc.)
 * @param {string[]} fechas  array de "YYYY-MM-DD"
 * @returns {number} cantidad creada
 */
export async function createReservasMasivas(base, fechas) {
  const list = Array.isArray(fechas) ? fechas : [];
  if (!list.length) return 0;

  const batch = writeBatch(db);
  const ids = [];
  for (const fecha of list) {
    const ref = doc(col());
    ids.push(ref.id);
    batch.set(ref, {
      ...buildReserva({ ...base, fecha }),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }
  await batch.commit();
  await writeAudit({
    entidad: "reserva",
    entidadId: ids.join(","),
    accion: AUDIT_ACCION.CREATE,
    despues: { masiva: true, cantidad: list.length, fechas: list },
  });
  return list.length;
}

export async function updateReserva(id, patch) {
  const antes = await getReserva(id);
  // recalcula minutosProgramados si cambian horas
  if (patch.horaInicioProgramada || patch.horaFinProgramada) {
    const hi = patch.horaInicioProgramada ?? antes?.horaInicioProgramada;
    const hf = patch.horaFinProgramada ?? antes?.horaFinProgramada;
    const d = duracionMin(hi, hf);
    if (d) patch.minutosProgramados = d;
  }
  const payload = { ...patch, ...stampUpdate() };
  await updateDoc(doc(db, COLLECTIONS.reservas, id), payload);
  await writeAudit({ entidad: "reserva", entidadId: id, accion: AUDIT_ACCION.UPDATE, antes, despues: patch });
  return { id, ...antes, ...payload };
}

export async function deleteReserva(id) {
  const antes = await getReserva(id);
  await deleteDoc(doc(db, COLLECTIONS.reservas, id));
  await writeAudit({ entidad: "reserva", entidadId: id, accion: AUDIT_ACCION.DELETE, antes });
}
