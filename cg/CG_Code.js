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

// Modo de prueba A/B (2026-08-05): `&fuente=worker&wk=<token>` fuerza que ESTA
// request lea el inventario desde el worker (hojaVirtual) sin tocar las
// Script Properties → cero impacto en el resto de los usuarios.
var _FZ_WORKER_URL = '';
var _FZ_WORKER_TOKEN = '';

function _routeApi(action, params, body) {
  try {
    var result;
    if (params && params.fuente === 'worker' && params.wk) {
      _FZ_WORKER_URL = 'https://control-gestion-api.mbarros.workers.dev/';
      _FZ_WORKER_TOKEN = String(params.wk);
    }
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
      // v31 — módulo Pérdidas
      case 'getPerdidasPorSemana':
        result = getPerdidasPorSemana(params.semana || (body && body.semana) || '');
        break;
      case 'saveOverridePerdida':
        result = saveOverridePerdida((body && body.payload) || body || {});
        break;
      case 'saveCubiertosCompartidos':
        result = saveCubiertosCompartidos((body && body.payload) || body || {});
        break;
      case 'getItemsPerdidaEvento':
        result = getItemsPerdidaEvento(params.centro || (body && body.centro) || '', params.fecha || (body && body.fecha) || '');
        break;
      case 'saveItemPerdida':
        result = saveItemPerdida((body && body.payload) || body || {});
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
  // Default: semana anterior (weeks[1]) — los eventos del fin de semana
  // recién pasado ya fueron procesados en inventario CG.
  return { weeks, defaultWeek: weeks[1] || weeks[0] };
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
  // Leemos hasta la col AL (38 cols). Antes el CG solo consideraba matrimonios y
  // usaba la col Q (idx 16) como semana; pero col Q no sirve para todos los tipos
  // (en corporativos trae el nombre del evento, en graduaciones el N° de egresados).
  // La semana operativa universal es la col AL (idx 37 = Fecha Semana), la misma que
  // ya usan Centralizado y Fotos. Sin filtro de tipo: lista las 3 líneas.
  const data = sheet.getRange(3, 1, lastRow - 2, 38).getValues();
  const map  = {};
  data.forEach(row => {
    const tipo = String(row[6]).trim();          // col G — Matrimonio / Graduación / Corporativo
    const semanaRow = _normCRMSemana(row[37]);   // col AL — Fecha Semana operativa
    if (semanaRow !== semana) return;
    const centro = String(row[13]).trim();       // col N — Lugar
    // Fecha del evento (col I): ISO para mostrar/ordenar, DD/MM/YYYY para el código.
    let fechaRaw = row[8], fechaISO, fechaDMA;
    if (fechaRaw instanceof Date) {
      fechaISO = Utilities.formatDate(fechaRaw, TZ, 'yyyy-MM-dd');
      fechaDMA = Utilities.formatDate(fechaRaw, TZ, 'dd/MM/yyyy');
    } else {
      fechaISO = String(fechaRaw).trim();
      fechaDMA = fechaISO;
    }
    // Código de evento = col P (idx 15). Las graduaciones vienen SIN código en el CRM,
    // así que lo construimos como "Lugar DD/MM/YYYY" — idéntico al que arma Supervisoras
    // (centro + ' ' + fecha) para que reconcilien por código en el pipeline.
    let codigo = String(row[15]).trim();
    if (!codigo) codigo = (centro && fechaDMA) ? (centro + ' ' + fechaDMA) : (centro || fechaDMA);
    if (!codigo || map[codigo]) return;
    const invitadosComida = Number(row[30]) || 0;  // col AE — Comida
    map[codigo] = { semana, fechaEvento: fechaISO, codigoEvento: codigo, centro, invitadosComida, tipo };
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
    // Normalización defensiva: la key de upsert era case-sensitive y sensible
    // a tildes/espacios. Si el cargo se guardaba como "Garzon Vestíbulo" y
    // luego venía como "garzon vestibulo" (sin tilde, lowercase), se creaba
    // fila nueva en vez de sobreescribir. La re-evaluación se "perdía".
    const _normKey = (s) => String(s || '').trim().toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '');
    const existingRowMap = {};
    if (lastRow >= 4) {
      sheet.getRange(4, 1, lastRow - 3, 5).getValues().forEach((r, idx) => {
        if (r[2]) existingRowMap[_normKey(r[2]) + '|||' + _normKey(r[4])] = 4 + idx;
      });
    }
    const newRows = [];
    const newRowKeyIdx = {}; // key normalizado → índice en newRows (dedup intra-batch)
    let rowsUpdated = 0;
    evaluaciones.forEach(ev => {
      const normCargo = ev.cargo;
      const key   = _normKey(ev.codigoEvento) + '|||' + _normKey(normCargo);
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
      if (existingRowMap[key] !== undefined && existingRowMap[key] > 0) {
        // Sobreescribir fila existente en el sheet
        sheet.getRange(existingRowMap[key], 1, 1, 21).setValues([rowData]);
        rowsUpdated++;
      } else if (newRowKeyIdx[key] !== undefined) {
        // Mismo cargo enviado 2 veces en el mismo POST: pisa la fila pendiente
        // (en vez de duplicar). El último wins, consistente con el upsert.
        newRows[newRowKeyIdx[key]] = rowData;
      } else {
        newRowKeyIdx[key] = newRows.length;
        newRows.push(rowData);
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
  // CG 2.0 (2026-08-05): con las Script Properties CG_WORKER_URL + CG_WORKER_TOKEN
  // seteadas, la matriz viene del worker (D1, action=hojaVirtual) con el MISMO
  // layout de la hoja — es el cable de los auto-chequeos para el corte, cuando
  // la planilla deje de actualizarse. Sin properties (default) o ante cualquier
  // error, cae a la hoja como siempre. Apagar = borrar CG_WORKER_URL.
  try {
    const _p = PropertiesService.getScriptProperties();
    const _wu = _FZ_WORKER_URL || _p.getProperty('CG_WORKER_URL');
    const _wk = _FZ_WORKER_TOKEN || _p.getProperty('CG_WORKER_TOKEN');
    if (_wu && _wk) {
      const _r = UrlFetchApp.fetch(_wu + '?action=hojaVirtual&k=' + _wk +
        '&hoja=' + encodeURIComponent(nombreHoja), { muteHttpExceptions: true });
      const _j = JSON.parse(_r.getContentText());
      if (_j.ok && _j.data && _j.data.matriz && _j.data.matriz.length >= 4) {
        const data = _j.data.matriz;
        _cacheInvHojas[nombreHoja] = { data, lastRow: data.length, lastCol: _j.data.columnas };
        return _cacheInvHojas[nombreHoja];
      }
    }
  } catch (e) { /* cae a la hoja */ }
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

// v28: chequea merma con Casa Inicial (1ra col) − Casa Final (4ta col).
//
// IMPORTANTE: la hoja inventario CG tiene secciones secundarias al final
// (ej. "Historico Estoril" en row 149+) con sus propios valores. Si iteramos
// hasta `hoja.lastRow`, sumamos esas filas también y el total se infla
// arbitrariamente. El loop ahora:
//   - Empieza en r=3 (Row 4 en 1-indexed = primer item, CUCHILLO CARNE).
//   - Detiene al primer item vacío O al primer header de sub-sección
//     (Historico, Inventario, Evento, Estoril...).
function _esItemValido(item) {
  if (!item) return false;
  if (/^(hist[oó]rico|inventario|evento|estoril)\b/i.test(item)) return false;
  return true;
}

// Regex por categoría (acuerdo con usuario):
//   UI (5 categorías separadas):
//     - manteles:    /^MANTEL/
//     - caminos:     /^CAMINO/
//     - prendas:     /^(PECHERA|CORBATA|POLAR)/
//     - servilletas: /^SERVILLETA/
//     - cubiertos:   resto del bloque (CUCHILLO/TENEDOR/CUCHARA)
//   Bono "no se pierde ningún mantel ni camino": agrupa manteles+caminos+prendas
//     (REGEX_BONO_MANTELERIA) — eso es lo que afecta el bono garzones/barmans.
var REGEX_MANTEL        = /^MANTEL/;
var REGEX_CAMINO        = /^CAMINO/;
var REGEX_PRENDA        = /^(PECHERA|CORBATA|POLAR)/;
var REGEX_SERVILLETA    = /^SERVILLETA/;
// Bono "no se pierde ningún mantel ni camino" (Garzones / Barmans CG) →
// SOLO manteles + caminos. Las prendas (POLAR/PECHERAS/CORBATAS) tienen
// su propio bono "no se pierde ninguna pechera, polar y corbata"
// (Asignación Conteo Cosas Casa CG, criterio 5).
var REGEX_BONO_MANTELERIA = /^(MANTEL|CAMINO)/;
// Legacy alias para compatibilidad
var REGEX_MANTEL_CAMINO = REGEX_BONO_MANTELERIA;
// Servilleteros de YUTE (Garzones CG, criterio "Se pierden menos de 20
// SERVILLETEROS DE YUTE"). OJO: se cuentan en la hoja Decoracion (no Manteles),
// y SOLO los de yute — no "SERVILLETERO MADERA".
var REGEX_SERVILLETERO_YUTE = /^SERVILLETEROS?\s+DE\s+YUTE/;

function _categoriaToRegex(cat) {
  switch (cat) {
    case 'manteles':         return REGEX_MANTEL;
    case 'caminos':          return REGEX_CAMINO;
    case 'prendas':          return REGEX_PRENDA;
    case 'servilletas':      return REGEX_SERVILLETA;
    case 'manteleria_total': return REGEX_BONO_MANTELERIA;
    default: return null;
  }
}

// ── Hoja Robo: descuento de pérdidas por sistema interno de auditoría ──
// Estructura: Row 3 contiene los nombres de eventos (UN evento por col).
// Filas siguientes contienen items y su monto de robo POR evento (1 valor
// por col, no 4 como Cubiertos/Manteles).
// _getRoboParaEvento(centro, fecha, regex) retorna la suma de robos para los
// items que matchean el regex en ese evento. Si no hay match de evento o
// no hay datos, retorna 0 (no penaliza el chequeo).
function _getRoboParaEvento(centro, fechaEvento, regexItem) {
  try {
    const hoja = _loadHojaInv('Robo');
    if (!hoja) return 0;
    const row3 = hoja.data[2] || [];
    // Encontrar la col del evento
    const targetKey = _normTxt(centro) + '::' + _normFechaISO(fechaEvento);
    let colEvento = -1;
    for (let c = 1; c < hoja.lastCol; c++) {
      const evName = String(row3[c] || '').trim();
      if (!evName) continue;
      const m = evName.match(/^(.+?)\s+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})$/);
      if (!m) continue;
      const key = _normTxt(m[1]) + '::' + _normFechaISO(m[2]);
      if (key === targetKey) { colEvento = c; break; }
    }
    if (colEvento < 0) return 0; // evento no listado en Robo → 0 robo
    // Iterar items y sumar los que matchean
    let total = 0;
    for (let r = 3; r < hoja.lastRow; r++) {
      const itemRaw = String(hoja.data[r][0] || '').trim();
      if (!_esItemValido(itemRaw)) break;
      if (regexItem && !regexItem.test(itemRaw.toUpperCase())) continue;
      const v = Number(hoja.data[r][colEvento]) || 0;
      if (v > 0) total += v;
    }
    return total;
  } catch(e) {
    Logger.log('_getRoboParaEvento error: ' + e.message);
    return 0;
  }
}

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
  // v33: bono "mantel ni camino" agrupa manteles + caminos + prendas (M+C+P)
  const calc = _calcularPerdidasCategoria(ev, 'manteleria_total');
  if (calc.perdidaNeta === 0) {
    return { ok: true, motivo: '✓ No se perdieron manteles ni caminos' +
      (calc.override ? ' (override)' : (calc.robo > 0 ? ' (bruta=' + calc.perdidaBruta + ', robo=' + calc.robo + ')' : '')) };
  }
  return { ok: false, motivo: '✗ Se perdieron ' + calc.perdidaNeta + ' manteles/caminos' +
    (calc.override ? ' (override)' : '') +
    (calc.robo > 0 ? ' (bruta=' + calc.perdidaBruta + ', robo=' + calc.robo + ', neta=' + calc.perdidaNeta + ')' : '') };
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
  // v31: usar override si existe
  const calc = _calcularPerdidasCategoria(ev, 'servilletas');
  const partes = [];
  if (calc.override) partes.push('override');
  if (calc.robo > 0) partes.push('bruta=' + calc.perdidaBruta + ', robo=' + calc.robo);
  const extra = partes.length ? ' (' + partes.join(', ') + ')' : '';
  return calc.perdidaNeta < 20
    ? { ok: true,  motivo: '✓ Se perdieron ' + calc.perdidaNeta + ' servilletas (< 20)' + extra }
    : { ok: false, motivo: '✗ Se perdieron ' + calc.perdidaNeta + ' servilletas (≥ 20)' + extra };
}

// Merma de servilleteros de yute (Garzones CG). A diferencia de las otras
// mermas, la fuente es la hoja Decoracion (nomenclatura A) y la pérdida se
// define como "Enviado a eventos" (1ra col) − "Casa" (4ta col) = lo que salió
// menos lo que volvió a casa. Umbral: < 20 unidades para ganar el bono.
function _chequearMermaServilleteros(ev) {
  const eventoInv = _findEventoEnHojaInv('Decoracion', ev.centro, ev.fechaEvento);
  if (!eventoInv) return { ok: null, motivo: '⚠ Evento no matcheado en Decoracion' };
  const colEnv  = eventoInv.colsSubform['Enviado a eventos'];
  const colCasa = eventoInv.colsSubform['Casa'];
  const tieneEnv  = _hayDatosEnColInv('Decoracion', colEnv);
  const tieneCasa = _hayDatosEnColInv('Decoracion', colCasa);
  if (!tieneEnv && !tieneCasa) return { ok: null, motivo: '⚠ Sin Enviado ni Casa en Decoracion' };
  if (!tieneEnv)  return { ok: null, motivo: '⚠ Sin "Enviado a eventos" en Decoracion' };
  if (!tieneCasa) return { ok: null, motivo: '⚠ Sin "Casa" (retorno) en Decoracion' };
  const hoja = _loadHojaInv('Decoracion');
  let enviado = 0, casa = 0, hayItem = false;
  // Recorre todos los items sumando SOLO las filas "SERVILLETEROS DE YUTE".
  // Usa continue (no break) porque el item vive al final del bloque de Decoracion.
  for (let r = 3; r < hoja.lastRow; r++) {
    const itemRaw = String(hoja.data[r][0] || '').trim();
    if (!itemRaw) continue;
    if (!REGEX_SERVILLETERO_YUTE.test(itemRaw.toUpperCase())) continue;
    hayItem = true;
    enviado += Number(hoja.data[r][colEnv])  || 0;
    casa    += Number(hoja.data[r][colCasa]) || 0;
  }
  if (!hayItem) return { ok: null, motivo: '⚠ No se encontró la fila SERVILLETEROS DE YUTE en Decoracion' };
  const perdida = Math.max(0, enviado - casa);
  return perdida < 20
    ? { ok: true,  motivo: '✓ Se perdieron ' + perdida + ' servilleteros de yute (< 20) [' + enviado + '→' + casa + ']' }
    : { ok: false, motivo: '✗ Se perdieron ' + perdida + ' servilleteros de yute (≥ 20) [' + enviado + '→' + casa + ']' };
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
  // Pérdida bruta + override + compartido
  const calc = _calcularPerdidasCubiertos(ev);
  return calc.perdNeta < 40
    ? { ok: true,  motivo: '✓ Se perdieron ' + calc.perdNeta + ' cubiertos (< 40)' + calc.extra }
    : { ok: false, motivo: '✗ Se perdieron ' + calc.perdNeta + ' cubiertos (≥ 40)' + calc.extra };
}

// Lógica de cálculo de cubiertos (extraída para reutilización en panel)
function _calcularPerdidasCubiertos(ev) {
  const eventoInv = _findEventoEnHojaInv('Cubiertos', ev.centro, ev.fechaEvento);
  if (!eventoInv) return { ok: null, motivo: '⚠ Evento no matcheado en Cubiertos', perdNeta: 0, extra: '' };

  // 1. Override de Casa Inicial/Final si existe
  const ov = _leerOverridePerdida(ev.centro, ev.fechaEvento, 'cubiertos');

  // 2. Compartido: si está activo, calcular pérdida combinada con el otro evento
  const par = _leerParCompartido(ev.centro, ev.fechaEvento);
  if (par) {
    return _calcularPerdidasCubiertosCompartido(ev, par);
  }

  // 3. Cálculo simple: suma de Casa Inicial - Casa Final por item
  const hoja = _loadHojaInv('Cubiertos');
  const colIni = eventoInv.colsSubform['Casa Inicial'];
  const colFin = eventoInv.colsSubform['Casa Final'];
  let sumIni = 0, sumFin = 0, totalPerdidosItems = 0;
  for (let r = 3; r < hoja.lastRow; r++) {
    const itemRaw = String(hoja.data[r][0] || '').trim();
    if (!_esItemValido(itemRaw)) break;
    const ini = Number(hoja.data[r][colIni]) || 0;
    const fin = Number(hoja.data[r][colFin]) || 0;
    sumIni += ini;
    sumFin += fin;
    const diff = ini - fin;
    if (diff > 0) totalPerdidosItems += diff;
  }

  // Aplicar override (si existe, sobreescribe la suma)
  const iniReal = (ov && ov.inicial != null && ov.inicial !== '') ? Number(ov.inicial) : sumIni;
  const finReal = (ov && ov.final   != null && ov.final   !== '') ? Number(ov.final)   : sumFin;
  const perdBruta = (ov && (ov.inicial != null || ov.final != null))
    ? Math.max(0, iniReal - finReal)
    : totalPerdidosItems;

  const robo = _getRoboParaEvento(ev.centro, ev.fechaEvento, null);
  const perdNeta = Math.max(0, perdBruta - robo);
  const partes = [];
  if (ov && (ov.inicial != null || ov.final != null)) partes.push('override Ini/Fin');
  if (robo > 0) partes.push('robo=' + robo);
  const extra = partes.length ? ' (' + partes.join(', ') + '; bruta=' + perdBruta + ', neta=' + perdNeta + ')' : '';
  return { ok: perdNeta < 40, perdNeta, perdBruta, robo, sumIni, sumFin, iniReal, finReal, override: !!ov, extra };
}

// Cálculo combinado para eventos compartidos.
// par = { centro1, fecha1, centro2, fecha2 } con fecha1 < fecha2.
// Pérdida combinada = Inicial(evento1) - Final(evento2) - Robo(suma de ambos)
// Cada evento recibe perdComb / 2.
function _calcularPerdidasCubiertosCompartido(ev, par) {
  // Identificar cuál es evento1 (más antiguo) y cuál evento2.
  const fecha1ISO = _normFechaISO(par.fecha1);
  const fecha2ISO = _normFechaISO(par.fecha2);
  const primero = (fecha1ISO <= fecha2ISO)
    ? { centro: par.centro1, fechaEvento: par.fecha1 }
    : { centro: par.centro2, fechaEvento: par.fecha2 };
  const segundo = (fecha1ISO <= fecha2ISO)
    ? { centro: par.centro2, fechaEvento: par.fecha2 }
    : { centro: par.centro1, fechaEvento: par.fecha1 };

  // Sumas del primero: Inicial
  const sumIniPrim = _sumarCubiertosEvento(primero, 'Casa Inicial');
  // Sumas del segundo: Final
  const sumFinSeg  = _sumarCubiertosEvento(segundo, 'Casa Final');
  // Overrides
  const ovPrim = _leerOverridePerdida(primero.centro, primero.fechaEvento, 'cubiertos');
  const ovSeg  = _leerOverridePerdida(segundo.centro, segundo.fechaEvento, 'cubiertos');
  const iniReal = (ovPrim && ovPrim.inicial != null && ovPrim.inicial !== '') ? Number(ovPrim.inicial) : sumIniPrim;
  const finReal = (ovSeg  && ovSeg.final   != null && ovSeg.final   !== '') ? Number(ovSeg.final)   : sumFinSeg;
  // Robo combinado
  const roboPrim = _getRoboParaEvento(primero.centro, primero.fechaEvento, null);
  const roboSeg  = _getRoboParaEvento(segundo.centro, segundo.fechaEvento, null);
  const roboTotal = roboPrim + roboSeg;
  const perdComb = Math.max(0, iniReal - finReal - roboTotal);
  const perdPorEvento = Math.round(perdComb / 2);

  const extra = ' (compartido con ' + (primero.centro === ev.centro && primero.fechaEvento === ev.fechaEvento ? segundo.centro : primero.centro) +
                '; combinada=' + perdComb + ', /2=' + perdPorEvento + ', robo total=' + roboTotal + ')';
  return {
    ok: perdPorEvento < 40, perdNeta: perdPorEvento, perdBruta: perdComb,
    robo: roboTotal, sumIni: iniReal, sumFin: finReal,
    iniReal, finReal, override: !!(ovPrim || ovSeg), compartido: true, extra
  };
}

function _sumarCubiertosEvento(ev, subform) {
  const eventoInv = _findEventoEnHojaInv('Cubiertos', ev.centro, ev.fechaEvento);
  if (!eventoInv) return 0;
  const col = eventoInv.colsSubform[subform];
  const hoja = _loadHojaInv('Cubiertos');
  let sum = 0;
  for (let r = 3; r < hoja.lastRow; r++) {
    const itemRaw = String(hoja.data[r][0] || '').trim();
    if (!_esItemValido(itemRaw)) break;
    sum += Number(hoja.data[r][col]) || 0;
  }
  return sum;
}

// Routing: dado un texto de criterio, devuelve el chequeo correspondiente o
// null si el criterio es manual (no auto-chequeable). Vajilla NO entra acá:
// el frontend la maneja localmente desde S.guardadosVajilla.
// ════════════════════════════════════════════════════════════════════
// HOJAS DE PERSISTENCIA — Overrides y eventos compartidos (v31+)
// ════════════════════════════════════════════════════════════════════
const HOJA_OVERRIDES   = 'Overrides_Perdidas';
const HOJA_COMPARTIDOS = 'Cubiertos_Compartidos';

function _ensureOverridesSheet() {
  const ss = SpreadsheetApp.openById(ID_CG);
  let sh = ss.getSheetByName(HOJA_OVERRIDES);
  if (!sh) {
    sh = ss.insertSheet(HOJA_OVERRIDES);
    sh.getRange(1, 1, 1, 7).setValues([['Centro', 'Fecha', 'Categoria', 'Inicial', 'Final', 'Timestamp', 'Autor']]);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, 7).setFontWeight('bold');
  }
  return sh;
}
function _ensureCompartidosSheet() {
  const ss = SpreadsheetApp.openById(ID_CG);
  let sh = ss.getSheetByName(HOJA_COMPARTIDOS);
  if (!sh) {
    sh = ss.insertSheet(HOJA_COMPARTIDOS);
    sh.getRange(1, 1, 1, 7).setValues([['Centro1', 'Fecha1', 'Centro2', 'Fecha2', 'Activo', 'Timestamp', 'Autor']]);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, 7).setFontWeight('bold');
  }
  return sh;
}

// Lee override de pérdida para un evento+categoría. Retorna {inicial, final} o null.
function _leerOverridePerdida(centro, fechaEvento, categoria) {
  try {
    const sh = SpreadsheetApp.openById(ID_CG).getSheetByName(HOJA_OVERRIDES);
    if (!sh || sh.getLastRow() < 2) return null;
    const data = sh.getRange(2, 1, sh.getLastRow() - 1, 5).getValues();
    const targetKey = _normTxt(centro) + '::' + _normFechaISO(fechaEvento) + '::' + categoria;
    // Tomar el ÚLTIMO override (más reciente) que matchee
    let latest = null;
    for (let i = 0; i < data.length; i++) {
      const r = data[i];
      const key = _normTxt(r[0]) + '::' + _normFechaISO(r[1]) + '::' + String(r[2]).trim().toLowerCase();
      if (key !== targetKey) continue;
      const ini = (r[3] === '' || r[3] === null) ? null : r[3];
      const fin = (r[4] === '' || r[4] === null) ? null : r[4];
      if (ini == null && fin == null) latest = null; // entrada vacía = borrar override
      else latest = { inicial: ini, final: fin };
    }
    return latest;
  } catch(e) { Logger.log('_leerOverridePerdida error: ' + e); return null; }
}

// Upsert override por (centro, fecha, categoria).
function saveOverridePerdida(payload) {
  try {
    const centro    = String(payload.centro || '').trim();
    const fecha     = String(payload.fecha  || '').trim();
    const categoria = String(payload.categoria || '').trim().toLowerCase();
    if (!centro || !fecha || !categoria) return { success: false, error: 'Faltan datos' };
    const sh = _ensureOverridesSheet();
    const tsStr = Utilities.formatDate(new Date(), TZ, 'dd/MM/yyyy HH:mm');
    const ini = (payload.inicial === undefined || payload.inicial === null || payload.inicial === '') ? '' : Number(payload.inicial);
    const fin = (payload.final   === undefined || payload.final   === null || payload.final   === '') ? '' : Number(payload.final);
    const fila = [centro, fecha, categoria, ini, fin, tsStr, payload.autor || ''];

    // Upsert por (centro, fecha, categoria)
    const lastRow = sh.getLastRow();
    let foundRow = -1;
    if (lastRow >= 2) {
      const data = sh.getRange(2, 1, lastRow - 1, 3).getValues();
      const targetKey = _normTxt(centro) + '::' + _normFechaISO(fecha) + '::' + categoria;
      for (let i = 0; i < data.length; i++) {
        const key = _normTxt(data[i][0]) + '::' + _normFechaISO(data[i][1]) + '::' + String(data[i][2]).trim().toLowerCase();
        if (key === targetKey) { foundRow = i + 2; break; }
      }
    }
    if (foundRow > 0) sh.getRange(foundRow, 1, 1, 7).setValues([fila]);
    else              sh.getRange(sh.getLastRow() + 1, 1, 1, 7).setValues([fila]);
    return { success: true };
  } catch(e) { return { success: false, error: e.message }; }
}

// Lee par compartido para un evento. Retorna {centro1,fecha1,centro2,fecha2} o null.
// IMPORTANTE: las fechas se devuelven NORMALIZADAS a ISO (yyyy-MM-dd) para
// que el frontend pueda comparar con ev.fechaEvento del CRM (mismo formato).
function _leerParCompartido(centro, fechaEvento) {
  try {
    const sh = SpreadsheetApp.openById(ID_CG).getSheetByName(HOJA_COMPARTIDOS);
    if (!sh || sh.getLastRow() < 2) return null;
    const data = sh.getRange(2, 1, sh.getLastRow() - 1, 5).getValues();
    const targetKey = _normTxt(centro) + '::' + _normFechaISO(fechaEvento);
    for (let i = data.length - 1; i >= 0; i--) {
      const r = data[i];
      const activo = String(r[4]).trim().toLowerCase() === 'true' || r[4] === true;
      if (!activo) continue;
      const fechaA = _normFechaISO(r[1]);
      const fechaB = _normFechaISO(r[3]);
      const key1 = _normTxt(r[0]) + '::' + fechaA;
      const key2 = _normTxt(r[2]) + '::' + fechaB;
      if (key1 === targetKey || key2 === targetKey) {
        return { centro1: String(r[0]).trim(), fecha1: fechaA,
                 centro2: String(r[2]).trim(), fecha2: fechaB };
      }
    }
    return null;
  } catch(e) { Logger.log('_leerParCompartido error: ' + e); return null; }
}

// Upsert link de eventos compartidos. Si payload.activo === false, lo desactiva.
function saveCubiertosCompartidos(payload) {
  try {
    const c1 = String(payload.centro1 || '').trim();
    const f1 = String(payload.fecha1  || '').trim();
    const c2 = String(payload.centro2 || '').trim();
    const f2 = String(payload.fecha2  || '').trim();
    if (!c1 || !f1 || !c2 || !f2) return { success: false, error: 'Faltan datos' };
    const activo = payload.activo === undefined ? true : !!payload.activo;
    const sh = _ensureCompartidosSheet();
    const tsStr = Utilities.formatDate(new Date(), TZ, 'dd/MM/yyyy HH:mm');

    // Upsert por (centro1+fecha1 / centro2+fecha2) en cualquier orden
    const lastRow = sh.getLastRow();
    let foundRow = -1;
    if (lastRow >= 2) {
      const data = sh.getRange(2, 1, lastRow - 1, 4).getValues();
      const k1 = _normTxt(c1) + '::' + _normFechaISO(f1);
      const k2 = _normTxt(c2) + '::' + _normFechaISO(f2);
      for (let i = 0; i < data.length; i++) {
        const ka = _normTxt(data[i][0]) + '::' + _normFechaISO(data[i][1]);
        const kb = _normTxt(data[i][2]) + '::' + _normFechaISO(data[i][3]);
        if ((ka === k1 && kb === k2) || (ka === k2 && kb === k1)) { foundRow = i + 2; break; }
      }
    }
    const fila = [c1, f1, c2, f2, activo, tsStr, payload.autor || ''];
    if (foundRow > 0) sh.getRange(foundRow, 1, 1, 7).setValues([fila]);
    else              sh.getRange(sh.getLastRow() + 1, 1, 1, 7).setValues([fila]);
    return { success: true };
  } catch(e) { return { success: false, error: e.message }; }
}

// ════════════════════════════════════════════════════════════════════
// ENDPOINT: getPerdidasPorSemana — agregado por evento+categoría
// ════════════════════════════════════════════════════════════════════
function getPerdidasPorSemana(semana) {
  try {
    const eventos = _getEventosDeSemana(semana);
    const out = eventos.map(ev => {
      const compartido = _leerParCompartido(ev.centro, ev.fechaEvento);
      const cubiertos = _calcularPerdidasCubiertos(ev);
      // Para "sinDatos" de cubiertos: verificar si la hoja Cubiertos tiene data
      const cubDatos = _hayDatosCategoria(ev, 'Cubiertos', null);
      return {
        codigoEvento: ev.codigoEvento, centro: ev.centro, fechaEvento: ev.fechaEvento,
        manteles:    _calcularPerdidasCategoria(ev, 'manteles'),
        caminos:     _calcularPerdidasCategoria(ev, 'caminos'),
        prendas:     _calcularPerdidasCategoria(ev, 'prendas'),
        servilletas: _calcularPerdidasCategoria(ev, 'servilletas'),
        cubiertos: {
          inicial: cubiertos.iniReal, final: cubiertos.finReal, robo: cubiertos.robo,
          perdidaBruta: cubiertos.perdBruta, perdidaNeta: cubiertos.perdNeta,
          override: !!cubiertos.override, compartido: !!cubiertos.compartido,
          parCompartido: compartido || null, motivo: cubiertos.extra || '',
          sinDatos: !cubDatos.tieneIni || !cubDatos.tieneFin,
          faltaIni: !cubDatos.tieneIni, faltaFin: !cubDatos.tieneFin
        }
      };
    });
    return { ok: true, semana, eventos: out };
  } catch(e) { return { ok: false, error: e.message }; }
}

// Determina si la categoría tiene datos en Casa Inicial / Casa Final
// para el evento dado. Si una columna está totalmente vacía en items que
// matchean el regex → form no respondido.
function _hayDatosCategoria(ev, hojaName, regex) {
  const eventoInv = _findEventoEnHojaInv(hojaName, ev.centro, ev.fechaEvento);
  if (!eventoInv) return { tieneIni: false, tieneFin: false };
  const hoja = _loadHojaInv(hojaName);
  const colIni = eventoInv.colsSubform['Casa Inicial'];
  const colFin = eventoInv.colsSubform['Casa Final'];
  let hayIni = false, hayFin = false;
  for (let r = 3; r < hoja.lastRow; r++) {
    const itemRaw = String(hoja.data[r][0] || '').trim();
    if (!_esItemValido(itemRaw)) break;
    if (regex && !regex.test(itemRaw.toUpperCase())) continue;
    const rawIni = hoja.data[r][colIni];
    const rawFin = hoja.data[r][colFin];
    if (rawIni !== '' && rawIni !== null && rawIni !== undefined) hayIni = true;
    if (rawFin !== '' && rawFin !== null && rawFin !== undefined) hayFin = true;
    if (hayIni && hayFin) break;
  }
  return { tieneIni: hayIni, tieneFin: hayFin };
}

// ════════════════════════════════════════════════════════════════════
// ENDPOINT: getItemsPerdidaEvento(centro, fecha)
// Retorna items individuales por categoría con sus Casa Inicial/Final.
// El frontend usa esto al expandir una categoría en el panel Pérdidas.
// ════════════════════════════════════════════════════════════════════
function getItemsPerdidaEvento(centro, fechaEvento) {
  try {
    const out = { centro, fechaEvento,
                  manteles: [], caminos: [], prendas: [], servilletas: [], cubiertos: [],
                  compartido: null };

    // Leer hoja Manteles (manteles + caminos + prendas + servilletas)
    const evMant = _findEventoEnHojaInv('Manteles', centro, fechaEvento);
    if (evMant) {
      const hojaM = _loadHojaInv('Manteles');
      const colIni = evMant.colsSubform['Casa Inicial'];
      const colFin = evMant.colsSubform['Casa Final'];
      for (let r = 3; r < hojaM.lastRow; r++) {
        const itemRaw = String(hojaM.data[r][0] || '').trim();
        if (!_esItemValido(itemRaw)) break;
        const item = itemRaw.toUpperCase();
        const ini = Number(hojaM.data[r][colIni]) || 0;
        const fin = Number(hojaM.data[r][colFin]) || 0;
        const entry = {
          item: itemRaw, casaInicial: ini, casaFinal: fin, perdida: Math.max(0, ini - fin),
          row: r + 1, colIniSheet: colIni + 1, colFinSheet: colFin + 1,
          hoja: 'Manteles'
        };
        if      (REGEX_MANTEL.test(item))     out.manteles.push(entry);
        else if (REGEX_CAMINO.test(item))     out.caminos.push(entry);
        else if (REGEX_PRENDA.test(item))     out.prendas.push(entry);
        else if (REGEX_SERVILLETA.test(item)) out.servilletas.push(entry);
      }
    }

    // Cubiertos: si hay par compartido, mostrar Casa Inicial del PRIMER evento
    // (fecha menor) y Casa Final del SEGUNDO (fecha mayor). Las cols del primero
    // se usan al editar Casa Inicial; las del segundo al editar Casa Final.
    const par = _leerParCompartido(centro, fechaEvento);
    let primero = { centro, fechaEvento };
    let segundo = null;
    if (par) {
      const f1ISO = _normFechaISO(par.fecha1);
      const f2ISO = _normFechaISO(par.fecha2);
      if (f1ISO <= f2ISO) {
        primero = { centro: par.centro1, fechaEvento: par.fecha1 };
        segundo = { centro: par.centro2, fechaEvento: par.fecha2 };
      } else {
        primero = { centro: par.centro2, fechaEvento: par.fecha2 };
        segundo = { centro: par.centro1, fechaEvento: par.fecha1 };
      }
      out.compartido = { primero, segundo };
    }

    const evCubPri = _findEventoEnHojaInv('Cubiertos', primero.centro, primero.fechaEvento);
    const evCubSeg = segundo ? _findEventoEnHojaInv('Cubiertos', segundo.centro, segundo.fechaEvento) : null;
    if (evCubPri) {
      const hojaC = _loadHojaInv('Cubiertos');
      const colIniPri = evCubPri.colsSubform['Casa Inicial'];
      const colFinPri = evCubPri.colsSubform['Casa Final'];
      const colFinSeg = evCubSeg ? evCubSeg.colsSubform['Casa Final'] : null;
      for (let r = 3; r < hojaC.lastRow; r++) {
        const itemRaw = String(hojaC.data[r][0] || '').trim();
        if (!_esItemValido(itemRaw)) break;
        const iniPri = Number(hojaC.data[r][colIniPri]) || 0;
        // Si compartido: Casa Final es del SEGUNDO evento
        const finVal = (evCubSeg && colFinSeg != null)
          ? (Number(hojaC.data[r][colFinSeg]) || 0)
          : (Number(hojaC.data[r][colFinPri]) || 0);
        // En compartido, la pérdida del ITEM se muestra BRUTA (ini-fin del par).
        // El /2 solo se aplica al TOTAL del evento (panel arriba). Esto mantiene
        // los números consistentes con lo que ves en la hoja inv.
        const perdida = Math.max(0, iniPri - finVal);
        out.cubiertos.push({
          item: itemRaw,
          casaInicial: iniPri,
          casaFinal: finVal,
          perdida: perdida,
          row: r + 1,
          // Casa Inicial → escribir al evento PRIMERO
          colIniSheet: colIniPri + 1,
          // Casa Final → si compartido, al evento SEGUNDO; sino al mismo
          colFinSheet: (evCubSeg && colFinSeg != null) ? (colFinSeg + 1) : (colFinPri + 1),
          hoja: 'Cubiertos',
          compartido: !!par,
          centroIni: primero.centro,
          centroFin: segundo ? segundo.centro : primero.centro
        });
      }
    }
    return { ok: true, ...out };
  } catch(e) { return { ok: false, error: e.message }; }
}

// ════════════════════════════════════════════════════════════════════
// ENDPOINT: saveItemPerdida — escribe directo al sheet inventario CG.
// payload: { hoja: 'Manteles'|'Cubiertos', row, col, value }
// ════════════════════════════════════════════════════════════════════
function saveItemPerdida(payload) {
  try {
    const hojaName = String(payload.hoja || '').trim();
    if (hojaName !== 'Manteles' && hojaName !== 'Cubiertos') {
      return { success: false, error: 'Hoja inválida: ' + hojaName };
    }
    const row = parseInt(payload.row, 10);
    const col = parseInt(payload.col, 10);
    if (!row || !col || row < 4 || col < 2) return { success: false, error: 'row/col inválidos' };
    const value = (payload.value === '' || payload.value == null) ? '' : Number(payload.value);
    const sheet = SpreadsheetApp.openById(ID_INVENTARIO_CG).getSheetByName(hojaName);
    if (!sheet) return { success: false, error: 'Hoja no encontrada: ' + hojaName };
    sheet.getRange(row, col).setValue(value);
    // Invalidar cache local (próxima lectura recarga)
    delete _cacheInvHojas[hojaName];
    return { success: true };
  } catch(e) { return { success: false, error: e.message }; }
}

function _calcularPerdidasCategoria(ev, categoria) {
  const eventoInv = _findEventoEnHojaInv('Manteles', ev.centro, ev.fechaEvento);
  if (!eventoInv) return { inicial: 0, final: 0, robo: 0, perdidaBruta: 0, perdidaNeta: 0, override: false, sinDatos: true };
  const hoja = _loadHojaInv('Manteles');
  const colIni = eventoInv.colsSubform['Casa Inicial'];
  const colFin = eventoInv.colsSubform['Casa Final'];
  const regex = _categoriaToRegex(categoria);
  if (!regex) return { inicial: 0, final: 0, robo: 0, perdidaBruta: 0, perdidaNeta: 0, override: false, sinDatos: true };
  let sumIni = 0, sumFin = 0, hayIni = false, hayFin = false;
  for (let r = 3; r < hoja.lastRow; r++) {
    const itemRaw = String(hoja.data[r][0] || '').trim();
    if (!_esItemValido(itemRaw)) break;
    if (!regex.test(itemRaw.toUpperCase())) continue;
    const rawIni = hoja.data[r][colIni];
    const rawFin = hoja.data[r][colFin];
    if (rawIni !== '' && rawIni !== null && rawIni !== undefined) hayIni = true;
    if (rawFin !== '' && rawFin !== null && rawFin !== undefined) hayFin = true;
    sumIni += Number(rawIni) || 0;
    sumFin += Number(rawFin) || 0;
  }
  const ov = _leerOverridePerdida(ev.centro, ev.fechaEvento, categoria);
  const iniReal = (ov && ov.inicial != null) ? Number(ov.inicial) : sumIni;
  const finReal = (ov && ov.final   != null) ? Number(ov.final)   : sumFin;
  // Robo: solo para categorías que existen en hoja Robo (típicamente cubiertos).
  // Para manteles/caminos/prendas/servilletas el robo es 0 (no se trackea).
  const robo = _getRoboParaEvento(ev.centro, ev.fechaEvento, regex);
  const perdBruta = Math.max(0, iniReal - finReal);
  const perdNeta  = Math.max(0, perdBruta - robo);
  return {
    inicial: iniReal, final: finReal, robo: robo,
    perdidaBruta: perdBruta, perdidaNeta: perdNeta,
    sumIniRaw: sumIni, sumFinRaw: sumFin,
    override: !!(ov && (ov.inicial != null || ov.final != null)),
    sinDatos: !hayIni || !hayFin,
    faltaIni: !hayIni, faltaFin: !hayFin
  };
}

// Aplicar override también a manteles y servilletas en los chequeos automáticos
// (los nuevos endpoints _calcularPerdidasCategoria ya consideran overrides).
function _resolverChequeoCriterio(crit, ev) {
  if (/vajilla/i.test(crit)) return null;
  if (/env[ií]o.*conteo.*inicial.*cocina/i.test(crit))   return _chequearFormulario(ev, 'Cocina',   'Conteo inicial');
  if (/env[ií]o.*conteo.*final.*cocina/i.test(crit))     return _chequearFormulario(ev, 'Cocina',   'Conteo final');
  if (/env[ií]o.*conteo.*inicial.*l[ií]quido/i.test(crit)) return _chequearFormulario(ev, 'Liquidos', 'Conteo inicial');
  if (/env[ií]o.*conteo.*final.*l[ií]quido/i.test(crit))   return _chequearFormulario(ev, 'Liquidos', 'Conteo final');
  // Asignación Conteo Cosas Casa CG - "Manda formulario X cubiertos/manteles".
  // El usuario aclara: inicial/final del formulario corresponden a Evento Inicial
  // (2da col) y Evento Final (3ra col) — NO Casa Inicial / Casa Final.
  if (/manda formulario inicial cubierto/i.test(crit))   return _chequearFormulario(ev, 'Cubiertos', 'Evento Inicial');
  if (/manda formulario final cubierto/i.test(crit))     return _chequearFormulario(ev, 'Cubiertos', 'Evento Final');
  if (/manda formulario inicial mantel/i.test(crit))     return _chequearFormulario(ev, 'Manteles',  'Evento Inicial');
  if (/manda formulario final mantel/i.test(crit))       return _chequearFormulario(ev, 'Manteles',  'Evento Final');
  // Jefa de Floristas / Jefa de Decoración - inventarios en hoja Decoración (nomenclatura A).
  // "Conteo inicial" = 2da col del bloque; "Conteo final" = 3ra col.
  if (/inventario inicial.*enviado|env[ií]o.*inventario inicial/i.test(crit))
                                                         return _chequearFormulario(ev, 'Decoracion', 'Conteo inicial');
  if (/mando inventario final|env[ií]o.*inventario final|inventario final.*enviado/i.test(crit))
                                                         return _chequearFormulario(ev, 'Decoracion', 'Conteo final');
  if (/no se pierde ning[uú]n mantel/i.test(crit))       return _chequearMermaMantelCamino(ev);
  // Asignación Conteo Cosas Casa CG criterio 5 - prendas (PECHERA/POLAR/CORBATA)
  if (/no se pierde ninguna (pechera|polar|corbata)/i.test(crit)) return _chequearMermaPrendas(ev);
  if (/pierden menos de 20 servilletas/i.test(crit))     return _chequearMermaServilletas(ev);
  // Servilleteros de yute (Garzones CG). "servilletero" no colisiona con
  // "servilletas" de la línea anterior. Fuente: hoja Decoracion.
  if (/servilletero.*yute|yute.*servilletero/i.test(crit)) return _chequearMermaServilleteros(ev);
  // Cubiertos: cubre tanto "pierden menos de 40 cubiertos" (Garzones) como
  // "Conteo de cubiertos, pérdida menor a 40 unidades" (Super metre).
  if (/conteo de cubiertos.*40|pierden menos de 40 cubiertos|cubiertos.*p[eé]rdida menor a 40|p[eé]rdida menor a 40.*cubiertos/i.test(crit))
                                                         return _chequearMermaCubiertos(ev);
  return null;
}

// Chequeo bono prendas (Asignación Conteo Cosas Casa criterio 5):
// "No se pierde ninguna pechera, polar y corbata" → si la pérdida neta
// de la categoría prendas es 0, bono ganado.
function _chequearMermaPrendas(ev) {
  const calc = _calcularPerdidasCategoria(ev, 'prendas');
  if (calc.sinDatos) return { ok: null, motivo: '⚠ Sin datos de prendas en Manteles' };
  if (calc.perdidaNeta === 0) {
    return { ok: true, motivo: '✓ No se perdieron prendas' +
      (calc.override ? ' (override)' : '') };
  }
  return { ok: false, motivo: '✗ Se perdieron ' + calc.perdidaNeta + ' prenda(s)' +
    (calc.override ? ' (override)' : '') };
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

