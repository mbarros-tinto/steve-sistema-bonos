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
  loaded:           false
};

function cgApiGet(action, params) {
  var qs = new URLSearchParams({ action: action, ...(params || {}) });
  return fetch(window.CG_API_URL + '?' + qs.toString(), { method: 'GET' })
    .then(function(r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
}

function cgApiPost(action, payload) {
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

  cgApiGet('datosForSemana', { semana: CG.semana })
    .then(function(data) {
      CG.eventos          = data.eventos          || [];
      CG.config           = data.criteriosConfig  || {};
      CG.configVajilla    = data.criteriosVajilla || {};
      CG.guardados        = data.yaEvaluados      || [];
      CG.guardadosVajilla = data.yaEvaluadosVajilla || [];
      CG.autoChequeos     = data.autoChequeos     || {};
      if (data.vajillaConfig) CG.vajillaConfig = data.vajillaConfig;
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
