# STEVE · Sistema de Bonos

Monorepo con los Apps Script que componen el sistema de bonos de **STEVE SpA** (Tinto Banquetería / Vodaeventos / Bordó).

El sistema se apoya en **Centralizado** como fuente única de verdad y tres módulos especializados que consumen/alimentan la base:

| Módulo | Carpeta | Rol |
|---|---|---|
| **Centralizado** (prioridad) | `centralizado/` | Fuente única: `Maestro_Bonos`, consolidación de bonos por semana, dashboard interno |
| Fotos 2.0 | `fotos/` | Captura de fotos de evento y su bono asociado |
| CG (Control de Gestión) | `cg/` | Registro operativo del CG y su bono |
| Supervisoras | `supervisoras/` | Evaluación post-evento por supervisoras (form dinámico desde Maestro_Bonos, schema temporal con HEADERs) |

> La idea del panel unificado (`steve-panel`) es darle prioridad visible al **Centralizado**; los módulos son entradas secundarias que alimentan el Centralizado.

## Arquitectura

| Pieza | Spreadsheet | Script ID |
|---|---|---|
| Centralizado | `1f86EWcVJAaptEBoAzI8d6ZZ_lHw09XBYV9C5Kbe-g5k` | `1jmTk3-6u-Jhigv8S87EfVTzlVnRHU1FmRVxB4g9kN6rePWkeMUvIYYIc` |
| Fotos 2.0 | `1fJFabJhtLfoX51R2ewSuZ89TGDGruLdBRA-CdQffiYU` | `123S3Z3HHctpELGwhMJwQSQV3ua2vNsigunZ8BhaJsJ6_mGYhwuKj5CkN` |
| CG | `1ZVR0xSxfO3zFGVboByKFa4evVdqPtVtJZcvn3UuPBWc` | `1KvJCxAWrhIAjOkCiqXloDdZmxBVS_zipULp7wUmqKFu0qcuHQ21OBBZO` |
| Supervisoras | `1JC49jh4kgImPf-mUW-r-PepPhLF0mIgcWp-FWS6l6Sg` | `1w1LOR_Umemdi_1u4CqbMi1XS5CHH1YkG7u9CjPrkFbaFuQVnVwqI1XTB` |

Fuentes asociadas:
- CRM General — `1TTzFI5sMgInI1Ew__3Rw7lE300cGWmlDFyDVfWVqGTg`
- Maestro Personal STEVE (tarifas, personas) — `1aRuPFT625ewVSR7EfdaaHHp4Y2bohu6KUNLhC6ETd8M`

## Deployments vivos (producción)

| Módulo | Versión | Deployment ID |
|---|---|---|
| Centralizado | v49 | `AKfycbxzoKo6_ogpb_U7sBPu2qrkXKBmd9qVJuKzjke_JWNQZBi3E0FgARUViluQJxwZOD2H` |
| Fotos 2.0 | v39 | `AKfycbxvmJwrz1F6aq9k8353xMNh2EMfgpU8PXAh7aeeDfV1LDeo75Wb8JP32tbZIWV47_YY` |
| CG | v19 | `AKfycbyzQPkvD6HGelsOgO72ZI0N30G7BV6UN3I1Gyaq65135PfnWBytlhs4YHhzTjOQQa16` |
| Supervisoras | v37 | `AKfycbyyWVcXYpFovJ2YiQayepM2yVzygJXM1-9Y27-3aF6HR91ECBKcNtoEQkvYgGpOGU64` |

URL Web App = `https://script.google.com/macros/s/<deploymentId>/exec`

> ⚠️ El `deploymentId` de cada Web App NO cambia entre versiones — siempre re-deployar el MISMO deployment para que los usuarios vean la nueva versión en la misma URL.

## Desarrollo local

Cada módulo es un Apps Script independiente con su propio `.clasp.json`. Trabajarlos entrando a la carpeta correspondiente:

```bash
cd centralizado
clasp pull -u tinto                  # bajar cambios del editor online
# editar archivos .js / .html
clasp push -u tinto                  # subir cambios locales
clasp version "v30: descripcion" -u tinto
clasp redeploy AKfycbxzoKo6_ogpb_U7sBPu2qrkXKBmd9qVJuKzjke_JWNQZBi3E0FgARUViluQJxwZOD2H -V 30 -d "v30" -u tinto
```

