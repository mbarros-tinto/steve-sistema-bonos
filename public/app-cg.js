// ═══════════════════════════════════════════════════════════════════
// Tab CG (Control de Gestión) — frontend para bonos.tintobanqueteria.cl
// Backend: Apps Script CG (deployment v23+) via JSON API.
// Comparte el design system del dashboard (gold + glassmorphism).
//
// Flujo:
//   1. Selector de semana → carga eventos + criterios + ya evaluados + auto-chequeos
//   2. Sección Vajilla batch: tabla con todos los eventos. Llena Invitados +
//      Factura merma, calcula resultado en vivo. Botón "Guardar Vajilla".
//   3. Sección Eventos: por cada evento, lista de cargos con sus criterios
//      SI/NO. Auto-chequeos del inventario CG marcan automáticamente algunos
//      criterios (badge verde/rojo/amarillo). Cascada Vajilla → Garzones/Barmans
//      cuando Vajilla=NO. Override manual (click sobre checkbox auto).
// ═══════════════════════════════════════════════════════════════════

var CG = {
  semana:           null,
  eventos:          [],
  config:           {},
  configVajilla:    {},
  guardados:        [],
  guardadosVajilla: [],
  autoChequeos:     {},
  vajillaConfig:    { costoPorInvitado: 800 },
  perdidas:         [],
  loaded:           false
};

function cgApiGet(action, params) {
  if (!window.CG_API_URL) return Promise.reject(new Error('CG_API_URL no configurado — refresca con Ctrl+Shift+R'));
  var qs = new URLSearchParams({ action: action, ...(params || {}) });
  return fetch(window.CG_API_URL + '?' + qs.toString(), { method: 'GET' })
    .then(function(r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      var ct = r.headers.get('Content-Type') || '';
      if (ct.indexOf('json') < 0) {
        return r.text().then(function(t) {
          throw new Error('Respuesta no JSON (' + ct + '): ' + t.slice(0, 80));
        });
      }
      return r.json();
    });
}

