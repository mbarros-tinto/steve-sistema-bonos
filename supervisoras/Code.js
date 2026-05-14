// ═══════════════════════════════════════════════════════════════════
//  Tinto Banquetería · Evaluaciones Supervisoras v7.0
//  Code.gs — Google Apps Script Backend
//
//  CAMBIOS v7:
//  • getTrabajadores(): lee hoja "Inscripcion" del Sheet de Maestro
//    de Trabajadores y devuelve lista de nombres para autocompletado
//  • Los tres archivos HTML usan autocompletado con esa lista
//    (Trabajadores Destacados y Alerta)
//
//  CONFIGURACIÓN:
//  1. SHEET_ID         → ID del Sheet de Evaluaciones
//  2. SHEET_MAESTRO_ID → ID del Sheet Maestro de Trabajadores
//  3. Hojas esperadas en SHEET_ID: "Evaluación Supervisoras", "Aux"
//  4. Hoja esperada en SHEET_MAESTRO_ID: "Inscripcion"
//     Col B = "Nombre y Apellido"
// ═══════════════════════════════════════════════════════════════════
var SHEET_ID         = '1JC49jh4kgImPf-mUW-r-PepPhLF0mIgcWp-FWS6l6Sg';
var SHEET_MAESTRO_ID = '1aRuPFT625ewVSR7EfdaaHHp4Y2bohu6KUNLhC6ETd8M';
var CRM_GENERAL_ID   = '1TTzFI5sMgInI1Ew__3Rw7lE300cGWmlDFyDVfWVqGTg';
var CENTRALIZADO_BONOS_ID = '1f86EWcVJAaptEBoAzI8d6ZZ_lHw09XBYV9C5Kbe-g5k';
var MAESTRO_BONOS_TAB = 'Maestro_Bonos';
var SHEET_EVAL       = 'Evaluación Supervisoras';
var SHEET_AUX        = 'Aux';
var SHEET_INSCRIPCION = 'Inscripcion';
var NOTA_MIN_BONO    = 6;

// ════════════════════════════════════════════════════════════════════
//  FORM CONFIG — Lee Maestro_Bonos del Centralizado y arma config
//  dinámico para el formulario. Filtra sistema=Supervisoras.
//  Detecta tipo de criterio por sufijo:
//    "Liderazgo (0-7) | ¿Lidera al equipo?"  → nota 0-7, subtítulo
//    "Conteo botellas (Sí/No)"               → bool
//    "Presente y en rol"                     → default 'nota' (0-7)
//  Acepta variantes (Sí/No · Si/No · Y/N · 0-7 · 0 a 7 · 0/7).
// ════════════════════════════════════════════════════════════════════
function getFormConfig() {
  try {
    var ss = SpreadsheetApp.openById(CENTRALIZADO_BONOS_ID);
    var sh = ss.getSheetByName(MAESTRO_BONOS_TAB);
    if (!sh || sh.getLastRow() < 2) return { ok: false, error: 'Maestro_Bonos vacío' };
    var data = sh.getRange(2, 1, sh.getLastRow() - 1, 14).getValues();
    var cargos = [];
    data.forEach(function(r) {
      var cargo    = String(r[0]).trim();
      var tipoBono = String(r[1]).trim();
      var sistema  = String(r[3]).trim();
      if (sistema !== 'Supervisoras' || tipoBono !== 'Supervisora') return;
      if (!cargo) return;
      var criterios = [];
      for (var i = 4; i < 14; i++) {
        var raw = String(r[i]).trim();
        if (!raw || /^[-—\s]*$/.test(raw)) continue;
        criterios.push(_parseCriterioSupervisora(raw));
      }
      if (criterios.length === 0) return;
      cargos.push({
        cargo: cargo,
        criterios: criterios,
        multiTrabajador: !!_cargosMultiTrabajador()[cargo],
        permiteCoJefe:   !!_cargosConCoJefe()[cargo]
      });
    });
    return { ok: true, notaMinBono: NOTA_MIN_BONO, cargos: cargos };
  } catch(err) {
    Logger.log('getFormConfig ERROR: ' + err.toString());
    return { ok: false, error: err.toString() };
  }
}

function _parseCriterioSupervisora(raw) {
  // Separar subtítulo opcional con "|"
  var partes = raw.split('|');
  var head = partes[0].trim();
  var subtitulo = partes.length > 1 ? partes.slice(1).join('|').trim() : '';

  // Detectar tipo por sufijo
  var m07 = head.match(/^(.+?)\s*\(\s*(?:0\s*[-a/]\s*7)\s*\)\s*$/i);
  if (m07) return { tipo: 'nota', label: m07[1].trim(), subtitulo: subtitulo, raw: raw };

  var mBool = head.match(/^(.+?)\s*\(\s*(?:s[ií]\s*\/\s*no|y\s*\/\s*n)\s*\)\s*$/i);
  if (mBool) return { tipo: 'bool', label: mBool[1].trim(), subtitulo: subtitulo, raw: raw };

  // Sin sufijo → default 'nota' (0-7)
  return { tipo: 'nota', label: head, subtitulo: subtitulo, raw: raw };
}

// ════════════════════════════════════════════════════════════════════
//  SCHEMA v36 — HEADERs intercaladas con cabeceras temporales
//
//  Estructura de la hoja "Evaluación Supervisoras" (cols A..Y = 25):
//    A:  Tipo              (HEADER | EVAL)
//    B:  Timestamp
//    C:  Supervisor        (vacío en HEADER)
//    D:  Novios            (vacío en HEADER)
//    E:  Centro            (vacío en HEADER)
//    F:  Fecha Evento      (vacío en HEADER)
//    G:  Código Evento     (vacío en HEADER)
//    H:  Cargo             (poblado en HEADER y EVAL)
//    I:  Nombre Trabajador (vacío en HEADER)
//    J:  CoJefes           (vacío si no aplica)
//    K:  Comentario        (vacío en HEADER)
//    L..S: Crit_1..Crit_8  (en HEADER: labels "Liderazgo (0-7)"
//                            o "Conteo botellas (Sí/No)";
//                            en EVAL: valores numéricos o "Sí"/"No")
//    T..Y: Destacado 1, Destacado 2, Destacado 3, Destacado Comentario,
//          Alerta Trabajadores, Alerta Comentario
//          (replicados en todas las filas EVAL del mismo timestamp)
//
//  Cada evaluación del formulario produce N filas EVAL (una por cargo
//  evaluado). Las cabeceras HEADER se insertan automáticamente la primera
//  vez que se evalúa un cargo, y cuando los criterios cambian respecto
//  al HEADER vigente más reciente del mismo cargo.
// ════════════════════════════════════════════════════════════════════
var SLOTS_CRIT      = 8;
var HEADERS_NUEVO   = [
  'Tipo', 'Timestamp', 'Supervisor', 'Novios', 'Centro', 'Fecha Evento', 'Código Evento',
  'Cargo', 'Nombre Trabajador', 'CoJefes', 'Comentario',
  'Crit_1', 'Crit_2', 'Crit_3', 'Crit_4', 'Crit_5', 'Crit_6', 'Crit_7', 'Crit_8',
  'Destacado 1', 'Destacado 2', 'Destacado 3', 'Destacado Comentario',
  'Alerta Trabajadores', 'Alerta Comentario'
];
// Índices 0-based para acceso rápido
var IDX = {
  tipo: 0, timestamp: 1, supervisor: 2, novios: 3, centro: 4,
  fechaEvento: 5, codigoEvento: 6, cargo: 7, nombre: 8, cojefes: 9,
  comentario: 10,
  crit: [11, 12, 13, 14, 15, 16, 17, 18],
  destac: [19, 20, 21], destacCom: 22,
  alerta: 23, alertaCom: 24
};

function _cargosConCoJefe() { return { 'Jefe Cocina': true }; }
function _cargosMultiTrabajador() { return { 'Asignación Encargados Novios': true }; }

// Asegura que la hoja tenga los 25 headers fijos. Si la hoja está vacía,
// los escribe. Si tiene headers viejos del schema dinámico v34, NO los toca
// (la migración debe correrse manualmente con migrarASchemaHEADER()).
function _ensureSchema(sheet) {
  var lastCol = sheet.getLastColumn();
  if (lastCol === 0) {
    sheet.getRange(1, 1, 1, HEADERS_NUEVO.length).setValues([HEADERS_NUEVO]);
    sheet.getRange(1, 1, 1, HEADERS_NUEVO.length).setFontWeight('bold').setBackground('#2a2a2a').setFontColor('#ffffff');
    sheet.setFrozenRows(1);
    return HEADERS_NUEVO.slice();
  }
  var existing = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function(v) { return String(v || '').trim(); });
  // Si el primer header es "Tipo", asumimos schema v36 ya aplicado
  if (existing[0] === 'Tipo') return existing;
  // Si no, el schema viejo está vivo. Lanzar error con instrucción.
  throw new Error('Schema viejo detectado. Ejecutar migrarASchemaHEADER() una vez para migrar.');
}

// Convierte un criterio del Maestro a su label canónico con sufijo de tipo
// (lo que se escribe en una fila HEADER, cols L..S).
function _critToHeaderLabel(crit) {
  if (!crit) return '';
  if (crit.tipo === 'bool') return crit.label + ' (Sí/No)';
  return crit.label + ' (0-7)';
}

// Compara los criterios actuales del Maestro con los del HEADER vigente.
// Retorna true si calzan exactamente (en orden, label y tipo), false si no.
function _criteriosCalzan(criterios, headerCells) {
  // headerCells es un array de SLOTS_CRIT strings (cols L..S del HEADER).
  // criterios es un array de objetos {label, tipo}
  if (!criterios) return false;
  var labels = criterios.map(_critToHeaderLabel);
  // Pad con '' hasta SLOTS_CRIT
  while (labels.length < SLOTS_CRIT) labels.push('');
  for (var i = 0; i < SLOTS_CRIT; i++) {
    var expected = labels[i] || '';
    var got      = (headerCells[i] === undefined || headerCells[i] === null) ? '' : String(headerCells[i]).trim();
    if (expected !== got) return false;
  }
  return true;
}

