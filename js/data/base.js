/* data/base.js — Asistencia Spaces
   Helpers comunes de Firestore + escritura de auditoría.
   Reexporta las funciones del SDK que usan los repos (un solo punto de import).
*/

import {
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
  runTransaction,
  writeBatch,
  onSnapshot,
  Timestamp,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import { db } from "../firebase/config.js";
import { COLLECTIONS, AUDIT_ACCION } from "../core/constants.js";
import { currentUser } from "../firebase/auth.js";

export {
  collection, doc, getDoc, getDocs, addDoc, setDoc, updateDoc, deleteDoc,
  query, where, orderBy, limit, serverTimestamp, runTransaction, writeBatch,
  onSnapshot, Timestamp, db,
};

// Convierte un snapshot de doc en objeto plano { id, ...data }.
export function docData(snap) {
  if (!snap || !snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
}

// Convierte un querySnapshot en array de { id, ...data }.
export function listData(qs) {
  const out = [];
  qs.forEach((s) => out.push({ id: s.id, ...s.data() }));
  return out;
}

// Marcas de tiempo del servidor para create/update.
export function stampCreate() {
  return { createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
}
export function stampUpdate() {
  return { updatedAt: serverTimestamp() };
}

/**
 * Escribe un registro de auditoría. No bloquea el flujo si falla.
 * @param {object} p { entidad, entidadId, accion, antes?, despues? }
 */
export async function writeAudit({ entidad, entidadId, accion, antes = null, despues = null }) {
  try {
    const u = currentUser();
    await addDoc(collection(db, COLLECTIONS.auditLogs), {
      entidad: String(entidad || ""),
      entidadId: String(entidadId || ""),
      accion: String(accion || AUDIT_ACCION.UPDATE),
      antes,
      despues,
      usuarioId: u?.uid || "anon",
      usuarioNombre: u?.nombre || "anon",
      createdAt: serverTimestamp(),
    });
  } catch (e) {
    console.warn("[audit] no se pudo registrar:", e?.message || e);
  }
}

// Normaliza documento: minúsculas, sin espacios ni signos (para dedup).
export function normalizarDoc(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}
