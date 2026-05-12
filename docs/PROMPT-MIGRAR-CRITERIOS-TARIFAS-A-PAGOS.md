# Prompt — Migrar tabs Criterios Bonos + Tarifas Equipos al Sistema Pagos

## Contexto para el agente

Eres un agente Claude que trabaja en los repos de **STEVE SpA** (Tinto Banquetería · Vodaeventos · Bordó). Vas a migrar 2 tabs administrativas que hoy viven en el Sistema de Bonos pero conceptualmente pertenecen al Sistema de Pagos (gestión de tarifas y montos de bonos por cargo).

> Aclaración importante: STEVE y PRONECT son empresas separadas. Este trabajo es 100% para STEVE. No mezclar stacks ni recursos con PRONECT.

### Repos involucrados

| Rol | Repo | Descripción |
|---|---|---|
| **Origen (de donde se migra)** | `mbarros-tinto/steve-sistema-bonos` | Monorepo Apps Script + frontend CF Pages del dashboard de bonos |
| **Destino backend** | `mbarros-tinto/steve-sistema-pagos` | Apps Script Web App del sistema de pagos / planillas eventos / logística |
| **Destino frontend** | `mbarros-tinto/steve-pagos-web` | Frontend estático CF Pages del sistema de pagos (`pagos.tintobanqueteria.cl`) |

### Sistema de pagos — contexto rápido

- Sistema de planillas de eventos + logística para STEVE.
- Backend Apps Script (`Code.js` + `index.html` legacy) bound al spreadsheet **Planilla Maestra STEVE 2026** (`1v7nBRea_YMvsUjeBtcMKpe7H4iAWA6onZBhJ_r7b8-0`).
- Script ID: `1lBU6lLSMiaH2yaKIERdzGYDWgahsqyZ3Bx0T1BDQQJwl81QX9vsgWh5J`.
- Frontend en `steve-pagos-web` consume el Apps Script con `apiGet/apiPost`.
- Patrón confirmado en `inscripcion-tinto-webapp` y `steve-rendiciones`.

### Lectura previa obligatoria

Antes de empezar, lee:

1. `mbarros-tinto/steve-sistema-bonos/README.md` — arquitectura del sistema de bonos
2. `mbarros-tinto/steve-sistema-bonos/docs/API.md` — endpoints actuales del Centralizado, en especial:
   - `GET getMaestroBonos` y `getMaestroCriterios` (alias)
   - `POST saveMaestroBonos` / `saveMaestroCriterios`
   - `GET getTarifas2026`
   - `POST saveTarifas2026`
3. `mbarros-tinto/steve-sistema-bonos/public/app.js` — implementación actual de las 2 tabs (busca `cargarCriterios`, `renderCriterios`, `guardarCriterios`, `toggleEdicionCriterios`, `cargarTarifas`, `renderTarifas`, `guardarTarifas`, `toggleEdicionTarifas`, `onTarifaChange`, `_parseMoneyInput`, `fmtMontoSimple`, `fmtTarifaCell`, `alertEditarBonosEnCriterios`)
4. `mbarros-tinto/steve-sistema-bonos/public/styles.css` — busca `.crit-section`, `.crit-grid`, `.crit-popover`, `.crit-text-readonly`, `.tarifas-table`, `.tarifa-bono-readonly`, `.tarifas-note`, etc.
5. `mbarros-tinto/steve-sistema-pagos/Code.js` — para entender el patrón actual de `doGet/doPost` y dónde agregar handlers nuevos
6. `mbarros-tinto/steve-pagos-web/app.js` y `index.html` — para entender la estructura del frontend de pagos

---

## Spreadsheets fuente (sin cambios)

| Hoja | Spreadsheet ID | Tab | Rol |
|---|---|---|---|
| **Maestro_Bonos** | `1f86EWcVJAaptEBoAzI8d6ZZ_lHw09XBYV9C5Kbe-g5k` (Centralizado bonos) | `Maestro_Bonos` | Definición de cargos, tipos de bono, montos, criterios, cargos aplicables |
| **Tarifas 2026** | `1aRuPFT625ewVSR7EfdaaHHp4Y2bohu6KUNLhC6ETd8M` (Maestro Personal STEVE) | `Tarifas 2026` | Tarifa base + bonos potenciales por cargo |