// Busca el HEADER más reciente del cargo en la hoja (recorre hacia arriba
// desde la última fila). Retorna {rowIndex, criterios:[{label,tipo,raw}, ...]}
// o null si no hay HEADER previo del cargo.
// beforeRow = 0 → busca hasta el final. > 0 → solo filas con rowIndex < beforeRow.
function _getHeaderVigente(sheet, cargo, beforeRow) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  var maxRow = (beforeRow && beforeRow > 0) ? Math.min(beforeRow - 1, lastRow) : lastRow;
  if (maxRow < 2) return null;
  // Solo necesitamos cols A (Tipo), H (Cargo), L..S (Crit_1..Crit_8)
  // Para eficiencia con muchas filas, leemos el rango completo de cols A..S
  var data = sheet.getRange(2, 1, maxRow - 1, IDX.crit[7] + 1).getValues();
  for (var i = data.length - 1; i >= 0; i--) {
    var r = data[i];
    if (String(r[IDX.tipo]).trim() !== 'HEADER') continue;
    if (String(r[IDX.cargo]).trim() !== cargo) continue;
    // Encontrado: parsear criterios
    var criterios = [];
    for (var k = 0; k < SLOTS_CRIT; k++) {
      var raw = String(r[IDX.crit[k]] || '').trim();
      if (!raw) continue;
      criterios.push(_parseCriterioSupervisora(raw));
    }
    return { rowIndex: i + 2, criterios: criterios };
  }
  return null;
}

// Garantiza que exista un HEADER vigente para el cargo con los criterios
// actuales del Maestro. Si el HEADER más reciente difiere, inserta uno nuevo
// al final con timestamp actual. Retorna los criterios "canónicos" a usar
// (los del HEADER vigente, que coincide con los del Maestro tras esta llamada).
function _ensureHeaderFor(sheet, cargo, criterios) {
  var vigente = _getHeaderVigente(sheet, cargo, 0);
  if (vigente && _criteriosCalzanConCargosConfig(vigente.criterios, criterios)) {
    return vigente.criterios;
  }
  // Insertar nuevo HEADER
  var row = _emptyEvalRow();
  row[IDX.tipo]      = 'HEADER';
  row[IDX.timestamp] = new Date();
  row[IDX.cargo]     = cargo;
  for (var i = 0; i < SLOTS_CRIT; i++) {
    row[IDX.crit[i]] = (i < criterios.length) ? _critToHeaderLabel(criterios[i]) : '';
  }
  sheet.appendRow(row);
  // Estilo: fila HEADER en gris claro + negrita
  var newRowIdx = sheet.getLastRow();
  sheet.getRange(newRowIdx, 1, 1, HEADERS_NUEVO.length).setBackground('#ececec').setFontWeight('bold');
  return criterios.slice();
}

// Compara criterios vigentes (parseados desde HEADER) con cargosConfig
// (del Maestro). Compara label + tipo en orden.
function _criteriosCalzanConCargosConfig(vigentes, actuales) {
  if (vigentes.length !== actuales.length) return false;
  for (var i = 0; i < vigentes.length; i++) {
    if (vigentes[i].label !== actuales[i].label) return false;
    if (vigentes[i].tipo  !== actuales[i].tipo)  return false;
  }
  return true;
}

function _emptyEvalRow() {
  var row = [];
  for (var i = 0; i < HEADERS_NUEVO.length; i++) row.push('');
  return row;
}

// ── Vocabulario canónico: strings literal de Tarifas 2026 (Maestro Trabajadores) ──
// Fuente de verdad única. Si cambia Tarifas 2026, actualizar aquí.

