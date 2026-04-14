// SISTEMA CONTROL DE GESTION - TINTO BANQUETERIA
// Version 2.0 | 2026 - Maestro_Bonos centralizado + modulo Vajilla

const ID_CG           = '1ZVR0xSxfO3zFGVboByKFa4evVdqPtVtJZcvn3UuPBWc';
const ID_CENTRALIZADO = '1f86EWcVJAaptEBoAzI8d6ZZ_lHw09XBYV9C5Kbe-g5k';
const ID_CRM          = '1TTzFI5sMgInI1Ew__3Rw7lE300cGWmlDFyDVfWVqGTg';
const ID_MAESTRO      = '1aRuPFT625ewVSR7EfdaaHHp4Y2bohu6KUNLhC6ETd8M';
const ANIO_MIN        = 2026;
const TZ              = 'America/Santiago';
const CRM_SHEET       = 'CRM CONSOLIDADO';

// -- WebApp entry point ----------------------------------------------
function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Control de Gestion -- Tinto Banqueteria')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
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
  return {
    eventos:             _getEventosDeSemana(semana),
    criteriosConfig:     _getCriteriosConfig('Activos'),
    criteriosVajilla:    _getCriteriosConfig('Vajilla'),
    yaEvaluados:         _getYaEvaluados(semana),
    yaEvaluadosVajilla:  _getYaEvaluadosVajilla(semana),
    nombresTrabajadores: getMaestroTrabajadores(),
    vajillaConfig:       _getVajillaConfig(),
    trabajadoresPorEvento: _getTrabajadoresPorEvento(semana)
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
  tipoBono = tipoBono || 'Activos';
  const sheet   = SpreadsheetApp.openById(ID_CENTRALIZADO).getSheetByName('Maestro_Bonos');
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return {};
  const data   = sheet.getRange(2, 1, lastRow - 1, 14).getValues();
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
    config[cargo] = { nombreBono: 'Bono ' + tipo + ' ' + cargo, monto, criterios };
  });
  return config;
}

function getMaestroTrabajadores() {
  try {
    const sheet = SpreadsheetApp.openById(ID_MAESTRO).getSheetByName('Inscripcion');
    if (!sheet || sheet.getLastRow() < 2) return [];
    return sheet.getRange(2, 2, sheet.getLastRow() - 1, 1).getValues()
      .map(r => String(r[0]).trim())
      .filter(n => n.length > 0)
      .sort();
  } catch(e) {
    Logger.log('Error leyendo Maestro Trabajadores: ' + e.message);
    return [];
  }
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
      trabajador:     String(row[5]).trim(),
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
      const rowData   = [
        ev.semana, ev.fechaEvento, ev.codigoEvento, ev.centro,
        normCargo, ev.trabajador || normCargo,
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
// AUTO-LLENADO TRABAJADORES
// ==================================================================
function _getTrabajadoresPorEvento(semana) {
  const result = {};
  try {
    const ssSup = SpreadsheetApp.openById(ID_CENTRALIZADO).getSheetByName('Fuente_Supervisoras');
    if (ssSup && ssSup.getLastRow() > 1) {
      const supData = ssSup.getRange(2, 1, ssSup.getLastRow() - 1, 8).getValues();
      supData.forEach(row => {
        const rowSemana = _normCRMSemana(row[1]);
        if (rowSemana !== semana) return;
        const codigo = String(row[0]).trim();
        const trabajador = String(row[6]).trim();
        const cargo = String(row[7]).trim();
        if (!codigo || !cargo || !trabajador) return;
        if (!result[codigo]) result[codigo] = {};
        result[codigo][cargo] = trabajador;
      });
    }
    const ssFotos = SpreadsheetApp.openById('1fJFabJhtLfoX51R2ewSuZ89TGDGruLdBRA-CdQffiYU').getSheetByName('Bono Fotos');
    if (ssFotos && ssFotos.getLastRow() > 3) {
      const fotosData = ssFotos.getRange(4, 1, ssFotos.getLastRow() - 3, 7).getValues();
      fotosData.forEach(row => {
        const rowSemana = _normCRMSemana(row[0]);
        if (rowSemana !== semana) return;
        const codigo = String(row[2]).trim();
        const cargo = String(row[5]).trim() || String(row[4]).trim();
        const trabajador = String(row[6]).trim();
        if (!codigo || !cargo || !trabajador) return;
        if (!result[codigo]) result[codigo] = {};
        if (!result[codigo][cargo]) result[codigo][cargo] = trabajador;
      });
    }
  } catch(e) {
    Logger.log('_getTrabajadoresPorEvento error: ' + e.message);
  }
  return result;
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
      trabajador:      String(row[8]).trim(),
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
      const rowData = [
        ev.semana, ev.fechaEvento, ev.codigoEvento, ev.centro,
        ev.invitadosComida, mermaPermitida, ev.facturaMerma,
        ev.cargo, ev.trabajador || ev.cargo, gana, tsStr
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
    return { success: true, rowsAdded: newRows.length, rowsUpdated };
  } catch(e) {
    return { success: false, error: e.message };
  }
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