> Los spreadsheets siguen siendo de bonos/STEVE. Solo cambia DESDE QUÉ APP los edita el usuario. El Apps Script del Sistema de Pagos necesita permisos de lectura/escritura a ambos sheets (compartirlos con la cuenta del deployer si no los tiene).

---

## Estructura de `Maestro_Bonos`

18 columnas (A..R):

| Col | Campo | Descripción |
|---|---|---|
| A | Cargo | Cargo base (Super metre, Metre, Garzones, Barmans, etc.) |
| B | Tipo Bono | Fotos · Supervisora · Control Gestión · Vajilla |
| C | Monto | Entero (CLP) |
| D | Sistema | Fotos · Supervisoras · CG |
| E..N | Criterio 1..10 | Strings descriptivos. Slots inactivos vacíos o "--" |
| O | Icono | Emoji para visualización |
| P | Color | Hex |
| Q | BG | Hex |
| R | **Cargos Aplicables** | Coma-separados. Cargos de trabajador que reciben el bono. Si vacío → usa col A como único aplicable. Ej: `Garzón, Jefa de Decoración, Garzon Decoración` para Bono Garzones |

24 filas de datos típicas (varía según semana). Reglas:
- Filtrar criterios vacíos con regex `/^[-—\s]*$/` (acepta `''`, `-`, `--`, `—`).
- Tipos en orden canónico: Fotos → Supervisora → Control Gestión → Vajilla.

---

## Estructura de `Tarifas 2026`

Cols A..G:

| Col | Campo |
|---|---|
| A | Cargo |
| B | Tarifa Base |
| C | Cantidad (string opcional) |
| D | Bono Fotos |
| E | Bono Supervisora |
| F | Bono Activos (= Control Gestión, naming legacy) |
| G | Bono Vajilla |

Las filas que empiezan con `Asignación...` se separan visualmente con un row "Asignaciones".

---

## Endpoints a portar

Los siguientes endpoints existen hoy en `mbarros-tinto/steve-sistema-bonos/centralizado/Código.js` y deben **clonarse** al backend de pagos (`mbarros-tinto/steve-sistema-pagos/Code.js`). No los muevas — clónalos, así si algo falla, el origen sigue funcionando durante shadow testing.

### Lectura

```javascript
// Lee Maestro_Bonos y retorna { ok, items: [{ cargo, tipoBono, monto, sistema, criterios, cargosAplicables }] }
function getMaestroBonos() { ... }

// Lee Tarifas 2026 y retorna { ok, filas: [{ fila, cargo, tarifa, cantidad, bonoFotos, bonoSupervisora, bonoActivos, bonoVajilla }] }
function getTarifas2026() { ... }
```

### Mutación

```javascript
// Reescribe Maestro_Bonos. items: array con cargo, tipoBono, monto, sistema, criterios[10]
function saveMaestroBonos(items) { ... }

// Actualiza filas individuales de Tarifas 2026 + propaga montos a Maestro_Bonos vía _syncTarifasToMaestroBonos
function saveTarifas2026(cambios) { ... }
```

> Importante: el sistema actual mantiene **fuente única de verdad para montos de bonos = tab Criterios**. En Tarifas los bonos son solo visualización. Al guardar Tarifas, los 4 bonos se mandan unchanged (vienen del hidden input), por lo que `_syncTarifasToMaestroBonos` resulta noop para esos campos. Mantén ese comportamiento.

---

## Tareas

### 1. Backend `steve-sistema-pagos`

Agrega los 4 endpoints en `Code.js`:

```javascript
// doGet routing (busca el switch existente y agrega cases)
case 'getMaestroBonos':       return _jsonOk(getMaestroBonos());
case 'getTarifas2026':        return _jsonOk(getTarifas2026());

// doPost routing
case 'saveMaestroBonos':      return _jsonOk(saveMaestroBonos(body.items || []));
case 'saveTarifas2026':       return _jsonOk(saveTarifas2026(body.cambios || []));
```