// ── Routing ──────────────────────────────────────────────────────────
// Si llega ?action=..., responde JSON (API mode para Cloudflare Pages frontend).
// Si no hay action, responde HTML (backwards compat con WebApp legacy).
function doGet(e) {
  var params = (e && e.parameter) ? e.parameter : {};
  var action = params.action || '';

  if (action) return _routeApi(action, params, null);

  var page = params.page || 'formulario';
  var file = (page === 'visualizador') ? 'visualizador_evento_v7' : 'formulario_supervisoras_v7';
  return HtmlService
    .createHtmlOutputFromFile(file)
    .setTitle(page === 'visualizador'
      ? 'Análisis de Eventos · Tinto Banquetería'
      : 'Evaluación de Supervisoras · Tinto Banquetería')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// doPost recibe JSON crudo (Content-Type text/plain para evitar preflight CORS).
// Body esperado: { action: 'submitEvaluacion', data: {...} }
function doPost(e) {
  var bodyRaw = (e && e.postData && e.postData.contents) ? e.postData.contents : '';
  var body    = {};
  try { body = bodyRaw ? JSON.parse(bodyRaw) : {}; } catch(err) { body = {}; }
  var params = (e && e.parameter) ? e.parameter : {};
  var action = body.action || params.action || '';
  return _routeApi(action, params, body);
}

// Router central. Devuelve siempre ContentService JSON.
function _routeApi(action, params, body) {
  try {
    var result;
    switch (action) {
      case 'formConfig':
        result = getFormConfig();
        break;
      case 'trabajadores':
        result = getTrabajadores();
        break;
      case 'centrosNovios':
        result = getCentrosAndNovios();
        break;
      case 'eventosPorFecha':
        result = getEventosPorFecha(params.fecha || (body && body.fecha) || '');
        break;
      case 'submitEvaluacion':
        var data = (body && body.data) ? body.data : null;
        if (!data) { result = { success: false, error: 'Falta data' }; break; }
        result = registrarEvaluacionSupervisora(data);
        break;
      case 'getEventosList':
        result = { eventos: getEventosList() };
        break;
      case 'getEventData':
        result = getEventData(params.noviosKey || (body && body.noviosKey) || '') || { error: 'No data' };
        break;
      case 'saveComentario':
        result = saveComentario(
          parseInt(params.rowIndex || (body && body.rowIndex), 10),
          parseInt(params.col || (body && body.col), 10),
          params.texto || (body && body.texto) || ''
        );
        break;
      case 'saveNota':
        result = saveNota(
          parseInt(params.rowIndex || (body && body.rowIndex), 10),
          parseInt(params.col || (body && body.col), 10),
          params.nota !== undefined ? params.nota : (body && body.nota)
        );
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

// ════════════════════════════════════════════════════════════════════
//  MAESTRO TRABAJADORES — Lista de nombres para autocompletado
//  Lee col B ("Nombre y Apellido") de la hoja "Inscripcion"
// ════════════════════════════════════════════════════════════════════
function getTrabajadores() {
  try {
    var ss    = SpreadsheetApp.openById(SHEET_MAESTRO_ID);
    var sheet = ss.getSheetByName(SHEET_INSCRIPCION);
    if (!sheet) {
      Logger.log('ERROR: No se encontró la hoja "' + SHEET_INSCRIPCION + '" en Maestro');
      return { nombres: [], error: 'Hoja Inscripcion no encontrada' };
    }
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return { nombres: [] };

    // Col B = índice 2 (1-based)
    var data = sheet.getRange(2, 2, lastRow - 1, 1).getValues();
    var set  = {};
    data.forEach(function(row) {
      var nombre = String(row[0] || '').trim();
      if (nombre.length >= 3) set[nombre] = true;
    });
    var nombres = Object.keys(set).sort(function(a, b) {
      return a.localeCompare(b, 'es');
    });
    Logger.log('Trabajadores cargados: ' + nombres.length);
    return { nombres: nombres };
  } catch(err) {
    Logger.log('getTrabajadores ERROR: ' + err.toString());
    return { nombres: [], error: err.toString() };
  }
}

// ════════════════════════════════════════════════════════════════════
//  AUX — Centros, Novios y Nombres de Cargo
//  Estructura Aux (con teléfonos intercalados):
//    Col B (idx 0 en array) = Novios/Evento
//    Col C (idx 1) = Código Evento
//    Col D (idx 2) = Super Metre
//    Col E (idx 3) = Tel SM  ← skip
//    Col F (idx 4) = Metre
//    Col G (idx 5) = Tel M   ← skip
//    Col H (idx 6) = Jefe de Cocina
//    Col I (idx 7) = Tel JC  ← skip
//    Col J (idx 8) = Jefe de Bar
//    Col K (idx 9) = Tel JB  ← skip
//    Col L (idx 10)= Jefa de Floristas
//    Col M (idx 11)= Tel JD  ← skip
// ════════════════════════════════════════════════════════════════════
function getCentrosAndNovios() {
  try {
    var ss    = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName(SHEET_AUX);
    if (!sheet) {
      return { centros: [], byCentro: {}, cargoNames: {}, error: 'Hoja Aux no encontrada' };
    }
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return { centros: [], byCentro: {}, cargoNames: {} };

    var data = sheet.getRange(2, 2, lastRow - 1, 12).getValues();

    var centroSet  = {};
    var byCentro   = {};
    var cargoNames = {
      superMetre:     [],
      metre:          [],
      jefeCocina:     [],
      jefeBar:        [],
      jefaFloristas: []
    };
    var cargoColMap = [
      { key: 'superMetre',     idx: 2  },
      { key: 'metre',          idx: 4  },
      { key: 'jefeCocina',     idx: 6  },
      { key: 'jefeBar',        idx: 8  },
      { key: 'jefaFloristas', idx: 10 }
    ];

    data.forEach(function(row) {
      var novio     = String(row[0] || '').trim();
      var codigoEvt = String(row[1] || '').trim();
      if (novio && novio.length >= 2) {
        var centro = codigoEvt.replace(/\s+\d{2}\/\d{2}\/\d{4}\s*$/, '').trim();
        if (!centro) centro = 'Sin centro asignado';
        centroSet[centro] = true;
        if (!byCentro[centro]) byCentro[centro] = [];
        if (byCentro[centro].indexOf(novio) < 0) byCentro[centro].push(novio);
      }
      cargoColMap.forEach(function(m) {
        var val = String(row[m.idx] || '').trim();
        if (val && cargoNames[m.key].indexOf(val) < 0) {
          cargoNames[m.key].push(val);
        }
      });
    });

    var centros = Object.keys(centroSet).sort(function(a, b) {
      if (a === 'Sin centro asignado') return 1;
      if (b === 'Sin centro asignado') return -1;
      return a.localeCompare(b, 'es');
    });

    return { centros: centros, byCentro: byCentro, cargoNames: cargoNames };

  } catch(err) {
    Logger.log('getCentrosAndNovios ERROR: ' + err.toString());
    return { centros: [], byCentro: {}, cargoNames: {}, error: err.toString() };
  }
}

// ════════════════════════════════════════════════════════════════════
//  CRM — Eventos por fecha
//  Lee hoja "CRM TINTO" del CRM General y devuelve los eventos
//  que coinciden con la fecha ISO indicada (yyyy-MM-dd).
//  Estructura CRM TINTO (datos desde fila 4):
//    Col H (idx 0 del rango) = Fecha Evento
//    Col M (idx 5 del rango) = Lugar / Centro de Eventos
//    Col N (idx 6 del rango) = Nombre / Novios
// ════════════════════════════════════════════════════════════════════
function getEventosPorFecha(fechaISO) {
  try {
    var ss    = SpreadsheetApp.openById(CRM_GENERAL_ID);
    var sheet = ss.getSheetByName('CRM TINTO');
    if (!sheet) return { eventos: [], error: 'Hoja CRM TINTO no encontrada' };

    var lastRow = sheet.getLastRow();
    if (lastRow < 4) return { eventos: [] };

    // Cols H(8) a N(14) = 7 columnas; datos desde fila 4
    var data = sheet.getRange(4, 8, lastRow - 3, 7).getValues();
    var tz   = Session.getScriptTimeZone();
    var eventos = [];
    var seen    = {};

    data.forEach(function(row) {
      var fechaEvento = row[0]; // col H
      var lugar  = String(row[5] || '').trim(); // col M
      var nombre = String(row[6] || '').trim(); // col N
      if (!lugar && !nombre) return;

      var isoStr = '';
      if (fechaEvento instanceof Date && !isNaN(fechaEvento.getTime())) {
        isoStr = Utilities.formatDate(fechaEvento, tz, 'yyyy-MM-dd');
      } else if (fechaEvento) {
        isoStr = String(fechaEvento).trim().slice(0, 10);
      }
      if (isoStr !== fechaISO) return;

      var label = (lugar && nombre) ? lugar + ' — ' + nombre : (lugar || nombre);
      if (seen[label]) return;
      seen[label] = true;
      eventos.push({ label: label, centro: lugar, novios: nombre });
    });

    return { eventos: eventos };
  } catch(err) {
    Logger.log('getEventosPorFecha ERROR: ' + err.toString());
    return { eventos: [], error: err.toString() };
  }
}

// ════════════════════════════════════════════════════════════════════
//  REGISTRO DE EVALUACIÓN — v36 schema HEADERs intercaladas
//
//  Por cada cargo evaluado, genera 1 fila EVAL con metadatos del evento.
//  Antes de escribir, asegura un HEADER vigente para cada cargo (lo inserta
//  si no existe o si los criterios actuales del Maestro difieren).
//
//  Secciones globales (Destacados / Alerta) se replican en TODAS las filas
//  EVAL del mismo timestamp para que cada fila sea self-contained.
// ════════════════════════════════════════════════════════════════════
function registrarEvaluacionSupervisora(data) {
  try {
    var ss    = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName(SHEET_EVAL);
    if (!sheet) throw new Error('Hoja "' + SHEET_EVAL + '" no encontrada');

    _ensureSchema(sheet);

    var formCfg = getFormConfig();
    if (!formCfg.ok) throw new Error('getFormConfig falló: ' + (formCfg.error || ''));

    var timestamp    = new Date();
    var fechaFmt     = _fmtFechaSafe(data.fecha);
    var centro       = String(data.centro || '').trim();
    var codigoEvento = centro && fechaFmt ? centro + ' ' + fechaFmt : (centro || fechaFmt);
    var supervisor   = String(data.supervisor || '').trim();
    var novios       = String(data.novios || '').trim();

    // Secciones globales (replicadas en cada EVAL del evento)
    var destac1      = String(data.destac_1 || '').trim();
    var destac2      = String(data.destac_2 || '').trim();
    var destac3      = String(data.destac_3 || '').trim();
    var destacCom    = String(data.destac_comentario || '').trim();
    var alerta       = String(data.alerta_trabajadores || '').trim();
    var alertaCom    = String(data.alerta_comentario || '').trim();

    var cargosResp = data.cargos || {};
    var filasEval  = [];

    // Para cada cargo del Maestro, primero garantizo HEADER vigente, luego
    // construyo la fila EVAL si hay respuesta para ese cargo.
    formCfg.cargos.forEach(function(c) {
      var resp = cargosResp[c.cargo];
      if (!resp) return;

      // Asegurar HEADER vigente del cargo (puede agregar fila si difiere)
      _ensureHeaderFor(sheet, c.cargo, c.criterios);

      // Multi-trabajador: si hay tags múltiples, los unimos con " / " para
      // mantener una fila por evaluación de cargo (la separación a múltiples
      // filas de Dashboard se hace en extraerFilasBonos).
      var nombre = '';
      if (_cargosMultiTrabajador()[c.cargo]) {
        // resp.nombre puede venir como string con " / " o multiTags es la fuente
        nombre = String(resp.nombre || '').trim();
      } else {
        nombre = String(resp.nombre || '').trim();
      }
      // Si el cargo no tiene nombre evaluado, igual lo registramos como fila
      // EVAL vacía? NO: solo si hay nombre. Si está vacío, no aporta data.
      if (!nombre) return;

      var row = _emptyEvalRow();
      row[IDX.tipo]         = 'EVAL';
      row[IDX.timestamp]    = timestamp;
      row[IDX.supervisor]   = supervisor;
      row[IDX.novios]       = novios;
      row[IDX.centro]       = centro;
      row[IDX.fechaEvento]  = fechaFmt;
      row[IDX.codigoEvento] = codigoEvento;
      row[IDX.cargo]        = c.cargo;
      row[IDX.nombre]       = nombre;
      row[IDX.cojefes]      = _cargosConCoJefe()[c.cargo] ? (resp.cojefes || '') : '';
      row[IDX.comentario]   = resp.comentario || '';

      // Crit_1..Crit_8 según orden de criterios del Maestro (que ahora coincide
      // con el HEADER vigente recién asegurado).
      c.criterios.forEach(function(crit, i) {
        if (i >= SLOTS_CRIT) return;
        var v = resp.criterios && resp.criterios[crit.label];
        if (crit.tipo === 'nota') {
          row[IDX.crit[i]] = (v === '' || v === null || v === undefined) ? '' : Number(v);
        } else {
          row[IDX.crit[i]] = (v === '' || v === null || v === undefined) ? '' : String(v).trim();
        }
      });

      // Replicar secciones globales
      row[IDX.destac[0]] = destac1;
      row[IDX.destac[1]] = destac2;
      row[IDX.destac[2]] = destac3;
      row[IDX.destacCom] = destacCom;
      row[IDX.alerta]    = alerta;
      row[IDX.alertaCom] = alertaCom;

      filasEval.push(row);
    });

    if (filasEval.length === 0) {
      Logger.log('registrarEvaluacion: ninguna fila EVAL generada (sin nombres).');
      return { success: true, warning: 'Sin cargos con nombre' };
    }

    // Batch append de todas las filas EVAL
    var startRow = sheet.getLastRow() + 1;
    sheet.getRange(startRow, 1, filasEval.length, HEADERS_NUEVO.length).setValues(filasEval);

    volcadoBonos();
    return { success: true };
  } catch(err) {
    Logger.log('registrarEvaluacion ERROR: ' + err.toString() + '\n' + err.stack);
    return { success: false, error: err.toString() };
  }
}

function _fmtFechaSafe(v) {
  if (!v) return '';
  // Intenta parsear yyyy-MM-dd → DD/MM/YYYY
  var s = String(v).trim();
  var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[3] + '/' + m[2] + '/' + m[1];
  return s;
}

// ════════════════════════════════════════════════════════════════════
//  VISUALIZADOR — Lista de eventos (schema v36)
//  Devuelve una entrada por (novios, centro) usando las filas EVAL más
//  recientes. Si hay varias evaluaciones del mismo evento, conserva la
//  fecha máxima.
// ════════════════════════════════════════════════════════════════════
function getEventosList() {
  try {
    var ss    = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName(SHEET_EVAL);
    if (!sheet) return [];
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return [];

    var data = sheet.getRange(2, 1, lastRow - 1, IDX.codigoEvento + 1).getValues();
    var seen = {};
    data.forEach(function(row) {
      if (String(row[IDX.tipo] || '').trim() !== 'EVAL') return;
      var novios = String(row[IDX.novios] || '').trim();
      var centro = String(row[IDX.centro] || '').trim();
      var fecha  = row[IDX.fechaEvento];
      if (novios.length < 2) return;
      var key = novios + '||' + centro;
      var fechaISO = '';
      var fechaStr = '';
      if (fecha instanceof Date && !isNaN(fecha.getTime())) {
        var dd   = String(fecha.getUTCDate()).padStart(2, '0');
        var mm   = String(fecha.getUTCMonth() + 1).padStart(2, '0');
        var yyyy = fecha.getUTCFullYear();
        fechaISO = yyyy + '-' + mm + '-' + dd;
        fechaStr = dd + '/' + mm + '/' + yyyy;
      } else if (fecha) {
        // string formato "DD/MM/YYYY"
        var s = String(fecha).trim();
        var m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
        if (m) { fechaISO = m[3] + '-' + m[2] + '-' + m[1]; fechaStr = s; }
        else { fechaISO = s; fechaStr = s; }
      }
      if (!seen[key] || fechaISO > seen[key].fechaISO) {
        seen[key] = { novios: novios, centro: centro, fechaISO: fechaISO, fechaStr: fechaStr };
      }
    });
    var result = Object.keys(seen).map(function(k) { return seen[k]; });
    result.sort(function(a, b) { return b.fechaISO.localeCompare(a.fechaISO); });
    return result;
  } catch(err) {
    Logger.log('getEventosList ERROR: ' + err.toString());
    return [];
  }
}

// ════════════════════════════════════════════════════════════════════
//  DATOS DE UN EVENTO ESPECÍFICO (schema v36)
//  Agrupa todas las filas EVAL del evento más reciente con novios=noviosKey.
//  Por cada fila EVAL construye un objeto cargo dinámicamente leyendo el
//  HEADER vigente para conocer label/tipo de cada criterio.
// ════════════════════════════════════════════════════════════════════
function getEventData(noviosKey) {
  try {
    var ss    = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName(SHEET_EVAL);
    if (!sheet) throw new Error('Hoja "' + SHEET_EVAL + '" no encontrada');
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return null;

    var data = sheet.getRange(2, 1, lastRow - 1, HEADERS_NUEVO.length).getValues();

    // Encontrar todas las EVAL con ese novios; agrupar por timestamp y tomar
    // el timestamp más reciente.
    var grupos = {}; // tsKey → { ts, rows: [{row, rowIndex}] }
    data.forEach(function(row, idx) {
      if (String(row[IDX.tipo] || '').trim() !== 'EVAL') return;
      if (String(row[IDX.novios] || '').trim() !== noviosKey) return;
      var ts = row[IDX.timestamp];
      var tsKey = (ts instanceof Date) ? ts.getTime() : String(ts);
      if (!grupos[tsKey]) grupos[tsKey] = { ts: ts, rows: [] };
      grupos[tsKey].rows.push({ row: row, rowIndex: idx + 2 });
    });
    var tsKeys = Object.keys(grupos);
    if (!tsKeys.length) return null;
    // Tomar el grupo de timestamp máximo
    var latestKey = tsKeys.sort(function(a, b) {
      return (grupos[b].ts instanceof Date ? grupos[b].ts.getTime() : 0)
           - (grupos[a].ts instanceof Date ? grupos[a].ts.getTime() : 0);
    })[0];
    var grupo = grupos[latestKey];
    if (!grupo.rows.length) return null;

    // Metadata del evento: tomar de la primera fila EVAL
    var primera = grupo.rows[0].row;
    function fechaToStr(v) {
      if (v instanceof Date && !isNaN(v.getTime())) {
        return String(v.getUTCDate()).padStart(2, '0') + '-' +
               String(v.getUTCMonth() + 1).padStart(2, '0') + '-' +
               v.getUTCFullYear();
      }
      var s = String(v || '').trim();
      var m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
      return m ? (m[1] + '-' + m[2] + '-' + m[3]) : s;
    }

    var cargos = grupo.rows.map(function(item) {
      var row      = item.row;
      var rowIndex = item.rowIndex;
      var cargoNm  = String(row[IDX.cargo] || '').trim();
      var vigente  = _getHeaderVigente(sheet, cargoNm, rowIndex) || { criterios: [] };

      // scores (numéricos) + binarios
      var scores = [], binarios = [];
      vigente.criterios.forEach(function(crit, i) {
        if (i >= SLOTS_CRIT) return;
        var raw = row[IDX.crit[i]];
        var col1based = IDX.crit[i] + 1; // 1-based para saveNota
        if (crit.tipo === 'nota') {
          var n = parseFloat(raw);
          scores.push({ label: crit.label, col: col1based, value: isNaN(n) ? '' : n });
        } else {
          binarios.push({ label: crit.label, col: col1based, value: String(raw || '').trim() });
        }
      });

      var notas = scores.map(function(s) { return s.value; }).filter(function(v) { return v !== '' && !isNaN(parseFloat(v)); });
      var prom  = notas.length ? Math.round(notas.reduce(function(a, b) { return a + parseFloat(b); }, 0) / notas.length * 10) / 10 : null;

      var bools = binarios.map(function(b) { return b.value; }).filter(function(v) { return v !== ''; });
      var notaOk = (prom === null) ? null : (prom >= NOTA_MIN_BONO);
      var boolOk = null;
      if (bools.length) {
        boolOk = bools.every(function(v) {
          var s = String(v).toLowerCase();
          return (s === 'sí' || s === 'si');
        });
      }
      var gano;
      if (notaOk !== null && boolOk !== null) gano = (notaOk && boolOk);
      else if (notaOk !== null)               gano = notaOk;
      else if (boolOk !== null)               gano = boolOk;
      else                                     gano = null;
      var bonoTxt = (gano === null) ? '—' : (gano ? 'SÍ' : 'NO');

      var tipo;
      if (scores.length && binarios.length) tipo = 'numeric+binary';
      else if (binarios.length)             tipo = 'binary';
      else                                  tipo = 'numeric';

      return {
        key:           _slugify(cargoNm),
        label:         cargoNm,
        tipo:          tipo,
        nombre:        String(row[IDX.nombre] || '').trim(),
        cojefes:       String(row[IDX.cojefes] || '').trim(),
        scores:        scores,
        binarios:      binarios,
        promedio:      prom,
        bono:          bonoTxt,
        comentario:    String(row[IDX.comentario] || '').trim(),
        comentarioCol: IDX.comentario + 1,
        rowIndex:      rowIndex
      };
    });

    return {
      rowIndex:         grupo.rows[0].rowIndex, // legacy compat
      supervisor:       String(primera[IDX.supervisor] || '').trim(),
      novios:           String(primera[IDX.novios] || '').trim(),
      centro:           String(primera[IDX.centro] || '').trim(),
      fecha:            fechaToStr(primera[IDX.fechaEvento]),
      notaMin:          NOTA_MIN_BONO,
      destacados:       [String(primera[IDX.destac[0]] || '').trim(),
                         String(primera[IDX.destac[1]] || '').trim(),
                         String(primera[IDX.destac[2]] || '').trim()].filter(Boolean),
      alerta:           String(primera[IDX.alerta] || '').trim(),
      destacComentario: String(primera[IDX.destacCom] || '').trim(),
      alertaComentario: String(primera[IDX.alertaCom] || '').trim(),
      cargos:           cargos
    };
  } catch(err) {
    Logger.log('getEventData ERROR: ' + err.toString() + '\n' + err.stack);
    throw err;
  }
}

function _slugify(s) {
  return String(s).toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

// ════════════════════════════════════════════════════════════════════
//  MIGRACIÓN one-shot: schema viejo v34 → v36 (HEADERs intercaladas)
//
//  La hoja vieja tiene cols dinámicas "{Cargo} · {Criterio}". Cada fila
//  es una evaluación completa (todos los cargos en una sola fila).
//  La hoja nueva tiene cols fijas A..Y con filas HEADER + EVAL.
//
//  Proceso:
//  1. Lee la hoja actual y detecta criterios por cargo desde los headers
//     "{Cargo} · {Criterio}".
//  2. Crea hoja "Evaluación Supervisoras v2" con schema v36.
//  3. Escribe 1 fila HEADER inicial por cargo con sus criterios actuales.
//     El tipo (nota/bool) se infiere mirando los valores en las filas
//     pobladas: si hay "Sí"/"No" → bool; si todos son numéricos → nota.
//  4. Por cada fila vieja, genera N filas EVAL (una por cargo con nombre),
//     replicando metadata del evento y secciones globales.
//  5. Renombra hoja vieja a "Evaluación Supervisoras (legacy v34)".
//  6. Renombra hoja nueva a "Evaluación Supervisoras".
//  7. Llama backfillBonos() para reconstruir Dashboard de Bonos.
//
//  EJECUTAR MANUALMENTE UNA SOLA VEZ desde el editor Apps Script.
//  Idempotente: si ya existe "(legacy v34)" o "v2", aborta.
// ════════════════════════════════════════════════════════════════════
function migrarASchemaHEADER() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var hVieja = ss.getSheetByName(SHEET_EVAL);
  if (!hVieja) throw new Error('No existe hoja "' + SHEET_EVAL + '"');

  var nombreVieja = SHEET_EVAL + ' (legacy v34)';
  var nombreNueva = SHEET_EVAL + ' v2';
  if (ss.getSheetByName(nombreVieja)) throw new Error('Ya existe "' + nombreVieja + '". Aborta.');
  if (ss.getSheetByName(nombreNueva)) throw new Error('Ya existe "' + nombreNueva + '". Aborta.');

  // 1. Leer hoja vieja
  var lastRowOld = hVieja.getLastRow();
  var lastColOld = hVieja.getLastColumn();
  if (lastRowOld < 2 || lastColOld < 1) throw new Error('Hoja vieja sin datos.');
  var headersOld = hVieja.getRange(1, 1, 1, lastColOld).getValues()[0].map(function(v) { return String(v || '').trim(); });
  var dataOld    = hVieja.getRange(2, 1, lastRowOld - 1, lastColOld).getValues();

  // Validar que sea schema v34 (primer header debe ser "Timestamp")
  if (headersOld[0] !== 'Timestamp') {
    throw new Error('Schema esperado v34: primer header debe ser "Timestamp", encontrado: "' + headersOld[0] + '"');
  }

  // 2. Detectar cargos y sus criterios desde los headers "{Cargo} · {Criterio}"
  //    Excluir sufijos especiales: "Nombre", "Comentario", "CoJefes", "Quién NO".
  var sufijosNoCriterio = { 'Nombre': true, 'Comentario': true, 'CoJefes': true, 'Quién NO': true };
  var cargosOrden = [];      // orden de aparición
  var cargosCrits = {};      // cargo → [{label, headerIdx}]
  var cargosNombreIdx = {};  // cargo → col idx de "Nombre"
  var cargosComentIdx = {};  // cargo → col idx de "Comentario"
  var cargosCoJefIdx  = {};  // cargo → col idx de "CoJefes"

  headersOld.forEach(function(h, idx) {
    var parts = h.split(' · ');
    if (parts.length < 2) return;
    var cargo  = parts[0].trim();
    var sufijo = parts.slice(1).join(' · ').trim();
    if (!cargo) return;
    if (cargosOrden.indexOf(cargo) === -1) {
      cargosOrden.push(cargo);
      cargosCrits[cargo] = [];
    }
    if (sufijo === 'Nombre')     { cargosNombreIdx[cargo] = idx; return; }
    if (sufijo === 'Comentario') { cargosComentIdx[cargo] = idx; return; }
    if (sufijo === 'CoJefes')    { cargosCoJefIdx[cargo]  = idx; return; }
    if (sufijosNoCriterio[sufijo]) return;
    cargosCrits[cargo].push({ label: sufijo, headerIdx: idx });
  });

  // 3. Inferir tipo de cada criterio mirando los valores en filas pobladas.
  //    Heurística: si CUALQUIER valor poblado es "Sí"/"No"/"Si"/"NO" → bool.
  //    Sino → nota.
  function detectarTipo(headerIdx) {
    var tipo = 'nota';
    for (var i = 0; i < dataOld.length; i++) {
      var v = dataOld[i][headerIdx];
      if (v === '' || v === null || v === undefined) continue;
      var s = String(v).trim().toLowerCase();
      if (s === 'sí' || s === 'si' || s === 'no') return 'bool';
    }
    return tipo;
  }
  cargosOrden.forEach(function(cargo) {
    cargosCrits[cargo].forEach(function(crit) {
      crit.tipo = detectarTipo(crit.headerIdx);
    });
  });

  // 4. Crear hoja nueva con schema v36
  var hNueva = ss.insertSheet(nombreNueva);
  hNueva.getRange(1, 1, 1, HEADERS_NUEVO.length).setValues([HEADERS_NUEVO]);
  hNueva.getRange(1, 1, 1, HEADERS_NUEVO.length).setFontWeight('bold').setBackground('#2a2a2a').setFontColor('#ffffff');
  hNueva.setFrozenRows(1);

  // Buffer de filas a escribir
  var bufferRows = [];
  var headerRowIndices = []; // 0-based en bufferRows, para format

  // 5. Una fila HEADER por cargo (con timestamp ficticio = primera evaluación)
  var primerTs = null;
  for (var pi = 0; pi < dataOld.length; pi++) {
    if (dataOld[pi][0] instanceof Date) { primerTs = dataOld[pi][0]; break; }
  }
  if (!primerTs) primerTs = new Date('2024-01-01');

  cargosOrden.forEach(function(cargo) {
    if (!cargosCrits[cargo] || !cargosCrits[cargo].length) return;
    var row = _emptyEvalRow();
    row[IDX.tipo]      = 'HEADER';
    row[IDX.timestamp] = primerTs;
    row[IDX.cargo]     = cargo;
    cargosCrits[cargo].forEach(function(crit, i) {
      if (i >= SLOTS_CRIT) return;
      row[IDX.crit[i]] = _critToHeaderLabel({ label: crit.label, tipo: crit.tipo });
    });
    headerRowIndices.push(bufferRows.length);
    bufferRows.push(row);
  });

  // 6. Transcribir cada fila vieja a N filas EVAL (una por cargo con nombre)
  function valStr(rowOld, idx) {
    if (idx === undefined || idx < 0) return '';
    var v = rowOld[idx];
    return (v === undefined || v === null) ? '' : String(v).trim();
  }
  function valNum(rowOld, idx) {
    if (idx === undefined || idx < 0) return '';
    var n = parseFloat(rowOld[idx]);
    return isNaN(n) ? '' : n;
  }
  function fechaFmt(v) {
    if (v instanceof Date && !isNaN(v.getTime())) {
      return String(v.getUTCDate()).padStart(2, '0') + '/' +
             String(v.getUTCMonth() + 1).padStart(2, '0') + '/' +
             v.getUTCFullYear();
    }
    return String(v || '').trim();
  }

  var totalEvals = 0;
  dataOld.forEach(function(rowOld) {
    var timestamp = rowOld[0] instanceof Date ? rowOld[0] : new Date();
    var supervisor = valStr(rowOld, headersOld.indexOf('Supervisor'));
    var novios     = valStr(rowOld, headersOld.indexOf('Novios'));
    var centro     = valStr(rowOld, headersOld.indexOf('Centro'));
    var fechaRaw   = rowOld[headersOld.indexOf('Fecha Evento')];
    var fechaStr   = fechaFmt(fechaRaw);
    var codigoEvt  = valStr(rowOld, headersOld.indexOf('Código Evento'))
                     || (centro && fechaStr ? centro + ' ' + fechaStr : (centro || fechaStr));

    var destac1   = valStr(rowOld, headersOld.indexOf('Destacado 1'));
    var destac2   = valStr(rowOld, headersOld.indexOf('Destacado 2'));
    var destac3   = valStr(rowOld, headersOld.indexOf('Destacado 3'));
    var destacCom = valStr(rowOld, headersOld.indexOf('Destacado Comentario'));
    var alerta    = valStr(rowOld, headersOld.indexOf('Alerta Trabajadores'));
    var alertaCom = valStr(rowOld, headersOld.indexOf('Alerta Comentario'));

    cargosOrden.forEach(function(cargo) {
      var crits = cargosCrits[cargo];
      if (!crits || !crits.length) return;
      var nombre = valStr(rowOld, cargosNombreIdx[cargo]);
      if (!nombre) return;

      var row = _emptyEvalRow();
      row[IDX.tipo]         = 'EVAL';
      row[IDX.timestamp]    = timestamp;
      row[IDX.supervisor]   = supervisor;
      row[IDX.novios]       = novios;
      row[IDX.centro]       = centro;
      row[IDX.fechaEvento]  = fechaStr;
      row[IDX.codigoEvento] = codigoEvt;
      row[IDX.cargo]        = cargo;
      row[IDX.nombre]       = nombre;
      row[IDX.cojefes]      = valStr(rowOld, cargosCoJefIdx[cargo]);
      row[IDX.comentario]   = valStr(rowOld, cargosComentIdx[cargo]);

      crits.forEach(function(crit, i) {
        if (i >= SLOTS_CRIT) return;
        if (crit.tipo === 'nota') {
          row[IDX.crit[i]] = valNum(rowOld, crit.headerIdx);
        } else {
          var raw = valStr(rowOld, crit.headerIdx);
          row[IDX.crit[i]] = raw; // se mantiene tal cual (Sí/No/vacío)
        }
      });

      row[IDX.destac[0]] = destac1;
      row[IDX.destac[1]] = destac2;
      row[IDX.destac[2]] = destac3;
      row[IDX.destacCom] = destacCom;
      row[IDX.alerta]    = alerta;
      row[IDX.alertaCom] = alertaCom;

      bufferRows.push(row);
      totalEvals++;
    });
  });

  // 7. Escribir todo en batch
  if (bufferRows.length === 0) throw new Error('Migración no generó filas.');
  hNueva.getRange(2, 1, bufferRows.length, HEADERS_NUEVO.length).setValues(bufferRows);

  // Formato de filas HEADER
  headerRowIndices.forEach(function(i) {
    hNueva.getRange(i + 2, 1, 1, HEADERS_NUEVO.length).setBackground('#ececec').setFontWeight('bold');
  });

  // 8. Renombrar hojas
  hVieja.setName(nombreVieja);
  hNueva.setName(SHEET_EVAL);

  Logger.log('migrarASchemaHEADER OK: ' + cargosOrden.length + ' cargos, ' +
             headerRowIndices.length + ' HEADERs, ' + totalEvals + ' EVALs.');

  // 9. Reconstruir Dashboard de Bonos
  backfillBonos();

  return {
    success: true,
    cargos: cargosOrden.length,
    headers: headerRowIndices.length,
    evals: totalEvals
  };
}

// ════════════════════════════════════════════════════════════════════
//  MIGRACIÓN HISTÓRICA LEGACY (schema abreviado SM/M/JC/JB/JD/EN/...)
//
//  Fuentes:
//   - Hoja "Antiguos": ~586 filas, SIN headers, data desde row 1.
//     Schema legacy abreviado idéntico al de "(legacy v34)".
//   - Hoja "Evaluación Supervisoras (legacy v34)": headers en row 1,
//     ~45 filas de data desde row 5 (rows 2-4 vacías).
//
//  Estructura legacy detectada en headers de "(legacy v34)" row 1:
//   Col 1-6: Timestamp, Supervisor, Novios/Evento, Centro, Fecha, Jefe Logística
//   Cols 7+: bloques por cargo, con prefijo "{Pref} - {Criterio} ({tipo})":
//     SM (Super-Metre) → Super metre
//     M  (Metre)       → Metre
//     JC (Jefe Cocina) → Jefe Cocina
//     JB (Jefe de Bar) → Jefe de Bar  [incluye criterios bool]
//     JD (Jefa Decoración) → Jefa de Floristas (rebautizado)
//     EN (Encargado Novios)→ Asignación Encargados Novios
//     JT, JG, CB, CC   → DESCARTADOS (no existen en Maestro_Bonos hoy)
//   Cada bloque: "Nombre {Cargo}", criterios "{Pref} - {label} ({tipo})",
//   y "{Pref} - Comentario". Algunos bloques tienen "{Pref} - Si No, quién"
//   tras criterios bool (se ignora — era follow-up del schema viejo).
//   Al final: Trabajador Destacado 1/2/3.
//
//  Output: agrega filas HEADER + EVAL a la hoja "Evaluación Supervisoras"
//  (que ya tiene schema v36). Limpia HEADERs/EVALs previos antes de escribir
//  (idempotente).
// ════════════════════════════════════════════════════════════════════
function migrarHistoricoLegacy() {
  var ss      = SpreadsheetApp.openById(SHEET_ID);
  var hLegacy = ss.getSheetByName(SHEET_EVAL + ' (legacy v34)');
  var hAntig  = ss.getSheetByName('Antiguos');
  var hNueva  = ss.getSheetByName(SHEET_EVAL);
  if (!hLegacy) throw new Error('No existe hoja "' + SHEET_EVAL + ' (legacy v34)"');
  if (!hAntig)  throw new Error('No existe hoja "Antiguos"');
  if (!hNueva)  throw new Error('No existe hoja "' + SHEET_EVAL + '" (schema v36)');

  // 1. Mapeo prefijo legacy → cargo canónico v36
  var MAPEO_LEGACY = {
    'SM': { cargo: 'Super metre',                   nombreHeader: 'Nombre Super-Metre' },
    'M':  { cargo: 'Metre',                          nombreHeader: 'Nombre Metre' },
    'JC': { cargo: 'Jefe Cocina',                    nombreHeader: 'Nombre Jefe de Cocina' },
    'JB': { cargo: 'Jefe de Bar',                    nombreHeader: 'Nombre Jefe de Bar' },
    'JD': { cargo: 'Jefa de Floristas',              nombreHeader: 'Nombre Jefa de Decoración' },
    'EN': { cargo: 'Asignación Encargados Novios',   nombreHeader: 'Nombre Encargado de Novios' }
  };
  var SKIP_PREFIXES = { 'JT': true, 'JG': true, 'CB': true, 'CC': true };

  // 2. Leer headers de "(legacy v34)" row 1
  var lastColL  = hLegacy.getLastColumn();
  var headersL  = hLegacy.getRange(1, 1, 1, lastColL).getValues()[0].map(function(v) { return String(v || '').trim(); });

  // 3. Construir estructura por cargo: {cargo → {nombreCol, comentCol, criterios:[{label,tipo,col}]}}
  // Las cols son 0-based índices en la fila legacy.
  var estructura  = {};  // cargo → struct
  var ordenCargos = [];  // orden de aparición

  headersL.forEach(function(h, idx) {
    // Header de Nombre: "Nombre Super-Metre", "Nombre Metre", etc.
    var mNombre = h.match(/^Nombre\s+(.+)$/i);
    if (mNombre) {
      var nombreText = mNombre[1].trim();
      // Buscar qué prefijo le corresponde
      for (var pref in MAPEO_LEGACY) {
        if (MAPEO_LEGACY[pref].nombreHeader.toLowerCase() === ('Nombre ' + nombreText).toLowerCase()) {
          var info = MAPEO_LEGACY[pref];
          if (!estructura[info.cargo]) {
            estructura[info.cargo] = { prefijo: pref, nombreCol: idx, comentCol: -1, criterios: [] };
            ordenCargos.push(info.cargo);
          }
          break;
        }
      }
      return;
    }
    // Header criterio o comentario: "{Pref} - {resto}"
    var mPref = h.match(/^([A-Z]+)\s*-\s*(.+)$/);
    if (!mPref) return;
    var prefijo = mPref[1];
    var resto   = mPref[2].trim();
    if (SKIP_PREFIXES[prefijo]) return;
    if (!MAPEO_LEGACY[prefijo]) return;
    var cargo = MAPEO_LEGACY[prefijo].cargo;
    if (!estructura[cargo]) {
      estructura[cargo] = { prefijo: prefijo, nombreCol: -1, comentCol: -1, criterios: [] };
      ordenCargos.push(cargo);
    }
    var st = estructura[cargo];

    if (/^comentario$/i.test(resto)) { st.comentCol = idx; return; }
    // Follow-ups del schema viejo: "Si No, quién", "Si No conteo, quién",
    // "Si No barra, quién", etc. Patrón: empieza con "Si No" y termina con "quién".
    if (/^si\s+no\b.*\bqui[eé]n\b\s*\??$/i.test(resto)) return;

    // Detectar tipo desde sufijo
    var tipo = 'nota';
    var label = resto;
    var m07 = resto.match(/^(.+?)\s*\(\s*(?:0\s*[-a/]\s*7)\s*\)\s*$/i);
    if (m07) { tipo = 'nota'; label = m07[1].trim(); }
    else {
      var mB = resto.match(/^(.+?)\s*\(\s*(?:s[ií]\s*\/\s*no|y\s*\/\s*n)\s*\)\s*$/i);
      if (mB) { tipo = 'bool'; label = mB[1].trim(); }
    }
    if (st.criterios.length < SLOTS_CRIT) {
      st.criterios.push({ label: label, tipo: tipo, col: idx });
    }
  });

  Logger.log('Estructura legacy detectada:');
  ordenCargos.forEach(function(cargo) {
    var st = estructura[cargo];
    Logger.log('  ' + cargo + ' (' + st.prefijo + '): nombreCol=' + st.nombreCol +
               ', comentCol=' + st.comentCol + ', criterios=' + st.criterios.length +
               ' [' + st.criterios.map(function(c) { return c.label + '(' + c.tipo + ')'; }).join(', ') + ']');
  });

  // Helper: parsear fecha de string o Date
  function parseFecha(v) {
    if (v instanceof Date && !isNaN(v.getTime())) return v;
    var s = String(v || '').trim();
    if (!s) return null;
    // Formato DD-MM-YYYY o DD/MM/YYYY [HH:mm:ss]
    var m = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/);
    if (m) {
      var d = new Date(parseInt(m[3], 10), parseInt(m[2], 10) - 1, parseInt(m[1], 10),
                        parseInt(m[4] || '0', 10), parseInt(m[5] || '0', 10), parseInt(m[6] || '0', 10));
      return isNaN(d.getTime()) ? null : d;
    }
    return null;
  }
  function fechaToStr(d) {
    if (!(d instanceof Date) || isNaN(d.getTime())) return '';
    return String(d.getDate()).padStart(2, '0') + '/' +
           String(d.getMonth() + 1).padStart(2, '0') + '/' +
           d.getFullYear();
  }

  // 4. Leer data de ambas hojas legacy
  // - Antiguos: desde row 1, sin headers. Lee hasta lastCol de Antiguos.
  // - Legacy v34: desde row 5 (rows 2-4 son vacías por convención).
  var dataAntig = [];
  if (hAntig.getLastRow() >= 1) {
    dataAntig = hAntig.getRange(1, 1, hAntig.getLastRow(), Math.max(hAntig.getLastColumn(), lastColL)).getValues();
  }
  var dataLegacy = [];
  if (hLegacy.getLastRow() >= 2) {
    dataLegacy = hLegacy.getRange(2, 1, hLegacy.getLastRow() - 1, lastColL).getValues();
  }
  Logger.log('Antiguos: ' + dataAntig.length + ' rows, Legacy v34: ' + dataLegacy.length + ' rows.');

  // 5. Procesar todas las filas y generar EVALs
  var todasEvals = []; // {timestamp, fechaEvento, cargo, rowEval}
  var trabajadoresDestacadosColIdx = [];
  ['Trabajador Destacado 1', 'Trabajador Destacado 2', 'Trabajador Destacado 3'].forEach(function(lbl) {
    var i = headersL.indexOf(lbl);
    if (i >= 0) trabajadoresDestacadosColIdx.push(i);
  });

  function procesarFila(rowOld) {
    var timestamp = parseFecha(rowOld[0]);
    if (!timestamp) return; // skip sin fecha
    var supervisor = String(rowOld[1] || '').trim();
    var novios     = String(rowOld[2] || '').trim();
    var centro     = String(rowOld[3] || '').trim();
    var fechaEvt   = parseFecha(rowOld[4]) || timestamp;
    var fechaStr   = fechaToStr(fechaEvt);
    var codigoEvt  = centro && fechaStr ? centro + ' ' + fechaStr : (centro || fechaStr);

    // Destacados (replicados en cada EVAL de esta fila)
    var destac1 = trabajadoresDestacadosColIdx[0] >= 0 ? String(rowOld[trabajadoresDestacadosColIdx[0]] || '').trim() : '';
    var destac2 = trabajadoresDestacadosColIdx[1] >= 0 ? String(rowOld[trabajadoresDestacadosColIdx[1]] || '').trim() : '';
    var destac3 = trabajadoresDestacadosColIdx[2] >= 0 ? String(rowOld[trabajadoresDestacadosColIdx[2]] || '').trim() : '';

    ordenCargos.forEach(function(cargo) {
      var st = estructura[cargo];
      if (st.nombreCol < 0) return;
      var nombre = String(rowOld[st.nombreCol] || '').trim();
      if (!nombre) return;

      var row = _emptyEvalRow();
      row[IDX.tipo]         = 'EVAL';
      row[IDX.timestamp]    = timestamp;
      row[IDX.supervisor]   = supervisor;
      row[IDX.novios]       = novios;
      row[IDX.centro]       = centro;
      row[IDX.fechaEvento]  = fechaStr;
      row[IDX.codigoEvento] = codigoEvt;
      row[IDX.cargo]        = cargo;
      row[IDX.nombre]       = nombre;
      row[IDX.cojefes]      = '';
      row[IDX.comentario]   = st.comentCol >= 0 ? String(rowOld[st.comentCol] || '').trim() : '';

      st.criterios.forEach(function(crit, i) {
        if (i >= SLOTS_CRIT) return;
        var raw = rowOld[crit.col];
        if (crit.tipo === 'nota') {
          var n = parseFloat(raw);
          row[IDX.crit[i]] = isNaN(n) ? '' : n;
        } else {
          row[IDX.crit[i]] = (raw === '' || raw === null || raw === undefined) ? '' : String(raw).trim();
        }
      });

      row[IDX.destac[0]] = destac1;
      row[IDX.destac[1]] = destac2;
      row[IDX.destac[2]] = destac3;
      row[IDX.destacCom] = '';
      row[IDX.alerta]    = '';
      row[IDX.alertaCom] = '';

      todasEvals.push({ timestamp: timestamp, cargo: cargo, row: row });
    });
  }

  dataAntig.forEach(procesarFila);
  dataLegacy.forEach(procesarFila);

  Logger.log('Total EVALs generadas: ' + todasEvals.length);

  // 6. Determinar fecha mínima por cargo (para timestamp del HEADER histórico)
  var minTsPorCargo = {};
  todasEvals.forEach(function(e) {
    if (!minTsPorCargo[e.cargo] || e.timestamp < minTsPorCargo[e.cargo]) {
      minTsPorCargo[e.cargo] = e.timestamp;
    }
  });

  // 7. Construir HEADERs históricos (1 por cargo, con timestamp = min de ese cargo)
  var headerHistRows = [];
  ordenCargos.forEach(function(cargo) {
    var st = estructura[cargo];
    if (!minTsPorCargo[cargo]) return; // cargo sin evaluaciones, skip HEADER
    var row = _emptyEvalRow();
    row[IDX.tipo]      = 'HEADER';
    row[IDX.timestamp] = minTsPorCargo[cargo];
    row[IDX.cargo]     = cargo;
    st.criterios.forEach(function(crit, i) {
      if (i >= SLOTS_CRIT) return;
      row[IDX.crit[i]] = _critToHeaderLabel({ label: crit.label, tipo: crit.tipo });
    });
    headerHistRows.push(row);
  });

  // 8. Ordenar TODO: HEADERs + EVALs cronológicamente por timestamp.
  //    Si hay tie, HEADER va antes que EVAL del mismo timestamp.
  var allRows = []
    .concat(headerHistRows.map(function(r) { return { ts: r[IDX.timestamp], tipo: 'HEADER', row: r }; }))
    .concat(todasEvals.map(function(e) { return { ts: e.timestamp, tipo: 'EVAL', row: e.row }; }));
  allRows.sort(function(a, b) {
    var ta = a.ts instanceof Date ? a.ts.getTime() : 0;
    var tb = b.ts instanceof Date ? b.ts.getTime() : 0;
    if (ta !== tb) return ta - tb;
    if (a.tipo === 'HEADER' && b.tipo !== 'HEADER') return -1;
    if (b.tipo === 'HEADER' && a.tipo !== 'HEADER') return 1;
    return 0;
  });

  // 9. Limpiar todo el contenido de la hoja v36 (excepto row 1: headers)
  var lastRowNueva = hNueva.getLastRow();
  if (lastRowNueva >= 2) {
    hNueva.getRange(2, 1, lastRowNueva - 1, HEADERS_NUEVO.length).clear();
  }

  // 10. Construir el HEADER "actual" (con criterios del Maestro_Bonos hoy)
  //     Si difieren del HEADER histórico, los agregamos después de las EVALs.
  var formCfg = getFormConfig();
  var headerActualRows = [];
  if (formCfg.ok) {
    var nowTs = new Date();
    formCfg.cargos.forEach(function(c) {
      // Buscar HEADER histórico del cargo
      var hh = headerHistRows.find(function(r) { return r[IDX.cargo] === c.cargo; });
      // Comparar criterios actuales vs históricos
      var critsHistoricos = hh ? extractCritsFromHeaderRow(hh) : [];
      var iguales = critsHistoricos.length === c.criterios.length;
      if (iguales) {
        for (var i = 0; i < c.criterios.length; i++) {
          if (critsHistoricos[i].label !== c.criterios[i].label || critsHistoricos[i].tipo !== c.criterios[i].tipo) {
            iguales = false; break;
          }
        }
      }
      if (iguales) return; // mismo schema, no agregamos HEADER nuevo
      // Cambiaron criterios: agregar HEADER nuevo al final con timestamp ahora
      var row = _emptyEvalRow();
      row[IDX.tipo]      = 'HEADER';
      row[IDX.timestamp] = nowTs;
      row[IDX.cargo]     = c.cargo;
      c.criterios.forEach(function(crit, i) {
        if (i >= SLOTS_CRIT) return;
        row[IDX.crit[i]] = _critToHeaderLabel(crit);
      });
      headerActualRows.push(row);
    });
  }
  // Agregar headerActualRows al final de allRows
  headerActualRows.forEach(function(r) {
    allRows.push({ ts: r[IDX.timestamp], tipo: 'HEADER', row: r });
  });

  // 11. Escribir batch
  if (allRows.length === 0) throw new Error('Migración no generó filas.');
  var matriz = allRows.map(function(r) { return r.row; });
  hNueva.getRange(2, 1, matriz.length, HEADERS_NUEVO.length).setValues(matriz);

  // Format filas HEADER
  for (var i = 0; i < allRows.length; i++) {
    if (allRows[i].tipo === 'HEADER') {
      hNueva.getRange(i + 2, 1, 1, HEADERS_NUEVO.length).setBackground('#ececec').setFontWeight('bold');
    }
  }

  Logger.log('migrarHistoricoLegacy OK: ' + ordenCargos.length + ' cargos, ' +
             headerHistRows.length + ' HEADERs históricos, ' + headerActualRows.length +
             ' HEADERs actuales, ' + todasEvals.length + ' EVALs.');

  // 12. Reconstruir Dashboard de Bonos
  backfillBonos();

  return {
    success: true,
    cargos: ordenCargos.length,
    headersHistoricos: headerHistRows.length,
    headersActuales: headerActualRows.length,
    evals: todasEvals.length
  };
}

// Extrae los criterios parseados desde una fila HEADER (cols L..S)
function extractCritsFromHeaderRow(row) {
  var crits = [];
  for (var i = 0; i < SLOTS_CRIT; i++) {
    var raw = String(row[IDX.crit[i]] || '').trim();
    if (!raw) break;
    crits.push(_parseCriterioSupervisora(raw));
  }
  return crits;
}

// ════════════════════════════════════════════════════════════════════
//  GUARDAR COMENTARIO / NOTA
// ════════════════════════════════════════════════════════════════════
function saveComentario(rowIndex, col1based, texto) {
  try {
    var sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_EVAL);
    sheet.getRange(rowIndex, col1based).setValue(texto);
    return { success: true };
  } catch(err) { return { success: false, error: err.toString() }; }
}

function saveNota(rowIndex, col1based, nota) {
  try {
    var sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_EVAL);
    var val = (nota===''||nota===null||nota===undefined) ? '' : parseFloat(nota);
    sheet.getRange(rowIndex, col1based).setValue(isNaN(val)?'':val);
    return { success: true };
  } catch(err) { return { success: false, error: err.toString() }; }
}

// ════════════════════════════════════════════════════════════════════
//  HELPER
// ════════════════════════════════════════════════════════════════════
function toNum(val) {
  if (val===''||val===null||val===undefined) return '';
  var n=parseFloat(val); return isNaN(n)?'':n;
}

// ════════════════════════════════════════════════════════════════════
//  DASHBOARD DE BONOS
//  Estructura de la hoja "Dashboard de Bonos":
//    Col A: Timestamp evaluación
//    Col B: Centro de Evento
//    Col C: Novios
//    Col D: Fecha Evento
//    Col E: Código Evento (Centro + Fecha)
//    Col F: Nombre Trabajador
//    Col G: Cargo
//    Col H: ¿Ganó Bono? (SÍ / NO / —)
//    Col I: Nota Promedio (cargos numéricos) o vacío
//    Col J: Supervisor
//    Col K: Fecha Evaluación
//
//  Una fila por trabajador evaluado.
//  Para EN (Asignación Encargados Novios) con múltiples nombres separados
//  por " / ", se genera una fila por cada nombre.
// ════════════════════════════════════════════════════════════════════

var SHEET_BONOS   = 'Dashboard de Bonos';
var HEADER_BONOS  = [
  'Timestamp Evaluación',
  'Centro de Evento',
  'Novios',
  'Fecha Evento',
  'Código Evento',
  'Nombre Trabajador',
  'Cargo',
  '¿Ganó Bono?',
  'Nota Promedio',
  'Supervisor',
  'Fecha Evaluación',
  // Cols 12-21 (índices 11-20): criterios individuales en orden Maestro_Bonos.
  // Valor de cada criterio (nota numérica o SI/NO). Los criterios inactivos quedan vacíos.
  'Crit 1', 'Crit 2', 'Crit 3', 'Crit 4', 'Crit 5',
  'Crit 6', 'Crit 7', 'Crit 8', 'Crit 9', 'Crit 10'
];

// ── Asegura que la hoja Dashboard de Bonos exista con encabezados ──
function ensureBonosSheet(ss) {
  var sheet = ss.getSheetByName(SHEET_BONOS);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_BONOS);
    sheet.appendRow(HEADER_BONOS);
    // Formato encabezado
    var hRange = sheet.getRange(1, 1, 1, HEADER_BONOS.length);
    hRange.setFontWeight('bold');
    hRange.setBackground('#2a2a2a');
    hRange.setFontColor('#ffffff');
    sheet.setFrozenRows(1);
    // Ancho de columnas
    sheet.setColumnWidth(1, 160); // Timestamp
    sheet.setColumnWidth(2, 160); // Centro
    sheet.setColumnWidth(3, 200); // Novios
    sheet.setColumnWidth(4, 110); // Fecha Evento
    sheet.setColumnWidth(5, 200); // Código Evento
    sheet.setColumnWidth(6, 200); // Nombre Trabajador
    sheet.setColumnWidth(7, 160); // Cargo
    sheet.setColumnWidth(8, 100); // ¿Ganó Bono?
    sheet.setColumnWidth(9, 110); // Nota Promedio
    sheet.setColumnWidth(10, 160); // Supervisor
    sheet.setColumnWidth(11, 140); // Fecha Evaluación
  }
  return sheet;
}

