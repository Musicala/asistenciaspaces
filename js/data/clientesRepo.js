/* data/clientesRepo.js — CRUD de clientes */

import {
  db, collection, doc, getDoc, getDocs, addDoc, updateDoc, deleteDoc,
  query, where, orderBy, docData, listData, stampCreate, stampUpdate, writeAudit,
} from "./base.js";
import { COLLECTIONS, AUDIT_ACCION, TIPO_CLIENTE } from "../core/constants.js";

const col = () => collection(db, COLLECTIONS.clientes);

export async function listClientes({ soloActivos = false } = {}) {
  const qs = await getDocs(query(col(), orderBy("nombre")));
  let list = listData(qs);
  if (soloActivos) list = list.filter((c) => c.estado !== "inactivo");
  return list;
}

export async function getCliente(id) {
  return docData(await getDoc(doc(db, COLLECTIONS.clientes, id)));
}

export async function createCliente(data) {
  const payload = {
    nombre: String(data.nombre || "").trim(),
    tipo: data.tipo || TIPO_CLIENTE.EMPRESA,
    nitDocumento: String(data.nitDocumento || "").trim(),
    contactoPrincipal: String(data.contactoPrincipal || "").trim(),
    telefono: String(data.telefono || "").trim(),
    email: String(data.email || "").trim().toLowerCase(),
    direccion: String(data.direccion || "").trim(),
    estado: data.estado || "activo",
    notas: String(data.notas || "").trim(),
    ...stampCreate(),
  };
  const ref = await addDoc(col(), payload);
  await writeAudit({ entidad: "cliente", entidadId: ref.id, accion: AUDIT_ACCION.CREATE, despues: payload });
  return { id: ref.id, ...payload };
}

export async function updateCliente(id, patch) {
  const antes = await getCliente(id);
  const payload = { ...patch, ...stampUpdate() };
  if (typeof payload.email === "string") payload.email = payload.email.trim().toLowerCase();
  await updateDoc(doc(db, COLLECTIONS.clientes, id), payload);
  await writeAudit({ entidad: "cliente", entidadId: id, accion: AUDIT_ACCION.UPDATE, antes, despues: patch });
  return { id, ...antes, ...payload };
}

export async function deleteCliente(id) {
  const antes = await getCliente(id);
  await deleteDoc(doc(db, COLLECTIONS.clientes, id));
  await writeAudit({ entidad: "cliente", entidadId: id, accion: AUDIT_ACCION.DELETE, antes });
}