function cgApiPost(action, payload) {
  if (!window.CG_API_URL) return Promise.reject(new Error('CG_API_URL no configurado — refresca con Ctrl+Shift+R'));
  return fetch(window.CG_API_URL, {
    method: 'POST',
    body: JSON.stringify({ action: action, ...(payload || {}) })
  })
    .then(function(r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
}

// Lazy init: la primera vez que el usuario hace click en el tab CG.
function cgInit() {
  if (CG.loaded) return;
  CG.loaded = true;
  cgApiGet('weeksData')
    .then(function(data) {
      var sel = document.getElementById('cgSelSemana');
      sel.innerHTML = '<option value="">— Seleccionar semana —</option>';
      (data.weeks || []).forEach(function(w) {
        var o = document.createElement('option');
        o.value = w;
        o.textContent = 'Semana del ' + w;
        sel.appendChild(o);
      });
      if (data.defaultWeek) {
        sel.value = data.defaultWeek;
        cgCargarSemana();
      }
    })
    .catch(function(e) {
      document.getElementById('cgContainer').innerHTML =
        '<div class="empty"><div class="empty-icon">⚠️</div><p>Error al cargar semanas: ' + cgEsc(e.message) + '</p></div>';
    });
}

function cgCargarSemana() {
  var sel = document.getElementById('cgSelSemana');
  if (!sel || !sel.value) return;
  CG.semana = sel.value;
  document.getElementById('cgContainer').innerHTML =
    '<div class="spinner-wrap"><div class="spinner"></div>Cargando eventos…</div>';
  document.getElementById('cgStatusBar').textContent = '';
  document.getElementById('cgSaveBar').style.display = 'none';

  Promise.all([
    cgApiGet('datosForSemana', { semana: CG.semana }),
    cgApiGet('getPerdidasPorSemana', { semana: CG.semana })
  ])
    .then(function(arr) {
      var data = arr[0]; var perd = arr[1];
      CG.eventos          = data.eventos          || [];
      CG.config           = data.criteriosConfig  || {};
      CG.configVajilla    = data.criteriosVajilla || {};
      CG.guardados        = data.yaEvaluados      || [];
      CG.guardadosVajilla = data.yaEvaluadosVajilla || [];
      CG.autoChequeos     = data.autoChequeos     || {};
      if (data.vajillaConfig) CG.vajillaConfig = data.vajillaConfig;
      CG.perdidas         = (perd && perd.eventos) || [];
      cgRenderSemana();
    })
    .catch(function(e) {
      document.getElementById('cgContainer').innerHTML =
        '<div class="empty"><div class="empty-icon">⚠️</div><p>Error: ' + cgEsc(e.message) + '</p></div>';
    });
}

function cgRenderSemana() {
  var container = document.getElementById('cgContainer');
  var cargos    = Object.keys(CG.config);

  if (!CG.eventos.length) {
    container.innerHTML =
      '<div class="empty"><div class="empty-icon">📭</div>' +
      '<p>No hay matrimonios para la semana <b>' + cgEsc(CG.semana) + '</b>.</p>' +
      '<p class="sub">Verifica que el CRM tenga eventos tipo Matrimonio en esa semana.</p></div>';
    cgUpdateSaveBar();
    return;
  }

  var html = cgRenderVajillaPanel();
  html += cgRenderPerdidasPanel();
  CG.eventos.forEach(function(ev) {
    html += cgRenderEvento(ev, cargos);
  });
  container.innerHTML = html;

  var total = CG.eventos.length * cargos.length;
  document.getElementById('cgStatusBar').innerHTML =
    '<b>' + CG.eventos.length + '</b> matrimonio(s) · <b>' + cargos.length + '</b> cargo(s) · ' +
    '<b style="color:var(--gold);">' + CG.guardados.length + '/' + total + '</b> ya evaluados';
  cgUpdateSaveBar();
}

// ═══════════════════════════════════════════════════════════════════
// PANEL VAJILLA BATCH
// ═══════════════════════════════════════════════════════════════════
function cgRenderVajillaPanel() {
  var vajCargos = Object.keys(CG.configVajilla);
  if (vajCargos.length === 0 || CG.eventos.length === 0) return '';

  var costoPorInv = CG.vajillaConfig.costoPorInvitado || 800;
  var rowsHtml = '';
  CG.eventos.forEach(function(ev) {
    var vid = cgSafeId(ev.codigoEvento, 'vaj');
    var saved = CG.guardadosVajilla.filter(function(g) { return g.codigoEvento === ev.codigoEvento; });
    var hasSaved = saved.length > 0;
    var savedInv  = hasSaved ? saved[0].invitadosComida : '';
    var savedFact = hasSaved ? saved[0].facturaMerma   : '';
    var inicialInv = savedInv || ev.invitadosComida || 0;
    var merma = costoPorInv * inicialInv;
    var partes = ev.fechaEvento.split('-');
    var fechaStr = partes[2] + '/' + partes[1] + '/' + partes[0];

    var resCls, resHtml;
    if (hasSaved) {
      var ok = saved[0].gana === 'SI';
      resCls = ok ? 'vaj-ok' : 'vaj-no';
      resHtml = ok ? '✓ Gana' : '✗ No gana';
    } else {
      resCls = 'vaj-wait';
      resHtml = '— pendiente —';
    }

    rowsHtml +=
      '<tr data-evento="' + cgAttr(ev.codigoEvento) + '">' +
      '<td class="vaj-cell-evento">🏛️ ' + cgEsc(ev.centro) + '<span class="vaj-meta">' + fechaStr + ' · ' + cgEsc(ev.codigoEvento) + '</span></td>' +
      '<td><input type="number" class="vaj-input" id="vaj-inv-' + vid + '" value="' + cgAttr(savedInv || ev.invitadosComida || '') + '" onchange="cgRecalcVajilla(\'' + cgAttr(ev.codigoEvento) + '\')" placeholder="0"></td>' +
      '<td><span class="vaj-merma" id="vaj-merma-' + vid + '">$' + cgFmt(merma) + '</span></td>' +
      '<td><input type="number" class="vaj-input" id="vaj-fact-' + vid + '" value="' + cgAttr(savedFact || '') + '" onchange="cgRecalcVajilla(\'' + cgAttr(ev.codigoEvento) + '\')" placeholder="$"></td>' +
      '<td class="vaj-result ' + resCls + '" id="vaj-res-' + vid + '">' + resHtml + '</td>' +
      '</tr>';
  });

  var totalEv = CG.eventos.length;
  var guardadosUnicos = new Set(CG.guardadosVajilla.map(function(g) { return g.codigoEvento; })).size;

  return '<div class="cg-vajilla-panel">' +
    '<div class="cg-vajilla-head">' +
    '<div class="cg-vajilla-title">🍽️ Bono <span class="accent">Vajilla</span> — semana</div>' +
    '<div class="cg-vajilla-meta">' + guardadosUnicos + '/' + totalEv + ' evento(s) guardado(s) · costo $' + costoPorInv + '/invitado</div>' +
    '</div>' +
    '<div class="cg-vajilla-info">Llena <b>Invitados comida</b> y <b>Factura merma</b> de cada evento. Si la factura supera la merma permitida ($' + costoPorInv + ' × invitados), el bono se pierde y arrastra a Garzones y Barmans.</div>' +
    '<div class="cg-vajilla-table-wrap"><table class="cg-vajilla-table">' +
    '<thead><tr><th>Evento</th><th>Invitados</th><th>Merma permitida</th><th>Factura merma</th><th>Resultado</th></tr></thead>' +
    '<tbody>' + rowsHtml + '</tbody>' +
    '</table></div>' +
    '<button class="btn btn-info" id="cgBtnGuardarVajilla" onclick="cgGuardarVajilla()">🍽️ Guardar Vajilla semana</button>' +
    '</div>';
}

function cgRecalcVajilla(codigoEvento) {
  var vid = cgSafeId(codigoEvento, 'vaj');
  var inv  = Number(document.getElementById('vaj-inv-' + vid).value)  || 0;
  var fact = Number(document.getElementById('vaj-fact-' + vid).value) || 0;
  var costo = CG.vajillaConfig.costoPorInvitado || 800;
  var merma = costo * inv;
  document.getElementById('vaj-merma-' + vid).textContent = '$' + cgFmt(merma);
  var el = document.getElementById('vaj-res-' + vid);
  if (inv <= 0 || fact <= 0) {
    el.className = 'vaj-result vaj-wait';
    el.textContent = '— pendiente —';
  } else if (fact <= merma) {
    el.className = 'vaj-result vaj-ok';
    el.textContent = '✓ Gana ($' + cgFmt(fact) + ' ≤ $' + cgFmt(merma) + ')';
  } else {
    el.className = 'vaj-result vaj-no';
    el.textContent = '✗ No gana ($' + cgFmt(fact) + ' > $' + cgFmt(merma) + ')';
  }
}

function cgGuardarVajilla() {
  var vajCargos = Object.keys(CG.configVajilla);
  if (vajCargos.length === 0) { showToast('No hay cargos Vajilla configurados', 'err'); return; }

  var evaluaciones = [];
  var omitidos = 0;
  CG.eventos.forEach(function(ev) {
    var vid = cgSafeId(ev.codigoEvento, 'vaj');
    var inv  = Number(document.getElementById('vaj-inv-' + vid).value)  || 0;
    var fact = Number(document.getElementById('vaj-fact-' + vid).value) || 0;
    if (inv <= 0 || fact <= 0) { omitidos++; return; }
    vajCargos.forEach(function(cargo) {
      evaluaciones.push({
        semana: CG.semana,
        fechaEvento: ev.fechaEvento,
        codigoEvento: ev.codigoEvento,
        centro: ev.centro,
        invitadosComida: inv,
        facturaMerma: fact,
        cargo: cargo
      });
    });
  });
  if (!evaluaciones.length) { showToast('Ningún evento tiene Invitados y Factura llenos', 'err'); return; }

  var btn = document.getElementById('cgBtnGuardarVajilla');
  btn.disabled = true;
  btn.textContent = '⏳ Guardando…';
  cgApiPost('saveVajillaEvaluation', { evaluaciones: evaluaciones })
    .then(function(res) {
      btn.disabled = false;
      btn.textContent = '🍽️ Guardar Vajilla semana';
      if (res.success) {
        showToast('Vajilla: ' + (res.rowsAdded || 0) + ' nueva(s), ' + (res.rowsUpdated || 0) + ' actualizada(s)', 'ok');
        cgCargarSemana(); // recargar para reflejar cascada
      } else {
        showToast('Error: ' + (res.error || 'desconocido'), 'err');
      }
    })
    .catch(function(e) {
      btn.disabled = false;
      btn.textContent = '🍽️ Guardar Vajilla semana';
      showToast('Error: ' + e.message, 'err');
    });
}

// ═══════════════════════════════════════════════════════════════════
// PANEL PÉRDIDAS — Tabla por evento (Manteles / Servilletas / Cubiertos)
// Inputs editables Inicial/Final que llaman saveOverridePerdida.
// Cubiertos: checkbox "Se repite?" + dropdown otro evento → saveCubiertosCompartidos.
// ═══════════════════════════════════════════════════════════════════
var _cgPerdDebounce = {};

function cgRenderPerdidasPanel() {
  if (!CG.perdidas.length) return '';

  var html = '<div class="cg-perdidas-panel">' +
    '<div class="cg-perdidas-head">' +
    '<div class="cg-perdidas-title">📉 Pérdidas por <span class="accent">evento</span></div>' +
    '<div class="cg-perdidas-meta">Inicial − Final − Robo = Pérdida neta. Override de Ini/Fin con click en el número.</div>' +
    '</div>';

  CG.perdidas.forEach(function(p) {
    var partes = p.fechaEvento.split('-');
    var fechaStr = partes[2] + '/' + partes[1] + '/' + partes[0];
    var safeKey = cgSafeId(p.codigoEvento, '');

    // Warning si falta alguna respuesta
    var faltantes = [];
    ['manteles','caminos','prendas','servilletas','cubiertos'].forEach(function(cat) {
      var c = p[cat]; if (!c) return;
      if (c.sinDatos) {
        var falta = c.faltaIni && c.faltaFin ? 'Casa Inicial y Casa Final'
                   : c.faltaIni ? 'Casa Inicial'
                   : c.faltaFin ? 'Casa Final' : 'datos';
        faltantes.push('<b>' + cat + '</b> (falta ' + falta + ')');
      }
    });
    var warning = faltantes.length
      ? '<div class="cg-perd-warning">⚠ Formulario incompleto: ' + faltantes.join(', ') + '. Pide al equipo que complete el inventario.</div>'
      : '';

    html += '<div class="cg-perdidas-evento">' +
      '<div class="cg-perdidas-ev-head">🏛️ <b>' + cgEsc(p.centro) + '</b> · ' + fechaStr + '</div>' +
      warning +
      '<table class="cg-perdidas-table"><thead><tr>' +
        '<th>Categoría</th><th>Inicial</th><th>Final</th><th>Robo</th><th>Pérdida</th><th></th>' +
      '</tr></thead><tbody>';

    // 5 categorías separadas según acuerdo con usuario
    html += cgRenderPerdidaFila(p, 'manteles',    'Manteles',    0, p.codigoEvento, safeKey);
    html += cgRenderPerdidaFila(p, 'caminos',     'Caminos',     0, p.codigoEvento, safeKey);
    html += cgRenderPerdidaFila(p, 'prendas',     'Prendas',     0, p.codigoEvento, safeKey);
    html += cgRenderPerdidaFila(p, 'servilletas', 'Servilletas', 20, p.codigoEvento, safeKey);
    html += cgRenderPerdidaFila(p, 'cubiertos',   'Cubiertos',   40, p.codigoEvento, safeKey);

    html += '</tbody></table></div>';
  });
  html += '</div>';
  return html;
}

function cgRenderPerdidaFila(p, key, label, limite, codigoEvento, safeKey) {
  var c = p[key]; if (!c) return '';
  var pidLabel = 'cg-perd-' + safeKey + '-' + key + '-perdida';
  var iniLabel = 'cg-perd-' + safeKey + '-' + key + '-ini';
  var finLabel = 'cg-perd-' + safeKey + '-' + key + '-fin';
  var statusCls = (limite > 0)
    ? (c.perdidaNeta < limite ? 'perd-ok' : 'perd-bad')
    : (c.perdidaNeta === 0 ? 'perd-ok' : 'perd-bad');

  var html = '<tr data-codigo="' + cgAttr(codigoEvento) + '" data-cat="' + key + '" class="perd-row-main">' +
    '<td class="perd-cat">' +
      '<button class="perd-toggle" id="cg-tog-' + safeKey + '-' + key + '"' +
      ' onclick="cgTogglePerdidaItems(\'' + cgAttr(codigoEvento) + '\', \'' + key + '\', \'' + safeKey + '\')">▼</button> ' +
      cgEsc(label) +
      (c.compartido ? ' <span class="perd-badge-link">🔗</span>' : '') +
    '</td>' +
    '<td class="perd-num" id="' + iniLabel + '">' + cgFmt(c.inicial) + '</td>' +
    '<td class="perd-num" id="' + finLabel + '">' + cgFmt(c.final) + '</td>' +
    '<td class="perd-robo">' + cgFmt(c.robo) + '</td>' +
    '<td class="perd-neta ' + statusCls + '" id="' + pidLabel + '">' + cgFmt(c.perdidaNeta) +
      (limite > 0 ? ' <span class="perd-lim">(<' + limite + ')</span>' : '') +
    '</td>';

  // Columna extra: checkbox "Se repite?" solo para cubiertos
  if (key === 'cubiertos') {
    var checked = c.compartido && c.parCompartido;
    var otroEvento = null;
    if (checked && c.parCompartido) {
      var c1k = cgEvKey(c.parCompartido.centro1, c.parCompartido.fecha1);
      var myk = cgEvKey(p.centro, p.fechaEvento);
      otroEvento = (c1k === myk)
        ? cgEvKey(c.parCompartido.centro2, c.parCompartido.fecha2)
        : cgEvKey(c.parCompartido.centro1, c.parCompartido.fecha1);
    }
    html += '<td class="perd-repite">' +
      '<label class="perd-repite-lbl"><input type="checkbox" ' + (checked ? 'checked' : '') +
      ' onchange="cgOnRepiteToggle(\'' + cgAttr(codigoEvento) + '\', this)"> ¿Se repite?</label>' +
      '<select class="perd-repite-sel" ' + (checked ? '' : 'disabled') +
      ' onchange="cgOnRepiteSelect(\'' + cgAttr(codigoEvento) + '\', this)">' +
      '<option value="">— Otro evento —</option>';
    CG.eventos.forEach(function(ev) {
      if (ev.codigoEvento === codigoEvento) return;
      var k = cgEvKey(ev.centro, ev.fechaEvento);
      var sel = (k === otroEvento) ? ' selected' : '';
      html += '<option value="' + cgAttr(k) + '"' + sel + '>' + cgEsc(ev.codigoEvento) + '</option>';
    });
    html += '</select></td>';
  } else {
    html += '<td></td>';
  }

  html += '</tr>';

  // Fila desplegable (oculta por default) con items
  html += '<tr class="perd-row-items" id="cg-items-' + safeKey + '-' + key + '" style="display:none;">' +
    '<td colspan="6"><div class="perd-items-wrap" id="cg-items-wrap-' + safeKey + '-' + key + '">' +
    '<div class="hint">Click ▼ para cargar items…</div>' +
    '</div></td></tr>';
  return html;
}

// Toggle desplegable items de una categoría. Lazy load al primer expand.
var _cgItemsCache = {}; // codigoEvento → { manteles, servilletas, cubiertos }

function cgTogglePerdidaItems(codigoEvento, categoria, safeKey) {
  var rowItems = document.getElementById('cg-items-' + safeKey + '-' + categoria);
  var btn = document.getElementById('cg-tog-' + safeKey + '-' + categoria);
  if (!rowItems || !btn) return;
  var visible = rowItems.style.display !== 'none';
  if (visible) {
    rowItems.style.display = 'none';
    btn.textContent = '▼';
    return;
  }
  rowItems.style.display = '';
  btn.textContent = '▲';

  // Lazy load
  var wrap = document.getElementById('cg-items-wrap-' + safeKey + '-' + categoria);
  if (_cgItemsCache[codigoEvento]) {
    cgRenderPerdidaItems(wrap, _cgItemsCache[codigoEvento], categoria, codigoEvento, safeKey);
    return;
  }
  var p = CG.perdidas.find(function(x) { return x.codigoEvento === codigoEvento; });
  if (!p) return;
  wrap.innerHTML = '<div class="spinner-wrap"><div class="spinner"></div>Cargando items…</div>';
  cgApiGet('getItemsPerdidaEvento', { centro: p.centro, fecha: p.fechaEvento })
    .then(function(r) {
      if (!r.ok) { wrap.innerHTML = '<div class="empty">Error: ' + cgEsc(r.error || '') + '</div>'; return; }
      _cgItemsCache[codigoEvento] = r;
      cgRenderPerdidaItems(wrap, r, categoria, codigoEvento, safeKey);
    })
    .catch(function(e) { wrap.innerHTML = '<div class="empty">Error: ' + cgEsc(e.message) + '</div>'; });
}

function cgRenderPerdidaItems(wrap, data, categoria, codigoEvento, safeKey) {
  var items = data[categoria] || [];
  if (!items.length) { wrap.innerHTML = '<div class="hint">Sin items en esta categoría.</div>'; return; }
  var html = '';
  // Si es categoría cubiertos y hay compartido, mostrar banner con info
  if (categoria === 'cubiertos' && data.compartido) {
    html += '<div class="perd-compartido-info">🔗 <b>Cubiertos compartidos</b>: ' +
      '<b>Casa Inicial</b> de <i>' + cgEsc(data.compartido.primero.centro) + '</i>, ' +
      '<b>Casa Final</b> de <i>' + cgEsc(data.compartido.segundo.centro) + '</i>. ' +
      'Pérdida mostrada es bruta del par; el total del evento aplica ÷2.' +
      '</div>';
  }
  html += '<table class="perd-items-table">' +
    '<thead><tr><th>Item</th><th>Casa Inicial</th><th>Casa Final</th><th>Pérdida</th></tr></thead><tbody>';
  items.forEach(function(it) {
    var iid = 'perd-it-' + safeKey + '-' + categoria + '-' + it.row + '-ini';
    var fid = 'perd-it-' + safeKey + '-' + categoria + '-' + it.row + '-fin';
    var pid = 'perd-it-' + safeKey + '-' + categoria + '-' + it.row + '-perd';
    var perdCls = it.perdida > 0 ? 'perd-item-bad' : 'perd-item-ok';
    var titleIni = it.compartido && it.centroIni ? 'Editando: ' + it.centroIni : '';
    var titleFin = it.compartido && it.centroFin ? 'Editando: ' + it.centroFin : '';
    html += '<tr data-row="' + it.row + '" data-hoja="' + cgAttr(it.hoja) + '">' +
      '<td class="perd-item-name">' + cgEsc(it.item) + '</td>' +
      '<td><input type="number" class="perd-input-item" id="' + iid + '" value="' + it.casaInicial + '"' +
        (titleIni ? ' title="' + cgAttr(titleIni) + '"' : '') +
        ' onchange="cgOnItemInput(\'' + cgAttr(codigoEvento) + '\', \'' + categoria + '\', ' + it.row + ', ' + it.colIniSheet + ', \'' + it.hoja + '\', \'ini\', this)"></td>' +
      '<td><input type="number" class="perd-input-item" id="' + fid + '" value="' + it.casaFinal + '"' +
        (titleFin ? ' title="' + cgAttr(titleFin) + '"' : '') +
        ' onchange="cgOnItemInput(\'' + cgAttr(codigoEvento) + '\', \'' + categoria + '\', ' + it.row + ', ' + it.colFinSheet + ', \'' + it.hoja + '\', \'fin\', this)"></td>' +
      '<td class="perd-item-perd ' + perdCls + '" id="' + pid + '">' + cgFmt(it.perdida) + '</td>' +
      '</tr>';
  });
  html += '</tbody></table>';
  wrap.innerHTML = html;
}

var _cgItemDebounce = {};

function cgOnItemInput(codigoEvento, categoria, row, col, hoja, campo, input) {
  var val = input.value === '' ? '' : Number(input.value);
  // Actualizar cache local
  var cached = _cgItemsCache[codigoEvento];
  if (cached && cached[categoria]) {
    var it = cached[categoria].find(function(x) { return x.row === row; });
    if (it) {
      if (campo === 'ini') it.casaInicial = val === '' ? 0 : val;
      if (campo === 'fin') it.casaFinal   = val === '' ? 0 : val;
      it.perdida = Math.max(0, it.casaInicial - it.casaFinal);
      // Update label perdida en vivo
      var p = CG.perdidas.find(function(x) { return x.codigoEvento === codigoEvento; });
      var safeKey = cgSafeId(codigoEvento, '');
      var pid = 'perd-it-' + safeKey + '-' + categoria + '-' + row + '-perd';
      var el = document.getElementById(pid);
      if (el) {
        el.textContent = cgFmt(it.perdida);
        el.className = 'perd-item-perd ' + (it.perdida > 0 ? 'perd-item-bad' : 'perd-item-ok');
      }
      // Recalcular suma de la categoría
      var sumIni = 0, sumFin = 0;
      cached[categoria].forEach(function(x) { sumIni += x.casaInicial; sumFin += x.casaFinal; });
      if (p && p[categoria]) {
        p[categoria].inicial = sumIni;
        p[categoria].final   = sumFin;
        var iniEl = document.getElementById('cg-perd-' + safeKey + '-' + categoria + '-ini');
        var finEl = document.getElementById('cg-perd-' + safeKey + '-' + categoria + '-fin');
        if (iniEl) iniEl.textContent = cgFmt(sumIni);
        if (finEl) finEl.textContent = cgFmt(sumFin);
        cgRecalcPerdidaFila(codigoEvento, categoria);
      }
    }
  }
  // Persistir con debounce. Tras éxito, refrescar cascada de bonos (autoChequeos
  // + Pérdidas) sin re-render completo: solo actualiza estado y re-pinta el
  // panel Pérdidas y la sección de cargos del evento afectado.
  var key = hoja + '::' + row + '::' + col;
  clearTimeout(_cgItemDebounce[key]);
  _cgItemDebounce[key] = setTimeout(function() {
    cgApiPost('saveItemPerdida', { payload: { hoja: hoja, row: row, col: col, value: val } })
      .then(function(r) {
        if (r && r.success) {
          showToast(hoja + ' actualizado · actualizando bonos…', 'ok');
          cgRefrescarTrasEdicion(codigoEvento);
        } else {
          showToast('Error: ' + (r && r.error), 'err');
        }
      });
  }, 700);
}

// Tras un edit que persiste al sheet inv, recargar autoChequeos + pérdidas
// y re-pintar los cargos del evento afectado. Mantiene el estado del panel
// Pérdidas (desplegables abiertos).
function cgRefrescarTrasEdicion(codigoEvento) {
  if (!CG.semana) return;
  Promise.all([
    cgApiGet('datosForSemana', { semana: CG.semana }),
    cgApiGet('getPerdidasPorSemana', { semana: CG.semana })
  ]).then(function(arr) {
    var data = arr[0]; var perd = arr[1];
    CG.autoChequeos = data.autoChequeos || {};
    CG.guardados    = data.yaEvaluados   || [];
    CG.guardadosVajilla = data.yaEvaluadosVajilla || [];
    CG.perdidas     = (perd && perd.eventos) || [];
    // Re-render del evento afectado (cargos) sin tocar panel Pérdidas DOM
    cgRepintarCargosDeEvento(codigoEvento);
    // También actualizar las sumas de las filas principales del panel Pérdidas
    cgRepintarFilasPanelPerdidas(codigoEvento);
  }).catch(function() { /* silent */ });
}

function cgRepintarCargosDeEvento(codigoEvento) {
  // Buscar el cg-event-card y reemplazar su contenido
  var cards = document.querySelectorAll('.cg-event-card');
  var ev = CG.eventos.find(function(e) { return e.codigoEvento === codigoEvento; });
  if (!ev) return;
  var cargos = Object.keys(CG.config);
  cards.forEach(function(card) {
    var meta = card.querySelector('.cg-event-meta');
    if (!meta || meta.textContent.indexOf(codigoEvento) < 0) return;
    // Reemplazar el card completo
    var newHTML = cgRenderEvento(ev, cargos);
    var tempDiv = document.createElement('div');
    tempDiv.innerHTML = newHTML;
    if (tempDiv.firstChild) card.parentNode.replaceChild(tempDiv.firstChild, card);
  });
}

function cgRepintarFilasPanelPerdidas(codigoEvento) {
  var p = CG.perdidas.find(function(x) { return x.codigoEvento === codigoEvento; });
  if (!p) return;
  var safeKey = cgSafeId(codigoEvento, '');
  ['manteles','caminos','prendas','servilletas','cubiertos'].forEach(function(cat) {
    var c = p[cat]; if (!c) return;
    var iniEl = document.getElementById('cg-perd-' + safeKey + '-' + cat + '-ini');
    var finEl = document.getElementById('cg-perd-' + safeKey + '-' + cat + '-fin');
    var pidEl = document.getElementById('cg-perd-' + safeKey + '-' + cat + '-perdida');
    if (iniEl) iniEl.textContent = cgFmt(c.inicial);
    if (finEl) finEl.textContent = cgFmt(c.final);
    if (pidEl) {
      var limite = cat === 'manteles' || cat === 'caminos' || cat === 'prendas' ? 0
                 : cat === 'servilletas' ? 20 : 40;
      var statusCls = (limite > 0)
        ? (c.perdidaNeta < limite ? 'perd-ok' : 'perd-bad')
        : (c.perdidaNeta === 0 ? 'perd-ok' : 'perd-bad');
      pidEl.className = 'perd-neta ' + statusCls;
      pidEl.innerHTML = cgFmt(c.perdidaNeta) + (limite > 0 ? ' <span class="perd-lim">(<' + limite + ')</span>' : '');
    }
  });
}

function cgEvKey(centro, fechaEvento) {
  // Usa centro y fechaEvento como key estable (sin acentos, lowercase)
  return String(centro || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '') +
    '::' + String(fechaEvento || '').trim();
}

function cgRecalcPerdidaFila(codigoEvento, categoria) {
  var p = CG.perdidas.find(function(x) { return x.codigoEvento === codigoEvento; });
  if (!p || !p[categoria]) return;
  var c = p[categoria];
  c.perdidaBruta = Math.max(0, (Number(c.inicial) || 0) - (Number(c.final) || 0));
  c.perdidaNeta  = Math.max(0, c.perdidaBruta - (Number(c.robo) || 0));
  var safeKey = cgSafeId(codigoEvento, '');
  var pidLabel = 'cg-perd-' + safeKey + '-' + categoria + '-perdida';
  var el = document.getElementById(pidLabel);
  if (el) {
    var limite = categoria === 'manteles' ? 0 : (categoria === 'servilletas' ? 20 : 40);
    var statusCls = (limite > 0)
      ? (c.perdidaNeta < limite ? 'perd-ok' : 'perd-bad')
      : (c.perdidaNeta === 0 ? 'perd-ok' : 'perd-bad');
    el.className = 'perd-neta ' + statusCls;
    el.innerHTML = cgFmt(c.perdidaNeta) + (limite > 0 ? ' <span class="perd-lim">(<' + limite + ')</span>' : '');
  }
}

function cgOnRepiteToggle(codigoEvento, checkbox) {
  var row = checkbox.closest('tr');
  var sel = row.querySelector('.perd-repite-sel');
  sel.disabled = !checkbox.checked;
  if (!checkbox.checked) {
    // Desactivar par actual
    var p = CG.perdidas.find(function(x) { return x.codigoEvento === codigoEvento; });
    if (p && p.cubiertos && p.cubiertos.parCompartido) {
      var par = p.cubiertos.parCompartido;
      cgApiPost('saveCubiertosCompartidos', {
        payload: {
          centro1: par.centro1, fecha1: par.fecha1,
          centro2: par.centro2, fecha2: par.fecha2,
          activo: false
        }
      }).then(function(r) {
        if (r && r.success) { showToast('Repetición desactivada', 'ok'); cgCargarSemana(); }
      });
    }
  }
}

function cgOnRepiteSelect(codigoEvento, sel) {
  if (!sel.value) return;
  var p = CG.perdidas.find(function(x) { return x.codigoEvento === codigoEvento; });
  if (!p) return;
  var parts = sel.value.split('::');
  var otroCentro = parts[0]; var otroFecha = parts[1];
  // Necesitamos el centro original (con tildes) del otro evento
  var otroEv = CG.eventos.find(function(e) { return cgEvKey(e.centro, e.fechaEvento) === sel.value; });
  if (!otroEv) return;
  cgApiPost('saveCubiertosCompartidos', {
    payload: {
      centro1: p.centro, fecha1: p.fechaEvento,
      centro2: otroEv.centro, fecha2: otroEv.fechaEvento,
      activo: true
    }
  }).then(function(r) {
    if (r && r.success) { showToast('Cubiertos compartidos: ' + p.centro + ' ↔ ' + otroEv.centro, 'ok'); cgCargarSemana(); }
    else showToast('Error: ' + (r && r.error), 'err');
  });
}

// ═══════════════════════════════════════════════════════════════════
// CARGO + CRITERIOS (con auto-chequeos + cascada vajilla + override)
// ═══════════════════════════════════════════════════════════════════
function cgRenderEvento(ev, cargos) {
  var partes = ev.fechaEvento.split('-');
  var fechaStr = partes[2] + '/' + partes[1] + '/' + partes[0];
  var html =
    '<div class="cg-event-card">' +
    '<div class="cg-event-head">' +
    '<div class="cg-event-name">🏛️ ' + cgEsc(ev.centro) + '</div>' +
    '<div class="cg-event-meta">' + fechaStr + ' · ' + cgEsc(ev.codigoEvento) + '</div>' +
    '</div>';

  var vajEstado = cgVajillaEstadoDe(ev.codigoEvento);
  var autoEv    = CG.autoChequeos[ev.codigoEvento] || {};

  cargos.forEach(function(cargo) {
    html += cgRenderCargoSection(ev, cargo, vajEstado, autoEv);
  });

  html += '</div>';
  return html;
}

function cgVajillaEstadoDe(codigoEvento) {
  var evals = CG.guardadosVajilla.filter(function(g) { return g.codigoEvento === codigoEvento; });
  if (!evals.length) return 'PENDIENTE';
  return evals.every(function(e) { return e.gana === 'SI'; }) ? 'SI' : 'NO';
}

function cgRenderCargoSection(ev, cargo, vajEstado, autoEv) {
  var cfg   = CG.config[cargo];
  if (!cfg) return '';
  var saved = CG.guardados.find(function(g) { return g.codigoEvento === ev.codigoEvento && g.cargo === cargo; });
  var sid   = cgSafeId(ev.codigoEvento, cargo);
  var autoCargo = autoEv[cargo] || {};
  var crits = '';
  var primerMotivoFalso = null;

  cfg.criterios.forEach(function(crit, i) {
    var cid = 'cg-cb-' + sid + '-' + i;
    var isAutoVaj = /vajilla/i.test(crit);
    var autoState = null;
    if (isAutoVaj) {
      if      (vajEstado === 'SI') autoState = { ok: true,  motivo: '🍽 Auto: Vajilla ganada' };
      else if (vajEstado === 'NO') autoState = { ok: false, motivo: '🚫 Auto: Vajilla no ganada' };
      else                          autoState = { ok: null,  motivo: '⏳ Vajilla pendiente' };
    } else if (autoCargo[i]) {
      autoState = { ok: autoCargo[i].ok, motivo: autoCargo[i].motivo };
    }

    var isChecked, lockCls = '', autoBadge = '', autoHint = '', autoOkAttr = '';
    var savedVal  = saved ? (saved.criterioValues[i] || 'SI') : null;
    var fromSaved = savedVal === 'SI' ? true : (savedVal === 'NO' ? false : null);
    if (autoState && autoState.ok === true) {
      isChecked = fromSaved !== null ? fromSaved : true;
      lockCls   = ' is-auto'; autoOkAttr = 'true';
      autoBadge = '<span class="cg-auto-badge cg-auto-ok">' + cgEsc(autoState.motivo) + '</span>';
      autoHint  = '<span class="cg-auto-hint">(click para override)</span>';
    } else if (autoState && autoState.ok === false) {
      isChecked = fromSaved !== null ? fromSaved : false;
      lockCls   = ' is-auto'; autoOkAttr = 'false';
      autoBadge = '<span class="cg-auto-badge cg-auto-no">' + cgEsc(autoState.motivo) + '</span>';
      autoHint  = '<span class="cg-auto-hint">(click para override)</span>';
      if (!primerMotivoFalso && isChecked === false) primerMotivoFalso = autoState.motivo;
    } else if (autoState && autoState.ok === null) {
      isChecked = fromSaved !== null ? fromSaved : true;
      autoBadge = '<span class="cg-auto-badge cg-auto-wait">' + cgEsc(autoState.motivo) + '</span>';
    } else {
      isChecked = fromSaved !== null ? fromSaved : true;
    }
    var isOverride = autoOkAttr !== '' &&
      ((autoOkAttr === 'true' && !isChecked) || (autoOkAttr === 'false' && isChecked));
    var overrideCls = isOverride ? ' is-override' : '';
    var overrideBadge = isOverride
      ? '<span class="cg-auto-badge cg-auto-override">🖊 Override manual</span>'
      : '';

    crits +=
      '<label class="cg-crit-row' + (!isChecked ? ' is-unchecked' : '') + lockCls + overrideCls + '"' +
      ' id="row-' + cid + '" data-auto-ok="' + autoOkAttr + '">' +
      '<input type="checkbox" id="' + cid + '" ' + (isChecked ? 'checked' : '') +
      ' data-evento="' + cgAttr(ev.codigoEvento) + '" data-cargo="' + cgAttr(cargo) + '" data-idx="' + i + '"' +
      ' onchange="cgOnCheck(this)">' +
      '<span class="cg-crit-label">' + cgEsc(crit) + '</span>' +
      autoBadge + overrideBadge + autoHint +
      '</label>';
  });

  var cascadeNo = !!primerMotivoFalso;
  var badgeRight = cascadeNo
    ? '<span class="cg-badge cg-badge-cascade-no">' + cgEsc(primerMotivoFalso) + ' — bono perdido</span>'
    : (saved
        ? '<span class="cg-badge cg-badge-saved">↩ Ya evaluado · editable</span>'
        : '<span class="cg-badge cg-badge-pending">' + cfg.criterios.length + ' criterios</span>');

  return '<div class="cg-cargo-section' + (cascadeNo ? ' is-cascade-no' : '') + '"' +
    ' data-evento="' + cgAttr(ev.codigoEvento) + '" data-cargo="' + cgAttr(cargo) + '">' +
    '<div class="cg-cargo-head">' +
    '<div><div class="cg-cargo-title">' + cgEsc(cargo) + '</div>' +
    '<div class="cg-cargo-bono">' + cgEsc(cfg.nombreBono) + '</div></div>' +
    badgeRight +
    '</div>' +
    '<div class="cg-criterios-list">' + crits + '</div>' +
    '</div>';
}

function cgOnCheck(cb) {
  var row = document.getElementById('row-' + cb.id);
  if (!row) return;
  row.classList.toggle('is-unchecked', !cb.checked);
  var autoOk = row.dataset.autoOk;
  if (autoOk === 'true' || autoOk === 'false') {
    var matches = (autoOk === 'true' && cb.checked) || (autoOk === 'false' && !cb.checked);
    row.classList.toggle('is-override', !matches);
    // Insertar/remover badge override
    var existingBadge = row.querySelector('.cg-auto-override');
    if (!matches && !existingBadge) {
      var b = document.createElement('span');
      b.className = 'cg-auto-badge cg-auto-override';
      b.textContent = '🖊 Override manual';
      // Insertar después del label de criterio
      var label = row.querySelector('.cg-crit-label');
      if (label && label.nextSibling) label.parentNode.insertBefore(b, label.nextSibling.nextSibling);
      else row.appendChild(b);
    } else if (matches && existingBadge) {
      existingBadge.remove();
    }
  }
}

function cgGuardarEvaluacion() {
  var btn = document.getElementById('cgBtnSave');
  btn.disabled = true;
  btn.textContent = '⏳ Guardando…';

  var evaluaciones = [];
  document.querySelectorAll('#cgContainer .cg-cargo-section').forEach(function(sec) {
    var codigoEvento = sec.dataset.evento;
    var cargo        = sec.dataset.cargo;
    var cfg          = CG.config[cargo];
    var ev           = CG.eventos.find(function(e) { return e.codigoEvento === codigoEvento; });
    if (!cfg || !ev) return;
    var criterioValues = [];
    sec.querySelectorAll('input[type=checkbox]').forEach(function(cb) {
      criterioValues.push(cb.checked ? 'SI' : 'NO');
    });
    evaluaciones.push({
      semana: CG.semana,
      fechaEvento: ev.fechaEvento,
      codigoEvento: codigoEvento,
      centro: ev.centro,
      cargo: cargo,
      criterioValues: criterioValues
    });
  });

  if (!evaluaciones.length) {
    btn.disabled = false;
    btn.textContent = '💾 Guardar evaluación';
    showToast('No hay evaluaciones para guardar', 'err');
    return;
  }

  cgApiPost('saveEvaluation', { evaluaciones: evaluaciones })
    .then(function(res) {
      btn.disabled = false;
      btn.textContent = '💾 Guardar evaluación';
      if (res.success) {
        showToast('CG: ' + (res.rowsAdded || 0) + ' nueva(s) · ' + (res.rowsUpdated || 0) + ' actualizada(s)', 'ok');
        setTimeout(cgCargarSemana, 800);
      } else {
        showToast('Error: ' + (res.error || 'desconocido'), 'err');
      }
    })
    .catch(function(e) {
      btn.disabled = false;
      btn.textContent = '💾 Guardar evaluación';
      showToast('Error: ' + e.message, 'err');
    });
}

function cgUpdateSaveBar() {
  var bar = document.getElementById('cgSaveBar');
  var info = document.getElementById('cgSaveInfo');
  var btn  = document.getElementById('cgBtnSave');
  if (!CG.eventos.length) { bar.style.display = 'none'; return; }
  bar.style.display = 'flex';
  var total = CG.eventos.length * Object.keys(CG.config).length;
  var ya    = CG.guardados.length;
  info.innerHTML = '<b>' + ya + '/' + total + '</b> cargo(s) evaluado(s) en la semana';
  btn.disabled = false;
}

// ===== Helpers =====
function cgSafeId(ev, cargo) {
  return (String(ev) + '_' + String(cargo)).replace(/[^a-zA-Z0-9]/g, '_');
}
function cgEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function cgAttr(s) { return cgEsc(s); }
function cgFmt(n) {
  return String(Math.round(n || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

// ===== Hook al tab switcher =====
// Cuando el usuario hace click en el tab CG por primera vez, ejecuta cgInit().
(function() {
  document.addEventListener('DOMContentLoaded', function() {
    var btnTab = document.querySelector('.tab-btn[data-tab="cg"]');
    if (btnTab) {
      btnTab.addEventListener('click', function() { setTimeout(cgInit, 50); });
    }
  });
})();
