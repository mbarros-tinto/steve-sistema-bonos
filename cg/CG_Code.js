// SISTEMA CONTROL DE GESTION - TINTO BANQUETERIA
// Version 2.0 | 2026 - Maestro_Bonos centralizado + modulo Vajilla

const ID_CG           = '1ZVR0xSxfO3zFGVboByKFa4evVdqPtVtJZcvn3UuPBWc';
const ID_CENTRALIZADO = '1f86EWcVJAaptEBoAzI8d6ZZ_lHw09XBYV9C5Kbe-g5k';
const ID_CRM          = '1TTzFI5sMgInI1Ew__3Rw7lE300cGWmlDFyDVfWVqGTg';
const ID_MAESTRO      = '1aRuPFT625ewVSR7EfdaaHHp4Y2bohu6KUNLhC6ETd8M';
const ANIO_MIN        = 2026;
const TZ              = 'America/Santiago';
const CRM_SHEET       = 'CRM CONSOLIDADO';

// ════════════════════════════════════════════════════════════════════
//  HTTP ENDPOINTS (Web App)
//  v23: action-based routing JSON. Sin action → mensaje de redirección
//       al dashboard nuevo en bonos.tintobanqueteria.cl (?tab=cg).
//  El frontend antiguo (Index.html) queda en el proyecto por backup,
//  pero ya no se sirve por defecto.
// ════════════════════════════════════════════════════════════════════
function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || '';
  if (action) return _routeApi(action, e.parameter, null);
  // Sin action → redirige al dashboard unificado
  return HtmlService.createHtmlOutput(
    '<html><head><meta charset="UTF-8"><title>Control de Gestion · migrado</title>' +
    '<style>body{font-family:Inter,sans-serif;background:#1a1014;color:#fff;text-align:center;' +
    'padding:80px 20px;}h1{font-family:"Cormorant Garamond",serif;color:#c9a96e;font-size:2em;}' +
    'a{color:#c9a96e;font-weight:600;}p{color:rgba(255,255,255,.7);margin:14px 0;}</style></head>' +
    '<body><h1>Control de Gestion migrado</h1>' +
    '<p>El formulario CG ahora vive como un tab en el dashboard unificado.</p>' +
    '<p><a href="https://bonos.tintobanqueteria.cl/?tab=cg">→ Ir a bonos.tintobanqueteria.cl/?tab=cg</a></p>' +
    '</body></html>'
  ).setTitle('Control de Gestion (migrado)');
}

function doPost(e) {
  var bodyRaw = (e && e.postData && e.postData.contents) ? e.postData.contents : '';
  var body    = {};
  try { body = bodyRaw ? JSON.parse(bodyRaw) : {}; } catch(err) {}
  var params = (e && e.parameter) ? e.parameter : {};
  var action = body.action || params.action || '';
  return _routeApi(action, params, body);
}

