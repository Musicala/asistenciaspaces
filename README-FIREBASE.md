# Asistencia Spaces — Edición Firebase

Migración de Apps Script/Google Sheets a **Firebase/Firestore**, sin build/bundler
(módulos ESM por CDN). Mantiene el estilo visual Musicala (light only).

---

## 1. Arquitectura

```
index.html              ← app nueva (carga js/app-firebase.js como módulo)
index.legacy.html       ← respaldo de la versión Apps Script
styles.css              ← estilos originales (reusados)
styles-spaces.css       ← componentes nuevos (KPIs, progreso, login, nav)
firestore.rules         ← seguridad (login Google + allowlist de correos)
firestore.indexes.json  ← índices compuestos sugeridos
firebase.json           ← Hosting + Firestore

js/
  firebase/
    config.js           ← 👈 PEGA AQUÍ tu firebaseConfig
    auth.js             ← login con Google + allowlist
  core/
    constants.js        ← correos autorizados, roles, estados, reglas por defecto
    time.js             ← matemática de minutos/horas, gracia y redondeo
  data/                 ← repositorios (CRUD por colección) + auditoría
    base.js, clientesRepo.js, paquetesRepo.js, reservasRepo.js,
    asistentesRepo.js, asistenciaRepo.js, auditRepo.js
  services/
    consumoService.js   ← cierre/reapertura ATÓMICA + cálculo de consumo
    statsService.js     ← estadísticas (general / por cliente / por paquete)
    importService.js    ← importación CSV/JSON
    exportService.js    ← exportación CSV (PDF preparado)
  app-firebase.js       ← orquestador de UI (vistas, modales, navegación)
```

### Modelo de datos (Firestore)
`clientes`, `paquetes`, `reservas`, `asistentes`, `reservas/{id}/asistencia`,
`auditLogs`, `usuarios`. (Ver el detalle de campos en cada `*Repo.js`.)

---

## 2. Puesta en marcha

### 2.1 Pegar el firebaseConfig
1. Consola Firebase → ⚙️ **Configuración del proyecto** → **Tus apps** → SDK web.
2. Copia el objeto `firebaseConfig`.
3. Pégalo en **`js/firebase/config.js`** reemplazando el bloque marcado.

> Estos valores son **públicos** por diseño. La seguridad real está en
> `firestore.rules` + el allowlist de correos.

### 2.2 Activar Google como proveedor de Auth
Consola Firebase → **Authentication** → **Sign-in method** → habilita **Google**.

### 2.3 Correos autorizados
Edita la lista en **dos** lugares (deben coincidir):
- `js/core/constants.js` → `AUTHORIZED_EMAILS`
- `firestore.rules` → función `emailAllowed()`

Correos actuales:
`alekcaballeromusic@gmail.com`, `catalina.medina.leal@gmail.com`,
`imusicala@gmail.com`, `musicalaasesor@gmail.com`.

### 2.4 Probar local
Por ser módulos ESM, **debe servirse por HTTP** (no abrir el archivo con `file://`):
```bash
npx serve .
# o
python -m http.server 5173
```
Abre `http://localhost:5173`. Agrega `localhost` en
Authentication → Settings → **Dominios autorizados** si el login lo pide.

---

## 3. Reglas de cálculo de consumo

Implementadas en `core/time.js` (`aplicarReglaCobro`) y `services/consumoService.js`:

1. **minutosProgramados** = diferencia entre hora inicio/fin programadas.
2. **minutosReales** = diferencia entre hora inicio/fin reales; si no hay tiempo
   real cerrado, se usa el programado como referencia.
3. Se resta **graciaMin** (configurable por paquete).
4. Se **redondea hacia arriba** por bloques de **redondeoMin**.
5. El resultado (**minutosCobrados**) actualiza `minutosConsumidos`,
   `minutosRestantes` y `minutosExcedidos` del paquete **dentro de una
   transacción de Firestore** (atómico, sin condiciones de carrera).
6. Re-cerrar una reserva revierte el cobro anterior y re-aplica. Reabrir devuelve
   los minutos. Todo queda en `auditLogs`.

Valores por defecto (editables): `graciaMin=10`, `redondeoMin=15`,
`alertaSaldoMin=120`. Ver `core/constants.js`.

---

## 4. Importar datos antiguos

### Migración completa desde el Excel/Sheets 2026 (recomendada)
Tu Excel ya fue convertido a `migration-data.json` (junto al `index.html`).
Reconstruye el grafo preservando relaciones:
`empresa → cliente + paquete (con sus horas)`, `participante → asistente`,
`sesion → reserva`, `Asistencias → reservas/{id}/asistencia`.

**Pasos:**
1. Inicia sesión en la app.
2. Pestaña **Importar** → **"Migrar desde el Excel incluido"** → confirma.
3. Espera el reporte (clientes/paquetes/asistentes/reservas/asistencia + errores).

> ⚠️ **Ejecútalo UNA sola vez.** Volver a correrlo duplica todo (no es
> idempotente). Si necesitas reintentar, borra primero las colecciones.

Alternativa: **"Migrar desde Apps Script"** jala los datos en vivo desde la Web
App vieja (útil si el Sheets cambió desde la exportación).

**Tras migrar:** las empresas que en el Sheets no tenían `horasCompradas`
(Emociones, LEA, Hanna, Smartfilms) quedan con un paquete de **0 horas**
(estado "agotado"). Edita cada paquete y pon las horas reales contratadas.

Para regenerar `migration-data.json` desde otro Excel, vuelve a correr el script
de conversión (openpyxl) que mapea las hojas Empresas/Talleres/Participantes/
Sesiones/Asistencias.

