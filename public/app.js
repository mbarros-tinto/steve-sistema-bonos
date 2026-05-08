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
  toastTimer: null
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
}

// ===== Sync =====
function sincronizar() {
  var btn = event.target;
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
    return;
  }
  var grupos = datos.grupos || {};
  var cargos = Object.keys(grupos).sort(comparadorCargos);
  if (cargos.length === 0) {
    el.innerHTML = '<div class="empty"><div class="empty-icon">📭</div><p>Sin bonos para esta semana</p></div>';
    return;
  }

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
  var html = '<div class="event-card">';
  html += '<div class="event-card-head">';
  html += '<span class="event-name">🏛️ ' + esc(ev.centro || ev.codigo) + '</span>';
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
