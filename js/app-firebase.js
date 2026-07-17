/* app-firebase.js — Asistencia Spaces (Firebase edition)
   Orquestador: auth gate, navegación, vistas y modales.
   Reusa styles.css + styles-spaces.css. Sin frameworks, sin build.
*/

import { onAuth, signInGoogle, signOut } from "./firebase/auth.js";
import * as Clientes from "./data/clientesRepo.js";
import * as Paquetes from "./data/paquetesRepo.js";
import * as Reservas from "./data/reservasRepo.js";
import * as Asistentes from "./data/asistentesRepo.js";
import { db, collection, onSnapshot } from "./data/base.js";
import * as Asistencia from "./data/asistenciaRepo.js";
import * as Pagos from "./data/pagosRepo.js";
import * as Portal from "./data/portalRepo.js";
import * as Audit from "./data/auditRepo.js";
import * as Consumo from "./services/consumoService.js";
import * as Stats from "./services/statsService.js";
import * as Importer from "./services/importService.js";
import { descargarCSV } from "./services/exportService.js";
import { loadIncludedData, fetchLegacyFromAppsScript, migrateLegacy, LEGACY_DEFAULTS } from "./services/legacyImport.js";
import {
  TIPO_CLIENTE, ESTADO_RESERVA, ESTADO_ASISTENCIA, REGLA_COBRO_DEFAULT,
  CONCEPTO_PAGO, METODO_PAGO, CATEGORIA_PAQUETE,
} from "./core/constants.js";
import {
  todayISO, fmtFecha, fmtHM, fechasRecurrentes, hhmmToMin,
} from "./core/time.js";

/* ───────────────────────── helpers ───────────────────────── */
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));

function toast(msg, type = "ok") {
  const host = $("#toastHost");
  if (!host) return;
  const t = document.createElement("div");
  t.className = `toast ${type}`;
  t.innerHTML = `<div class="dot"></div><div class="msg">${esc(msg)}</div>`;
  host.appendChild(t);
  setTimeout(() => t.remove(), 3400);
}

// Modal de formulario reutilizable. Devuelve objeto con valores o null.
function openForm({ title, okText = "Guardar", fields = [], values = {}, extraHTML = "", onMount = null }) {
  const modal = $("#appModal");
  $("#appModalTitle").textContent = title;
  $("#appModalOk").textContent = okText;
  const body = $("#appModalBody");
  const msg = $("#appModalMsg");
  msg.style.display = "none"; msg.textContent = "";

  body.innerHTML = fields.map((f) => {
    const v = values[f.name] ?? f.value ?? "";
    const cls = f.full ? "" : "";
    if (f.type === "select") {
      const opts = (f.options || []).map((o) =>
        `<option value="${esc(o.value)}" ${String(o.value) === String(v) ? "selected" : ""}>${esc(o.label)}</option>`).join("");
      return `<label class="${cls}">${esc(f.label)}<select name="${f.name}">${opts}</select></label>`;
    }
    if (f.type === "textarea") {
      return `<label>${esc(f.label)}<textarea name="${f.name}" rows="2" placeholder="${esc(f.placeholder || "")}">${esc(v)}</textarea></label>`;
    }
    return `<label>${esc(f.label)}<input name="${f.name}" type="${f.type || "text"}" value="${esc(v)}" placeholder="${esc(f.placeholder || "")}" ${f.step ? `step="${f.step}"` : ""} /></label>`;
  }).join("") + (extraHTML || "");

  // agrupa en grid-2 los campos marcados con f.half (simplificado: dejamos grid natural)
  return new Promise((resolve) => {
    const form = $("#appModalForm");
    const onCancel = () => { cleanup(); modal.close(); resolve(null); };
    const onSubmit = (ev) => {
      ev.preventDefault();
      const data = {};
      fields.forEach((f) => {
        const elx = form.querySelector(`[name="${f.name}"]`);
        data[f.name] = elx ? elx.value.trim() : "";
      });
      // validación required
      const faltante = fields.find((f) => f.required && !data[f.name]);
      if (faltante) { msg.textContent = `Falta: ${faltante.label}`; msg.style.display = "block"; return; }
      cleanup(); modal.close(); resolve(data);
    };
    function cleanup() {
      form.removeEventListener("submit", onSubmit);
      $("#appModalCancel").removeEventListener("click", onCancel);
    }
    form.addEventListener("submit", onSubmit);
    $("#appModalCancel").addEventListener("click", onCancel);
    modal.showModal();
    if (typeof onMount === "function") { try { onMount(form); } catch (e) { console.error(e); } }
  });
}

async function withBusy(fn) {
  startLoading();
  try { return await fn(); }
  catch (e) { console.error(e); toast(e?.message || "Ocurrió un error", "bad"); throw e; }
  finally { stopLoading(); }
}

/* ───────────────────────── roles ───────────────────────── */
let currentRole = "asistente";
const isAdmin = () => currentRole === "admin";
const canWrite = () => currentRole === "admin" || currentRole === "asistente";
const adminOnly = (label) => {
  toast(`${label} es solo para administradores.`, "warn");
  navTo("dashboard");
};
// Acciones de escritura (permitidas para admin y asistente).
const WRITE_ACTS = new Set([
  "nuevo-cliente", "edit-cliente", "del-cliente",
  "nuevo-paquete", "del-paquete",
  "nuevo-asistente", "edit-asistente", "importar-asistentes",
  "nueva-reserva", "nueva-reserva-masiva", "edit-reserva", "del-reserva",
  "cancelar-reserva", "iniciar-reserva", "cerrar-reserva", "reabrir-reserva",
  "marcar-asistencia", "nuevo-pago", "anular-pago", "cobrar-excedente",
  "portal-acceso",
]);

/* ───────────────────────── tiempo real ───────────────────────── */
let rtUnsubs = [];
let rtTimer = null;

function startRealtime() {
  stopRealtime();
  const cols = ["clientes", "paquetes", "reservas", "pagos"];
  // Ignora el primer disparo (carga inicial) para no re-renderizar de más.
  let pending = cols.length;
  rtUnsubs = cols.map((c) =>
    onSnapshot(collection(db, c), () => {
      if (pending > 0) { pending--; return; }
      scheduleRtRender();
    }, (err) => console.warn("[realtime]", c, err?.message))
  );
}

function stopRealtime() {
  rtUnsubs.forEach((u) => { try { u(); } catch (_) {} });
  rtUnsubs = [];
  if (rtTimer) clearTimeout(rtTimer);
}

function scheduleRtRender() {
  if (rtTimer) clearTimeout(rtTimer);
  rtTimer = setTimeout(() => {
    // No interrumpir si hay un modal abierto o el usuario está escribiendo.
    if (document.querySelector("dialog[open]")) return;
    const ae = document.activeElement;
    if (ae && ["INPUT", "TEXTAREA", "SELECT"].includes(ae.tagName) && ROOT().contains(ae)) return;
    render();
  }, 500);
}

/* ───────────────────────── router ───────────────────────── */
const ROOT = () => $("#viewRoot");
let route = { name: "dashboard", params: {} };

function navTo(name, params = {}) {
  if ((name === "importar" || name === "auditoria") && !isAdmin()) {
    adminOnly(name === "importar" ? "Importar" : "Auditoria");
    return;
  }
  route = { name, params };
  document.querySelectorAll(".nav-btn").forEach((b) =>
    b.classList.toggle("active", b.dataset.nav === name || (name === "cliente" && b.dataset.nav === "clientes")));
  render();
}

// Barra de progreso global: soporta llamadas anidadas con un contador.
let loadingCount = 0;
function startLoading() {
  loadingCount++;
  const bar = $("#loadingBar");
  if (bar) bar.hidden = false;
}
function stopLoading() {
  loadingCount = Math.max(0, loadingCount - 1);
  if (loadingCount === 0) {
    const bar = $("#loadingBar");
    if (bar) bar.hidden = true;
  }
}

async function render() {
  const root = ROOT();
  root.innerHTML = `<div class="loading-block"><span class="loading-spinner"></span>Cargando información…</div>`;
  startLoading();
  try {
    if (route.name === "dashboard") return root.replaceChildren(...(await viewDashboard()));
    if (route.name === "clientes") return root.replaceChildren(...(await viewClientes()));
    if (route.name === "cliente") return root.replaceChildren(...(await viewCliente(route.params.id)));
    if (route.name === "reservas") return root.replaceChildren(...(await viewReservas()));
    if (route.name === "cobros") return root.replaceChildren(...(await viewCobros()));
    if (route.name === "alertas") return root.replaceChildren(...(await viewAlertas()));
    if (route.name === "auditoria") {
      if (!isAdmin()) return root.replaceChildren(...frag(`<div class="card"><div class="empty">Solo administradores pueden ver la auditoria.</div></div>`));
      return root.replaceChildren(...(await viewAuditoria()));
    }
    if (route.name === "importar") {
      if (!isAdmin()) return root.replaceChildren(...frag(`<div class="card"><div class="empty">Solo administradores pueden importar datos.</div></div>`));
      return root.replaceChildren(...(await viewImportar()));
    }
  } catch (e) {
    console.error(e);
    root.innerHTML = `<div class="card"><div class="empty">No se pudo cargar: ${esc(e?.message || e)}</div></div>`;
  } finally {
    stopLoading();
  }
}

// Convierte un fragmento HTML en nodos para replaceChildren.
function frag(html) {
  const tpl = document.createElement("template");
  tpl.innerHTML = html;
  return Array.from(tpl.content.childNodes);
}

/* ───────────────────────── DASHBOARD ───────────────────────── */
function kpi(label, value, sub = "", accent = "") {
  return `<div class="kpi ${accent ? "accent-" + accent : ""}">
    <div class="kpi-label">${esc(label)}</div>
    <div class="kpi-value">${esc(value)}</div>
    ${sub ? `<div class="kpi-sub">${esc(sub)}</div>` : ""}
  </div>`;
}

