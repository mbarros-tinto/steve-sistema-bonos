// ==================================================================
// CONFIGURACION
// ==================================================================
var CONFIG = {
  SHEET_ID:             '1fJFabJhtLfoX51R2ewSuZ89TGDGruLdBRA-CdQffiYU',
  HOJAS: {
    REGISTRO:      'Registro',
    BONO_FOTOS:    'Bono Fotos',
    INSTRUCCIONES: 'Criterios',
    AUX:           'Aux'
  },
  MAX_RESP_SLOTS:       20,
  SHEET_CG_ID:          '1ZVR0xSxfO3zFGVboByKFa4evVdqPtVtJZcvn3UuPBWc',
  HOJA_CG_CRITERIOS:    'Criterios',
  SHEET_CENTROS_ID:         '1W-sY1xbA2dihmP0EFwADp3JY3L61LB5me3sbk2OwRac',
  HOJA_CENTROS:             'Centro de eventos',
  COL_CENTROS:              'B',
  SHEET_TRABAJADORES_ID:    '1aRuPFT625ewVSR7EfdaaHHp4Y2bohu6KUNLhC6ETd8M',
  COL_TRABAJADORES:         'B',
  FILA_TRABAJADORES_START:  2,
  DRIVE_FOLDER_ID:      '1FtCyEgSRUX1hG34-tvA89LhBHf_w7yoS'
};

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

var ID_CENTRALIZADO = '1f86EWcVJAaptEBoAzI8d6ZZ_lHw09XBYV9C5Kbe-g5k';

// ==================================================================
// HELPERS DE CARPETA Y SEMANA
// ==================================================================

// Obtiene o crea una subcarpeta por nombre dentro de un folder padre.
function _getOrCreateFolder(parent, name) {
  var iter = parent.getFoldersByName(name);
  return iter.hasNext() ? iter.next() : parent.createFolder(name);
}

// Devuelve el objeto Date del lunes de la semana de operacion para una fecha.
// Acepta: "DD-MM-YYYY", "DD/MM/YYYY", "YYYY-MM-DD" o Date object.
function _getLunesSemana(fecha) {
  var d;
  if (fecha instanceof Date) {
    d = new Date(fecha.getTime());
  } else {
    var s = String(fecha).trim();
    var p;
    if (/^\d{2}-\d{2}-\d{4}$/.test(s)) { p = s.split('-'); d = new Date(+p[2], +p[1]-1, +p[0]); }
    else if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) { p = s.split('/'); d = new Date(+p[2], +p[1]-1, +p[0]); }
    else if (/^\d{4}-\d{2}-\d{2}$/.test(s)) { p = s.split('-'); d = new Date(+p[0], +p[1]-1, +p[2]); }
    else { d = new Date(s); }
  }
  var day = d.getDay(); // 0=Dom, 1=Lun, ...
  var diff = (day === 0) ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

// Formatea el lunes como "DD/MM/YYYY" (usado en col Semana de Bono Fotos).
function _formatSemana(lunesDate) {
  return ('0'+lunesDate.getDate()).slice(-2) + '/' +
         ('0'+(lunesDate.getMonth()+1)).slice(-2) + '/' +
         lunesDate.getFullYear();
}

// Retorna el año como string -- primer nivel de carpeta.  ej: "2026"
function _formatCarpetaAnio(lunesDate) {
  return String(lunesDate.getFullYear());
}

// Retorna "MM/AAAA Fotos" -- segundo nivel.  ej: "03/2026 Fotos"
function _formatCarpetaMes(lunesDate) {
  return ('0'+(lunesDate.getMonth()+1)).slice(-2) + '/' +
         lunesDate.getFullYear() + ' Fotos';
}

// Retorna "Semana X" -- tercer nivel.
// X = número de semana del mes (1-5) calculado desde el día del lunes.
function _formatCarpetaSemana(lunesDate) {
  return 'Semana ' + Math.ceil(lunesDate.getDate() / 7);
}

