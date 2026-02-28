/* dialog.js — Asistencia Spaces (v1.0)
   Manejo de modales con <dialog>
*/

(() => {
  'use strict';

  const $ = (s) => document.querySelector(s);

  // ====== DOM refs ======
  const modalEmpresa = $("#modalEmpresa");
  const modalTaller = $("#modalTaller");
  const modalParticipante = $("#modalParticipante");

  // Inputs Empresa
  const inputEmpresaNombre = $("#inputEmpresaNombre");
  const inputEmpresaContacto = $("#inputEmpresaContacto");
  const inputEmpresaTelefono = $("#inputEmpresaTelefono");
  const inputEmpresaEmail = $("#inputEmpresaEmail");

  // Inputs Taller
  const inputTallerNombre = $("#inputTallerNombre");
  const inputFechaInicio = $("#inputFechaInicio");
  const inputFechaFin = $("#inputFechaFin");
  const inputFacilitador = $("#inputFacilitador");

  // Inputs Participante
  const inputParticipanteNombre = $("#inputParticipanteNombre");
  const inputParticipanteDocumento = $("#inputParticipanteDocumento");
  const inputParticipanteTelefono = $("#inputParticipanteTelefono");
  const inputParticipanteEmail = $("#inputParticipanteEmail");

  // ====== Helpers ======
  function resetEmpresa_() {
    inputEmpresaNombre.value = "";
    inputEmpresaContacto.value = "";
    inputEmpresaTelefono.value = "";
    inputEmpresaEmail.value = "";
  }

  function resetTaller_() {
    inputTallerNombre.value = "";
    inputFechaInicio.value = "";
    inputFechaFin.value = "";
    inputFacilitador.value = "";
  }

  function resetParticipante_() {
    inputParticipanteNombre.value = "";
    inputParticipanteDocumento.value = "";
    inputParticipanteTelefono.value = "";
    inputParticipanteEmail.value = "";
  }

  function waitDialog_(dialog) {
    return new Promise((resolve) => {
      const handler = () => {
        dialog.removeEventListener("close", handler);
        resolve(dialog.returnValue === "cancel" ? null : true);
      };
      dialog.addEventListener("close", handler);
    });
  }

  function open_(dialog) {
    if (!dialog) return;
    dialog.showModal();
  }

  // ==========================================================
  // EMPRESA
  // ==========================================================
  async function promptEmpresa() {
    if (!modalEmpresa) return null;

    resetEmpresa_();
    open_(modalEmpresa);

    const confirmed = await waitDialog_(modalEmpresa);
    if (!confirmed) return null;

    const nombre = inputEmpresaNombre.value.trim();
    if (!nombre) return null;

    return {
      empresaNombre: nombre,
      contactoNombre: inputEmpresaContacto.value.trim(),
      contactoTelefono: inputEmpresaTelefono.value.trim(),
      contactoEmail: inputEmpresaEmail.value.trim(),
    };
  }

  // ==========================================================
  // TALLER
  // ==========================================================
  async function promptTaller() {
    if (!modalTaller) return null;

    resetTaller_();
    open_(modalTaller);

    const confirmed = await waitDialog_(modalTaller);
    if (!confirmed) return null;

    const nombre = inputTallerNombre.value.trim();
    if (!nombre) return null;

    return {
      tallerNombre: nombre,
      fechaInicio: inputFechaInicio.value || "",
      fechaFin: inputFechaFin.value || "",
      facilitador: inputFacilitador.value.trim(),
      estado: "ACTIVO"
    };
  }

  // ==========================================================
  // PARTICIPANTE
  // ==========================================================
  async function promptParticipante() {
    if (!modalParticipante) return null;

    resetParticipante_();
    open_(modalParticipante);

    const confirmed = await waitDialog_(modalParticipante);
    if (!confirmed) return null;

    const nombre = inputParticipanteNombre.value.trim();
    if (!nombre) return null;

    return {
      nombreCompleto: nombre,
      documento: inputParticipanteDocumento.value.trim(),
      telefono: inputParticipanteTelefono.value.trim(),
      email: inputParticipanteEmail.value.trim(),
      activo: "SI"
    };
  }

  // ==========================================================
  // SESIÓN (creación rápida sin dialog dedicado)
  // ==========================================================
  async function promptSesion({ fechaDefault } = {}) {
    // versión simple con window.prompt para no inflar index
    const fecha = window.prompt(
      "Fecha de la sesión (YYYY-MM-DD):",
      fechaDefault || ""
    );

    if (!fecha) return null;

    const tema = window.prompt("Tema (opcional):", "") || "";

    return {
      fecha: fecha.trim(),
      tema: tema.trim()
    };
  }

  // Expose global
  window.Dialogs = {
    promptEmpresa,
    promptTaller,
    promptParticipante,
    promptSesion
  };

})();