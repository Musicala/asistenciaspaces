/* data/pagosRepo.js — Registro de pagos / cobros */

import {
  db, collection, doc, getDoc, getDocs, addDoc, deleteDoc, runTransaction,
  query, where, orderBy, docData, listData, stampCreate, serverTimestamp, writeAudit,
} from "./base.js";
import { COLLECTIONS, AUDIT_ACCION, CONCEPTO_PAGO, METODO_PAGO, ESTADO_PAGO, USE_CLOUD_FUNCTIONS } from "../core/constants.js";
import { cobrarExcedenteFn } from "../firebase/functionsClient.js";

const col = () => collection(db, COLLECTIONS.pagos);

export async function listPagos() {
  const qs = await getDocs(query(col(), orderBy("fecha", "desc")));
  return listData(qs);
}

export async function listPagosByCliente(clienteId) {
  const qs = await getDocs(query(col(), where("clienteId", "==", clienteId)));
  return listData(qs).sort((a, b) => String(b.fecha || "").localeCompare(String(a.fecha || "")));
}

export async function listPagosByPaquete(paqueteId) {
  const qs = await getDocs(query(col(), where("paqueteId", "==", paqueteId)));
  return listData(qs);
}

function buildPago(data) {
  return {
    clienteId: String(data.clienteId || ""),
    paqueteId: String(data.paqueteId || ""),
    reservaId: String(data.reservaId || ""),
    concepto: data.concepto || CONCEPTO_PAGO.OTRO,
    monto: Math.round(Number(data.monto) || 0),
    metodo: data.metodo || METODO_PAGO.OTRO,
    fecha: String(data.fecha || ""),
    estado: data.estado || ESTADO_PAGO.PAGADO,
    notas: String(data.notas || "").trim(),
  };
}

export async function createPago(data) {
  const payload = { ...buildPago(data), ...stampCreate() };
  const ref = await addDoc(col(), payload);
  await writeAudit({ entidad: "pago", entidadId: ref.id, accion: AUDIT_ACCION.REGISTRO_PAGO, despues: payload });
  return { id: ref.id, ...payload };
}

export async function anularPago(id) {
  const antes = docData(await getDoc(doc(db, COLLECTIONS.pagos, id)));
  await deleteDoc(doc(db, COLLECTIONS.pagos, id));
  await writeAudit({ entidad: "pago", entidadId: id, accion: AUDIT_ACCION.ANULACION_PAGO, antes });
}

/**
 * Cobra el excedente pendiente de un paquete: crea un pago concepto=excedente
 * y marca esos minutos como ya cobrados (excedenteCobradoMin), de forma atómica.
 * @returns {object} { pagoId, minutosCobrados, monto }
 */
export async function cobrarExcedentePaquete(paqueteId, opts = {}) {
  if (USE_CLOUD_FUNCTIONS) return cobrarExcedenteFn(paqueteId, opts);
  const { metodo, fecha, notas } = opts;
  const pagoRef = doc(col());
  const paqueteRef = doc(db, COLLECTIONS.paquetes, paqueteId);

  const result = await runTransaction(db, async (tx) => {
    const pSnap = await tx.get(paqueteRef);
    if (!pSnap.exists()) throw new Error("El paquete no existe.");
    const p = pSnap.data();

    const excedidos = Number(p.minutosExcedidos) || 0;
    const yaCobrado = Number(p.excedenteCobradoMin) || 0;
    const pendienteMin = Math.max(0, excedidos - yaCobrado);
    if (pendienteMin <= 0) throw new Error("Este paquete no tiene excedente pendiente por cobrar.");

    const valorMinExtra = (Number(p.valorHoraExtra) || Number(p.valorHora) || 0) / 60;
    const monto = Math.round(pendienteMin * valorMinExtra);

    tx.set(pagoRef, {
      clienteId: p.clienteId || "",
      paqueteId,
      reservaId: "",
      concepto: CONCEPTO_PAGO.EXCEDENTE,
      monto,
      metodo: metodo || METODO_PAGO.OTRO,
      fecha: fecha || "",
      estado: ESTADO_PAGO.PAGADO,
      notas: notas || `Cobro de ${pendienteMin} min excedidos`,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    tx.update(paqueteRef, {
      excedenteCobradoMin: yaCobrado + pendienteMin,
      updatedAt: serverTimestamp(),
    });

    return { pagoId: pagoRef.id, minutosCobrados: pendienteMin, monto };
  });

  await writeAudit({ entidad: "paquete", entidadId: paqueteId, accion: AUDIT_ACCION.REGISTRO_PAGO, despues: result });
  return result;
}

// Excedente pendiente (min) de un paquete, descontando lo ya cobrado.
export function excedentePendienteMin(paquete) {
  return Math.max(0, (Number(paquete.minutosExcedidos) || 0) - (Number(paquete.excedenteCobradoMin) || 0));
}
