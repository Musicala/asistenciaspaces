/* services/statsService.js — Asistencia Spaces
   Calcula estadísticas para dashboards (general / por cliente / por paquete).
   Lee de los repos y agrega en memoria. Pensado para volúmenes pyme.
*/

import { listClientes } from "../data/clientesRepo.js";
import { listPaquetes, listPaquetesByCliente } from "../data/paquetesRepo.js";
import { listReservas, listReservasByCliente, listReservasByPaquete } from "../data/reservasRepo.js";
import { listAsistencia } from "../data/asistenciaRepo.js";
import { ESTADO_PAQUETE, ESTADO_RESERVA } from "../core/constants.js";
import { calcularEstadoPaquete } from "./consumoService.js";
import { todayISO, esVencida, minToHoras } from "../core/time.js";

const sum = (arr, f) => arr.reduce((a, x) => a + (Number(f(x)) || 0), 0);

/** Dashboard general — todas las estadísticas requeridas. */
export async function statsGenerales() {
  const [clientes, paquetes, reservas] = await Promise.all([
    listClientes(),
    listPaquetes(),
    listReservas(),
  ]);

  const hoy = todayISO();
  const paquetesActivos = paquetes.filter((p) => calcularEstadoPaquete(p) !== ESTADO_PAQUETE.AGOTADO && !esVencida(p.fechaVencimiento));

  const minVendidos = sum(paquetes, (p) => p.minutosComprados);
  const minConsumidos = sum(paquetes, (p) => p.minutosConsumidos);
  const minRestantes = sum(paquetes, (p) => Math.max(0, (p.minutosComprados || 0) - (p.minutosConsumidos || 0)));
  const minExcedidos = sum(paquetes, (p) => p.minutosExcedidos);

  const reservasHoy = reservas.filter((r) => r.fecha === hoy);
  const proximas = reservas
    .filter((r) => r.fecha > hoy && r.estado !== ESTADO_RESERVA.CANCELADA)
    .sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)));
  const sinCerrar = reservas.filter(
    (r) => r.fecha <= hoy && r.estado !== ESTADO_RESERVA.CERRADA && r.estado !== ESTADO_RESERVA.CANCELADA
  );

  const porAgotarse = paquetes.filter((p) => calcularEstadoPaquete(p) === ESTADO_PAQUETE.POR_AGOTARSE);
  const vencidos = paquetes.filter((p) => esVencida(p.fechaVencimiento));
  const excedentesPendientes = paquetes.filter(
    (p) => (Number(p.minutosExcedidos) || 0) - (Number(p.excedenteCobradoMin) || 0) > 0
  );

  return {
    clientesActivos: clientes.filter((c) => c.estado !== "inactivo").length,
    clientesTotal: clientes.length,
    paquetesActivos: paquetesActivos.length,
    paquetesTotal: paquetes.length,

    horasVendidas: minToHoras(minVendidos),
    horasConsumidas: minToHoras(minConsumidos),
    horasRestantes: minToHoras(minRestantes),
    horasExcedidas: minToHoras(minExcedidos),

    reservasHoy: reservasHoy.length,
    reservasHoyList: reservasHoy,
    proximasReservas: proximas.length,
    proximasReservasList: proximas.slice(0, 10),
    reservasSinCerrar: sinCerrar.length,
    reservasSinCerrarList: sinCerrar,

    paquetesPorAgotarse: porAgotarse,
    paquetesVencidos: vencidos,
    excedentesPendientes: excedentesPendientes,
  };
}

/** Dashboard por cliente. */
export async function statsCliente(clienteId) {
  const [paquetes, reservas] = await Promise.all([
    listPaquetesByCliente(clienteId),
    listReservasByCliente(clienteId),
  ]);

  // Asistencia acumulada del cliente (suma sobre sus reservas)
  let totalAsistencias = 0;
  for (const r of reservas) {
    try {
      const a = await listAsistencia(r.id);
      totalAsistencias += a.filter((x) => x.estado === "presente" || x.estado === "tarde").length;
    } catch (_) { /* ignora reservas sin subcolección */ }
  }

  return {
    paquetes,
    reservas,
    horasVendidas: minToHoras(sum(paquetes, (p) => p.minutosComprados)),
    horasConsumidas: minToHoras(sum(paquetes, (p) => p.minutosConsumidos)),
    horasRestantes: minToHoras(sum(paquetes, (p) => Math.max(0, (p.minutosComprados || 0) - (p.minutosConsumidos || 0)))),
    horasExcedidas: minToHoras(sum(paquetes, (p) => p.minutosExcedidos)),
    reservasTotal: reservas.length,
    reservasCerradas: reservas.filter((r) => r.estado === ESTADO_RESERVA.CERRADA).length,
    asistenciaAcumulada: totalAsistencias,
  };
}

/** Dashboard por paquete — consumo + comparación programado vs real. */
export async function statsPaquete(paqueteId) {
  const reservas = await listReservasByPaquete(paqueteId);
  const programado = sum(reservas, (r) => r.minutosProgramados);
  const real = sum(reservas, (r) => r.minutosReales);
  const cobrado = sum(reservas, (r) => r.minutosCobrados);

  return {
    reservas,
    minutosProgramados: programado,
    minutosReales: real,
    minutosCobrados: cobrado,
    horasProgramadas: minToHoras(programado),
    horasReales: minToHoras(real),
    horasCobradas: minToHoras(cobrado),
    desviacionMin: real - programado,
  };
}
