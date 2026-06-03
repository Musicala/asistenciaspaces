/* functions/index.js — Spaces Manager (Cloud Functions, gen 2)
   Lógica sensible del lado servidor: cierre/reapertura de reservas, inicio y
   cobro de excedentes. Verifica que el usuario esté en el allowlist.
   Espejo de js/services/consumoService.js + js/data/pagosRepo.js.
*/

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

initializeApp();
const db = getFirestore();

// ── Mantener sincronizado con js/core/constants.js (AUTHORIZED_EMAILS) ──
const AUTHORIZED_EMAILS = [
  "alekcaballeromusic@gmail.com",
  "catalina.medina.leal@gmail.com",
  "imusicala@gmail.com",
  "musicalaasesor@gmail.com",
];
const REGION = "us-central1";

function requireAuth(request) {
  const email = request.auth && request.auth.token && request.auth.token.email;
  const verified = request.auth && request.auth.token && request.auth.token.email_verified;
  if (!request.auth || !email || !verified || !AUTHORIZED_EMAILS.includes(String(email).toLowerCase())) {
    throw new HttpsError("permission-denied", "Usuario no autorizado.");
  }
  return { uid: request.auth.uid, email, nombre: request.auth.token.name || email };
}

/* ── helpers de tiempo (espejo de core/time.js) ── */
function hhmmToMin(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || "").trim());
  if (!m) return null;
  const hh = +m[1], mm = +m[2];
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}
function duracionMin(a, b) {
  const x = hhmmToMin(a), y = hhmmToMin(b);
  if (x === null || y === null) return null;
  return y - x > 0 ? y - x : null;
}
function aplicarReglaCobro(brutos, regla = {}) {
  const bruto = Math.max(0, Math.round(Number(brutos) || 0));
  const gracia = Math.max(0, Number(regla.graciaMin) || 0);
  const bloque = Math.max(1, Number(regla.redondeoMin) || 1);
  const m = bruto - gracia;
  if (m <= 0) return 0;
  return Math.ceil(m / bloque) * bloque;
}
function esVencida(iso) {
  const s = String(iso || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return s < today;
}
function calcularEstadoPaquete(p) {
  const comprados = +p.minutosComprados || 0;
  const consumidos = +p.minutosConsumidos || 0;
  const restantes = comprados - consumidos;
  const alerta = +p.alertaSaldoMin || 0;
  if (esVencida(p.fechaVencimiento)) return "vencido";
  if (consumidos > comprados) return "excedido";
  if (restantes <= 0) return "agotado";
  if (restantes <= alerta) return "por_agotarse";
  return "activo";
}
function calcularConsumoReserva(r, p) {
  let reales = duracionMin(r.horaInicioReal, r.horaFinReal) || +r.minutosReales || 0;
  if (!reales) reales = +r.minutosProgramados || duracionMin(r.horaInicioProgramada, r.horaFinProgramada) || 0;
  return { minutosReales: reales, minutosCobrados: aplicarReglaCobro(reales, p.reglaCobro || {}) };
}

async function audit(entidad, entidadId, accion, despues, user) {
  await db.collection("auditLogs").add({
    entidad, entidadId, accion, antes: null, despues: despues || null,
    usuarioId: user.uid, usuarioNombre: user.nombre, createdAt: FieldValue.serverTimestamp(),
  });
}

/* ─────────────────────── cerrarReserva ─────────────────────── */
exports.cerrarReserva = onCall({ region: REGION }, async (request) => {
  const user = requireAuth(request);
  const { reservaId, patch = {} } = request.data || {};
  if (!reservaId) throw new HttpsError("invalid-argument", "Falta reservaId.");

  const reservaRef = db.collection("reservas").doc(reservaId);
  const result = await db.runTransaction(async (tx) => {
    const rSnap = await tx.get(reservaRef);
    if (!rSnap.exists) throw new HttpsError("not-found", "La reserva no existe.");
    const reserva = rSnap.data();
    if (!reserva.paqueteId) throw new HttpsError("failed-precondition", "Reserva sin paquete.");

    const paqueteRef = db.collection("paquetes").doc(reserva.paqueteId);
    const pSnap = await tx.get(paqueteRef);
    if (!pSnap.exists) throw new HttpsError("not-found", "El paquete no existe.");
    const paquete = pSnap.data();

    const rAct = {
      ...reserva,
      horaInicioReal: patch.horaInicioReal != null ? patch.horaInicioReal : reserva.horaInicioReal,
      horaFinReal: patch.horaFinReal != null ? patch.horaFinReal : reserva.horaFinReal,
      observaciones: patch.observaciones != null ? patch.observaciones : reserva.observaciones,
    };
    const { minutosReales, minutosCobrados } = calcularConsumoReserva(rAct, paquete);

    const cobradoAnterior = reserva.estado === "cerrada" ? (+reserva.minutosCobrados || 0) : 0;
    const consumidosPrev = +paquete.minutosConsumidos || 0;
    const nuevoConsumido = Math.max(0, consumidosPrev - cobradoAnterior + minutosCobrados);
    const comprados = +paquete.minutosComprados || 0;
    const estado = calcularEstadoPaquete({ ...paquete, minutosConsumidos: nuevoConsumido });
    const excedidoReserva =
      Math.max(0, consumidosPrev - cobradoAnterior + minutosCobrados - comprados) -
      Math.max(0, consumidosPrev - cobradoAnterior - comprados);

    tx.update(paqueteRef, {
      minutosConsumidos: nuevoConsumido,
      minutosRestantes: comprados - nuevoConsumido,
      minutosExcedidos: Math.max(0, nuevoConsumido - comprados),
      estado,
      updatedAt: FieldValue.serverTimestamp(),
    });
    tx.update(reservaRef, {
      estado: "cerrada",
      horaInicioReal: rAct.horaInicioReal,
      horaFinReal: rAct.horaFinReal,
      observaciones: rAct.observaciones,
      minutosReales,
      minutosCobrados,
      minutosExcedidos: Math.max(0, excedidoReserva),
      updatedAt: FieldValue.serverTimestamp(),
    });

    return {
      reserva: { minutosReales, minutosCobrados },
      paquete: { minutosConsumidos: nuevoConsumido, minutosRestantes: comprados - nuevoConsumido, minutosExcedidos: Math.max(0, nuevoConsumido - comprados), estado },
    };
  });

  await audit("reserva", reservaId, "cierre_reserva", result, user);
  return result;
});

/* ─────────────────────── reabrirReserva ─────────────────────── */
exports.reabrirReserva = onCall({ region: REGION }, async (request) => {
  const user = requireAuth(request);
  const { reservaId } = request.data || {};
  if (!reservaId) throw new HttpsError("invalid-argument", "Falta reservaId.");

  const reservaRef = db.collection("reservas").doc(reservaId);
  await db.runTransaction(async (tx) => {
    const rSnap = await tx.get(reservaRef);
    if (!rSnap.exists) throw new HttpsError("not-found", "La reserva no existe.");
    const reserva = rSnap.data();
    if (reserva.estado !== "cerrada") throw new HttpsError("failed-precondition", "La reserva no está cerrada.");

    const paqueteRef = db.collection("paquetes").doc(reserva.paqueteId);
    const pSnap = await tx.get(paqueteRef);
    if (pSnap.exists) {
      const p = pSnap.data();
      const cobrado = +reserva.minutosCobrados || 0;
      const comprados = +p.minutosComprados || 0;
      const nuevoConsumido = Math.max(0, (+p.minutosConsumidos || 0) - cobrado);
      tx.update(paqueteRef, {
        minutosConsumidos: nuevoConsumido,
        minutosRestantes: comprados - nuevoConsumido,
        minutosExcedidos: Math.max(0, nuevoConsumido - comprados),
        estado: calcularEstadoPaquete({ ...p, minutosConsumidos: nuevoConsumido }),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    tx.update(reservaRef, {
      estado: "programada", minutosCobrados: 0, minutosExcedidos: 0,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });

  await audit("reserva", reservaId, "reapertura_reserva", null, user);
  return { ok: true };
});

/* ─────────────────────── iniciarReserva ─────────────────────── */
exports.iniciarReserva = onCall({ region: REGION }, async (request) => {
  const user = requireAuth(request);
  const { reservaId, horaInicioReal } = request.data || {};
  if (!reservaId) throw new HttpsError("invalid-argument", "Falta reservaId.");
  const ref = db.collection("reservas").doc(reservaId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "La reserva no existe.");
  await ref.update({
    estado: "en_curso",
    horaInicioReal: horaInicioReal || snap.data().horaInicioReal || "",
    updatedAt: FieldValue.serverTimestamp(),
  });
  return { ok: true };
});

/* ─────────────────────── cobrarExcedente ─────────────────────── */
exports.cobrarExcedente = onCall({ region: REGION }, async (request) => {
  const user = requireAuth(request);
  const { paqueteId, metodo, fecha, notas } = request.data || {};
  if (!paqueteId) throw new HttpsError("invalid-argument", "Falta paqueteId.");

  const paqueteRef = db.collection("paquetes").doc(paqueteId);
  const pagoRef = db.collection("pagos").doc();
  const result = await db.runTransaction(async (tx) => {
    const pSnap = await tx.get(paqueteRef);
    if (!pSnap.exists) throw new HttpsError("not-found", "El paquete no existe.");
    const p = pSnap.data();
    const pendiente = Math.max(0, (+p.minutosExcedidos || 0) - (+p.excedenteCobradoMin || 0));
    if (pendiente <= 0) throw new HttpsError("failed-precondition", "Sin excedente pendiente.");

    const valorMinExtra = (+p.valorHoraExtra || +p.valorHora || 0) / 60;
    const monto = Math.round(pendiente * valorMinExtra);
    tx.set(pagoRef, {
      clienteId: p.clienteId || "", paqueteId, reservaId: "",
      concepto: "excedente", monto, metodo: metodo || "otro", fecha: fecha || "",
      estado: "pagado", notas: notas || `Cobro de ${pendiente} min excedidos`,
      createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    });
    tx.update(paqueteRef, {
      excedenteCobradoMin: (+p.excedenteCobradoMin || 0) + pendiente,
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { pagoId: pagoRef.id, minutosCobrados: pendiente, monto };
  });

  await audit("paquete", paqueteId, "registro_pago", result, user);
  return result;
});

/* ─────────── Recalcular estados de paquetes (diario 06:00) ─────────── */
exports.recalcularEstadosPaquetes = onSchedule(
  { schedule: "0 6 * * *", timeZone: "America/Bogota", region: REGION },
  async () => {
    const snap = await db.collection("paquetes").get();
    let cambios = 0;
    const batch = db.batch();
    snap.forEach((d) => {
      const p = d.data();
      const nuevo = calcularEstadoPaquete(p);
      if (nuevo !== p.estado) {
        batch.update(d.ref, { estado: nuevo, updatedAt: FieldValue.serverTimestamp() });
        cambios++;
      }
    });
    if (cambios) await batch.commit();
    console.log(`recalcularEstadosPaquetes: ${cambios} paquetes actualizados`);
    return null;
  }
);