// ── Calcula promedio de un array de valores numéricos ──
function calcProm(vals) {
  var nums = vals.filter(function(v) { return v !== '' && v !== null && !isNaN(parseFloat(v)); });
  if (!nums.length) return null;
  return Math.round(nums.reduce(function(a, b) { return a + parseFloat(b); }, 0) / nums.length * 10) / 10;
}

// ── Extrae las filas de bonos a partir de una fila EVAL del sheet ──
// row: array 0-indexed con los valores de la fila EVAL (cols A..Y, schema v36)
// sheet: la hoja (para resolver el HEADER vigente del cargo)
// rowIndex: 1-based, fila de la EVAL (para acotar la búsqueda de HEADER)
// Retorna un array de filas para el Dashboard de Bonos (1 por trabajador).
function extraerFilasBonos(row, sheet, rowIndex) {
  if (String(row[IDX.tipo] || '').trim() !== 'EVAL') return [];

  var timestamp  = row[IDX.timestamp] instanceof Date ? row[IDX.timestamp] : new Date();
  var supervisor = String(row[IDX.supervisor] || '').trim();
  var novios     = String(row[IDX.novios] || '').trim();
  var centro     = String(row[IDX.centro] || '').trim();
  var cargo      = String(row[IDX.cargo] || '').trim();
  var nombreRaw  = String(row[IDX.nombre] || '').trim();
  if (!cargo || !nombreRaw) return [];

  var fechaRaw = row[IDX.fechaEvento];
  var fechaStr = '';
  if (fechaRaw instanceof Date && !isNaN(fechaRaw.getTime())) {
    fechaStr = String(fechaRaw.getUTCDate()).padStart(2, '0') + '/' +
               String(fechaRaw.getUTCMonth() + 1).padStart(2, '0') + '/' +
               fechaRaw.getUTCFullYear();
  } else {
    fechaStr = String(fechaRaw || '').trim();
  }
  var codigoEvento = String(row[IDX.codigoEvento] || '').trim()
                     || (centro && fechaStr ? centro + ' ' + fechaStr : (centro || fechaStr));

  // Resolver HEADER vigente del cargo
  var vigente = _getHeaderVigente(sheet, cargo, rowIndex);
  if (!vigente || !vigente.criterios.length) {
    Logger.log('extraerFilasBonos: sin HEADER vigente para cargo "' + cargo + '" en fila ' + rowIndex);
    return [];
  }

  // Mapear valores Crit_1..Crit_8 al tipo definido por el HEADER
  var notas = [], bools = [], critValues = [];
  vigente.criterios.forEach(function(crit, i) {
    if (i >= SLOTS_CRIT) return;
    var raw = row[IDX.crit[i]];
    if (crit.tipo === 'nota') {
      var n = parseFloat(raw);
      var nVal = isNaN(n) ? '' : n;
      notas.push(nVal);
      critValues.push(nVal);
    } else {
      var b = (raw === '' || raw === null || raw === undefined) ? '' : String(raw).trim();
      bools.push(b);
      critValues.push(_normSiNo(b));
    }
  });
  while (critValues.length < 10) critValues.push('');

  // Bono ganado = promedio_notas >= NOTA_MIN  Y  todos_booleanos === SI
  var notasOk = notas.filter(function(v) { return v !== '' && !isNaN(parseFloat(v)); });
  var boolsOk = bools.filter(function(v) { return v !== '' && v !== null; });
  var prom    = notasOk.length ? Math.round(notasOk.reduce(function(a, b) { return a + parseFloat(b); }, 0) / notasOk.length * 10) / 10 : null;

  var notaOk = (prom === null) ? null : (prom >= NOTA_MIN_BONO);
  var boolOk = null;
  if (boolsOk.length) {
    boolOk = boolsOk.every(function(v) {
      var s = String(v || '').trim().toLowerCase();
      return (s === 'sí' || s === 'si' || s === '1' || s === 'true' || s === 'yes' || s === 'y');
    });
  }
  var gano;
  if (notaOk !== null && boolOk !== null) gano = (notaOk && boolOk);
  else if (notaOk !== null)               gano = notaOk;
  else if (boolOk !== null)               gano = boolOk;
  else                                     gano = null;
  var ganoTxt = (gano === null) ? '—' : (gano ? 'SÍ' : 'NO');

  // Multi-trabajador: expandir en N filas
  var nombres = _cargosMultiTrabajador()[cargo]
    ? nombreRaw.split(/[\/,;]/).map(function(s) { return s.trim(); }).filter(Boolean)
    : [nombreRaw];

  var filas = [];
  nombres.forEach(function(nombre) {
    var fila = [
      timestamp, centro, novios, fechaStr, codigoEvento,
      nombre, cargo, ganoTxt,
      prom !== null && prom !== undefined ? prom : '',
      supervisor, timestamp
    ];
    for (var k = 0; k < 10; k++) fila.push(critValues[k] !== undefined ? critValues[k] : '');
    filas.push(fila);
  });
  return filas;
}