function _routeApi(action, params, body) {
  try {
    var result;
    switch (action) {
      case 'weeksData':
        result = getWeeksData();
        break;
      case 'datosForSemana':
        result = getDatosForSemana(params.semana || (body && body.semana) || '');
        break;
      case 'saveEvaluation':
        result = saveEvaluation((body && body.evaluaciones) || []);
        break;
      case 'saveVajillaEvaluation':
        result = saveVajillaEvaluation((body && body.evaluaciones) || []);
        break;
      default:
        result = { error: 'Acción desconocida: ' + action };
    }
    return ContentService
      .createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  } catch(err) {
    return ContentService
      .createTextOutput(JSON.stringify({ error: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function _formatLabel(date) {
  const dd   = String(date.getDate()).padStart(2, '0');
  const mm   = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

function _getMondayOf(date) {
  const d   = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  d.setHours(0, 0, 0, 0);
  return d;
}

function _normCRMSemana(val) {
  if (!val) return '';
  if (val instanceof Date) return _formatLabel(val);
  const parts = String(val).trim().replace(/\//g, '-').split('-');
  if (parts.length === 3) {
    return parts.map(p => String(Number(p)).padStart(2, '0')).join('-');
  }
  return String(val).trim();
}

function getWeeksData() {
  const today      = new Date();
  const thisMonday = _getMondayOf(today);
  const weeks      = [];
  for (let i = 0; i <= 8; i++) {
    const d = new Date(thisMonday);
    d.setDate(thisMonday.getDate() - 7 * i);
    weeks.push(_formatLabel(d));
  }
  return { weeks, defaultWeek: weeks[0] };
}

function getDatosForSemana(semana) {
  // Refactor: ya no enviamos trabajadoresPorEvento. El CG opera a nivel
  // evento+cargo; el cruce a trabajador concreto se hace en Centralizado
  // (paso 4-5 contra Planilla Maestra) usando los Cargos Aplicables del
  // bono. Esto reduce 2 lecturas externas (Fuente_Supervisoras + Bono Fotos)
  // por carga de semana.
  const eventos = _getEventosDeSemana(semana);
  const criteriosCG = _getCriteriosConfig('Control Gestión');
  return {
    eventos,
    criteriosConfig:     criteriosCG,
    criteriosVajilla:    _getCriteriosConfig('Vajilla'),
    yaEvaluados:         _getYaEvaluados(semana),
    yaEvaluadosVajilla:  _getYaEvaluadosVajilla(semana),
    vajillaConfig:       _getVajillaConfig(),
    autoChequeos:        _getAutoChequeosCG(eventos, criteriosCG)
  };
}

function _getEventosDeSemana(semana) {
  const sheet   = SpreadsheetApp.openById(ID_CRM).getSheetByName(CRM_SHEET);
  const lastRow = sheet.getLastRow();
  if (lastRow < 3) return [];
  const data = sheet.getRange(3, 1, lastRow - 2, 31).getValues();
  const map  = {};
  data.forEach(row => {
    const tipo = String(row[6]).trim().toLowerCase();
    if (!tipo.includes('matrimonio')) return;
    const semanaRow = _normCRMSemana(row[16]);
    if (semanaRow !== semana) return;
    const codigo = String(row[15]).trim();
    if (!codigo || map[codigo]) return;
    let fecha = row[8];
    fecha = (fecha instanceof Date)
      ? Utilities.formatDate(fecha, TZ, 'yyyy-MM-dd')
      : String(fecha).trim();
    const centro = String(row[13]).trim();
    const invitadosComida = Number(row[30]) || 0;
    map[codigo] = { semana, fechaEvento: fecha, codigoEvento: codigo, centro, invitadosComida };
  });
  return Object.values(map).sort((a, b) => a.fechaEvento.localeCompare(b.fechaEvento));
}

function _getCriteriosConfig(tipoBono) {
  tipoBono = tipoBono || 'Control Gestión';
  const sheet   = SpreadsheetApp.openById(ID_CENTRALIZADO).getSheetByName('Maestro_Bonos');
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return {};
  // Ahora leemos 18 cols para incluir col R "Cargos Aplicables"
  const data   = sheet.getRange(2, 1, lastRow - 1, 18).getValues();
  const config = {};
  data.forEach(row => {
    const cargo   = String(row[0]).trim();
    const tipo    = String(row[1]).trim();
    const monto   = Number(row[2]);
    const sistema = String(row[3]).trim();
    if (sistema !== 'CG' || tipo !== tipoBono) return;
    if (!cargo) return;
    const criterios = [];
    for (let i = 4; i < 14; i++) {
      const c = String(row[i]).trim();
      if (c && c !== '--' && c !== '-' && c !== '--') criterios.push(c);
    }
    if (criterios.length === 0) return;
    const aplStr = String(row[17] || '').trim();
    const cargosAplicables = aplStr
      ? aplStr.split(',').map(s => s.trim()).filter(s => s)
      : [cargo];
    // Bono grupal: si cargosAplicables tiene más de uno, o el único cargo aplicable
    // es distinto al cargo base. Ej: Garzones → [Garzón, Jefa de Decoración, Garzon Decoración].
    const esGrupal = cargosAplicables.length > 1 ||
                     (cargosAplicables.length === 1 && cargosAplicables[0] !== cargo);
    config[cargo] = {
      nombreBono: 'Bono ' + tipo + ' ' + cargo,
      monto,
      criterios,
      cargosAplicables,
      esGrupal
    };
  });
  return config;
}

function _getYaEvaluados(semana) {
  const sheet   = SpreadsheetApp.openById(ID_CG).getSheetByName('Bono CG');
  const lastRow = sheet.getLastRow();
  if (lastRow < 4) return [];
  return sheet.getRange(4, 1, lastRow - 3, 21).getValues()
    .filter(row => _normCRMSemana(row[0]) === semana && row[2])
    .map(row => ({
      codigoEvento:   String(row[2]).trim(),
      cargo:          String(row[4]).trim(),
      criterioValues: row.slice(6, 16).map(v => String(v).trim()),
      total:          Number(row[16]),
      cumplidos:      Number(row[17]),
      pct:            Number(row[18]),
      gana:           String(row[19]).trim()
    }));
}

function saveEvaluation(evaluaciones) {
  try {
    const sheet   = SpreadsheetApp.openById(ID_CG).getSheetByName('Bono CG');
    const tsStr   = Utilities.formatDate(new Date(), TZ, 'dd/MM/yyyy HH:mm');
    const lastRow = sheet.getLastRow();
    const existingRowMap = {};
    if (lastRow >= 4) {
      sheet.getRange(4, 1, lastRow - 3, 5).getValues().forEach((r, idx) => {
        if (r[2]) existingRowMap[String(r[2]).trim() + '|||' + String(r[4]).trim()] = 4 + idx;
      });
    }
    const newRows = [];
    let rowsUpdated = 0;
    evaluaciones.forEach(ev => {
      const normCargo = ev.cargo;
      const key   = `${ev.codigoEvento}|||${normCargo}`;
      const crits = [...ev.criterioValues];
      while (crits.length < 10) crits.push('--');
      const activos   = ev.criterioValues.filter(c => c !== '--');
      const total     = activos.length;
      const cumplidos = activos.filter(c => c === 'SI').length;
      const pct       = total > 0 ? Math.round(cumplidos / total * 100) : 0;
      const gana      = (cumplidos === total && total > 0) ? 'SI' : 'NO';
      // Trabajador eliminado: el CG ahora opera solo evento+cargo. El cruce
      // a trabajador concreto se hace en Centralizado al enviar a Planilla
      // Maestra (paso 4-5 con Cargos Aplicables del bono).
      const rowData   = [
        ev.semana, ev.fechaEvento, ev.codigoEvento, ev.centro,
        normCargo, '',
        ...crits, total, cumplidos, pct, gana, tsStr
      ];
      if (existingRowMap[key] !== undefined) {
        sheet.getRange(existingRowMap[key], 1, 1, 21).setValues([rowData]);
        rowsUpdated++;
      } else {
        newRows.push(rowData);
        existingRowMap[key] = -1;
      }
    });
    if (newRows.length > 0) {
      sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, 21).setValues(newRows);
      sheet.getRange(2, 2).setValue(tsStr);
    }
    return { success: true, rowsAdded: newRows.length, rowsUpdated: rowsUpdated };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function getCriteriosForEditor() {
  const sheet   = SpreadsheetApp.openById(ID_CENTRALIZADO).getSheetByName('Maestro_Bonos');
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  return sheet.getRange(2, 1, lastRow - 1, 14).getValues()
    .filter(row => String(row[3]).trim() === 'CG' && String(row[0]).trim())
    .map(row => ({
      cargo:      String(row[0]).trim(),
      tipoBono:   String(row[1]).trim(),
      monto:      Number(row[2]),
      criterios:  row.slice(4, 14).map(c => { const s = String(c).trim(); return (s === '--' || s === '--' || s === '-' || s === '') ? '' : s; })
    }));
}

function saveCriteriosConfig(config) {
  try {
    const sheet   = SpreadsheetApp.openById(ID_CENTRALIZADO).getSheetByName('Maestro_Bonos');
    const lastRow = sheet.getLastRow();
    const otherRows = [];
    if (lastRow >= 2) {
      sheet.getRange(2, 1, lastRow - 1, 14).getValues().forEach(row => {
        if (String(row[3]).trim() !== 'CG') otherRows.push(row);
      });
    }
    const cgRows = config.map(item => {
      const row = [item.cargo, item.tipoBono, item.monto, 'CG'];
      for (let i = 0; i < 10; i++) row.push(item.criterios[i] || '');
      return row;
    });
    const allRows = [...otherRows, ...cgRows];
    if (lastRow >= 2) sheet.getRange(2, 1, lastRow - 1, 14).clearContent();
    if (allRows.length > 0) sheet.getRange(2, 1, allRows.length, 14).setValues(allRows);
    return { success: true };
  } catch(e) { return { success: false, error: e.message }; }
}

function syncCG() {
  const bonoCG   = SpreadsheetApp.openById(ID_CG).getSheetByName('Bono CG');
  const fuenteCG = SpreadsheetApp.openById(ID_CENTRALIZADO).getSheetByName('Fuente_CG');
  const srcLastRow = bonoCG.getLastRow();
  if (srcLastRow < 4) { SpreadsheetApp.getUi().alert('No hay datos en Bono CG aun.'); return; }
  const srcData = bonoCG.getRange(4, 1, srcLastRow - 3, 21).getValues();
  const destLastRow  = fuenteCG.getLastRow();
  const existingKeys = new Set();
  if (destLastRow >= 3) {
    fuenteCG.getRange(3, 1, destLastRow - 2, 7).getValues().forEach(r => {
      if (r[0]) existingKeys.add(String(r[0]).trim() + '|||' + String(r[6]).trim());
    });
  }
  const newRows = [];
  srcData.forEach(row => {
    if (!row[2]) return;
    const fecha = row[1]; let year, fechaStr;
    if (fecha instanceof Date) { year = fecha.getFullYear(); fechaStr = Utilities.formatDate(fecha, TZ, 'yyyy-MM-dd'); }
    else { const s = String(fecha).trim(); year = parseInt(s.substring(0, 4)); fechaStr = s; }
    if (year < ANIO_MIN) return;
    const normCargo = String(row[4]).trim();
    const key = String(row[2]).trim() + '|||' + normCargo;
    if (existingKeys.has(key)) return;
    newRows.push([row[2], row[0], year, fechaStr, row[3], row[5], normCargo, ...row.slice(6,16), row[18], row[19], row[20]]);
    existingKeys.add(key);
  });
  if (newRows.length > 0) fuenteCG.getRange(fuenteCG.getLastRow() + 1, 1, newRows.length, 20).setValues(newRows);
  SpreadsheetApp.getUi().alert('syncCG: ' + newRows.length + ' fila(s) nueva(s) agregada(s) a Fuente_CG.');
}

// ==================================================================
// MODULO VAJILLA
// ==================================================================
const VAJILLA_COSTO_POR_INVITADO = 800;
const HOJA_BONO_VAJILLA = 'Bono Vajilla';

function _getVajillaConfig() {
  return { costoPorInvitado: VAJILLA_COSTO_POR_INVITADO };
}

function _getYaEvaluadosVajilla(semana) {
  const ss = SpreadsheetApp.openById(ID_CG);
  let sheet = ss.getSheetByName(HOJA_BONO_VAJILLA);
  if (!sheet) return [];
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  return sheet.getRange(2, 1, lastRow - 1, 11).getValues()
    .filter(row => _normCRMSemana(row[0]) === semana && row[2])
    .map(row => ({
      codigoEvento:    String(row[2]).trim(),
      centro:          String(row[3]).trim(),
      invitadosComida: Number(row[4]) || 0,
      mermaPermitida:  Number(row[5]) || 0,
      facturaMerma:    Number(row[6]) || 0,
      cargo:           String(row[7]).trim(),
      gana:            String(row[9]).trim()
    }));
}

function saveVajillaEvaluation(evaluaciones) {
  try {
    const ss = SpreadsheetApp.openById(ID_CG);
    let sheet = ss.getSheetByName(HOJA_BONO_VAJILLA);
    if (!sheet) {
      sheet = ss.insertSheet(HOJA_BONO_VAJILLA);
      sheet.getRange(1, 1, 1, 11).setValues([[
        'Semana', 'Fecha Evento', 'Codigo Evento', 'Centro',
        'Invitados Comida', 'Merma Permitida', 'Factura Merma',
        'Cargo', 'Trabajador', 'Gana Bono', 'Timestamp'
      ]]);
      sheet.setFrozenRows(1);
      sheet.getRange(1, 1, 1, 11).setFontWeight('bold');
    }
    const tsStr   = Utilities.formatDate(new Date(), TZ, 'dd/MM/yyyy HH:mm');
    const lastRow = sheet.getLastRow();
    const existingRowMap = {};
    if (lastRow >= 2) {
      sheet.getRange(2, 1, lastRow - 1, 8).getValues().forEach((r, idx) => {
        if (r[2]) existingRowMap[String(r[2]).trim() + '|||' + String(r[7]).trim()] = 2 + idx;
      });
    }
    const newRows = [];
    let rowsUpdated = 0;
    evaluaciones.forEach(ev => {
      const mermaPermitida = VAJILLA_COSTO_POR_INVITADO * (ev.invitadosComida || 0);
      const gana = (ev.facturaMerma <= mermaPermitida && ev.invitadosComida > 0) ? 'SI' : 'NO';
      const key  = ev.codigoEvento + '|||' + ev.cargo;
      // Trabajador eliminado: el cruce a trabajador concreto se hace en
      // Centralizado al enviar a Planilla Maestra (paso 4-5).
      const rowData = [
        ev.semana, ev.fechaEvento, ev.codigoEvento, ev.centro,
        ev.invitadosComida, mermaPermitida, ev.facturaMerma,
        ev.cargo, '', gana, tsStr
      ];
      if (existingRowMap[key] !== undefined) {
        sheet.getRange(existingRowMap[key], 1, 1, 11).setValues([rowData]);
        rowsUpdated++;
      } else {
        newRows.push(rowData);
        existingRowMap[key] = -1;
      }
    });
    if (newRows.length > 0) {
      sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, 11).setValues(newRows);
    }

    // Cascada: para cada evento donde Vajilla quedó NO, sobreescribir el
    // criterio "vajilla" en evaluaciones existentes de Garzones/Barmans.
    // Cubre el caso en que el usuario evaluó CG antes de cargar Vajilla
    // (por defecto el frontend deja esos criterios en SI).
    const eventosTocados = new Set(evaluaciones.map(e => e.codigoEvento));
    let cascadaCount = 0;
    eventosTocados.forEach(codigo => {
      cascadaCount += _aplicarCascadaVajilla(codigo);
    });

    return { success: true, rowsAdded: newRows.length, rowsUpdated, cascadaUpdates: cascadaCount };
  } catch(e) {
    return { success: false, error: e.message };
  }
}

// Cascada Vajilla → Garzones/Barmans. Si el resultado de Vajilla del evento
// es NO, busca en Bono CG las evaluaciones de cualquier cargo con un
// criterio que mencione "vajilla" y fuerza ese criterio a NO. Recalcula
// total/cumplidos/pct/gana de la fila y reescribe.
//
// No hace nada si Vajilla=SI (no degradamos NOs manuales que el usuario haya
// puesto por otros motivos) ni si Vajilla=PENDIENTE.
function _aplicarCascadaVajilla(codigoEvento) {
  const ss = SpreadsheetApp.openById(ID_CG);
  const vajSheet = ss.getSheetByName(HOJA_BONO_VAJILLA);
  if (!vajSheet || vajSheet.getLastRow() < 2) return 0;
  const vajRows = vajSheet.getRange(2, 1, vajSheet.getLastRow() - 1, 11).getValues()
    .filter(r => String(r[2]).trim() === codigoEvento);
  if (vajRows.length === 0) return 0;
  const vajEstado = vajRows.every(r => String(r[9]).trim() === 'SI') ? 'SI' : 'NO';
  if (vajEstado !== 'NO') return 0;

  const config = _getCriteriosConfig('Control Gestión');
  const cgSheet = ss.getSheetByName('Bono CG');
  const lastRow = cgSheet.getLastRow();
  if (lastRow < 4) return 0;
  const data = cgSheet.getRange(4, 1, lastRow - 3, 21).getValues();
  let updates = 0;
  data.forEach((row, idx) => {
    if (String(row[2]).trim() !== codigoEvento) return;
    const cargo = String(row[4]).trim();
    const cfg = config[cargo];
    if (!cfg) return;
    const idxVaj = cfg.criterios.findIndex(c => /vajilla/i.test(c));
    if (idxVaj === -1) return;
    // Bono CG: A..E meta, F trabajador, G..P criterios (10 cols), Q total,
    // R cumplidos, S pct, T gana, U timestamp. row[6+i] = criterio i.
    const colCrit = 6 + idxVaj;
    if (String(row[colCrit]).trim() === 'NO') return;
    row[colCrit] = 'NO';
    const activos = row.slice(6, 16).map(v => String(v).trim()).filter(c => c && c !== '--');
    const total     = activos.length;
    const cumplidos = activos.filter(c => c === 'SI').length;
    const pct       = total > 0 ? Math.round(cumplidos / total * 100) : 0;
    const gana      = (cumplidos === total && total > 0) ? 'SI' : 'NO';
    cgSheet.getRange(4 + idx, colCrit + 1).setValue('NO');
    cgSheet.getRange(4 + idx, 17, 1, 4).setValues([[total, cumplidos, pct, gana]]);
    updates++;
  });
  return updates;
}

// ==================================================================
// AUTO-CHEQUEOS DESDE SHEET INVENTARIO CG
// ==================================================================
// Verifica automáticamente, al cargar la semana, criterios cuya respuesta
// puede deducirse del sheet de Control de Gestión inventarios:
//   - "Envío Conteo inicial/final Cocina"      → hoja Cocina
//   - "Envío Conteo inicial/final Líquidos"    → hoja Liquidos
//   - "No se pierde ningún mantel ni camino"   → hoja Manteles
//   - "Se pierden menos de 20 servilletas"     → hoja Manteles
//   - "Se pierden menos de 40 cubiertos"       → hoja Cubiertos
// El frontend usa estos chequeos para auto-marcar y bloquear el criterio.
// Los motivos vienen del backend para mostrar al evaluador qué pasó.

const ID_INVENTARIO_CG = '1WC1cEeKrrrrvrI8zQJw22sFsECX10tjCzPn4xOKFR6U';

// Cache por ejecución: evita releer la misma hoja para múltiples chequeos.
const _cacheInvHojas = {};

function _loadHojaInv(nombreHoja) {
  if (_cacheInvHojas[nombreHoja] !== undefined) return _cacheInvHojas[nombreHoja];
  try {
    const sheet = SpreadsheetApp.openById(ID_INVENTARIO_CG).getSheetByName(nombreHoja);
    if (!sheet) { _cacheInvHojas[nombreHoja] = null; return null; }
    const lastRow = sheet.getLastRow();
    const lastCol = sheet.getLastColumn();
    if (lastRow < 4 || lastCol < 2) { _cacheInvHojas[nombreHoja] = null; return null; }
    const data = sheet.getRange(1, 1, lastRow, lastCol).getValues();
    _cacheInvHojas[nombreHoja] = { data, lastRow, lastCol };
    return _cacheInvHojas[nombreHoja];
  } catch(e) {
    Logger.log('_loadHojaInv error en ' + nombreHoja + ': ' + e.message);
    _cacheInvHojas[nombreHoja] = null;
    return null;
  }
}

// Normaliza texto para comparaciones loose (lowercase + sin tildes).
function _normTxt(s) {
  return String(s == null ? '' : s).trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// Normaliza una fecha (string o Date) a formato yyyy-MM-dd para comparar.
function _normFechaISO(s) {
  if (s instanceof Date) return Utilities.formatDate(s, TZ, 'yyyy-MM-dd');
  const str = String(s == null ? '' : s).trim();
  let m = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) return m[3] + '-' + String(parseInt(m[2], 10)).padStart(2, '0') + '-' + String(parseInt(m[1], 10)).padStart(2, '0');
  m = str.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
  if (m) return m[1] + '-' + String(parseInt(m[2], 10)).padStart(2, '0') + '-' + String(parseInt(m[3], 10)).padStart(2, '0');
  return str;
}

// Parsea row 3 de la hoja inv y retorna mapa { centro::fecha → {colInicio, colsSubform, evName} }
// Salta entradas con label "Estoril" (es un conteo mensual aparte de inventario,
// no un evento del flujo).
function _parsearEventosHojaInv(nombreHoja) {
  const hoja = _loadHojaInv(nombreHoja);
  if (!hoja) return {};
  const row3 = hoja.data[2] || [];
  const result = {};
  for (let c = 1; c < hoja.lastCol; c++) {
    const evName = String(row3[c] == null ? '' : row3[c]).trim();
    if (!evName) continue;
    if (/^estoril/i.test(evName)) continue;
    // Parseo "Centro fecha" — soporta dd/MM/yyyy y dd-MM-yyyy con o sin padding.
    const m = evName.match(/^(.+?)\s+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})$/);
    if (!m) continue;
    const centro = m[1].trim();
    const fechaISO = _normFechaISO(m[2]);
    const colsSubform = {
      // Nomenclatura A (Cocina, Liquidos, Decoracion):
      'Enviado a eventos': c,
      'Conteo inicial':    c + 1,
      'Conteo final':      c + 2,
      'Casa':              c + 3,
      // Nomenclatura B (Manteles, Cubiertos):
      'Casa Inicial':      c,
      'Evento Inicial':    c + 1,
      'Evento Final':      c + 2,
      'Casa Final':        c + 3
    };
    const key = _normTxt(centro) + '::' + fechaISO;
    result[key] = { centro, fechaISO, colInicio: c, colsSubform, evName };
  }
  return result;
}

function _findEventoEnHojaInv(nombreHoja, centroCRM, fechaCRM) {
  const eventos = _parsearEventosHojaInv(nombreHoja);
  const key = _normTxt(centroCRM) + '::' + _normFechaISO(fechaCRM);
  return eventos[key] || null;
}

// Devuelve true si alguna celda de la columna `colIdx`, desde row 5 hasta el
// final de la hoja, tiene valor no vacío. Indica que el formulario asociado
// a esa columna fue enviado.
function _hayDatosEnColInv(nombreHoja, colIdx) {
  const hoja = _loadHojaInv(nombreHoja);
  if (!hoja || colIdx == null || colIdx >= hoja.lastCol) return false;
  for (let r = 4; r < hoja.lastRow; r++) {
    const v = hoja.data[r] && hoja.data[r][colIdx];
    if (v !== null && v !== undefined && String(v).trim() !== '') return true;
  }
  return false;
}

// Convención de retorno de chequeos:
//   { ok: true,  motivo: '✓ ...' }   → criterio cumplido
//   { ok: false, motivo: '✗ ...' }   → criterio no cumplido
//   { ok: null,  motivo: '⚠ ...' }   → SIN DATOS para juzgar → frontend deja
//                                      el criterio MANUAL con warning visible.
//
// El caso null es importante: si el sheet de inventario no tiene datos para
// el evento (por ej. nadie llenó "Casa Final"), no podemos calcular merma sin
// generar falsos negativos (el evaluador perdería el bono injustamente).

function _chequearFormulario(ev, nombreHoja, subform) {
  const eventoInv = _findEventoEnHojaInv(nombreHoja, ev.centro, ev.fechaEvento);
  if (!eventoInv) return { ok: null, motivo: '⚠ Evento no matcheado en hoja ' + nombreHoja };
  const colIdx = eventoInv.colsSubform[subform];
  if (colIdx == null) return { ok: null, motivo: '⚠ Subform "' + subform + '" no encontrado' };
  if (_hayDatosEnColInv(nombreHoja, colIdx)) {
    return { ok: true, motivo: '✓ ' + subform + ' enviado (' + nombreHoja + ')' };
  }
  // Subform vacío. Distinguir "no enviaron este form" vs "evento sin datos
  // procesados todavía". Si CUALQUIER otra col del bloque del evento tiene
  // datos, asumimos que el evento está procesado y este form puntual falló.
  const cBase = eventoInv.colInicio;
  const otraColTieneDatos = [cBase, cBase + 1, cBase + 2, cBase + 3]
    .some(c => c !== colIdx && _hayDatosEnColInv(nombreHoja, c));
  if (otraColTieneDatos) {
    return { ok: false, motivo: '✗ No se envió ' + subform + ' (' + nombreHoja + ')' };
  }
  return { ok: null, motivo: '⚠ Sin datos del evento en ' + nombreHoja };
}

// Chequeo merma manteles+caminos. Si falta Casa Inicial o Casa Final, no se
// puede calcular sin riesgo de falso negativo (ej: Casa Final vacía y Casa
// Inicial=30 daría "perdiste 30 manteles" cuando en realidad nadie contó).
function _chequearMermaMantelCamino(ev) {
  const eventoInv = _findEventoEnHojaInv('Manteles', ev.centro, ev.fechaEvento);
  if (!eventoInv) return { ok: null, motivo: '⚠ Evento no matcheado en Manteles' };
  const colIni = eventoInv.colsSubform['Casa Inicial'];
  const colFin = eventoInv.colsSubform['Casa Final'];
  const tieneIni = _hayDatosEnColInv('Manteles', colIni);
  const tieneFin = _hayDatosEnColInv('Manteles', colFin);
  if (!tieneIni && !tieneFin) return { ok: null, motivo: '⚠ Sin Casa Inicial ni Casa Final en Manteles' };
  if (!tieneIni)              return { ok: null, motivo: '⚠ Sin Casa Inicial en Manteles' };
  if (!tieneFin)              return { ok: null, motivo: '⚠ Sin Casa Final en Manteles' };
  const hoja = _loadHojaInv('Manteles');
  const perdidos = [];
  for (let r = 4; r < hoja.lastRow; r++) {
    const item = String(hoja.data[r][0] || '').trim().toUpperCase();
    if (!item) continue;
    if (!/^MANTEL|^CAMINO/.test(item)) continue;
    const ini = Number(hoja.data[r][colIni]) || 0;
    const fin = Number(hoja.data[r][colFin]) || 0;
    const diff = ini - fin;
    if (diff > 0) perdidos.push(item + ' (-' + diff + ')');
  }
  return perdidos.length === 0
    ? { ok: true,  motivo: '✓ No se perdieron manteles ni caminos' }
    : { ok: false, motivo: '✗ Faltó: ' + perdidos.join(', ') };
}

function _chequearMermaServilletas(ev) {
  const eventoInv = _findEventoEnHojaInv('Manteles', ev.centro, ev.fechaEvento);
  if (!eventoInv) return { ok: null, motivo: '⚠ Evento no matcheado en Manteles' };
  const colIni = eventoInv.colsSubform['Casa Inicial'];
  const colFin = eventoInv.colsSubform['Casa Final'];
  const tieneIni = _hayDatosEnColInv('Manteles', colIni);
  const tieneFin = _hayDatosEnColInv('Manteles', colFin);
  if (!tieneIni && !tieneFin) return { ok: null, motivo: '⚠ Sin Casa Inicial ni Casa Final en Manteles' };
  if (!tieneIni)              return { ok: null, motivo: '⚠ Sin Casa Inicial en Manteles' };
  if (!tieneFin)              return { ok: null, motivo: '⚠ Sin Casa Final en Manteles' };
  const hoja = _loadHojaInv('Manteles');
  let totalPerdidas = 0;
  for (let r = 4; r < hoja.lastRow; r++) {
    const item = String(hoja.data[r][0] || '').trim().toUpperCase();
    if (!item || !/^SERVILLETA/.test(item)) continue;
    const ini = Number(hoja.data[r][colIni]) || 0;
    const fin = Number(hoja.data[r][colFin]) || 0;
    const diff = ini - fin;
    if (diff > 0) totalPerdidas += diff;
  }
  return totalPerdidas < 20
    ? { ok: true,  motivo: '✓ Se perdieron ' + totalPerdidas + ' servilletas (< 20)' }
    : { ok: false, motivo: '✗ Se perdieron ' + totalPerdidas + ' servilletas (≥ 20)' };
}

function _chequearMermaCubiertos(ev) {
  const eventoInv = _findEventoEnHojaInv('Cubiertos', ev.centro, ev.fechaEvento);
  if (!eventoInv) return { ok: null, motivo: '⚠ Evento no matcheado en Cubiertos' };
  const colIni = eventoInv.colsSubform['Casa Inicial'];
  const colFin = eventoInv.colsSubform['Casa Final'];
  const tieneIni = _hayDatosEnColInv('Cubiertos', colIni);
  const tieneFin = _hayDatosEnColInv('Cubiertos', colFin);
  if (!tieneIni && !tieneFin) return { ok: null, motivo: '⚠ Sin Casa Inicial ni Casa Final en Cubiertos' };
  if (!tieneIni)              return { ok: null, motivo: '⚠ Sin Casa Inicial en Cubiertos' };
  if (!tieneFin)              return { ok: null, motivo: '⚠ Sin Casa Final en Cubiertos' };
  const hoja = _loadHojaInv('Cubiertos');
  let totalPerdidos = 0;
  for (let r = 4; r < hoja.lastRow; r++) {
    const item = String(hoja.data[r][0] || '').trim();
    if (!item) continue;
    const ini = Number(hoja.data[r][colIni]) || 0;
    const fin = Number(hoja.data[r][colFin]) || 0;
    const diff = ini - fin;
    if (diff > 0) totalPerdidos += diff;
  }
  return totalPerdidos < 40
    ? { ok: true,  motivo: '✓ Se perdieron ' + totalPerdidos + ' cubiertos (< 40)' }
    : { ok: false, motivo: '✗ Se perdieron ' + totalPerdidos + ' cubiertos (≥ 40)' };
}

// Routing: dado un texto de criterio, devuelve el chequeo correspondiente o
// null si el criterio es manual (no auto-chequeable). Vajilla NO entra acá:
// el frontend la maneja localmente desde S.guardadosVajilla.
function _resolverChequeoCriterio(crit, ev) {
  if (/vajilla/i.test(crit)) return null;
  if (/env[ií]o.*conteo.*inicial.*cocina/i.test(crit))   return _chequearFormulario(ev, 'Cocina',   'Conteo inicial');
  if (/env[ií]o.*conteo.*final.*cocina/i.test(crit))     return _chequearFormulario(ev, 'Cocina',   'Conteo final');
  if (/env[ií]o.*conteo.*inicial.*l[ií]quido/i.test(crit)) return _chequearFormulario(ev, 'Liquidos', 'Conteo inicial');
  if (/env[ií]o.*conteo.*final.*l[ií]quido/i.test(crit))   return _chequearFormulario(ev, 'Liquidos', 'Conteo final');
  if (/no se pierde ning[uú]n mantel/i.test(crit))       return _chequearMermaMantelCamino(ev);
  if (/pierden menos de 20 servilletas/i.test(crit))     return _chequearMermaServilletas(ev);
  if (/pierden menos de 40 cubiertos/i.test(crit))       return _chequearMermaCubiertos(ev);
  return null;
}

// Resultado: { codigoEvento: { cargo: { idxCriterio: { ok, motivo } } } }
// Solo incluye criterios para los que existe un chequeo automático.
function _getAutoChequeosCG(eventos, criteriosCG) {
  const result = {};
  const cargos = Object.keys(criteriosCG);
  eventos.forEach(ev => {
    cargos.forEach(cargo => {
      const cfg = criteriosCG[cargo];
      cfg.criterios.forEach((crit, i) => {
        const chequeo = _resolverChequeoCriterio(crit, ev);
        if (!chequeo) return;
        if (!result[ev.codigoEvento]) result[ev.codigoEvento] = {};
        if (!result[ev.codigoEvento][cargo]) result[ev.codigoEvento][cargo] = {};
        result[ev.codigoEvento][cargo][i] = chequeo;
      });
    });
  });
  return result;
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('* Control de Gestion')
    .addItem('Abrir Evaluador Web', 'abrirWebApp')
    .addSeparator()
    .addItem('Sync --> Centralizado (syncCG)', 'syncCG')
    .addToUi();
}

function abrirWebApp() {
  const url = ScriptApp.getService().getUrl();
  if (!url) {
    SpreadsheetApp.getUi().alert('La app aun no esta desplegada.');
    return;
  }
  const html = HtmlService.createHtmlOutput(
    `<script>window.open('${url}','_blank');google.script.host.close();<\/script>`
  ).setWidth(10).setHeight(10);
  SpreadsheetApp.getUi().showModalDialog(html, 'Abriendo evaluador...');
}

