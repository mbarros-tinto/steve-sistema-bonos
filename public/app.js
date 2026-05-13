/* =====================================================================
 * Sistema de Bonos · Tinto Banquetería · app.js
 * Cliente del dashboard. Vanilla JS, sin dependencias externas.
 * Patrón apiGet / apiPost igual que steve-pagos-web.
 * ===================================================================== */

// ===== Estado global =====
var APP = {
  semanas: [],
  cargos: [],
  personas: [],
  semanaActual: null,
  semanaData: null,         // resultado cacheado de getDatosSemana
  detalleData: null,        // resultado cacheado de getDetalleCriteriosSemana
  bonosInfoCache: null,     // {Maestro_Bonos info para resolver tipo/icono}
  toastTimer: null,
  // Criterios + Tarifas (lazy)
  criteriosLoaded: false,
  criteriosItems: [],
  criteriosEditable: false,
  tarifasLoaded: false,
  tarifasData: [],
  tarifasEditable: false
};

// ===== API helpers =====
function apiGet(action, params) {
  var url = window.API_URL + '?action=' + encodeURIComponent(action);
  if (params) for (var k in params) {
    if (params[k] !== undefined && params[k] !== null && params[k] !== '') {
      url += '&' + encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
    }
  }
  function tryFetch() {
    return fetch(url, { cache: 'no-cache' }).then(function(r) { return r.text(); }).then(function(text) {
      try { return JSON.parse(text); }
      catch(e) { throw new Error('Respuesta no-JSON del servidor'); }
    });
  }
  return tryFetch().catch(function() {
    return new Promise(function(res) { setTimeout(res, 350); }).then(tryFetch);
  });
}

function apiPost(action, data) {
  data = data || {};
  data.action = action;
  if (window.CURRENT_USER_EMAIL) data.userEmail = window.CURRENT_USER_EMAIL;
  return fetch(window.API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(data)
  }).then(function(r) { return r.json(); });
}