function _normSiNo(v) {
  if (v === '' || v === null || v === undefined) return '';
  var s = String(v).trim().toLowerCase();
  if (s === 'sí' || s === 'si' || s === '1' || s === 'true' || s === 'yes' || s === 'y') return 'SI';
  return 'NO';
}

// ── Vuelca al Dashboard las filas EVAL del último timestamp ──
// Se llama automáticamente después de registrarEvaluacionSupervisora.
function volcadoBonos() {
  try {
    var ss        = SpreadsheetApp.openById(SHEET_ID);
    var evalSheet = ss.getSheetByName(SHEET_EVAL);
    if (!evalSheet) throw new Error('Hoja "' + SHEET_EVAL + '" no encontrada');

    var lastRow = evalSheet.getLastRow();
    if (lastRow < 2) return;

    // Leer las últimas N filas hasta encontrar todas las EVAL del último timestamp
    var maxLookback = Math.min(50, lastRow - 1);
    var data = evalSheet.getRange(lastRow - maxLookback + 1, 1, maxLookback, HEADERS_NUEVO.length).getValues();

    // Encontrar timestamp del último EVAL
    var ultimoTs = null;
    for (var i = data.length - 1; i >= 0; i--) {
      if (String(data[i][IDX.tipo] || '').trim() === 'EVAL') {
        ultimoTs = data[i][IDX.timestamp];
        break;
      }
    }
    if (!ultimoTs) return;
    var ultimoMs = ultimoTs instanceof Date ? ultimoTs.getTime() : null;

    // Recoger todas las EVAL con ese timestamp
    var bonosSheet = ensureBonosSheet(ss);
    var filasBonos = [];
    for (var j = 0; j < data.length; j++) {
      if (String(data[j][IDX.tipo] || '').trim() !== 'EVAL') continue;
      var ts = data[j][IDX.timestamp];
      if (!(ts instanceof Date)) continue;
      if (ultimoMs !== null && ts.getTime() !== ultimoMs) continue;
      var rowIndex = (lastRow - maxLookback + 1) + j;
      var filas    = extraerFilasBonos(data[j], evalSheet, rowIndex);
      filas.forEach(function(f) { filasBonos.push(f); });
    }
    if (!filasBonos.length) return;

    filasBonos.forEach(function(fila) { bonosSheet.appendRow(fila); });

    // Colorea SÍ verde / NO rojo en col H
    var totalRows  = bonosSheet.getLastRow();
    var startRow   = totalRows - filasBonos.length + 1;
    for (var k = 0; k < filasBonos.length; k++) {
      var bono = filasBonos[k][7];
      var cell = bonosSheet.getRange(startRow + k, 8);
      if (bono === 'SÍ') cell.setBackground('#d4edda').setFontColor('#155724').setFontWeight('bold');
      else if (bono === 'NO') cell.setBackground('#f8d7da').setFontColor('#721c24').setFontWeight('bold');
    }
    Logger.log('volcadoBonos OK: ' + filasBonos.length + ' filas agregadas.');
  } catch(err) {
    Logger.log('volcadoBonos ERROR: ' + err.toString() + '\n' + err.stack);
  }
}

