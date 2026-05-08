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
  FUENTE_VAJILLA:      'Fuente_Vajilla',
  BASE_CRITERIOS:      'Base_Criterios',
  RESUMEN_SEMANA:      'Resumen_Semana',
  RESUMEN_FINANZAS:    'Resumen_Finanzas',
  MAESTRO_BONOS:       'Maestro_Bonos',
  OVERRIDES_BONOS:     'Overrides_Bonos'
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

// Lee Maestro_Bonos incluyendo col R (Cargos Aplicables). Retorna:
//   bonoInfo: { nombreBono -> { cargoBase, tipoBono, sistema, monto, cargosAplicables: [] } }
//   cargoToBono: { sistema -> { cargoAplicable -> nombreBono } }
// Si col R (Cargos Aplicables) está vacía, se usa col A (Cargo) como único aplicable (1:1).
// Si col R lista varios cargos separados por coma, todos mapean al mismo nombreBono consolidado.
// _cargarBonosInfo retorna:
//   bonoInfo: { nombreBono -> { cargoBase, tipoBono, sistema, monto, cargosAplicables, canal } }
//   cargoToBono: { canal -> { cargoApp -> nombreBono } }
// CANAL es la dimensión de evaluación (no el "sistema"): Fotos, Supervisoras, CG, Vajilla.
// Se separa Vajilla del resto de CG porque ambos coexisten en sistema=CG del Maestro
// pero tienen fuentes distintas (Fuente_CG vs Fuente_Vajilla) y en un mismo cargo
// (ej: Super metre) existen 2 bonos — uno Control Gestión, otro Vajilla.
function _cargarBonosInfo() {
  var bonoInfo = {};
  var cargoToBono = { 'Fotos': {}, 'CG': {}, 'Supervisoras': {}, 'Vajilla': {} };
  try {
    var ss = SpreadsheetApp.openById(ID_SHEET_CENTRALIZADO);
    var h  = ss.getSheetByName('Maestro_Bonos');
    if (!h || h.getLastRow() < 2) return { bonoInfo: bonoInfo, cargoToBono: cargoToBono };
    var data = h.getRange(2, 1, h.getLastRow() - 1, 18).getValues();
    for (var i = 0; i < data.length; i++) {
      var cargoBase = String(data[i][0]).trim();
      var tipo      = String(data[i][1]).trim();
      var monto     = Number(data[i][2]) || 0;
      var sistema   = String(data[i][3]).trim();
      var aplStr    = String(data[i][17] || '').trim();
      if (!cargoBase || !tipo || !sistema) continue;
      var aplicables = aplStr ? aplStr.split(',').map(function(s){ return s.trim(); }).filter(function(s){return s;}) : [cargoBase];
      var nombreBono = 'Bono ' + tipo + ' ' + cargoBase;
      // Canal: Vajilla se separa dentro del sistema CG
      var canal = sistema;
      if (sistema === 'CG' && tipo === 'Vajilla') canal = 'Vajilla';
      bonoInfo[nombreBono] = {
        cargoBase:         cargoBase,
        tipoBono:          tipo,
        sistema:           sistema,
        canal:             canal,
        monto:             monto,
        cargosAplicables:  aplicables
      };
      if (!cargoToBono[canal]) cargoToBono[canal] = {};
      // El cargoBase siempre mapea al bono (soporta flujo nuevo donde CG guarda
      // directamente con cargo="Garzones"/"Barmans" en vez de los cargos individuales).
      cargoToBono[canal][cargoBase] = nombreBono;
      aplicables.forEach(function(cargoApp) {
        cargoToBono[canal][cargoApp] = nombreBono;
      });
    }
  } catch(e) { Logger.log('_cargarBonosInfo error: ' + e); }
  return { bonoInfo: bonoInfo, cargoToBono: cargoToBono };
}

// Aliases para cargos legacy en Dashboard de Bonos (datos escritos antes de v33)
var CARGO_ALIASES = {
  'Encargado Novios':              'Asignación Encargados Novios',
  'Asignacion Encargados Novios':  'Asignación Encargados Novios',
  'Encargada Deco':                'Jefa de Floristas',
  'Jefa de Decoración':            'Jefa de Floristas'   // solo para Supervisoras; Fotos/CG mantienen Jefa de Decoración
};