async function viewDashboard() {
  setContext("Dashboard general");
  const s = await Stats.statsGenerales();

  const html = `
    <div class="kpi-grid">
      ${kpi("Clientes activos", s.clientesActivos, `${s.clientesTotal} en total`, "mozart")}
      ${kpi("Paquetes activos", s.paquetesActivos, `${s.paquetesTotal} en total`, "")}
      ${kpi("Horas vendidas", s.horasVendidas, "", "")}
      ${kpi("Horas consumidas", s.horasConsumidas, "", "")}
      ${kpi("Horas restantes", s.horasRestantes, "", "ok")}
      ${kpi("Horas excedidas", s.horasExcedidas, "", s.horasExcedidas > 0 ? "brahms" : "")}
      ${kpi("Reservas de hoy", s.reservasHoy, "", "mozart")}
      ${kpi("Próximas reservas", s.proximasReservas, "siguientes días", "")}
      ${kpi("Reservas sin cerrar", s.reservasSinCerrar, "requieren cierre", s.reservasSinCerrar > 0 ? "warn" : "")}
      ${kpi("Excedentes por cobrar", s.excedentesPendientes.length, "paquetes", s.excedentesPendientes.length ? "bad" : "")}
    </div>

    <div class="card">
      <div class="toolbar">
        <div class="section-title" style="margin:0">Alertas rápidas</div>
        <button class="btn-secondary btn-sm" data-act="goto-alertas">Ver todas</button>
      </div>
      ${alertasResumen(s)}
    </div>

    <div class="card">
      <div class="section-title" style="margin:0 0 10px">Reservas sin cerrar</div>
      ${s.reservasSinCerrarList.length ? listaReservasHTML(s.reservasSinCerrarList) : `<div class="empty">Todo cerrado ✅</div>`}
    </div>`;
  return frag(html);
}

function alertasResumen(s) {
  const items = [
    [`Paquetes por agotarse`, s.paquetesPorAgotarse.length, "warn"],
    [`Paquetes vencidos`, s.paquetesVencidos.length, "bad"],
    [`Excedentes pendientes`, s.excedentesPendientes.length, "bad"],
    [`Reservas sin cerrar`, s.reservasSinCerrar, "warn"],
  ];
  return `<div class="kpi-grid">${items.map(([l, n, a]) =>
    kpi(l, n, "", n > 0 ? a : "")).join("")}</div>`;
}

/* ───────────────────────── CLIENTES ───────────────────────── */
async function viewClientes() {
  setContext("Clientes");
  const clientes = await Clientes.listClientes();
  const html = `
    <div class="card">
      <div class="toolbar">
        <div class="left">
          <input id="buscarCliente" class="search-input" placeholder="Buscar cliente…" />
        </div>
        <div>
          ${isAdmin() ? `<button class="btn-secondary btn-sm" data-act="export-clientes">Exportar CSV</button>` : ""}
          <button class="btn-primary" data-act="nuevo-cliente">+ Nuevo cliente</button>
        </div>
      </div>
      <div class="list-grid" id="clientesList">
        ${clientes.length ? clientes.map(clienteRowHTML).join("") : `<div class="empty">Aún no hay clientes. Crea el primero 👆</div>`}
      </div>
    </div>`;
  const nodes = frag(html);
  // guardar para filtro
  queueMicrotask(() => {
    const inp = $("#buscarCliente");
    inp?.addEventListener("input", () => {
      const q = inp.value.toLowerCase();
      $("#clientesList").innerHTML = clientes
        .filter((c) => [c.nombre, c.email, c.nitDocumento, c.telefono].join(" ").toLowerCase().includes(q))
        .map(clienteRowHTML).join("") || `<div class="empty">Sin resultados.</div>`;
    });
  });
  window.__clientesCache = clientes;
  return nodes;
}

function clienteRowHTML(c) {
  return `<div class="row-card clickable" data-act="open-cliente" data-id="${esc(c.id)}">
    <div class="main">
      <div class="title">${esc(c.nombre)}</div>
      <div class="sub">
        <span class="estado ${c.estado === "inactivo" ? "agotado" : "activo"}">${esc(c.estado || "activo")}</span>
        ${c.tipo ? `<span>${esc(c.tipo)}</span>` : ""}
        ${c.telefono ? `<span>📞 ${esc(c.telefono)}</span>` : ""}
        ${c.email ? `<span>✉️ ${esc(c.email)}</span>` : ""}
      </div>
    </div>
    <div class="actions">
      <button class="btn-secondary btn-sm" data-act="edit-cliente" data-id="${esc(c.id)}">Editar</button>
      <button class="btn-secondary btn-sm danger" data-act="del-cliente" data-id="${esc(c.id)}">Eliminar</button>
    </div>
  </div>`;
}

const clienteFields = (v = {}) => ([
  { name: "nombre", label: "Nombre / Razón social", required: true, value: v.nombre },
  { name: "tipo", label: "Tipo", type: "select", value: v.tipo || TIPO_CLIENTE.EMPRESA,
    options: [{ value: TIPO_CLIENTE.EMPRESA, label: "Empresa" }, { value: TIPO_CLIENTE.PERSONA, label: "Persona" }] },
  { name: "nitDocumento", label: "NIT / Documento", value: v.nitDocumento },
  { name: "contactoPrincipal", label: "Contacto principal", value: v.contactoPrincipal },
  { name: "telefono", label: "Teléfono", type: "tel", value: v.telefono },
  { name: "email", label: "Email", type: "email", value: v.email },
  { name: "direccion", label: "Dirección", value: v.direccion },
  { name: "notas", label: "Notas", type: "textarea", value: v.notas },
]);

async function nuevoCliente() {
  const data = await openForm({ title: "Nuevo cliente", fields: clienteFields() });
  if (!data) return;
  await withBusy(() => Clientes.createCliente(data));
  toast("Cliente creado ✅"); render();
}

async function editarCliente(id) {
  const c = await Clientes.getCliente(id);
  const data = await openForm({ title: "Editar cliente", fields: clienteFields(c), values: c,
    extraHTML: `<div class="dup-warning" style="margin-top:4px">💡 Los <b>paquetes/planes de horas</b> y los <b>participantes</b> se asignan abriendo la ficha del cliente (toca su tarjeta en la lista), no aquí.</div>` });
  if (!data) return;
  await withBusy(() => Clientes.updateCliente(id, data));
  toast("Cliente actualizado ✅"); render();
}

/* ───────────────────────── CLIENTE DETALLE ───────────────────────── */
// Pestaña activa en la ficha del cliente; se conserva entre re-renders.
let clienteTabActual = "reservas";

function clienteTabsHTML(counts) {
  const tabs = [
    ["reservas", "Reservas", counts.reservas],
    ["participantes", "Participantes", counts.participantes],
    ["paquetes", "Paquetes", counts.paquetes],
    ["pagos", "Pagos", counts.pagos],
  ];
  return `<div class="cliente-tabs">${tabs.map(([key, label, n]) =>
    `<button class="tab-btn ${clienteTabActual === key ? "active" : ""}" data-act="cliente-tab" data-tab="${key}">${label}${n ? ` <span class="tab-count">${n}</span>` : ""}</button>`
  ).join("")}</div>`;
}

function cambiarClienteTab(tab) {
  clienteTabActual = tab;
  document.querySelectorAll("[data-act='cliente-tab']").forEach((b) =>
    b.classList.toggle("active", b.dataset.tab === tab));
  document.querySelectorAll("[data-tabsec]").forEach((sec) => {
    sec.style.display = sec.dataset.tabsec === tab ? "" : "none";
  });
}

async function viewCliente(id) {
  const c = await Clientes.getCliente(id);
  if (!c) return frag(`<div class="card"><div class="empty">Cliente no encontrado.</div></div>`);
  setContext(`Cliente · ${c.nombre}`);

  const [st, paquetes, asistentes, reservas, pagos] = await Promise.all([
    Stats.statsCliente(id),
    Paquetes.listPaquetesByCliente(id),
    Asistentes.listAsistentesByCliente(id),
    Reservas.listReservasByCliente(id),
    Pagos.listPagosByCliente(id),
  ]);
  const totalPagado = pagos.reduce((a, p) => a + (Number(p.monto) || 0), 0);

  const html = `
    <button class="back-link" data-act="goto-clientes">← Clientes</button>
    <div class="card">
      <div class="toolbar">
        <div class="section-title" style="margin:0">${esc(c.nombre)}</div>
        <div class="actions">
          <button class="btn-secondary btn-sm" data-act="portal-acceso" data-id="${esc(id)}">🔑 Acceso al portal</button>
          <button class="btn-secondary btn-sm" data-act="edit-cliente" data-id="${esc(id)}">Editar cliente</button>
          <button class="btn-secondary btn-sm" data-act="del-cliente" data-id="${esc(id)}">Eliminar</button>
        </div>
      </div>
      <div class="kpi-grid">
        ${kpi("Horas vendidas", st.horasVendidas)}
        ${kpi("Consumidas", st.horasConsumidas)}
        ${kpi("Restantes", st.horasRestantes, "", "ok")}
        ${kpi("Excedidas", st.horasExcedidas, "", st.horasExcedidas > 0 ? "bad" : "")}
        ${kpi("Reservas", st.reservasTotal, `${st.reservasCerradas} cerradas`)}
        ${kpi("Asistencia acum.", st.asistenciaAcumulada)}
      </div>
    </div>

    ${clienteTabsHTML({ reservas: reservas.length, participantes: asistentes.length, paquetes: paquetes.length, pagos: pagos.length })}

    <div class="card" data-tabsec="paquetes" ${clienteTabActual === "paquetes" ? "" : `style="display:none"`}>
      <div class="toolbar">
        <div class="section-title" style="margin:0">Paquetes</div>
        <button class="btn-primary btn-sm" data-act="nuevo-paquete" data-id="${esc(id)}">+ Paquete</button>
      </div>
      <div class="list-grid">
        ${paquetes.length ? paquetes.map(paqueteRowHTML).join("") : `<div class="empty">Sin paquetes.</div>`}
      </div>
    </div>

    <div class="card" data-tabsec="reservas" ${clienteTabActual === "reservas" ? "" : `style="display:none"`}>
      <div class="toolbar">
        <div class="section-title" style="margin:0">Reservas del cliente</div>
        <button class="btn-primary btn-sm" data-act="nueva-reserva" data-id="${esc(id)}">+ Reserva</button>
      </div>
      ${reservas.length ? listaReservasHTML(reservas) : `<div class="empty">Sin reservas.</div>`}
    </div>

    <div class="card" data-tabsec="pagos" ${clienteTabActual === "pagos" ? "" : `style="display:none"`}>
      <div class="toolbar">
        <div class="section-title" style="margin:0">Pagos · total ${money(totalPagado)}</div>
        <button class="btn-primary btn-sm" data-act="nuevo-pago" data-id="${esc(id)}">+ Registrar pago</button>
      </div>
      <div class="list-grid">
        ${pagos.length ? pagos.map(pagoRowHTML).join("") : `<div class="empty">Sin pagos registrados.</div>`}
      </div>
    </div>

    <div class="card" data-tabsec="participantes" ${clienteTabActual === "participantes" ? "" : `style="display:none"`}>
      <div class="toolbar">
        <div class="section-title" style="margin:0">Participantes</div>
        <div class="actions">
          <button class="btn-secondary btn-sm" data-act="importar-asistentes" data-id="${esc(id)}">⇪ Importar lista</button>
          <button class="btn-primary btn-sm" data-act="nuevo-asistente" data-id="${esc(id)}">+ Participante</button>
        </div>
      </div>
      <div class="list-grid">
        ${asistentes.length ? asistentes.map(asistenteRowHTML).join("") : `<div class="empty">Sin participantes. Son las personas que asisten a las sesiones de este cliente.</div>`}
      </div>
    </div>`;
  window.__paquetesCache = paquetes;
  return frag(html);
}