// ── Re-procesa TODAS las evaluaciones existentes en el sheet ──
// Útil para backfill inicial. Limpia Dashboard de Bonos y lo reconstruye.
// EJECUTAR MANUALMENTE si se quiere regenerar el Dashboard.
function backfillBonos() {
  try {
    var ss        = SpreadsheetApp.openById(SHEET_ID);
    var evalSheet = ss.getSheetByName(SHEET_EVAL);
    if (!evalSheet) throw new Error('Hoja "' + SHEET_EVAL + '" no encontrada');

    var oldSheet = ss.getSheetByName(SHEET_BONOS);
    if (oldSheet) ss.deleteSheet(oldSheet);
    var bonosSheet = ensureBonosSheet(ss);

    var lastRow = evalSheet.getLastRow();
    if (lastRow < 2) { Logger.log('backfillBonos: sin datos.'); return; }

    var allData = evalSheet.getRange(2, 1, lastRow - 1, HEADERS_NUEVO.length).getValues();
    var todasFilas = [];

    allData.forEach(function(rowData, idx) {
      if (String(rowData[IDX.tipo] || '').trim() !== 'EVAL') return;
      var rowIndex = idx + 2;
      var filas    = extraerFilasBonos(rowData, evalSheet, rowIndex);
      filas.forEach(function(f) { todasFilas.push(f); });
    });

    if (!todasFilas.length) { Logger.log('backfillBonos: nada que volcar.'); return; }

    bonosSheet.getRange(2, 1, todasFilas.length, HEADER_BONOS.length).setValues(todasFilas);

    for (var i = 0; i < todasFilas.length; i++) {
      var bono = todasFilas[i][7];
      var cell = bonosSheet.getRange(2 + i, 8);
      if (bono === 'SÍ') cell.setBackground('#d4edda').setFontColor('#155724').setFontWeight('bold');
      else if (bono === 'NO') cell.setBackground('#f8d7da').setFontColor('#721c24').setFontWeight('bold');
    }
    Logger.log('backfillBonos OK: ' + todasFilas.length + ' filas de ' + allData.length + ' EVALs.');
  } catch(err) {
    Logger.log('backfillBonos ERROR: ' + err.toString() + '\n' + err.stack);
  }
}

