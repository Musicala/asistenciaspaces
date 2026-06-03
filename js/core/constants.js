/* core/constants.js — Asistencia Spaces (Firebase edition)
   Constantes configurables. NINGÚN TODO ambiguo: si falta un dato de negocio,
   se define aquí como constante clara y editable.
*/

// Correos autorizados (allowlist). Solo estos pueden entrar (login con Google).
// Para agregar/quitar usuarios basta con editar esta lista.
export const AUTHORIZED_EMAILS = [
  "alekcaballeromusic@gmail.com",
  "catalina.medina.leal@gmail.com",
  "imusicala@gmail.com",
  "musicalaasesor@gmail.com",
];

// Roles por correo (opcional). Si un correo no está aquí, recibe ROLE_DEFAULT.
// Roles: 'admin' | 'asistente'
export const ROLE_BY_EMAIL = {
  "alekcaballeromusic@gmail.com": "admin",
  "catalina.medina.leal@gmail.com": "asistente",
  "imusicala@gmail.com": "admin",
  "musicalaasesor@gmail.com": "asistente",
};
export const ROLE_DEFAULT = "asistente";

// Nombres de colecciones Firestore (centralizado para evitar typos).
export const COLLECTIONS = Object.freeze({
  clientes: "clientes",
  paquetes: "paquetes",
  reservas: "reservas",
  asistentes: "asistentes",
  asistencia: "asistencia", // subcolección de reservas/{id}/asistencia
  pagos: "pagos",
  auditLogs: "auditLogs",
  usuarios: "usuarios",
});

// ─────────────────────────────────────────────────────────────
// Cloud Functions (seguridad del consumo)
// Si true, el cierre/reapertura de reservas y el registro de pagos se hacen
// vía Cloud Functions (servidor), no en el cliente. Actívalo SOLO después de:
//   1) tener plan Blaze, 2) `firebase deploy --only functions`,
//   3) desplegar firestore.rules.strict (que bloquea los campos de consumo).
// Mientras sea false, todo funciona en el cliente (transacción Firestore).
export const USE_CLOUD_FUNCTIONS = false;
export const FUNCTIONS_REGION = "us-central1";

// Pagos / cobros
export const CONCEPTO_PAGO = Object.freeze({
  PAQUETE: "paquete",       // pago del paquete de horas
  EXCEDENTE: "excedente",   // cobro de horas excedidas
  OTRO: "otro",
});
export const METODO_PAGO = Object.freeze({
  EFECTIVO: "efectivo",
  TRANSFERENCIA: "transferencia",
  TARJETA: "tarjeta",
  OTRO: "otro",
});
export const ESTADO_PAGO = Object.freeze({
  PENDIENTE: "pendiente",
  PAGADO: "pagado",
  PARCIAL: "parcial",
});

// Regla de cobro por defecto para paquetes nuevos (editable por paquete).
export const REGLA_COBRO_DEFAULT = Object.freeze({
  redondeoMin: 15,       // redondea consumo hacia arriba en bloques de N minutos
  graciaMin: 10,         // minutos de gracia que no se cobran
  cobrarExcedente: true, // si true, lo que supera lo comprado se marca como excedido
});

// Umbral por defecto para alerta "por agotarse" (minutos restantes).
export const ALERTA_SALDO_MIN_DEFAULT = 120; // 2 horas

// Estados de paquete.
export const ESTADO_PAQUETE = Object.freeze({
  ACTIVO: "activo",
  POR_AGOTARSE: "por_agotarse",
  AGOTADO: "agotado",
  VENCIDO: "vencido",
  EXCEDIDO: "excedido",
});

// Estados de reserva.
export const ESTADO_RESERVA = Object.freeze({
  PROGRAMADA: "programada",
  EN_CURSO: "en_curso",
  CERRADA: "cerrada",
  CANCELADA: "cancelada",
});

// Estados de asistencia por asistente.
export const ESTADO_ASISTENCIA = Object.freeze({
  PRESENTE: "presente",
  AUSENTE: "ausente",
  TARDE: "tarde",
  SIN_MARCAR: "sin_marcar",
});

// Tipos de cliente.
export const TIPO_CLIENTE = Object.freeze({
  PERSONA: "persona",
  EMPRESA: "empresa",
});

// Acciones de auditoría (vocabulario controlado).
export const AUDIT_ACCION = Object.freeze({
  CREATE: "create",
  UPDATE: "update",
  DELETE: "delete",
  CIERRE_RESERVA: "cierre_reserva",
  REAPERTURA_RESERVA: "reapertura_reserva",
  AJUSTE_CONSUMO: "ajuste_consumo",
  REGISTRO_PAGO: "registro_pago",
  ANULACION_PAGO: "anulacion_pago",
});