function paqueteRowHTML(p) {
  const comprados = Number(p.minutosComprados) || 0;
  const consumidos = Number(p.minutosConsumidos) || 0;
  const pct = comprados ? Math.min(100, Math.round((consumidos / comprados) * 100)) : 0;
  const estado = Consumo.calcularEstadoPaquete(p);
  const fillCls = estado === "excedido" || estado === "agotado" ? "bad" : (estado === "por_agotarse" ? "warn" : "");
  const pendiente = Pagos.excedentePendienteMin(p);
  return `<div class="row-card">
    <div class="main">
      <div class="title">${esc(p.nombre)} <span class="estado ${p.categoria === CATEGORIA_PAQUETE.VACACIONAL ? "por_agotarse" : "activo"}">${p.categoria === CATEGORIA_PAQUETE.VACACIONAL ? "vacacional" : "regular"}</span> <span class="estado ${estado}">${estado.replace("_", " ")}</span></div>
      <div class="sub">
        ${p.fechaVencimiento ? `<span>Vence: ${esc(fmtFecha(p.fechaVencimiento))}</span>` : ""}
        ${p.valorPagado ? `<span>$${esc(Number(p.valorPagado).toLocaleString("es-CO"))}</span>` : ""}
        ${p.minutosExcedidos ? `<span style="color:var(--brahms)">Excedido: ${fmtHM(p.minutosExcedidos)}</span>` : ""}
        ${pendiente > 0 ? `<span style="color:var(--bad)">Por cobrar: ${fmtHM(pendiente)}</span>` : (p.excedenteCobradoMin ? `<span style="color:var(--ok)">Excedente cobrado ✓</span>` : "")}
      </div>
      <div class="progress"><div class="progress-fill ${fillCls}" style="width:${pct}%"></div></div>
      <div class="progress-legend">
        <span>${fmtHM(consumidos)} consumidas</span>
        <span>${fmtHM(Math.max(0, comprados - consumidos))} restantes de ${fmtHM(comprados)}</span>
      </div>
    </div>
    <div class="actions">
      ${pendiente > 0 ? `<button class="btn-primary btn-sm" data-act="cobrar-excedente" data-id="${esc(p.id)}">Cobrar excedente</button>` : ""}
      <button class="btn-secondary btn-sm" data-act="del-paquete" data-id="${esc(p.id)}">Eliminar</button>
    </div>
  </div>`;
}

const paqueteFields = (v = {}) => ([
  { name: "nombre", label: "Nombre del paquete", required: true, value: v.nombre || "Paquete de horas" },
  { name: "categoria", label: "Servicio", type: "select", value: v.categoria || CATEGORIA_PAQUETE.REGULAR,
    options: [
      { value: CATEGORIA_PAQUETE.REGULAR, label: "Regular" },
      { value: CATEGORIA_PAQUETE.VACACIONAL, label: "Vacacionales (bolsa independiente)" },
    ] },
  { name: "horasCompradas", label: "Horas compradas", type: "number", step: "0.5", required: true, value: v.horasCompradas },
  { name: "valorPagado", label: "Valor pagado", type: "number", value: v.valorPagado },
  { name: "valorHora", label: "Valor hora", type: "number", value: v.valorHora },
  { name: "valorHoraExtra", label: "Valor hora extra", type: "number", value: v.valorHoraExtra },
  { name: "fechaCompra", label: "Fecha compra", type: "date", value: v.fechaCompra || todayISO() },
  { name: "fechaVencimiento", label: "Fecha vencimiento", type: "date", value: v.fechaVencimiento },
  { name: "graciaMin", label: "Gracia (min)", type: "number", value: v?.reglaCobro?.graciaMin ?? REGLA_COBRO_DEFAULT.graciaMin },
  { name: "redondeoMin", label: "Redondeo (min)", type: "number", value: v?.reglaCobro?.redondeoMin ?? REGLA_COBRO_DEFAULT.redondeoMin },
]);

async function nuevoPaquete(clienteId) {
  const data = await openForm({ title: "Nuevo paquete", fields: paqueteFields() });
  if (!data) return;
  await withBusy(() => Paquetes.createPaquete({
    clienteId,
    nombre: data.nombre,
    categoria: data.categoria,
    horasCompradas: Number(data.horasCompradas),
    valorPagado: Number(data.valorPagado),
    valorHora: Number(data.valorHora),
    valorHoraExtra: Number(data.valorHoraExtra),
    fechaCompra: data.fechaCompra,
    fechaVencimiento: data.fechaVencimiento,
    reglaCobro: { graciaMin: Number(data.graciaMin), redondeoMin: Number(data.redondeoMin), cobrarExcedente: true },
  }));
  toast("Paquete creado ✅"); render();
}

function asistenteRowHTML(a) {
  return `<div class="row-card">
    <div class="main">
      <div class="title">${esc(a.nombreCompleto)}</div>
      <div class="sub">
        ${a.documento ? `<span>Doc: ${esc(a.documento)}</span>` : ""}
        ${a.telefono ? `<span>📞 ${esc(a.telefono)}</span>` : ""}
        ${a.email ? `<span>✉️ ${esc(a.email)}</span>` : ""}
        ${a.acudienteNombre ? `<span>👤 Acudiente: ${esc(a.acudienteNombre)}${a.acudienteTelefono ? ` (📞 ${esc(a.acudienteTelefono)})` : ""}</span>` : ""}
        <span>${a.totalVisitas || 0} visitas</span>
      </div>
    </div>
    <div class="actions">
      <button class="btn-secondary btn-sm" data-act="edit-asistente" data-id="${esc(a.id)}" data-cliente="${esc(a.clienteId)}">Editar</button>
    </div>
  </div>`;
}

const asistenteFields = (v = {}) => ([
  { name: "nombreCompleto", label: "Nombre completo", required: true, value: v.nombreCompleto },
  { name: "documento", label: "Documento", value: v.documento },
  { name: "telefono", label: "Teléfono", type: "tel", value: v.telefono },
  { name: "email", label: "Email", type: "email", value: v.email },
  { name: "acudienteNombre", label: "Acudiente (opcional, para menores de edad)", value: v.acudienteNombre },
  { name: "acudienteTelefono", label: "Teléfono del acudiente (opcional)", type: "tel", value: v.acudienteTelefono },
]);

async function nuevoAsistente(clienteId) {
  const data = await openForm({ title: "Nuevo participante", fields: asistenteFields() });
  if (!data) return;
  try {
    await Asistentes.createAsistente({ clienteId, ...data });
    toast("Participante creado ✅"); render();
  } catch (e) {
    if (e.duplicados?.length) {
      await resolverDuplicado(clienteId, data, e.duplicados);
    } else { toast(e.message, "bad"); }
  }
}

// Campos que se pueden completar al fusionar con un participante existente.
const CAMPOS_FUSION = [
  ["documento", "Documento"],
  ["telefono", "Teléfono"],
  ["email", "Email"],
  ["acudienteNombre", "Acudiente"],
  ["acudienteTelefono", "Tel. acudiente"],
];

async function resolverDuplicado(clienteId, data, duplicados) {
  const resumen = duplicados.map((d) => {
    const extra = [d.documento && `Doc: ${d.documento}`, d.telefono && `📞 ${d.telefono}`, d.email && `✉️ ${d.email}`].filter(Boolean).join(" · ");
    return `<li><b>${esc(d.nombreCompleto)}</b>${extra ? ` — ${esc(extra)}` : ""}</li>`;
  }).join("");

  const fields = [{
    name: "accion", label: "¿Qué deseas hacer?", type: "select",
    options: [
      { value: "fusionar", label: "Completar los datos del existente con la info nueva" },
      { value: "duplicar", label: "Crear de todos modos (duplicado)" },
    ],
  }];
  if (duplicados.length > 1) {
    fields.push({
      name: "dupId", label: "¿Con cuál participante fusionar?", type: "select",
      options: duplicados.map((d) => ({ value: d.id, label: d.nombreCompleto })),
    });
  }

  const res = await openForm({
    title: "Posible duplicado",
    okText: "Continuar",
    fields,
    extraHTML: `<div class="dup-warning">Ya existe(n) participante(s) parecido(s):<ul style="margin:6px 0 0 18px">${resumen}</ul><br>Puedes completar la ficha existente con los datos nuevos, crear un duplicado, o cancelar para dejar todo como está.</div>`,
  });
  if (!res) return; // dejar así

  if (res.accion === "duplicar") {
    await withBusy(() => Asistentes.createAsistente({ clienteId, ...data }, { forzar: true }));
    toast("Participante creado ✅"); render();
    return;
  }

  // Fusionar: rellena solo los campos vacíos del existente con la info nueva.
  const objetivo = duplicados.find((d) => d.id === res.dupId) || duplicados[0];
  const patch = {};
  for (const [campo] of CAMPOS_FUSION) {
    const nuevo = String(data[campo] || "").trim();
    const actual = String(objetivo[campo] || "").trim();
    if (nuevo && !actual) patch[campo] = nuevo;
  }
  if (!Object.keys(patch).length) {
    toast("El participante existente ya tiene todos esos datos; no hay nada que agregar.", "warn");
    return;
  }
  const agregados = CAMPOS_FUSION.filter(([c]) => patch[c]).map(([, lbl]) => lbl).join(", ");
  await withBusy(() => Asistentes.updateAsistente(objetivo.id, patch));
  toast(`Datos agregados a ${objetivo.nombreCompleto}: ${agregados} ✅`); render();
}

