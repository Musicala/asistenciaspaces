/* services/consumoService.js — Asistencia Spaces
   Lógica sensible: cierre/reapertura de reservas y actualización ATÓMICA del
   consumo del paquete. Toda mutación de minutos pasa por aquí.

   ⚠️ Esta lógica está aislada a propósito: si mañana se mueve a Cloud Functions,
   solo se reimplementa este archivo (mismo contrato de funciones).
*/

import {
  db, doc, runTransaction, serverTimestamp,
} from "../data/base.js";
import { COLLECTIONS, ESTADO_RESERVA, ESTADO_PAQUETE, AUDIT_ACCION, USE_CLOUD_FUNCTIONS } from "../core/constants.js";
import { writeAudit } from "../data/base.js";
import { duracionMin, aplicarReglaCobro, esVencida } from "../core/time.js";
import { cerrarReservaFn, reabrirReservaFn, iniciarReservaFn } from "../firebase/functionsClient.js";

/**
 * Calcula el estado de un paquete a partir de sus minutos y vencimiento.
 * Pura — no escribe nada.
 */
export function calcularEstadoPaquete(paq) {
  const comprados = Number(paq.minutosComprados) || 0;
  const consumidos = Number(paq.minutosConsumidos) || 0;
  const restantes = comprados - consumidos;
  const alerta = Number(paq.alertaSaldoMin) || 0;

  if (esVencida(paq.fechaVencimiento)) return ESTADO_PAQUETE.VENCIDO;
  if (consumidos > comprados) return ESTADO_PAQUETE.EXCEDIDO;
  if (restantes <= 0) return ESTADO_PAQUETE.AGOTADO;
  if (restantes <= alerta) return ESTADO_PAQUETE.POR_AGOTARSE;
  return ESTADO_PAQUETE.ACTIVO;
}

/**
 * Minutos cobrables de una reserva según su tiempo real (o programado si no
 * hay real cerrado) aplicando la reglaCobro del paquete.
 * @returns {object} { minutosReales, minutosCobrados }
 */
export function calcularConsumoReserva(reserva, paquete) {
  const regla = paquete?.reglaCobro || {};

  // Minutos reales: de horas reales, o del campo, o cae a programado.
  let reales =
    duracionMin(reserva.horaInicioReal, reserva.horaFinReal) ||
    Number(reserva.minutosReales) ||
    0;

  if (!reales) {
    // sin tiempo real cerrado -> usar programado como referencia
    reales = Number(reserva.minutosProgramados) || duracionMin(reserva.horaInicioProgramada, reserva.horaFinProgramada) || 0;
  }

  const cobrados = aplicarReglaCobro(reales, regla);
  return { minutosReales: reales, minutosCobrados: cobrados };
}

/**
 * Cierra una reserva y descuenta su consumo del paquete, ATÓMICAMENTE.
 * Si la reserva ya estaba cerrada, primero revierte su consumo anterior y
 * vuelve a aplicar (permite re-cerrar tras editar horas).
 *
 * @param {string} reservaId
 * @param {object} patch  { horaInicioReal, horaFinReal, observaciones? }
 */
async function cerrarReservaLocal(reservaId, patch = {}) {
  const reservaRef = doc(db, COLLECTIONS.reservas, reservaId);

  const result = await runTransaction(db, async (tx) => {
    const rSnap = await tx.get(reservaRef);
    if (!rSnap.exists()) throw new Error("La reserva no existe.");
    const reserva = { id: rSnap.id, ...rSnap.data() };

    const paqueteId = reserva.paqueteId;
    if (!paqueteId) throw new Error("La reserva no tiene paquete asociado.");
    const paqueteRef = doc(db, COLLECTIONS.paquetes, paqueteId);
    const pSnap = await tx.get(paqueteRef);
    if (!pSnap.exists()) throw new Error("El paquete asociado no existe.");
    const paquete = { id: pSnap.id, ...pSnap.data() };

    // Reserva con los datos nuevos aplicados (para recálculo)
    const reservaActualizada = {
      ...reserva,
      horaInicioReal: patch.horaInicioReal ?? reserva.horaInicioReal,
      horaFinReal: patch.horaFinReal ?? reserva.horaFinReal,
      observaciones: patch.observaciones ?? reserva.observaciones,
    };

    const { minutosReales, minutosCobrados } = calcularConsumoReserva(reservaActualizada, paquete);

    // Si ya estaba cerrada, revertimos lo que había cobrado antes.
    const cobradoAnterior = reserva.estado === ESTADO_RESERVA.CERRADA
      ? Number(reserva.minutosCobrados) || 0
      : 0;

    const consumidosPrev = Number(paquete.minutosConsumidos) || 0;
    const nuevoConsumido = Math.max(0, consumidosPrev - cobradoAnterior + minutosCobrados);
    const comprados = Number(paquete.minutosComprados) || 0;
    const restantes = comprados - nuevoConsumido;
    const excedidos = Math.max(0, nuevoConsumido - comprados);

    const paqueteParaEstado = {
      ...paquete,
      minutosConsumidos: nuevoConsumido,
    };
    const estadoPaquete = calcularEstadoPaquete(paqueteParaEstado);

    // Excedido de ESTA reserva (la porción que cae por encima de lo comprado)
    const excedidoReserva = Math.max(0, (consumidosPrev - cobradoAnterior + minutosCobrados) - comprados) -
      Math.max(0, (consumidosPrev - cobradoAnterior) - comprados);

    // Escrituras atómicas
    tx.update(paqueteRef, {
      minutosConsumidos: nuevoConsumido,
      minutosRestantes: restantes,
      minutosExcedidos: excedidos,
      estado: estadoPaquete,
      updatedAt: serverTimestamp(),
    });

    tx.update(reservaRef, {
      estado: ESTADO_RESERVA.CERRADA,
      horaInicioReal: reservaActualizada.horaInicioReal,
      horaFinReal: reservaActualizada.horaFinReal,
      observaciones: reservaActualizada.observaciones,
      minutosReales,
      minutosCobrados,
      minutosExcedidos: Math.max(0, excedidoReserva),
      updatedAt: serverTimestamp(),
    });

    return {
      reserva: { minutosReales, minutosCobrados },
      paquete: { minutosConsumidos: nuevoConsumido, minutosRestantes: restantes, minutosExcedidos: excedidos, estado: estadoPaquete },
    };
  });

  await writeAudit({
    entidad: "reserva",
    entidadId: reservaId,
    accion: AUDIT_ACCION.CIERRE_RESERVA,
    despues: result,
  });
  return result;
}

