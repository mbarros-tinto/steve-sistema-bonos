// ==================================================================
// SISTEMA BONOS CENTRALIZADO v2.1 -- Tinto Banquetería
// Código.gs -- Orquestación, sync, reconstrucción y datos para webapp
// ==================================================================

var ID_SHEET_CENTRALIZADO = '1f86EWcVJAaptEBoAzI8d6ZZ_lHw09XBYV9C5Kbe-g5k';
var ID_SHEET_FOTOS        = '1fJFabJhtLfoX51R2ewSuZ89TGDGruLdBRA-CdQffiYU';
var ID_SHEET_CG           = '1ZVR0xSxfO3zFGVboByKFa4evVdqPtVtJZcvn3UuPBWc';
var ID_SHEET_SUPERVISORAS = '1JC49jh4kgImPf-mUW-r-PepPhLF0mIgcWp-FWS6l6Sg';
var ANIO_MIN = 2026;
// -- CRM GENERAL ----------------------------------------------------
// Referencia de estructura para arreglos futuros:
//   Spreadsheet ID : 1TTzFI5sMgInI1Ew__3Rw7lE300cGWmlDFyDVfWVqGTg
//   Tab            : CRM CONSOLIDADO
//   Datos desde    : fila 3 (fila 1 = enc. principal, fila 2 = sub-enc.)
//   Col I  (idx 8) : Fecha Evento     -- Date obj, Sheets: "D/M/YYYY" ej: "26/02/2026"
//   Col O  (idx 14): Nombre / Centro  -- lugar ej: "Cumbres", "Casa Bracco"
//   Col P  (idx 15): Codigo Evento    -- Centro + Fecha ej: "Cumbres 26/02/2026"
//   Col AL (idx 37): Semana Operacion -- lunes de la semana ej: "23/02/2026"
var ID_CRM_GENERAL   = '1TTzFI5sMgInI1Ew__3Rw7lE300cGWmlDFyDVfWVqGTg';
var HOJA_CRM_GENERAL = 'CRM CONSOLIDADO';


var HOJAS = {
  FUENTE_SUPERVISORAS: 'Fuente_Supervisoras',
  FUENTE_FOTOS:        'Fuente_Fotos',
  FUENTE_CG:           'Fuente_CG',
  BASE_CRITERIOS:      'Base_Criterios',
  RESUMEN_SEMANA:      'Resumen_Semana',
  RESUMEN_FINANZAS:    'Resumen_Finanzas',
  MAESTRO_BONOS:       'Maestro_Bonos'
};

function _cargarMontoBonos() {
  var map = {};
  try {
    var ss = SpreadsheetApp.openById(ID_SHEET_CENTRALIZADO);
    var h = ss.getSheetByName('Maestro_Bonos');
    if (!h || h.getLastRow() < 2) return map;
    var data = h.getRange(2, 1, h.getLastRow() - 1, 3).getValues();
    for (var i = 0; i < data.length; i++) {
      var cargo = String(data[i][0]).trim();
      var tipo = String(data[i][1]).trim();
      var monto = Number(data[i][2]) || 0;
      if (cargo && tipo && monto) {
        map['Bono ' + tipo + ' ' + cargo] = monto;
      }
    }
  } catch(e) { Logger.log('_cargarMontoBonos error: ' + e); }
  return map;
}

function _cargarNombreBonoMap() {
  var fotosMap = {}, cgMap = {}, supMap = {};
  try {
    var ss = SpreadsheetApp.openById(ID_SHEET_CENTRALIZADO);
    var h = ss.getSheetByName('Maestro_Bonos');
    if (!h || h.getLastRow() < 2) return { fotos: fotosMap, cg: cgMap, sup: supMap };
    var data = h.getRange(2, 1, h.getLastRow() - 1, 4).getValues();
    for (var i = 0; i < data.length; i++) {
      var cargo = String(data[i][0]).trim();
      var tipo = String(data[i][1]).trim();
      var sistema = String(data[i][3]).trim();
      if (!cargo || !tipo) continue;
      var nombre = 'Bono ' + tipo + ' ' + cargo;
      if (sistema === 'Fotos') fotosMap[cargo] = nombre;
      if (sistema === 'CG') cgMap[cargo] = nombre;
      if (sistema === 'Supervisoras') supMap[cargo] = nombre;
    }
  } catch(e) { Logger.log('_cargarNombreBonoMap error: ' + e); }
  return { fotos: fotosMap, cg: cgMap, sup: supMap };
}

// -- MENÚ Y WEBAPP -------------------------------------------------

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Sistema Bonos')
    .addItem('Sincronizar todo', 'sincronizarTodo')
    .addSeparator()
    .addItem('Solo Fotos', 'soloSyncFotos')
    .addItem('Solo CG', 'soloSyncCG')
    .addItem('Solo Supervisoras', 'soloSyncSupervisoras')
    .addSeparator()
    .addItem('Reconstruir Base + Resumen + Finanzas', 'reconstruirTodo')
    .addSeparator()
    .addItem('Abrir Webapp', 'abrirWebapp')
    .addToUi();
}