/* ── Importación masiva de participantes (CSV / texto pegado / IA) ── */

const PROMPT_IA_PARTICIPANTES = `Te comparto una lista de personas (puede ser una foto, un Excel, un PDF o texto). Extrae los datos y devuélvelos ÚNICAMENTE como CSV separado por punto y coma (;), sin ningún texto adicional antes ni después, con exactamente estas columnas en la primera fila:

nombreCompleto;documento;telefono;email;acudienteNombre;acudienteTelefono

Reglas:
- Una fila por persona. Si un dato no aparece, deja el campo vacío (pero conserva los ;).
- Teléfonos: solo dígitos, con indicativo si aparece (ej: 3101234567).
- Emails en minúsculas.
- No inventes datos que no estén en la fuente.
- Si un nombre está en formato "Apellidos, Nombres", conviértelo a "Nombres Apellidos".`;

// Normaliza encabezados: "Nombre completo" / "NOMBRE" / "teléfono" → clave interna.
function claveHeader(h) {
  const n = String(h || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z]/g, "");
  if (n.includes("acudiente") && (n.includes("tel") || n.includes("cel"))) return "acudienteTelefono";
  if (n.includes("acudiente")) return "acudienteNombre";
  if (n.includes("nombre")) return "nombreCompleto";
  if (n.includes("documento") || n.includes("cedula") || n === "doc" || n.includes("identificacion")) return "documento";
  if (n.includes("tel") || n.includes("cel") || n.includes("movil")) return "telefono";
  if (n.includes("mail") || n.includes("correo")) return "email";
  return null;
}

function parseParticipantes(text) {
  const t = String(text || "").trim();
  if (!t) return [];
  const primera = t.split("\n")[0];
  const delimiter = [";", ",", "\t"].reduce((a, b) =>
    primera.split(b).length > primera.split(a).length ? b : a);
  const rows = Importer.parseCSV(t, { delimiter });
  return rows.map((r) => {
    const o = { nombreCompleto: "", documento: "", telefono: "", email: "", acudienteNombre: "", acudienteTelefono: "" };
    for (const [h, v] of Object.entries(r)) {
      const k = claveHeader(h);
      if (k && v) o[k] = String(v).trim();
    }
    return o;
  }).filter((o) => o.nombreCompleto);
}

const normKey = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();

async function importarAsistentesUI(clienteId) {
  const res = await openForm({
    title: "Importar participantes",
    okText: "Procesar lista",
    fields: [{ name: "datos", label: "Pega aquí la lista (CSV con encabezados)", type: "textarea",
      placeholder: "nombreCompleto;documento;telefono;email;acudienteNombre;acudienteTelefono" }],
    extraHTML: `
      <div class="dup-warning" style="margin-top:4px">
        <b>¿Tienes una foto, Excel o PDF con la lista?</b><br>
        1. Copia el prompt con el botón de abajo.<br>
        2. Pégalo en una IA (ChatGPT, Claude, Gemini…) junto con la foto o archivo.<br>
        3. Copia la respuesta y pégala en el cuadro de arriba, o sube el .csv aquí.
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
        <button type="button" class="btn-secondary btn-sm" data-copy-prompt>📋 Copiar prompt para la IA</button>
        <label class="btn-secondary btn-sm" style="cursor:pointer;display:inline-flex;align-items:center">
          📄 Subir archivo .csv / .txt
          <input type="file" accept=".csv,.txt,text/csv,text/plain" data-file-import style="display:none">
        </label>
      </div>`,
    onMount: (form) => {
      form.querySelector("[data-copy-prompt]")?.addEventListener("click", async (ev) => {
        try { await navigator.clipboard.writeText(PROMPT_IA_PARTICIPANTES); }
        catch (_) {
          const ta = document.createElement("textarea");
          ta.value = PROMPT_IA_PARTICIPANTES; document.body.appendChild(ta);
          ta.select(); document.execCommand("copy"); ta.remove();
        }
        ev.target.textContent = "✅ Prompt copiado";
      });
      form.querySelector("[data-file-import]")?.addEventListener("change", async (ev) => {
        const f = ev.target.files?.[0];
        if (!f) return;
        const texto = await f.text();
        const campo = form.querySelector("[name='datos']");
        if (campo) campo.value = texto;
      });
    },
  });
  if (!res) return;

  const items = parseParticipantes(res.datos);
  if (!items.length) {
    toast("No se encontraron filas válidas. Revisa que la primera fila tenga encabezados y que cada persona tenga nombre.", "bad");
    return;
  }

  // Dedupe contra existentes (doc, email o nombre) y dentro del mismo lote.
  const existentes = await Asistentes.listAsistentesByCliente(clienteId);
  const docsVistos = new Set(existentes.map((a) => normKey(a.documento)).filter(Boolean));
  const mailsVistos = new Set(existentes.map((a) => normKey(a.email)).filter(Boolean));
  const nombresVistos = new Set(existentes.map((a) => normKey(a.nombreCompleto)).filter(Boolean));

  const nuevos = []; const omitidos = [];
  for (const it of items) {
    const d = normKey(it.documento), m = normKey(it.email), n = normKey(it.nombreCompleto);
    if ((d && docsVistos.has(d)) || (m && mailsVistos.has(m)) || (n && nombresVistos.has(n))) {
      omitidos.push(it.nombreCompleto);
      continue;
    }
    if (d) docsVistos.add(d); if (m) mailsVistos.add(m); if (n) nombresVistos.add(n);
    nuevos.push(it);
  }

  const previa = nuevos.slice(0, 8).map((x) => `<li>${esc(x.nombreCompleto)}${x.documento ? ` — ${esc(x.documento)}` : ""}</li>`).join("");
  const conf = await openForm({
    title: "Confirmar importación",
    okText: `Importar ${nuevos.length}`,
    fields: [],
    extraHTML: `<div class="dup-warning">
      Se importarán <b>${nuevos.length}</b> participante(s).${omitidos.length ? `<br>Se omitirán <b>${omitidos.length}</b> por ya existir: ${esc(omitidos.slice(0, 5).join(", "))}${omitidos.length > 5 ? "…" : ""}.` : ""}
      ${previa ? `<ul style="margin:6px 0 0 18px">${previa}${nuevos.length > 8 ? `<li>… y ${nuevos.length - 8} más</li>` : ""}</ul>` : ""}
    </div>`,
  });
  if (!conf || !nuevos.length) {
    if (conf && !nuevos.length) toast("Todos ya existían; no se importó ninguno.", "warn");
    return;
  }

  const r = await withBusy(async () => {
    let ok = 0, error = 0;
    for (const it of nuevos) {
      try { await Asistentes.createAsistente({ clienteId, ...it }, { forzar: true }); ok++; }
      catch (e) { console.error(e); error++; }
    }
    return { ok, error };
  });
  toast(`Importados ${r.ok} participante(s)${r.error ? ` · ${r.error} con error` : ""}${omitidos.length ? ` · ${omitidos.length} omitidos por duplicado` : ""} ✅`);
  render();
}

async function editarAsistente(id, clienteId) {
  const a = await Asistentes.getAsistente(id);
  const data = await openForm({ title: "Editar participante", fields: asistenteFields(a), values: a });
  if (!data) return;
  await withBusy(() => Asistentes.updateAsistente(id, data));
  toast("Participante actualizado ✅"); render();
}

/* ───────────────────────── PORTAL DE CLIENTES ───────────────────────── */
// Gestiona quién puede entrar al Portal (Spaces HUB) para este cliente.
async function gestionarAccesoPortal(clienteId) {
  const [c, accesos] = await Promise.all([
    Clientes.getCliente(clienteId),
    Portal.listAccesosByCliente(clienteId),
  ]);
  if (!c) { toast("Cliente no encontrado", "bad"); return; }

  const listaHTML = accesos.length
    ? accesos.map((a) => `
        <div class="row-card" style="margin-top:6px">
          <div class="main">
            <div class="title" style="font-size:14px">${esc(a.email)}
              <span class="estado ${a.activo ? "activo" : "vencido"}">${a.activo ? "activo" : "revocado"}</span></div>
            ${a.nombre ? `<div class="sub"><span>${esc(a.nombre)}</span></div>` : ""}
          </div>
          <div class="actions">
            ${a.activo
              ? `<button type="button" class="btn-secondary btn-sm" data-portal-revocar="${esc(a.email)}">Revocar</button>`
              : `<button type="button" class="btn-secondary btn-sm" data-portal-reactivar="${esc(a.email)}">Reactivar</button>`}
          </div>
        </div>`).join("")
    : `<div class="empty" style="margin-top:6px">Nadie tiene acceso al portal de este cliente todavía.</div>`;

  const data = await openForm({
    title: `Portal · ${c.nombre}`,
    okText: "Otorgar acceso",
    fields: [
      { name: "email", label: "Correo del cliente (nuevo acceso)", type: "email", value: c.email || "" },
      { name: "nombre", label: "Nombre de quien ingresa (opcional)", value: c.contactoPrincipal || "" },
    ],
    extraHTML: `
      <div class="dup-warning" style="margin-top:4px">
        <b>Accesos actuales</b>${listaHTML}
      </div>
      <div class="dup-warning" style="margin-top:8px">
        📌 Para que la persona pueda entrar también necesita una <b>cuenta</b> en
        Firebase → Authentication → <i>Add user</i> (con ese correo y una contraseña
        temporal). Luego, desde el portal, puede usar <i>“¿Olvidaste tu contraseña?”</i>
        para poner la suya y deberá <b>verificar su correo</b> la primera vez.
      </div>`,
    onMount: (form) => {
      form.querySelectorAll("[data-portal-revocar]").forEach((b) =>
        b.addEventListener("click", async () => {
          b.disabled = true;
          try {
            await Portal.revocarAcceso(b.dataset.portalRevocar);
            toast(`Acceso revocado: ${b.dataset.portalRevocar}`);
            b.closest(".row-card")?.querySelector(".estado")?.replaceWith(
              Object.assign(document.createElement("span"), { className: "estado vencido", textContent: "revocado" }));
            b.remove();
          } catch (e) { toast(e.message, "bad"); b.disabled = false; }
        }));
      form.querySelectorAll("[data-portal-reactivar]").forEach((b) =>
        b.addEventListener("click", async () => {
          b.disabled = true;
          try {
            await Portal.otorgarAcceso(b.dataset.portalReactivar, clienteId);
            toast(`Acceso reactivado: ${b.dataset.portalReactivar}`);
            b.closest(".row-card")?.querySelector(".estado")?.replaceWith(
              Object.assign(document.createElement("span"), { className: "estado activo", textContent: "activo" }));
            b.remove();
          } catch (e) { toast(e.message, "bad"); b.disabled = false; }
        }));
    },
  });
  if (!data || !data.email) return;
  await withBusy(() => Portal.otorgarAcceso(data.email, clienteId, { nombre: data.nombre }));
  toast(`Acceso al portal otorgado a ${data.email} ✅`);
}