### Importación suelta / mapeo de campos

### Opción A — Interfaz (recomendada)
Pestaña **Importar** en la app. Pega **CSV** (con encabezados) o **JSON** (array),
elige la entidad y, si aplica, el cliente por defecto. No borra nada existente.

### Opción B — Programática
```js
import { importClientes, importReservas } from "./js/services/importService.js";
await importClientes(csvOremoJsonString);
await importReservas(data, { clienteIdPorDefecto: "ID", paqueteIdPorDefecto: "ID" });
```

### Mapeo del modelo viejo → nuevo
| Apps Script   | Firestore   | Notas |
|---------------|-------------|-------|
| empresa       | cliente     | `empresaNombre→nombre`, `contactoEmail→email` |
| taller        | paquete     | `tallerNombre→nombre`, `fechaFin→fechaVencimiento` |
| participante  | asistente   | ligado a `clienteId` |
| sesion        | reserva     | `tema→actividad`, `facilitador→responsable` |

El importador acepta los nombres viejos y los nuevos (campos faltantes quedan
vacíos/0). Para asistentes en importación masiva se **omite** el bloqueo por
duplicado (`forzar:true`).

### Exportar desde Apps Script
Desde el editor de Apps Script, exporta cada hoja a CSV (Archivo → Descargar)
o serializa a JSON y pégalo en la pestaña Importar. Recomendado importar en orden:
**clientes → paquetes → asistentes → reservas** (para tener los IDs de cliente).

---

## 5. Desplegar

### Opción A — Firebase Hosting
```bash
npm install -g firebase-tools
firebase login
firebase use --add            # selecciona tu proyecto
firebase deploy --only firestore:rules,firestore:indexes
firebase deploy --only hosting
```
`firebase.json` ya sirve la raíz del proyecto como sitio estático.

### Opción B — GitHub Pages
1. Sube el repo a GitHub.
2. Settings → Pages → Branch `main` / carpeta raíz.
3. En Firebase → Authentication → **Dominios autorizados**, agrega
   `TU_USUARIO.github.io`.
4. Publica las reglas/índices con `firebase deploy --only firestore` (Hosting no
   es necesario en este caso).

> ⚠️ Recuerda desplegar **siempre** `firestore.rules`: sin ellas, los datos
> quedarían abiertos o cerrados según el estado del proyecto.

---

## 6. Seguridad y roles

- **Auth:** solo Google + allowlist de correos. Un correo fuera de la lista es
  deslogueado tanto en cliente (`auth.js`) como en servidor (`firestore.rules`).
- **Roles:** `admin`, `operacion`, `consulta`, `finanzas` mapeados en
  `ROLE_BY_EMAIL`. Hoy todos los autorizados pueden operar; para endurecer por
  rol, usa **custom claims** (`request.auth.token.role`) y afina `canWrite()` en
  las reglas.
- **Lógica sensible** (cierre/consumo) está aislada en `services/consumoService.js`
  con el mismo contrato de funciones, lista para moverse a **Cloud Functions**
  sin tocar la UI.
- **Auditoría:** `auditLogs` es append-only (no editable/borrable por reglas).

---

## 7b. Cobros y modo seguro (Cloud Functions)

### Cobros (funciona ya, sin Blaze)
Pestaña **Cobros**: historial de pagos, total cobrado y **excedentes por cobrar**.
En la ficha del cliente puedes **Registrar pago**; en cada paquete con excedente
aparece **Cobrar excedente** (calcula el monto con `valorHoraExtra` y marca esos
minutos como cobrados, atómicamente). Export CSV de pagos incluido.
Colección nueva: `pagos/{id}`.

### Activar modo seguro (Cloud Functions)
Por defecto el cálculo corre en el cliente (`USE_CLOUD_FUNCTIONS = false` en
`js/core/constants.js`). Para blindarlo del lado servidor:

1. **Plan Blaze**: Consola Firebase → Uso y facturación → cambiar a Blaze
   (tiene capa gratuita; estas funciones son mínimas).
2. **Instalar deps y desplegar funciones**:
   ```bash
   cd functions && npm install && cd ..
   firebase deploy --only functions
   ```
   Despliega: `cerrarReserva`, `reabrirReserva`, `iniciarReserva`, `cobrarExcedente`
   (callables, región `us-central1`, con verificación de allowlist).
3. **Activar el flag**: en `js/core/constants.js` pon `USE_CLOUD_FUNCTIONS = true`.
   El cliente ahora llama a las funciones en vez de calcular localmente.
4. **Reglas estrictas**: copia `firestore.rules.strict` sobre `firestore.rules`
   y `firebase deploy --only firestore:rules`. Esto impide que el cliente
   escriba a mano los campos de consumo/cobro (`minutosConsumidos`,
   `minutosCobrados`, `excedenteCobradoMin`, etc.) y deja esa escritura solo a
   las funciones (Admin SDK).

> La lógica del servidor (`functions/index.js`) es **espejo** de
> `consumoService.js` + `pagosRepo.js`. Si cambias una regla de cálculo,
> actualiza ambos. El allowlist también está duplicado en `functions/index.js`.

## 7. Funcionalidades cubiertas

CRUD de clientes, paquetes, reservas y asistentes; reservas individuales y
**masivas recurrentes** por días de semana; anti-duplicados de asistentes
(documento normalizado / email / nombre); asistencia por reserva con estado;
iniciar/cerrar/reabrir reserva con consumo atómico y excedentes; dashboards
general / por cliente / por paquete con KPIs y barras de progreso; panel de
alertas (por agotarse, vencidos, excedidos, sin cerrar); importador CSV/JSON;
export CSV (PDF preparado en `exportService.js`).
