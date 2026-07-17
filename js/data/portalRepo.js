/* data/portalRepo.js — Accesos al Portal de clientes (Spaces HUB)
   Cada acceso vive en portalUsers/{correo-en-minusculas} → { clienteId, activo }.
   El correo es el ID del documento para que las reglas de Firestore puedan
   resolverlo directo con request.auth.token.email.
*/

import {
  db, collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc,
  query, where, docData, listData, stampCreate, stampUpdate, writeAudit,
} from "./base.js";
import { AUDIT_ACCION } from "../core/constants.js";
import { currentUser } from "../firebase/auth.js";

const COL = "portalUsers";
const col = () => collection(db, COL);

const normEmail = (e) => String(e || "").trim().toLowerCase();

export async function listAccesosByCliente(clienteId) {
  const qs = await getDocs(query(col(), where("clienteId", "==", clienteId)));
  return listData(qs);
}

export async function getAcceso(email) {
  return docData(await getDoc(doc(db, COL, normEmail(email))));
}

/** Otorga (o reactiva) acceso al portal para un correo → cliente. */
export async function otorgarAcceso(email, clienteId, { nombre = "" } = {}) {
  const id = normEmail(email);
  if (!id || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(id)) {
    throw new Error("Escribe un correo válido.");
  }
  const existente = await getAcceso(id);
  if (existente && existente.clienteId !== clienteId && existente.activo) {
    throw new Error("Ese correo ya tiene acceso al portal de otro cliente.");
  }
  const u = currentUser();
  const payload = {
    clienteId: String(clienteId || ""),
    email: id,
    nombre: String(nombre || "").trim(),
    activo: true,
    creadoPor: u?.email || u?.uid || "",
    ...(existente ? stampUpdate() : stampCreate()),
  };
  await setDoc(doc(db, COL, id), payload, { merge: true });
  await writeAudit({
    entidad: "portalUser", entidadId: id,
    accion: existente ? AUDIT_ACCION.UPDATE : AUDIT_ACCION.CREATE,
    antes: existente, despues: payload,
  });
  return { id, ...payload };
}

/** Revoca el acceso (lo desactiva; no borra el historial). */
export async function revocarAcceso(email) {
  const id = normEmail(email);
  const antes = await getAcceso(id);
  if (!antes) return;
  await updateDoc(doc(db, COL, id), { activo: false, ...stampUpdate() });
  await writeAudit({ entidad: "portalUser", entidadId: id, accion: AUDIT_ACCION.UPDATE, antes, despues: { activo: false } });
}

/** Elimina el acceso por completo. */
export async function eliminarAcceso(email) {
  const id = normEmail(email);
  const antes = await getAcceso(id);
  await deleteDoc(doc(db, COL, id));
  await writeAudit({ entidad: "portalUser", entidadId: id, accion: AUDIT_ACCION.DELETE, antes });
}