/* ───────────────────────── RESERVAS ───────────────────────── */
async function viewReservas() {
  setContext("Reservas");
  const [reservas, clientes] = await Promise.all([Reservas.listReservas(), Clientes.listClientes()]);
  const cliName = (cid) => clientes.find((c) => c.id === cid)?.nombre || "—";
  const cliOpts = clientes.map((c) => `<option value="${esc(c.id)}">${esc(c.nombre)}</option>`).join("");
  const estados = ["programada", "en_curso", "cerrada", "cancelada"];

  const html = `
    <div class="card">
      <div class="toolbar">
        <div class="section-title" style="margin:0">Todas las reservas</div>
        <div>
          ${isAdmin() ? `<button class="btn-secondary btn-sm" data-act="export-reservas">Exportar CSV</button>` : ""}
          <button class="btn-secondary btn-sm" data-act="nueva-reserva-masiva">+ Masiva</button>
          <button class="btn-primary btn-sm" data-act="nueva-reserva">+ Reserva</button>
        </div>
      </div>
      <div class="toolbar" style="gap:8px">
        <input id="fReservaQ" class="search-input" placeholder="Buscar (actividad, responsable)…" style="flex:1;min-width:160px" />
        <select id="fReservaCliente"><option value="">Todos los clientes</option>${cliOpts}</select>
        <select id="fReservaEstado"><option value="">Todos los estados</option>${estados.map((e) => `<option value="${e}">${e.replace("_", " ")}</option>`).join("")}</select>
        <input id="fReservaDesde" type="date" title="Desde" />
        <input id="fReservaHasta" type="date" title="Hasta" />
      </div>
      <div id="reservasListBox">${reservas.length ? listaReservasHTML(reservas) : `<div class="empty">Sin reservas.</div>`}</div>
    </div>`;

  queueMicrotask(() => {
    const apply = () => {
      const q = ($("#fReservaQ")?.value || "").toLowerCase();
      const cli = $("#fReservaCliente")?.value || "";
      const est = $("#fReservaEstado")?.value || "";
      const desde = $("#fReservaDesde")?.value || "";
      const hasta = $("#fReservaHasta")?.value || "";
      const filt = reservas.filter((r) =>
        (!cli || r.clienteId === cli) &&
        (!est || r.estado === est) &&
        (!desde || r.fecha >= desde) &&
        (!hasta || r.fecha <= hasta) &&
        (!q || [r.actividad, r.responsable, cliName(r.clienteId)].join(" ").toLowerCase().includes(q))
      );
      $("#reservasListBox").innerHTML = filt.length ? listaReservasHTML(filt) : `<div class="empty">Sin resultados.</div>`;
    };
    ["fReservaQ", "fReservaCliente", "fReservaEstado", "fReservaDesde", "fReservaHasta"].forEach((idd) => {
      const el = document.getElementById(idd);
      el?.addEventListener("input", apply);
      el?.addEventListener("change", apply);
    });
  });
  return frag(html);
}

function listaReservasHTML(reservas) {
  return `<div class="list-grid">${reservas.map(reservaRowHTML).join("")}</div>`;
}

function reservaRowHTML(r) {
  const acciones = [];
  if (r.estado === ESTADO_RESERVA.PROGRAMADA) acciones.push(`<button class="btn-secondary btn-sm" data-act="iniciar-reserva" data-id="${esc(r.id)}">Iniciar</button>`);
  if (r.estado !== ESTADO_RESERVA.CERRADA && r.estado !== ESTADO_RESERVA.CANCELADA)
    acciones.push(`<button class="btn-primary btn-sm" data-act="cerrar-reserva" data-id="${esc(r.id)}">Cerrar</button>`);
  if (r.estado === ESTADO_RESERVA.CERRADA) acciones.push(`<button class="btn-secondary btn-sm" data-act="reabrir-reserva" data-id="${esc(r.id)}">Reabrir</button>`);
  acciones.push(`<button class="btn-secondary btn-sm" data-act="asistencia-reserva" data-id="${esc(r.id)}">Participantes</button>`);
  acciones.push(`<button class="btn-secondary btn-sm" data-act="edit-reserva" data-id="${esc(r.id)}">Editar</button>`);
  if (r.estado !== ESTADO_RESERVA.CERRADA && r.estado !== ESTADO_RESERVA.CANCELADA)
    acciones.push(`<button class="btn-secondary btn-sm" data-act="cancelar-reserva" data-id="${esc(r.id)}">Cancelar</button>`);
  acciones.push(`<button class="btn-secondary btn-sm" data-act="del-reserva" data-id="${esc(r.id)}">Eliminar</button>`);

  const real = r.minutosReales ? `Real: ${fmtHM(r.minutosReales)}` : "";
  const cobr = r.minutosCobrados ? `Cobrado: ${fmtHM(r.minutosCobrados)}` : "";
  return `<div class="row-card">
    <div class="main">
      <div class="title">${esc(fmtFecha(r.fecha))} · ${esc(r.horaInicioProgramada || "—")}-${esc(r.horaFinProgramada || "—")}
        <span class="estado ${r.estado}">${esc((r.estado || "").replace("_", " "))}</span></div>
      <div class="sub">
        ${r.actividad ? `<span>${esc(r.actividad)}</span>` : ""}
        <span>Prog: ${fmtHM(r.minutosProgramados)}</span>
        ${real ? `<span>${real}</span>` : ""}
        ${cobr ? `<span>${cobr}</span>` : ""}
        ${r.minutosExcedidos ? `<span style="color:var(--brahms)">Excedido: ${fmtHM(r.minutosExcedidos)}</span>` : ""}
      </div>
    </div>
    <div class="actions">${acciones.join("")}</div>
  </div>`;
}

async function reservaFields(clienteIdFijo) {
  const clientes = await Clientes.listClientes();
  const cliOpts = clientes.map((c) => ({ value: c.id, label: c.nombre }));
  const clienteId = clienteIdFijo || clientes[0]?.id || "";
  const paquetes = clienteId ? await Paquetes.listPaquetesByCliente(clienteId) : [];
  const paqOpts = paquetes.map((p) => ({
    value: p.id,
    label: `${p.categoria === CATEGORIA_PAQUETE.VACACIONAL ? "Vacacionales" : "Regular"} · ${p.nombre}`,
  }));
  return { cliOpts, paqOpts, clienteId };
}

// Repuebla el <select> de paquetes según el cliente elegido en el formulario.
// Así nunca se muestran paquetes de otro cliente.
function wirePaqueteSelect(form) {
  const cliSel = form.querySelector('[name="clienteId"]');
  const paqSel = form.querySelector('[name="paqueteId"]');
  if (!cliSel || !paqSel) return;
  const recargar = async () => {
    const cid = cliSel.value;
    paqSel.innerHTML = `<option value="">Cargando…</option>`;
    const paquetes = cid ? await Paquetes.listPaquetesByCliente(cid) : [];
    paqSel.innerHTML = paquetes.length
      ? paquetes.map((p) => `<option value="${esc(p.id)}">${esc(p.categoria === CATEGORIA_PAQUETE.VACACIONAL ? "Vacacionales" : "Regular")} · ${esc(p.nombre)}</option>`).join("")
      : `<option value="">(sin paquetes para este cliente)</option>`;
  };
  cliSel.addEventListener("change", recargar);
}

async function nuevaReserva(clienteIdFijo) {
  const { cliOpts, paqOpts, clienteId } = await reservaFields(clienteIdFijo);
  if (!cliOpts.length) { toast("Crea un cliente primero", "warn"); return; }
  const fields = [
    { name: "clienteId", label: "Cliente", type: "select", options: cliOpts, value: clienteId },
    { name: "paqueteId", label: "Paquete", type: "select", options: paqOpts.length ? paqOpts : [{ value: "", label: "(sin paquete)" }] },
    { name: "fecha", label: "Fecha", type: "date", required: true, value: todayISO() },
    { name: "horaInicioProgramada", label: "Hora inicio (HH:MM)", value: "" },
    { name: "horaFinProgramada", label: "Hora fin (HH:MM)", value: "" },
    { name: "espacioId", label: "Espacio / salón", value: "" },
    { name: "actividad", label: "Actividad", value: "" },
    { name: "responsable", label: "Responsable", value: "" },
  ];
  const data = await openForm({ title: "Nueva reserva", fields, onMount: wirePaqueteSelect });
  if (!data) return;
  await withBusy(() => Reservas.createReserva(data));
  toast("Reserva creada ✅"); render();
}

async function nuevaReservaMasiva() {
  const { cliOpts, paqOpts, clienteId } = await reservaFields();
  if (!cliOpts.length) { toast("Crea un cliente primero", "warn"); return; }
  const fields = [
    { name: "clienteId", label: "Cliente", type: "select", options: cliOpts, value: clienteId },
    { name: "paqueteId", label: "Paquete", type: "select", options: paqOpts.length ? paqOpts : [{ value: "", label: "(sin paquete)" }] },
    { name: "desde", label: "Desde", type: "date", required: true, value: todayISO() },
    { name: "hasta", label: "Hasta", type: "date", required: true, value: todayISO() },
    { name: "horaInicioProgramada", label: "Hora inicio (HH:MM)", value: "" },
    { name: "horaFinProgramada", label: "Hora fin (HH:MM)", value: "" },
    { name: "actividad", label: "Actividad", value: "" },
  ];
  const extraHTML = `<label>Días de la semana
    <div style="display:flex;gap:6px;flex-wrap:wrap">
      ${["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"].map((d, i) =>
        `<label style="display:flex;gap:4px;align-items:center;font-weight:600"><input type="checkbox" class="dow" value="${i}">${d}</label>`).join("")}
    </div></label>`;
  const data = await openForm({ title: "Reservas recurrentes", okText: "Crear todas", fields, extraHTML, onMount: wirePaqueteSelect });
  if (!data) return;
  const dias = Array.from(document.querySelectorAll(".dow:checked")).map((c) => Number(c.value));
  const fechas = fechasRecurrentes(data.desde, data.hasta, dias);
  if (!fechas.length) { toast("No hay fechas en ese rango/días", "warn"); return; }
  const n = await withBusy(() => Reservas.createReservasMasivas(data, fechas));
  toast(`${n} reservas creadas ✅`); render();
}