function doGet() {
  return HtmlService.createHtmlOutputFromFile('WebApp')
    .setTitle('Sistema Bonos -- Tinto')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function abrirWebapp() {
  var html = HtmlService.createHtmlOutputFromFile('WebApp').setWidth(1200).setHeight(720);
  SpreadsheetApp.getUi().showModalDialog(html, 'Sistema Bonos');
}

function soloSyncFotos()        { var n = syncFotos();        SpreadsheetApp.getUi().alert('Fotos: '        + n + ' nuevos registros.'); }
function soloSyncCG()           { var n = syncCG();           SpreadsheetApp.getUi().alert('CG: '           + n + ' nuevos registros.'); }
function soloSyncSupervisoras() { var n = syncSupervisoras(); SpreadsheetApp.getUi().alert('Supervisoras: ' + n + ' nuevos registros.'); }

// -- ORQUESTACIÓN --------------------------------------------------

function sincronizarTodo() {
  var r = syncDatosFaltantes();
  try {
    SpreadsheetApp.getUi().alert(
      'Sincronizacion completa.\n\n' +
      'Fotos nuevos:        ' + r.fotos       + '\n' +
      'CG nuevos:           ' + r.cg          + '\n' +
      'Supervisoras nuevos: ' + r.supervisoras + '\n' +
      'Base_Criterios:      ' + r.base        + ' filas\n' +
      'Resumen_Finanzas:    ' + r.finanzas    + ' filas'
    );
  } catch(e) {}
  return r;
}

function reconstruirTodo() {
  var n1 = _reconstruirBase();
  _reconstruirResumen();
  var n2 = _reconstruirFinanzas();
  try { SpreadsheetApp.getUi().alert('Base: ' + n1 + ' filas reconstruidas.\nFinanzas: ' + n2 + ' filas.'); } catch(e) {}
}

function syncDatosFaltantes() {
  var nFotos = syncFotos();
  var nCG    = syncCG();
  var nSup   = syncSupervisoras();
  var nBase  = _reconstruirBase();
  _reconstruirResumen();
  var nFin   = _reconstruirFinanzas();
  return { fotos: nFotos, cg: nCG, supervisoras: nSup, base: nBase, finanzas: nFin };
}

// -- SYNC FOTOS ----------------------------------------------------
function syncFotos() {
  var ss      = SpreadsheetApp.openById(ID_SHEET_CENTRALIZADO);
  var hFuente = _getOrCreate(ss, HOJAS.FUENTE_FOTOS);
  var yaSync  = _buildKeySet(hFuente, 0, 6);

  var ssFotos = SpreadsheetApp.openById(ID_SHEET_FOTOS);
  var hBono   = ssFotos.getSheetByName('Bono Fotos');
  if (!hBono || hBono.getLastRow() < 4) return 0;

  var datos  = hBono.getRange(4, 1, hBono.getLastRow() - 3, 20).getValues();
  var nuevas = [];

  for (var i = 0; i < datos.length; i++) {
    var r        = datos[i];
    var codigo   = String(r[2]).trim();
    var cargo    = String(r[4]).trim();
    var fechaRaw = r[1];                       // puede llegar como Date si Sheets lo parseó
    var fecha    = _normFechaAStr(fechaRaw);   // -> "DD/MM/YYYY" siempre
    var anio     = _extraerAnio(fechaRaw);     // -> año entero (ej: 2026)
    if (!codigo || !cargo) continue;
    if (anio < ANIO_MIN) continue;
    var key = codigo + '|||' + cargo;
    if (yaSync[key]) continue;

    nuevas.push([
      codigo,                    _normFechaAStr(r[0]),   anio,   fecha,  r[3],
      r[6],                cargo,
      r[7],r[8],r[9],r[10],r[11],r[12],r[13],r[14],
      r[15],r[16],r[17],   String(r[18]).trim(), r[19]
    ]);
    yaSync[key] = true;
  }

  if (nuevas.length > 0) {
    if (hFuente.getLastRow() === 0) {
      _writeHeader(hFuente, ['Código Evento','Semana','Año','Fecha Evento','Centro',
        'Trabajador','Cargo','Resp 1','Resp 2','Resp 3','Resp 4','Resp 5','Resp 6','Resp 7','Resp 8',
        'Total Preguntas','Respondidas','% Cumplimiento','Gana Bono Fotos','Timestamp']);
    }
    hFuente.getRange(hFuente.getLastRow() + 1, 1, nuevas.length, 20).setValues(nuevas);
  }
  return nuevas.length;
}

// -- SYNC CG -------------------------------------------------------
function syncCG() {
  var ss      = SpreadsheetApp.openById(ID_SHEET_CENTRALIZADO);
  var hFuente = _getOrCreate(ss, HOJAS.FUENTE_CG);
  var yaSync  = _buildKeySet(hFuente, 0, 6);

  var ssCG   = SpreadsheetApp.openById(ID_SHEET_CG);
  var hBono  = ssCG.getSheetByName('Bono CG');
  if (!hBono || hBono.getLastRow() < 4) return 0;

  var datos  = hBono.getRange(4, 1, hBono.getLastRow() - 3, 21).getValues();
  var nuevas = [];

  for (var i = 0; i < datos.length; i++) {
    var r        = datos[i];
    var codigo   = String(r[2]).trim();
    var cargo    = String(r[4]).trim();
    var fechaRaw = r[1];                       // puede llegar como Date si Sheets lo parseó
    var fecha    = _normFechaAStr(fechaRaw);   // -> "DD/MM/YYYY" siempre
    var anio     = _extraerAnio(fechaRaw);     // -> año entero (ej: 2026)
    if (!codigo || !cargo) continue;
    if (anio < ANIO_MIN) continue;
    var key = codigo + '|||' + cargo;
    if (yaSync[key]) continue;

    nuevas.push([
      codigo, _normFechaAStr(r[0]), anio, fecha, r[3],
      String(r[5]).trim(), cargo,
      r[6],r[7],r[8],r[9],r[10],r[11],r[12],r[13],r[14],r[15],
      r[18], String(r[19]).trim(), r[20]
    ]);
    yaSync[key] = true;
  }

  if (nuevas.length > 0) {
    if (hFuente.getLastRow() === 0) {
      _writeHeader(hFuente, ['Código Evento','Semana','Año','Fecha Evento','Centro',
        'Trabajador','Cargo','Crit 1','Crit 2','Crit 3','Crit 4','Crit 5',
        'Crit 6','Crit 7','Crit 8','Crit 9','Crit 10','% Cumplimiento','Gana Bono CG','Timestamp']);
    }
    hFuente.getRange(hFuente.getLastRow() + 1, 1, nuevas.length, 20).setValues(nuevas);
  }
  return nuevas.length;
}

// -- SYNC SUPERVISORAS ---------------------------------------------
// Fuente: "Dashboard de Bonos" en ID_SHEET_SUPERVISORAS.
// Estructura (una fila por trabajador, 11 columnas A-K):
//   A: Timestamp Evaluación  B: Centro de Evento  C: Novios
//   D: Fecha Evento          E: Código Evento
//   F: Nombre Trabajador     G: Cargo
//   H: ?Ganó Bono?           I: Nota Promedio
//   J: Supervisor            K: Fecha Evaluación
// Fuente_Supervisoras (20 cols):
//   0:Código Evento  1:Semana  2:Año  3:Fecha Evento  4:Centro  5:Novios
//   6:Trabajador  7:Cargo  8:Supervisor  9:Timestamp
//   10:Crit:Liderazgo  11:Crit:Foco Cliente  12:Crit:Coordinacion
//   13:Crit:Manejo Crisis  14:Crit:Estandar Alarmas  15:Crit:Conteo Botellas
//   16:Crit:Material  17:Crit:Presente/Rol  18:Nota Promedio  19:Gana Bono Supervisora
function syncSupervisoras() {
  var ss      = SpreadsheetApp.openById(ID_SHEET_CENTRALIZADO);
  var hFuente = _getOrCreate(ss, HOJAS.FUENTE_SUPERVISORAS);
  var yaSync  = _buildKeySet(hFuente, 0, 6);  // key: Código + Trabajador

  var ssSup = SpreadsheetApp.openById(ID_SHEET_SUPERVISORAS);
  var hDash = ssSup.getSheetByName('Dashboard de Bonos');
  if (!hDash || hDash.getLastRow() < 2) return 0;

  var datos  = hDash.getRange(2, 1, hDash.getLastRow() - 1, 11).getValues();
  var nuevas = [];

  for (var i = 0; i < datos.length; i++) {
    var r          = datos[i];
    var timestamp  = r[0];                 // A: Timestamp Evaluación
    var centro     = String(r[1]).trim();  // B: Centro de Evento
    var novios     = String(r[2]).trim();  // C: Novios
    var fechaEvt   = r[3];                 // D: Fecha Evento
    var codigo     = String(r[4]).trim();  // E: Código Evento
    var trabajador = String(r[5]).trim();  // F: Nombre Trabajador
    var cargo      = String(r[6]).trim();  // G: Cargo
    var ganoBono   = String(r[7]).trim();  // H: ?Ganó Bono?
    var nota       = r[8];                 // I: Nota Promedio
    var supervisor = String(r[9]).trim();  // J: Supervisor

    if (!codigo || !trabajador) continue;

    var anio = _extraerAnio(fechaEvt);
    if (anio < ANIO_MIN) continue;

    var key = codigo + '|||' + trabajador;
    if (yaSync[key]) continue;

    var semana   = _getSemanaStr(fechaEvt);
    var fechaStr = _normFechaAStr(fechaEvt);

    nuevas.push([
      codigo, semana, anio, fechaStr,
      centro, novios,
      trabajador, cargo,
      supervisor, timestamp,
      '', '', '', '', '', '', '', '',
      nota, ganoBono
    ]);
    yaSync[key] = true;
  }

  if (nuevas.length > 0) {
    if (hFuente.getLastRow() === 0) {
      _writeHeader(hFuente, [
        'Código Evento','Semana','Año','Fecha Evento','Centro','Novios',
        'Trabajador','Cargo','Supervisor','Timestamp',
        'Crit:Liderazgo','Crit:Foco Cliente','Crit:Coordinacion',
        'Crit:Manejo Crisis','Crit:Estandar Alarmas','Crit:Conteo Botellas',
        'Crit:Material','Crit:Presente/Rol','Nota Promedio','Gana Bono Supervisora'
      ]);
    }
    hFuente.getRange(hFuente.getLastRow() + 1, 1, nuevas.length, 20).setValues(nuevas);
  }
  return nuevas.length;
}

// -- RECONSTRUIR BASE_CRITERIOS ------------------------------------
function _reconstruirBase() {
  var ss    = SpreadsheetApp.openById(ID_SHEET_CENTRALIZADO);
  var hBase = _getOrCreate(ss, HOJAS.BASE_CRITERIOS);
  hBase.clearContents(); hBase.clearFormats();

  var HDR = ['Código Evento','Semana','Año','Fecha Evento','Centro','Novios',
             'Trabajador','Cargo','Nombre Bono','Criterio','Cumplido','Resultado',
             'Fuente','Extra','Timestamp'];
  _writeHeader(hBase, HDR);

  var maps = _cargarNombreBonoMap();
  var bonoFotosMap = maps.fotos;
  var bonoCGMap = maps.cg;
  var bonoSupMap = maps.sup;

  var filas = [];

  // Fotos
  var hFotos = ss.getSheetByName(HOJAS.FUENTE_FOTOS);
  if (hFotos && hFotos.getLastRow() > 1) {
    hFotos.getRange(2, 1, hFotos.getLastRow() - 1, 20).getValues().forEach(function(r) {
      var codigo = String(r[0]).trim(); if (!codigo || codigo.toLowerCase().indexOf('código') !== -1) return;
      var cargo  = String(r[6]).trim();
      var gana   = String(r[18]).trim();
      var bono   = bonoFotosMap[cargo] || ('Bono Fotos ' + cargo);
      var ok     = gana === 'SI' ? 1 : 0;
      filas.push([codigo, _normFechaAStr(r[1]), r[2], _normFechaAStr(r[3]), r[4], '', r[5], cargo,
                  bono, 'RESULTADO BONO', ok,
                  ok ? 'Gano' : 'No gano', 'Fuente_Fotos', '', r[19]]);
    });
  }

  // CG
  var hCG = ss.getSheetByName(HOJAS.FUENTE_CG);
  if (hCG && hCG.getLastRow() > 1) {
    hCG.getRange(2, 1, hCG.getLastRow() - 1, 20).getValues().forEach(function(r) {
      var codigo = String(r[0]).trim(); if (!codigo || codigo.toLowerCase().indexOf('código') !== -1) return;
      var cargo  = String(r[6]).trim();
      var pct    = r[17];
      var gana   = String(r[18]).trim();
      var bono = bonoCGMap[cargo] || ('Bono Activos ' + cargo);
      var ok   = gana === 'SI' ? 1 : 0;
      filas.push([codigo, _normFechaAStr(r[1]), r[2], _normFechaAStr(r[3]), r[4], '', r[5], cargo,
                  bono, 'RESULTADO BONO', ok,
                  ok ? 'Gano ' + pct + '%' : 'No gano ' + pct + '%',
                  'Fuente_CG', '', r[19]]);
    });
  }

  // Supervisoras
  var hSup = ss.getSheetByName(HOJAS.FUENTE_SUPERVISORAS);
  if (hSup && hSup.getLastRow() > 1) {
    var raw  = hSup.getDataRange().getValues();
    var hRow = raw[0];
    var iCod = _colIdx(hRow,'Código',0), iSem = _colIdx(hRow,'Semana',1);
    var iAno = _colIdx(hRow,'Año',2),    iFec = _colIdx(hRow,'Fecha',3);
    var iCen = _colIdx(hRow,'Centro',4), iNov = _colIdx(hRow,'Novios',5);
    var iTrb = _colIdx(hRow,'Trabajador',6), iCrg = _colIdx(hRow,'Cargo',7);
    var iSup = _colIdx(hRow,'Supervisor',8);
    var iTs  = _colIdx(hRow,'Timestamp',9);
    var iGna = _colIdx(hRow,'Gana',19);
    for (var i = 1; i < raw.length; i++) {
      var r    = raw[i];
      var cod  = String(r[iCod]).trim(); if (!cod) continue;
      var cargo = String(r[iCrg]).trim();
      var gana  = String(r[iGna]).trim().toUpperCase();
      var bono  = bonoSupMap[cargo] || ('Bono Supervisora ' + cargo);
      var ok    = (gana === 'SI' || gana === 'SÍ') ? 1 : 0;
      filas.push([cod, _normFechaAStr(r[iSem]), r[iAno], _normFechaAStr(r[iFec]), r[iCen], r[iNov],
                  r[iTrb], cargo, bono, 'RESULTADO BONO', ok,
                  ok ? 'Gano' : 'No gano',
                  'Fuente_Supervisoras', String(r[iSup]||'').trim(), r[iTs]]);
    }
  }

  if (filas.length > 0) {
    hBase.getRange(2, 1, filas.length, HDR.length).setValues(filas);
  }
  return filas.length;
}

// -- RESUMEN_SEMANA ------------------------------------------------
function _reconstruirResumen() {
  var ss    = SpreadsheetApp.openById(ID_SHEET_CENTRALIZADO);
  var hBase = ss.getSheetByName(HOJAS.BASE_CRITERIOS);
  if (!hBase || hBase.getLastRow() < 2) return;

  var hRes = _getOrCreate(ss, HOJAS.RESUMEN_SEMANA);
  hRes.clearContents(); hRes.clearFormats();
  _writeHeader(hRes, ['Semana','Año','Cargo','Nombre Bono','Fuente',
                       'Total Eventos','Ganaron','No Ganaron','% Ganaron']);

  var datos  = hBase.getRange(2, 1, hBase.getLastRow() - 1, 15).getValues();
  var grupos = {};
  datos.forEach(function(r) {
    var k = [r[1],r[2],r[7],r[8],r[12]].join('|||');
    if (!grupos[k]) grupos[k] = { s:r[1],a:r[2],c:r[7],b:r[8],f:r[12],tot:0,si:0 };
    grupos[k].tot++;
    if (parseInt(r[10]) === 1) grupos[k].si++;
  });

  var filas = [];
  for (var k in grupos) {
    var g = grupos[k];
    filas.push([g.s, g.a, g.c, g.b, g.f, g.tot, g.si, g.tot - g.si,
                g.tot > 0 ? Math.round(g.si / g.tot * 100) : 0]);
  }
  filas.sort(function(a,b) { return a[0] > b[0] ? -1 : 1; });
  if (filas.length > 0) hRes.getRange(2, 1, filas.length, 9).setValues(filas);
}

// -- RESUMEN_FINANZAS ----------------------------------------------
function _reconstruirFinanzas() {
  var ss    = SpreadsheetApp.openById(ID_SHEET_CENTRALIZADO);
  var hBase = ss.getSheetByName(HOJAS.BASE_CRITERIOS);
  if (!hBase || hBase.getLastRow() < 2) return 0;

  var hFin = _getOrCreate(ss, HOJAS.RESUMEN_FINANZAS);
  hFin.clearContents(); hFin.clearFormats();
  _writeHeader(hFin, ['Semana','Código Evento','Fecha Evento','Centro',
                       'Trabajador','Cargo','Nombre Bono','Fuente',
                       'Resultado','Gana Bono','Monto ($)','Timestamp']);

  var montoBonos = _cargarMontoBonos();
  var datos = hBase.getRange(2, 1, hBase.getLastRow() - 1, 15).getValues();
  var filas = [];
  datos.forEach(function(r) {
    var bono     = String(r[8]).trim();
    var cumplido = parseInt(r[10]) === 1;
    var monto    = cumplido ? (montoBonos[bono] || 0) : 0;
    filas.push([r[1],r[0],r[3],r[4],r[6],r[7],bono,r[12],r[11],
                cumplido ? 'SI' : 'NO', monto, r[14]]);
  });
  filas.sort(function(a,b) { return a[0] > b[0] ? -1 : 1; });

  if (filas.length > 0) {
    hFin.getRange(2, 1, filas.length, 12).setValues(filas);
    hFin.getRange(2, 11, filas.length, 1).setNumberFormat('"$"#,##0');
    for (var i = 0; i < filas.length; i++) {
      var row = i + 2;
      var bg = filas[i][9] === 'SI' ? '#d4edda' : '#f8d7da';
      var fc = filas[i][9] === 'SI' ? '#155724' : '#721c24';
      hFin.getRange(row, 10, 1, 2).setBackground(bg).setFontColor(fc);
    }
  }
  return filas.length;
}

// -- DATA FUNCTIONS PARA WEBAPP ------------------------------------

function getWebAppData() {
  try {
    var base = _leerBase();
    var semanas = {}, cargos = {}, personas = {};
    base.forEach(function(r) {
      if (r.semana)     semanas[r.semana]      = true;
      if (r.cargo)      cargos[r.cargo]        = true;
      if (r.trabajador) personas[r.trabajador] = true;
    });
    return {
      ok:       true,
      semanas:  Object.keys(semanas).sort().reverse(),
      cargos:   Object.keys(cargos).sort(),
      personas: Object.keys(personas).sort(),
      total:    base.length
    };
  } catch(e) { return { ok: false, msg: e.toString() }; }
}

function getDatosSemana(semana) {
  try {
    var base     = _leerBase();
    var filtrado = base.filter(function(r) { return r.semana === semana; });
    var grupos   = {};
    filtrado.forEach(function(r) {
      if (!grupos[r.cargo]) grupos[r.cargo] = [];
      var ev = null;
      for (var i = 0; i < grupos[r.cargo].length; i++) {
        if (grupos[r.cargo][i].codigo === r.codigoEvento) { ev = grupos[r.cargo][i]; break; }
      }
      if (!ev) {
        ev = { codigo: r.codigoEvento, centro: r.centro, fecha: r.fechaEvento,
               trabajador: r.trabajador, bonos: [] };
        grupos[r.cargo].push(ev);
      }
      ev.bonos.push({ nombre: r.nombreBono, fuente: r.fuente,
                      cumplido: r.cumplido, resultado: r.resultado });
    });
    return { ok: true, semana: semana, grupos: grupos };
  } catch(e) { return { ok: false, msg: e.toString() }; }
}

function getDatosCargo(cargo) {
  try {
    var base     = _leerBase();
    var filtrado = base.filter(function(r) { return r.cargo === cargo; });
    var eventos  = {};
    filtrado.forEach(function(r) {
      if (!eventos[r.codigoEvento]) {
        eventos[r.codigoEvento] = { codigo: r.codigoEvento, semana: r.semana,
          centro: r.centro, fecha: r.fechaEvento, trabajador: r.trabajador, bonos: [] };
      }
      eventos[r.codigoEvento].bonos.push({
        nombre: r.nombreBono, fuente: r.fuente,
        cumplido: r.cumplido, resultado: r.resultado });
    });
    var lista = [];
    for (var k in eventos) lista.push(eventos[k]);
    lista.sort(function(a,b) { return a.fecha > b.fecha ? -1 : 1; });
    return { ok: true, cargo: cargo, eventos: lista };
  } catch(e) { return { ok: false, msg: e.toString() }; }
}

function getDatosPersona(persona) {
  try {
    var base     = _leerBase();
    var filtrado = base.filter(function(r) { return r.trabajador === persona; });
    var eventos  = {};
    filtrado.forEach(function(r) {
      if (!eventos[r.codigoEvento]) {
        eventos[r.codigoEvento] = { codigo: r.codigoEvento, semana: r.semana,
          cargo: r.cargo, centro: r.centro, fecha: r.fechaEvento, bonos: [] };
      }
      eventos[r.codigoEvento].bonos.push({
        nombre: r.nombreBono, fuente: r.fuente,
        cumplido: r.cumplido, resultado: r.resultado });
    });
    var lista = [];
    for (var k in eventos) lista.push(eventos[k]);
    lista.sort(function(a,b) { return a.fecha > b.fecha ? -1 : 1; });
    var tot = filtrado.length, gan = filtrado.filter(function(r){return r.cumplido===1;}).length;
    return { ok: true, persona: persona, eventos: lista, stats: { total: tot, ganados: gan } };
  } catch(e) { return { ok: false, msg: e.toString() }; }
}

function sincronizarDesdeWebApp() {
  try {
    var r = syncDatosFaltantes();
    return { ok: true, msg: 'Sincronizacion completa', data: r };
  } catch(e) { return { ok: false, msg: e.toString() }; }
}


// -- CRM GENERAL -- FUNCIONES ---------------------------------------

// Normaliza distintos formatos de fecha a YYYYMMDD para comparar.
// Acepta: Date object, "YYYY-MM-DD", "D/M/YYYY", "DD/MM/YYYY", "DD-MM-YYYY".
function _normFecha(f) {
  if (!f) return '';
  if (f instanceof Date) {
    return String(f.getFullYear()) +
           ('0' + (f.getMonth() + 1)).slice(-2) +
           ('0' + f.getDate()).slice(-2);
  }
  var s = String(f).trim();
  var m1 = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m1) return m1[1] + m1[2] + m1[3];
  var m2 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m2) return m2[3] + ('0' + m2[2]).slice(-2) + ('0' + m2[1]).slice(-2);
  var m3 = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (m3) return m3[3] + ('0' + m3[2]).slice(-2) + ('0' + m3[1]).slice(-2);
  return s;
}