Constantes nuevas:
```javascript
var ID_SHEET_CENTRALIZADO_BONOS = '1f86EWcVJAaptEBoAzI8d6ZZ_lHw09XBYV9C5Kbe-g5k';
var ID_SHEET_MAESTRO_STEVE = '1aRuPFT625ewVSR7EfdaaHHp4Y2bohu6KUNLhC6ETd8M';
```

**Permisos**: la cuenta deployer del Apps Script de pagos (`mbarros@tintobanqueteria.cl`) debe tener acceso de escritura a ambos sheets. Verificar antes de deployar.

Crear versión + redeploy con el deployment ID existente del sistema de pagos (no crear nueva URL).

### 2. Frontend `steve-pagos-web`

Agregar 2 tabs nuevas al `index.html`:

```html
<button class="tab-btn" data-tab="criterios" onclick="switchTab('criterios', this)">📋 Criterios Bonos</button>
<button class="tab-btn" data-tab="tarifas" onclick="switchTab('tarifas', this)">💰 Tarifas Equipos</button>
```

Y los panels correspondientes con un `<div id="resCriterios">` y `<div id="resTarifas">`.

En `app.js` portar las funciones de `mbarros-tinto/steve-sistema-bonos/public/app.js`:
- `cargarCriterios`, `renderCriterios`, `toggleEdicionCriterios`, `guardarCriterios`, `fmtMontoSimple`
- `cargarTarifas`, `renderTarifas`, `fmtTarifaCell`, `alertEditarBonosEnCriterios`, `_parseMoneyInput`, `onTarifaChange`, `toggleEdicionTarifas`, `guardarTarifas`

Adaptar al estado global del sistema de pagos:
- `APP.criteriosLoaded`, `APP.criteriosItems`, `APP.criteriosEditable`
- `APP.tarifasLoaded`, `APP.tarifasData`, `APP.tarifasEditable`

En `switchTab` agregar lazy loading:
```javascript
if (name === 'criterios' && !APP.criteriosLoaded) cargarCriterios();
if (name === 'tarifas'   && !APP.tarifasLoaded)   cargarTarifas();
```

Portar CSS de `styles.css` (las clases `.crit-*`, `.tarifas-table`, `.tarifa-input`, `.tarifa-bono-readonly`, `.tarifas-note`, `.crit-popover`, `.crit-text-readonly`, etc.).

**Decisiones UX a respetar (importantes)**:

| Tab | Decisión |
|---|---|
| Criterios | Grid compacto con scroll horizontal (`.crit-grid-wrap`). Texto truncado a 2 líneas. Tooltip CSS dorado al hover si supera 35 chars. |
| Criterios | 4 secciones por tipo (Fotos · Supervisora · Control Gestión · Vajilla) con accent color por tipo. |
| Criterios | Edición protegida con candado: en modo readonly usa `<div>`, en editable usa `<textarea>`. Re-render al toggle. |
| Tarifas | Bonos (4 columnas) son **solo visualización**. Renderizados como `<div>` no editable. Click → toast: "Los montos de los bonos se editan en la tab Criterios". Hidden input mantiene el valor para que el save funcione. |
| Tarifas | Solo Tarifa Base se edita al activar candado. |
| Tarifas | Nota dorada en header: "ℹ️ Los montos de bonos son solo visualización — se editan en la tab Criterios". |
| Tarifas | Total potencial por fila se recalcula on-the-fly. tfoot con totales agregados. |
| Tarifas | Separador automático "Asignaciones" cuando aparece el primer cargo `Asignación...`. |

### 3. Limpieza en `steve-sistema-bonos` (después de validar que las nuevas tabs funcionan en pagos)

Esto se hace **al final**, NO durante la implementación inicial. Mantener ambos lados funcionando en paralelo durante shadow testing 1-2 semanas.

Cuando se decida hacer cutover:

