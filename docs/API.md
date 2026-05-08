# API — Sistema Bonos Centralizado

Backend en Apps Script expone endpoints HTTP via `doGet`/`doPost` con routing por `action`.

**URL base** (deployment fijo, no cambia entre versiones):

```
https://script.google.com/macros/s/AKfycbxzoKo6_ogpb_U7sBPu2qrkXKBmd9qVJuKzjke_JWNQZBi3E0FgARUViluQJxwZOD2H/exec
```

**Notas importantes:**

- Sin `?action=` el endpoint sigue retornando el `WebApp.html` legacy (compatibilidad).
- Con `?action=X` retorna JSON con `Content-Type: application/json`.
- POST debe enviarse con `Content-Type: text/plain;charset=utf-8` (para evitar el preflight CORS) y body JSON con `{ action: "...", ... }`.
- Apps Script puede responder con HTML de redirección durante deploys; el cliente debe hacer 1 retry tras `~350ms` si el response no es JSON parseable (patrón usado en `steve-pagos-web`).
- El usuario autenticado por Cloudflare Access se inyecta vía `userEmail` en cada POST para trazabilidad de mutaciones (campo `Autor` en hojas como `Mails_Enviados`, `Overrides_Bonos`).

## Respuesta estándar

**Éxito:**
```json
{ "ok": true, ...campos según endpoint }
```

**Error:**
```json
{ "ok": false, "msg": "descripción del error" }
```

---

## GET endpoints (lectura)

### `getWebAppData`
Boot del dashboard: listas de semanas, cargos y personas.
```
GET ?action=getWebAppData
→ { ok, semanas: ["13/04/2026", ...], cargos: ["Super metre", ...], personas: [...], total: N }
```

### `getDatosSemana&semana=DD/MM/YYYY`
Bonos consolidados de una semana (post override). Agrupados por cargo.
```
GET ?action=getDatosSemana&semana=13/04/2026
→ { ok, semana, grupos: { "Super metre": [{ codigo, centro, fecha, bonos: [...] }, ...], ... } }
```

### `getDetalleCriteriosSemana&semana=DD/MM/YYYY`
Detalle crudo de criterios cumplidos por bono, para renderizar tick/cruz.
```
GET ?action=getDetalleCriteriosSemana&semana=13/04/2026
→ { ok, criteriosConfig: { CG, Fotos, Supervisoras }, cg: [...], fotos: [...], supervisoras: [...] }
```

### `getDatosCargo&cargo=X`
Historial por cargo.

### `getDatosPersona&persona=NombreApellido`
Historial por trabajador (resuelve bonos consolidados via Fuente_*).

### `getEventosCRMPorSemana&semana=DD/MM/YYYY`
Eventos del CRM General para esa semana operativa.

### `getDatosSemanaConCRM&semana=DD/MM/YYYY`
Bonos + eventos sin bonos cruzados con CRM.

### `getMaestroBonos` / `getMaestroCriterios`
Lista de bonos (cargo, tipoBono, monto, sistema, criterios, cargosAplicables).

### `getTarifas2026`
Tarifas de matrimonios + bonos potenciales por cargo.

### `getTrabajadoresDelBono&codigo=X&nombreBono=Y`
Trabajadores que cobrarían el bono (para el chip 👤 del dashboard).

### `getFotosDeEvento&codigo=X&cargo=Y`
URLs de fotos válidas (modal 📷). Match fuzzy de cargos ("Super Metre" ≡ "Super metre").

### `getOverrideBono&codigo=X&nombreBono=Y`
Override actual (si existe) para mostrar en el modal de edición.

### `previewBonosParaPlanillaMaestra&codigo=X`
Preview de paso 4-5 (sin escribir): bonos × trabajadores con cargos aplicables, mismatches.

### `previewBonosTodosLosEventos&codigos=["X","Y","Z"]`
Preview consolidado para múltiples eventos. `codigos` puede ir como JSON o CSV.

### `getMailPreviewSemana&semana=DD/MM/YYYY`
Preview del envío de mails: trabajadores × eventos × bonos cumplidos/fallados, con `yaEnviado` por trabajador.