// Retorna [{codigo, centro, fecha}] de todos los eventos CRM para esa semana.
// semana puede ser Date, "DD/MM/YYYY" o "YYYY-MM-DD" (debe coincidir con col AL).
function getEventosCRMPorSemana(semana) {
  try {
    var ss   = SpreadsheetApp.openById(ID_CRM_GENERAL);
    var hoja = ss.getSheetByName(HOJA_CRM_GENERAL);
    if (!hoja || hoja.getLastRow() < 3) return { ok: true, eventos: [] };

    // Leer hasta col AL (38 cols)
    var datos   = hoja.getRange(3, 1, hoja.getLastRow() - 2, 38).getValues();
    var eventos = [];
    var semNorm = _normFecha(semana);

    datos.forEach(function(r) {
      if (_normFecha(r[37]) !== semNorm) return;  // col AL = Semana Operacion
      var centro = String(r[14]).trim();           // col O = Nombre/Centro
      var codigo = String(r[15]).trim();           // col P = Codigo Evento
      var fecha  = _normFecha(r[8]);               // col I = Fecha Evento
      if (!codigo) return;
      for (var i = 0; i < eventos.length; i++) {
        if (eventos[i].codigo === codigo) return;  // evitar duplicados
      }
      // Formatear fecha de vuelta a DD/MM/YYYY para mostrar
      var fechaDisplay = fecha ? fecha.slice(6,8) + '/' + fecha.slice(4,6) + '/' + fecha.slice(0,4) : '';
      eventos.push({ codigo: codigo, centro: centro, fecha: fechaDisplay });
    });

    return { ok: true, eventos: eventos };
  } catch (e) {
    Logger.log('getEventosCRMPorSemana: ' + e.toString());
    return { ok: false, msg: e.toString(), eventos: [] };
  }
}