Mismo flujo en `fotos/` y `cg/` (cambiando el deploymentId de producción).

### Requisitos

- Node.js ≥ 20
- `@google/clasp` v3+ (`npm i -g @google/clasp`)
- Login clasp perfil `-u tinto` (cuenta `mbarros@tintobanqueteria.cl`)
- `gh` CLI autenticado como `mbarros-tinto`

## Estructura del repo

```
steve-sistema-bonos/
├── centralizado/          # Apps Script Centralizado (fuente única)
│   ├── appsscript.json
│   ├── Código.js
│   ├── WebApp.html
│   └── .clasp.json
├── fotos/                 # Apps Script Fotos 2.0
│   ├── appsscript.json
│   ├── Servidor.js
│   ├── WebApp.html
│   └── .clasp.json
├── cg/                    # Apps Script CG
│   ├── appsscript.json
│   ├── CG_Code.js
│   ├── Index.html
│   └── .clasp.json
├── supervisoras/          # Apps Script Supervisoras (form + visualizador + API)
│   ├── appsscript.json
│   ├── Code.js
│   ├── formulario_supervisoras_v7.html
│   ├── visualizador_evento_v7.html
│   └── .clasp.json
├── public/                # CF Pages frontend `bonos.tintobanqueteria.cl`
│   ├── index.html, app.js, config.js, styles.css
│   └── encuestasupervisores/   # CF Pages frontend `encuestasupervisores.tintobanqueteria.cl`
│       ├── index.html
│       └── robots.txt
├── .gitignore
├── README.md
└── CLAUDE.md
```

## Funcionalidad actual (post v45)

### Centralizado (dashboard principal)
- 5 tabs: **Semana**, **Cargo**, **Historial**, **Criterios**, **Tarifas**
- Bonos consolidados por cargo con AND estricto entre cargos aplicables (Garzones agrupa Garzón + Jefa Decoración + Garzón Decoración; Barmans agrupa todos los Barman)
- `Maestro_Bonos` con col R `Cargos Aplicables` define el mapeo cargo → bono consolidado
- **Paso 4-5 → Planilla Maestra**: preview ordenado + envío por evento individual o todos los eventos del weekend, expande bono a N filas (1 por trabajador con cargo aplicable)
- **Mail bonos** desde alias `bonos@tintobanqueteria.cl` con preview agrupado por cargo, filtros (Pendientes / Ya enviados / Ganaron todo / Algún perdido), modal de confirmación, tracking en hoja `Mails_Enviados`
- **Overrides_Bonos**: edición manual de "ganó / no ganó" desde el dashboard (key: codigo+nombreBono)
- **Fotos on-demand**: modal con thumbnails Drive vía normalización fuzzy de cargos
- Normalización de tildes (`Garzón` ≡ `Garzon`) en match con Planilla Maestra
- Sync de Vajilla en hoja `Fuente_Vajilla` (separado de `Fuente_CG` desde v36)

### Fotos 2.0
- Dedup por `(codigoEvento, cargo, instruccion)` — sin nombre del trabajador en la key
- Detección de fotos previas al cambiar de cargo

### CG
- Form consolidado: evalúa **Garzones** y **Barmans** como bonos grupales (sin pedir nombre individual del trabajador)
- 4 cargos individuales: Super metre, Metre, Jefe de Bar, Jefe Cocina
- Módulo Vajilla: evalúa merma de vajilla por evento ($800/invitado por defecto)

## Migración a Cloudflare Pages (en progreso)

Plan: migrar el **dashboard del Centralizado** a frontend estático en CF Pages bajo `bonos.tintobanqueteria.cl`, manteniendo Apps Script como API. El sistema viejo (`script.google.com/.../exec` con `WebApp.html`) sigue funcionando en paralelo durante el shadow testing.

Ver `docs/MIGRACION.md` (próximamente) para el plan detallado.

## Relación con otros sistemas

- **Evaluación Supervisoras** (script distinto): https://github.com/mbarros-tinto/steve-eval-supervisoras
- **Sistema de Pagos**: https://github.com/mbarros-tinto/steve-sistema-pagos
- **Panel unificado**: https://github.com/mbarros-tinto/steve-panel