// Convierte "DD-MM-YYYY" -> "DD/MM/YYYY" para usar en nombres de carpetas.
// Si el formato ya tiene barras, lo devuelve como está.
function _formatFechaDisplay(fechaStr) {
  var s = String(fechaStr).trim();
  var m = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (m) return ('0'+m[1]).slice(-2) + '/' + ('0'+m[2]).slice(-2) + '/' + m[3];
  return s;  // ya está en otro formato (DD/MM/YYYY, etc.)
}

// Limpia un texto para usarlo como nombre de archivo:
// elimina / \ : * ? " < > | y recorta espacios.
function _sanitizarNombreArchivo(s) {
  return String(s).trim().replace(/[\/\\:*?"<>|]/g, '_');
}

// ==================================================================
// INSTRUCTIVO / BONOS -- se lee dinámicamente desde la hoja Aux
// Cols: Cargo | ID Bono | Nombre Bono | Monto | Icono | Color | Background | Source | CG Cargo
// Lee TODOS los bonos desde Maestro_Bonos en Centralizado (reemplaza antigua hoja Aux).
// Cols: A=Cargo, B=Tipo Bono, C=Monto, D=Sistema, E-N=Criterios, O=Icono, P=Color, Q=BG.
// Solo incluye cargos que tengan al menos un bono tipo "Fotos" (para que aparezcan en esta app).
// Retorna { cargo: [{id, nombre, desc, monto, icono, color, bg, source, criterios}, ...] }

function _leerBonosDesdeAux() {
  try {
    var ss   = SpreadsheetApp.openById(ID_CENTRALIZADO);
    var hoja = ss.getSheetByName('Maestro_Bonos');
    if (!hoja || hoja.getLastRow() < 2) return {};
    var datos = hoja.getRange(2, 1, hoja.getLastRow() - 1, 17).getValues();

    // Defaults por tipo bono (source indica quien evalua)
    var themes = {
      'Fotos':       { source: 'fotos' },
      'Supervisora': { source: 'supervisora' },
      'Activos':     { source: 'cg' },
      'Vajilla':     { source: 'cg' }
    };

    // 1er paso: cargos que tienen bono Fotos
    var fotosCargos = {};
    for (var i = 0; i < datos.length; i++) {
      if (String(datos[i][1]).trim() === 'Fotos') {
        fotosCargos[String(datos[i][0]).trim()] = true;
      }
    }

    // 2do paso: armar mapa de bonos para esos cargos
    var result = {};
    for (var i = 0; i < datos.length; i++) {
      var cargo = String(datos[i][0]).trim();
      if (!cargo || !fotosCargos[cargo]) continue;

      var tipoBono = String(datos[i][1]).trim();
      var monto    = Number(datos[i][2]) || 0;
      var theme    = themes[tipoBono] || themes['Fotos'];

      // Icono/Color/BG desde cols O-Q (con defaults)
      var icono = String(datos[i][14] || '').trim() || '?';
      var color = String(datos[i][15] || '').trim() || '#1565c0';
      var bg    = String(datos[i][16] || '').trim() || '#e3f2fd';

      // Criterios desde cols E-N
      var criterios = [];
      for (var j = 4; j <= 13; j++) {
        var val = String(datos[i][j]).trim();
        if (val && val !== '' && val !== '-' && val !== '--' && val !== '0' && val !== 'undefined' && val !== 'null') {
          criterios.push(val);
        }
      }

      // Para supervisora, agregar mensaje informativo si no hay criterios
      if (theme.source === 'supervisora' && criterios.length === 0) {
        criterios = ['Tu supervisora evaluara tu desempeno en el evento.'];
      }

      var bono = {
        id:        tipoBono.toLowerCase(),
        nombre:    'Bono ' + tipoBono,
        desc:      'Bono ' + tipoBono + ' ' + cargo,
        monto:     monto,
        icono:     icono,
        color:     color,
        bg:        bg,
        source:    theme.source,
        criterios: criterios
      };

      if (!result[cargo]) result[cargo] = [];
      result[cargo].push(bono);
    }
    return result;
  } catch(e) {
    Logger.log('Error leyendo bonos desde Maestro_Bonos: ' + e.toString());
    return {};
  }
}

// ==================================================================
// WEB APP ENTRY POINTS
// ==================================================================
function doGet(e) {
  return HtmlService.createHtmlOutputFromFile('WebApp')
    .setTitle('Sistema Fotos Tinto')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ==================================================================
// getDatosIniciales -- called on page load
// ==================================================================
function getDatosIniciales() {
  var trabajadores = _leerTrabajadores();
  var bonosMap     = _leerBonosDesdeAux();
  var cargos       = Object.keys(bonosMap);
  return { trabajadores: trabajadores, cargos: cargos };
}

// ==================================================================
// getInstructivoBonos -- returns bono cards for a cargo
// ==================================================================
// Simplificado: criterios ya vienen incluidos en _leerBonosDesdeAux() desde Maestro_Bonos.
function getInstructivoBonos(cargo) {
  var bonosMap = _leerBonosDesdeAux();
  var bonos    = bonosMap[cargo] || [];
  return { cargo: cargo, bonos: bonos };
}

// Lee criterios CG desde Centralizado > Maestro_Bonos.
// Layout: Col A=Cargo, Col B=Tipo Bono, Col C=Monto, Col D=Sistema, Cols E-N=Criterios.
// Filtra filas donde Sistema='CG' y Cargo coincide con cgCargo.
// Retorna array plano de strings de criterios.
function _leerCriteriosCGPorCargo(cgCargo) {
  try {
    var ss   = SpreadsheetApp.openById(ID_CENTRALIZADO);
    var hoja = ss.getSheetByName('Maestro_Bonos');
    if (!hoja || hoja.getLastRow() < 2) return [];
    var datos = hoja.getDataRange().getValues();
    var cgCargoNorm = cgCargo.toLowerCase();
    for (var i = 1; i < datos.length; i++) {
      var sistema = String(datos[i][3]).trim();
      if (sistema !== 'CG') continue;
      var rowCargo = String(datos[i][0]).trim().toLowerCase();
      if (rowCargo === cgCargoNorm || rowCargo.indexOf(cgCargoNorm) !== -1 || cgCargoNorm.indexOf(rowCargo) !== -1) {
        var criterios = [];
        // Cols E-N = indices 4-13
        for (var j = 4; j <= 13 && j < datos[i].length; j++) {
          var val = String(datos[i][j]).trim();
          if (val && val !== '' && val !== '-' && val !== '\u2014' && val !== '0' && val !== 'undefined' && val !== 'null') criterios.push(val);
        }
        return criterios;
      }
    }
    return [];
  } catch(e) {
    Logger.log('Error leyendo criterios CG: ' + e.toString());
    return [];
  }
}

// ==================================================================
// getFotosSubidas -- returns set of already-uploaded fotos
// Registro cols: Timestamp(0), Fecha Evento(1), Centro(2), Cargo(3),
//               Nombre(4), Instruccion(5), URL Drive(6), Codigo Evento(7), Valida(8)
// ==================================================================
function getFotosSubidas(fecha, centro, cargo, nombre) {
  try {
    var ss   = SpreadsheetApp.openById(CONFIG.SHEET_ID);
    var hoja = ss.getSheetByName(CONFIG.HOJAS.REGISTRO);
    if (!hoja || hoja.getLastRow() < 2) return {};

    var datos = hoja.getRange(2, 1, hoja.getLastRow() - 1, 9).getValues();
    var result = {};
    var fechaNorm = _normFecha(fecha);
    datos.forEach(function(row) {
      var rFecha  = _normFecha(row[1]);     // col B: Fecha Evento (normalizado)
      var rCentro = String(row[2]).trim();   // col C: Centro
      var rCargo  = String(row[3]).trim();   // col D: Cargo
      var rNombre = String(row[4]).trim();   // col E: Nombre
      var rInstr  = String(row[5]).trim();   // col F: Instruccion
      var rValida = row[8];                  // col I: Valida
      if (rFecha === fechaNorm && rCentro === centro && rCargo === cargo &&
          rNombre === nombre && rInstr &&
          (rValida === true || String(rValida).toUpperCase() === 'TRUE')) {
        result[rInstr] = true;
      }
    });
    return result;
  } catch(e) {
    Logger.log('Error getFotosSubidas: ' + e.toString());
    return {};
  }
}

// ==================================================================
// procesarFoto -- entry point publico llamado por la WebApp
// Estructura Drive (5 niveles bajo ROOT):
//   ROOT
//     |_- AAAA                        ej: "2026"
//         |_- MM/AAAA Fotos           ej: "03/2026 Fotos"
//             |_- Semana X            ej: "Semana 3"  (X = semana del mes del lunes)
//                 |_- DD/MM/AAAA Nombre novia  ej: "20/03/2026 Josefina Fuentes"
//                     |_- Cargo       ej: "Super Metre"
//                         |_- NombreInstruccion.jpg
//
// Registro cols: Timestamp | Fecha Evento | Centro | Cargo | Nombre
//               | Instruccion | URL Drive | Codigo Evento | Valida
// Upsert en Registro: sobreescribe si (fechaEvento,centro,cargo,nombre,instruccion) existe.
// LockService previene carpetas duplicadas por requests concurrentes.
// ==================================================================
function procesarFoto(params) {
  // Normalizar strings para evitar trailing spaces del formulario
  params.nombre      = String(params.nombre || '').trim();
  params.centro      = String(params.centro || '').trim();
  params.cargo       = String(params.cargo || '').trim();
  params.instruccion = String(params.instruccion || '').trim();
  params.codigo      = String(params.codigo || '').trim();

  // Usar semanaOperacion del CRM para determinar las carpetas de fecha;
  // si no viene, derivar de fechaEvento.
  var fechaParaCarpeta = (params.semanaOperacion && params.semanaOperacion !== '')
                         ? params.semanaOperacion
                         : params.fechaEvento;

  var lock = LockService.getScriptLock();
  try { lock.waitLock(20000); } catch(e) { Logger.log('Lock timeout: ' + e); }

  try {
    // -- 1. Carpetas Drive (dentro del lock para evitar duplicados) -----------
    var rootFolder    = DriveApp.getFolderById(CONFIG.DRIVE_FOLDER_ID);
    var lunesSemana   = _getLunesSemana(fechaParaCarpeta);

    // Nivel 1: año  ("2026")
    var anioFolder    = _getOrCreateFolder(rootFolder,   _formatCarpetaAnio(lunesSemana));
    // Nivel 2: mes  ("03/2026 Fotos")
    var mesFolder     = _getOrCreateFolder(anioFolder,   _formatCarpetaMes(lunesSemana));
    // Nivel 3: semana  ("Semana 3")
    var semanaFolder  = _getOrCreateFolder(mesFolder,    _formatCarpetaSemana(lunesSemana));
    // Nivel 4: evento  ("DD/MM/AAAA Nombre novia")
    //   params.centro = nombre novia (col O del CRM para matrimonios)
    var eventoNombre  = _formatFechaDisplay(params.fechaEvento) + ' ' + params.centro;
    var eventoFolder  = _getOrCreateFolder(semanaFolder, eventoNombre);
    // Nivel 5: cargo
    var cargoFolder   = _getOrCreateFolder(eventoFolder, params.cargo);
    lock.releaseLock();

    // Nombre del archivo = instruccion sanitizada + extensión original
    var ext         = params.nombreArchivo.split('.').pop();
    var nombreFinal = _sanitizarNombreArchivo(params.instruccion) + '.' + ext;

    var blob    = Utilities.newBlob(
                    Utilities.base64Decode(params.archivoBase64),
                    params.mimeType || 'image/jpeg',
                    nombreFinal);
    var file    = cargoFolder.createFile(blob);
    var fileUrl = file.getUrl();

    // -- 2. Registro en hoja -- upsert por (fechaEvento, centro, cargo, nombre, instruccion) --
    var ss   = SpreadsheetApp.openById(CONFIG.SHEET_ID);
    var hReg = ss.getSheetByName(CONFIG.HOJAS.REGISTRO);
    var ts   = new Date();
    var nuevaFila = [
      ts,                    // col A: Timestamp
      params.fechaEvento,    // col B: Fecha Evento
      params.centro,         // col C: Centro
      params.cargo,          // col D: Cargo (normalizado)
      params.nombre,         // col E: Nombre
      params.instruccion,    // col F: Instruccion
      fileUrl,               // col G: URL Drive
      params.codigo,         // col H: Codigo Evento
      true                   // col I: Valida
    ];

    var filaExistente = -1;
    var lastReg = hReg.getLastRow();
    if (lastReg >= 2) {
      var regData    = hReg.getRange(2, 1, lastReg - 1, 9).getValues();
      var fechaNorm  = _normFecha(params.fechaEvento);
      for (var i = 0; i < regData.length; i++) {
        var r = regData[i];
        if (_normFecha(r[1])    === fechaNorm          &&
            String(r[2]).trim() === params.centro      &&
            String(r[3]).trim() === params.cargo       &&
            String(r[4]).trim() === params.nombre      &&
            String(r[5]).trim() === params.instruccion) {
          filaExistente = 2 + i;
          break;
        }
      }
    }
    if (filaExistente > 0) {
      hReg.getRange(filaExistente, 1, 1, 9).setValues([nuevaFila]);
    } else {
      hReg.appendRow(nuevaFila);
    }

    // flush para garantizar que la fila sea visible al leer Registro en _actualizarBonoFotos
    SpreadsheetApp.flush();

    // -- 3. Actualizar Bono Fotos --------------------------------------------
    _actualizarBonoFotos(params, ss);

    return { ok: true, url: fileUrl };
  } catch(e) {
    try { lock.releaseLock(); } catch(le) {}
    Logger.log('procesarFoto error: ' + e.toString());
    return { ok: false, mensaje: e.toString() };
  }
}

// ==================================================================
// PRIVATE HELPERS
// ==================================================================
function _leerTrabajadores() {
  try {
    var ss   = SpreadsheetApp.openById(CONFIG.SHEET_TRABAJADORES_ID);
    var hoja = ss.getSheetByName('Inscripcion');
    if (!hoja) return [];
    var datos = hoja.getRange('B2:B' + hoja.getLastRow()).getValues();
    return datos.map(function(r) { return String(r[0]).trim(); }).filter(function(v) { return v !== ''; });
  } catch(e) {
    Logger.log('Error leerTrabajadores: ' + e.toString());
    return [];
  }
}

// Lee instrucciones/criterios de Fotos desde Centralizado > Maestro_Bonos.
// Layout: Col A=Cargo, Col B=Tipo Bono, Col C=Monto, Col D=Sistema, Cols E-N=Criterios.
// Filtra filas donde Sistema='Fotos'. Retorna { cargoName: ['crit1','crit2',...], ... }
function _leerInstrucciones() {
  try {
    var ss   = SpreadsheetApp.openById(ID_CENTRALIZADO);
    var hoja = ss.getSheetByName('Maestro_Bonos');
    if (!hoja || hoja.getLastRow() < 2) return {};

    var datos     = hoja.getDataRange().getValues();
    var resultado = {};

    for (var i = 1; i < datos.length; i++) {
      var sistema = String(datos[i][3]).trim();
      if (sistema !== 'Fotos') continue;
      var cargo = String(datos[i][0]).trim();
      if (!cargo) continue;
      var instrs = [];
      // Cols E-N = indices 4-13
      for (var j = 4; j <= 13 && j < datos[i].length; j++) {
        var val = String(datos[i][j]).trim();
        if (val && val !== '' && val !== '-' && val !== '\u2014' && val !== '0' && val !== 'undefined' && val !== 'null') {
          instrs.push(val);
        }
        if (instrs.length >= CONFIG.MAX_RESP_SLOTS) break;
      }
      if (instrs.length > 0) resultado[cargo] = instrs;
    }
    return resultado;
  } catch (e) {
    Logger.log('Error al leer instrucciones: ' + e.toString());
    return {};
  }
}

// ==================================================================
// CRM GENERAL -- EVENTOS POR FECHA
// ==================================================================

// Normaliza distintos formatos de fecha a YYYYMMDD para comparar.
// Acepta: Date object, "YYYY-MM-DD", "DD/MM/YYYY", "DD-MM-YYYY" (formato WebApp state).
function _normFecha(f) {
  if (!f) return '';
  if (f instanceof Date) {
    return String(f.getFullYear()) +
           ('0' + (f.getMonth() + 1)).slice(-2) +
           ('0' + f.getDate()).slice(-2);
  }
  var s = String(f).trim();
  // YYYY-MM-DD
  var m1 = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m1) return m1[1] + m1[2] + m1[3];
  // DD/MM/YYYY  o  D/M/YYYY
  var m2 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m2) return m2[3] + ('0' + m2[2]).slice(-2) + ('0' + m2[1]).slice(-2);
  // DD-MM-YYYY  (formato que genera la WebApp: parts[2]+'-'+parts[1]+'-'+parts[0])
  var m3 = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (m3) return m3[3] + ('0' + m3[2]).slice(-2) + ('0' + m3[1]).slice(-2);
  return s;
}

// Retorna [{codigo, centro, semanaOperacion}] de los eventos CRM para la fecha dada.
// fecha llega como "YYYY-MM-DD" desde input[type=date] del WebApp.
// semanaOperacion viene de col AL (idx 37) del CRM: lunes de la semana de operación.
function getEventosPorFecha(fecha) {
  try {
    var ss   = SpreadsheetApp.openById(ID_CRM_GENERAL);
    var hoja = ss.getSheetByName(HOJA_CRM_GENERAL);
    if (!hoja || hoja.getLastRow() < 3) return [];

    // Leer hasta col AL (col 38, idx 37) para obtener Semana Operacion
    var numCols   = Math.min(hoja.getLastColumn(), 38);
    var datos     = hoja.getRange(3, 1, hoja.getLastRow() - 2, numCols).getValues();
    var eventos   = [];
    var fechaNorm = _normFecha(fecha);

    datos.forEach(function(r) {
      if (_normFecha(r[8]) !== fechaNorm) return; // col I (idx 8)  = Fecha Evento
      var centro  = String(r[14]).trim();          // col O (idx 14) = Nombre/Centro
      var codigo  = String(r[15]).trim();          // col P (idx 15) = Codigo Evento
      if (!centro || !codigo) return;
      for (var i = 0; i < eventos.length; i++) {
        if (eventos[i].codigo === codigo) return;  // evitar duplicados
      }
      // col AL (idx 37) = Semana Operacion -- lunes de la semana ej: "23/02/2026" o Date
      var semRaw = (numCols > 37) ? r[37] : null;
      var semanaOperacion = semRaw ? _normFecha(semRaw) : _normFecha(fecha);
      // Devolver en formato DD/MM/YYYY para uso en carpetas
      var semanaStr = semRaw
        ? (semRaw instanceof Date
            ? ('0'+semRaw.getDate()).slice(-2)+'/'+('0'+(semRaw.getMonth()+1)).slice(-2)+'/'+semRaw.getFullYear()
            : String(semRaw).trim())
        : fecha;
      eventos.push({ codigo: codigo, centro: centro, semanaOperacion: semanaStr });
    });

    return eventos;
  } catch (e) {
    Logger.log('getEventosPorFecha: ' + e.toString());
    return [];
  }
}

// ==================================================================
// _actualizarBonoFotos
// Lee el Registro para contar qué instrucciones del cargo/trabajador
// ya fueron subidas como foto válida, calcula % cumplimiento y
// si se ganó el bono fotos, y escribe/sobreescribe en Bono Fotos.
//
// Bono Fotos layout (encabezados fila 3, datos desde fila 4, 20 cols):
//  col  0: Semana            col  1: Fecha Evento    col  2: Codigo Evento
//  col  3: Centro            col  4: Cargo           col  5: Cargo Sistema
//  col  6: Trabajador        col 7-14: Resp 1-8
//  col 15: Total Preguntas   col 16: Respondidas     col 17: % Cumplimiento
//  col 18: Gano Bono Fotos   col 19: Timestamp
//
// Criterio para ganar: 100% de las fotos requeridas subidas.
// La lógica se replica en el Sistema Centralizado via Fuente_Fotos.
// ==================================================================
function _actualizarBonoFotos(params, ss) {
  try {
    var hBono = ss.getSheetByName(CONFIG.HOJAS.BONO_FOTOS);
    if (!hBono) return;

    // 1. Obtener criterios del cargo desde hoja Criterios
    var instrMap  = _leerInstrucciones();
    var criterios = instrMap[params.cargo] || [];
    if (criterios.length === 0) return; // Sin criterios definidos para este cargo

    // 2. Leer Registro para contar qué instrucciones ya están subidas y válidas
    //    Registro cols: Timestamp(0) | Fecha Evento(1) | Centro(2) | Cargo(3)
    //                   Nombre(4) | Instruccion(5) | URL Drive(6) | Codigo(7) | Valida(8)
    var hReg         = ss.getSheetByName(CONFIG.HOJAS.REGISTRO);
    var lastReg      = hReg.getLastRow();
    var fotosSubidas = {}; // instruccion -> true
    if (lastReg >= 2) {
      var regData    = hReg.getRange(2, 1, lastReg - 1, 9).getValues();
      var fechaNorm  = _normFecha(params.fechaEvento); // normaliza YYYY-MM-DD, DD/MM/YYYY, Date -> YYYYMMDD
      regData.forEach(function(row) {
        if (_normFecha(row[1]) === fechaNorm &&
            String(row[2]).trim() === params.centro &&
            String(row[3]).trim() === params.cargo &&
            String(row[4]).trim() === params.nombre &&
            (row[8] === true || String(row[8]).toUpperCase() === 'TRUE')) {
          fotosSubidas[String(row[5]).trim()] = true;
        }
      });
    }

    // 3. Calcular respuestas por criterio (máx 8 slots -- Resp 1 a Resp 8)
    var resps = [];
    for (var i = 0; i < 8; i++) {
      if (i < criterios.length) {
        resps.push(fotosSubidas[criterios[i]] ? 'SI' : 'NO');
      } else {
        resps.push(''); // slot vacío si el cargo tiene menos de 8 criterios
      }
    }
    var totalPreguntas = criterios.length;
    var respondidas    = resps.slice(0, criterios.length)
                              .filter(function(v) { return v === 'SI'; }).length;
    var pct            = totalPreguntas > 0
                         ? Math.round(respondidas / totalPreguntas * 100)
                         : 0;
    // Gana Bono Fotos: requiere haber subido el 100% de las fotos del cargo
    var ganoBono       = (respondidas === totalPreguntas && totalPreguntas > 0)
                         ? 'SI' : 'NO';

    // 4. Calcular semana de operación (lunes de la semana del evento)
    var semana = _formatSemana(_getLunesSemana(params.fechaEvento));

    // 5. Construir fila de 20 columnas
    var nuevaFila = [
      semana,              // col  0: Semana
      params.fechaEvento,  // col  1: Fecha Evento
      params.codigo,       // col  2: Codigo Evento
      params.centro,       // col  3: Centro
      params.cargo,        // col  4: Cargo (normalizado)
      params.cargo,        // col  5: Cargo Sistema (normalizado, mismo valor que Cargo)
      params.nombre        // col  6: Trabajador
    ].concat(resps)        // col 7-14: Resp 1-8
     .concat([
       totalPreguntas,     // col 15: Total Preguntas
       respondidas,        // col 16: Respondidas
       pct,                // col 17: % Cumplimiento
       ganoBono,           // col 18: Gano Bono Fotos
       new Date()          // col 19: Timestamp
     ]);

    // 6. Buscar fila existente en Bono Fotos por (Codigo Evento, Cargo, Trabajador)
    //    para sobreescribir en lugar de duplicar
    var lastBono      = hBono.getLastRow();
    var filaExistente = -1;
    if (lastBono >= 4) {
      var bonoData = hBono.getRange(4, 1, lastBono - 3, 20).getValues();
      for (var j = 0; j < bonoData.length; j++) {
        if (String(bonoData[j][2]).trim() === params.codigo &&
            String(bonoData[j][4]).trim() === params.cargo &&
            String(bonoData[j][6]).trim() === params.nombre) {
          filaExistente = 4 + j; // número de fila en sheet (1-indexed)
          break;
        }
      }
    }

    // 7. Sobreescribir fila existente o agregar nueva
    if (filaExistente > 0) {
      hBono.getRange(filaExistente, 1, 1, 20).setValues([nuevaFila]);
    } else {
      hBono.appendRow(nuevaFila);
    }
  } catch(e) {
    Logger.log('_actualizarBonoFotos error: ' + e.toString());
  }
}