// Combina datos de bonos de Base_Criterios con eventos del CRM General.
// Retorna los mismos grupos de bonos MAS una lista de eventos CRM sin bonos.
function getDatosSemanaConCRM(semana) {
  try {
    var bonosData = getDatosSemana(semana);
    var crmData   = getEventosCRMPorSemana(semana);

    // Construir set de codigos que ya tienen bonos registrados
    var conBonos = {};
    if (bonosData.ok) {
      var grupos = bonosData.grupos || {};
      for (var cargo in grupos) {
        grupos[cargo].forEach(function(ev) { conBonos[ev.codigo] = true; });
      }
    }

    // Eventos CRM que NO tienen bonos aun
    var sinBonos = [];
    if (crmData.ok) {
      crmData.eventos.forEach(function(ev) {
        if (!conBonos[ev.codigo]) sinBonos.push(ev);
      });
    }

    return {
      ok:              true,
      semana:          semana,
      grupos:          bonosData.ok ? (bonosData.grupos || {}) : {},
      eventosSinBonos: sinBonos,
      totalCRM:        crmData.ok ? crmData.eventos.length : 0
    };
  } catch (e) {
    Logger.log('getDatosSemanaConCRM: ' + e.toString());
    return { ok: false, msg: e.toString() };
  }
}

