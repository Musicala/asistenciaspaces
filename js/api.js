/* api.js — DEPRECADO (migración a Firebase/Firestore)
   ────────────────────────────────────────────────────────────────
   Este archivo consumía el Web App de Apps Script. Ya NO se usa.
   La capa de datos vive ahora en módulos ESM:

     js/firebase/config.js      → init de Firebase (pega aquí tu firebaseConfig)
     js/firebase/auth.js        → login Google + allowlist
     js/data/*Repo.js           → CRUD por colección (clientes, paquetes,
                                   reservas, asistentes, asistencia, audit)
     js/services/consumoService → cierre atómico de reservas + consumo
     js/services/statsService   → estadísticas de dashboards
     js/services/importService  → importación CSV/JSON
     js/services/exportService  → exportación CSV (y PDF preparado)

   El index.html nuevo carga js/app-firebase.js como <script type="module">.
   La versión anterior quedó respaldada en index.legacy.html y los módulos
   globales viejos (store.js, ui.js, dialog.js, app.js) ya no se incluyen.
   ──────────────────────────────────────────────────────────────── */

console.warn(
  "[Asistencia Spaces] js/api.js está deprecado. La app usa Firebase (js/app-firebase.js)."
);
