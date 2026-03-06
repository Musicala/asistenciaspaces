/* ui.js — Asistencia Spaces (v2.2)
   Render + event binding helpers (upgrade visual sin romper tu app)

   ✅ Overlay “block” (clases + fallback inline) + CSS inyectado 1 vez
   ✅ Dashboard: selects + info card (badges)
   ✅ Participantes:
      - filtro mejorado (incluye acudiente)
      - tabla desktop + cards mobile (sin frameworks)
      - acciones: toggle activo
   ✅ Sesiones:
      - cards limpias (plan vs real)
      - botón “Tiempo real” (si lo usas)
      - open sesión
   ✅ Asistencia:
      - chips con aria-pressed + data-status para CSS pro
      - debounce por participante para notas
      - updateRowState sin rerender completo
   ✅ Reportes:
      - KPIs + tabla por sesión
   ✅ Helpers robustos: escape HTML/attr, CSS escape, fechas, duración, etc.
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
    if (overlayEl) return;

    overlayEl = document.createElement("div");
    overlayEl.className = "ui-overlay";
    overlayEl.setAttribute("aria-hidden", "true");
    overlayEl.style.display = "none"; // fallback si CSS no carga

    const box = document.createElement("div");
    box.className = "ui-overlay-box";
    box.textContent = "Cargando…";
    overlayEl.appendChild(box);

    // Fallback inline si no existe CSS (no debería pasar, pero humanos…)
    overlayEl.style.position = "fixed";
    overlayEl.style.inset = "0";
    overlayEl.style.background = "rgba(255,255,255,.55)";
    overlayEl.style.backdropFilter = "blur(2px)";
    overlayEl.style.zIndex = "999";
    overlayEl.style.alignItems = "center";
    overlayEl.style.justifyContent = "center";
    box.style.padding = "14px 16px";
    box.style.borderRadius = "16px";
    box.style.border = "1px solid rgba(11,16,32,.14)";
    box.style.background = "rgba(255,255,255,.92)";
    box.style.boxShadow = "0 18px 40px rgba(10,18,45,.14)";
    box.style.fontWeight = "800";
    box.style.color = "rgba(11,16,32,.78)";

    document.body.appendChild(overlayEl);

    injectOverlayCssOnce_();
    injectUiHelpersCssOnce_(); // pequeños estilos por si styles.css no lo tiene aún
  }

  function block(isOn, text) {
    if (!overlayEl) return;
    const box = overlayEl.querySelector(".ui-overlay-box");
    if (box && typeof text === "string" && text.trim()) box.textContent = text.trim();
    overlayEl.style.display = isOn ? "flex" : "none";
    overlayEl.setAttribute("aria-hidden", isOn ? "false" : "true");
  }

  function setConnection(_online) {
    // app.js ya cambia el punto y el texto; acá queda por si lo usan luego
  }

  function injectOverlayCssOnce_() {
    if (document.getElementById("ui_overlay_css")) return;

    const css = `
      .ui-overlay{
        position: fixed;
        inset: 0;
        display:none;
        align-items:center;
        justify-content:center;
        background: rgba(255,255,255,.55);
        backdrop-filter: blur(2px);
        z-index: 999;
      }
      .ui-overlay-box{
        padding: 14px 16px;
        border-radius: 16px;
        border: 1px solid rgba(11,16,32,.14);
        background: rgba(255,255,255,.92);
        box-shadow: 0 18px 40px rgba(10,18,45,.14);
        font-weight: 800;
        color: rgba(11,16,32,.78);
      }
    `.trim();

    const style = document.createElement("style");
    style.id = "ui_overlay_css";
    style.textContent = css;
    document.head.appendChild(style);
  }

  // CSS helper mini (no pisa tu styles.css, solo complementa)
  function injectUiHelpersCssOnce_() {
    if (document.getElementById("ui_helpers_css")) return;

    const css = `
      .table-wrap{ width:100%; overflow:auto; border-radius: 14px; }
      .table{ width:100%; border-collapse: collapse; }
      .table th,.table td{ padding: 12px 12px; border-bottom: 1px solid rgba(11,16,32,.08); vertical-align: top; }
      .col-compact{ width: 88px; white-space: nowrap; }
      .col-action{ width: 140px; white-space: nowrap; text-align: right; }
      .row-title{ font-weight: 800; }
      .row-sub{ margin-top: 4px; color: rgba(11,16,32,.68); font-size: 12.5px; }
      .badge{ display:inline-flex; gap:6px; align-items:center; padding:6px 10px; border-radius:999px; border:1px solid rgba(11,16,32,.10); background: rgba(255,255,255,.7); font-size:12px; font-weight:700; color: rgba(11,16,32,.72); }
      .badge.ok{ border-color: rgba(12,65,196,.18); color: rgba(12,65,196,.95); background: rgba(12,65,196,.06); }
      .badge.warn{ border-color: rgba(206,0,113,.18); color: rgba(206,0,113,.95); background: rgba(206,0,113,.06); }
      .badge.bad{ border-color: rgba(200,20,20,.18); color: rgba(180,20,20,.95); background: rgba(200,20,20,.06); }

      .empty{ padding: 14px; border-radius: 16px; border: 1px dashed rgba(11,16,32,.16); color: rgba(11,16,32,.72); background: rgba(255,255,255,.6); }

      .sessions-list{ display: grid; gap: 12px; }
      .session-card{ display:flex; align-items:stretch; justify-content:space-between; gap: 10px; padding: 12px; border-radius: 18px; border: 1px solid rgba(11,16,32,.10); background: rgba(255,255,255,.72); box-shadow: 0 10px 30px rgba(11,16,32,.06); }
      .session-meta{ flex:1; min-width: 0; }
      .session-title{ font-weight: 900; }
      .session-sub{ margin-top: 4px; color: rgba(11,16,32,.68); font-size: 12.5px; }
      .session-badges{ display:flex; flex-wrap:wrap; gap:8px; margin-top: 8px; }
      .session-actions{ display:flex; flex-direction:column; gap:8px; justify-content:center; }
      .btn-sm{ padding: 8px 10px; font-size: 12.5px; border-radius: 12px; }

      .person-row{ display:flex; gap: 10px; justify-content: space-between; align-items: flex-start; padding: 12px; border-radius: 18px; border: 1px solid rgba(11,16,32,.10); background: rgba(255,255,255,.72); }
      .person-name{ flex:1; min-width: 0; display:grid; gap: 4px; }
      .person-name small{ color: rgba(11,16,32,.58); }
      .note-input{ margin-top: 6px; padding: 10px 12px; border-radius: 14px; border: 1px solid rgba(11,16,32,.10); outline: none; }
      .note-input:focus{ box-shadow: 0 0 0 4px rgba(12,65,196,.12); border-color: rgba(12,65,196,.25); }

      .person-actions{ display:flex; gap: 8px; }
      .chip{ width: 42px; height: 40px; display:inline-flex; align-items:center; justify-content:center; border-radius: 14px; border:1px solid rgba(11,16,32,.10); background: rgba(255,255,255,.85); cursor:pointer; }
      .chip.ok{ background: rgba(12,65,196,.10); border-color: rgba(12,65,196,.22); }
      .chip.no{ background: rgba(200,20,20,.10); border-color: rgba(200,20,20,.18); }
      .chip.tarde{ background: rgba(206,0,113,.10); border-color: rgba(206,0,113,.18); }

      .asistencia-list{ display:grid; gap: 10px; }
      .sesion-meta-inline{ margin-bottom: 10px; }
      .sesion-meta-card{ padding: 10px; }
      .sesion-meta-top{ display:flex; flex-wrap:wrap; gap: 8px; align-items:center; }
      .sesion-meta-badges{ display:flex; flex-wrap:wrap; gap: 8px; margin-top: 10px; }

      .report-kpis{ display:flex; flex-wrap:wrap; gap: 8px; margin-bottom: 12px; }

      .tinfo{ display:flex; justify-content:space-between; gap: 10px; align-items:flex-start; }
      .tinfo-title{ font-weight: 900; }
      .tinfo-sub{ color: rgba(11,16,32,.65); margin-top: 2px; font-size: 13px; }
      .tinfo-right{ display:flex; flex-wrap:wrap; gap: 8px; justify-content:flex-end; }
      .tinfo-notes{ margin-top: 10px; color: rgba(11,16,32,.68); }
      .hr{ height:1px; background: rgba(11,16,32,.10); margin: 10px 0; }

      /* participantes mobile cards */
      .p-cards{ display:grid; gap: 10px; }
      .p-card{ padding: 12px; border-radius: 18px; border:1px solid rgba(11,16,32,.10); background: rgba(255,255,255,.72); box-shadow: 0 10px 30px rgba(11,16,32,.06); display:flex; justify-content:space-between; gap: 10px; }
      .p-card-main{ min-width: 0; }
      .p-card-title{ font-weight: 900; }
      .p-card-sub{ margin-top: 6px; color: rgba(11,16,32,.68); font-size: 12.5px; display:grid; gap: 2px; }
      .p-card-actions{ display:flex; flex-direction:column; gap: 8px; justify-content:center; align-items:flex-end; }
      .p-card-acud{ margin-top: 6px; color: rgba(11,16,32,.62); font-size: 12px; }
      @media (min-width: 860px){
        .p-cards{ display:none; }
      }
      @media (max-width: 859px){
        .table-wrap{ display:none; }
        .col-action{ width:auto; }
      }
    `.trim();

    const style = document.createElement("style");
    style.id = "ui_helpers_css";
    style.textContent = css;
    document.head.appendChild(style);
  }

  // =========================
  // Dashboard renders
  // =========================
  function renderEmpresaSelect(selectEl, empresas, selectedId) {
    if (!selectEl) return;

    const list = Array.isArray(empresas) ? empresas : [];
    const opts = [];

    if (list.length === 0) {
      opts.push(`<option value="">(Sin empresas)</option>`);
    } else {
      opts.push(`<option value="">Selecciona…</option>`);
      list.forEach(e => {
        const id = esc_(e?.empresaId);
        const name = esc_(e?.empresaNombre || "(Sin nombre)");
        const sel = String(e?.empresaId) === String(selectedId) ? "selected" : "";
        opts.push(`<option value="${id}" ${sel}>${name}</option>`);
      });
    }

    selectEl.innerHTML = opts.join("");
  }

  function renderTallerSelect(selectEl, talleres, selectedId) {
    if (!selectEl) return;

    const list = Array.isArray(talleres) ? talleres : [];
    const opts = [];

    if (list.length === 0) {
      opts.push(`<option value="">(Sin talleres)</option>`);
    } else {
      opts.push(`<option value="">Selecciona…</option>`);
      list.forEach(t => {
        const id = esc_(t?.tallerId);
        const name = esc_(t?.tallerNombre || "(Sin nombre)");
        const tag = (String(t?.estado || "").toUpperCase() === "CERRADO") ? " 🔒" : "";
        const sel = String(t?.tallerId) === String(selectedId) ? "selected" : "";
        opts.push(`<option value="${id}" ${sel}>${name}${tag}</option>`);
      });
    }

    selectEl.innerHTML = opts.join("");
  }

  function renderTallerInfo(taller, empresa) {
    if (!taller) return "";

    const estado = String(taller?.estado || "ACTIVO").toUpperCase();
    const badgeClass = estado === "ACTIVO" ? "ok" : "warn";

    const fi = (taller?.fechaInicio || "").toString();
    const ff = (taller?.fechaFin || "").toString();

    return `
      <div class="tinfo">
        <div class="tinfo-left">
          <div class="tinfo-title">${esc_(taller?.tallerNombre || "")}</div>
          <div class="tinfo-sub">${esc_(empresa?.empresaNombre || "")}</div>
        </div>

        <div class="tinfo-right">
          <span class="badge ${badgeClass}">${esc_(estado)}</span>
          ${(fi || ff) ? `<span class="badge">📅 ${esc_(fi || "—")} → ${esc_(ff || "—")}</span>` : ``}
          ${taller?.sede ? `<span class="badge">📍 ${esc_(taller.sede)}</span>` : ``}
          ${taller?.salon ? `<span class="badge">🏷️ ${esc_(taller.salon)}</span>` : ``}
          ${taller?.facilitador ? `<span class="badge">👤 ${esc_(taller.facilitador)}</span>` : ``}
        </div>
      </div>

      ${taller?.notas ? `<div class="hr"></div><div class="tinfo-notes">${esc_(taller.notas)}</div>` : ``}
    `;
  }

  function renderDashboardEmptyStates(_ctx) {
    // opcional
  }

  // =========================
  // Participantes
  // =========================
  function filterParticipantes(participantes, q) {
    const list = Array.isArray(participantes) ? participantes : [];
    const query = String(q || "").trim().toLowerCase();
    if (!query) return list;

    return list.filter(p => {
      const hay = [
        p?.nombreCompleto,
        p?.documento,
        p?.telefono,
        p?.email,
        p?.empresaInternaArea,

        // ✅ NUEVO: acudiente
        p?.acudienteNombre,
        p?.acudienteDocumento,
        p?.acudienteRelacion,
        p?.acudienteTelefono,
        p?.acudienteEmail
      ].filter(Boolean).join(" ").toLowerCase();

      return hay.includes(query);
    });
  }

  // Tabla desktop + cards mobile (CSS decide cuál se ve)
  function renderParticipantesTable(participantes) {
    const list = Array.isArray(participantes) ? participantes : [];
    if (list.length === 0) {
      return renderEmpty("Este taller todavía no tiene participantes. Agrega el primero 👇");
    }

    const tableRows = list.map(p => {
      const activo = (String(p?.activo || "SI").toUpperCase() !== "NO");
      const activoBadge = activo ? `<span class="badge ok">SI</span>` : `<span class="badge warn">NO</span>`;

      const sub = buildSmallLines_([
        p?.documento ? `Doc: ${esc_(p.documento)}` : "",
        p?.telefono ? `Tel: ${esc_(p.telefono)}` : "",
        p?.email ? `${esc_(p.email)}` : ""
      ]);

      const acud = buildAcudienteLine_(p);

      return `
        <tr>
          <td>
            <div class="row-title">${esc_(p?.nombreCompleto || "")}</div>
            ${sub ? `<div class="row-sub">${sub}</div>` : ``}
            ${acud ? `<div class="row-sub">${acud}</div>` : ``}
          </td>
          <td class="col-compact">${activoBadge}</td>
          <td class="col-action">
            <button
              class="btn-secondary btn-sm"
              data-action="toggle-activo"
              data-id="${esc_(p?.participanteId)}"
              data-next="${activo ? "NO" : "SI"}"
            >
              Poner ${activo ? "NO" : "SI"}
            </button>
          </td>
        </tr>
      `;
    }).join("");

    const cards = renderParticipantesCards_(list);

    return `
      ${cards}
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>Participante</th>
              <th class="col-compact">Activo</th>
              <th class="col-action">Acción</th>
            </tr>
          </thead>
          <tbody>${tableRows}</tbody>
        </table>
      </div>
    `;
  }

  function renderParticipantesCards_(list) {
    if (!Array.isArray(list) || list.length === 0) return "";
    const cards = list.map(p => {
      const activo = (String(p?.activo || "SI").toUpperCase() !== "NO");
      const activoBadge = activo ? `<span class="badge ok">SI</span>` : `<span class="badge warn">NO</span>`;

      const lines = [
        p?.documento ? `Doc: ${esc_(p.documento)}` : "",
        p?.telefono ? `Tel: ${esc_(p.telefono)}` : "",
        p?.email ? `${esc_(p.email)}` : "",
        p?.empresaInternaArea ? `Área: ${esc_(p.empresaInternaArea)}` : ""
      ].filter(Boolean);

      const acud = buildAcudienteLine_(p);

      return `
        <div class="p-card">
          <div class="p-card-main">
            <div class="p-card-title">${esc_(p?.nombreCompleto || "")}</div>
            ${lines.length ? `<div class="p-card-sub">${lines.map(x => `<div>${x}</div>`).join("")}</div>` : ``}
            ${acud ? `<div class="p-card-acud">${acud}</div>` : ``}
          </div>
          <div class="p-card-actions">
            ${activoBadge}
            <button
              class="btn-secondary btn-sm"
              data-action="toggle-activo"
              data-id="${esc_(p?.participanteId)}"
              data-next="${activo ? "NO" : "SI"}"
            >
              ${activo ? "Desactivar" : "Activar"}
            </button>
          </div>
        </div>
      `;
    }).join("");

    return `<div class="p-cards">${cards}</div>`;
  }

  function buildAcudienteLine_(p) {
    const nombre = (p?.acudienteNombre || "").toString().trim();
    const rel = (p?.acudienteRelacion || "").toString().trim();
    const tel = (p?.acudienteTelefono || "").toString().trim();
    const email = (p?.acudienteEmail || "").toString().trim();

    const any = !!(nombre || rel || tel || email);
    if (!any) return "";

    const bits = [];
    if (nombre) bits.push(`Acudiente: ${esc_(nombre)}`);
    if (rel) bits.push(`(${esc_(rel)})`);
    const contact = [tel ? `Tel: ${esc_(tel)}` : "", email ? esc_(email) : ""].filter(Boolean).join(" · ");
    if (contact) bits.push(`· ${contact}`);

    return bits.join(" ");
  }

  function bindParticipantesTableActions({ root, onToggleActivo }) {
    if (!root) return;

    root.addEventListener("click", (ev) => {
      const btn = ev.target?.closest?.("[data-action]");
      if (!btn) return;

      const action = btn.getAttribute("data-action");
      if (action === "toggle-activo") {
        const id = btn.getAttribute("data-id");
        const next = btn.getAttribute("data-next");
        if (id && onToggleActivo) onToggleActivo(id, next);
      }
    });
  }

  // =========================
  // Sesiones
  // =========================
  function renderSesionesList(sesiones) {
    const list = Array.isArray(sesiones) ? sesiones : [];
    if (list.length === 0) {
      return renderEmpty("No hay sesiones todavía. Crea la primera para empezar a marcar asistencia 📅");
    }

    // más recientes arriba
    const sorted = [...list].sort((a, b) => {
      const da = String(a?.fecha || "");
      const db = String(b?.fecha || "");
      if (da === db) return 0;
      return (da > db) ? -1 : 1;
    });

    const items = sorted.map(s => {
      const fecha = esc_(fmtDateNice_(s?.fecha) || s?.fecha || "");
      const tema = s?.tema ? esc_(s.tema) : "";
      const temaHtml = tema ? `<div class="session-sub">${tema}</div>` : "";

      const badgesPlan = buildPlanBadges_(s);
      const badgesReal = buildRealBadges_(s);

      const obs = s?.observaciones
        ? `<span class="badge">📝 ${esc_(trimShort_(s.observaciones, 40))}</span>`
        : "";

      const hasReal = !!getDuracionRealMin_(s);
      const status = hasReal
        ? `<span class="badge ok">✅ Real</span>`
        : `<span class="badge warn">⏱️ Sin real</span>`;

      return `
        <div class="session-card" data-sid="${esc_(s?.sesionId)}">
          <div class="session-meta">
            <div class="session-title">${fecha}</div>
            ${temaHtml}
            <div class="session-badges">
              ${status}
              ${badgesPlan}
              ${badgesReal}
              ${obs}
            </div>
          </div>

          <div class="session-actions">
            <button class="btn-primary btn-sm" data-action="open-sesion" data-id="${esc_(s?.sesionId)}">
              Marcar
            </button>
            <button class="btn-secondary btn-sm" data-action="tiempo-real" data-id="${esc_(s?.sesionId)}" title="Registrar tiempo real del salón">
              Tiempo real
            </button>
          </div>
        </div>
      `;
    }).join("");

    return `<div class="sessions-list">${items}</div>`;
  }

  function bindSesionesActions({ root, onOpenSesion, onTiempoReal }) {
    if (!root) return;

    root.addEventListener("click", (ev) => {
      const btn = ev.target?.closest?.("[data-action]");
      if (!btn) return;

      const action = btn.getAttribute("data-action");
      const id = btn.getAttribute("data-id");

      if (action === "open-sesion") {
        if (id && onOpenSesion) onOpenSesion(id);
      } else if (action === "tiempo-real") {
        if (id && onTiempoReal) onTiempoReal(id);
      }
    });
  }

  // =========================
  // Asistencia
  // =========================
  function onlyActivos(participantes) {
    const list = Array.isArray(participantes) ? participantes : [];
    return list.filter(p => String(p?.activo || "SI").toUpperCase() !== "NO");
  }

  // ✅ acepta sesionObj opcional como 3er argumento
  function renderAsistenciaList(participantesActivos, map, sesionObj) {
    const list = Array.isArray(participantesActivos) ? participantesActivos : [];
    if (list.length === 0) {
      return renderEmpty("No hay participantes activos para marcar asistencia.");
    }

    const meta = sesionObj ? renderSesionMetaInline(sesionObj) : "";

    const items = list.map(p => {
      const pid = String(p?.participanteId ?? "");
      const st = (map && map[pid] && map[pid].estado) ? String(map[pid].estado).toUpperCase() : "";
      const nota = (map && map[pid] && map[pid].nota) ? String(map[pid].nota) : "";

      const state = st === "ASISTIO" ? "ok" : (st === "NO_ASISTIO" ? "no" : (st === "TARDE" ? "tarde" : ""));
      const docLine = p?.documento ? `<small>${esc_(p.documento)}</small>` : `<small> </small>`;

      // aria-pressed para estilos “selected”
      const pressedOk = st === "ASISTIO" ? `aria-pressed="true"` : `aria-pressed="false"`;
      const pressedNo = st === "NO_ASISTIO" ? `aria-pressed="true"` : `aria-pressed="false"`;
      const pressedTa = st === "TARDE" ? `aria-pressed="true"` : `aria-pressed="false"`;

      return `
        <div class="person-row" data-pid="${esc_(pid)}" data-status="${esc_(state)}">
          <div class="person-name">
            <strong>${esc_(p?.nombreCompleto || "")}</strong>
            ${docLine}
            <input class="note-input" type="text" placeholder="Nota (opcional)" value="${escAttr_(nota)}"
                   data-action="note" data-id="${esc_(pid)}" />
          </div>

          <div class="person-actions" role="group" aria-label="Asistencia">
            <button class="chip ${st === "ASISTIO" ? "ok" : ""}" ${pressedOk}
                    data-action="mark" data-id="${esc_(pid)}" data-estado="ASISTIO" title="Asistió">✅</button>
            <button class="chip ${st === "NO_ASISTIO" ? "no" : ""}" ${pressedNo}
                    data-action="mark" data-id="${esc_(pid)}" data-estado="NO_ASISTIO" title="No asistió">❌</button>
            <button class="chip ${st === "TARDE" ? "tarde" : ""}" ${pressedTa}
                    data-action="mark" data-id="${esc_(pid)}" data-estado="TARDE" title="Tarde">⏱️</button>
          </div>
        </div>
      `;
    }).join("");

    return `
      ${meta ? `<div class="sesion-meta-inline">${meta}</div>` : ``}
      <div class="asistencia-list">${items}</div>
    `;
  }

  function bindAsistenciaActions({ root, onMark, onNote }) {
    if (!root) return;

    // clicks: mark
    root.addEventListener("click", (ev) => {
      const btn = ev.target?.closest?.("[data-action='mark']");
      if (!btn) return;

      const pid = btn.getAttribute("data-id");
      const estado = btn.getAttribute("data-estado");
      if (pid && estado && onMark) onMark(pid, estado);
    });

    // inputs: note (debounced per participant)
    const debouncedNote = debounceByKey_((pid, nota) => {
      if (pid && onNote) onNote(pid, nota);
    }, 220);

    root.addEventListener("input", (ev) => {
      const input = ev.target?.closest?.("[data-action='note']");
      if (!input) return;

      const pid = input.getAttribute("data-id");
      const nota = input.value;
      debouncedNote(pid, nota);
    });
  }

  // Optimiza visual sin rerender
  function updateRowState(participanteId, item) {
    const pid = String(participanteId ?? "");
    const row = document.querySelector(`.person-row[data-pid="${cssEsc_(pid)}"]`);
    if (!row) return;

    const estado = String(item?.estado || "").toUpperCase();
    const st =
      estado === "ASISTIO" ? "ok" :
      estado === "NO_ASISTIO" ? "no" :
      estado === "TARDE" ? "tarde" : "";

    row.setAttribute("data-status", st);

    const chips = row.querySelectorAll(".chip");
    chips.forEach(ch => {
      ch.classList.remove("ok", "no", "tarde");
      ch.setAttribute("aria-pressed", "false");
    });

    const okBtn = row.querySelector(`.chip[data-estado="ASISTIO"]`);
    const noBtn = row.querySelector(`.chip[data-estado="NO_ASISTIO"]`);
    const taBtn = row.querySelector(`.chip[data-estado="TARDE"]`);

    if (estado === "ASISTIO") { okBtn?.classList.add("ok"); okBtn?.setAttribute("aria-pressed","true"); }
    else if (estado === "NO_ASISTIO") { noBtn?.classList.add("no"); noBtn?.setAttribute("aria-pressed","true"); }
    else if (estado === "TARDE") { taBtn?.classList.add("tarde"); taBtn?.setAttribute("aria-pressed","true"); }
  }

  // =========================
  // Sesión meta helpers
  // =========================
  function renderSesionMeta(sesion, mountSelector = "#sesionMetaBox") {
    const mount = $(mountSelector);
    if (!mount) return;
    mount.innerHTML = sesion ? renderSesionMetaInline(sesion) : "";
  }

  function renderSesionMetaInline(sesion) {
    if (!sesion) return "";

    const fecha = fmtDateNice_(sesion?.fecha) || String(sesion?.fecha || "");
    const tema = sesion?.tema ? `<span class="badge">🧩 ${esc_(trimShort_(sesion.tema, 80))}</span>` : "";

    const planBadges = buildPlanBadges_(sesion);
    const realBadges = buildRealBadges_(sesion);

    const hasReal = !!getDuracionRealMin_(sesion);
    const status = hasReal
      ? `<span class="badge ok">✅ Tiempo real registrado</span>`
      : `<span class="badge warn">⏱️ Sin tiempo real</span>`;

    return `
      <div class="card sesion-meta-card">
        <div class="sesion-meta-top">
          <span class="badge">📅 ${esc_(fecha || "Sesión")}</span>
          ${tema}
          ${status}
        </div>
        <div class="sesion-meta-badges">
          ${planBadges}
          ${realBadges}
        </div>
      </div>
    `;
  }

  function buildPlanBadges_(s) {
    const hi = String(s?.horaInicio || "").trim();
    const hf = String(s?.horaFin || "").trim();
    const durMin = getDuracionPlanMin_(s);

    const horas = (hi || hf)
      ? `<span class="badge">🗓️ Plan: ${esc_(hi || "—")} - ${esc_(hf || "—")}</span>`
      : "";

    const dur = durMin
      ? `<span class="badge">⌛ Plan: <b>${esc_(durMin)}</b> min (${esc_(fmtHM_(durMin))})</span>`
      : "";

    return `${horas}${dur}`;
  }

  function buildRealBadges_(s) {
    const hi = String(s?.horaInicioReal || "").trim();
    const hf = String(s?.horaFinReal || "").trim();
    const durMin = getDuracionRealMin_(s);

    const horas = (hi || hf)
      ? `<span class="badge ok">⏱️ Real: ${esc_(hi || "—")} - ${esc_(hf || "—")}</span>`
      : "";

    const dur = durMin
      ? `<span class="badge ok">⌛ Real: <b>${esc_(durMin)}</b> min (${esc_(fmtHM_(durMin))})</span>`
      : "";

    return `${horas}${dur}`;
  }

  // =========================
  // Reportes (MVP)
  // =========================
  function renderReportes({ participantes, sesiones, asistenciasBySesion }) {
    const pActivos = (Array.isArray(participantes) ? participantes : [])
      .filter(p => String(p?.activo || "SI").toUpperCase() !== "NO");

    const totalP = pActivos.length;
    const listS = Array.isArray(sesiones) ? sesiones : [];
    const totalS = listS.length;

    let totalMarks = 0;
    let totalAsistio = 0;
    let totalNo = 0;
    let totalTarde = 0;
    let totalMin = 0;

    listS.forEach(s => {
      const sid = String(s?.sesionId ?? "");
      const list = (asistenciasBySesion && asistenciasBySesion[sid]) ? asistenciasBySesion[sid] : [];

      totalMarks += (Array.isArray(list) ? list.length : 0);

      (Array.isArray(list) ? list : []).forEach(a => {
        const st = String(a?.estado || "").toUpperCase();
        if (st === "ASISTIO") totalAsistio++;
        else if (st === "NO_ASISTIO") totalNo++;
        else if (st === "TARDE") totalTarde++;
      });

      const dur = getDuracionEffectiveMin_(s); // ✅ real>plan
      if (dur) totalMin += Number(dur) || 0;
    });

    const denom = Math.max(totalMarks, 1);
    const pct = (n) => Math.round((n / denom) * 100);

    const timeBadge = totalMin
      ? `<span class="badge">⌛ Tiempo total: <b>${esc_(totalMin)}</b> min (${esc_(fmtHM_(totalMin))})</span>`
      : "";

    const header = `
      <div class="report-kpis">
        <span class="badge">👥 Participantes activos: <b>${totalP}</b></span>
        <span class="badge">📅 Sesiones: <b>${totalS}</b></span>
        ${timeBadge}
        <span class="badge ok">✅ Asistió: <b>${totalAsistio}</b> (${pct(totalAsistio)}%)</span>
        <span class="badge bad">❌ No: <b>${totalNo}</b> (${pct(totalNo)}%)</span>
        <span class="badge warn">⏱️ Tarde: <b>${totalTarde}</b> (${pct(totalTarde)}%)</span>
      </div>
    `;

    // cronológico ascendente
    const sorted = [...listS].sort((a, b) => {
      const da = String(a?.fecha || "");
      const db = String(b?.fecha || "");
      if (da === db) return 0;
      return (da < db) ? -1 : 1;
    });

    const bySession = sorted.map(s => {
      const sid = String(s?.sesionId ?? "");
      const list = (asistenciasBySesion && asistenciasBySesion[sid]) ? asistenciasBySesion[sid] : [];
      const a = countEstado_(list, "ASISTIO");
      const n = countEstado_(list, "NO_ASISTIO");
      const t = countEstado_(list, "TARDE");

      const durEff = getDuracionEffectiveMin_(s);
      const durPlan = getDuracionPlanMin_(s);
      const durReal = getDuracionRealMin_(s);

      const lineDur = (() => {
        const bits = [];
        if (durPlan) bits.push(`Plan: ${esc_(durPlan)} min`);
        if (durReal) bits.push(`Real: ${esc_(durReal)} min`);
        if (!durPlan && !durReal && durEff) bits.push(`${esc_(durEff)} min`);
        return bits.length
          ? `<div class="row-sub">⌛ ${bits.join(" · ")} (${esc_(fmtHM_(durEff || durPlan || durReal))})</div>`
          : "";
      })();

      const tema = s?.tema ? `<div class="row-sub">${esc_(s.tema)}</div>` : "";

      return `
        <tr>
          <td>
            <div class="row-title">${esc_(fmtDateNice_(s?.fecha) || s?.fecha || "")}</div>
            ${tema}
            ${lineDur}
          </td>
          <td class="col-compact">${a}</td>
          <td class="col-compact">${n}</td>
          <td class="col-compact">${t}</td>
          <td class="col-compact">${Array.isArray(list) ? list.length : 0}</td>
        </tr>
      `;
    }).join("");

    const table = `
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>Sesión</th>
              <th class="col-compact">✅</th>
              <th class="col-compact">❌</th>
              <th class="col-compact">⏱️</th>
              <th class="col-compact">Total</th>
            </tr>
          </thead>
          <tbody>
            ${bySession || `<tr><td colspan="5">${renderEmpty("No hay sesiones para reportar.")}</td></tr>`}
          </tbody>
        </table>
      </div>
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

  function escAttr_(s) {
    return esc_(s).replaceAll("\n", " ").replaceAll("\r", " ");
  }

  function trimShort_(s, n) {
    const str = String(s || "");
    if (str.length <= n) return str;
    return str.slice(0, Math.max(0, n - 1)) + "…";
  }

  function countEstado_(arr, estado) {
    const list = Array.isArray(arr) ? arr : [];
    const target = String(estado || "").toUpperCase();
    return list.reduce((acc, x) => acc + ((String(x?.estado || "").toUpperCase() === target) ? 1 : 0), 0);
  }

  function cssEsc_(s) {
    if (window.CSS && CSS.escape) return CSS.escape(String(s));
    return String(s).replace(/["\\]/g, "\\$&");
  }

  function safeNum_(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  function buildSmallLines_(lines) {
    const list = (Array.isArray(lines) ? lines : []).map(x => String(x || "").trim()).filter(Boolean);
    return list.join(" · ");
  }

  // Debounce per key (for notes per participant)
  function debounceByKey_(fn, wait = 200) {
    const timers = new Map();
    return (key, ...args) => {
      const k = String(key ?? "");
      if (timers.has(k)) clearTimeout(timers.get(k));
      timers.set(k, setTimeout(() => {
        timers.delete(k);
        fn(k, ...args);
      }, wait));
    };
  }

  // =========================
  // Tiempo helpers
  // =========================
  function parseTimeToMin_(hhmm) {
    const s = String(hhmm || "").trim();
    if (!s) return null;
    const m = /^(\d{1,2}):(\d{2})$/.exec(s);
    if (!m) return null;

    const hh = Number(m[1]);
    const mm = Number(m[2]);
    if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
    if (hh < 0 || hh > 23) return null;
    if (mm < 0 || mm > 59) return null;

    return hh * 60 + mm;
  }

  function calcDuracionMinFromHoras_(horaInicio, horaFin) {
    const a = parseTimeToMin_(horaInicio);
    const b = parseTimeToMin_(horaFin);
    if (a === null || b === null) return null;
    const d = b - a;
    if (d <= 0) return null;
    return d;
  }

  // PLAN
  function getDuracionPlanMin_(sesion) {
    const raw = safeNum_(sesion?.duracionMin);
    if (raw && raw > 0) return Math.round(raw);

    const hi = sesion?.horaInicio;
    const hf = sesion?.horaFin;
    const calc = calcDuracionMinFromHoras_(hi, hf);
    if (calc && calc > 0) return Math.round(calc);

    return "";
  }

  // REAL
  function getDuracionRealMin_(sesion) {
    const raw = safeNum_(sesion?.duracionRealMin);
    if (raw && raw > 0) return Math.round(raw);

    const hi = sesion?.horaInicioReal;
    const hf = sesion?.horaFinReal;
    const calc = calcDuracionMinFromHoras_(hi, hf);
    if (calc && calc > 0) return Math.round(calc);

    return "";
  }

  // EFECTIVA: real > plan
  function getDuracionEffectiveMin_(sesion) {
    return getDuracionRealMin_(sesion) || getDuracionPlanMin_(sesion) || "";
  }

  function fmtHM_(mins) {
    const m = Number(mins);
    if (!Number.isFinite(m) || m <= 0) return "";
    const hh = Math.floor(m / 60);
    const mm = m % 60;
    if (!hh) return `${mm}m`;
    return `${hh}h ${String(mm).padStart(2, "0")}m`;
  }

  function fmtDateNice_(iso) {
    const s = String(iso || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return "";
    const [Y, M, D] = s.split("-").map(Number);
    if (!Y || !M || !D) return "";
    return `${String(D).padStart(2,"0")}/${String(M).padStart(2,"0")}/${Y}`;
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

    renderSesionMeta,
    renderSesionMetaInline,

    renderReportes,
    renderEmpty,

    // time helpers exported (por si app.js/reportes quiere)
    getDuracionPlanMin: getDuracionPlanMin_,
    getDuracionRealMin: getDuracionRealMin_,
    getDuracionEffectiveMin: getDuracionEffectiveMin_,
    fmtHM: fmtHM_,

    // fallbacks
    fallbackParticipantesTable: renderParticipantesTable,
    fallbackSesionesList: renderSesionesList,
    fallbackAsistenciaList: renderAsistenciaList,
    fallbackReportes: renderReportes,
  };

})();