// -- DETALLE CRITERIOS POR SEMANA (para webapp) -------------------
// Retorna datos crudos de Fuente_CG, Fuente_Fotos, Fuente_Supervisoras
// y la configuración de criterios desde Maestro_Bonos en Centralizado.
function getDetalleCriteriosSemana(semana) {
  try {
    var semanaNorm = _normFechaAStr(semana);
    var ss = SpreadsheetApp.openById(ID_SHEET_CENTRALIZADO);

    // -- 1. Criterios config desde Maestro_Bonos --
    var criteriosCG = {};
    var criteriosFotos = {};
    var criteriosSup = {};
    var hMB = ss.getSheetByName(HOJAS.MAESTRO_BONOS);
    if (hMB && hMB.getLastRow() >= 2) {
      var mbData = hMB.getRange(2, 1, hMB.getLastRow() - 1, 14).getValues();
      for (var i = 0; i < mbData.length; i++) {
        var cargoCrit = String(mbData[i][0]).trim();   // Col A = Cargo
        var tipoBono  = String(mbData[i][1]).trim();   // Col B = Tipo Bono
        var monto     = mbData[i][2];                  // Col C = Monto
        var sistema   = String(mbData[i][3]).trim();   // Col D = Sistema
        if (!cargoCrit || !sistema) continue;
        var nombreBono = 'Bono ' + tipoBono + ' ' + cargoCrit;
        var criterioNames = [];
        for (var j = 4; j <= 13; j++) {                // Cols E-N = Criterios
          var val = String(mbData[i][j]).trim();
          if (val && val !== '--' && val !== '-') {
            criterioNames.push(val);
          }
        }
        var entry = { nombreBono: nombreBono, criterioNames: criterioNames };
        if (sistema === 'CG') {
          // Para vista detalle, usar Activos como principal (Vajilla se verá en módulo aparte)
          if (!criteriosCG[cargoCrit] || tipoBono === 'Activos') {
            criteriosCG[cargoCrit] = entry;
          }
        } else if (sistema === 'Fotos') {
          criteriosFotos[cargoCrit] = entry;
        } else if (sistema === 'Supervisoras') {
          criteriosSup[cargoCrit] = entry;
        }
      }
    }

    // -- 2. Fuente_CG filtrada por semana --
    var cgResult = [];
    var hCG = ss.getSheetByName(HOJAS.FUENTE_CG);
    if (hCG && hCG.getLastRow() > 1) {
      var cgData = hCG.getRange(2, 1, hCG.getLastRow() - 1, 20).getValues();
      for (var i = 0; i < cgData.length; i++) {
        var r = cgData[i];
        var rowSemana = _normFechaAStr(r[1]); // col B = Semana
        if (rowSemana !== semanaNorm) continue;
        var criterioValues = [];
        for (var j = 7; j <= 16; j++) { // cols H-Q (idx 7-16) = Crit 1..10
          criterioValues.push(String(r[j]).trim());
        }
        cgResult.push({
          codigoEvento: String(r[0]).trim(),
          cargo: String(r[6]).trim(),
          trabajador: String(r[5]).trim(),
          criterioValues: criterioValues,
          pct: r[17],   // col R = % Cumplimiento
          gana: String(r[18]).trim()  // col S = Gana Bono CG
        });
      }
    }

    // -- 3. Fuente_Fotos filtrada por semana --
    var fotosResult = [];
    var hFotos = ss.getSheetByName(HOJAS.FUENTE_FOTOS);
    if (hFotos && hFotos.getLastRow() > 1) {
      var fotosData = hFotos.getRange(2, 1, hFotos.getLastRow() - 1, 20).getValues();
      for (var i = 0; i < fotosData.length; i++) {
        var r = fotosData[i];
        var rowSemana = _normFechaAStr(r[1]); // col B = Semana
        if (rowSemana !== semanaNorm) continue;
        var respValues = [];
        for (var j = 7; j <= 14; j++) { // cols H-O (idx 7-14) = Resp 1..8
          respValues.push(String(r[j]).trim());
        }
        fotosResult.push({
          codigoEvento: String(r[0]).trim(),
          cargo: String(r[6]).trim(),
          trabajador: String(r[5]).trim(),
          respValues: respValues,
          gana: String(r[18]).trim()  // col S = Gana Bono Fotos
        });
      }
    }

    // -- 4. Fuente_Supervisoras filtrada por semana --
    // Cols: A=Código, B=Semana, C=Año, D=Fecha, E=Centro, F=Novios,
    //       G=Trabajador, H=Cargo, I=Supervisor, J=Timestamp,
    //       K=Crit:Liderazgo, L=Crit:Foco Cliente, M=Crit:Coordinacion,
    //       N=Crit:Manejo Crisis, O=Crit:Estandar Alarmas, P=Crit:Conteo Botellas,
    //       Q=Crit:Material, R=Crit:Presente/Rol, S=Nota Promedio, T=Gana Bono Supervisora
    var supResult = [];
    var hSup = ss.getSheetByName(HOJAS.FUENTE_SUPERVISORAS);
    if (hSup && hSup.getLastRow() > 1) {
      var supData = hSup.getRange(2, 1, hSup.getLastRow() - 1, 20).getValues();
      for (var i = 0; i < supData.length; i++) {
        var r = supData[i];
        var rowSemana = _normFechaAStr(r[1]); // col B = Semana
        if (rowSemana !== semanaNorm) continue;
        var criterioValues = [];
        for (var j = 10; j <= 17; j++) { // cols K-R (idx 10-17) = criteria values
          criterioValues.push(String(r[j]).trim());
        }
        supResult.push({
          codigoEvento: String(r[0]).trim(),
          cargo: String(r[7]).trim(),    // col H = Cargo
          trabajador: String(r[6]).trim(), // col G = Trabajador
          criterioValues: criterioValues,
          nota: r[18],                     // col S = Nota Promedio
          gana: String(r[19]).trim()       // col T = Gana Bono Supervisora
        });
      }
    }

    return {
      ok: true,
      criteriosConfig: {
        CG: criteriosCG,
        Fotos: criteriosFotos,
        Supervisoras: criteriosSup
      },
      cg: cgResult,
      fotos: fotosResult,
      supervisoras: supResult
    };
  } catch (e) {
    Logger.log('getDetalleCriteriosSemana: ' + e.toString());
    return { ok: false, msg: e.toString() };
  }
}