async function editarReserva(id) {
  const r = await Reservas.getReserva(id);
  const fields = [
    { name: "fecha", label: "Fecha", type: "date", required: true, value: r.fecha },
    { name: "horaInicioProgramada", label: "Hora inicio", value: r.horaInicioProgramada },
    { name: "horaFinProgramada", label: "Hora fin", value: r.horaFinProgramada },
    { name: "espacioId", label: "Espacio", value: r.espacioId },
    { name: "actividad", label: "Actividad", value: r.actividad },
    { name: "responsable", label: "Responsable", value: r.responsable },
    { name: "observaciones", label: "Observaciones", type: "textarea", value: r.observaciones },
  ];
  const data = await openForm({ title: "Editar reserva", fields, values: r });
  if (!data) return;
  await withBusy(() => Reservas.updateReserva(id, data));
  toast("Reserva actualizada ✅ (con auditoría)"); render();
}

async function iniciarReserva(id) {
  const data = await openForm({
    title: "Iniciar uso", okText: "Iniciar",
    fields: [{ name: "horaInicioReal", label: "Hora real de inicio (HH:MM)", required: true, value: nowHHMM() }],
  });
  if (!data) return;
  await withBusy(() => Consumo.iniciarReserva(id, data.horaInicioReal));
  toast("Reserva en curso ⏱️"); render();
}

async function cerrarReserva(id) {
  const r = await Reservas.getReserva(id);
  const data = await openForm({
    title: "Cerrar reserva", okText: "Cerrar y cobrar",
    fields: [
      { name: "horaInicioReal", label: "Hora real inicio (HH:MM)", required: true, value: r.horaInicioReal || r.horaInicioProgramada || nowHHMM() },
      { name: "horaFinReal", label: "Hora real fin (HH:MM)", required: true, value: r.horaFinReal || r.horaFinProgramada || nowHHMM() },
      { name: "observaciones", label: "Observaciones", type: "textarea", value: r.observaciones },
    ],
  });
  if (!data) return;
  if (hhmmToMin(data.horaFinReal) <= hhmmToMin(data.horaInicioReal)) { toast("La hora fin debe ser mayor", "bad"); return; }
  const res = await withBusy(() => Consumo.cerrarReserva(id, data));
  toast(`Cerrada. Cobrado ${fmtHM(res.reserva.minutosCobrados)}. Restan ${fmtHM(res.paquete.minutosRestantes)} ✅`);
  render();
}

async function reabrirReserva(id) {
  const conf = await openForm({ title: "Reabrir reserva", okText: "Reabrir", fields: [],
    extraHTML: `<div class="dup-warning">Se devolverán los minutos cobrados al paquete y quedará registrado en auditoría.</div>` });
  if (!conf) return;
  await withBusy(() => Consumo.reabrirReserva(id));
  toast("Reserva reabierta ↩️"); render();
}

async function gestionAsistencia(reservaId) {
  const r = await Reservas.getReserva(reservaId);
  const asistentes = await Asistentes.listAsistentesByCliente(r.clienteId);
  const actual = await Asistencia.listAsistencia(reservaId);
  const map = new Map(actual.map((a) => [a.asistenteId, a]));

  const root = ROOT();
  setContext(`Participantes · ${fmtFecha(r.fecha)}`);
  const rowHTML = (a) => {
    const cur = map.get(a.id);
    const st = cur?.estado || ESTADO_ASISTENCIA.SIN_MARCAR;
    const mk = (estado, emoji, cls) =>
      `<button class="chip ${st === estado ? cls : ""}" data-act="marcar-asistencia" data-reserva="${esc(reservaId)}" data-asistente="${esc(a.id)}" data-estado="${estado}">${emoji}</button>`;
    return `<div class="row-card" data-nombre="${esc((a.nombreCompleto || "").toLowerCase())}">
      <div class="main"><div class="title">${esc(a.nombreCompleto)}</div>
        <div class="sub"><span class="estado ${st === "presente" ? "activo" : st === "tarde" ? "por_agotarse" : st === "ausente" ? "vencido" : "agotado"}">${st.replace("_", " ")}</span></div></div>
      <div class="actions">${mk("presente", "✅", "ok")}${mk("tarde", "⏱️", "tarde")}${mk("ausente", "❌", "no")}</div>
    </div>`;
  };

  root.replaceChildren(...frag(`
    <button class="back-link" data-act="goto-reservas">← Reservas</button>
    <div class="card">
      <div class="section-title" style="margin:0 0 10px">Participantes — ${esc(fmtFecha(r.fecha))}</div>
      ${asistentes.length ? `<input id="buscarParticipante" class="search-input" placeholder="Buscar participante…" style="width:100%;margin-bottom:10px" />
      <div class="list-grid" id="participantesList">${asistentes.map(rowHTML).join("")}</div>` : `<div class="empty">Este cliente no tiene participantes. Agrégalos desde su ficha.</div>`}
    </div>`));
  // store reserva/asistentes for marcar handler
  window.__asistCtx = { reservaId, asistentes };

  // Buscador en vivo: filtra por nombre sin perder los chips de asistencia.
  queueMicrotask(() => {
    const inp = $("#buscarParticipante");
    inp?.addEventListener("input", () => {
      const q = inp.value.toLowerCase();
      const box = $("#participantesList");
      const filt = asistentes.filter((a) => (a.nombreCompleto || "").toLowerCase().includes(q));
      box.innerHTML = filt.length ? filt.map(rowHTML).join("") : `<div class="empty">Sin resultados.</div>`;
    });
  });
}

async function confirmar(titulo, mensaje, okText = "Eliminar") {
  return openForm({ title: titulo, okText, fields: [],
    extraHTML: `<div class="dup-warning">${esc(mensaje)}</div>` });
}

async function eliminarCliente(id) {
  if (!(await confirmar("Eliminar cliente", "Se eliminará el cliente. Sus paquetes/reservas NO se borran automáticamente. ¿Continuar?"))) return;
  await withBusy(() => Clientes.deleteCliente(id));
  toast("Cliente eliminado"); navTo("clientes");
}
async function eliminarPaquete(id) {
  if (!(await confirmar("Eliminar paquete", "Se eliminará el paquete. ¿Continuar?"))) return;
  await withBusy(() => Paquetes.deletePaquete(id));
  toast("Paquete eliminado"); render();
}
async function eliminarReserva(id) {
  if (!(await confirmar("Eliminar reserva", "Se eliminará la reserva. ¿Continuar?"))) return;
  await withBusy(() => Reservas.deleteReserva(id));
  toast("Reserva eliminada"); render();
}
async function cancelarReserva(id) {
  if (!(await confirmar("Cancelar reserva", "La reserva quedará marcada como cancelada (no se borra). ¿Continuar?", "Cancelar reserva"))) return;
  await withBusy(() => Reservas.updateReserva(id, { estado: ESTADO_RESERVA.CANCELADA }));
  toast("Reserva cancelada"); render();
}

/* ───────────────────────── COBROS / PAGOS ───────────────────────── */
function money(n) { return `$${Number(n || 0).toLocaleString("es-CO")}`; }

function pagoRowHTML(p) {
  return `<div class="row-card">
    <div class="main">
      <div class="title">${money(p.monto)} <span class="estado ${p.estado === "pagado" ? "activo" : "por_agotarse"}">${esc(p.estado || "")}</span></div>
      <div class="sub">
        <span>${esc(p.concepto)}</span>
        ${p.paqueteNombre ? `<span>${esc(p.paqueteCategoria === CATEGORIA_PAQUETE.VACACIONAL ? "Vacacionales" : "Regular")} · ${esc(p.paqueteNombre)}</span>` : ""}
        ${p.fecha ? `<span>${esc(fmtFecha(p.fecha))}</span>` : ""}
        ${p.metodo ? `<span>${esc(p.metodo)}</span>` : ""}
        ${p.notas ? `<span>${esc(p.notas)}</span>` : ""}
      </div>
    </div>
    <div class="actions">
      <button class="btn-secondary btn-sm" data-act="anular-pago" data-id="${esc(p.id)}">Anular</button>
    </div>
  </div>`;
}

const pagoFields = (v = {}) => ([
  { name: "concepto", label: "Concepto", type: "select", value: v.concepto || CONCEPTO_PAGO.PAQUETE,
    options: [
      { value: CONCEPTO_PAGO.PAQUETE, label: "Pago de paquete" },
      { value: CONCEPTO_PAGO.ABONO_VACACIONAL, label: "Abono para Vacacionales" },
      { value: CONCEPTO_PAGO.EXCEDENTE, label: "Excedente" },
      { value: CONCEPTO_PAGO.OTRO, label: "Otro" },
    ] },
  { name: "monto", label: "Monto", type: "number", required: true, value: v.monto },
  { name: "metodo", label: "Método", type: "select", value: v.metodo || METODO_PAGO.TRANSFERENCIA,
    options: [
      { value: METODO_PAGO.EFECTIVO, label: "Efectivo" },
      { value: METODO_PAGO.TRANSFERENCIA, label: "Transferencia" },
      { value: METODO_PAGO.TARJETA, label: "Tarjeta" },
      { value: METODO_PAGO.OTRO, label: "Otro" },
    ] },
  { name: "fecha", label: "Fecha", type: "date", value: v.fecha || todayISO() },
  { name: "notas", label: "Detalle del pago", type: "textarea", value: v.notas,
    placeholder: "Ej.: mensualidad de julio y saldo destinado a Vacacionales 2026." },
]);