function _normCargo(cargo, sistema) {
  var c = String(cargo).trim();
  // Solo aplicar alias Deco→Floristas para Supervisoras (Fotos y CG mantienen Jefa de Decoración)
  if (sistema && sistema !== 'Supervisoras' && sistema !== 'Fuente_Supervisoras') {
    if (c === 'Encargado Novios' || c === 'Asignacion Encargados Novios') {
      return 'Asignación Encargados Novios';
    }
    return c;
  }
  return CARGO_ALIASES[c] || c;
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

// ==================================================================
// HTTP ENDPOINTS (Web App)
// ------------------------------------------------------------------
// Routing:
//   GET sin ?action=  → WebApp legacy (mantiene compatibilidad con
//                        usuarios que acceden por la URL actual)
//   GET con ?action=X → JSON: ejecuta la query y devuelve resultado
//   POST con body JSON {action: X, ...} → JSON: ejecuta la mutación
//
// El WebApp legacy (WebApp.html) sigue funcional. El frontend nuevo
// en Cloudflare Pages usa solamente las rutas con ?action= y POST.
// ==================================================================

function _jsonOk(data) {
  var payload = (data && typeof data === 'object') ? data : { data: data };
  if (payload.ok === undefined) payload.ok = true;
  return ContentService.createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function _jsonErr(msg, extra) {
  var payload = Object.assign({ ok: false, msg: String(msg || 'error') }, extra || {});
  return ContentService.createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || '';

  // Sin action → WebApp legacy (compat con la URL pública actual)
  if (!action) {
    return HtmlService.createHtmlOutputFromFile('WebApp')
      .setTitle('Sistema Bonos -- Tinto')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }

  try {
    var p = e.parameter || {};
    switch (action) {
      // -- Lectura básica del dashboard --
      case 'getWebAppData':            return _jsonOk(getWebAppData());
      case 'getDatosSemana':           return _jsonOk(getDatosSemana(p.semana));
      case 'getDetalleCriteriosSemana': return _jsonOk(getDetalleCriteriosSemana(p.semana));
      case 'getDatosCargo':            return _jsonOk(getDatosCargo(p.cargo));
      case 'getDatosPersona':          return _jsonOk(getDatosPersona(p.persona));
      case 'getEventosCRMPorSemana':   return _jsonOk(getEventosCRMPorSemana(p.semana));
      case 'getDatosSemanaConCRM':     return _jsonOk(getDatosSemanaConCRM(p.semana));

      // -- Maestros y tarifas --
      case 'getMaestroBonos':          return _jsonOk(getMaestroBonos());
      case 'getMaestroCriterios':      return _jsonOk(getMaestroCriterios());
      case 'getTarifas2026':           return _jsonOk(getTarifas2026());

      // -- Modales (trabajadores, fotos, override) --
      case 'getTrabajadoresDelBono':   return _jsonOk(getTrabajadoresDelBono(p.codigo, p.nombreBono));
      case 'getFotosDeEvento':         return _jsonOk(getFotosDeEvento(p.codigo, p.cargo));
      case 'getOverrideBono':          return _jsonOk(getOverrideBono(p.codigo, p.nombreBono));

      // -- Paso 4-5 (preview, no escribe) --
      case 'previewBonosParaPlanillaMaestra':
        return _jsonOk(previewBonosParaPlanillaMaestra(p.codigo));
      case 'previewBonosTodosLosEventos':
        return _jsonOk(previewBonosTodosLosEventos(_parseList(p.codigos)));

      // -- Mail bonos (preview) --
      case 'getMailPreviewSemana':     return _jsonOk(getMailPreviewSemana(p.semana));

      default:
        return _jsonErr('Acción GET desconocida: ' + action);
    }
  } catch (err) {
    Logger.log('doGet error: ' + err);
    return _jsonErr(err.toString());
  }
}

function doPost(e) {
  try {
    var raw  = (e && e.postData && e.postData.contents) || '{}';
    var body = JSON.parse(raw);
    var action = body.action || '';
    if (!action) return _jsonErr('Falta action en body POST');

    // El frontend (CF Pages tras Cloudflare Access) inyecta el email del
    // usuario autenticado para trazabilidad. Lo guardamos como propiedad
    // temporal para que las funciones que registran "Autor" lo usen.
    if (body.userEmail) {
      try { PropertiesService.getScriptProperties().setProperty('_currentActor', String(body.userEmail).trim()); } catch(_){}
    }

    switch (action) {
      // -- Sync orquestación --
      case 'sincronizar':              return _jsonOk(sincronizarDesdeWebApp());

      // -- Overrides de bono --
      case 'setOverrideBono':
        return _jsonOk(setOverrideBono(body.codigo, body.nombreBono, body.override, body.razon));
      case 'deleteOverrideBono':
        return _jsonOk(deleteOverrideBono(body.codigo, body.nombreBono));

      // -- Paso 4-5 (escritura a Planilla Maestra) --
      case 'escribirBonosEnPlanillaMaestra':
        return _jsonOk(escribirBonosEnPlanillaMaestra(body.codigo));
      case 'escribirBonosMultipleEventos':
        return _jsonOk(escribirBonosMultipleEventos(body.codigos || []));

      // -- Mail bonos (envío) --
      case 'enviarMailsBonos':
        return _jsonOk(enviarMailsBonos(body.semana, body.lista || []));
      case 'enviarMailPruebaBonos':
        return _jsonOk(enviarMailPruebaBonos(body.destinatario));

      // -- Edición de Maestros y Tarifas --
      case 'saveMaestroBonos':         return _jsonOk(saveMaestroBonos(body.items || []));
      case 'saveMaestroCriterios':     return _jsonOk(saveMaestroCriterios(body.items || []));
      case 'saveTarifas2026':          return _jsonOk(saveTarifas2026(body.cambios || []));

      default:
        return _jsonErr('Acción POST desconocida: ' + action);
    }
  } catch (err) {
    Logger.log('doPost error: ' + err);
    return _jsonErr(err.toString());
  }
}

// Helper: parsea un parámetro de query que puede venir como JSON (?codigos=["a","b"])
// o como CSV (?codigos=a,b). Retorna array de strings limpios.
function _parseList(raw) {
  if (!raw) return [];
  var s = String(raw).trim();
  if (s.charAt(0) === '[') {
    try { return JSON.parse(s); } catch(e) { /* fallthrough */ }
  }
  return s.split(',').map(function(x) { return x.trim(); }).filter(function(x) { return x; });
}

function abrirWebapp() {
  var html = HtmlService.createHtmlOutputFromFile('WebApp').setWidth(1200).setHeight(720);
  SpreadsheetApp.getUi().showModalDialog(html, 'Sistema Bonos');
}

function soloSyncFotos()        { var n = syncFotos();        SpreadsheetApp.getUi().alert('Fotos: '        + n + ' nuevos registros.'); }
function soloSyncCG()           { var n = syncCG();           SpreadsheetApp.getUi().alert('CG: '           + n + ' nuevos registros.'); }
function soloSyncSupervisoras() { var n = syncSupervisoras(); SpreadsheetApp.getUi().alert('Supervisoras: ' + n + ' nuevos registros.'); }

// ==================================================================
// MAIL — BONOS
// Envío con GmailApp.sendEmail desde alias bonos@tintobanqueteria.cl.
// Requiere que el alias esté configurado en Gmail del USER_DEPLOYING
// (Configuración → Cuentas e importación → Enviar mensaje como).
// ==================================================================

var MAIL_FROM_ALIAS = 'bonos@tintobanqueteria.cl';
var MAIL_FROM_NAME  = 'Bonos Tinto Banquetería';

// ── Tracking de mails enviados ─────────────────────────────────────────
var HOJA_MAILS_ENVIADOS = 'Mails_Enviados';
var MAILS_HDR = ['Trabajador','Trabajador (norm)','Email','Semana',
                 'Monto Total','Bonos Ganados','Bonos No Ganados',
                 'Fecha Envío','Autor'];

function _ensureMailsEnviadosSheet() {
  var ss = SpreadsheetApp.openById(ID_SHEET_CENTRALIZADO);
  var h = ss.getSheetByName(HOJA_MAILS_ENVIADOS);
  if (!h) {
    h = ss.insertSheet(HOJA_MAILS_ENVIADOS);
    _writeHeader(h, MAILS_HDR);
  } else if (h.getLastRow() === 0) {
    _writeHeader(h, MAILS_HDR);
  }
  return h;
}

// Map: trabajadorNorm -> { nombre, email, monto, ganados, noGanados, fecha, autor }
function _leerMailsEnviados(semana) {
  var map = {};
  try {
    var ss = SpreadsheetApp.openById(ID_SHEET_CENTRALIZADO);
    var h = ss.getSheetByName(HOJA_MAILS_ENVIADOS);
    if (!h || h.getLastRow() < 2) return map;
    var data = h.getRange(2, 1, h.getLastRow() - 1, 9).getValues();
    data.forEach(function(r) {
      var rowSemana = String(r[3]).trim();
      if (rowSemana !== String(semana).trim()) return;
      var trabNorm = String(r[1]).trim();
      if (!trabNorm) return;
      map[trabNorm] = {
        nombre:    String(r[0]).trim(),
        email:     String(r[2]).trim(),
        monto:     Number(r[4]) || 0,
        ganados:   Number(r[5]) || 0,
        noGanados: Number(r[6]) || 0,
        fecha:     r[7] instanceof Date
                     ? Utilities.formatDate(r[7], 'America/Santiago', 'dd/MM/yyyy HH:mm')
                     : String(r[7] || '').trim(),
        autor:     String(r[8] || '').trim()
      };
    });
  } catch(e) { Logger.log('_leerMailsEnviados error: ' + e); }
  return map;
}

function _registrarMailEnviado(t, semana, autor) {
  try {
    var h = _ensureMailsEnviadosSheet();
    var fechaStr = Utilities.formatDate(new Date(), 'America/Santiago', 'dd/MM/yyyy HH:mm');
    var row = [
      t.nombre, t.nombreNorm, t.email, semana,
      t.totalMonto, t.ganados, t.noGanados,
      fechaStr, autor || ''
    ];
    // Upsert por (trabajadorNorm, semana)
    var found = -1;
    if (h.getLastRow() >= 2) {
      var data = h.getRange(2, 2, h.getLastRow() - 1, 3).getValues(); // B (norm), C (email), D (semana)
      for (var i = 0; i < data.length; i++) {
        if (String(data[i][0]).trim() === t.nombreNorm && String(data[i][2]).trim() === semana) {
          found = i + 2; break;
        }
      }
    }
    if (found > 0) h.getRange(found, 1, 1, 9).setValues([row]);
    else            h.getRange(h.getLastRow() + 1, 1, 1, 9).setValues([row]);
  } catch(e) { Logger.log('_registrarMailEnviado error: ' + e); }
}

// Lee tab "Inscripcion" del Maestro de Trabajadores y retorna un map
//   nombreNormalizado -> { nombre: ..., email: ... }
// Col B = Nombre y Apellido, Col F = Correo Electrónico.
function _leerEmailsMaestro() {
  var map = {};
  try {
    var ss = SpreadsheetApp.openById(ID_SHEET_MAESTRO);
    var h = ss.getSheetByName('Inscripcion');
    if (!h || h.getLastRow() < 2) return map;
    var data = h.getRange(2, 2, h.getLastRow() - 1, 5).getValues(); // cols B..F
    for (var i = 0; i < data.length; i++) {
      var nombre = String(data[i][0] || '').trim();          // col B
      var email  = String(data[i][4] || '').trim();          // col F
      if (!nombre) continue;
      var key = _normalizarNombre(nombre);
      if (!map[key]) map[key] = { nombre: nombre, email: email };
      else if (!map[key].email && email) map[key].email = email;
    }
  } catch(e) { Logger.log('_leerEmailsMaestro error: ' + e); }
  return map;
}

// Lee Resumen_Finanzas y retorna TODOS los bonos del evento (ganados y no ganados).
// Estructura: [{ nombreBono, cargoBase, cumplido, monto, fuente }]
function _leerBonosCompletosDeEvento(codigoEvento) {
  try {
    var sh = SpreadsheetApp.openById(ID_SHEET_CENTRALIZADO).getSheetByName(HOJAS.RESUMEN_FINANZAS);
    if (!sh || sh.getLastRow() < 2) return [];
    var data = sh.getRange(2, 1, sh.getLastRow() - 1, 12).getValues();
    var code = String(codigoEvento).trim();
    var out = [];
    data.forEach(function(r) {
      if (String(r[1]).trim() !== code) return;
      var gana = String(r[9]).trim() === 'SI';
      out.push({
        nombreBono: String(r[6] || '').trim(),
        cargoBase:  String(r[5] || '').trim(),
        cumplido:   gana,
        monto:      gana ? (Number(r[10]) || 0) : 0,
        fuente:     String(r[7] || '').trim()
      });
    });
    return out;
  } catch(e) { Logger.log('_leerBonosCompletosDeEvento error: ' + e); return []; }
}

// Para un (codigoEvento, nombreBono) retorna { cumplidos: [], fallados: [] }
// con los nombres de criterios. Usa el detalle de getDetalleCriteriosSemana
// que ya viene cacheado a nivel de invocación de getMailPreviewSemana.
function _criteriosDelBonoEnEvento(codigoEvento, nombreBono, detalle, bonosInfo) {
  var meta = bonosInfo.bonoInfo[nombreBono];
  if (!meta) return { cumplidos: [], fallados: [] };
  var sistema = meta.sistema;
  var cargoBase = meta.cargoBase;
  var cumplidos = [], fallados = [];

  function isInactive(v) {
    return !v || /^[-—\s]*$/.test(String(v).trim());
  }

  if (sistema === 'Fotos') {
    var cfg = (detalle.criteriosConfig.Fotos || {})[cargoBase] || {};
    var names = cfg.criterioNames || [];
    // En bonos Fotos el match es 1:1 (cargoBase = cargoAplicable)
    var match = (detalle.fotos || []).find(function(r) {
      return r.codigoEvento === codigoEvento && r.cargo === cargoBase;
    });
    if (!match) return { cumplidos: cumplidos, fallados: fallados };
    var resp = match.respValues || [];
    for (var i = 0; i < resp.length; i++) {
      if (isInactive(resp[i])) continue;
      var crName = names[i] || ('Resp ' + (i + 1));
      var isSi = String(resp[i]).trim().toUpperCase() === 'SI' || resp[i] === '1';
      if (isSi) cumplidos.push(crName); else fallados.push(crName);
    }
  } else if (sistema === 'CG') {
    if (meta.tipoBono === 'Vajilla') {
      // Vajilla: criterio único basado en merma. Buscar Fuente_Vajilla.
      var ssV = SpreadsheetApp.openById(ID_SHEET_CENTRALIZADO).getSheetByName(HOJAS.FUENTE_VAJILLA);
      if (ssV && ssV.getLastRow() > 1) {
        var vajData = ssV.getRange(2, 1, ssV.getLastRow() - 1, 11).getValues();
        var v = vajData.find(function(r) { return String(r[2]).trim() === codigoEvento && String(r[7]).trim() === cargoBase; });
        if (v) {
          var inv = Number(v[4]) || 0;
          var permitida = Number(v[5]) || 0;
          var factura = Number(v[6]) || 0;
          var gano = String(v[9]).trim().toUpperCase() === 'SI';
          var txt = 'Pérdida de vajilla: $' + factura + ' (límite $' + permitida + ' para ' + inv + ' invitados)';
          if (gano) cumplidos.push(txt); else fallados.push(txt);
        }
      }
    } else {
      // CG normal: criterios SI/NO/--. Bonos consolidados (Garzones, Barmans) pueden tener
      // múltiples filas de Fuente_CG (1 por cargo aplicable). Aplicamos AND visualmente:
      // un criterio cuenta como cumplido si TODOS los cargos lo cumplieron.
      var cfgCG = (detalle.criteriosConfig.CG || {})[cargoBase] || {};
      var namesCG = cfgCG.criterioNames || [];
      // Filas de Fuente_CG que aportan a este bono: cualquier cargo aplicable
      var aplSet = {};
      meta.cargosAplicables.forEach(function(c) { aplSet[_normalizarCargo(c)] = true; });
      var matches = (detalle.cg || []).filter(function(r) {
        return r.codigoEvento === codigoEvento && aplSet[_normalizarCargo(r.cargo)];
      });
      if (matches.length === 0) return { cumplidos: cumplidos, fallados: fallados };
      // Por criterio (idx i): si todas las filas dicen SI → cumplido. Si alguna NO → fallado.
      // Si alguna fila no tiene el criterio o es '--' → considerar como inactivo.
      var maxLen = 10;
      for (var ci = 0; ci < maxLen; ci++) {
        var anyActive = false, allSi = true;
        matches.forEach(function(m) {
          var v = (m.criterioValues || [])[ci];
          if (isInactive(v)) return;
          anyActive = true;
          var isSi = String(v).trim().toUpperCase() === 'SI' || v === '1';
          if (!isSi) allSi = false;
        });
        if (!anyActive) continue;
        var crName = namesCG[ci] || ('Criterio ' + (ci + 1));
        if (allSi) cumplidos.push(crName); else fallados.push(crName);
      }
    }
  } else if (sistema === 'Supervisoras') {
    var cfgSup = (detalle.criteriosConfig.Supervisoras || {})[cargoBase] || {};
    var namesSup = cfgSup.criterioNames || [];
    // Supervisoras puede tener múltiples filas para bonos consolidados (AEN: 2 trabajadores).
    // AND: criterio cumplido si todos lo cumplieron.
    var aplSetSup = {};
    meta.cargosAplicables.forEach(function(c) { aplSetSup[_normalizarCargo(c)] = true; });
    var matchesSup = (detalle.supervisoras || []).filter(function(r) {
      return r.codigoEvento === codigoEvento && aplSetSup[_normalizarCargo(r.cargo)];
    });
    if (matchesSup.length === 0) return { cumplidos: cumplidos, fallados: fallados };
    var maxLenSup = 10;
    for (var si = 0; si < maxLenSup; si++) {
      var anyActiveS = false, allSiS = true;
      matchesSup.forEach(function(m) {
        var v = (m.criterioValues || [])[si];
        if (isInactive(v)) return;
        anyActiveS = true;
        var isSi = String(v).trim().toUpperCase() === 'SI' || v === '1';
        if (!isSi) allSiS = false;
      });
      if (!anyActiveS) continue;
      var crName = namesSup[si] || ('Criterio ' + (si + 1));
      if (allSiS) cumplidos.push(crName); else fallados.push(crName);
    }
  }

  return { cumplidos: cumplidos, fallados: fallados };
}

// ==================================================================
// MAIL BONOS — preview + envío masivo
// ==================================================================

// Genera el preview de mails para una semana. Cruza:
//   - Eventos de la semana (de Base_Criterios)
//   - Trabajadores de cada evento (Planilla Maestra > Registro fuente=Evento)
//   - Bonos del evento (Resumen_Finanzas)
//   - Cargos aplicables (Maestro_Bonos)
//   - Criterios cumplidos/fallados por bono (Fuente_*)
//   - Email del trabajador (Maestro Inscripcion)
function getMailPreviewSemana(semana) {
  try {
    var datosSemana = getDatosSemana(semana);
    if (!datosSemana || !datosSemana.ok) return { ok: false, msg: 'No hay datos de la semana ' + semana };

    // Códigos de evento únicos en la semana
    var codigosSet = {};
    var grupos = datosSemana.grupos || {};
    Object.keys(grupos).forEach(function(cargo) {
      grupos[cargo].forEach(function(ev) { if (ev.codigo) codigosSet[ev.codigo] = true; });
    });
    var codigos = Object.keys(codigosSet);
    if (codigos.length === 0) return { ok: true, semana: semana, trabajadores: [], sinEmail: [], totalGlobal: 0, totalEmails: 0 };

    // Cargas globales
    var detalle    = getDetalleCriteriosSemana(semana);
    var bonosInfo  = _cargarBonosInfo();
    var emails     = _leerEmailsMaestro();
    var enviados   = _leerMailsEnviados(semana);

    // Datos por evento
    var bonosPorEvento = {};
    var trabsPorEvento = {};
    var infoEvento     = {};
    codigos.forEach(function(codigo) {
      bonosPorEvento[codigo] = _leerBonosCompletosDeEvento(codigo);
      trabsPorEvento[codigo] = _leerTrabajadoresAprobadosDeEvento(codigo);
      var info = _leerInfoEvento(codigo);
      infoEvento[codigo] = {
        codigo: codigo,
        lugar:  info ? info.lugar : '',
        fecha:  info ? formatFechaCL_(info.fecha) : ''
      };
    });

    // Construir mails por trabajador
    var porTrabajador = {};
    codigos.forEach(function(codigo) {
      var bonosEv = bonosPorEvento[codigo];
      (trabsPorEvento[codigo] || []).forEach(function(trab) {
        var key = _normalizarNombre(trab.nombre);
        var cargoNorm = _normalizarCargo(trab.cargo);
        if (!cargoNorm) return;

        // Bonos cuyo cargosAplicables incluye el cargo del trabajador
        var bonosDelTrab = [];
        bonosEv.forEach(function(b) {
          var meta = bonosInfo.bonoInfo[b.nombreBono];
          if (!meta) return;
          var aplicable = meta.cargosAplicables.some(function(c) { return _normalizarCargo(c) === cargoNorm; });
          if (!aplicable) return;

          var crits = _criteriosDelBonoEnEvento(codigo, b.nombreBono, detalle, bonosInfo);
          bonosDelTrab.push({
            nombreBono: b.nombreBono,
            tipoBono:   meta.tipoBono,
            cumplido:   b.cumplido,
            monto:      b.monto,
            cumplidos:  crits.cumplidos,
            fallados:   crits.fallados
          });
        });

        if (bonosDelTrab.length === 0) return; // trabajador sin bonos aplicables → no le mandamos mail

        if (!porTrabajador[key]) {
          var info = emails[key] || {};
          porTrabajador[key] = {
            nombre:       trab.nombre,
            nombreNorm:   key,
            email:        info.email || '',
            eventos:      [],
            totalMonto:   0,
            ganados:      0,
            noGanados:    0,
            yaEnviado:    enviados[key] || null
          };
        }

        var subtotal = 0;
        bonosDelTrab.forEach(function(b) { subtotal += b.monto; });
        var nGanados = bonosDelTrab.filter(function(b) { return b.cumplido; }).length;

        porTrabajador[key].eventos.push({
          codigo:   codigo,
          lugar:    infoEvento[codigo].lugar,
          fecha:    infoEvento[codigo].fecha,
          cargo:    trab.cargo,
          bonos:    bonosDelTrab,
          subtotal: subtotal
        });
        porTrabajador[key].totalMonto += subtotal;
        porTrabajador[key].ganados    += nGanados;
        porTrabajador[key].noGanados  += bonosDelTrab.length - nGanados;
      });
    });

    var lista     = Object.values(porTrabajador);
    var sinEmail  = lista.filter(function(t) { return !t.email; });
    var conEmail  = lista.filter(function(t) { return  t.email; });
    var totalGlobal = lista.reduce(function(s, t) { return s + t.totalMonto; }, 0);

    // Ordenar alfabéticamente
    conEmail.sort(function(a, b) { return a.nombre.localeCompare(b.nombre); });
    sinEmail.sort(function(a, b) { return a.nombre.localeCompare(b.nombre); });

    return {
      ok:           true,
      semana:       semana,
      trabajadores: conEmail,
      sinEmail:     sinEmail,
      totalEmails:  conEmail.length,
      totalGlobal:  totalGlobal
    };
  } catch(e) { Logger.log('getMailPreviewSemana error: ' + e); return { ok: false, msg: e.toString() }; }
}

// Construye HTML del mail para un trabajador.
function _armarHtmlMailBonos(trab, semana) {
  var fmt = function(n) { return _fmtMonto_(n); };
  var html = ''
    + '<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#222;background:#fafaf7;">'
    + '<h2 style="color:#7a1c1c;margin:0 0 8px;">Resumen de bonos</h2>'
    + '<p style="color:#666;margin:0 0 16px;font-size:13px;">Semana operativa: ' + esc_(semana) + '</p>'
    + '<p>Hola <b>' + esc_(trab.nombre) + '</b>,</p>'
    + '<p>Te enviamos el detalle de los bonos correspondientes a tu trabajo del fin de semana.</p>'
    + '<div style="background:#e8f5e9;border-left:4px solid #2e7d5a;padding:14px 16px;margin:18px 0;border-radius:4px;">'
    + '<div style="color:#1e5534;font-size:13px;">Total a recibir esta semana</div>'
    + '<div style="color:#2e7d5a;font-size:22px;font-weight:700;">$' + fmt(trab.totalMonto) + '</div>'
    + '<div style="color:#5a6e62;font-size:12px;margin-top:4px;">' + trab.ganados + ' bono(s) ganado(s)' + (trab.noGanados ? ' · ' + trab.noGanados + ' no ganado(s)' : '') + '</div>'
    + '</div>';

  trab.eventos.forEach(function(ev) {
    html += '<div style="border:1px solid #e0d8c8;border-radius:6px;padding:14px;margin:14px 0;background:#fff;">';
    html += '<h3 style="margin:0 0 4px;color:#1a1a2e;font-size:15px;">' + esc_(ev.lugar) + '</h3>';
    html += '<div style="color:#888;font-size:12px;margin-bottom:10px;">' + esc_(ev.fecha) + ' · Cargo: <b style="color:#5a4a30;">' + esc_(ev.cargo) + '</b></div>';

    var ganados = ev.bonos.filter(function(b) { return b.cumplido; });
    var perdidos = ev.bonos.filter(function(b) { return !b.cumplido; });

    if (ganados.length) {
      html += '<div style="color:#2e7d5a;font-weight:700;margin:10px 0 6px;font-size:13px;">✅ Bonos ganados ($' + fmt(ev.subtotal) + ')</div>';
      ganados.forEach(function(b) {
        html += '<div style="border-left:3px solid #4caf8a;padding:8px 12px;background:#f5fff8;margin:6px 0;border-radius:3px;">';
        html += '<div style="font-weight:600;color:#1e5534;font-size:13px;">' + esc_(b.nombreBono) + ' — <span style="color:#2e7d5a;">$' + fmt(b.monto) + '</span></div>';
        if (b.cumplidos.length) {
          html += '<ul style="margin:6px 0 0;padding-left:20px;color:#3a5a40;font-size:12px;">';
          b.cumplidos.forEach(function(c) { html += '<li>' + esc_(c) + '</li>'; });
          html += '</ul>';
        }
        html += '</div>';
      });
    }

    if (perdidos.length) {
      html += '<div style="color:#a04040;font-weight:700;margin:10px 0 6px;font-size:13px;">❌ Bonos no ganados</div>';
      perdidos.forEach(function(b) {
        html += '<div style="border-left:3px solid #e05a6a;padding:8px 12px;background:#fff5f5;margin:6px 0;border-radius:3px;">';
        html += '<div style="font-weight:600;color:#7a2020;font-size:13px;">' + esc_(b.nombreBono) + '</div>';
        if (b.fallados.length) {
          html += '<div style="color:#7a2020;font-size:12px;margin-top:4px;">Criterios no cumplidos:</div>';
          html += '<ul style="margin:4px 0 0;padding-left:20px;color:#7a2020;font-size:12px;">';
          b.fallados.forEach(function(c) { html += '<li>' + esc_(c) + '</li>'; });
          html += '</ul>';
        }
        if (b.cumplidos.length) {
          html += '<div style="color:#5a6e62;font-size:11px;margin-top:6px;font-style:italic;">Criterios cumplidos: ' + b.cumplidos.length + '</div>';
        }
        html += '</div>';
      });
    }

    html += '</div>';
  });

  html += '<p style="color:#888;font-size:11px;border-top:1px solid #ddd;padding-top:12px;margin-top:24px;text-align:center;">'
        + 'Tinto Banquetería · Sistema de Bonos<br>'
        + 'Si tienes consultas sobre estos resultados, responde este correo.'
        + '</p></div>';
  return html;
}

function _armarTextoMailBonos(trab, semana) {
  var fmt = function(n) { return _fmtMonto_(n); };
  var t = 'Resumen de bonos — Semana ' + semana + '\n\n'
        + 'Hola ' + trab.nombre + ',\n\n'
        + 'Total a recibir esta semana: $' + fmt(trab.totalMonto) + '\n'
        + '(' + trab.ganados + ' bono(s) ganado(s)' + (trab.noGanados ? ', ' + trab.noGanados + ' no ganado(s)' : '') + ')\n\n';
  trab.eventos.forEach(function(ev) {
    t += '─────────────────\n';
    t += ev.lugar + ' · ' + ev.fecha + '\nCargo: ' + ev.cargo + '\n\n';
    var ganados = ev.bonos.filter(function(b) { return b.cumplido; });
    var perdidos = ev.bonos.filter(function(b) { return !b.cumplido; });
    if (ganados.length) {
      t += 'Bonos ganados ($' + fmt(ev.subtotal) + '):\n';
      ganados.forEach(function(b) {
        t += '  • ' + b.nombreBono + ' — $' + fmt(b.monto) + '\n';
        b.cumplidos.forEach(function(c) { t += '      ✓ ' + c + '\n'; });
      });
    }
    if (perdidos.length) {
      t += '\nBonos no ganados:\n';
      perdidos.forEach(function(b) {
        t += '  • ' + b.nombreBono + '\n';
        b.fallados.forEach(function(c) { t += '      ✗ ' + c + '\n'; });
      });
    }
    t += '\n';
  });
  t += '\n— Tinto Banquetería\n';
  return t;
}

function esc_(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Envía mails de la semana. lista = array de nombreNorm a enviar.
// Si lista es vacía o null, envía a TODOS los que tienen email.
function enviarMailsBonos(semana, listaNombres) {
  try {
    var prev = getMailPreviewSemana(semana);
    if (!prev.ok) return prev;
    var trabs = prev.trabajadores;

    // Filtrar si se pasó lista específica
    var setNombres = null;
    if (listaNombres && listaNombres.length > 0) {
      setNombres = {};
      listaNombres.forEach(function(n) { setNombres[_normalizarNombre(n)] = true; });
      trabs = trabs.filter(function(t) { return setNombres[t.nombreNorm]; });
    }

    if (trabs.length === 0) return { ok: false, msg: 'No hay trabajadores para enviar.' };

    var asunto = 'Resumen de bonos — Tinto Banquetería';
    var enviados = [];
    var errores  = [];
    var autor = '';
    try { autor = Session.getActiveUser().getEmail() || ''; } catch(e) {}

    trabs.forEach(function(t) {
      try {
        var html = _armarHtmlMailBonos(t, semana);
        var txt  = _armarTextoMailBonos(t, semana);
        GmailApp.sendEmail(t.email, asunto, txt, {
          from:     MAIL_FROM_ALIAS,
          name:     MAIL_FROM_NAME,
          htmlBody: html
        });
        _registrarMailEnviado(t, semana, autor);
        enviados.push({ nombre: t.nombre, email: t.email, monto: t.totalMonto });
      } catch(e) {
        Logger.log('Error enviando a ' + t.email + ': ' + e);
        errores.push({ nombre: t.nombre, email: t.email, error: e.toString() });
      }
    });

    return {
      ok:        true,
      semana:    semana,
      enviados:  enviados,
      errores:   errores,
      totalEnviados: enviados.length,
      totalErrores:  errores.length
    };
  } catch(e) { Logger.log('enviarMailsBonos error: ' + e); return { ok: false, msg: e.toString() }; }
}

// Función de prueba — envía un mail simple para validar el alias.
// Llamada desde el WebApp con un botón temporal.
function enviarMailPruebaBonos(destinatario) {
  try {
    var to = String(destinatario || 'barrosvial@gmail.com').trim();
    var subject = '[Prueba] Sistema de Bonos — Tinto Banquetería';
    var fechaStr = Utilities.formatDate(new Date(), 'America/Santiago', 'dd/MM/yyyy HH:mm');
    var htmlBody = ''
      + '<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#222;">'
      + '<h2 style="color:#7a1c1c;margin:0 0 12px;">Prueba de envío — Sistema de Bonos</h2>'
      + '<p>Este es un correo de prueba enviado desde <b>' + MAIL_FROM_ALIAS + '</b> usando el alias configurado en la cuenta del sistema.</p>'
      + '<p>Si recibiste este mail correctamente, la integración con Apps Script + GmailApp está funcionando.</p>'
      + '<div style="background:#f6efe6;border-left:4px solid #c8aa6e;padding:12px;margin:16px 0;font-size:14px;color:#5a4a30;">'
      + '<b>Detalles técnicos:</b><br>'
      + 'Remitente: ' + MAIL_FROM_ALIAS + '<br>'
      + 'Destinatario: ' + to + '<br>'
      + 'Fecha envío: ' + fechaStr + '<br>'
      + 'Origen: Sistema Bonos Centralizado (Apps Script)'
      + '</div>'
      + '<p style="color:#888;font-size:12px;margin-top:24px;">Tinto Banquetería · Sistema de Bonos</p>'
      + '</div>';
    var plainBody = 'Prueba de envío — Sistema de Bonos\n\n'
      + 'Este es un correo de prueba enviado desde ' + MAIL_FROM_ALIAS + '.\n\n'
      + 'Detalles:\n'
      + '  Remitente: ' + MAIL_FROM_ALIAS + '\n'
      + '  Destinatario: ' + to + '\n'
      + '  Fecha envío: ' + fechaStr + '\n\n'
      + 'Tinto Banquetería · Sistema de Bonos';

    GmailApp.sendEmail(to, subject, plainBody, {
      from:     MAIL_FROM_ALIAS,
      name:     MAIL_FROM_NAME,
      htmlBody: htmlBody
    });

    return {
      ok:           true,
      destinatario: to,
      remitente:    MAIL_FROM_ALIAS,
      fecha:        fechaStr,
      msg:          'Mail de prueba enviado a ' + to
    };
  } catch(e) {
    Logger.log('enviarMailPruebaBonos error: ' + e);
    return { ok: false, msg: e.toString() };
  }
}

// -- ORQUESTACIÓN --------------------------------------------------

function sincronizarTodo() {
  var r = syncDatosFaltantes();
  try {
    SpreadsheetApp.getUi().alert(
      'Sincronizacion completa.\n\n' +
      'Fotos nuevos:        ' + r.fotos       + '\n' +
      'CG nuevos:           ' + r.cg          + '\n' +
      'Vajilla nuevos:      ' + r.vajilla     + '\n' +
      'Supervisoras nuevos: ' + r.supervisoras + '\n' +
      'Base_Criterios:      ' + r.base        + ' filas\n' +
      'Resumen_Finanzas:    ' + r.finanzas    + ' filas'
    );
  } catch(e) {}
  return r;
}

function soloSyncVajilla() { var n = syncVajilla(); SpreadsheetApp.getUi().alert('Vajilla: ' + n + ' nuevos registros.'); }

function reconstruirTodo() {
  var n1 = _reconstruirBase();
  _reconstruirResumen();
  var n2 = _reconstruirFinanzas();
  try { SpreadsheetApp.getUi().alert('Base: ' + n1 + ' filas reconstruidas.\nFinanzas: ' + n2 + ' filas.'); } catch(e) {}
}

function syncDatosFaltantes() {
  var nFotos = syncFotos();
  var nCG    = syncCG();
  var nVaj   = syncVajilla();
  var nSup   = syncSupervisoras();
  var nBase  = _reconstruirBase();
  _reconstruirResumen();
  var nFin   = _reconstruirFinanzas();
  return { fotos: nFotos, cg: nCG, vajilla: nVaj, supervisoras: nSup, base: nBase, finanzas: nFin };
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

// -- SYNC VAJILLA --------------------------------------------------
// Bono Vajilla (hoja del spreadsheet CG) → Fuente_Vajilla (centralizado).
// Estructura Bono Vajilla: Semana, FechaEvento, Código, Centro, InvitadosComida,
//                          MermaPermitida, FacturaMerma, Cargo, Trabajador, Gana, Timestamp
function syncVajilla() {
  var ss      = SpreadsheetApp.openById(ID_SHEET_CENTRALIZADO);
  var hFuente = _getOrCreate(ss, HOJAS.FUENTE_VAJILLA);

  var ssCG   = SpreadsheetApp.openById(ID_SHEET_CG);
  var hBono  = ssCG.getSheetByName('Bono Vajilla');
  if (!hBono || hBono.getLastRow() < 2) return 0;

  // Header si la hoja está vacía
  if (hFuente.getLastRow() === 0) {
    _writeHeader(hFuente, ['Semana','Fecha Evento','Código Evento','Centro',
      'Invitados Comida','Merma Permitida','Factura Merma',
      'Cargo','Trabajador','Gana Bono','Timestamp']);
  }

  // Clave existente: codigo|||cargo
  var yaSync = {};
  if (hFuente.getLastRow() >= 2) {
    hFuente.getRange(2, 1, hFuente.getLastRow() - 1, 8).getValues().forEach(function(r) {
      if (r[2]) yaSync[String(r[2]).trim() + '|||' + String(r[7]).trim()] = true;
    });
  }

  var datos  = hBono.getRange(2, 1, hBono.getLastRow() - 1, 11).getValues();
  var nuevas = [];
  for (var i = 0; i < datos.length; i++) {
    var r = datos[i];
    var codigo = String(r[2]).trim();
    var cargo  = String(r[7]).trim();
    if (!codigo || !cargo) continue;
    var anio = _extraerAnio(r[1]);
    if (anio < ANIO_MIN) continue;
    var key = codigo + '|||' + cargo;
    if (yaSync[key]) continue;
    nuevas.push([
      _normFechaAStr(r[0]), _normFechaAStr(r[1]), codigo, String(r[3] || ''),
      Number(r[4]) || 0, Number(r[5]) || 0, Number(r[6]) || 0,
      cargo, String(r[8] || ''), String(r[9] || '').trim(), r[10]
    ]);
    yaSync[key] = true;
  }
  if (nuevas.length > 0) {
    hFuente.getRange(hFuente.getLastRow() + 1, 1, nuevas.length, 11).setValues(nuevas);
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
// Nueva lógica (v34+): bonos consolidados por (codigo, nombreBono).
// Múltiples rows de Fuente_* (ej: 2 Encargados Novios, 3 cargos Garzones)
// colapsan a UNA fila por bono con AND estricto: todos los evaluados
// deben haber ganado para que el bono cuente como ganado.
// Trabajador se deja vacío (se resuelve on-demand desde Planilla Maestra).
function _reconstruirBase() {
  var ss    = SpreadsheetApp.openById(ID_SHEET_CENTRALIZADO);
  var hBase = _getOrCreate(ss, HOJAS.BASE_CRITERIOS);
  hBase.clearContents(); hBase.clearFormats();

  var HDR = ['Código Evento','Semana','Año','Fecha Evento','Centro','Novios',
             'Trabajador','Cargo','Nombre Bono','Criterio','Cumplido','Resultado',
             'Fuente','Extra','Timestamp'];
  _writeHeader(hBase, HDR);

  var bonos       = _cargarBonosInfo();
  var cargoToBono = bonos.cargoToBono;
  var bonoInfo    = bonos.bonoInfo;
  var overrides   = _leerOverrides();

  // grupos[codigo|||nombreBono] = { codigo, nombreBono, cargoBase, fuente,
  //   semana, anio, fecha, centro, novios, timestamp, extra, allGanaron,
  //   detalles: [{cargoRaw, trabajador, ok, pct}] }
  var grupos = {};

  function _acumular(codigo, nombreBono, ok, fuente, ctx) {
    if (!nombreBono) return;
    var k = codigo + '|||' + nombreBono;
    if (!grupos[k]) {
      var info = bonoInfo[nombreBono];
      grupos[k] = {
        codigo:      codigo,
        nombreBono:  nombreBono,
        cargoBase:   info ? info.cargoBase : ctx.cargoRaw,
        fuente:      fuente,
        semana:      ctx.semana,
        anio:        ctx.anio,
        fecha:       ctx.fecha,
        centro:      ctx.centro,
        novios:      ctx.novios || '',
        timestamp:   ctx.timestamp,
        extra:       ctx.extra || '',
        allGanaron:  true,
        detalles:    []
      };
    }
    if (!ok) grupos[k].allGanaron = false;
    grupos[k].detalles.push({
      cargoRaw:   ctx.cargoRaw,
      trabajador: ctx.trabajador || '',
      ok:         ok,
      pct:        ctx.pct
    });
  }

  // -- Fuente_Fotos --------------------------------------------------
  var hFotos = ss.getSheetByName(HOJAS.FUENTE_FOTOS);
  if (hFotos && hFotos.getLastRow() > 1) {
    hFotos.getRange(2, 1, hFotos.getLastRow() - 1, 20).getValues().forEach(function(r) {
      var codigo = String(r[0]).trim();
      if (!codigo || codigo.toLowerCase().indexOf('código') !== -1) return;
      var cargoRaw = _normCargo(String(r[6]).trim(), 'Fotos');
      var nombreBono = cargoToBono['Fotos'][cargoRaw];
      if (!nombreBono) return; // cargo sin bono Fotos registrado en Maestro
      var ok = String(r[18]).trim() === 'SI' ? 1 : 0;
      _acumular(codigo, nombreBono, ok, 'Fuente_Fotos', {
        cargoRaw:   cargoRaw,
        trabajador: String(r[5]).trim(),
        semana:     _normFechaAStr(r[1]),
        anio:       r[2],
        fecha:      _normFechaAStr(r[3]),
        centro:     r[4],
        timestamp:  r[19]
      });
    });
  }

  // -- Fuente_CG (solo Control Gestión, excluye Vajilla) -------------
  var hCG = ss.getSheetByName(HOJAS.FUENTE_CG);
  if (hCG && hCG.getLastRow() > 1) {
    hCG.getRange(2, 1, hCG.getLastRow() - 1, 20).getValues().forEach(function(r) {
      var codigo = String(r[0]).trim();
      if (!codigo || codigo.toLowerCase().indexOf('código') !== -1) return;
      var cargoRaw = _normCargo(String(r[6]).trim(), 'CG');
      var nombreBono = cargoToBono['CG'][cargoRaw];
      if (!nombreBono) return; // cargo sin bono CG en Maestro
      var pct = r[17];
      var ok  = String(r[18]).trim() === 'SI' ? 1 : 0;
      _acumular(codigo, nombreBono, ok, 'Fuente_CG', {
        cargoRaw:   cargoRaw,
        trabajador: String(r[5]).trim(),
        semana:     _normFechaAStr(r[1]),
        anio:       r[2],
        fecha:      _normFechaAStr(r[3]),
        centro:     r[4],
        pct:        pct,
        timestamp:  r[19]
      });
    });
  }

  // -- Fuente_Vajilla (bonos tipo Vajilla, canal separado) -----------
  var hVaj = ss.getSheetByName(HOJAS.FUENTE_VAJILLA);
  if (hVaj && hVaj.getLastRow() > 1) {
    // Estructura: Semana | FechaEvento | Código | Centro | InvitadosComida
    //             MermaPermitida | FacturaMerma | Cargo | Trabajador | Gana | Timestamp
    var vajData = hVaj.getRange(2, 1, hVaj.getLastRow() - 1, 11).getValues();
    vajData.forEach(function(r) {
      var codigo = String(r[2]).trim();
      if (!codigo) return;
      var cargoRaw = String(r[7]).trim();
      if (!cargoRaw) return;
      var nombreBono = cargoToBono['Vajilla'][cargoRaw];
      if (!nombreBono) return;
      var ok = String(r[9]).trim().toUpperCase() === 'SI' ? 1 : 0;
      _acumular(codigo, nombreBono, ok, 'Fuente_Vajilla', {
        cargoRaw:   cargoRaw,
        trabajador: String(r[8]).trim(),
        semana:     _normFechaAStr(r[0]),
        anio:       _extraerAnio(r[1]),
        fecha:      _normFechaAStr(r[1]),
        centro:     r[3],
        extra:      'Merma permitida $' + (Number(r[5]) || 0) + ' · Factura $' + (Number(r[6]) || 0),
        timestamp:  r[10]
      });
    });
  }

  // -- Fuente_Supervisoras -------------------------------------------
  var hSup = ss.getSheetByName(HOJAS.FUENTE_SUPERVISORAS);
  if (hSup && hSup.getLastRow() > 1) {
    var raw  = hSup.getDataRange().getValues();
    var hRow = raw[0];
    var iCod = _colIdx(hRow,'Código',0), iSem = _colIdx(hRow,'Semana',1);
    var iAno = _colIdx(hRow,'Año',2),    iFec = _colIdx(hRow,'Fecha',3);
    var iCen = _colIdx(hRow,'Centro',4), iNov = _colIdx(hRow,'Novios',5);
    var iTrb = _colIdx(hRow,'Trabajador',6), iCrg = _colIdx(hRow,'Cargo',7);
    var iSupCol = _colIdx(hRow,'Supervisor',8);
    var iTs  = _colIdx(hRow,'Timestamp',9);
    var iGna = _colIdx(hRow,'Gana',19);
    for (var i = 1; i < raw.length; i++) {
      var r    = raw[i];
      var cod  = String(r[iCod]).trim(); if (!cod) continue;
      var cargoRaw = _normCargo(String(r[iCrg]).trim(), 'Supervisoras');
      var nombreBono = cargoToBono['Supervisoras'][cargoRaw];
      if (!nombreBono) continue;
      var gana  = String(r[iGna]).trim().toUpperCase();
      var ok    = (gana === 'SI' || gana === 'SÍ') ? 1 : 0;
      _acumular(cod, nombreBono, ok, 'Fuente_Supervisoras', {
        cargoRaw:   cargoRaw,
        trabajador: String(r[iTrb]).trim(),
        semana:     _normFechaAStr(r[iSem]),
        anio:       r[iAno],
        fecha:      _normFechaAStr(r[iFec]),
        centro:     r[iCen],
        novios:     r[iNov],
        extra:      String(r[iSupCol] || '').trim(),
        timestamp:  r[iTs]
      });
    }
  }

  // -- Escribir Base_Criterios (una fila por grupo, AND aplicado) ----
  var filas = [];
  for (var k in grupos) {
    var g   = grupos[k];
    var okFinal = g.allGanaron ? 1 : 0;
    var resultado = okFinal ? 'Gano' : 'No gano';
    // Aplicar override por (codigo, nombreBono)
    var ov = overrides[_keyOverride(g.codigo, g.nombreBono)];
    var extraOut = g.extra;
    if (ov) {
      okFinal   = ov.override ? 1 : 0;
      resultado = (ov.override ? 'Gano' : 'No gano') + ' (Override)';
      extraOut  = (ov.razon ? 'Override: ' + ov.razon : 'Override manual') +
                  (ov.autor ? ' · ' + ov.autor : '');
    } else if (g.detalles.length > 1) {
      extraOut = (extraOut ? extraOut + ' · ' : '') + g.detalles.length + ' evaluados (AND)';
    }
    filas.push([g.codigo, g.semana, g.anio, g.fecha, g.centro, g.novios,
                '', g.cargoBase, g.nombreBono, 'RESULTADO BONO', okFinal,
                resultado, g.fuente, extraOut, g.timestamp]);
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
    var semanas = {}, cargos = {};
    base.forEach(function(r) {
      if (r.semana) semanas[r.semana] = true;
      if (r.cargo)  cargos[r.cargo]   = true;
    });
    // Personas: leer de Fuente_Supervisoras/CG/Fotos (trabajadores evaluados).
    // Base_Criterios ya no tiene trabajador (consolidado por cargo).
    var personas = {};
    var ss = SpreadsheetApp.openById(ID_SHEET_CENTRALIZADO);
    ['FUENTE_SUPERVISORAS','FUENTE_CG','FUENTE_FOTOS'].forEach(function(key) {
      var h = ss.getSheetByName(HOJAS[key]);
      if (!h || h.getLastRow() < 2) return;
      // Col G (idx 5 en Fotos/CG, idx 6 en Supervisoras tras header shift)
      // Leer 2 columnas para cubrir ambos casos; filtrar nombres válidos.
      var trbCol = (key === 'FUENTE_SUPERVISORAS') ? 7 : 6;
      var data = h.getRange(2, trbCol, h.getLastRow() - 1, 1).getValues();
      data.forEach(function(r) {
        var nm = String(r[0] || '').trim();
        if (nm && nm.toLowerCase().indexOf('trabajador') === -1) personas[nm] = true;
      });
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
    var base      = _leerBase();
    var overrides = _leerOverrides();
    var filtrado  = base.filter(function(r) { return r.semana === semana; });
    // Cada fila de Base_Criterios ya es 1 bono consolidado.
    // Agrupar por cargo → lista de eventos (1 por evento+bono).
    var grupos    = {};
    filtrado.forEach(function(r) {
      if (!grupos[r.cargo]) grupos[r.cargo] = [];
      var ev = null;
      for (var i = 0; i < grupos[r.cargo].length; i++) {
        if (grupos[r.cargo][i].codigo === r.codigoEvento) {
          ev = grupos[r.cargo][i]; break;
        }
      }
      if (!ev) {
        ev = { codigo: r.codigoEvento, centro: r.centro, fecha: r.fechaEvento,
               trabajador: '', bonos: [] };
        grupos[r.cargo].push(ev);
      }
      var ov = overrides[_keyOverride(r.codigoEvento, r.nombreBono)] || null;
      ev.bonos.push({ nombre: r.nombreBono, fuente: r.fuente,
                      cumplido: r.cumplido, resultado: r.resultado,
                      override: ov ? { activo: true, razon: ov.razon, autor: ov.autor } : null });
    });
    return { ok: true, semana: semana, grupos: grupos };
  } catch(e) { return { ok: false, msg: e.toString() }; }
}

function getDatosCargo(cargo) {
  try {
    var base     = _leerBase();
    var filtrado = base.filter(function(r) { return r.cargo === cargo; });
    // Base_Criterios tiene 1 fila por (codigo, bono consolidado).
    // Un mismo cargo puede tener varios bonos (ej: Super metre tiene Fotos + Supervisora + CG + Vajilla).
    var eventos  = {};
    filtrado.forEach(function(r) {
      if (!eventos[r.codigoEvento]) {
        eventos[r.codigoEvento] = { codigo: r.codigoEvento, semana: r.semana,
          centro: r.centro, fecha: r.fechaEvento, trabajador: '', bonos: [] };
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

// Historial por persona: base_criterios ya no tiene trabajador, así que
// buscamos al trabajador en Fuente_* y resolvemos el bono consolidado
// desde Base_Criterios usando (codigo, nombreBono).
function getDatosPersona(persona) {
  try {
    var ss      = SpreadsheetApp.openById(ID_SHEET_CENTRALIZADO);
    var base    = _leerBase();
    var bonos   = _cargarBonosInfo();
    var cargoToBono = bonos.cargoToBono;
    var personaNorm = String(persona).trim().toLowerCase();

    // Indexar Base_Criterios por (codigo, nombreBono) para lookup rápido
    var baseByKey = {};
    base.forEach(function(r) {
      baseByKey[r.codigoEvento + '|||' + r.nombreBono] = r;
    });

    // eventos[codigoEvento] = { codigo, semana, cargo, centro, fecha, bonos: [] }
    var eventos = {};
    var tot = 0, gan = 0;

    function procesarFila(codigo, cargoRaw, sistema, semana, fecha, centro, trabajador) {
      if (String(trabajador).trim().toLowerCase() !== personaNorm) return;
      var cargoNorm = _normCargo(cargoRaw, sistema);
      var nombreBono = cargoToBono[sistema] && cargoToBono[sistema][cargoNorm];
      if (!nombreBono) return;
      var row = baseByKey[codigo + '|||' + nombreBono];
      if (!row) return;
      if (!eventos[codigo]) {
        eventos[codigo] = { codigo: codigo, semana: semana, cargo: cargoNorm,
                            centro: centro, fecha: fecha, bonos: [] };
      }
      // Evitar duplicar el mismo bono si trabajador aparece en 2 fuentes
      var yaAdded = eventos[codigo].bonos.some(function(b) { return b.nombre === row.nombreBono; });
      if (yaAdded) return;
      eventos[codigo].bonos.push({
        nombre: row.nombreBono, fuente: row.fuente,
        cumplido: row.cumplido, resultado: row.resultado
      });
      tot++;
      if (row.cumplido === 1) gan++;
    }

    // Fuente_Fotos
    var hF = ss.getSheetByName(HOJAS.FUENTE_FOTOS);
    if (hF && hF.getLastRow() > 1) {
      hF.getRange(2, 1, hF.getLastRow() - 1, 20).getValues().forEach(function(r) {
        procesarFila(String(r[0]).trim(), String(r[6]).trim(), 'Fotos',
                     _normFechaAStr(r[1]), _normFechaAStr(r[3]), String(r[4]||''), String(r[5]||''));
      });
    }
    // Fuente_CG
    var hC = ss.getSheetByName(HOJAS.FUENTE_CG);
    if (hC && hC.getLastRow() > 1) {
      hC.getRange(2, 1, hC.getLastRow() - 1, 20).getValues().forEach(function(r) {
        procesarFila(String(r[0]).trim(), String(r[6]).trim(), 'CG',
                     _normFechaAStr(r[1]), _normFechaAStr(r[3]), String(r[4]||''), String(r[5]||''));
      });
    }
    // Fuente_Supervisoras
    var hS = ss.getSheetByName(HOJAS.FUENTE_SUPERVISORAS);
    if (hS && hS.getLastRow() > 1) {
      hS.getRange(2, 1, hS.getLastRow() - 1, 20).getValues().forEach(function(r) {
        procesarFila(String(r[0]).trim(), String(r[7]).trim(), 'Supervisoras',
                     _normFechaAStr(r[1]), _normFechaAStr(r[3]), String(r[4]||''), String(r[6]||''));
      });
    }

    var lista = [];
    for (var k in eventos) lista.push(eventos[k]);
    lista.sort(function(a,b) { return a.fecha > b.fecha ? -1 : 1; });
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
          // Para vista detalle, usar Control Gestión como principal (Vajilla se verá en módulo aparte)
          if (!criteriosCG[cargoCrit] || tipoBono === 'Control Gestión') {
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
    var data = h.getRange(2, 1, h.getLastRow() - 1, 18).getValues();
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
        criterios: crits,
        cargosAplicables: String(r[17] || '').trim() || cargo
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
    // Cols A-G: Cargo, Matrimonios, Cantidad, Bono Fotos, Bono Supervisora, Bono CG, Bono Vajilla
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
    // Construir mapa de cambios: cargo -> { Fotos, Supervisora, 'Control Gestión', Vajilla }
    // Las keys deben matchear los valores de col B (Tipo Bono) de Maestro_Bonos.
    var mapaMontos = {};
    cambios.forEach(function(c) {
      mapaMontos[c.cargo] = {
        'Fotos': c.bonoFotos || 0,
        'Supervisora': c.bonoSupervisora || 0,
        'Control Gestión': c.bonoActivos || 0,
        'Vajilla': c.bonoVajilla || 0
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

// ==================================================================
// OVERRIDES DE BONOS — edición manual desde el dashboard
// Schema v34+: bonos consolidados por (codigo, nombreBono).
// Trabajador NO es parte de la key porque el bono es del cargo, no del trabajador.
// ==================================================================
// Estructura Overrides_Bonos (6 cols):
//   A:CodigoEvento  B:Nombre Bono  C:Override(TRUE/FALSE)
//   D:Autor  E:Timestamp  F:Razon

var OVERRIDES_HDR = ['Código Evento','Nombre Bono','Override','Autor','Timestamp','Razón'];

function _keyOverride(codigo, nombreBono) {
  return String(codigo).trim() + '|||' + String(nombreBono).trim();
}

function _ensureOverridesSheet(ss) {
  var h = ss.getSheetByName(HOJAS.OVERRIDES_BONOS);
  if (!h) {
    h = ss.insertSheet(HOJAS.OVERRIDES_BONOS);
    _writeHeader(h, OVERRIDES_HDR);
  } else if (h.getLastRow() === 0) {
    _writeHeader(h, OVERRIDES_HDR);
  }
  return h;
}

function _leerOverrides() {
  var map = {};
  try {
    var ss = SpreadsheetApp.openById(ID_SHEET_CENTRALIZADO);
    var h  = ss.getSheetByName(HOJAS.OVERRIDES_BONOS);
    if (!h || h.getLastRow() < 2) return map;
    var data = h.getRange(2, 1, h.getLastRow() - 1, 6).getValues();
    for (var i = 0; i < data.length; i++) {
      var cod = String(data[i][0]).trim();
      var bon = String(data[i][1]).trim();
      if (!cod || !bon) continue;
      var ovRaw = data[i][2];
      var ov    = (ovRaw === true || String(ovRaw).toUpperCase() === 'TRUE' ||
                   String(ovRaw).toUpperCase() === 'SI' || String(ovRaw).toUpperCase() === 'SÍ');
      map[_keyOverride(cod, bon)] = {
        override:  ov,
        autor:     String(data[i][3] || '').trim(),
        timestamp: data[i][4],
        razon:     String(data[i][5] || '').trim()
      };
    }
  } catch(e) { Logger.log('_leerOverrides error: ' + e); }
  return map;
}

// Upsert por key (codigo, nombreBono). override: true = gana, false = no gana.
function setOverrideBono(codigo, nombreBono, override, razon) {
  try {
    var ss = SpreadsheetApp.openById(ID_SHEET_CENTRALIZADO);
    var h  = _ensureOverridesSheet(ss);
    var lock = LockService.getScriptLock();
    lock.waitLock(15000);
    try {
      var autor = '';
      try { autor = Session.getActiveUser().getEmail() || ''; } catch(e) {}
      var key   = _keyOverride(codigo, nombreBono);
      var found = -1;
      if (h.getLastRow() >= 2) {
        var data = h.getRange(2, 1, h.getLastRow() - 1, 2).getValues();
        for (var i = 0; i < data.length; i++) {
          if (_keyOverride(data[i][0], data[i][1]) === key) {
            found = i + 2;
            break;
          }
        }
      }
      var row = [String(codigo).trim(), String(nombreBono).trim(),
                 !!override, autor, new Date(), String(razon || '').trim()];
      if (found > 0) {
        h.getRange(found, 1, 1, 6).setValues([row]);
      } else {
        h.getRange(h.getLastRow() + 1, 1, 1, 6).setValues([row]);
      }
    } finally { lock.releaseLock(); }

    _reconstruirBase();
    _reconstruirResumen();
    _reconstruirFinanzas();
    return { ok: true, msg: 'Override guardado. Bonos recalculados.' };
  } catch(e) { return { ok: false, msg: e.toString() }; }
}

function deleteOverrideBono(codigo, nombreBono) {
  try {
    var ss = SpreadsheetApp.openById(ID_SHEET_CENTRALIZADO);
    var h  = ss.getSheetByName(HOJAS.OVERRIDES_BONOS);
    if (!h || h.getLastRow() < 2) return { ok: true, msg: 'Sin overrides para eliminar.' };
    var lock = LockService.getScriptLock();
    lock.waitLock(15000);
    var borradas = 0;
    try {
      var key  = _keyOverride(codigo, nombreBono);
      var data = h.getRange(2, 1, h.getLastRow() - 1, 2).getValues();
      for (var i = data.length - 1; i >= 0; i--) {
        if (_keyOverride(data[i][0], data[i][1]) === key) {
          h.deleteRow(i + 2);
          borradas++;
        }
      }
    } finally { lock.releaseLock(); }

    _reconstruirBase();
    _reconstruirResumen();
    _reconstruirFinanzas();
    return { ok: true, msg: 'Override eliminado (' + borradas + '). Bonos recalculados.' };
  } catch(e) { return { ok: false, msg: e.toString() }; }
}

function getOverrideBono(codigo, nombreBono) {
  try {
    var map = _leerOverrides();
    var ov  = map[_keyOverride(codigo, nombreBono)];
    return { ok: true, override: ov || null };
  } catch(e) { return { ok: false, msg: e.toString() }; }
}

// ==================================================================
// getTrabajadoresDelBono — lookup on-demand en Planilla Maestra.
// Retorna lista de trabajadores que cobrarán este bono (el universo "real"
// de pago), filtrando Registro por (codigo, fuente='Evento', cargo in cargosAplicables).
// ==================================================================
function getTrabajadoresDelBono(codigo, nombreBono) {
  try {
    var info = _cargarBonosInfo();
    var meta = info.bonoInfo[nombreBono];
    if (!meta) return { ok: false, msg: 'Bono no encontrado en Maestro: ' + nombreBono };
    // Set de cargos aplicables normalizados (sin tildes, lowercase)
    var aplicablesSet = {};
    meta.cargosAplicables.forEach(function(c) { aplicablesSet[_normalizarCargo(c)] = true; });

    var sh = SpreadsheetApp.openById(ID_PLANILLA_MAESTRA).getSheetByName(HOJA_REGISTRO_MAESTRA);
    if (!sh || sh.getLastRow() < 2) return { ok: true, trabajadores: [], cargosAplicables: meta.cargosAplicables };
    var data = sh.getRange(2, 1, sh.getLastRow() - 1, 18).getValues();
    var code = String(codigo).trim();
    var out  = [];
    data.forEach(function(r) {
      if (String(r[15]).trim() !== code) return;
      if (String(r[13]).trim() !== FUENTE_EVENTO) return;
      var cargoTrab = String(r[3] || '').trim();
      if (!aplicablesSet[_normalizarCargo(cargoTrab)]) return;
      var nombre = String(r[2] || '').trim();
      if (!nombre) return;
      out.push({ nombre: nombre, cargo: cargoTrab });
    });
    return { ok: true, trabajadores: out, cargosAplicables: meta.cargosAplicables,
             monto: meta.monto };
  } catch(e) { return { ok: false, msg: e.toString() }; }
}

// ==================================================================
// FOTOS ON-DEMAND — consulta URLs de fotos desde el Sheet Fotos.
// Retorna fotos subidas (válidas) para un (codigo, cargo).
// Sheet Fotos > Registro cols:
//   A:Timestamp B:Fecha C:Centro D:Cargo E:Nombre F:Instruccion
//   G:URL Drive H:Codigo Evento I:Valida
// ==================================================================
function getFotosDeEvento(codigo, cargo) {
  try {
    var ss   = SpreadsheetApp.openById(ID_SHEET_FOTOS);
    var hoja = ss.getSheetByName('Registro');
    if (!hoja || hoja.getLastRow() < 2) return { ok: true, fotos: [] };
    var datos = hoja.getRange(2, 1, hoja.getLastRow() - 1, 9).getValues();
    var cod      = String(codigo).trim();
    var crgFuzzy = _normalizarCargoFuzzy(cargo);
    var out      = [];
    datos.forEach(function(r) {
      if (String(r[7]).trim() !== cod) return;
      // Match fuzzy: "Super Metre" ≡ "Super metre", "Jefe de Cocina" ≡ "Jefe Cocina"
      if (_normalizarCargoFuzzy(r[3]) !== crgFuzzy) return;
      var valida = (r[8] === true || String(r[8]).toUpperCase() === 'TRUE');
      if (!valida) return;
      var url = String(r[6] || '').trim();
      if (!url) return;
      out.push({
        instruccion: String(r[5] || '').trim(),
        url:         url,
        fileId:      _extractDriveFileId(url),
        nombre:      String(r[4] || '').trim(),
        timestamp:   r[0]
      });
    });
    out.sort(function(a, b) {
      return String(a.instruccion).localeCompare(String(b.instruccion));
    });
    return { ok: true, fotos: out };
  } catch(e) {
    Logger.log('getFotosDeEvento error: ' + e);
    return { ok: false, msg: e.toString(), fotos: [] };
  }
}

function _extractDriveFileId(url) {
  if (!url) return '';
  var m1 = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (m1) return m1[1];
  var m2 = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (m2) return m2[1];
  return '';
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

// ==================================================================
// PASO 4 y 5 — Integración con Planilla Maestra (sistema-pagos)
// ------------------------------------------------------------------
// Paso 4: leer trabajadores individualizados del evento aprobado.
// Paso 5: escribir bonos ganados (Resumen_Finanzas) → Planilla Maestra
//         hoja Registro con fuente='Bonos'.
//
// Idempotente: antes de escribir, borra filas previas del mismo evento
// con fuente='Bonos' (permite re-correr después de editar evaluaciones).
//
// Modo fallo: si algún trabajador de Resumen_Finanzas no matchea en
// Registro, la función no escribe NADA y retorna la lista de mismatches
// (OPCIÓN A confirmada por el usuario).
// ==================================================================

var ID_PLANILLA_MAESTRA     = '1v7nBRea_YMvsUjeBtcMKpe7H4iAWA6onZBhJ_r7b8-0';
var ID_REMUNERACIONES       = '1lHEkkkSXDVrqZH_bFcqkSX4hs-QbjjlDtNIBVY9g9F4';
var HOJA_REGISTRO_MAESTRA   = 'Registro';
var HOJA_CONTROL_EVENTOS    = 'Control Eventos';
var FUENTE_BONOS            = 'Bonos';
var FUENTE_EVENTO           = 'Evento';

// Normaliza nombre para comparación tolerante (sin tildes, lowercase, sin dobles espacios).
function _normalizarNombre(s) {
  return String(s || '').toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
}

// Normaliza cargo para comparación tolerante ("Garzón" ≡ "Garzon", "Metre" ≡ "METRE").
// Necesario porque en Planilla Maestra hay typos sin tilde ("Garzon") vs el cargo
// canónico con tilde de Maestro_Bonos.
function _normalizarCargo(s) {
  return _normalizarNombre(s);
}

// Normalización fuzzy de cargos para Sheet Fotos > Registro, donde los cargos
// pueden venir con palabras intermedias o capitalización distinta:
//   "Super Metre" ≡ "Super metre"
//   "Jefe de Cocina" ≡ "Jefe Cocina"
//   "Jefa de Decoración" ≡ "Jefa Decoración" ≡ "jefa decoracion"
// Quita conectores (de, del, la, el, los, las) y normaliza tildes/case.
function _normalizarCargoFuzzy(s) {
  return _normalizarNombre(s)
    .replace(/\b(de|del|la|el|los|las)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Lista de trabajadores contratados (nombres normalizados).
// Usado para heredar estado: Liquidación si contratado, Por pagar si no.
function _leerContratados() {
  try {
    var sh = SpreadsheetApp.openById(ID_REMUNERACIONES).getSheetByName('Datos Trabajadores');
    if (!sh || sh.getLastRow() < 2) return [];
    var data = sh.getRange(1, 1, sh.getLastRow(), 1).getValues();
    var out = [];
    for (var i = 1; i < data.length; i++) {
      if (data[i][0]) out.push(_normalizarNombre(data[i][0]));
    }
    return out;
  } catch(e) {
    Logger.log('_leerContratados error: ' + e);
    return [];
  }
}

// PASO 4: Lee trabajadores aprobados del evento desde Planilla Maestra > Registro.
// Filtra por (col P codigoEvento, col N fuente='Evento').
// Registro cols (0-based): A=ID, C=Nombre, D=Cargo, E=Monto, G=FechaEvento,
//   H=Lugar+Fecha, I=Linea, J=Clasificacion, K=Semana, L=Estado,
//   M=Mes, N=Fuente, P=CodigoEvento, Q=Detalle.
function _leerTrabajadoresAprobadosDeEvento(codigoEvento) {
  try {
    var sh = SpreadsheetApp.openById(ID_PLANILLA_MAESTRA).getSheetByName(HOJA_REGISTRO_MAESTRA);
    if (!sh || sh.getLastRow() < 2) return [];
    var data = sh.getRange(2, 1, sh.getLastRow() - 1, 18).getValues();
    var code = String(codigoEvento).trim();
    var contratados = _leerContratados();
    var out = [];
    data.forEach(function(r) {
      if (String(r[15]).trim() !== code) return;        // col P = codigoEvento
      if (String(r[13]).trim() !== FUENTE_EVENTO) return; // col N = fuente
      var nombre = String(r[2]).trim();
      if (!nombre) return;
      out.push({
        nombre:        nombre,
        nombreNorm:    _normalizarNombre(nombre),
        cargo:         String(r[3]).trim(),
        monto:         Number(r[4]) || 0,
        fechaEvento:   r[6],
        lugarFecha:    String(r[7] || '').trim(),
        linea:         String(r[8] || '').trim(),
        clasificacion: String(r[9] || 'Personal Evento').trim(),
        semana:        r[10],
        estado:        String(r[11] || '').trim(),
        mes:           r[12],
        contratado:    contratados.indexOf(_normalizarNombre(nombre)) >= 0
      });
    });
    return out;
  } catch(e) {
    Logger.log('_leerTrabajadoresAprobadosDeEvento error: ' + e);
    return [];
  }
}

// Lee bonos ganados del evento desde Resumen_Finanzas (ganaBono === 'SI').
// Resumen_Finanzas cols: 0=Semana, 1=CodigoEvento, 2=FechaEvento, 3=Centro,
//   4=Trabajador, 5=Cargo, 6=NombreBono, 7=Fuente, 8=Resultado,
//   9=GanaBono, 10=Monto, 11=Timestamp.
function _leerBonosGanadosDeEvento(codigoEvento) {
  try {
    var sh = SpreadsheetApp.openById(ID_SHEET_CENTRALIZADO).getSheetByName(HOJAS.RESUMEN_FINANZAS);
    if (!sh || sh.getLastRow() < 2) return [];
    var data = sh.getRange(2, 1, sh.getLastRow() - 1, 12).getValues();
    var code = String(codigoEvento).trim();
    var out = [];
    data.forEach(function(r) {
      if (String(r[1]).trim() !== code) return;
      if (String(r[9]).trim() !== 'SI') return;
      var monto = Number(r[10]) || 0;
      if (monto <= 0) return;
      out.push({
        semana:      r[0],
        fechaEvento: r[2],
        centro:      String(r[3] || '').trim(),
        trabajador:  String(r[4] || '').trim(),
        trabNorm:    _normalizarNombre(r[4]),
        cargo:       String(r[5] || '').trim(),
        nombreBono:  String(r[6] || '').trim(),
        fuente:      String(r[7] || '').trim(),
        resultado:   String(r[8] || '').trim(),
        monto:       monto
      });
    });
    return out;
  } catch(e) {
    Logger.log('_leerBonosGanadosDeEvento error: ' + e);
    return [];
  }
}

// Lee info del evento desde Control Eventos (para fecha/lugar/linea si falta).
function _leerInfoEvento(codigoEvento) {
  try {
    var sh = SpreadsheetApp.openById(ID_PLANILLA_MAESTRA).getSheetByName(HOJA_CONTROL_EVENTOS);
    if (!sh || sh.getLastRow() < 2) return null;
    var data = sh.getRange(2, 1, sh.getLastRow() - 1, 17).getValues();
    var code = String(codigoEvento).trim();
    for (var i = 0; i < data.length; i++) {
      if (String(data[i][0]).trim() !== code) continue;
      return {
        codigo: data[i][0], lugar: String(data[i][1] || ''),
        fecha:  data[i][2], tipo:  String(data[i][3] || ''),
        linea:  String(data[i][4] || ''), semana: data[i][5],
        estado: String(data[i][8] || 'Pendiente')
      };
    }
    return null;
  } catch(e) { Logger.log('_leerInfoEvento error: ' + e); return null; }
}

// PASO 5 (preview v34+): bonos consolidados → N trabajadores con cargos aplicables.
// Para cada bono ganado en Resumen_Finanzas, resuelve Cargos Aplicables desde
// Maestro_Bonos y genera 1 fila por trabajador del evento con cargo aplicable.
// Retorna: { ok, codigo, evento, bonos[], mismatches[], yaEscritos, totalMonto }
function previewBonosParaPlanillaMaestra(codigoEvento) {
  try {
    var info   = _leerInfoEvento(codigoEvento);
    if (!info) return { ok: false, msg: 'Evento no encontrado en Planilla Maestra.' };
    if (info.estado !== 'Aprobado') {
      return { ok: false, msg: 'El evento debe estar en estado "Aprobado" en Planilla Maestra. Actual: "' + info.estado + '".' };
    }
    var trabajadores = _leerTrabajadoresAprobadosDeEvento(codigoEvento);
    if (trabajadores.length === 0) {
      return { ok: false, msg: 'No hay registros con fuente="Evento" para este código en Planilla Maestra.' };
    }
    var bonos = _leerBonosGanadosDeEvento(codigoEvento);
    if (bonos.length === 0) {
      return { ok: false, msg: 'No hay bonos ganados para este evento en Resumen_Finanzas. ¿Sincronizaste?' };
    }

    var bonosInfo = _cargarBonosInfo().bonoInfo;

    // Expandir cada bono ganado a N filas (1 por trabajador con cargo aplicable)
    var matches = [];
    var mismatches = [];
    bonos.forEach(function(b) {
      var meta = bonosInfo[b.nombreBono];
      if (!meta) {
        mismatches.push({
          trabajadorBono: '(todos aplicables)',
          cargo:          b.cargo,
          nombreBono:     b.nombreBono,
          monto:          b.monto,
          motivo:         'Bono no encontrado en Maestro_Bonos. Verificá col Cargo / Tipo Bono.'
        });
        return;
      }
      // Normalizar tildes para que "Garzon" (typo frecuente) ≡ "Garzón"
      var aplicablesSet = {};
      meta.cargosAplicables.forEach(function(c) { aplicablesSet[_normalizarCargo(c)] = true; });

      var trabsDelBono = trabajadores.filter(function(t) {
        return aplicablesSet[_normalizarCargo(t.cargo)];
      });

      if (trabsDelBono.length === 0) {
        mismatches.push({
          trabajadorBono: '(ninguno)',
          cargo:          meta.cargosAplicables.join(', '),
          nombreBono:     b.nombreBono,
          monto:          b.monto,
          motivo:         'No hay trabajadores en Planilla Maestra con los cargos aplicables: ' + meta.cargosAplicables.join(', ')
        });
        return;
      }

      trabsDelBono.forEach(function(t) {
        matches.push({
          trabajador:  t.nombre,
          cargo:       t.cargo,          // cargo real del trabajador
          cargoBase:   meta.cargoBase,   // cargo base del bono (para agrupar/ordenar)
          tipoBono:    meta.tipoBono,    // Fotos / Supervisora / Control Gestión / Vajilla
          nombreBono:  b.nombreBono,
          monto:       meta.monto,
          estado:      t.contratado ? 'Liquidación' : 'Por pagar',
          contratado:  t.contratado,
          fuenteBono:  b.fuente
        });
      });
    });

    // Detectar bonos previamente escritos (idempotente)
    var regSh = SpreadsheetApp.openById(ID_PLANILLA_MAESTRA).getSheetByName(HOJA_REGISTRO_MAESTRA);
    var yaEscritos = 0;
    if (regSh && regSh.getLastRow() >= 2) {
      var regData = regSh.getRange(2, 1, regSh.getLastRow() - 1, 18).getValues();
      var code = String(codigoEvento).trim();
      regData.forEach(function(r) {
        if (String(r[15]).trim() === code && String(r[13]).trim() === FUENTE_BONOS) yaEscritos++;
      });
    }

    var totalMonto = 0;
    matches.forEach(function(m) { totalMonto += m.monto; });

    return {
      ok: true,
      codigo: codigoEvento,
      evento: {
        lugar: info.lugar,
        fecha: formatFechaCL_(info.fecha),
        semana: formatFechaCL_(info.semana),
        linea: info.linea
      },
      bonos:         matches,
      mismatches:    mismatches,
      yaEscritos:    yaEscritos,
      totalMonto:    totalMonto
    };
  } catch(e) { return { ok: false, msg: e.toString() }; }
}

// Preview de múltiples eventos en una sola llamada.
// Retorna { ok, eventos: [{codigo, preview, ok, msg}], totalGlobal, errores }
function previewBonosTodosLosEventos(codigos) {
  try {
    if (!Array.isArray(codigos) || codigos.length === 0) {
      return { ok: false, msg: 'No se recibieron códigos de evento.' };
    }
    var eventos = [];
    var totalGlobal = 0;
    codigos.forEach(function(cod) {
      var p = previewBonosParaPlanillaMaestra(cod);
      eventos.push({ codigo: cod, preview: p, ok: !!p.ok });
      if (p.ok) totalGlobal += Number(p.totalMonto) || 0;
    });
    return { ok: true, eventos: eventos, totalGlobal: totalGlobal };
  } catch(e) { return { ok: false, msg: e.toString() }; }
}

// Escritura masiva de múltiples eventos. Itera cada evento; si uno falla
// (mismatches u otro error), sigue con los demás y reporta al final.
function escribirBonosMultipleEventos(codigos) {
  try {
    if (!Array.isArray(codigos) || codigos.length === 0) {
      return { ok: false, msg: 'No se recibieron códigos de evento.' };
    }
    var escritos = [];
    var fallos   = [];
    var totalMonto = 0;
    var totalFilas = 0;
    codigos.forEach(function(cod) {
      var r = escribirBonosEnPlanillaMaestra(cod);
      if (r.ok) {
        escritos.push({
          codigo: cod,
          escritos: r.escritos || 0,
          reemplazados: r.borradosPrevios || 0,
          totalMonto: r.totalMonto || 0
        });
        totalMonto += r.totalMonto || 0;
        totalFilas += r.escritos || 0;
      } else {
        fallos.push({ codigo: cod, msg: r.msg, mismatches: r.mismatches || [] });
      }
    });
    return {
      ok:          fallos.length === 0,
      escritos:    escritos,
      fallos:      fallos,
      totalFilas:  totalFilas,
      totalMonto:  totalMonto,
      msg:         'Procesados ' + codigos.length + ' evento(s). ' +
                   'OK: ' + escritos.length + ' · Errores: ' + fallos.length +
                   ' · Filas: ' + totalFilas + ' · Total: $' + _fmtMonto_(totalMonto)
    };
  } catch(e) { return { ok: false, msg: e.toString() }; }
}

// PASO 5 (ejecución): escribe bonos a Planilla Maestra > Registro con fuente='Bonos'.
// OPCIÓN A: si hay mismatches, NO escribe nada. Retorna lista para resolver.
// Idempotente: antes de escribir, borra filas previas del mismo evento con fuente='Bonos'.
function escribirBonosEnPlanillaMaestra(codigoEvento) {
  try {
    var prev = previewBonosParaPlanillaMaestra(codigoEvento);
    if (!prev.ok) return prev;
    if (prev.mismatches && prev.mismatches.length > 0) {
      return {
        ok: false,
        msg: 'Hay ' + prev.mismatches.length + ' bono(s) que no matchean con Planilla Maestra. Resolver mismatches y reintentar.',
        mismatches: prev.mismatches,
        bonos: prev.bonos
      };
    }
    if (!prev.bonos || prev.bonos.length === 0) {
      return { ok: false, msg: 'No hay bonos para escribir.' };
    }

    var ss     = SpreadsheetApp.openById(ID_PLANILLA_MAESTRA);
    var regSh  = ss.getSheetByName(HOJA_REGISTRO_MAESTRA);
    var lock   = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      var regData = regSh.getDataRange().getValues();
      var code    = String(codigoEvento).trim();

      // 1. Borrar filas previas con fuente='Bonos' de este evento
      var filasBorrar = [];
      for (var k = regData.length - 1; k >= 1; k--) {
        if (String(regData[k][15]).trim() === code && String(regData[k][13]).trim() === FUENTE_BONOS) {
          filasBorrar.push(k + 1);
        }
      }
      filasBorrar.sort(function(a, b) { return b - a; });
      filasBorrar.forEach(function(r) { regSh.deleteRow(r); });

      // 2. Recalcular maxId tras borrado
      regData = regSh.getDataRange().getValues();
      var maxId = 0;
      for (var i = 1; i < regData.length; i++) {
        var id = parseInt(regData[i][0]); if (id > maxId) maxId = id;
      }

      // 3. Construir filas nuevas
      var info   = _leerInfoEvento(codigoEvento);
      var fechaReg = Utilities.formatDate(new Date(), 'America/Santiago', 'dd/MM/yyyy HH:mm');
      var feStr    = formatFechaCL_(info.fecha);
      var semStr   = formatFechaCL_(info.semana);
      var fechaEv  = _parseFechaCL_(info.fecha);
      var mes      = fechaEv ? (fechaEv.getMonth() + 1) : '';
      var lugarFecha = (info.lugar || '') + ' ' + feStr;

      var filas = [];
      prev.bonos.forEach(function(b, idx) {
        var detalle = b.nombreBono + ' · ' + b.cargo;
        // Estructura Registro (18 cols, índices 0-17):
        // 0:ID, 1:FechaReg, 2:Nombre, 3:Cargo, 4:Monto, 5:-, 6:FechaEvento,
        // 7:Lugar+Fecha, 8:Linea, 9:Clasificacion, 10:Semana, 11:Estado,
        // 12:Mes, 13:Fuente, 14:-, 15:CodigoEvento, 16:Detalle, 17:-
        filas.push([
          maxId + idx + 1, fechaReg, b.trabajador, b.nombreBono, b.monto,
          '', feStr, lugarFecha, info.linea,
          'Personal Evento', semStr, b.estado, mes,
          FUENTE_BONOS, '', codigoEvento, detalle, ''
        ]);
      });

      if (filas.length > 0) {
        regSh.getRange(regSh.getLastRow() + 1, 1, filas.length, 18).setValues(filas);
      }

      // 4. Log
      var logSh = ss.getSheetByName('Log');
      if (logSh) {
        logSh.appendRow([new Date(), Session.getActiveUser().getEmail() || 'Sistema Bonos',
          'Escritura bonos → Planilla Maestra', codigoEvento,
          filas.length + ' bono(s) · $' + prev.totalMonto, '']);
      }

      return {
        ok:           true,
        escritos:     filas.length,
        borradosPrevios: filasBorrar.length,
        totalMonto:   prev.totalMonto,
        msg:          'Escritos ' + filas.length + ' bono(s) por $' + _fmtMonto_(prev.totalMonto) + '. ' +
                      (filasBorrar.length ? '(Reemplazó ' + filasBorrar.length + ' anterior(es))' : '')
      };
    } finally {
      lock.releaseLock();
    }
  } catch(e) { return { ok: false, msg: e.toString() }; }
}

// -- Helpers fecha -------------------------------------------------
function _parseFechaCL_(val) {
  if (!val) return null;
  if (val instanceof Date && !isNaN(val)) return val;
  var s = String(val).trim();
  var m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) return new Date(Date.UTC(parseInt(m[3]), parseInt(m[2]) - 1, parseInt(m[1]), 12, 0, 0));
  var fb = new Date(s); return isNaN(fb) ? null : fb;
}
function formatFechaCL_(val) {
  var d = _parseFechaCL_(val); if (!d) return '';
  return Utilities.formatDate(d, 'GMT', 'dd/MM/yyyy');
}
function _fmtMonto_(n) {
  return String(Math.round(n || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}