/**
 * Reabre una reserva cerrada: devuelve sus minutos cobrados al paquete.
 */
async function reabrirReservaLocal(reservaId) {
  const reservaRef = doc(db, COLLECTIONS.reservas, reservaId);

  const result = await runTransaction(db, async (tx) => {
    const rSnap = await tx.get(reservaRef);
    if (!rSnap.exists()) throw new Error("La reserva no existe.");
    const reserva = { id: rSnap.id, ...rSnap.data() };

    if (reserva.estado !== ESTADO_RESERVA.CERRADA) {
      throw new Error("La reserva no está cerrada.");
    }

    const paqueteRef = doc(db, COLLECTIONS.paquetes, reserva.paqueteId);
    const pSnap = await tx.get(paqueteRef);
    if (pSnap.exists()) {
      const paquete = { id: pSnap.id, ...pSnap.data() };
      const cobrado = Number(reserva.minutosCobrados) || 0;
      const comprados = Number(paquete.minutosComprados) || 0;
      const nuevoConsumido = Math.max(0, (Number(paquete.minutosConsumidos) || 0) - cobrado);
      const estado = calcularEstadoPaquete({ ...paquete, minutosConsumidos: nuevoConsumido });

      tx.update(paqueteRef, {
        minutosConsumidos: nuevoConsumido,
        minutosRestantes: comprados - nuevoConsumido,
        minutosExcedidos: Math.max(0, nuevoConsumido - comprados),
        estado,
        updatedAt: serverTimestamp(),
      });
    }

    tx.update(reservaRef, {
      estado: ESTADO_RESERVA.PROGRAMADA,
      minutosCobrados: 0,
      minutosExcedidos: 0,
      updatedAt: serverTimestamp(),
    });
    return true;
  });

  await writeAudit({ entidad: "reserva", entidadId: reservaId, accion: AUDIT_ACCION.REAPERTURA_RESERVA });
  return result;
}

/**
 * Marca el inicio real (iniciar uso). No toca el paquete.
 */
async function iniciarReservaLocal(reservaId, horaInicioReal) {
  const reservaRef = doc(db, COLLECTIONS.reservas, reservaId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(reservaRef);
    if (!snap.exists()) throw new Error("La reserva no existe.");
    tx.update(reservaRef, {
      estado: ESTADO_RESERVA.EN_CURSO,
      horaInicioReal: horaInicioReal || snap.data().horaInicioReal || "",
      updatedAt: serverTimestamp(),
    });
  });
}

/* ───── Dispatchers: servidor (Cloud Functions) o cliente, según el flag ───── */
export async function cerrarReserva(reservaId, patch = {}) {
  return USE_CLOUD_FUNCTIONS ? cerrarReservaFn(reservaId, patch) : cerrarReservaLocal(reservaId, patch);
}
export async function reabrirReserva(reservaId) {
  return USE_CLOUD_FUNCTIONS ? reabrirReservaFn(reservaId) : reabrirReservaLocal(reservaId);
}
export async function iniciarReserva(reservaId, horaInicioReal) {
  return USE_CLOUD_FUNCTIONS ? iniciarReservaFn(reservaId, horaInicioReal) : iniciarReservaLocal(reservaId, horaInicioReal);
}