async function nuevoPago(clienteId, paqueteId = "") {
  const paquetes = clienteId ? await Paquetes.listPaquetesByCliente(clienteId) : [];
  const paqueteOpts = [{ value: "", label: "Sin paquete asociado" }, ...paquetes.map((p) => ({
    value: p.id,
    label: `${p.categoria === CATEGORIA_PAQUETE.VACACIONAL ? "Vacacionales" : "Regular"} · ${p.nombre}`,
  }))];
  const data = await openForm({
    title: "Registrar pago",
    fields: [
      { name: "paqueteId", label: "Paquete al que aplica", type: "select", value: paqueteId, options: paqueteOpts },
      ...pagoFields(),
    ],
    extraHTML: `<div class="dup-warning">Para un abono vacacional selecciona el paquete <b>Vacacionales</b>. Su saldo nunca se mezcla con el servicio regular.</div>`,
  });
  if (!data) return;
  const paqueteSeleccionado = paquetes.find((p) => p.id === data.paqueteId);
  if (data.concepto === CONCEPTO_PAGO.ABONO_VACACIONAL && paqueteSeleccionado?.categoria !== CATEGORIA_PAQUETE.VACACIONAL) {
    toast("Un abono vacacional debe asociarse a un paquete de Vacacionales.", "warn"); return;
  }
  await withBusy(() => Pagos.createPago({
    ...data,
    clienteId,
    paqueteId: data.paqueteId || paqueteId,
    paqueteNombre: paqueteSeleccionado?.nombre || "",
    paqueteCategoria: paqueteSeleccionado?.categoria || "",
    monto: Number(data.monto),
  }));
  toast("Pago registrado ✅"); render();
}

async function anularPago(id) {
  const conf = await openForm({ title: "Anular pago", okText: "Anular", fields: [],
    extraHTML: `<div class="dup-warning">El pago se eliminará y quedará en auditoría. ¿Continuar?</div>` });
  if (!conf) return;
  await withBusy(() => Pagos.anularPago(id));
  toast("Pago anulado"); render();
}

async function cobrarExcedente(paqueteId) {
  const data = await openForm({
    title: "Cobrar excedente", okText: "Registrar cobro",
    fields: [
      { name: "metodo", label: "Método", type: "select", value: METODO_PAGO.TRANSFERENCIA,
        options: [
          { value: METODO_PAGO.EFECTIVO, label: "Efectivo" },
          { value: METODO_PAGO.TRANSFERENCIA, label: "Transferencia" },
          { value: METODO_PAGO.TARJETA, label: "Tarjeta" },
          { value: METODO_PAGO.OTRO, label: "Otro" },
        ] },
      { name: "fecha", label: "Fecha", type: "date", value: todayISO() },
      { name: "notas", label: "Notas", type: "textarea", value: "" },
    ],
    extraHTML: `<div class="dup-warning">Se calculará el monto según los minutos excedidos y el valor de hora extra del paquete.</div>`,
  });
  if (!data) return;
  const res = await withBusy(() => Pagos.cobrarExcedentePaquete(paqueteId, data));
  toast(`Excedente cobrado: ${money(res.monto)} (${fmtHM(res.minutosCobrados)}) ✅`);
  render();
}

async function viewCobros() {
  setContext("Cobros");
  const [pagos, paquetes, clientes] = await Promise.all([
    Pagos.listPagos(), Paquetes.listPaquetes(), Clientes.listClientes(),
  ]);
  const nombreCli = (cid) => clientes.find((c) => c.id === cid)?.nombre || "—";
  const pendientes = paquetes.filter((p) => Pagos.excedentePendienteMin(p) > 0);
  const totalCobrado = pagos.reduce((a, p) => a + (Number(p.monto) || 0), 0);

  const html = `
    <div class="kpi-grid">
      ${kpi("Total cobrado", money(totalCobrado), `${pagos.length} pagos`, "ok")}
      ${kpi("Excedentes pendientes", pendientes.length, "paquetes", pendientes.length ? "bad" : "")}
    </div>

    <div class="card">
      <div class="section-title" style="margin:0 0 10px">Excedentes por cobrar</div>
      ${pendientes.length ? `<div class="list-grid">${pendientes.map((p) =>
        `<div class="row-card">
          <div class="main">
            <div class="title">${esc(nombreCli(p.clienteId))} · ${esc(p.nombre)}</div>
            <div class="sub"><span style="color:var(--bad)">Pendiente: ${fmtHM(Pagos.excedentePendienteMin(p))}</span></div>
          </div>
          <div class="actions"><button class="btn-primary btn-sm" data-act="cobrar-excedente" data-id="${esc(p.id)}">Cobrar</button></div>
        </div>`).join("")}</div>` : `<div class="empty">Nada pendiente ✅</div>`}
    </div>

    <div class="card">
      <div class="toolbar">
        <div class="section-title" style="margin:0">Historial de pagos</div>
        ${isAdmin() ? `<button class="btn-secondary btn-sm" data-act="export-pagos">Exportar CSV</button>` : ""}
      </div>
      ${pagos.length ? `<div class="list-grid">${pagos.map((p) =>
        `<div class="row-card">
          <div class="main">
            <div class="title">${money(p.monto)} <span class="estado ${p.estado === "pagado" ? "activo" : "por_agotarse"}">${esc(p.concepto)}</span></div>
            <div class="sub"><span>${esc(nombreCli(p.clienteId))}</span>${p.fecha ? `<span>${esc(fmtFecha(p.fecha))}</span>` : ""}<span>${esc(p.metodo || "")}</span></div>
          </div>
          <div class="actions"><button class="btn-secondary btn-sm" data-act="anular-pago" data-id="${esc(p.id)}">Anular</button></div>
        </div>`).join("")}</div>` : `<div class="empty">Sin pagos aún.</div>`}
    </div>`;
  return frag(html);
}

async function exportPagos() {
  if (!isAdmin()) return adminOnly("Exportar CSV");
  const [pagos, clientes] = await Promise.all([Pagos.listPagos(), Clientes.listClientes()]);
  const nombreCli = (cid) => clientes.find((c) => c.id === cid)?.nombre || "";
  const rows = pagos.map((p) => ({ ...p, cliente: nombreCli(p.clienteId) }));
  descargarCSV("pagos", rows, [
    { key: "fecha", label: "Fecha" }, { key: "cliente", label: "Cliente" },
    { key: "concepto", label: "Concepto" }, { key: "monto", label: "Monto" },
    { key: "metodo", label: "Método" }, { key: "estado", label: "Estado" }, { key: "notas", label: "Notas" },
  ]);
  toast("CSV descargado ✅");
}

/* ───────────────────────── ALERTAS ───────────────────────── */
async function viewAlertas() {
  setContext("Alertas");
  const s = await Stats.statsGenerales();
  const section = (titulo, lista, render) => `
    <div class="card">
      <div class="section-title" style="margin:0 0 10px">${esc(titulo)} (${lista.length})</div>
      ${lista.length ? `<div class="list-grid">${lista.map(render).join("")}</div>` : `<div class="empty">Nada por aquí ✅</div>`}
    </div>`;
  const html =
    section("Paquetes por agotarse", s.paquetesPorAgotarse, paqueteRowHTML) +
    section("Paquetes vencidos", s.paquetesVencidos, paqueteRowHTML) +
    section("Excedentes pendientes por cobrar", s.excedentesPendientes, paqueteRowHTML) +
    section("Reservas sin cerrar", s.reservasSinCerrarList, reservaRowHTML);
  return frag(html);
}

/* ───────────────────────── AUDITORÍA ───────────────────────── */
async function viewAuditoria() {
  setContext("Auditoría");
  if (currentRole !== "admin") {
    return frag(`<div class="card"><div class="empty">Solo administradores pueden ver la auditoría.</div></div>`);
  }
  const logs = await Audit.listAuditLogs({ max: 200 });
  const fechaTxt = (ts) => {
    try { return ts?.toDate ? ts.toDate().toLocaleString("es-CO") : ""; } catch { return ""; }
  };
  const html = `
    <div class="card">
      <div class="section-title" style="margin:0 0 10px">Historial de cambios (${logs.length})</div>
      ${logs.length ? `<div class="list-grid">${logs.map((l) => `
        <div class="row-card">
          <div class="main">
            <div class="title">${esc(l.accion)} · <span class="muted">${esc(l.entidad)}</span></div>
            <div class="sub">
              <span>${esc(l.usuarioNombre || "—")}</span>
              <span>${esc(fechaTxt(l.createdAt))}</span>
              <span class="muted">${esc(l.entidadId || "")}</span>
            </div>
          </div>
        </div>`).join("")}</div>` : `<div class="empty">Sin registros aún.</div>`}
    </div>`;
  return frag(html);
}