// -- MAESTRO CARGOS Y CRITERIOS -- FUNCIONES WEBAPP ----------------

function getMaestroBonos() {
  try {
    var ss = SpreadsheetApp.openById(ID_SHEET_CENTRALIZADO);
    var h = ss.getSheetByName('Maestro_Bonos');
    if (!h || h.getLastRow() < 2) return { ok: true, items: [] };
    var data = h.getRange(2, 1, h.getLastRow() - 1, 14).getValues();
    var items = [];
    data.forEach(function(r) {
      var cargo = String(r[0]).trim();
      var tipoBono = String(r[1]).trim();
      if (!cargo || !tipoBono) return;
      var crits = [];
      for (var i = 4; i <= 13; i++) {
        var c = String(r[i]).trim();
        if (c) crits.push(c);
      }
      items.push({
        cargo: cargo,
        tipoBono: tipoBono,
        monto: Number(r[2]) || 0,
        sistema: String(r[3]).trim(),
        criterios: crits
      });
    });
    return { ok: true, items: items };
  } catch(e) { return { ok: false, msg: e.toString() }; }
}
function getMaestroCriterios() { return getMaestroBonos(); }

function saveMaestroBonos(items) {
  try {
    var ss = SpreadsheetApp.openById(ID_SHEET_CENTRALIZADO);
    var h = ss.getSheetByName('Maestro_Bonos');
    if (h.getLastRow() > 1) h.getRange(2, 1, h.getLastRow() - 1, 14).clearContent();
    var rows = [];
    items.forEach(function(item) {
      var row = [item.cargo, item.tipoBono, item.monto || 0, item.sistema || ''];
      for (var i = 0; i < 10; i++) {
        row.push(item.criterios[i] || '');
      }
      rows.push(row);
    });
    if (rows.length > 0) {
      h.getRange(2, 1, rows.length, 14).setValues(rows);
    }
    return { ok: true };
  } catch(e) { return { ok: false, msg: e.toString() }; }
}
function saveMaestroCriterios(items) { return saveMaestroBonos(items); }

