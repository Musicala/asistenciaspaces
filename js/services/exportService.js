/* services/exportService.js — Exporta reportes a CSV (y dejado listo para PDF) */

// Escapa un valor para CSV (comillas dobles, comas, saltos).
function csvCell(v) {
  const s = v === null || v === undefined ? "" : String(v);
  if (/[",\n;]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * Convierte un array de objetos a string CSV.
 * @param {object[]} rows
 * @param {Array<{key:string,label:string}>} columns
 */
export function toCSV(rows, columns) {
  const cols = columns || (rows[0] ? Object.keys(rows[0]).map((k) => ({ key: k, label: k })) : []);
  const header = cols.map((c) => csvCell(c.label)).join(",");
  const body = (rows || [])
    .map((r) => cols.map((c) => csvCell(typeof c.format === "function" ? c.format(r[c.key], r) : r[c.key])).join(","))
    .join("\n");
  return `${header}\n${body}`;
}

/** Descarga un CSV en el navegador (UTF-8 con BOM para Excel). */
export function descargarCSV(filename, rows, columns) {
  const csv = toCSV(rows, columns);
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* PDF: dejado preparado. Para activar, incluir jsPDF por CDN y descomentar.
   Mantener el mismo contrato (rows, columns) que CSV para reutilizar datos.

   export async function descargarPDF(filename, rows, columns, titulo) {
     // import { jsPDF } from "https://cdn.jsdelivr.net/npm/jspdf@2/+esm";
     // import autoTable from "https://cdn.jsdelivr.net/npm/jspdf-autotable@3/+esm";
     // const docpdf = new jsPDF();
     // docpdf.text(titulo || filename, 14, 16);
     // autoTable(docpdf, { head: [columns.map(c=>c.label)], body: rows.map(r=>columns.map(c=>r[c.key])) });
     // docpdf.save(filename.endsWith(".pdf") ? filename : filename + ".pdf");
   }
*/
