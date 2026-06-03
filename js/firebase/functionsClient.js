/* firebase/functionsClient.js — Llamadas a Cloud Functions (callable)
   Solo se usan cuando USE_CLOUD_FUNCTIONS === true. Cada wrapper expone la
   misma firma que su equivalente cliente para intercambiarlos sin fricción.
*/

import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js";
import { functions } from "./config.js";

const call = (name) => httpsCallable(functions, name);

export async function cerrarReservaFn(reservaId, patch) {
  const res = await call("cerrarReserva")({ reservaId, patch });
  return res.data;
}

export async function reabrirReservaFn(reservaId) {
  const res = await call("reabrirReserva")({ reservaId });
  return res.data;
}

export async function iniciarReservaFn(reservaId, horaInicioReal) {
  const res = await call("iniciarReserva")({ reservaId, horaInicioReal });
  return res.data;
}

export async function cobrarExcedenteFn(paqueteId, opts) {
  const res = await call("cobrarExcedente")({ paqueteId, ...opts });
  return res.data;
}