// -- TARIFAS 2026 -- Lee y escribe Tarifas del Maestro ---------------
var ID_SHEET_MAESTRO = '1aRuPFT625ewVSR7EfdaaHHp4Y2bohu6KUNLhC6ETd8M';

function getTarifas2026() {
  try {
    var ss = SpreadsheetApp.openById(ID_SHEET_MAESTRO);
    var h = ss.getSheetByName('Tarifas 2026');
    if (!h || h.getLastRow() < 2) return { ok: true, filas: [] };
    var lastRow = h.getLastRow();
    // Cols A-G: Cargo, Matrimonios, Cantidad, Bono Fotos, Bono Supervisora, Bono Activos, Bono Vajilla
    var data = h.getRange(1, 1, lastRow, 7).getValues();
    var header = data[0];
    var filas = [];
    for (var i = 1; i < data.length; i++) {
      var cargo = String(data[i][0]).trim();
      if (!cargo) continue;
      filas.push({
        fila: i + 1, // fila real en el sheet (1-based)
        cargo: cargo,
        tarifa: _parseMoney(data[i][1]),
        cantidad: String(data[i][2]).trim(),
        bonoFotos: _parseMoney(data[i][3]),
        bonoSupervisora: _parseMoney(data[i][4]),
        bonoActivos: _parseMoney(data[i][5]),
        bonoVajilla: _parseMoney(data[i][6])
      });
    }
    return { ok: true, filas: filas };
  } catch(e) { return { ok: false, msg: e.toString() }; }
}

function _parseMoney(val) {
  if (!val && val !== 0) return 0;
  var s = String(val).replace(/\$/g, '').replace(/\./g, '').replace(/,/g, '').trim();
  return Number(s) || 0;
}

function saveTarifas2026(cambios) {
  // cambios = array de { fila, tarifa, bonoFotos, bonoSupervisora, bonoActivos, bonoVajilla }
  try {
    var ss = SpreadsheetApp.openById(ID_SHEET_MAESTRO);
    var h = ss.getSheetByName('Tarifas 2026');
    if (!h) return { ok: false, msg: 'Hoja Tarifas 2026 no encontrada' };
    var updated = 0;
    cambios.forEach(function(c) {
      var row = c.fila;
      if (!row || row < 2) return;
      // Col B=tarifa, D=bonoFotos, E=bonoSupervisora, F=bonoActivos, G=bonoVajilla
      h.getRange(row, 2).setValue(c.tarifa || 0);
      h.getRange(row, 4).setValue(c.bonoFotos || 0);
      h.getRange(row, 5).setValue(c.bonoSupervisora || 0);
      h.getRange(row, 6).setValue(c.bonoActivos || 0);
      h.getRange(row, 7).setValue(c.bonoVajilla || 0);
      // Tambien actualizar Maestro_Bonos montos correspondientes
      updated++;
    });
    // Sync: actualizar montos en Maestro_Bonos tambien
    _syncTarifasToMaestroBonos(cambios);
    return { ok: true, updated: updated };
  } catch(e) { return { ok: false, msg: e.toString() }; }
}

