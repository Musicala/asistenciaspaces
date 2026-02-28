/* ui.js — Asistencia Spaces (v1.0)
   Render + event binding helpers
*/

(() => {
  'use strict';

  const Utils = window.Utils || {};
  const $ = (s) => document.querySelector(s);

  let overlayEl = null;

  // =========================
  // Init / Blocking
  // =========================
  function init() {
    // overlay para "block" opcional
    overlayEl = document.createElement("div");
    overlayEl.style.position = "fixed";
    overlayEl.style.inset = "0";
    overlayEl.style.background = "rgba(255,255,255,.55)";
    overlayEl.style.backdropFilter = "blur(2px)";
    overlayEl.style.zIndex = "999";
    overlayEl.style.display = "none";
    overlayEl.style.alignItems = "center";
    overlayEl.style.justifyContent = "center";

    const box = document.createElement("div");
    box.style.padding = "14px 16px";
    box.style.borderRadius = "16px";
    box.style.border = "1px solid rgba(11,16,32,.14)";
    box.style.background = "rgba(255,255,255,.92)";
    box.style.boxShadow = "0 18px 40px rgba(10,18,45,.14)";
    box.style.fontWeight = "700";
    box.style.color = "rgba(11,16,32,.78)";
    box.textContent = "Cargando…";
    overlayEl.appendChild(box);

    document.body.appendChild(overlayEl);
  }

  function block(isOn) {
    if (!overlayEl) return;
    overlayEl.style.display = isOn ? "flex" : "none";
  }

  function setConnection(online) {
    // app.js ya cambia el punto y el texto; acá lo dejamos por si quieren usarlo luego
    // (no-op)
  }

  // =========================
  // Dashboard renders
  // =========================
  function renderEmpresaSelect(selectEl, empresas, selectedId) {
    if (!selectEl) return;

    const opts = [];
    if (!empresas || empresas.length === 0) {
      opts.push(`<option value="">(Sin empresas)</option>`);
    } else {
      opts.push(`<option value="">Selecciona…</option>`);
      empresas.forEach(e => {
        const id = esc_(e.empresaId);
        const name = esc_(e.empresaNombre || "(Sin nombre)");
        const sel = String(e.empresaId) === String(selectedId) ? "selected" : "";
        opts.push(`<option value="${id}" ${sel}>${name}</option>`);
      });
    }
    selectEl.innerHTML = opts.join("");
  }

  function renderTallerSelect(selectEl, talleres, selectedId) {
    if (!selectEl) return;

    const opts = [];
    if (!talleres || talleres.length === 0) {
      opts.push(`<option value="">(Sin talleres)</option>`);
    } else {
      opts.push(`<option value="">Selecciona…</option>`);
      talleres.forEach(t => {
        const id = esc_(t.tallerId);
        const name = esc_(t.tallerNombre || "(Sin nombre)");
        const tag = (t.estado || "").toUpperCase() === "CERRADO" ? " 🔒" : "";
        const sel = String(t.tallerId) === String(selectedId) ? "selected" : "";
        opts.push(`<option value="${id}" ${sel}>${name}${tag}</option>`);
      });
    }
    selectEl.innerHTML = opts.join("");
  }

  function renderTallerInfo(taller, empresa) {
    if (!taller) return "";

    const estado = (taller.estado || "ACTIVO").toUpperCase();
    const badgeClass = estado === "ACTIVO" ? "ok" : "warn";

    const fi = (taller.fechaInicio || "").toString();
    const ff = (taller.fechaFin || "").toString();

    return `
      <div style="display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap;">
        <div style="min-width:240px">
          <div style="font-weight:800; font-size:14px;">${esc_(taller.tallerNombre || "")}</div>
          <div style="color:rgba(11,16,32,.65); font-size:12px; margin-top:4px;">
            ${esc_(empresa?.empresaNombre || "")}
          </div>
        </div>

        <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
          <span class="badge ${badgeClass}">${esc_(estado)}</span>
          ${fi || ff ? `<span class="badge">${esc_(fi || "—")} → ${esc_(ff || "—")}</span>` : ``}
          ${taller.sede ? `<span class="badge">📍 ${esc_(taller.sede)}</span>` : ``}
          ${taller.salon ? `<span class="badge">🏷️ ${esc_(taller.salon)}</span>` : ``}
          ${taller.facilitador ? `<span class="badge">👤 ${esc_(taller.facilitador)}</span>` : ``}
        </div>
      </div>

      ${taller.notas ? `<div class="hr"></div><div style="font-size:12px; color:rgba(11,16,32,.72)">${esc_(taller.notas)}</div>` : ``}
    `;
  }

  function renderDashboardEmptyStates({ empresasCount, talleresCount, empresaId, tallerId }) {
    // optional: si quieren, aquí podríamos inyectar avisos en dashboard.
    // lo dejamos no-op para no pelear con layout.
  }

  // =========================
  // Participantes
  // =========================
  function filterParticipantes(participantes, q) {
    const query = String(q || "").trim().toLowerCase();
    if (!query) return participantes;

    return (participantes || []).filter(p => {
      const hay = [
        p.nombreCompleto,
        p.documento,
        p.telefono,
        p.email,
        p.empresaInternaArea
      ].join(" ").toLowerCase();
      return hay.includes(query);
    });
  }

  function renderParticipantesTable(participantes) {
    if (!participantes || participantes.length === 0) {
      return renderEmpty("Este taller todavía no tiene participantes. Agrega el primero 👇");
    }

    const rows = participantes.map(p => {
      const activo = (String(p.activo || "SI").toUpperCase() !== "NO");
      const activoBadge = activo ? `<span class="badge ok">SI</span>` : `<span class="badge warn">NO</span>`;
      const doc = p.documento ? `<div style="color:rgba(11,16,32,.62); font-size:12px;">Doc: ${esc_(p.documento)}</div>` : "";
      const tel = p.telefono ? `<div style="color:rgba(11,16,32,.62); font-size:12px;">Tel: ${esc_(p.telefono)}</div>` : "";
      const mail = p.email ? `<div style="color:rgba(11,16,32,.62); font-size:12px;">${esc_(p.email)}</div>` : "";

      return `
        <tr>
          <td>
            <div style="font-weight:800;">${esc_(p.nombreCompleto || "")}</div>
            ${doc}${tel}${mail}
          </td>
          <td style="width:140px;">${activoBadge}</td>
          <td style="width:220px;">
            <button
              class="btn-secondary"
              data-action="toggle-activo"
              data-id="${esc_(p.participanteId)}"
              data-next="${activo ? "NO" : "SI"}"
              style="padding:10px 12px; border-radius:14px;"
            >
              Poner ${activo ? "NO" : "SI"}
            </button>
          </td>
        </tr>
      `;
    }).join("");

    return `
      <table class="table">
        <thead>
          <tr>
            <th>Participante</th>
            <th>Activo</th>
            <th>Acción</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }

  function bindParticipantesTableActions({ root, onToggleActivo }) {
    if (!root) return;

    root.onclick = (ev) => {
      const btn = ev.target.closest("[data-action]");
      if (!btn) return;

      const action = btn.getAttribute("data-action");
      if (action === "toggle-activo") {
        const id = btn.getAttribute("data-id");
        const next = btn.getAttribute("data-next");
        if (id && onToggleActivo) onToggleActivo(id, next);
      }
    };
  }

  // =========================
  // Sesiones
  // =========================
  function renderSesionesList(sesiones) {
    if (!sesiones || sesiones.length === 0) {
      return renderEmpty("No hay sesiones todavía. Crea la primera para empezar a marcar asistencia 📅");
    }

    const items = sesiones.map(s => {
      const fecha = esc_(s.fecha || "");
      const tema = s.tema ? `<div style="color:rgba(11,16,32,.62); font-size:12px; margin-top:2px;">${esc_(s.tema)}</div>` : "";
      const horas = (s.horaInicio || s.horaFin)
        ? `<span class="badge">⏱️ ${esc_(s.horaInicio || "—")} - ${esc_(s.horaFin || "—")}</span>`
        : "";

      return `
        <div class="person-row" style="align-items:flex-start;">
          <div class="person-name">
            <strong>${fecha}</strong>
            ${tema}
            <div style="margin-top:8px; display:flex; gap:8px; flex-wrap:wrap;">
              ${horas}
              ${s.observaciones ? `<span class="badge">📝 ${esc_(trimShort_(s.observaciones, 40))}</span>` : ""}
            </div>
          </div>

          <div class="person-actions" style="justify-content:flex-end;">
            <button class="btn-primary" data-action="open-sesion" data-id="${esc_(s.sesionId)}" style="padding:10px 14px;">
              Marcar asistencia
            </button>
          </div>
        </div>
      `;
    }).join("");

    return `<div>${items}</div>`;
  }

  function bindSesionesActions({ root, onOpenSesion }) {
    if (!root) return;
    root.onclick = (ev) => {
      const btn = ev.target.closest("[data-action]");
      if (!btn) return;

      const action = btn.getAttribute("data-action");
      if (action === "open-sesion") {
        const id = btn.getAttribute("data-id");
        if (id && onOpenSesion) onOpenSesion(id);
      }
    };
  }

  // =========================
  // Asistencia
  // =========================
  function onlyActivos(participantes) {
    return (participantes || []).filter(p => String(p.activo || "SI").toUpperCase() !== "NO");
  }

  function renderAsistenciaList(participantesActivos, map) {
    if (!participantesActivos || participantesActivos.length === 0) {
      return renderEmpty("No hay participantes activos para marcar asistencia.");
    }

    const items = participantesActivos.map(p => {
      const pid = String(p.participanteId);
      const st = (map && map[pid] && map[pid].estado) ? String(map[pid].estado).toUpperCase() : "";
      const nota = (map && map[pid] && map[pid].nota) ? String(map[pid].nota) : "";

      const clsOk = st === "ASISTIO" ? "ok" : "";
      const clsNo = st === "NO_ASISTIO" ? "no" : "";
      const clsTa = st === "TARDE" ? "tarde" : "";

      return `
        <div class="person-row" data-pid="${esc_(pid)}">
          <div class="person-name">
            <strong>${esc_(p.nombreCompleto || "")}</strong>
            ${p.documento ? `<small>${esc_(p.documento)}</small>` : `<small> </small>`}
            <input class="note-input" type="text" placeholder="Nota (opcional)" value="${escAttr_(nota)}"
                   data-action="note" data-id="${esc_(pid)}" />
          </div>

          <div class="person-actions">
            <button class="chip ${clsOk}" data-action="mark" data-id="${esc_(pid)}" data-estado="ASISTIO">✅</button>
            <button class="chip ${clsNo}" data-action="mark" data-id="${esc_(pid)}" data-estado="NO_ASISTIO">❌</button>
            <button class="chip ${clsTa}" data-action="mark" data-id="${esc_(pid)}" data-estado="TARDE">⏱️</button>
          </div>
        </div>
      `;
    }).join("");

    return `<div>${items}</div>`;
  }

  function bindAsistenciaActions({ root, onMark, onNote }) {
    if (!root) return;

    root.onclick = (ev) => {
      const btn = ev.target.closest("[data-action='mark']");
      if (!btn) return;

      const pid = btn.getAttribute("data-id");
      const estado = btn.getAttribute("data-estado");
      if (pid && estado && onMark) onMark(pid, estado);
    };

    root.oninput = (ev) => {
      const input = ev.target.closest("[data-action='note']");
      if (!input) return;

      const pid = input.getAttribute("data-id");
      const nota = input.value;
      if (pid && onNote) onNote(pid, nota);
    };
  }

  // Opcional: si app.js llama esto para optimizar visual
  function updateRowState(participanteId, item) {
    const pid = String(participanteId);
    const row = document.querySelector(`.person-row[data-pid="${cssEsc_(pid)}"]`);
    if (!row) return;

    const estado = String(item?.estado || "").toUpperCase();

    const chips = row.querySelectorAll(".chip");
    chips.forEach(ch => ch.classList.remove("ok", "no", "tarde"));

    const okBtn = row.querySelector(`.chip[data-estado="ASISTIO"]`);
    const noBtn = row.querySelector(`.chip[data-estado="NO_ASISTIO"]`);
    const taBtn = row.querySelector(`.chip[data-estado="TARDE"]`);

    if (estado === "ASISTIO") okBtn?.classList.add("ok");
    else if (estado === "NO_ASISTIO") noBtn?.classList.add("no");
    else if (estado === "TARDE") taBtn?.classList.add("tarde");
  }

  // =========================
  // Reportes (MVP)
  // =========================
  function renderReportes({ participantes, sesiones, asistenciasBySesion }) {
    const pActivos = (participantes || []).filter(p => String(p.activo || "SI").toUpperCase() !== "NO");
    const totalP = pActivos.length;
    const totalS = (sesiones || []).length;

    // Calcula totals
    let totalMarks = 0;
    let totalAsistio = 0;
    let totalNo = 0;
    let totalTarde = 0;

    // Index asistencias por sesión -> participante
    (sesiones || []).forEach(s => {
      const sid = String(s.sesionId);
      const list = asistenciasBySesion?.[sid] || [];
      totalMarks += list.length;

      list.forEach(a => {
        const st = String(a.estado || "").toUpperCase();
        if (st === "ASISTIO") totalAsistio++;
        else if (st === "NO_ASISTIO") totalNo++;
        else if (st === "TARDE") totalTarde++;
      });
    });

    const pct = (n, d) => d ? Math.round((n / d) * 100) : 0;

    const header = `
      <div style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom:12px;">
        <span class="badge">👥 Participantes activos: <b>${totalP}</b></span>
        <span class="badge">📅 Sesiones: <b>${totalS}</b></span>
        <span class="badge ok">✅ Asistió: <b>${totalAsistio}</b> (${pct(totalAsistio, Math.max(totalMarks,1))}%)</span>
        <span class="badge bad">❌ No: <b>${totalNo}</b> (${pct(totalNo, Math.max(totalMarks,1))}%)</span>
        <span class="badge warn">⏱️ Tarde: <b>${totalTarde}</b> (${pct(totalTarde, Math.max(totalMarks,1))}%)</span>
      </div>
    `;

    const bySession = (sesiones || []).map(s => {
      const sid = String(s.sesionId);
      const list = asistenciasBySesion?.[sid] || [];
      const a = countEstado_(list, "ASISTIO");
      const n = countEstado_(list, "NO_ASISTIO");
      const t = countEstado_(list, "TARDE");

      return `
        <tr>
          <td><b>${esc_(s.fecha || "")}</b>${s.tema ? `<div style="font-size:12px;color:rgba(11,16,32,.62)">${esc_(s.tema)}</div>` : ""}</td>
          <td>${a}</td>
          <td>${n}</td>
          <td>${t}</td>
          <td>${list.length}</td>
        </tr>
      `;
    }).join("");

    const table = `
      <table class="table">
        <thead>
          <tr>
            <th>Sesión</th>
            <th>✅</th>
            <th>❌</th>
            <th>⏱️</th>
            <th>Total marcados</th>
          </tr>
        </thead>
        <tbody>
          ${bySession || `<tr><td colspan="5">${renderEmpty("No hay sesiones para reportar.")}</td></tr>`}
        </tbody>
      </table>
    `;

    return header + table;
  }

  // =========================
  // Empty / helpers
  // =========================
  function renderEmpty(msg) {
    return `<div class="empty">${esc_(msg || "Sin datos.")}</div>`;
  }

  function esc_(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }
  function escAttr_(s){ return esc_(s).replaceAll("\n"," "); }

  function trimShort_(s, n) {
    const str = String(s || "");
    if (str.length <= n) return str;
    return str.slice(0, n - 1) + "…";
  }

  function countEstado_(arr, estado) {
    const target = String(estado || "").toUpperCase();
    return (arr || []).reduce((acc, x) => {
      return acc + ((String(x.estado || "").toUpperCase() === target) ? 1 : 0);
    }, 0);
  }

  function cssEsc_(s) {
    // CSS.escape fallback
    if (window.CSS && CSS.escape) return CSS.escape(String(s));
    return String(s).replace(/["\\]/g, "\\$&");
  }

  // =========================
  // Expose
  // =========================
  window.UI = {
    init,
    block,
    setConnection,

    renderEmpresaSelect,
    renderTallerSelect,
    renderTallerInfo,
    renderDashboardEmptyStates,

    filterParticipantes,
    renderParticipantesTable,
    bindParticipantesTableActions,

    renderSesionesList,
    bindSesionesActions,

    onlyActivos,
    renderAsistenciaList,
    bindAsistenciaActions,
    updateRowState,

    renderReportes,
    renderEmpty,

    // fallbacks for app.js optional calls
    fallbackParticipantesTable: renderParticipantesTable,
    fallbackSesionesList: renderSesionesList,
    fallbackAsistenciaList: renderAsistenciaList,
    fallbackReportes: renderReportes,
  };

})();