/* ───────────────────────── IMPORTAR ───────────────────────── */
async function viewImportar() {
  setContext("Importar datos");
  const clientes = await Clientes.listClientes();
  const cliOpts = clientes.map((c) => `<option value="${esc(c.id)}">${esc(c.nombre)}</option>`).join("");
  const html = `
    <div class="card">
      <div class="section-title" style="margin:0 0 10px">🗂️ Migrar datos 2026 (desde tu Excel)</div>
      <p class="muted" style="font-size:13px">Reconstruye clientes, paquetes (con sus horas), asistentes, reservas y asistencia preservando las relaciones. <b>Ejecútalo una sola vez</b> (volver a correrlo duplica los datos).</p>
      <div class="toolbar" style="margin-top:10px">
        <div class="left"><span id="migStatus" class="muted" style="font-size:13px"></span></div>
        <div>
          <button class="btn-secondary" id="btnMigrarAppsScript">Migrar desde Apps Script</button>
          <button class="btn-primary" id="btnMigrarExcel">Migrar desde el Excel incluido</button>
        </div>
      </div>
      <div id="migResult"></div>
    </div>

    <div class="card">
      <div class="section-title" style="margin:0 0 10px">Importar datos sueltos (CSV o JSON)</div>
      <p class="muted" style="font-size:13px">Pega CSV (con encabezados) o un array JSON. El importador no borra nada existente.</p>
      <label class="modal-body">Entidad a importar
        <select id="impTipo">
          <option value="clientes">Clientes</option>
          <option value="asistentes">Participantes (requiere cliente)</option>
          <option value="paquetes">Paquetes (requiere cliente)</option>
          <option value="reservas">Reservas (requiere cliente)</option>
        </select>
      </label>
      <label class="modal-body" style="margin-top:8px">Cliente por defecto (para asistentes/paquetes/reservas)
        <select id="impCliente"><option value="">(ninguno)</option>${cliOpts}</select>
      </label>
      <textarea id="impData" rows="10" style="width:100%;margin-top:10px;border-radius:12px;border:1px solid var(--line);padding:10px" placeholder="nombre,email,telefono&#10;Empresa X,x@x.com,3001234567"></textarea>
      <div class="toolbar" style="margin-top:10px">
        <div></div>
        <button class="btn-primary" id="btnImportar">Importar</button>
      </div>
      <div id="impResult"></div>
    </div>`;
  const nodes = frag(html);
  setTimeout(() => {
    const setMig = (t) => { const e = $("#migStatus"); if (e) e.textContent = t; };
    const runMigracion = async (loader, label) => {
      const conf = await openForm({
        title: "Confirmar migración", okText: "Sí, migrar",
        fields: [],
        extraHTML: `<div class="dup-warning">Vas a importar datos ${label}. Ejecuta esto <b>solo una vez</b>: volver a correrlo duplicará todo. ¿Continuar?</div>`,
      });
      if (!conf) return;
      $("#btnMigrarExcel").disabled = true; $("#btnMigrarAppsScript").disabled = true;
      try {
        setMig("Cargando datos…");
        const data = await loader();
        setMig("Escribiendo en Firebase…");
        const rep = await migrateLegacy(data, { onProgress: setMig });
        setMig("Listo ✅");
        $("#migResult").innerHTML = `<div class="dup-warning" style="margin-top:10px">
          Clientes: <b>${rep.clientes}</b> · Paquetes: <b>${rep.paquetes}</b> · Asistentes: <b>${rep.asistentes}</b> ·
          Reservas: <b>${rep.reservas}</b> · Asistencia: <b>${rep.asistencias}</b> · Errores: <b>${rep.errores.length}</b>
          ${rep.errores.length ? "<br>" + rep.errores.slice(0, 8).map(esc).join("<br>") : ""}
        </div>`;
        toast(`Migración completa: ${rep.clientes} clientes, ${rep.reservas} reservas`, "ok");
      } catch (e) {
        setMig("Error");
        toast(e.message, "bad");
        $("#migResult").innerHTML = `<div class="dup-warning" style="margin-top:10px">Error: ${esc(e.message)}</div>`;
      } finally {
        $("#btnMigrarExcel").disabled = false; $("#btnMigrarAppsScript").disabled = false;
      }
    };
    const btnMigrarExcel = $("#btnMigrarExcel");
    const btnMigrarAppsScript = $("#btnMigrarAppsScript");
    const btnImportar = $("#btnImportar");
    if (!btnMigrarExcel || !btnMigrarAppsScript || !btnImportar) {
      setMig("No se pudieron activar los botones. Recarga la pagina.");
      return;
    }

    btnMigrarExcel.addEventListener("click", () => {
      setMig("Preparando importacion desde migration-data.json...");
      runMigracion(loadIncludedData, "desde el Excel incluido (migration-data.json)");
    });
    btnMigrarAppsScript.addEventListener("click", () => {
      setMig("Preparando importacion desde Apps Script...");
      runMigracion(() => fetchLegacyFromAppsScript(LEGACY_DEFAULTS.url, LEGACY_DEFAULTS.token, { onProgress: setMig }), "en vivo desde Apps Script");
    });

    btnImportar.addEventListener("click", async () => {
      const tipo = $("#impTipo").value;
      const clienteId = $("#impCliente").value;
      const data = $("#impData").value;
      if (!data.trim()) { toast("Pega datos primero", "warn"); return; }
      try {
        let res;
        if (tipo === "clientes") res = await Importer.importClientes(data);
        else if (tipo === "asistentes") res = await Importer.importAsistentes(data, { clienteIdPorDefecto: clienteId });
        else if (tipo === "paquetes") res = await Importer.importPaquetes(data, { clienteIdPorDefecto: clienteId });
        else res = await Importer.importReservas(data, { clienteIdPorDefecto: clienteId });
        $("#impResult").innerHTML = `<div class="dup-warning" style="margin-top:10px">Importados: <b>${res.ok}</b> · Errores: <b>${res.error}</b>${res.errores.length ? "<br>" + res.errores.slice(0, 5).map((e) => esc(e.error)).join("<br>") : ""}</div>`;
        toast(`Importación: ${res.ok} ok, ${res.error} errores`);
      } catch (e) { toast(e.message, "bad"); }
    });
  }, 0);
  return nodes;
}

/* ───────────────────────── exports ───────────────────────── */
async function exportClientes() {
  if (!isAdmin()) return adminOnly("Exportar CSV");
  const clientes = await Clientes.listClientes();
  descargarCSV("clientes", clientes, [
    { key: "nombre", label: "Nombre" }, { key: "tipo", label: "Tipo" },
    { key: "nitDocumento", label: "NIT/Doc" }, { key: "telefono", label: "Teléfono" },
    { key: "email", label: "Email" }, { key: "estado", label: "Estado" },
  ]);
  toast("CSV descargado ✅");
}

async function exportReservas() {
  if (!isAdmin()) return adminOnly("Exportar CSV");
  const reservas = await Reservas.listReservas();
  descargarCSV("reservas", reservas, [
    { key: "fecha", label: "Fecha" }, { key: "horaInicioProgramada", label: "Inicio prog" },
    { key: "horaFinProgramada", label: "Fin prog" }, { key: "minutosProgramados", label: "Min prog" },
    { key: "minutosReales", label: "Min real" }, { key: "minutosCobrados", label: "Min cobrados" },
    { key: "minutosExcedidos", label: "Min excedidos" }, { key: "estado", label: "Estado" },
    { key: "actividad", label: "Actividad" },
  ]);
  toast("CSV descargado ✅");
}

/* ───────────────────────── utilidades ───────────────────────── */
function setContext(txt) { const e = $("#currentContext"); if (e) e.textContent = txt; }
function nowHHMM() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/* ───────────────────────── event delegation ───────────────────────── */
document.addEventListener("click", async (ev) => {
  const btn = ev.target.closest("[data-act]");
  const nav = ev.target.closest("[data-nav]");
  if (nav) { navTo(nav.dataset.nav); return; }
  if (!btn) return;
  const act = btn.dataset.act;
  const id = btn.dataset.id;
  if (WRITE_ACTS.has(act) && !canWrite()) {
    toast("Tu rol es de solo lectura.", "warn");
    return;
  }
  try {
    switch (act) {
      case "goto-clientes": return navTo("clientes");
      case "goto-reservas": return navTo("reservas");
      case "goto-alertas": return navTo("alertas");
      case "open-cliente": if (!ev.target.closest("[data-act='edit-cliente']")) return navTo("cliente", { id });
        return;
      case "cliente-tab": return cambiarClienteTab(btn.dataset.tab);
      case "nuevo-cliente": return nuevoCliente();
      case "edit-cliente": ev.stopPropagation(); return editarCliente(id);
      case "nuevo-paquete": return nuevoPaquete(id);
      case "nuevo-asistente": return nuevoAsistente(id);
      case "importar-asistentes": return importarAsistentesUI(id);
      case "edit-asistente": return editarAsistente(id, btn.dataset.cliente);
      case "nueva-reserva": return nuevaReserva(id);
      case "nueva-reserva-masiva": return nuevaReservaMasiva();
      case "edit-reserva": return editarReserva(id);
      case "del-cliente": return eliminarCliente(id);
      case "del-paquete": return eliminarPaquete(id);
      case "del-reserva": return eliminarReserva(id);
      case "cancelar-reserva": return cancelarReserva(id);
      case "goto-auditoria": return navTo("auditoria");
      case "iniciar-reserva": return iniciarReserva(id);
      case "cerrar-reserva": return cerrarReserva(id);
      case "reabrir-reserva": return reabrirReserva(id);
      case "asistencia-reserva": return gestionAsistencia(id);
      case "marcar-asistencia": return marcarAsistencia(btn);
      case "nuevo-pago": return nuevoPago(id);
      case "anular-pago": return anularPago(id);
      case "cobrar-excedente": return cobrarExcedente(id);
      case "portal-acceso": return gestionarAccesoPortal(id);
      case "export-pagos": return exportPagos();
      case "export-clientes": return exportClientes();
      case "export-reservas": return exportReservas();
    }
  } catch (e) { console.error(e); toast(e?.message || "Error", "bad"); }
});

async function marcarAsistencia(btn) {
  const { reserva, asistente, estado } = btn.dataset;
  const ctx = window.__asistCtx;
  const a = ctx?.asistentes?.find((x) => x.id === asistente) || { id: asistente };
  await Asistencia.registrarAsistencia(reserva, a, { estado });
  // Actualiza solo los chips de esta fila para no perder el buscador.
  const row = btn.closest(".row-card");
  if (row) {
    const clsFor = { presente: "ok", tarde: "tarde", ausente: "no" };
    row.querySelectorAll("[data-act='marcar-asistencia']").forEach((c) => {
      c.classList.toggle(clsFor[c.dataset.estado], c.dataset.estado === estado);
    });
    const badge = row.querySelector(".estado");
    if (badge) {
      const map = { presente: "activo", tarde: "por_agotarse", ausente: "vencido" };
      badge.className = `estado ${map[estado] || "agotado"}`;
      badge.textContent = String(estado).replace("_", " ");
    }
  } else {
    await gestionAsistencia(reserva);
  }
}

/* ───────────────────────── auth boot ───────────────────────── */
$("#btnLogin")?.addEventListener("click", async () => {
  $("#authError").textContent = "";
  try { await signInGoogle(); }
  catch (e) { $("#authError").textContent = e?.message || "No se pudo iniciar sesión."; }
});
$("#btnLogout")?.addEventListener("click", () => signOut());

onAuth((user) => {
  if (user) {
    currentRole = user.rol || "consulta";
    document.body.dataset.role = currentRole;
    $("#authGate").hidden = true;
    $("#appShell").hidden = false;
    $("#userBadge").textContent = `${user.nombre} · ${user.rol}`;
    startRealtime();
    navTo("dashboard");
  } else {
    stopRealtime();
    delete document.body.dataset.role;
    $("#appShell").hidden = true;
    $("#authGate").hidden = false;
  }
});
