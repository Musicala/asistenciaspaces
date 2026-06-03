/* data/asistenciaRepo.js — Asistencia por reserva (subcolección)
   reservas/{reservaId}/asistencia/{asistenteId}
   Usa el asistenteId como id del doc para no duplicar al re-registrar.
*/

import {
  db, collection, doc, getDoc, getDocs, setDoc, deleteDoc,
  docData, listData, serverTimestamp,
} from "./base.js";
import { COLLECTIONS, ESTADO_ASISTENCIA } from "../core/constants.js";

const subcol = (reservaId) =>
  collection(db, COLLECTIONS.reservas, reservaId, COLLECTIONS.asistencia);

export async function listAsistencia(reservaId) {
  const qs = await getDocs(subcol(reservaId));
  return listData(qs);
}

/**
 * Registra/actualiza un asistente en una reserva (idempotente).
 * Guarda snapshots de nombre/documento para no romper históricos.
 */
export async function registrarAsistencia(reservaId, asistente, extra = {}) {
  const id = String(asistente.id || asistente.asistenteId);
  const ref = doc(db, COLLECTIONS.reservas, reservaId, COLLECTIONS.asistencia, id);
  const existing = docData(await getDoc(ref));

  const payload = {
    asistenteId: id,
    nombreSnapshot: asistente.nombreCompleto || asistente.nombreSnapshot || "",
    documentoSnapshot: asistente.documento || asistente.documentoSnapshot || "",
    estado: extra.estado || existing?.estado || ESTADO_ASISTENCIA.SIN_MARCAR,
    horaLlegada: extra.horaLlegada ?? existing?.horaLlegada ?? "",
    horaSalida: extra.horaSalida ?? existing?.horaSalida ?? "",
    observaciones: extra.observaciones ?? existing?.observaciones ?? "",
    createdAt: existing?.createdAt || serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  await setDoc(ref, payload, { merge: true });
  return { id, ...payload };
}

export async function marcarEstado(reservaId, asistenteId, estado) {
  const ref = doc(db, COLLECTIONS.reservas, reservaId, COLLECTIONS.asistencia, String(asistenteId));
  await setDoc(ref, { estado, updatedAt: serverTimestamp() }, { merge: true });
}

export async function marcarHoras(reservaId, asistenteId, { horaLlegada, horaSalida }) {
  const ref = doc(db, COLLECTIONS.reservas, reservaId, COLLECTIONS.asistencia, String(asistenteId));
  const patch = { updatedAt: serverTimestamp() };
  if (horaLlegada !== undefined) patch.horaLlegada = horaLlegada;
  if (horaSalida !== undefined) patch.horaSalida = horaSalida;
  await setDoc(ref, patch, { merge: true });
}

export async function quitarAsistencia(reservaId, asistenteId) {
  await deleteDoc(doc(db, COLLECTIONS.reservas, reservaId, COLLECTIONS.asistencia, String(asistenteId)));
}