// ===== Helpers UI =====
function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function escAttr(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function fmtMoney(n) {
  return String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}
function showToast(msg, type) {
  var el = document.getElementById('toast');
  el.className = 'toast ' + (type || 'info') + ' visible';
  el.textContent = msg;
  if (APP.toastTimer) clearTimeout(APP.toastTimer);
  APP.toastTimer = setTimeout(function() { el.classList.remove('visible'); }, 3500);
}
function spinner(targetId, msg) {
  document.getElementById(targetId).innerHTML =
    '<div class="spinner-wrap"><div class="spinner"></div>' + esc(msg || 'Cargando…') + '</div>';
}
function showModal(id) {
  document.getElementById(id).classList.add('visible');
}
function cerrarModal(id) {
  document.getElementById(id).classList.remove('visible');
}

// ===== Boot =====
window.addEventListener('DOMContentLoaded', init);

function init() {
  cargarUsuarioCFAccess();
  apiGet('getWebAppData')
    .then(function(r) {
      if (!r || !r.ok) {
        document.getElementById('resSemana').innerHTML =
          '<div class="empty"><div class="empty-icon">⚠️</div><p>Error al cargar: ' + esc((r && r.msg) || 'sin respuesta') + '</p></div>';
        return;
      }
      APP.semanas  = r.semanas  || [];
      APP.cargos   = r.cargos   || [];
      APP.personas = r.personas || [];
      poblarSelect('selSemana', APP.semanas);
      poblarSelect('selCargo', APP.cargos);
      showToast(APP.semanas.length + ' semanas · ' + APP.cargos.length + ' cargos · ' + APP.personas.length + ' personas', 'ok');
    })
    .catch(function(e) { showToast('Error: ' + e.message, 'err'); });
}

function cargarUsuarioCFAccess() {
  // Detección de usuario por Cloudflare Access. Si no estamos en CF, falla
  // silencioso y el backend usa el deployer como autor.
  fetch('/cdn-cgi/access/get-identity', { credentials: 'include' })
    .then(function(r) { return r.ok ? r.json() : null; })
    .then(function(d) {
      if (d && d.email) {
        window.CURRENT_USER_EMAIL = d.email;
        var nombre = d.name || d.email.split('@')[0];
        document.getElementById('topbarUser').innerHTML = 'Sesión: <b>' + esc(nombre) + '</b>';
      } else {
        document.getElementById('topbarUser').textContent = '';
      }
    })
    .catch(function() { /* no estamos detrás de CF Access — modo dev */ });
}

function _setBotonesSemana(enabled) {
  ['btnPagos', 'btnMailBonos'].forEach(function(id) {
    var b = document.getElementById(id);
    if (!b) return;
    b.disabled = !enabled;
    b.title = enabled
      ? (id === 'btnPagos' ? 'Enviar bonos a Planilla de Pagos' : 'Mandar mail bonos a trabajadores')
      : 'Selecciona una semana para habilitar';
  });
}

function poblarSelect(id, valores) {
  var sel = document.getElementById(id);
  if (!sel) return;
  // Mantener primera opción placeholder
  var first = sel.options[0];
  sel.innerHTML = '';
  if (first) sel.appendChild(first);
  valores.forEach(function(v) {
    var o = document.createElement('option');
    o.value = v; o.textContent = v;
    sel.appendChild(o);
  });
}

// ===== Tabs nav =====
function switchTab(name, btn) {
  document.querySelectorAll('.tab-panel').forEach(function(p) { p.classList.remove('active'); });
  document.querySelectorAll('.tab-btn').forEach(function(b) { b.classList.remove('active'); });
  document.getElementById('panel-' + name).classList.add('active');
  if (btn) btn.classList.add('active');
  // Lazy load
  if (name === 'criterios' && !APP.criteriosLoaded) cargarCriterios();
  if (name === 'tarifas'   && !APP.tarifasLoaded)   cargarTarifas();
}

// ===== Sync =====
function sincronizar(btnEl) {
  var btn = btnEl || (typeof event !== 'undefined' ? event.target : null);
  if (!btn) return;
  var old = btn.textContent;
  btn.disabled = true;
  btn.textContent = '⏳ Sincronizando…';
  apiPost('sincronizar', {})
    .then(function(r) {
      btn.disabled = false; btn.textContent = old;
      if (r && r.ok) {
        var d = r.data || {};
        showToast('Sync OK · Fotos:' + (d.fotos || 0) + ' CG:' + (d.cg || 0) + ' Sup:' + (d.supervisoras || 0), 'ok');
        if (APP.semanaActual) cargarSemana();
      } else {
        showToast('Error: ' + ((r && r.msg) || 'desconocido'), 'err');
      }
    })
    .catch(function(e) {
      btn.disabled = false; btn.textContent = old;
      showToast('Error sync: ' + e.message, 'err');
    });
}

// ===== TAB SEMANA =====
function cargarSemana() {
  var semana = document.getElementById('selSemana').value;
  if (!semana) return;
  APP.semanaActual = semana;
  spinner('resSemana', 'Cargando bonos de la semana…');

  Promise.all([
    apiGet('getDatosSemana', { semana: semana }),
    apiGet('getDetalleCriteriosSemana', { semana: semana })
  ]).then(function(arr) {
    var datos   = arr[0];
    var detalle = arr[1];
    APP.semanaData  = datos;
    APP.detalleData = detalle;
    renderSemana(datos, detalle);
  }).catch(function(e) {
    document.getElementById('resSemana').innerHTML =
      '<div class="empty"><div class="empty-icon">⚠️</div><p>Error: ' + esc(e.message) + '</p></div>';
  });
}

function renderSemana(datos, detalle) {
  var el = document.getElementById('resSemana');
  if (!datos || !datos.ok) {
    el.innerHTML = '<div class="empty"><div class="empty-icon">⚠️</div><p>' + esc((datos && datos.msg) || 'Error') + '</p></div>';
    _setBotonesSemana(false);
    return;
  }
  var grupos = datos.grupos || {};
  var cargos = Object.keys(grupos).sort(comparadorCargos);
  if (cargos.length === 0) {
    el.innerHTML = '<div class="empty"><div class="empty-icon">📭</div><p>Sin bonos para esta semana</p></div>';
    _setBotonesSemana(false);
    return;
  }
  _setBotonesSemana(true);

  var html = '';
  cargos.forEach(function(cargo) {
    var eventos = grupos[cargo];
    var totalBonos = eventos.reduce(function(s, ev) { return s + ev.bonos.length; }, 0);
    var ganados    = eventos.reduce(function(s, ev) { return s + ev.bonos.filter(function(b) { return b.cumplido === 1; }).length; }, 0);
    html += '<div class="cargo-group">';
    html += '<div class="cargo-group-header">';
    html += '<span>👥 ' + esc(cargo) + '</span>';
    html += '<span class="cargo-group-meta">' + eventos.length + ' evento(s) · ' + ganados + '/' + totalBonos + ' ganados</span>';
    html += '</div>';
    html += '<div class="cargo-group-body">';
    eventos.forEach(function(ev) {
      html += renderEventoCard(ev, cargo, detalle);
    });
    html += '</div></div>';
  });
  el.innerHTML = html;
}

function renderEventoCard(ev, cargo, detalle) {
  // ev.codigo por convención del CRM es "Centro DD/MM/YYYY" (col P del CRM
  // CONSOLIDADO). Extraemos el lugar sacando la fecha del final, así
  // garantizamos que el lugar siempre se vea aunque ev.centro contenga otra
  // cosa (ej: nombre de novios) en Base_Criterios.
  var lugar     = String(ev.codigo || '').replace(/\s+\d{1,2}\/\d{1,2}\/\d{4}\s*$/, '').trim();
  var nombreTop = ev.centro || lugar || ev.codigo || '';
  var mostrarLugar = lugar && lugar !== nombreTop;

  var html = '<div class="event-card">';
  html += '<div class="event-card-head">';
  html += '<span class="event-name">🏛️ ' + esc(nombreTop);
  if (mostrarLugar) html += ' <span class="event-lugar">· 📍 ' + esc(lugar) + '</span>';
  html += '</span>';
  html += '<span class="event-date">' + esc(ev.fecha || '') + '</span>';
  html += '</div>';
  if (ev.trabajador) html += '<div class="event-trab">👤 ' + esc(ev.trabajador) + '</div>';
  (ev.bonos || []).forEach(function(b) {
    html += renderBono(b, ev.codigo, cargo, detalle);
  });
  html += '</div>';
  return html;
}

function renderBono(bono, codigoEvento, cargo, detalle) {
  var ganoCls = bono.cumplido === 1 ? 'gano' : 'no-gano';
  var ganoTxt = bono.cumplido === 1 ? '✓ SÍ' : '✗ NO';
  var icon    = iconFuente(bono.fuente);
  var hasOverride = bono.override && bono.override.activo;
  var ovBadge = hasOverride ? ' <span class="override-badge" title="' + esc(bono.override.razon || 'Override manual') + '">✎ editado</span>' : '';
  var esFotos = (bono.fuente || '').indexOf('Fotos') !== -1;

  var html = '<div class="bono ' + ganoCls + (hasOverride ? ' has-override' : '') + '">';
  html += '<div>';
  html += '<div class="bono-title"><span class="bono-icon">' + icon + '</span>' + esc(bono.nombre) + ovBadge + '</div>';
  html += renderCriteriosBono(bono, codigoEvento, cargo, detalle);
  html += '</div>';
  html += '<div class="bono-actions">';
  html += '<button class="btn-icon" title="Trabajadores que cobran este bono" onclick="abrirModalTrabajadores(\'' + escAttr(codigoEvento) + '\',\'' + escAttr(bono.nombre) + '\')">👤</button>';
  if (esFotos) {
    html += '<button class="btn-icon" title="Ver fotos del evento" onclick="abrirModalFotos(\'' + escAttr(codigoEvento) + '\',\'' + escAttr(cargo) + '\')">📷</button>';
  }
  html += '<button class="btn-icon" title="Editar ganó/no ganó" onclick="abrirModalOverride(\'' + escAttr(codigoEvento) + '\',\'' + escAttr(bono.nombre) + '\',' + (bono.cumplido === 1 ? 'true' : 'false') + ',' + (hasOverride ? 'true' : 'false') + ')">✎</button>';
  html += '<span class="bono-resultado ' + ganoCls + '">' + ganoTxt + '</span>';
  html += '</div>';
  html += '</div>';
  return html;
}

function renderCriteriosBono(bono, codigoEvento, cargo, detalle) {
  if (!detalle || !detalle.ok) return '';
  var fuente = bono.fuente || '';
  var html = '';

  function esInactivo(v) { return !v || /^[-—\s]*$/.test(String(v).trim()); }
  function lineaCrit(isSi, name) {
    var cls = isSi ? 'cumplido' : 'fallado';
    var icon = isSi ? '✓' : '✗';
    return '<div class="crit-line ' + cls + '"><span class="crit-icon">' + icon + '</span><span>' + esc(name) + '</span></div>';
  }
  function pctFooter(si, total) {
    if (!total) return '';
    var pct = Math.round(si / total * 100);
    return '<div class="crit-pct">' + pct + '% (' + si + '/' + total + ')</div>';
  }

  if (fuente.indexOf('CG') !== -1) {
    var match = (detalle.cg || []).find(function(r) { return r.codigoEvento === codigoEvento && r.cargo === cargo; });
    if (match) {
      var cfg = (detalle.criteriosConfig.CG || {})[cargo] || {};
      var names = cfg.criterioNames || [];
      var vals = match.criterioValues || [];
      var si = 0, tot = 0;
      html += '<div class="criterios">';
      for (var i = 0; i < vals.length; i++) {
        if (esInactivo(vals[i])) continue;
        var isSi = (String(vals[i]).trim().toUpperCase() === 'SI' || vals[i] === '1');
        tot++; if (isSi) si++;
        html += lineaCrit(isSi, names[i] || 'Criterio ' + (i + 1));
      }
      html += pctFooter(si, tot);
      html += '</div>';
    }
  } else if (fuente.indexOf('Fotos') !== -1) {
    var matchF = (detalle.fotos || []).find(function(r) { return r.codigoEvento === codigoEvento && r.cargo === cargo; });
    if (matchF) {
      var cfgF = (detalle.criteriosConfig.Fotos || {})[cargo] || {};
      var namesF = cfgF.criterioNames || [];
      var valsF = matchF.respValues || [];
      var siF = 0, totF = 0;
      html += '<div class="criterios">';
      for (var j = 0; j < valsF.length; j++) {
        if (esInactivo(valsF[j])) continue;
        var isSiF = (String(valsF[j]).trim().toUpperCase() === 'SI' || valsF[j] === '1');
        totF++; if (isSiF) siF++;
        html += lineaCrit(isSiF, namesF[j] || 'Resp ' + (j + 1));
      }
      html += pctFooter(siF, totF);
      html += '</div>';
    }
  } else if (fuente.indexOf('Supervisoras') !== -1) {
    var matchS = (detalle.supervisoras || []).find(function(r) { return r.codigoEvento === codigoEvento && r.cargo === cargo; });
    if (matchS) {
      var cfgS = (detalle.criteriosConfig.Supervisoras || {})[cargo] || {};
      var namesS = cfgS.criterioNames || [];
      var valsS = matchS.criterioValues || [];
      if (valsS.length) {
        var siS = 0, totS = 0;
        html += '<div class="criterios">';
        for (var k = 0; k < valsS.length; k++) {
          if (esInactivo(valsS[k])) continue;
          var isSiS = (String(valsS[k]).trim().toUpperCase() === 'SI' || valsS[k] === '1');
          totS++; if (isSiS) siS++;
          html += lineaCrit(isSiS, namesS[k] || 'Criterio ' + (k + 1));
        }
        html += pctFooter(siS, totS);
        html += '</div>';
      }
    }
  }
  return html;
}

function iconFuente(fuente) {
  var f = String(fuente || '').toLowerCase();
  if (f.indexOf('fotos') !== -1) return '📸';
  if (f.indexOf('supervisoras') !== -1) return '⭐';
  if (f.indexOf('vajilla') !== -1) return '🍽';
  if (f.indexOf('cg') !== -1) return '📦';
  return '🎯';
}

// Orden canónico de cargos en la vista de semana
var ORDEN_CARGOS = [
  'Super metre', 'Metre', 'Jefe de Bar', 'Jefe Cocina',
  'Copero Jefe', 'Copero', 'Barmans', 'Barman',
  'Garzones', 'Garzón', 'Garzon Decoración', 'Jefa de Decoración',
  'Jefa de Floristas', 'Florista', 'Asignación Encargados Novios'
];
function comparadorCargos(a, b) {
  var ia = ORDEN_CARGOS.indexOf(a); if (ia < 0) ia = 999;
  var ib = ORDEN_CARGOS.indexOf(b); if (ib < 0) ib = 999;
  if (ia !== ib) return ia - ib;
  return a.localeCompare(b);
}

// ===== MODAL: Trabajadores que cobran un bono =====
function abrirModalTrabajadores(codigo, nombreBono) {
  var box = document.getElementById('modalTrabsBox');
  box.innerHTML =
    '<div class="modal-title">👤 Trabajadores del bono</div>' +
    '<div class="modal-sub">' + esc(nombreBono) + ' · ' + esc(codigo) + '</div>' +
    '<div id="trabsContent"><div class="spinner-wrap"><div class="spinner"></div>Buscando trabajadores…</div></div>' +
    '<div class="modal-actions"><button class="btn btn-secondary" onclick="cerrarModal(\'modalTrabsBackdrop\')">Cerrar</button></div>';
  showModal('modalTrabsBackdrop');
  apiGet('getTrabajadoresDelBono', { codigo: codigo, nombreBono: nombreBono })
    .then(function(r) { renderTrabsModal(r); })
    .catch(function(e) {
      document.getElementById('trabsContent').innerHTML =
        '<div class="empty">Error: ' + esc(e.message) + '</div>';
    });
}

function renderTrabsModal(r) {
  var el = document.getElementById('trabsContent');
  if (!el) return;
  if (!r || !r.ok) {
    el.innerHTML = '<div class="empty">⚠️ ' + esc((r && r.msg) || 'Error') + '</div>';
    return;
  }
  var trabs = r.trabajadores || [];
  var aplicables = r.cargosAplicables || [];
  var monto = r.monto || 0;

  var html = '<div class="modal-section">';
  html += '<div class="modal-section-title">Cargos aplicables · monto $' + fmtMoney(monto) + '/persona</div>';
  html += '<div style="font-size:0.82em;color:rgba(255,255,255,0.7);">' + esc(aplicables.join(' · ')) + '</div>';
  html += '</div>';

  if (!trabs.length) {
    html += '<div class="empty"><div class="empty-icon">📭</div><p>Sin trabajadores con cargos aplicables en Planilla Maestra</p></div>';
  } else {
    html += '<div class="modal-section">';
    html += '<div class="modal-section-title">Reciben el bono (' + trabs.length + ')</div>';
    trabs.forEach(function(t) {
      html += '<div class="modal-row">';
      html += '<span class="modal-row-name">' + esc(t.nombre) + '<span class="modal-row-meta"> · ' + esc(t.cargo) + '</span></span>';
      html += '<span class="modal-row-monto">$' + fmtMoney(monto) + '</span>';
      html += '</div>';
    });
    html += '<div class="modal-row" style="border-top:1px solid rgba(201,169,110,0.3);padding-top:8px;margin-top:6px;font-weight:700;"><span class="modal-row-name">Total</span><span class="modal-row-monto">$' + fmtMoney(monto * trabs.length) + '</span></div>';
    html += '</div>';
  }
  el.innerHTML = html;
}

// ===== MODAL: Fotos del evento =====
function abrirModalFotos(codigo, cargo) {
  var box = document.getElementById('modalFotosBox');
  box.innerHTML =
    '<div class="modal-title">📷 Fotos del evento</div>' +
    '<div class="modal-sub">' + esc(codigo) + ' · ' + esc(cargo) + '</div>' +
    '<div id="fotosContent"><div class="spinner-wrap"><div class="spinner"></div>Cargando fotos…</div></div>' +
    '<div class="modal-actions"><button class="btn btn-secondary" onclick="cerrarModal(\'modalFotosBackdrop\')">Cerrar</button></div>';
  showModal('modalFotosBackdrop');
  apiGet('getFotosDeEvento', { codigo: codigo, cargo: cargo })
    .then(function(r) { renderFotosModal(r); })
    .catch(function(e) {
      document.getElementById('fotosContent').innerHTML = '<div class="empty">Error: ' + esc(e.message) + '</div>';
    });
}

function renderFotosModal(r) {
  var el = document.getElementById('fotosContent');
  if (!el) return;
  if (!r || !r.ok) {
    el.innerHTML = '<div class="empty">⚠️ ' + esc((r && r.msg) || 'Error') + '</div>';
    return;
  }
  var fotos = r.fotos || [];
  if (!fotos.length) {
    el.innerHTML = '<div class="empty"><div class="empty-icon">📭</div><p>Sin fotos subidas todavía</p><p class="sub">Cuando el fotógrafo suba las fotos vía Fotos 2.0 aparecerán acá</p></div>';
    return;
  }
  var html = '<div class="fotos-grid">';
  fotos.forEach(function(f) {
    var thumb = f.fileId ? ('https://drive.google.com/thumbnail?id=' + encodeURIComponent(f.fileId) + '&sz=w320') : '';
    html += '<div class="foto-card">';
    if (thumb) {
      html += '<a href="' + esc(f.url) + '" target="_blank" rel="noopener"><img class="foto-thumb" src="' + esc(thumb) + '" alt="' + esc(f.instruccion) + '" loading="lazy" onerror="this.style.display=\'none\'"></a>';
    }
    html += '<div class="foto-caption">' + esc(f.instruccion || '—') + '</div>';
    html += '<a class="foto-link" href="' + esc(f.url) + '" target="_blank" rel="noopener">Abrir en Drive →</a>';
    html += '</div>';
  });
  html += '</div>';
  html += '<div style="font-size:0.75em;color:rgba(255,255,255,0.55);margin-top:8px;">' + fotos.length + ' foto(s) válida(s)</div>';
  el.innerHTML = html;
}

// ===== MODAL: Override (editar ganó/no ganó) =====
var _overrideCtx = null;

function abrirModalOverride(codigo, nombreBono, cumplidoActual, hasOverride) {
  _overrideCtx = { codigo: codigo, nombreBono: nombreBono, cumplidoActual: !!cumplidoActual, hasOverride: !!hasOverride };
  var estadoActual = cumplidoActual ? '✓ Ganó' : '✗ No ganó';
  var box = document.getElementById('modalOverrideBox');
  var html = '';
  html += '<div class="modal-title">✎ Editar bono</div>';
  html += '<div class="modal-sub">Sobrescribe manualmente si el bono se ganó o no. Se propaga a Base, Resumen y Finanzas. Al pagar, se reparte entre los trabajadores con cargos aplicables.</div>';
  html += '<div class="modal-section">';
  html += '<div class="modal-row"><span class="modal-row-name">Bono</span><span class="modal-row-meta">' + esc(nombreBono) + '</span></div>';
  html += '<div class="modal-row"><span class="modal-row-name">Evento</span><span class="modal-row-meta">' + esc(codigo) + '</span></div>';
  html += '<div class="modal-row"><span class="modal-row-name">Estado actual</span><span class="modal-row-meta">' + estadoActual + (hasOverride ? ' <span class="override-badge">override</span>' : '') + '</span></div>';
  html += '</div>';
  html += '<div class="modal-section">';
  html += '<div class="modal-section-title">Nuevo estado</div>';
  html += '<div class="radio-group">';
  html += '<label class="radio-card"><input type="radio" name="ovState" value="true"' + (cumplidoActual ? ' checked' : '') + '><span class="radio-card-label si">✓ Se ganó el bono</span></label>';
  html += '<label class="radio-card"><input type="radio" name="ovState" value="false"' + (!cumplidoActual ? ' checked' : '') + '><span class="radio-card-label no">✗ No se ganó el bono</span></label>';
  html += '</div>';
  html += '<label style="display:block;margin-top:10px;font-size:0.8em;color:rgba(255,255,255,0.7);">Razón (opcional):</label>';
  html += '<textarea id="ovRazon" placeholder="Ej: supervisor confirmó por WhatsApp" style="width:100%;min-height:60px;margin-top:4px;"></textarea>';
  html += '</div>';
  html += '<div class="modal-actions">';
  html += '<button class="btn btn-secondary" onclick="cerrarModal(\'modalOverrideBackdrop\')">Cancelar</button>';
  if (hasOverride) html += '<button class="btn btn-secondary" style="background:rgba(255,107,107,0.15);color:#ff9090;border-color:rgba(255,107,107,0.3);" onclick="eliminarOverride()">Quitar override</button>';
  html += '<button class="btn btn-primary" id="ovBtnSave" onclick="guardarOverride()">Guardar</button>';
  html += '</div>';
  box.innerHTML = html;
  showModal('modalOverrideBackdrop');
}

function guardarOverride() {
  if (!_overrideCtx) return;
  var radios = document.getElementsByName('ovState');
  var override = null;
  for (var i = 0; i < radios.length; i++) {
    if (radios[i].checked) { override = (radios[i].value === 'true'); break; }
  }
  if (override === null) { showToast('Selecciona Ganó o No ganó', 'err'); return; }
  var razon = document.getElementById('ovRazon').value || '';
  var btn = document.getElementById('ovBtnSave');
  btn.disabled = true; btn.textContent = 'Guardando…';
  var ctx = _overrideCtx;
  apiPost('setOverrideBono', {
    codigo: ctx.codigo, nombreBono: ctx.nombreBono,
    override: override, razon: razon
  }).then(function(r) {
    if (r && r.ok) {
      showToast('Override guardado · recargando semana…', 'ok');
      cerrarModal('modalOverrideBackdrop');
      cargarSemana();
    } else {
      btn.disabled = false; btn.textContent = 'Guardar';
      showToast('Error: ' + ((r && r.msg) || 'desconocido'), 'err');
    }
  }).catch(function(e) {
    btn.disabled = false; btn.textContent = 'Guardar';
    showToast('Error: ' + e.message, 'err');
  });
}

function eliminarOverride() {
  if (!_overrideCtx) return;
  if (!confirm('¿Quitar el override y volver al cálculo natural?')) return;
  var ctx = _overrideCtx;
  apiPost('deleteOverrideBono', { codigo: ctx.codigo, nombreBono: ctx.nombreBono })
    .then(function(r) {
      if (r && r.ok) {
        showToast('Override eliminado · recargando…', 'ok');
        cerrarModal('modalOverrideBackdrop');
        cargarSemana();
      } else {
        showToast('Error: ' + ((r && r.msg) || 'desconocido'), 'err');
      }
    })
    .catch(function(e) { showToast('Error: ' + e.message, 'err'); });
}

// ===== MODAL PAGOS (paso 4-5: escribir bonos a Planilla Maestra) =====
var _pagos = { codigo: null, eventosAll: [] };

var ORDEN_TIPOS = { 'Fotos': 1, 'Supervisora': 2, 'Control Gestión': 3, 'Vajilla': 4 };
var ORDEN_CARGOS_PREVIEW = {
  'Super metre': 1, 'Metre': 2, 'Jefe de Bar': 3, 'Jefe Cocina': 4,
  'Copero Jefe': 5, 'Copero': 6, 'Barmans': 7, 'Garzones': 8,
  'Jefa de Floristas': 9, 'Jefa de Decoración': 10, 'Asignación Encargados Novios': 11
};
function _cargoRank(c) { return ORDEN_CARGOS_PREVIEW[c] || 999; }
function _tipoRank(t)  { return ORDEN_TIPOS[t]   || 999; }

// Agrupa matches del paso 4-5 por cargoBase → tipoBono → trabajadores.
function agruparPreview(matches) {
  if (!matches || !matches.length) return [];
  var grupos = {};
  matches.forEach(function(m) {
    var cb = m.cargoBase || m.cargo || '(sin cargo)';
    if (!grupos[cb]) grupos[cb] = { cargoBase: cb, tipos: {} };
    var tb = m.tipoBono || '(otro)';
    if (!grupos[cb].tipos[tb]) grupos[cb].tipos[tb] = { tipoBono: tb, nombreBono: m.nombreBono, monto: m.monto, trabajadores: [] };
    grupos[cb].tipos[tb].trabajadores.push(m);
  });
  var arr = [];
  Object.keys(grupos).forEach(function(cb) {
    var g = grupos[cb];
    var tiposArr = [];
    Object.keys(g.tipos).forEach(function(tb) {
      var tg = g.tipos[tb];
      tg.trabajadores.sort(function(a, b) { return a.trabajador.localeCompare(b.trabajador); });
      tiposArr.push(tg);
    });
    tiposArr.sort(function(a, b) { return _tipoRank(a.tipoBono) - _tipoRank(b.tipoBono); });
    arr.push({ cargoBase: cb, tipos: tiposArr });
  });
  arr.sort(function(a, b) {
    var ra = _cargoRank(a.cargoBase), rb = _cargoRank(b.cargoBase);
    if (ra !== rb) return ra - rb;
    return a.cargoBase.localeCompare(b.cargoBase);
  });
  return arr;
}

function _renderBonosAgrupados(bonos) {
  var grupos = agruparPreview(bonos);
  var html = '';
  grupos.forEach(function(g) {
    html += '<div class="prev-grupo">';
    html += '<div class="prev-grupo-head">' + esc(g.cargoBase) + '</div>';
    g.tipos.forEach(function(t) {
      var n = t.trabajadores.length;
      var totalTipo = 0;
      t.trabajadores.forEach(function(tr) { totalTipo += Number(tr.monto) || 0; });
      var personasTxt = n + (n === 1 ? ' persona' : ' personas');
      html += '<div class="prev-tipo">';
      html += '<div class="prev-tipo-name">';
      html += '<span class="prev-tag">' + esc(t.tipoBono) + '</span> ';
      html += esc(t.nombreBono);
      html += '<span class="prev-meta"> · <b>' + personasTxt + '</b></span>';
      html += '<span class="prev-monto">$' + fmtMoney(totalTipo) + '</span>';
      html += '</div>';
      t.trabajadores.forEach(function(tr) {
        html += '<div class="prev-trab">';
        html += '<span class="prev-trab-name">↳ ' + esc(tr.trabajador) + '<span class="prev-trab-meta"> · ' + esc(tr.cargo) + '</span></span>';
        html += '<span class="prev-trab-estado">' + esc(tr.estado) + '</span>';
        html += '<span class="prev-trab-monto">$' + fmtMoney(tr.monto) + '</span>';
        html += '</div>';
      });
      html += '</div>';
    });
    html += '</div>';
  });
  return html;
}

function abrirModalPagos() {
  var semana = document.getElementById('selSemana').value;
  if (!semana) { showToast('Selecciona una semana primero', 'err'); return; }
  if (!APP.semanaData || !APP.semanaData.ok) { showToast('Carga una semana primero', 'err'); return; }
  var eventosSet = {};
  Object.keys(APP.semanaData.grupos || {}).forEach(function(cargo) {
    (APP.semanaData.grupos[cargo] || []).forEach(function(ev) {
      if (ev.codigo) eventosSet[ev.codigo] = { codigo: ev.codigo, centro: ev.centro, fecha: ev.fecha };
    });
  });
  var eventos = Object.keys(eventosSet).map(function(k) { return eventosSet[k]; });
  if (!eventos.length) { showToast('No hay eventos en esta semana', 'err'); return; }

  _pagos.codigo = null;
  _pagos.eventosAll = eventos.map(function(ev) { return ev.codigo; });

  var html = '';
  html += '<div class="modal-title">📤 Enviar bonos a Planilla de <span style="color:var(--gold);font-style:italic;">Pagos</span></div>';
  html += '<div class="modal-sub">Semana ' + esc(semana) + ' — Selecciona un evento o "Todos" para revisar y enviar la semana completa.</div>';
  html += '<div class="modal-section">';
  html += '<select id="modalSelEvento" onchange="previewEventoPagos()" style="width:100%;">';
  html += '<option value="">— Seleccionar evento —</option>';
  html += '<option value="__ALL__">🌐 Todos los eventos aprobados (' + eventos.length + ')</option>';
  eventos.forEach(function(ev) {
    html += '<option value="' + escAttr(ev.codigo) + '">' + esc(ev.codigo) + ' · ' + esc(ev.centro || '') + ' · ' + esc(ev.fecha || '') + '</option>';
  });
  html += '</select>';
  html += '</div>';
  html += '<div id="pagosContent"></div>';
  html += '<div class="modal-actions">';
  html += '<button class="btn btn-secondary" onclick="cerrarModal(\'modalPagosBackdrop\')">Cerrar</button>';
  html += '<button class="btn btn-success" id="btnEscribirPagos" disabled onclick="confirmarEscrituraPagos()">Escribir bonos</button>';
  html += '</div>';
  document.getElementById('modalPagosBox').innerHTML = html;
  showModal('modalPagosBackdrop');
}

function previewEventoPagos() {
  var codigo = document.getElementById('modalSelEvento').value;
  var contentEl = document.getElementById('pagosContent');
  var btn = document.getElementById('btnEscribirPagos');
  btn.disabled = true;
  _pagos.codigo = null;
  if (!codigo) { contentEl.innerHTML = ''; return; }
  contentEl.innerHTML = '<div class="spinner-wrap"><div class="spinner"></div>Cargando preview…</div>';

  if (codigo === '__ALL__') {
    apiGet('previewBonosTodosLosEventos', { codigos: JSON.stringify(_pagos.eventosAll) })
      .then(function(r) { renderPreviewMultiPagos(r); })
      .catch(function(e) { contentEl.innerHTML = '<div class="empty">Error: ' + esc(e.message) + '</div>'; });
  } else {
    apiGet('previewBonosParaPlanillaMaestra', { codigo: codigo })
      .then(function(r) { renderPreviewSingle(r, codigo); })
      .catch(function(e) { contentEl.innerHTML = '<div class="empty">Error: ' + esc(e.message) + '</div>'; });
  }
}

function renderPreviewSingle(r, codigo) {
  var contentEl = document.getElementById('pagosContent');
  var btn = document.getElementById('btnEscribirPagos');
  if (!r || !r.ok) {
    contentEl.innerHTML = '<div class="empty">⚠️ ' + esc((r && r.msg) || 'Error') + '</div>';
    btn.disabled = true;
    return;
  }
  var html = '';
  html += '<div class="modal-section">';
  html += '<div class="modal-section-title">Evento</div>';
  html += '<div style="font-size:0.82em;color:rgba(255,255,255,0.7);">' + esc(r.evento.lugar) + ' · ' + esc(r.evento.fecha) + (r.evento.linea ? ' · ' + esc(r.evento.linea) : '') + '</div>';
  if (r.yaEscritos > 0) {
    html += '<div style="font-size:0.78em;color:var(--warn);margin-top:6px;">⚠️ Ya hay ' + r.yaEscritos + ' bono(s) escrito(s) previamente para este evento. Se reemplazarán.</div>';
  }
  html += '</div>';

  if (r.mismatches && r.mismatches.length) {
    html += '<div class="modal-section mismatch">';
    html += '<div class="modal-section-title" style="color:var(--err);">❌ Mismatches (' + r.mismatches.length + ')</div>';
    r.mismatches.forEach(function(m) {
      html += '<div class="modal-row"><span class="modal-row-name">' + esc(m.trabajadorBono) + '<span class="modal-row-meta"> · ' + esc(m.cargo) + '</span></span><span style="color:var(--err);font-size:0.78em;">' + esc(m.motivo || '') + '</span></div>';
    });
    html += '<div style="font-size:0.78em;color:rgba(255,107,107,0.85);margin-top:6px;">Resolver en Planilla Maestra y reintentar. <b>Hasta entonces, no se escribirá ningún bono.</b></div>';
    html += '</div>';
  }

  if (r.bonos && r.bonos.length) {
    html += '<div class="modal-section">';
    html += '<div class="modal-section-title">Bonos a escribir (' + r.bonos.length + ')</div>';
    html += _renderBonosAgrupados(r.bonos);
    html += '<div class="modal-total">Total: $' + fmtMoney(r.totalMonto) + '</div>';
    html += '</div>';
  } else {
    html += '<div class="empty">Sin bonos ganados listos para escribir.</div>';
  }

  contentEl.innerHTML = html;
  var habilitar = r.bonos && r.bonos.length && (!r.mismatches || !r.mismatches.length);
  btn.disabled = !habilitar;
  btn.textContent = habilitar ? 'Escribir ' + r.bonos.length + ' bono(s) · $' + fmtMoney(r.totalMonto) : 'Resolvé los mismatches';
  _pagos.codigo = codigo;
}

function renderPreviewMultiPagos(r) {
  var contentEl = document.getElementById('pagosContent');
  var btn = document.getElementById('btnEscribirPagos');
  if (!r || !r.ok) {
    contentEl.innerHTML = '<div class="empty">⚠️ ' + esc((r && r.msg) || 'Error') + '</div>';
    btn.disabled = true;
    return;
  }
  var html = '';
  var totalBonos = 0, totalMismatches = 0, eventosOk = 0, eventosFail = 0;
  (r.eventos || []).forEach(function(ev) {
    var p = ev.preview || {};
    html += '<div class="modal-section">';
    html += '<div class="modal-section-title">🏛️ ' + esc(ev.codigo) + (p.ok && p.evento ? ' · ' + esc(p.evento.fecha) : '') + '</div>';
    if (!p.ok) {
      html += '<div class="empty" style="padding:10px;">' + esc(p.msg || 'No se pudo previsualizar') + '</div>';
      eventosFail++;
    } else {
      if (p.yaEscritos > 0) html += '<div style="font-size:0.78em;color:var(--warn);margin-bottom:6px;">⚠️ ' + p.yaEscritos + ' bono(s) previos serán reemplazados.</div>';
      if (p.mismatches && p.mismatches.length) {
        html += '<div class="mismatch" style="padding:8px;border-radius:6px;margin-bottom:6px;">';
        html += '<div style="font-weight:700;color:var(--err);font-size:0.82em;">❌ ' + p.mismatches.length + ' mismatch(es)</div>';
        p.mismatches.forEach(function(m) {
          html += '<div class="modal-row"><span class="modal-row-name">' + esc(m.trabajadorBono) + ' · ' + esc(m.cargo) + '</span><span class="modal-row-monto" style="color:var(--err);">$' + fmtMoney(m.monto) + '</span></div>';
        });
        html += '</div>';
        totalMismatches += p.mismatches.length;
        eventosFail++;
      } else {
        eventosOk++;
      }
      if (p.bonos && p.bonos.length) {
        html += _renderBonosAgrupados(p.bonos);
        html += '<div class="modal-total" style="margin-top:4px;">Subtotal evento: $' + fmtMoney(p.totalMonto) + '</div>';
        totalBonos += p.bonos.length;
      } else {
        html += '<div class="empty" style="padding:10px;">Sin bonos.</div>';
      }
    }
    html += '</div>';
  });

  html = '<div class="modal-section" style="background:rgba(46,125,90,0.15);border-color:rgba(46,125,90,0.4);">' +
         '<div class="modal-section-title" style="color:var(--ok);">📊 Resumen semana</div>' +
         '<div style="font-size:0.85em;color:rgba(255,255,255,0.8);">' +
         eventosOk + ' evento(s) OK · ' + eventosFail + ' con problemas · ' + totalBonos + ' filas a escribir · ' + totalMismatches + ' mismatch(es)' +
         '</div>' +
         '<div class="modal-total" style="margin-top:6px;">Total global: $' + fmtMoney(r.totalGlobal || 0) + '</div>' +
         '</div>' + html;
  contentEl.innerHTML = html;
  var habilitar = totalBonos > 0 && totalMismatches === 0;
  btn.disabled = !habilitar;
  btn.textContent = habilitar
    ? 'Escribir bonos de todos los eventos · $' + fmtMoney(r.totalGlobal || 0)
    : 'Resolvé los mismatches antes de escribir';
  _pagos.codigo = '__ALL__';
}

function confirmarEscrituraPagos() {
  if (!_pagos.codigo) return;
  var btn = document.getElementById('btnEscribirPagos');
  var prev = btn.textContent;
  btn.disabled = true; btn.textContent = '⏳ Escribiendo…';
  var contentEl = document.getElementById('pagosContent');

  if (_pagos.codigo === '__ALL__') {
    apiPost('escribirBonosMultipleEventos', { codigos: _pagos.eventosAll })
      .then(function(r) { _onEscritoPagos(r, btn, prev, contentEl, true); })
      .catch(function(e) { btn.disabled = false; btn.textContent = prev; contentEl.innerHTML = '<div class="empty">Error: ' + esc(e.message) + '</div>'; });
  } else {
    apiPost('escribirBonosEnPlanillaMaestra', { codigo: _pagos.codigo })
      .then(function(r) { _onEscritoPagos(r, btn, prev, contentEl, false); })
      .catch(function(e) { btn.disabled = false; btn.textContent = prev; contentEl.innerHTML = '<div class="empty">Error: ' + esc(e.message) + '</div>'; });
  }
}

function _onEscritoPagos(r, btn, prev, contentEl, multi) {
  if (r && r.ok) {
    contentEl.innerHTML = '<div class="modal-section" style="background:rgba(46,125,90,0.18);border-color:rgba(46,125,90,0.4);"><div style="color:var(--ok);font-weight:700;">✅ ' + esc(r.msg || 'Bonos escritos') + '</div></div>';
    showToast('Bonos escritos en Planilla de Pagos', 'ok');
    btn.textContent = 'Listo';
  } else {
    var msg = (r && r.msg) || 'Error';
    var html = '<div class="empty" style="color:var(--err);">⚠️ ' + esc(msg) + '</div>';
    if (multi && r && r.fallos) {
      r.fallos.forEach(function(f) {
        html += '<div class="modal-section mismatch"><div class="modal-section-title" style="color:var(--err);">❌ ' + esc(f.codigo) + '</div><div style="font-size:0.82em;color:rgba(255,107,107,0.8);">' + esc(f.msg) + '</div></div>';
      });
    }
    if (multi && r && r.escritos && r.escritos.length) {
      html += '<div class="modal-section"><div class="modal-section-title" style="color:var(--ok);">✓ OK (' + r.escritos.length + ')</div>';
      r.escritos.forEach(function(e) {
        html += '<div class="modal-row"><span class="modal-row-name">' + esc(e.codigo) + '</span><span class="modal-row-monto">' + e.escritos + ' filas · $' + fmtMoney(e.totalMonto) + '</span></div>';
      });
      html += '</div>';
    }
    contentEl.innerHTML = html;
    btn.disabled = false; btn.textContent = prev;
  }
}

// ===== MODAL MAIL BONOS =====
var _mail = { preview: null, filtro: 'todos' };

function abrirModalMailBonos() {
  var semana = document.getElementById('selSemana').value;
  if (!semana) { showToast('Selecciona una semana primero', 'err'); return; }
  _mail.filtro = 'todos';

  var box = document.getElementById('modalMailBox');
  box.innerHTML =
    '<div class="modal-title">📧 Mandar mail <span style="color:var(--gold);font-style:italic;">bonos</span></div>' +
    '<div class="modal-sub">Semana ' + esc(semana) + ' — Cargando preview…</div>' +
    '<div id="mailContent"><div class="spinner-wrap"><div class="spinner"></div>Calculando bonos por trabajador…</div></div>' +
    '<div class="modal-actions"><button class="btn btn-secondary" onclick="cerrarModal(\'modalMailBackdrop\')">Cerrar</button></div>';
  showModal('modalMailBackdrop');

  apiGet('getMailPreviewSemana', { semana: semana })
    .then(function(r) { renderMailPreview(r, semana); })
    .catch(function(e) {
      document.getElementById('mailContent').innerHTML = '<div class="empty">Error: ' + esc(e.message) + '</div>';
    });
}

function mailCambiarFiltro(f) {
  _mail.filtro = f;
  if (_mail.preview) renderMailPreview(_mail.preview, _mail.preview.semana);
}

function mailToggleAll(state) {
  document.querySelectorAll('.mail-check').forEach(function(c) { c.checked = !!state; });
}

function _iconTipoMail(tipo) {
  var t = String(tipo || '').toLowerCase();
  if (t.indexOf('fotos') !== -1)        return '📸';
  if (t.indexOf('supervisora') !== -1)  return '⭐';
  if (t.indexOf('vajilla') !== -1)      return '🍽';
  if (t.indexOf('control') !== -1)      return '📦';
  return '🎯';
}

function renderMailPreview(r, semana) {
  var el = document.getElementById('mailContent');
  if (!r || !r.ok) {
    el.innerHTML = '<div class="empty">⚠️ ' + esc((r && r.msg) || 'Error') + '</div>';
    return;
  }
  _mail.preview = r;
  var trabs    = r.trabajadores || [];
  var sinEmail = r.sinEmail || [];

  var box = document.getElementById('modalMailBox');
  box.querySelector('.modal-sub').textContent = 'Semana ' + semana + ' — ' + r.totalEmails + ' destinatarios · Total $' + fmtMoney(r.totalGlobal);

  if (trabs.length === 0 && sinEmail.length === 0) {
    el.innerHTML = '<div class="empty"><div class="empty-icon">📭</div><p>No hay trabajadores con bonos para esta semana</p></div>';
    return;
  }

  // Filtros
  function pasa(t) {
    if (_mail.filtro === 'ganaron-todo')  return t.noGanados === 0 && t.ganados > 0;
    if (_mail.filtro === 'algun-perdido') return t.noGanados > 0;
    if (_mail.filtro === 'pendientes')    return !t.yaEnviado;
    if (_mail.filtro === 'enviados')      return !!t.yaEnviado;
    return true;
  }
  var trabsFiltrados    = trabs.filter(pasa);
  var sinEmailFiltrados = sinEmail.filter(pasa);

  var totalAll     = trabs.length + sinEmail.length;
  var ganaronTodo  = [].concat(trabs, sinEmail).filter(function(t) { return t.noGanados === 0 && t.ganados > 0; }).length;
  var algunPerdido = [].concat(trabs, sinEmail).filter(function(t) { return t.noGanados > 0; }).length;
  var pendientes   = trabs.filter(function(t) { return !t.yaEnviado; }).length;
  var yaEnviadosN  = trabs.filter(function(t) { return  t.yaEnviado; }).length;

  // Agrupar por cargo (cargo principal del primer evento)
  var grupos = {};
  function pushGrupo(t, sin) {
    var cargo = (t.eventos && t.eventos[0] && t.eventos[0].cargo) || '(sin cargo)';
    if (!grupos[cargo]) grupos[cargo] = { cargo: cargo, trabs: [], total: 0 };
    grupos[cargo].trabs.push(Object.assign({ _sinEmail: !!sin }, t));
    grupos[cargo].total += t.totalMonto;
  }
  trabsFiltrados.forEach(function(t) { pushGrupo(t, false); });
  sinEmailFiltrados.forEach(function(t) { pushGrupo(t, true); });

  var ordenCargos = [
    'Super metre', 'Metre', 'Jefe de Bar', 'Jefe Cocina', 'Copero Jefe', 'Copero',
    'Barmans', 'Barman', 'Garzones', 'Garzón', 'Garzon Decoración',
    'Jefa de Decoración', 'Jefa de Floristas', 'Florista', 'Asignación Encargados Novios'
  ];
  var cargosKeys = Object.keys(grupos).sort(function(a, b) {
    var ia = ordenCargos.indexOf(a); if (ia < 0) ia = 999;
    var ib = ordenCargos.indexOf(b); if (ib < 0) ib = 999;
    if (ia !== ib) return ia - ib;
    return a.localeCompare(b);
  });

  var html = '';
  // Tabs filtros
  html += '<div class="mail-filtros">';
  html += '<button class="mail-tab' + (_mail.filtro === 'todos' ? ' active' : '') + '" onclick="mailCambiarFiltro(\'todos\')">Todos <span>' + totalAll + '</span></button>';
  html += '<button class="mail-tab' + (_mail.filtro === 'pendientes' ? ' active' : '') + '" onclick="mailCambiarFiltro(\'pendientes\')">📨 Pendientes <span>' + pendientes + '</span></button>';
  html += '<button class="mail-tab' + (_mail.filtro === 'enviados' ? ' active' : '') + '" onclick="mailCambiarFiltro(\'enviados\')">✉ Ya enviados <span>' + yaEnviadosN + '</span></button>';
  html += '<button class="mail-tab' + (_mail.filtro === 'ganaron-todo' ? ' active' : '') + '" onclick="mailCambiarFiltro(\'ganaron-todo\')">✓ Ganaron todo <span>' + ganaronTodo + '</span></button>';
  html += '<button class="mail-tab' + (_mail.filtro === 'algun-perdido' ? ' active' : '') + '" onclick="mailCambiarFiltro(\'algun-perdido\')">✗ Algún perdido <span>' + algunPerdido + '</span></button>';
  html += '</div>';

  html += '<div class="mail-section-head">';
  html += '<div>' + cargosKeys.length + ' cargo(s) · ' + trabsFiltrados.length + ' destinatario(s)' + (sinEmailFiltrados.length ? ' · ' + sinEmailFiltrados.length + ' sin email' : '') + '</div>';
  html += '<div><span class="mail-toggle" onclick="mailToggleAll(true)">Marcar todos</span> · <span class="mail-toggle" onclick="mailToggleAll(false)">Ninguno</span></div>';
  html += '</div>';

  if (cargosKeys.length === 0) {
    html += '<div class="empty">Sin trabajadores para el filtro seleccionado.</div>';
    el.innerHTML = html;
    _renderMailActions(0);
    return;
  }

  var ordenTipo = ['Fotos', 'Supervisora', 'Control Gestión', 'Vajilla'];
  cargosKeys.forEach(function(cargo) {
    var g = grupos[cargo];
    var nSinEmail = g.trabs.filter(function(t) { return t._sinEmail; }).length;
    html += '<div class="mail-cargo">';
    html += '<div class="mail-cargo-head">';
    html += '<div class="mail-cargo-title">👥 ' + esc(cargo) + '</div>';
    html += '<div class="mail-cargo-meta">' + g.trabs.length + ' persona(s)';
    if (nSinEmail > 0) html += ' <span style="color:var(--err);">(' + nSinEmail + ' sin email)</span>';
    html += ' · <b style="color:var(--ok);">$' + fmtMoney(g.total) + '</b></div>';
    html += '</div>';

    g.trabs.forEach(function(t) {
      var rowCls = t._sinEmail ? 'mail-trab no-email' : 'mail-trab';
      if (t.yaEnviado) rowCls += ' enviado';
      html += '<div class="' + rowCls + '">';

      html += '<label class="mail-trab-head">';
      if (!t._sinEmail) {
        var checkedAttr = t.yaEnviado ? '' : ' checked';
        html += '<input type="checkbox" class="mail-check" data-trab="' + escAttr(t.nombreNorm) + '"' + checkedAttr + '>';
      } else {
        html += '<span class="mail-warn-icon" title="Sin email">⚠</span>';
      }
      html += '<div class="mail-trab-info">';
      html += '<div class="mail-trab-nombre">' + esc(t.nombre);
      if (t.yaEnviado) {
        html += ' <span class="mail-enviado-badge" title="' + esc('Enviado el ' + (t.yaEnviado.fecha || '') + (t.yaEnviado.autor ? ' por ' + t.yaEnviado.autor : '')) + '">✉ ' + esc(t.yaEnviado.fecha || 'enviado') + '</span>';
      }
      html += '</div>';
      html += '<div class="mail-trab-email"' + (t._sinEmail ? ' style="color:var(--err);"' : '') + '>' + esc(t.email || 'Sin email en Maestro Inscripcion') + '</div>';
      html += '</div>';
      html += '<div class="mail-trab-stats">' + t.ganados + '✓' + (t.noGanados ? ' · ' + t.noGanados + '✗' : '') + '</div>';
      html += '<div class="mail-trab-monto">$' + fmtMoney(t.totalMonto) + '</div>';
      html += '</label>';

      // Línea por evento con chips icono+tick/cruz
      (t.eventos || []).forEach(function(ev) {
        var bonosOrd = (ev.bonos || []).slice().sort(function(a, b) {
          var ia = ordenTipo.indexOf(a.tipoBono); if (ia < 0) ia = 99;
          var ib = ordenTipo.indexOf(b.tipoBono); if (ib < 0) ib = 99;
          return ia - ib;
        });
        html += '<div class="mail-evento">';
        html += '<div class="mail-evento-meta"><b>' + esc(ev.lugar || ev.codigo) + '</b> · ' + esc(ev.fecha || '') + ' · ' + esc(ev.cargo) + '</div>';
        html += '<div class="mail-bonos-mini">';
        bonosOrd.forEach(function(b) {
          var ic = _iconTipoMail(b.tipoBono);
          var cls = b.cumplido ? 'gano' : 'no-gano';
          var mark = b.cumplido ? '✓' : '✗';
          var tip = b.nombreBono + (b.cumplido ? ' · ganó $' + fmtMoney(b.monto) : ' · NO ganó');
          html += '<span class="mail-bono-mini ' + cls + '" title="' + escAttr(tip) + '">' + ic + mark + '</span>';
        });
        html += '</div>';
        html += '<div class="mail-evento-monto">$' + fmtMoney(ev.subtotal) + '</div>';
        html += '</div>';
      });

      html += '</div>'; // mail-trab
    });

    html += '</div>'; // mail-cargo
  });

  if (sinEmail.length > 0) {
    html += '<div class="mail-warn-block">⚠ ' + sinEmail.length + ' trabajador(es) sin email en Maestro Inscripcion no recibirán mail. Agrega su correo en col F para incluirlos.</div>';
  }

  el.innerHTML = html;
  _renderMailActions(trabsFiltrados.length);
}

function _renderMailActions(n) {
  var box = document.getElementById('modalMailBox');
  var actions = box.querySelector('.modal-actions');
  if (!actions) return;
  actions.innerHTML =
    '<button class="btn btn-secondary" onclick="cerrarModal(\'modalMailBackdrop\')">Cancelar</button>' +
    '<button class="btn btn-mail" id="btnMailEnviar"' + (n === 0 ? ' disabled' : '') + ' onclick="abrirConfirmEnvioMails()">📧 Enviar a ' + n + '</button>';
}

// Sub-modal de confirmación
function abrirConfirmEnvioMails() {
  if (!_mail.preview) return;
  var seleccionados = [];
  document.querySelectorAll('.mail-check:checked').forEach(function(c) { seleccionados.push(c.dataset.trab); });
  if (seleccionados.length === 0) { showToast('Selecciona al menos un destinatario', 'err'); return; }

  var setSel = {};
  seleccionados.forEach(function(n) { setSel[n] = true; });
  var trabsSel = (_mail.preview.trabajadores || []).filter(function(t) { return setSel[t.nombreNorm]; });
  var totalMonto = trabsSel.reduce(function(s, t) { return s + t.totalMonto; }, 0);
  var reenvios = trabsSel.filter(function(t) { return t.yaEnviado; }).length;
  var nuevos   = trabsSel.length - reenvios;

  var html = '';
  html += '<div class="modal-title">📧 Confirmar envío</div>';
  html += '<div class="modal-sub">Estás por enviar el resumen de bonos. Revisa antes de confirmar.</div>';
  html += '<div class="modal-section"><div class="confirm-grid">';
  html += '<div class="confirm-stat"><div class="confirm-num">' + trabsSel.length + '</div><div class="confirm-lbl">Total</div></div>';
  html += '<div class="confirm-stat"><div class="confirm-num" style="color:#7fa8d4;">' + nuevos + '</div><div class="confirm-lbl">Nuevos</div></div>';
  if (reenvios > 0) html += '<div class="confirm-stat"><div class="confirm-num" style="color:var(--warn);">' + reenvios + '</div><div class="confirm-lbl">Reenvíos ⚠</div></div>';
  html += '<div class="confirm-stat"><div class="confirm-num" style="color:var(--ok);">$' + fmtMoney(totalMonto) + '</div><div class="confirm-lbl">Monto total</div></div>';
  html += '</div>';
  html += '<div style="font-size:0.78em;color:rgba(255,255,255,0.55);margin-top:6px;">Remitente: <b>Bonos Tinto Banquetería &lt;bonos@tintobanqueteria.cl&gt;</b></div>';
  html += '</div>';

  if (reenvios > 0) {
    html += '<div class="modal-section mismatch">';
    html += '<div class="modal-section-title" style="color:var(--warn);">⚠ ' + reenvios + ' reenvío(s) — el trabajador ya recibió el mail de esta semana</div>';
    trabsSel.filter(function(t) { return t.yaEnviado; }).forEach(function(t) {
      html += '<div class="modal-row"><span class="modal-row-name">' + esc(t.nombre) + '<span class="modal-row-meta"> · ' + esc(t.email) + '</span></span><span style="color:var(--warn);font-size:0.78em;">enviado ' + esc(t.yaEnviado.fecha || '') + '</span></div>';
    });
    html += '</div>';
  }

  html += '<div class="modal-section"><div class="modal-section-title">Lista (' + trabsSel.length + ')</div><div class="confirm-list">';
  trabsSel.forEach(function(t) {
    html += '<div class="modal-row"><span class="modal-row-name">' + esc(t.nombre) + '<span class="modal-row-meta"> · ' + esc(t.email) + '</span></span><span class="modal-row-monto">$' + fmtMoney(t.totalMonto) + '</span></div>';
  });
  html += '</div></div>';

  html += '<div class="modal-actions">';
  html += '<button class="btn btn-secondary" onclick="cerrarModal(\'modalConfirmBackdrop\')">Cancelar</button>';
  html += '<button class="btn btn-mail" id="btnConfirmEnviar" onclick="ejecutarEnvioMails()">Confirmar envío de ' + trabsSel.length + ' mail(s)</button>';
  html += '</div>';

  document.getElementById('modalConfirmBox').innerHTML = html;
  showModal('modalConfirmBackdrop');
}

function ejecutarEnvioMails() {
  var seleccionados = [];
  document.querySelectorAll('#modalMailBox .mail-check:checked').forEach(function(c) { seleccionados.push(c.dataset.trab); });
  if (seleccionados.length === 0) { showToast('Sin destinatarios', 'err'); return; }

  var btn = document.getElementById('btnConfirmEnviar');
  btn.disabled = true;
  btn.textContent = '⏳ Enviando ' + seleccionados.length + '…';

  apiPost('enviarMailsBonos', { semana: _mail.preview.semana, lista: seleccionados })
    .then(function(r) {
      cerrarModal('modalConfirmBackdrop');
      _renderResultadoEnvioMails(r);
    })
    .catch(function(e) {
      btn.disabled = false;
      btn.textContent = 'Confirmar envío';
      showToast('Error: ' + e.message, 'err');
    });
}

function _renderResultadoEnvioMails(r) {
  var el = document.getElementById('mailContent');
  if (!el) return;
  if (!r || !r.ok) {
    el.innerHTML = '<div class="empty">⚠️ ' + esc((r && r.msg) || 'Error') + '</div>';
    return;
  }
  var html = '';
  if (r.totalEnviados > 0) {
    html += '<div class="modal-section" style="background:rgba(46,125,90,0.18);border-color:rgba(46,125,90,0.4);"><div style="color:var(--ok);font-weight:700;">✅ ' + r.totalEnviados + ' mail(s) enviado(s) correctamente</div></div>';
    if (r.enviados && r.enviados.length) {
      html += '<div class="modal-section"><div class="modal-section-title">Enviados</div>';
      r.enviados.forEach(function(e) {
        html += '<div class="modal-row"><span class="modal-row-name">' + esc(e.nombre) + '<span class="modal-row-meta"> · ' + esc(e.email) + '</span></span><span class="modal-row-monto">$' + fmtMoney(e.monto) + '</span></div>';
      });
      html += '</div>';
    }
  }
  if (r.totalErrores > 0) {
    html += '<div class="modal-section mismatch"><div class="modal-section-title" style="color:var(--err);">❌ Errores (' + r.totalErrores + ')</div>';
    (r.errores || []).forEach(function(e) {
      html += '<div class="modal-row"><span class="modal-row-name">' + esc(e.nombre) + '<span class="modal-row-meta"> · ' + esc(e.email) + '</span></span><span style="color:var(--err);font-size:0.78em;">' + esc(e.error) + '</span></div>';
    });
    html += '</div>';
  }
  el.innerHTML = html;

  var box = document.getElementById('modalMailBox');
  var actions = box.querySelector('.modal-actions');
  if (actions) actions.innerHTML = '<button class="btn btn-secondary" onclick="cerrarModal(\'modalMailBackdrop\')">Cerrar</button>';
  showToast('Mails: ' + r.totalEnviados + ' enviados · ' + r.totalErrores + ' errores', r.totalErrores > 0 ? 'err' : 'ok');
}

// ===== TAB CARGO (placeholder iteración siguiente) =====
function cargarCargo() {
  var c = document.getElementById('selCargo').value;
  if (!c) return;
  spinner('resCargo', 'Cargando historial del cargo…');
  apiGet('getDatosCargo', { cargo: c }).then(function(r) {
    var el = document.getElementById('resCargo');
    if (!r || !r.ok) {
      el.innerHTML = '<div class="empty">' + esc((r && r.msg) || 'Error') + '</div>';
      return;
    }
    var eventos = r.eventos || [];
    if (!eventos.length) {
      el.innerHTML = '<div class="empty"><div class="empty-icon">📭</div><p>Sin historial para ' + esc(c) + '</p></div>';
      return;
    }
    var html = '<div style="font-size:0.85em;color:rgba(255,255,255,0.7);margin-bottom:10px;">' + eventos.length + ' evento(s) registrados</div>';
    eventos.forEach(function(ev) { html += renderEventoCard(ev, c, null); });
    el.innerHTML = html;
  }).catch(function(e) {
    document.getElementById('resCargo').innerHTML = '<div class="empty">Error: ' + esc(e.message) + '</div>';
  });
}

// ===== TAB HISTORIAL (placeholder iteración siguiente) =====
function filtrarPersonas() {
  var q = document.getElementById('inpPersona').value.trim().toLowerCase();
  if (q.length < 2) {
    document.getElementById('resHistorial').innerHTML =
      '<div class="empty"><div class="empty-icon">🔍</div><p>Escribe al menos 2 letras para buscar</p></div>';
    return;
  }
  var matches = APP.personas.filter(function(p) { return p.toLowerCase().indexOf(q) !== -1; });
  if (!matches.length) {
    document.getElementById('resHistorial').innerHTML =
      '<div class="empty"><div class="empty-icon">📭</div><p>Sin coincidencias</p></div>';
    return;
  }
  var html = '<div style="display:flex;flex-wrap:wrap;gap:6px;">';
  matches.slice(0, 30).forEach(function(p) {
    html += '<button class="btn btn-secondary" onclick="cargarPersona(\'' + escAttr(p) + '\')">' + esc(p) + '</button>';
  });
  if (matches.length > 30) html += '<span style="font-size:0.75em;color:rgba(255,255,255,0.5);align-self:center;">+ ' + (matches.length - 30) + ' más</span>';
  html += '</div>';
  document.getElementById('resHistorial').innerHTML = html;
}

function cargarPersona(persona) {
  spinner('resHistorial', 'Cargando historial de ' + esc(persona));
  apiGet('getDatosPersona', { persona: persona }).then(function(r) {
    var el = document.getElementById('resHistorial');
    if (!r || !r.ok) { el.innerHTML = '<div class="empty">' + esc((r && r.msg) || 'Error') + '</div>'; return; }
    var eventos = r.eventos || [];
    var stats = r.stats || {};
    var html = '<div style="font-size:0.85em;color:rgba(255,255,255,0.7);margin-bottom:10px;"><b>' + esc(persona) + '</b> · ' + eventos.length + ' evento(s) · ' + (stats.ganados || 0) + '/' + (stats.total || 0) + ' bonos ganados</div>';
    if (!eventos.length) html += '<div class="empty"><div class="empty-icon">📭</div><p>Sin eventos registrados</p></div>';
    else eventos.forEach(function(ev) { html += renderEventoCard(ev, ev.cargo, null); });
    el.innerHTML = html;
  });
}

// ===== TAB CRITERIOS =====
function cargarCriterios() {
  spinner('resCriterios', 'Cargando Maestro de Bonos…');
  apiGet('getMaestroBonos').then(function(r) {
    APP.criteriosLoaded = true;
    if (!r || !r.ok) {
      document.getElementById('resCriterios').innerHTML = '<div class="empty">⚠️ ' + esc((r && r.msg) || 'Error') + '</div>';
      return;
    }
    APP.criteriosItems = r.items || [];
    APP.criteriosEditable = false;
    renderCriterios();
  }).catch(function(e) {
    document.getElementById('resCriterios').innerHTML = '<div class="empty">Error: ' + esc(e.message) + '</div>';
  });
}

function fmtMontoSimple(n) {
  return String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function renderCriterios() {
  var el = document.getElementById('resCriterios');
  var items = APP.criteriosItems;
  if (!items.length) { el.innerHTML = '<div class="empty">Sin items en Maestro_Bonos</div>'; return; }

  var html = '';
  html += '<div class="crit-toolbar">';
  html += '<button class="btn ' + (APP.criteriosEditable ? 'btn-success' : 'btn-secondary') + '" id="btnEditCrit" onclick="toggleEdicionCriterios()">';
  html += APP.criteriosEditable ? '🔓 Edición habilitada' : '🔒 Habilitar edición';
  html += '</button>';
  html += '<button class="btn btn-primary" id="btnSaveCrit" onclick="guardarCriterios()" style="' + (APP.criteriosEditable ? '' : 'display:none;') + '">💾 Guardar cambios</button>';
  html += '</div>';

  var tipos = ['Fotos', 'Supervisora', 'Control Gestión', 'Vajilla'];
  var tipoIcons = { 'Fotos': '📸', 'Supervisora': '⭐', 'Control Gestión': '📦', 'Vajilla': '🍽' };
  var tipoSlug  = { 'Fotos': 'Fotos', 'Supervisora': 'Supervisora', 'Control Gestión': 'CG', 'Vajilla': 'Vajilla' };

  tipos.forEach(function(tipo) {
    var its = items.filter(function(c) { return c.tipoBono === tipo; });
    if (!its.length) return;

    // Calcular max de criterios activos en esta sección
    var maxCrit = 0;
    its.forEach(function(item) {
      var cnt = 0;
      for (var j = 0; j < 10; j++) if (item.criterios[j] && String(item.criterios[j]).trim()) cnt = j + 1;
      if (cnt > maxCrit) maxCrit = cnt;
    });
    if (maxCrit < 2) maxCrit = 2;

    html += '<div class="crit-section crit-tipo-' + tipoSlug[tipo] + '">';
    html += '<div class="crit-section-head">';
    html += '<span>' + (tipoIcons[tipo] || '') + ' Bono ' + esc(tipo) + ' <span style="opacity:0.6;font-size:0.8em;font-weight:500;">(' + its[0].sistema + ')</span></span>';
    html += '<span class="crit-section-count">' + its.length + ' cargos</span>';
    html += '</div>';

    html += '<div class="crit-grid-wrap"><div class="crit-grid" style="--max-crit:' + maxCrit + '">';
    html += '<div class="crit-grid-head">Cargo</div>';
    html += '<div class="crit-grid-head">Monto</div>';
    for (var h = 1; h <= maxCrit; h++) html += '<div class="crit-grid-head">C' + h + '</div>';

    its.forEach(function(item) {
      var globalIdx = items.indexOf(item);
      html += '<div class="crit-grid-cell crit-cargo-cell">' + esc(item.cargo) + '</div>';
      html += '<div class="crit-grid-cell crit-monto-cell">';
      html += '<span class="crit-monto-prefix">$</span>';
      html += '<input class="crit-monto-input" data-row="' + globalIdx + '" data-col="monto" value="' + fmtMontoSimple(item.monto || 0) + '"' + (APP.criteriosEditable ? '' : ' readonly') + '>';
      html += '</div>';
      for (var j = 0; j < maxCrit; j++) {
        var v = item.criterios[j] || '';
        var hasText = v && v.length > 0;
        html += '<div class="crit-grid-cell" title="' + escAttr(v) + '">';
        if (APP.criteriosEditable) {
          html += '<textarea class="crit-text-cell editable" data-row="' + globalIdx + '" data-col="crit' + j + '" rows="2">' + esc(v) + '</textarea>';
        } else {
          html += '<div class="crit-text-readonly' + (hasText ? '' : ' empty') + '" data-row="' + globalIdx + '" data-col="crit' + j + '">' + esc(v || '—') + '</div>';
          if (hasText && v.length > 35) {
            html += '<div class="crit-popover">' + esc(v) + '</div>';
          }
        }
        html += '</div>';
      }
    });
    html += '</div></div></div>';
  });

  el.innerHTML = html;
}

function toggleEdicionCriterios() {
  APP.criteriosEditable = !APP.criteriosEditable;
  renderCriterios(); // re-render: readonly usa div, editable usa textarea
}

function guardarCriterios() {
  if (!confirm('¿Guardar cambios en Maestro_Bonos?\n\nEsto sobreescribe cargos, montos y criterios para los items mostrados.')) return;
  var items = APP.criteriosItems.map(function(item, idx) {
    function val(col) {
      var el = document.querySelector('[data-row="' + idx + '"][data-col="' + col + '"]');
      return el ? el.value.trim() : '';
    }
    var crits = [];
    for (var j = 0; j < 10; j++) crits.push(val('crit' + j));
    return {
      cargo:    item.cargo,
      tipoBono: item.tipoBono,
      monto:    Number(String(val('monto')).replace(/\./g, '')) || 0,
      sistema:  item.sistema,
      criterios: crits
    };
  });
  var btn = document.getElementById('btnSaveCrit');
  btn.disabled = true; btn.textContent = '⏳ Guardando…';
  apiPost('saveMaestroBonos', { items: items })
    .then(function(r) {
      btn.disabled = false; btn.textContent = '💾 Guardar cambios';
      if (r && r.ok) {
        showToast('✅ Maestro_Bonos guardado', 'ok');
        APP.criteriosLoaded = false; // forzar recarga al re-entrar
        cargarCriterios();
      } else {
        showToast('Error: ' + ((r && r.msg) || 'desconocido'), 'err');
      }
    })
    .catch(function(e) {
      btn.disabled = false; btn.textContent = '💾 Guardar cambios';
      showToast('Error: ' + e.message, 'err');
    });
}

// ===== TAB TARIFAS =====
function cargarTarifas() {
  spinner('resTarifas', 'Cargando Tarifas 2026…');
  apiGet('getTarifas2026').then(function(r) {
    APP.tarifasLoaded = true;
    if (!r || !r.ok) {
      document.getElementById('resTarifas').innerHTML = '<div class="empty">⚠️ ' + esc((r && r.msg) || 'Error') + '</div>';
      return;
    }
    APP.tarifasData = r.filas || [];
    APP.tarifasEditable = false;
    renderTarifas();
  }).catch(function(e) {
    document.getElementById('resTarifas').innerHTML = '<div class="empty">Error: ' + esc(e.message) + '</div>';
  });
}

// Solo "tarifa" se edita en este tab. Los 4 bonos son visualización (la edición vive en Criterios).
function fmtTarifaCell(idx, field, val) {
  if (!val) return '<span class="empty-bono">—</span>';
  var esTarifaBase = (field === 'tarifa');
  if (esTarifaBase) {
    return '<input type="text" class="tarifa-input tarifa-base" id="tf-' + idx + '-' + field + '" value="' + fmtMontoSimple(val) + '"' + (APP.tarifasEditable ? '' : ' readonly') + ' onchange="onTarifaChange(' + idx + ')">';
  }
  // Bonos: solo display, click → mensaje
  return '<div class="tarifa-bono-readonly" onclick="alertEditarBonosEnCriterios()" title="Editar en tab Criterios">$' + fmtMontoSimple(val) + '</div>' +
         '<input type="hidden" id="tf-' + idx + '-' + field + '" value="' + fmtMontoSimple(val) + '">';
}

function alertEditarBonosEnCriterios() {
  showToast('Los montos de los bonos se editan en la tab Criterios', 'info');
}

function renderTarifas() {
  var el = document.getElementById('resTarifas');
  var data = APP.tarifasData;
  if (!data.length) { el.innerHTML = '<div class="empty">Sin datos de tarifas</div>'; return; }

  var html = '';
  html += '<div class="crit-toolbar">';
  html += '<button class="btn ' + (APP.tarifasEditable ? 'btn-success' : 'btn-secondary') + '" id="btnEditTarifas" onclick="toggleEdicionTarifas()">';
  html += APP.tarifasEditable ? '🔓 Edición habilitada (tarifa base)' : '🔒 Editar tarifa base';
  html += '</button>';
  html += '<button class="btn btn-primary" id="btnSaveTarifas" onclick="guardarTarifas()" style="' + (APP.tarifasEditable ? '' : 'display:none;') + '">💾 Guardar tarifas</button>';
  html += '<div class="tarifas-note">ℹ️ Los <b>montos de bonos</b> son solo visualización — se editan en la tab <b>Criterios</b>.</div>';
  html += '</div>';

  html += '<div style="overflow-x:auto;">';
  html += '<table class="tarifas-table"><thead><tr>';
  html += '<th>Cargo</th><th>Tarifa Base</th>';
  html += '<th>📸 Fotos</th><th>⭐ Supervisora</th><th>📦 CG</th><th>🍽 Vajilla</th>';
  html += '<th>Total Potencial</th>';
  html += '</tr></thead><tbody>';

  var sumT = 0, sumF = 0, sumS = 0, sumA = 0, sumV = 0, sumTotal = 0;
  var asignacionMarcada = false;

  data.forEach(function(f, idx) {
    if (String(f.cargo).toLowerCase().indexOf('asignaci') === 0 && !asignacionMarcada) {
      asignacionMarcada = true;
      html += '<tr class="row-sep"><td colspan="7">Asignaciones</td></tr>';
    }
    var total = (f.tarifa || 0) + (f.bonoFotos || 0) + (f.bonoSupervisora || 0) + (f.bonoActivos || 0) + (f.bonoVajilla || 0);
    sumT += f.tarifa || 0; sumF += f.bonoFotos || 0; sumS += f.bonoSupervisora || 0;
    sumA += f.bonoActivos || 0; sumV += f.bonoVajilla || 0; sumTotal += total;

    html += '<tr>';
    html += '<td>' + esc(f.cargo) + '</td>';
    html += '<td>' + fmtTarifaCell(idx, 'tarifa', f.tarifa) + '</td>';
    html += '<td>' + fmtTarifaCell(idx, 'bonoFotos', f.bonoFotos) + '</td>';
    html += '<td>' + fmtTarifaCell(idx, 'bonoSupervisora', f.bonoSupervisora) + '</td>';
    html += '<td>' + fmtTarifaCell(idx, 'bonoActivos', f.bonoActivos) + '</td>';
    html += '<td>' + fmtTarifaCell(idx, 'bonoVajilla', f.bonoVajilla) + '</td>';
    html += '<td class="col-total" id="total-' + idx + '">$' + fmtMontoSimple(total) + '</td>';
    html += '</tr>';
  });

  html += '</tbody><tfoot><tr>';
  html += '<td>TOTAL</td>';
  html += '<td>$' + fmtMontoSimple(sumT) + '</td>';
  html += '<td>$' + fmtMontoSimple(sumF) + '</td>';
  html += '<td>$' + fmtMontoSimple(sumS) + '</td>';
  html += '<td>$' + fmtMontoSimple(sumA) + '</td>';
  html += '<td>$' + fmtMontoSimple(sumV) + '</td>';
  html += '<td class="grand-total">$' + fmtMontoSimple(sumTotal) + '</td>';
  html += '</tr></tfoot></table>';
  html += '</div>';

  el.innerHTML = html;
}

function _parseMoneyInput(s) {
  return Number(String(s).replace(/\$/g, '').replace(/\./g, '').replace(/,/g, '').trim()) || 0;
}

function onTarifaChange(idx) {
  // Tarifa base es el único input editable; los bonos se leen de los hidden inputs.
  var fields = ['tarifa', 'bonoFotos', 'bonoSupervisora', 'bonoActivos', 'bonoVajilla'];
  var total = 0;
  fields.forEach(function(f) {
    var inp = document.getElementById('tf-' + idx + '-' + f);
    if (inp) total += _parseMoneyInput(inp.value);
  });
  var totalEl = document.getElementById('total-' + idx);
  if (totalEl) totalEl.textContent = '$' + fmtMontoSimple(total);
}

function toggleEdicionTarifas() {
  APP.tarifasEditable = !APP.tarifasEditable;
  // Solo afecta a inputs de tarifa base (los bonos viven como display siempre).
  var btn = document.getElementById('btnEditTarifas');
  var save = document.getElementById('btnSaveTarifas');
  if (APP.tarifasEditable) {
    btn.textContent = '🔓 Edición habilitada (tarifa base)';
    btn.classList.remove('btn-secondary'); btn.classList.add('btn-success');
    save.style.display = '';
    document.querySelectorAll('.tarifa-input.tarifa-base').forEach(function(el) { el.removeAttribute('readonly'); });
  } else {
    btn.textContent = '🔒 Editar tarifa base';
    btn.classList.add('btn-secondary'); btn.classList.remove('btn-success');
    save.style.display = 'none';
    document.querySelectorAll('.tarifa-input.tarifa-base').forEach(function(el) { el.setAttribute('readonly', 'readonly'); });
  }
}

function guardarTarifas() {
  if (!confirm('¿Guardar los cambios en Tarifas 2026?\n\nEsto actualizará la hoja Tarifas y propagará los montos a Maestro_Bonos.')) return;
  var fields = ['tarifa', 'bonoFotos', 'bonoSupervisora', 'bonoActivos', 'bonoVajilla'];
  var cambios = APP.tarifasData.map(function(f, idx) {
    var item = { fila: f.fila, cargo: f.cargo };
    fields.forEach(function(field) {
      var inp = document.getElementById('tf-' + idx + '-' + field);
      item[field] = inp ? _parseMoneyInput(inp.value) : f[field];
    });
    return item;
  });
  var btn = document.getElementById('btnSaveTarifas');
  btn.disabled = true; btn.textContent = '⏳ Guardando…';
  apiPost('saveTarifas2026', { cambios: cambios })
    .then(function(r) {
      btn.disabled = false; btn.textContent = '💾 Guardar cambios';
      if (r && r.ok) {
        showToast('✅ Tarifas guardadas (' + (r.updated || cambios.length) + ' filas)', 'ok');
        APP.tarifasLoaded = false;
        cargarTarifas();
      } else {
        showToast('Error: ' + ((r && r.msg) || 'desconocido'), 'err');
      }
    })
    .catch(function(e) {
      btn.disabled = false; btn.textContent = '💾 Guardar cambios';
      showToast('Error: ' + e.message, 'err');
    });
}