function _syncTarifasToMaestroBonos(cambios) {
  try {
    var ss = SpreadsheetApp.openById(ID_SHEET_CENTRALIZADO);
    var h = ss.getSheetByName('Maestro_Bonos');
    if (!h || h.getLastRow() < 2) return;
    var data = h.getRange(2, 1, h.getLastRow() - 1, 3).getValues();
    // Construir mapa de cambios: cargo -> { Fotos, Supervisora, Activos, Vajilla }
    var mapaMontos = {};
    cambios.forEach(function(c) {
      mapaMontos[c.cargo] = {
        Fotos: c.bonoFotos || 0,
        Supervisora: c.bonoSupervisora || 0,
        Activos: c.bonoActivos || 0,
        Vajilla: c.bonoVajilla || 0
      };
    });
    // Actualizar filas de Maestro_Bonos donde cargo + tipo coinciden
    for (var i = 0; i < data.length; i++) {
      var cargo = String(data[i][0]).trim();
      var tipo = String(data[i][1]).trim();
      if (mapaMontos[cargo] && mapaMontos[cargo][tipo] !== undefined) {
        h.getRange(i + 2, 3).setValue(mapaMontos[cargo][tipo]);
      }
    }
  } catch(e) { Logger.log('_syncTarifasToMaestroBonos error: ' + e); }
}

// -- HELPERS -------------------------------------------------------

function _leerBase() {
  var ss   = SpreadsheetApp.openById(ID_SHEET_CENTRALIZADO);
  var hoja = ss.getSheetByName(HOJAS.BASE_CRITERIOS);
  if (!hoja || hoja.getLastRow() < 2) return [];
  var datos  = hoja.getRange(2, 1, hoja.getLastRow() - 1, 15).getValues();
  var result = [];
  datos.forEach(function(r) {
    if (!r[0]) return;
    result.push({
      codigoEvento: String(r[0]).trim(), semana:     _normFechaAStr(r[1]),
      anio:         String(r[2]).trim(), fechaEvento:_normFechaAStr(r[3]),
      centro:       String(r[4]).trim(), novios:     String(r[5]).trim(),
      trabajador:   String(r[6]).trim(), cargo:      String(r[7]).trim(),
      nombreBono:   String(r[8]).trim(), criterio:   String(r[9]).trim(),
      cumplido:     parseInt(r[10]) || 0, resultado: String(r[11]).trim(),
      fuente:       String(r[12]).trim(), extra:     String(r[13]).trim(),
      timestamp:    r[14]
    });
  });
  return result;
}


function _buildKeySet(hoja, col1, col2) {
  var set = {};
  if (!hoja || hoja.getLastRow() < 2) return set;
  var datos = hoja.getDataRange().getValues();
  var start = (datos.length > 0 && String(datos[0][col1]).toLowerCase().indexOf('código') !== -1) ? 1 : 0;
  for (var i = start; i < datos.length; i++) {
    var k = String(datos[i][col1]).trim() + '|||' + String(datos[i][col2]).trim();
    if (k !== '|||') set[k] = true;
  }
  return set;
}

function _writeHeader(hoja, headers) {
  hoja.getRange(1, 1, 1, headers.length).setValues([headers])
    .setFontWeight('bold').setFontColor('white').setBackground('#1a1a2e')
    .setFontFamily('Calibri').setFontSize(10);
  hoja.setFrozenRows(1);
}

function _getOrCreate(ss, nombre) {
  var h = ss.getSheetByName(nombre);
  if (!h) h = ss.insertSheet(nombre);
  return h;
}

function _colIdx(headers, name, fallback) {
  var nl = name.toLowerCase();
  for (var i = 0; i < headers.length; i++) {
    if (String(headers[i]).toLowerCase().indexOf(nl) !== -1) return i;
  }
  return fallback;
}

// Extrae el año (int) de un valor fecha: Date, "DD/MM/YYYY", "D/M/YYYY",
// "YYYY-MM-DD", "DD-MM-YYYY". Retorna 0 si no puede parsear.
function _extraerAnio(fecha) {
  if (!fecha) return 0;
  if (fecha instanceof Date) return fecha.getFullYear();
  var s = String(fecha).trim();
  var m1 = s.match(/^(\d{4})-(\d{2})-(\d{2})/);  if (m1) return parseInt(m1[1]);
  var m2 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); if (m2) return parseInt(m2[3]);
  var m3 = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);   if (m3) return parseInt(m3[3]);
  return 0;
}

// Normaliza cualquier valor fecha a la cadena "DD/MM/YYYY".
// Acepta: Date, "YYYY-MM-DD", "D/M/YYYY", "DD/MM/YYYY", "DD-MM-YYYY".
function _normFechaAStr(fecha) {
  if (!fecha) return '';
  var d;
  if (fecha instanceof Date) {
    d = fecha;
  } else {
    var s  = String(fecha).trim();
    var m1 = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m1) { d = new Date(parseInt(m1[1]), parseInt(m1[2]) - 1, parseInt(m1[3])); }
    else {
      var m2 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (m2) { d = new Date(parseInt(m2[3]), parseInt(m2[2]) - 1, parseInt(m2[1])); }
      else {
        var m3 = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
        if (m3) { d = new Date(parseInt(m3[3]), parseInt(m3[2]) - 1, parseInt(m3[1])); }
        else {
          // Fallback: intentar con Date constructor (maneja Date.toString() y otros formatos)
          var dt = new Date(s);
          if (!isNaN(dt.getTime())) { d = dt; }
          else { return s; }
        }
      }
    }
  }
  return ('0' + d.getDate()).slice(-2) + '/' +
         ('0' + (d.getMonth() + 1)).slice(-2) + '/' + d.getFullYear();
}

// Retorna el lunes de la semana de la fecha dada, como "DD/MM/YYYY".
function _getSemanaStr(fecha) {
  var d;
  if (fecha instanceof Date) {
    d = new Date(fecha);
  } else {
    var s  = String(fecha).trim();
    var m1 = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m1) { d = new Date(parseInt(m1[1]), parseInt(m1[2]) - 1, parseInt(m1[3])); }
    else {
      var m2 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (m2) { d = new Date(parseInt(m2[3]), parseInt(m2[2]) - 1, parseInt(m2[1])); }
      else {
        var m3 = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
        if (m3) { d = new Date(parseInt(m3[3]), parseInt(m3[2]) - 1, parseInt(m3[1])); }
        else     { return String(fecha); }
      }
    }
  }
  // Ajustar al lunes de la semana (0=Dom -> retrocede 6, otros -> retrocede (day-1))
  var day  = d.getDay();
  var diff = (day === 0) ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return ('0' + d.getDate()).slice(-2) + '/' +
         ('0' + (d.getMonth() + 1)).slice(-2) + '/' + d.getFullYear();
}
