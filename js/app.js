/* app.js — Asistencia Spaces (v1.3)
   Navegación + orquestación de data + eventos UI
   Requiere: utils.js, store.js, api.js, ui.js, dialog.js

   ✅ v1.3 (mejorado):
   - Botón “Tiempo real” consistente (clases correctas, sin “btn secondary” fantasma)
   - Render más estable: evita re-binds repetidos, y refrescos innecesarios
   - Conexión: usa #connectionText si existe (y fallback al .status-text)
   - Reportes: carga asistencias en paralelo con límite (no se muere por 40 sesiones)
   - UX: conserva borrador, muestra meta de sesión si existe #sesionMetaBox
   - Null-safety y logs más claros
*/

(() => {
  'use strict';

  const $ = (s) => document.querySelector(s);

  // ====== DOM refs ======
  const el = {
    // Context
    currentContext: $("#currentContext"),
    connectionDot: $("#connectionStatus"),
    connectionText: $("#connectionText") || document.querySelector(".status-text"),

    // Views
    views: {
      dashboard: $("#view-dashboard"),
      participantes: $("#view-participantes"),
      sesiones: $("#view-sesiones"),
      asistencia: $("#view-asistencia"),
      reportes: $("#view-reportes"),
    },

    // Dashboard
    empresaSelect: $("#empresaSelect"),
    tallerSelect: $("#tallerSelect"),
    btnNuevaEmpresa: $("#btnNuevaEmpresa"),
    btnNuevoTaller: $("#btnNuevoTaller"),
    tallerInfo: $("#tallerInfo"),

    btnIrParticipantes: $("#btnIrParticipantes"),
    btnIrSesiones: $("#btnIrSesiones"),
    btnIrReportes: $("#btnIrReportes"),

    // Participantes
    btnVolverDashboard1: $("#btnVolverDashboard1"),
    btnAgregarParticipante: $("#btnAgregarParticipante"),
    buscarParticipante: $("#buscarParticipante"),
    participantesTableContainer: $("#participantesTableContainer"),

    // Sesiones
    btnVolverDashboard2: $("#btnVolverDashboard2"),
    btnNuevaSesion: $("#btnNuevaSesion"),
    sesionesListContainer: $("#sesionesListContainer"),

    // Asistencia
    btnVolverSesiones: $("#btnVolverSesiones"),
    btnGuardarAsistencia: $("#btnGuardarAsistencia"),

    // Opcional: si existe este botón en tu HTML, lo usamos.
    btnTiempoRealSesion: $("#btnTiempoRealSesion"),

    asistenciaListContainer: $("#asistenciaListContainer"),
    countAsistio: $("#countAsistio"),
    countNo: $("#countNo"),
    countTarde: $("#countTarde"),
    countSinMarcar: $("#countSinMarcar"),

    sesionMetaBox: $("#sesionMetaBox"),

    // Reportes
    btnVolverDashboard3: $("#btnVolverDashboard3"),
    reportesContainer: $("#reportesContainer"),
  };

  // ====== Globals from other modules ======
  const API = window.API;
  const Store = window.Store;
  const UI = window.UI;
  const Dialogs = window.Dialogs;
  const Utils = window.Utils;

  if (!API || !Store || !UI || !Dialogs || !Utils) {
    console.error("Faltan módulos globales (API/Store/UI/Dialogs/Utils). Revisa includes en index.html.");
  }

  // ====== State (runtime) ======
  let activeView = "dashboard";
  let activeSesionId = null;       // cuando entramos a marcar
  let activeSesionObj = null;      // cache de la sesión abierta
  let asistenciaDraft = null;      // { sesionId, tallerId, map: { participanteId: {estado, nota} } }

  // ====== Boot ======
  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    bindEventsOnce_();
    UI.init?.();

    // Estado inicial desde localStorage
    Store.load?.();

    // Ping + carga inicial
    await refreshConnection_();
    await loadDashboardData_();

    go_("dashboard");
  }

  // =========================
  // Navigation
  // =========================
  function go_(name) {
    activeView = name;
    Object.entries(el.views).forEach(([k, node]) => {
      if (!node) return;
      node.classList.toggle("active", k === name);
    });

    if (name === "participantes") el.buscarParticipante?.focus?.();
  }

  // =========================
  // Events (bind once)
  // =========================
  let _eventsBound = false;
  function bindEventsOnce_() {
    if (_eventsBound) return;
    _eventsBound = true;

    // Dashboard actions
    el.btnNuevaEmpresa?.addEventListener("click", onNuevaEmpresa_);
    el.btnNuevoTaller?.addEventListener("click", onNuevoTaller_);

    el.empresaSelect?.addEventListener("change", onEmpresaChange_);
    el.tallerSelect?.addEventListener("change", onTallerChange_);

    el.btnIrParticipantes?.addEventListener("click", () => openParticipantes_());
    el.btnIrSesiones?.addEventListener("click", () => openSesiones_());
    el.btnIrReportes?.addEventListener("click", () => openReportes_());

    // Back buttons
    el.btnVolverDashboard1?.addEventListener("click", () => go_("dashboard"));
    el.btnVolverDashboard2?.addEventListener("click", () => go_("dashboard"));
    el.btnVolverDashboard3?.addEventListener("click", () => go_("dashboard"));

    // Participantes
    el.btnAgregarParticipante?.addEventListener("click", onAgregarParticipante_);
    const debouncedSearch = Utils.debounce
      ? Utils.debounce(() => renderParticipantes_(), 140)
      : () => renderParticipantes_();
    el.buscarParticipante?.addEventListener("input", debouncedSearch);

    // Sesiones
    el.btnNuevaSesion?.addEventListener("click", onNuevaSesion_);

    // Asistencia
    el.btnVolverSesiones?.addEventListener("click", async () => {
      activeSesionId = null;
      activeSesionObj = null;
      asistenciaDraft = null;
      go_("sesiones");
      await loadSesiones_();
    });

    el.btnGuardarAsistencia?.addEventListener("click", onGuardarAsistencia_);

    // Tiempo real de sesión (si existe)
    el.btnTiempoRealSesion?.addEventListener("click", onTiempoRealSesion_);

    // Online/offline status
    window.addEventListener("online", refreshConnection_);
    window.addEventListener("offline", refreshConnection_);
  }

  // =========================
  // Connection
  // =========================
  async function refreshConnection_() {
    const online = navigator.onLine;
    UI.setConnection?.(online);

    if (el.connectionDot) {
      el.connectionDot.classList.remove("online", "offline", "error");
      el.connectionDot.classList.add(online ? "online" : "offline");
    }
    if (el.connectionText) el.connectionText.textContent = online ? "Conectado" : "Sin conexión";

    if (!online) return;

    try {
      await API.ping();
      if (el.connectionDot) {
        el.connectionDot.classList.remove("error", "offline");
        el.connectionDot.classList.add("online");
      }
      if (el.connectionText) el.connectionText.textContent = "Conectado";
    } catch (_e) {
      if (el.connectionDot) {
        el.connectionDot.classList.remove("online", "offline");
        el.connectionDot.classList.add("error");
      }
      if (el.connectionText) el.connectionText.textContent = "Error API";
    }
  }

  // =========================
  // Dashboard load/render
  // =========================
  async function loadDashboardData_() {
    UI.block?.(true);

    try {
      const empresas = await API.listEmpresas();
      Store.setEmpresas?.(empresas);

      let empresaId = Store.getSelectedEmpresaId?.();
      if (!empresaId && empresas.length) empresaId = empresas[0].empresaId;

      Store.setSelectedEmpresaId?.(empresaId || "");

      if (empresaId) {
        const talleres = await API.listTalleresByEmpresa(empresaId);
        Store.setTalleres?.(talleres);

        let tallerId = Store.getSelectedTallerId?.();
        const exists = talleres.some(t => String(t.tallerId) === String(tallerId));
        if (!exists) tallerId = talleres[0]?.tallerId || "";

        Store.setSelectedTallerId?.(tallerId);
      } else {
        Store.setTalleres?.([]);
        Store.setSelectedTallerId?.("");
      }

      renderDashboard_();

    } catch (e) {
      console.error(e);
      Utils.toast?.("No se pudo cargar el dashboard. Revisa tu Web App URL/token.", "bad");
      renderDashboard_();
    } finally {
      UI.block?.(false);
    }
  }

  function renderDashboard_() {
    const empresas = Store.getEmpresas?.() || [];
    const talleres = Store.getTalleres?.() || [];

    const empresaId = Store.getSelectedEmpresaId?.() || "";
    const tallerId = Store.getSelectedTallerId?.() || "";

    UI.renderEmpresaSelect?.(el.empresaSelect, empresas, empresaId);
    UI.renderTallerSelect?.(el.tallerSelect, talleres, tallerId);

    const empresa = empresas.find(x => String(x.empresaId) === String(empresaId));
    const taller = talleres.find(x => String(x.tallerId) === String(tallerId));

    const label = taller
      ? `${empresa?.empresaNombre || "Empresa"} · ${taller.tallerNombre}`
      : (empresa ? `${empresa.empresaNombre} · sin taller` : "Sin taller seleccionado");

    if (el.currentContext) el.currentContext.textContent = label;
    if (el.tallerInfo) el.tallerInfo.innerHTML = UI.renderTallerInfo?.(taller, empresa) || "";

    const hasTaller = !!tallerId;

    // habilitadores coherentes
    if (el.btnNuevoTaller) el.btnNuevoTaller.disabled = !empresaId;
    [el.btnIrParticipantes, el.btnIrSesiones, el.btnIrReportes].forEach(b => {
      if (!b) return;
      b.disabled = !hasTaller;
    });

    UI.renderDashboardEmptyStates?.({
      empresasCount: empresas.length,
      talleresCount: talleres.length,
      empresaId,
      tallerId
    });
  }

  async function onEmpresaChange_() {
    const empresaId = el.empresaSelect?.value || "";
    Store.setSelectedEmpresaId?.(empresaId);
    Store.setSelectedTallerId?.("");

    UI.block?.(true);
    try {
      const talleres = empresaId ? await API.listTalleresByEmpresa(empresaId) : [];
      Store.setTalleres?.(talleres);

      const firstTallerId = talleres[0]?.tallerId || "";
      Store.setSelectedTallerId?.(firstTallerId);

      renderDashboard_();
    } catch (e) {
      console.error(e);
      Utils.toast?.("No se pudieron cargar talleres de esa empresa.", "bad");
      Store.setTalleres?.([]);
      renderDashboard_();
    } finally {
      UI.block?.(false);
    }
  }

  async function onTallerChange_() {
    const tallerId = el.tallerSelect?.value || "";
    Store.setSelectedTallerId?.(tallerId);
    renderDashboard_();
  }

  // =========================
  // Create flows
  // =========================
  async function onNuevaEmpresa_() {
    const data = await Dialogs.promptEmpresa?.();
    if (!data) return;

    UI.block?.(true);
    try {
      const res = await API.createEmpresa(data);
      Utils.toast?.("Empresa creada ✅", "ok");

      await loadDashboardData_();

      if (res?.empresa?.empresaId) {
        Store.setSelectedEmpresaId?.(res.empresa.empresaId);
        await onEmpresaChange_();
      }
    } catch (e) {
      console.error(e);
      Utils.toast?.("No se pudo crear la empresa.", "bad");
    } finally {
      UI.block?.(false);
    }
  }

  async function onNuevoTaller_() {
    const empresaId = Store.getSelectedEmpresaId?.() || "";
    if (!empresaId) {
      Utils.toast?.("Primero selecciona o crea una empresa.", "warn");
      return;
    }

    const data = await Dialogs.promptTaller?.();
    if (!data) return;

    UI.block?.(true);
    try {
      const payload = { ...data, empresaId };
      const res = await API.createTaller(payload);
      Utils.toast?.("Taller creado ✅", "ok");

      const talleres = await API.listTalleresByEmpresa(empresaId);
      Store.setTalleres?.(talleres);

      if (res?.taller?.tallerId) Store.setSelectedTallerId?.(res.taller.tallerId);

      renderDashboard_();
    } catch (e) {
      console.error(e);
      Utils.toast?.("No se pudo crear el taller.", "bad");
    } finally {
      UI.block?.(false);
    }
  }

  // =========================
  // Participantes view
  // =========================
  async function openParticipantes_() {
    const tallerId = Store.getSelectedTallerId?.() || "";
    if (!tallerId) return;

    go_("participantes");
    await loadParticipantes_();
  }

  async function loadParticipantes_() {
    const tallerId = Store.getSelectedTallerId?.() || "";
    if (!tallerId) return;

    UI.block?.(true);
    try {
      const participantes = await API.listParticipantesByTaller(tallerId);
      Store.setParticipantes?.(participantes);
      renderParticipantes_();
    } catch (e) {
      console.error(e);
      Utils.toast?.("No se pudieron cargar participantes.", "bad");
      Store.setParticipantes?.([]);
      renderParticipantes_();
    } finally {
      UI.block?.(false);
    }
  }

  function renderParticipantes_() {
    const q = (el.buscarParticipante?.value || "").trim();
    const participantes = Store.getParticipantes?.() || [];
    const filtered = UI.filterParticipantes?.(participantes, q) || participantes;

    el.participantesTableContainer.innerHTML =
      UI.renderParticipantesTable?.(filtered) ||
      UI.fallbackParticipantesTable?.(filtered) ||
      "";

    UI.bindParticipantesTableActions?.({
      root: el.participantesTableContainer,
      onToggleActivo: onToggleParticipanteActivo_,
    });
  }

  async function onAgregarParticipante_() {
    const tallerId = Store.getSelectedTallerId?.() || "";
    if (!tallerId) return;

    const data = await Dialogs.promptParticipante?.();
    if (!data) return;

    UI.block?.(true);
    try {
      await API.createParticipante({ ...data, tallerId });
      Utils.toast?.("Participante agregado ✅", "ok");

      const participantes = await API.listParticipantesByTaller(tallerId);
      Store.setParticipantes?.(participantes);
      renderParticipantes_();
    } catch (e) {
      console.error(e);
      Utils.toast?.("No se pudo agregar el participante.", "bad");
    } finally {
      UI.block?.(false);
    }
  }

  async function onToggleParticipanteActivo_(participanteId, activoSIoNO) {
    UI.block?.(true);
    try {
      await API.updateParticipante({ participanteId, activo: activoSIoNO });
      Store.patchParticipanteActivo?.(participanteId, activoSIoNO);
      renderParticipantes_();
    } catch (e) {
      console.error(e);
      Utils.toast?.("No se pudo actualizar el participante.", "bad");
    } finally {
      UI.block?.(false);
    }
  }

  // =========================
  // Sesiones view
  // =========================
  async function openSesiones_() {
    const tallerId = Store.getSelectedTallerId?.() || "";
    if (!tallerId) return;

    go_("sesiones");
    await loadSesiones_();
  }

  async function loadSesiones_() {
    const tallerId = Store.getSelectedTallerId?.() || "";
    if (!tallerId) return;

    UI.block?.(true);
    try {
      const sesiones = await API.listSesionesByTaller(tallerId);
      Store.setSesiones?.(sesiones);
      renderSesiones_();
    } catch (e) {
      console.error(e);
      Utils.toast?.("No se pudieron cargar sesiones.", "bad");
      Store.setSesiones?.([]);
      renderSesiones_();
    } finally {
      UI.block?.(false);
    }
  }

  function renderSesiones_() {
    const sesiones = Store.getSesiones?.() || [];
    el.sesionesListContainer.innerHTML =
      UI.renderSesionesList?.(sesiones) ||
      UI.fallbackSesionesList?.(sesiones) ||
      "";

    UI.bindSesionesActions?.({
      root: el.sesionesListContainer,
      onOpenSesion: openAsistenciaForSesion_,
      onTiempoReal: (sid) => openAsistenciaForSesion_(sid).then(() => onTiempoRealSesion_()),
    });
  }

  async function onNuevaSesion_() {
    const tallerId = Store.getSelectedTallerId?.() || "";
    if (!tallerId) return;

    const data = await Dialogs.promptSesion?.({
      fechaDefault: Utils.todayISO?.() || "",
    });
    if (!data) return;

    UI.block?.(true);
    try {
      const res = await API.createSesion({ ...data, tallerId });
      Utils.toast?.("Sesión creada ✅", "ok");

      const sesiones = await API.listSesionesByTaller(tallerId);
      Store.setSesiones?.(sesiones);
      renderSesiones_();

      if (res?.sesion?.sesionId) {
        await openAsistenciaForSesion_(res.sesion.sesionId);
      }
    } catch (e) {
      console.error(e);
      Utils.toast?.("No se pudo crear la sesión.", "bad");
    } finally {
      UI.block?.(false);
    }
  }

  // =========================
  // Asistencia view
  // =========================
  async function openAsistenciaForSesion_(sesionId) {
    const tallerId = Store.getSelectedTallerId?.() || "";
    if (!tallerId || !sesionId) return;

    activeSesionId = String(sesionId);
    go_("asistencia");

    UI.block?.(true);
    try {
      const sesiones = Store.getSesiones?.() || [];
      activeSesionObj = sesiones.find(s => String(s.sesionId) === activeSesionId) || null;

      const [participantes, asistencias] = await Promise.all([
        API.listParticipantesByTaller(tallerId),
        API.getAsistenciaBySesion(activeSesionId),
      ]);

      Store.setParticipantes?.(participantes);

      // draft primero (para no perder lo que ya venías haciendo)
      asistenciaDraft = Store.loadDraftAsistencia?.(activeSesionId) || {
        sesionId: activeSesionId,
        tallerId,
        map: {}
      };

      // si draft vacío y hay data en backend, hidrata
      const draftEmpty = Object.keys(asistenciaDraft.map || {}).length === 0;
      if (draftEmpty && Array.isArray(asistencias) && asistencias.length) {
        asistenciaDraft.map = {};
        asistencias.forEach(a => {
          asistenciaDraft.map[String(a.participanteId)] = {
            estado: String(a.estado || ""),
            nota: String(a.nota || "")
          };
        });
      }

      ensureTiempoRealButton_();
      renderAsistencia_();

    } catch (e) {
      console.error(e);
      Utils.toast?.("No se pudo cargar la asistencia de la sesión.", "bad");
      asistenciaDraft = { sesionId: activeSesionId, tallerId, map: {} };
      ensureTiempoRealButton_();
      renderAsistencia_();
    } finally {
      UI.block?.(false);
    }
  }

  function ensureTiempoRealButton_() {
    // Si ya existe (en HTML o creado antes), listo.
    if (el.btnTiempoRealSesion) {
      // asegura clases correctas por si venía mal
      el.btnTiempoRealSesion.classList.add("btn-secondary");
      el.btnTiempoRealSesion.classList.remove("btn", "secondary");
      el.btnTiempoRealSesion.type = "button";
      return;
    }

    // lo creamos junto al botón Guardar, en la barra de acciones del header de asistencia
    const saveBtn = el.btnGuardarAsistencia;
    const parent = saveBtn?.parentNode;
    if (!saveBtn || !parent) return;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.id = "btnTiempoRealSesion";
    btn.className = "btn-secondary";
    btn.textContent = "⏱️ Tiempo real";
    btn.title = "Registrar hora real de inicio/fin";
    btn.addEventListener("click", onTiempoRealSesion_);

    parent.insertBefore(btn, saveBtn);
    el.btnTiempoRealSesion = btn;
  }

  function renderAsistencia_() {
    const participantes = Store.getParticipantes?.() || [];
    const activos = UI.onlyActivos?.(participantes)
      || participantes.filter(p => String(p?.activo || "SI").toUpperCase() !== "NO");

    // meta: si UI soporta sesionObj, se la pasamos
    el.asistenciaListContainer.innerHTML =
      UI.renderAsistenciaList?.(activos, asistenciaDraft?.map || {}, activeSesionObj) ||
      UI.fallbackAsistenciaList?.(activos, asistenciaDraft?.map || {}) ||
      "";

    UI.bindAsistenciaActions?.({
      root: el.asistenciaListContainer,
      onMark: onMarkAsistencia_,
      onNote: onNoteAsistencia_,
    });

    // meta arriba (si existe mount)
    UI.renderSesionMeta?.(activeSesionObj, "#sesionMetaBox");

    updateAsistenciaCounters_();
  }

  function onMarkAsistencia_(participanteId, estado) {
    if (!asistenciaDraft) return;
    const pid = String(participanteId ?? "");
    if (!pid) return;

    asistenciaDraft.map[pid] = asistenciaDraft.map[pid] || { estado:"", nota:"" };
    asistenciaDraft.map[pid].estado = estado;

    Store.saveDraftAsistencia?.(asistenciaDraft.sesionId, asistenciaDraft);
    UI.updateRowState?.(pid, asistenciaDraft.map[pid]);
    updateAsistenciaCounters_();
  }

  function onNoteAsistencia_(participanteId, nota) {
    if (!asistenciaDraft) return;
    const pid = String(participanteId ?? "");
    if (!pid) return;

    asistenciaDraft.map[pid] = asistenciaDraft.map[pid] || { estado:"", nota:"" };
    asistenciaDraft.map[pid].nota = String(nota || "");

    Store.saveDraftAsistencia?.(asistenciaDraft.sesionId, asistenciaDraft);
  }

  function updateAsistenciaCounters_() {
    const participantes = Store.getParticipantes?.() || [];
    const activos = participantes.filter(p => String(p?.activo || "SI").toUpperCase() !== "NO");

    let asistio = 0, no = 0, tarde = 0, sin = 0;

    activos.forEach(p => {
      const pid = String(p?.participanteId ?? "");
      const st = (asistenciaDraft?.map?.[pid]?.estado || "").toUpperCase();
      if (!st) sin++;
      else if (st === "ASISTIO") asistio++;
      else if (st === "NO_ASISTIO") no++;
      else if (st === "TARDE") tarde++;
      else sin++;
    });

    if (el.countAsistio) el.countAsistio.textContent = `${asistio} Asistieron`;
    if (el.countNo) el.countNo.textContent = `${no} No asistieron`;
    if (el.countTarde) el.countTarde.textContent = `${tarde} Tarde`;
    if (el.countSinMarcar) el.countSinMarcar.textContent = `${sin} Sin marcar`;
  }

  async function onGuardarAsistencia_() {
    if (!asistenciaDraft || !activeSesionId) return;

    const tallerId = Store.getSelectedTallerId?.() || "";
    const participantes = Store.getParticipantes?.() || [];
    const activos = participantes.filter(p => String(p?.activo || "SI").toUpperCase() !== "NO");

    const rows = activos.map(p => {
      const pid = String(p?.participanteId ?? "");
      const it = asistenciaDraft.map[pid] || { estado:"", nota:"" };
      return {
        participanteId: pid,
        estado: String(it.estado || ""),
        nota: String(it.nota || ""),
      };
    });

    UI.block?.(true);
    try {
      await API.saveAsistenciaBatch({
        sesionId: activeSesionId,
        tallerId,
        marcadoPor: Store.getUserLabel?.() || "",
        rows
      });

      Utils.toast?.("Asistencia guardada ✅", "ok");
      Store.clearDraftAsistencia?.(activeSesionId);

    } catch (e) {
      console.error(e);
      Utils.toast?.("No se pudo guardar. Revisa conexión / token.", "bad");
    } finally {
      UI.block?.(false);
    }
  }

  // ==========================================================
  // TIEMPO REAL SESIÓN
  // ==========================================================
  async function onTiempoRealSesion_() {
    if (!activeSesionId) {
      Utils.toast?.("Abre una sesión primero.", "warn");
      return;
    }

    if (typeof Dialogs.promptTiempoRealSesion !== "function") {
      Utils.toast?.("Dialogs.promptTiempoRealSesion no existe. Revisa dialog.js.", "bad");
      return;
    }

    if (typeof API.updateSesion !== "function") {
      Utils.toast?.("Falta API.updateSesion (backend/action updateSesion). La UI ya está lista.", "warn");
      return;
    }

    // sugerencias
    const fechaLabel = activeSesionObj?.fecha ? String(activeSesionObj.fecha) : "";
    const horaInicioSug = activeSesionObj?.horaInicio ? String(activeSesionObj.horaInicio) : "";
    const horaFinSug = activeSesionObj?.horaFin ? String(activeSesionObj.horaFin) : "";

    const patch = await Dialogs.promptTiempoRealSesion({
      fechaLabel,
      horaInicioSugerida: horaInicioSug,
      horaFinSugerida: horaFinSug
    });

    if (!patch) return;

    UI.block?.(true);
    try {
      const res = await API.updateSesion({
        sesionId: activeSesionId,
        ...patch
      });

      // cache local
      activeSesionObj = { ...(activeSesionObj || {}), ...patch };

      // parchea store si existe
      Store.patchSesion?.(activeSesionId, patch);

      // refresca sin recargar todo
      renderAsistencia_();

      Utils.toast?.("Tiempo real guardado ✅", "ok");
      return res;

    } catch (e) {
      console.error(e);
      Utils.toast?.("No se pudo guardar el tiempo real.", "bad");
    } finally {
      UI.block?.(false);
    }
  }

  // =========================
  // Reportes (MVP)
  // =========================
  async function openReportes_() {
    const tallerId = Store.getSelectedTallerId?.() || "";
    if (!tallerId) return;

    go_("reportes");
    await loadReportes_();
  }

  async function loadReportes_() {
    const tallerId = Store.getSelectedTallerId?.() || "";
    if (!tallerId) return;

    UI.block?.(true);
    try {
      const [participantes, sesiones] = await Promise.all([
        API.listParticipantesByTaller(tallerId),
        API.listSesionesByTaller(tallerId),
      ]);

      // asistencias por sesión en paralelo con límite para no saturar
      const asistenciasBySesion = await fetchAsistenciasBySesion_(sesiones);

      el.reportesContainer.innerHTML =
        UI.renderReportes?.({ participantes, sesiones, asistenciasBySesion }) ||
        UI.fallbackReportes?.({ participantes, sesiones, asistenciasBySesion }) ||
        "";

    } catch (e) {
      console.error(e);
      Utils.toast?.("No se pudieron cargar reportes.", "bad");
      el.reportesContainer.innerHTML = UI.renderEmpty?.("No hay datos para reportes todavía.") || "";
    } finally {
      UI.block?.(false);
    }
  }

  // ===== util: fetch asistencias con límite =====
  async function fetchAsistenciasBySesion_(sesiones) {
    const list = Array.isArray(sesiones) ? sesiones : [];
    const out = {};

    // nada que hacer
    if (!list.length || typeof API.getAsistenciaBySesion !== "function") return out;

    const limit = 6; // buen balance: rápido sin explotar el Apps Script
    let idx = 0;

    async function worker() {
      while (idx < list.length) {
        const cur = list[idx++];
        const sid = String(cur?.sesionId ?? "");
        if (!sid) continue;

        try {
          const a = await API.getAsistenciaBySesion(sid);
          out[sid] = a || [];
        } catch (_e) {
          out[sid] = [];
        }
      }
    }

    const workers = Array.from({ length: Math.min(limit, list.length) }, () => worker());
    await Promise.all(workers);
    return out;
  }

})();