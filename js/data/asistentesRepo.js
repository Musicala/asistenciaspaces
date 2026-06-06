/* data/asistentesRepo.js — CRUD de asistentes por cliente + anti-duplicados */

import {
  db, collection, doc, getDoc, getDocs, addDoc, updateDoc, deleteDoc,
  query, where, orderBy, docData, listData, stampCreate, stampUpdate, normalizarDoc, writeAudit,
} from "./base.js";
import { COLLECTIONS, AUDIT_ACCION } from "../core/constants.js";

const col = () => collection(db, COLLECTIONS.asistentes);

export async function listAsistentesByCliente(clienteId, { soloActivos = false } = {}) {
  const qs = await getDocs(query(col(), where("clienteId", "==", clienteId)));
  let list = listData(qs);
  if (soloActivos) list = list.filter((a) => a.activo !== false);
  return list.sort((a, b) => String(a.nombreCompleto || "").localeCompare(String(b.nombreCompleto || "")));
}

export async function getAsistente(id) {
  return docData(await getDoc(doc(db, COLLECTIONS.asistentes, id)));
}

// Similitud simple de nombres (normalizada) para detectar "parecidos".
function nombreNorm(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Busca posibles duplicados de un asistente dentro del mismo cliente.
 * Coincide por documento normalizado, email, o nombre normalizado idéntico.
 * @returns {Array} asistentes candidatos a duplicado
 */
export async function buscarPosiblesDuplicados(clienteId, { documento, email, nombreCompleto }) {
  const existentes = await listAsistentesByCliente(clienteId);
  const docN = normalizarDoc(documento);
  const mail = String(email || "").trim().toLowerCase();
  const nom = nombreNorm(nombreCompleto);

  return existentes.filter((a) => {
    if (docN && a.documentoNormalizado && a.documentoNormalizado === docN) return true;
    if (mail && a.email && String(a.email).toLowerCase() === mail) return true;
    if (nom && nombreNorm(a.nombreCompleto) === nom) return true;
    return false;
  });
}

/**
 * Crea un asistente. Por defecto evita duplicados (lanza error con la lista).
 * Pasa { forzar: true } para crear de todas formas.
 */
export async function createAsistente(data, { forzar = false } = {}) {
  const clienteId = String(data.clienteId || "");
  if (!forzar) {
    const dups = await buscarPosiblesDuplicados(clienteId, data);
    if (dups.length) {
      const err = new Error("Posible duplicado detectado.");
      err.duplicados = dups;
      throw err;
    }
  }

  const payload = {
    clienteId,
    nombreCompleto: String(data.nombreCompleto || "").trim(),
    documento: String(data.documento || "").trim(),
    documentoNormalizado: normalizarDoc(data.documento),
    telefono: String(data.telefono || "").trim(),
    email: String(data.email || "").trim().toLowerCase(),
    acudienteNombre: String(data.acudienteNombre || "").trim(),
    acudienteTelefono: String(data.acudienteTelefono || "").trim(),
    activo: data.activo !== false,
    primeraVisita: data.primeraVisita || "",
    ultimaVisita: data.ultimaVisita || "",
    totalVisitas: Number(data.totalVisitas) || 0,
    ...stampCreate(),
  };
  const ref = await addDoc(col(), payload);
  await writeAudit({ entidad: "asistente", entidadId: ref.id, accion: AUDIT_ACCION.CREATE, despues: payload });
  return { id: ref.id, ...payload };
}

export async function updateAsistente(id, patch) {
  const antes = await getAsistente(id);
  const payload = { ...patch, ...stampUpdate() };
  if (typeof payload.documento === "string") payload.documentoNormalizado = normalizarDoc(payload.documento);
  if (typeof payload.email === "string") payload.email = payload.email.trim().toLowerCase();
  await updateDoc(doc(db, COLLECTIONS.asistentes, id), payload);
  await writeAudit({ entidad: "asistente", entidadId: id, accion: AUDIT_ACCION.UPDATE, antes, despues: patch });
  return { id, ...antes, ...payload };
}

export async function deleteAsistente(id) {
  const antes = await getAsistente(id);
  await deleteDoc(doc(db, COLLECTIONS.asistentes, id));
  await writeAudit({ entidad: "asistente", entidadId: id, accion: AUDIT_ACCION.DELETE, antes });
}
