/* data/paquetesRepo.js — CRUD de paquetes de horas */

import {
  db, collection, doc, getDoc, getDocs, addDoc, updateDoc, deleteDoc,
  query, where, orderBy, docData, listData, stampCreate, stampUpdate, writeAudit,
} from "./base.js";
import {
  COLLECTIONS, AUDIT_ACCION, REGLA_COBRO_DEFAULT, ALERTA_SALDO_MIN_DEFAULT, ESTADO_PAQUETE,
} from "../core/constants.js";
import { horasToMin } from "../core/time.js";

const col = () => collection(db, COLLECTIONS.paquetes);

export async function listPaquetes() {
  const qs = await getDocs(query(col(), orderBy("createdAt", "desc")));
  return listData(qs);
}

export async function listPaquetesByCliente(clienteId) {
  const qs = await getDocs(query(col(), where("clienteId", "==", clienteId)));
  return listData(qs).sort((a, b) => String(b.fechaCompra || "").localeCompare(String(a.fechaCompra || "")));
}

export async function getPaquete(id) {
  return docData(await getDoc(doc(db, COLLECTIONS.paquetes, id)));
}

export async function createPaquete(data) {
  // Acepta horasCompradas (decimal) o minutosComprados directos.
  const minutosComprados = Number.isFinite(Number(data.minutosComprados))
    ? Math.round(Number(data.minutosComprados))
    : horasToMin(data.horasCompradas);

  const horasCompradas = Number(data.horasCompradas) || Math.round((minutosComprados / 60) * 100) / 100;

  const payload = {
    clienteId: String(data.clienteId || ""),
    nombre: String(data.nombre || "Paquete de horas").trim(),
    horasCompradas,
    minutosComprados,
    minutosConsumidos: 0,
    minutosRestantes: minutosComprados,
    minutosExcedidos: 0,
    valorPagado: Number(data.valorPagado) || 0,
    valorHora: Number(data.valorHora) || 0,
    valorHoraExtra: Number(data.valorHoraExtra) || Number(data.valorHora) || 0,
    fechaCompra: data.fechaCompra || "",
    fechaVencimiento: data.fechaVencimiento || "",
    estado: ESTADO_PAQUETE.ACTIVO,
    alertaSaldoMin: Number(data.alertaSaldoMin) || ALERTA_SALDO_MIN_DEFAULT,
    reglaCobro: {
      redondeoMin: Number(data?.reglaCobro?.redondeoMin) || REGLA_COBRO_DEFAULT.redondeoMin,
      graciaMin: Number(data?.reglaCobro?.graciaMin) || REGLA_COBRO_DEFAULT.graciaMin,
      cobrarExcedente:
        data?.reglaCobro?.cobrarExcedente ?? REGLA_COBRO_DEFAULT.cobrarExcedente,
    },
    ...stampCreate(),
  };
  const ref = await addDoc(col(), payload);
  await writeAudit({ entidad: "paquete", entidadId: ref.id, accion: AUDIT_ACCION.CREATE, despues: payload });
  return { id: ref.id, ...payload };
}

export async function updatePaquete(id, patch) {
  const antes = await getPaquete(id);
  const payload = { ...patch, ...stampUpdate() };
  await updateDoc(doc(db, COLLECTIONS.paquetes, id), payload);
  await writeAudit({ entidad: "paquete", entidadId: id, accion: AUDIT_ACCION.UPDATE, antes, despues: patch });
  return { id, ...antes, ...payload };
}

export async function deletePaquete(id) {
  const antes = await getPaquete(id);
  await deleteDoc(doc(db, COLLECTIONS.paquetes, id));
  await writeAudit({ entidad: "paquete", entidadId: id, accion: AUDIT_ACCION.DELETE, antes });
}