1. En `mbarros-tinto/steve-sistema-bonos/public/index.html`: eliminar los `<button class="tab-btn">` de Criterios y Tarifas + sus `<div class="tab-panel">`.
2. En `public/app.js`: eliminar las funciones de Criterios/Tarifas (`cargarCriterios`, `renderCriterios`, `guardarCriterios`, `toggleEdicionCriterios`, `cargarTarifas`, `renderTarifas`, `guardarTarifas`, `toggleEdicionTarifas`, `onTarifaChange`, `fmtTarifaCell`, `alertEditarBonosEnCriterios`, `_parseMoneyInput`, `fmtMontoSimple`).
3. En `public/styles.css`: eliminar las clases `.crit-*` y `.tarifas-*` que ya no se usen.
4. En `centralizado/Código.js`: los endpoints `getMaestroBonos`, `saveMaestroBonos`, `getTarifas2026`, `saveTarifas2026` se **mantienen** porque otros sistemas pueden seguir leyendo Maestro_Bonos del Centralizado (es la fuente de verdad). Solo cambia qué app es responsable de editarlos.
5. En el dashboard de bonos agregar un link/nota: "Para editar criterios y tarifas → `pagos.tintobanqueteria.cl`".

### 4. Memoria del repo destino

Actualizar `mbarros-tinto/steve-sistema-pagos/README.md` con la nueva sección:

```markdown
## Tabs administrativas migradas desde steve-sistema-bonos

- **📋 Criterios Bonos**: editor del `Maestro_Bonos` (cargo + tipoBono + monto + criterios + cargosAplicables). Fuente única para definir bonos del sistema STEVE.
- **💰 Tarifas Equipos**: editor de `Tarifas 2026` (tarifa base por cargo). Los montos de bonos son solo visualización aquí — editar en Criterios.

Spreadsheets fuente:
- Maestro_Bonos: `1f86EWcVJAaptEBoAzI8d6ZZ_lHw09XBYV9C5Kbe-g5k` (hoja Maestro_Bonos del Centralizado de bonos)
- Tarifas 2026: `1aRuPFT625ewVSR7EfdaaHHp4Y2bohu6KUNLhC6ETd8M` (hoja Tarifas 2026 del Maestro Personal STEVE)
```

---

## Convenciones del usuario

- **Idioma**: español neutral/chileno. NO usar voseo argentino ("vos", "querés", "dale", "hacelo", "arrancá").
- **Tono**: profesional-directo. Respuestas concisas. Mostrar diffs antes de aplicar cambios grandes.
- **Deploys**: `clasp push -u tinto` + `clasp version + redeploy` contra el deployment ID existente (no crear URL nueva). Pedir login si expira.
- **Commits**: HEREDOC con multi-line, terminar con `Co-Authored-By: Claude` por defecto está en CLI config.
- **Confirmación**: para cambios grandes (renombrar archivos, borrar funciones, mover responsabilidades) confirmar con el usuario antes de aplicar.

## Checklist de aceptación

- [ ] Endpoints `getMaestroBonos`, `saveMaestroBonos`, `getTarifas2026`, `saveTarifas2026` deployados en producción del sistema de pagos
- [ ] Smoke test con curl/browser confirma JSON correcto
- [ ] 2 tabs nuevas en `pagos.tintobanqueteria.cl` con paridad funcional a las de `bonos.tintobanqueteria.cl`
- [ ] Tooltip al hover de criterios largos funciona
- [ ] Bonos en Tarifas son read-only y mostrar toast al click
- [ ] Edición + guardado de Criterios actualiza `Maestro_Bonos` y se refleja en el dashboard de bonos al sincronizar
- [ ] Edición + guardado de Tarifa Base actualiza `Tarifas 2026`
- [ ] README de `steve-sistema-pagos` actualizado
- [ ] Shadow testing 1-2 semanas antes de remover las tabs de `steve-sistema-bonos`

## Final del prompt

Cuando empieces, primero lee los archivos mencionados en "Lectura previa obligatoria" y dime tu plan concreto (qué endpoints agregas dónde, qué archivos modificas en el frontend de pagos, cómo manejas los permisos del Apps Script para acceder a los sheets de bonos) antes de aplicar cambios.
