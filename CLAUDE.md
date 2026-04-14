# Contexto para Claude — steve-sistema-bonos

Empresa: **STEVE SpA** (Tinto Banquetería · Vodaeventos · Bordó). Contexto completo en `/Users/barro/.claude/CLAUDE.md`.

## Qué hay en este repo

Monorepo con los 3 Apps Script del sistema de bonos:

- `centralizado/` → fuente única de verdad (`Maestro_Bonos`)
- `fotos/` → Fotos 2.0
- `cg/` → Control de Gestión

Cada carpeta tiene su propio `.clasp.json` y su propio deployment de Web App.

## Flujo de desarrollo

Trabajar siempre dentro del módulo correspondiente:

```bash
cd centralizado   # o fotos, o cg
clasp pull -u tinto
# editar
clasp push -u tinto
clasp version "vNN: descripcion" -u tinto
clasp redeploy <deploymentId-produccion> -V <NN> -d "vNN" -u tinto
```

Deployments de producción vivos en el README.

## Reglas de este repo

- `-u tinto` SIEMPRE (no pisar la sesión default `mbarros@pronect.com`).
- Nunca commitear `.clasprc.json`, `tokens.json`, secretos — ya están en `.gitignore`.
- Prioridad del sistema: **Centralizado**. Fotos y CG son alimentadores. Si hay duda sobre dónde vive un dato, empezar por Centralizado.
- Las IDs de spreadsheet en los `.js` son producción. No cambiarlas sin confirmar.

## Relación con otros repos

- Memoria detallada del sistema de bonos (fluxo, supervisoras, fotos, CG): `/Users/barro/.claude/projects/C--Users-barro-Mi-unidad--mbarros-tintobanqueteria-cl--Gestion-Todos-los-santos/memory/project_bonos.md`
- Sistema de Pagos (planillas eventos + logística): `mbarros-tinto/steve-sistema-pagos`
- Eval Supervisoras (independiente, NO confundir con el bono supervisoras): `mbarros-tinto/steve-eval-supervisoras`
- Panel unificado: `mbarros-tinto/steve-panel`