// ════════════════════════════════════════════════════════════════════
//  SETUP DEL TRIGGER
//  Ejecutar setupTrigger() UNA SOLA VEZ desde el editor de Apps Script.
//  Registra un trigger onEdit-like que llama volcadoBonos() cada vez
//  que registrarEvaluacionSupervisora() agrega una fila.
//  Como el formulario usa google.script.run (no Google Forms nativo),
//  usamos un trigger "onChange" sobre el spreadsheet.
// ════════════════════════════════════════════════════════════════════
function setupTrigger() {
  // Elimina triggers previos de esta función para no duplicar
  var triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(function(t) {
    if (t.getHandlerFunction() === 'onEvalSubmit') {
      ScriptApp.deleteTrigger(t);
    }
  });

  // Crea trigger onChange sobre el spreadsheet de evaluaciones
  ScriptApp.newTrigger('onEvalSubmit')
    .forSpreadsheet(SHEET_ID)
    .onChange()
    .create();

  Logger.log('Trigger onEvalSubmit registrado correctamente.');
}

// ── Handler del trigger: detecta que se agregó una fila nueva ──
function onEvalSubmit(e) {
  // onChange se dispara en muchas situaciones; solo actuar si es INSERT_ROW
  if (e && e.changeType && e.changeType !== 'INSERT_ROW') return;
  volcadoBonos();
}

// ════════════════════════════════════════════════════════════════════
//  TEST
// ════════════════════════════════════════════════════════════════════
function testAll() {
  Logger.log('=== TEST getTrabajadores ===');
  var t = getTrabajadores();
  Logger.log('Trabajadores: ' + t.nombres.length + ' → primeros 5: ' + t.nombres.slice(0,5).join(', '));

  Logger.log('\n=== TEST getCentrosAndNovios ===');
  var aux = getCentrosAndNovios();
  Logger.log('Centros: ' + aux.centros.length);
  Logger.log('SuperMetres: ' + (aux.cargoNames.superMetre||[]).slice(0,3).join(', '));

  Logger.log('\n=== TEST getEventosList ===');
  var eventos = getEventosList();
  Logger.log('Eventos: ' + eventos.length);
  if (eventos.length > 0) {
    var r = getEventData(eventos[0].novios);
    if (r) Logger.log('Evento OK: ' + r.novios + ' | alerta: "' + r.alerta + '"');
  }
}