---

## POST endpoints (mutación)

Todos los POST aceptan `userEmail` como campo opcional para trazabilidad.

### `sincronizar`
Corre `syncFotos + syncCG + syncVajilla + syncSupervisoras + reconstruirBase + reconstruirResumen + reconstruirFinanzas`.
```json
POST { "action": "sincronizar", "userEmail": "user@tintobanqueteria.cl" }
→ { ok, msg, data: { fotos: N, cg: N, ... } }
```

### `setOverrideBono`
Guarda override manual de "ganó / no ganó" para un bono específico.
```json
POST {
  "action": "setOverrideBono",
  "codigo": "Casa Arboleda 17/04/2026",
  "nombreBono": "Bono Control Gestión Garzones",
  "override": true,
  "razon": "Supervisor confirmó por WhatsApp",
  "userEmail": "user@tintobanqueteria.cl"
}
→ { ok, msg }
```

### `deleteOverrideBono`
Borra override por `(codigo, nombreBono)`. Vuelve al cálculo natural.

### `escribirBonosEnPlanillaMaestra`
Escribe filas `fuente=Bonos` en Planilla Maestra > Registro para 1 evento. Idempotente.
```json
POST { "action": "escribirBonosEnPlanillaMaestra", "codigo": "Casa Arboleda 17/04/2026" }
→ { ok, escritos, totalMonto, msg }
```

### `escribirBonosMultipleEventos`
Loop sobre múltiples eventos. Reporta éxitos/fallos por código.
```json
POST { "action": "escribirBonosMultipleEventos", "codigos": ["X", "Y", "Z"] }
→ { ok, escritos: [...], fallos: [...], totalMonto, totalFilas }
```

### `enviarMailsBonos`
Envía mail con resumen de bonos a la lista de trabajadores. Registra en hoja `Mails_Enviados`.
```json
POST {
  "action": "enviarMailsBonos",
  "semana": "13/04/2026",
  "lista": ["nombre normalizado 1", "nombre normalizado 2"]
}
→ { ok, enviados: [...], errores: [...], totalEnviados, totalErrores }
```

### `enviarMailPruebaBonos`
Envía mail de prueba a destinatario arbitrario.
```json
POST { "action": "enviarMailPruebaBonos", "destinatario": "test@example.com" }
→ { ok, destinatario, remitente, fecha, msg }
```

### `saveMaestroBonos`
Reescribe la hoja `Maestro_Bonos` (cargo, tipoBono, monto, sistema, criterios).
```json
POST { "action": "saveMaestroBonos", "items": [{ cargo, tipoBono, monto, sistema, criterios }, ...] }
```

### `saveTarifas2026`
Actualiza filas en `Tarifas 2026` y propaga a `Maestro_Bonos`.
```json
POST { "action": "saveTarifas2026", "cambios": [{ fila, tarifa, bonoFotos, bonoSupervisora, bonoActivos, bonoVajilla }, ...] }
```

---

## Cliente (referencia)

Helpers estándar a usar en el frontend (mismo patrón que `steve-pagos-web`):

```js
window.API_URL = 'https://script.google.com/macros/s/AKfyc.../exec';

function apiGet(action, params) {
  var url = window.API_URL + '?action=' + encodeURIComponent(action);
  if (params) for (var k in params) {
    if (params[k] !== undefined && params[k] !== null && params[k] !== '') {
      url += '&' + encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
    }
  }
  function tryFetch() {
    return fetch(url).then(r => r.text()).then(text => {
      try { return JSON.parse(text); }
      catch(e) { throw new Error('Respuesta no-JSON'); }
    });
  }
  return tryFetch().catch(() =>
    new Promise(res => setTimeout(res, 350)).then(tryFetch)
  );
}

function apiPost(action, data) {
  data.action = action;
  data.userEmail = window.CURRENT_USER_EMAIL || '';
  return fetch(window.API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(data)
  }).then(r => r.json());
}
```

`CURRENT_USER_EMAIL` se obtiene al iniciar la app desde `/cdn-cgi/access/get-identity` (Cloudflare Access).
