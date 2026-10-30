'use strict';
/* canar-ai-n-the-mine : lecteur de rapports JSON (schéma v1, voir schema.json), produits par Claude ou Janus. Aucun appel externe, aucune clé.
   Tout le texte est inséré via textContent (pas d'innerHTML) : un JSON collé ne peut pas injecter de code. */

const KEY = 'riskwatch.reports.v1';
const MAX_STORED = 180; // rythme quotidien : ~6 mois gardés sur le téléphone (l'historique complet reste dans le dépôt)
const LV = [
  { k: 'N0', n: 'VERT', t: 'Routine' },
  { k: 'N1', n: 'JAUNE', t: 'Veille renforcée' },
  { k: 'N2', n: 'ORANGE', t: 'Vigilance' },
  { k: 'N3', n: 'ROUGE', t: 'Préparation active' },
  { k: 'N4', n: 'NOIR', t: 'Crise en cours' }
];
const IMPACTS = [['eau', 'Eau'], ['alim', 'Alim.'], ['energie', 'Énergie'], ['sante', 'Santé'],
  ['mobilite', 'Mobil.'], ['info', 'Info'], ['securite', 'Sécu.']];
const HZ = [['p30', '30 j'], ['p90', '90 j'], ['p1y', '1 an']];

let reports = [];
let idx = -1;

/* ---------- utilitaires ---------- */
const $ = s => document.querySelector(s);
function h(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = String(text);
  return e;
}
function add(p, ...kids) { kids.flat().forEach(k => { if (k) p.append(k); }); return p; }
const lc = n => `var(--l${Math.max(0, Math.min(4, n | 0))})`;
const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
const fmtDate = d => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d || ''); return m ? `${m[3]}/${m[2]}/${m[1]}` : (d || '?'); };
const num = v => (typeof v === 'number' ? v : (v && typeof v.v === 'number' ? v.v : null));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function arrow(d) {
  if (d === null) return h('span', 'dl new', '🆕');
  const s = d > 0 ? '▲' : d < 0 ? '▼' : '►';
  const txt = d ? `${s} ${d > 0 ? '+' : ''}${Math.round(d * 10) / 10}` : s;
  return h('span', 'dl ' + (d > 0 ? 'up' : d < 0 ? 'down' : 'flat'), txt);
}
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), 2400);
}

/* ---------- stockage ---------- */
function load() {
  try {
    const a = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(a) ? a.filter(isReport).sort(byDate) : [];
  } catch (e) { return []; }
}
function persist() {
  if (reports.length > MAX_STORED) { reports = reports.slice(-MAX_STORED); idx = Math.min(idx, reports.length - 1); }
  try { localStorage.setItem(KEY, JSON.stringify(reports)); }
  catch (e) { toast('Stockage local indisponible : rapports gardés en mémoire seulement'); }
}
const isReport = r => r && typeof r === 'object' && typeof r.date === 'string' && r.alert && typeof r.alert.level === 'number';

/* ---------- import ---------- */
function parseReport(text) {
  let t = String(text).trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b < a) throw new Error('Aucun objet JSON trouvé.');
  let r;
  try { r = JSON.parse(t.slice(a, b + 1)); } catch (e) { throw new Error('JSON invalide : ' + e.message); }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date || '')) throw new Error('Champ "date" manquant ou hors format AAAA-MM-JJ.');
  if (!r.alert || typeof r.alert.level !== 'number' || r.alert.level < 0 || r.alert.level > 4)
    throw new Error('Champ "alert.level" manquant (0 à 4).');
  if (r.schema != null && r.schema !== 1) throw new Error('Version de schéma non prise en charge : ' + r.schema);
  ['domains', 'top_changes', 'scenarios', 'impacts', 'indicators', 'actions', 'hypotheses', 'sources']
    .forEach(k => { if (!Array.isArray(r[k])) r[k] = []; });
  return r;
}
function addReport(r, silent) {
  const i = reports.findIndex(x => x.date === r.date);
  if (i >= 0) reports[i] = r; else reports.push(r);
  reports.sort(byDate);
  idx = reports.findIndex(x => x.date === r.date);
  persist();
  if (!silent) { render(); toast(i >= 0 ? 'Rapport du ' + fmtDate(r.date) + ' remplacé' : 'Rapport ajouté'); }
}

/* ---------- construction d'une section repliable ---------- */
function section(title, status, bodyEls, open = false) {
  // status : null (pas de précédent) | nombre de changements
  const d = h('details', 'sec');
  const s = h('summary');
  add(s, h('span', 'st', title));
  if (status === null) s.append(h('span', 'chip', '🆕 référence'));
  else if (status > 0) s.append(h('span', 'chip chg', `▲ ${status} changement${status > 1 ? 's' : ''}`));
  else s.append(h('span', 'chip', '= IDEM'));
  d.append(s);
  d.append(add(h('div', 'sbody'), bodyEls));
  d.open = open; // tout est replié par défaut ; le badge indique s'il y a du changement
  return d;
}

/* ---------- rendu ---------- */
function render() {
  const app = $('#app');
  app.replaceChildren();
  $('#prev').disabled = idx <= 0;
  $('#next').disabled = idx < 0 || idx >= reports.length - 1;
  if (idx < 0 || !reports[idx]) {
    $('#dateLbl').textContent = 'CanarAI-n the Mine'; $('#posLbl').textContent = '';
    const e = h('div', 'empty');
    add(e, h('h2', null, 'Aucun rapport'),
      h('p', 'mut', 'Importe le JSON produit par Claude (bouton ＋), synchronise depuis ton dépôt, ou charge l\'exemple fictif.'));
    const row = h('div', 'row'); row.style.justifyContent = 'center';
    const b1 = h('button', 'btn pri', 'Importer un rapport'); b1.onclick = () => $('#importDlg').showModal();
    const b2 = h('button', 'btn', 'Charger l\'exemple'); b2.onclick = loadSample;
    app.append(add(e, add(row, b1, b2)));
    return;
  }
  const cur = reports[idx], prev = idx > 0 ? reports[idx - 1] : null;
  $('#dateLbl').textContent = fmtDate(cur.date);
  $('#posLbl').textContent = `${idx + 1} / ${reports.length}` + (prev ? ` · vs ${fmtDate(prev.date)}` : ' · référence');

  app.append(hero(cur, prev));
  app.append(heatCard(cur, prev));
  app.append(topChanges(cur, prev));
  app.append(scenariosSec(cur, prev));
  app.append(impactsSec(cur, prev));
  app.append(indicatorsSec(cur, prev));
  app.append(actionsSec(cur, prev));
  app.append(hypSec(cur, prev));
  app.append(sourcesSec(cur));
  if (cur.caveat) add(app, add(h('div', 'recul'), h('b', null, '⚠️ Recul : '), document.createTextNode(String(cur.caveat))));
}


/* --- références de sources cliquables : [n] trouvés dans les textes + numéros explicites --- */
function srcRefs(cur, texts, extra) {
  const ns = new Set((extra || []).map(Number));
  (texts || []).forEach(t => String(t || '').replace(/\[(\d+)\]/g, (_, n) => { ns.add(Number(n)); return _; }));
  const byN = new Map((cur.sources || []).map(s => [s.n, s]));
  const list = [...ns].filter(n => byN.has(n)).sort((a, b) => a - b);
  if (!list.length) return null;
  const p = h('div', 'src');
  p.append(h('span', 'mut', 'Sources : '));
  list.forEach((n, i) => {
    const s = byN.get(n);
    const label = `[${n}] ${s.publisher || s.title || ''}`;
    let el;
    if (typeof s.url === 'string' && /^https:\/\//i.test(s.url)) {
      el = h('a', null, label); el.href = s.url; el.target = '_blank'; el.rel = 'noopener noreferrer';
    } else el = h('span', null, label);
    if (s.title) el.title = s.title;
    if (i) p.append(document.createTextNode(' · '));
    p.append(el);
  });
  return p;
}

/* --- légende des impacts : pastilles de couleur réelles + exemple de cellule encadrée --- */
function impactLegend() {
  const box = h('div', 'mut');
  box.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center;font-size:12px;margin-top:8px';
  [[1, 'faible'], [2, 'moyen'], [3, 'élevé']].forEach(([v, lab]) => {
    const it = h('span'); const dt = h('span', 'dot'); dt.style.background = lc(v);
    dt.style.marginRight = '5px'; add(it, dt, document.createTextNode(lab)); box.append(it);
  });
  const it = h('span'); const sq = h('span');
  sq.style.cssText = 'display:inline-block;width:12px;height:12px;border:2px solid var(--chgline);border-radius:3px;vertical-align:middle;margin-right:5px';
  add(it, sq, document.createTextNode('changement depuis la veille')); box.append(it);
  const none = h('span', null, '– aucun impact'); box.append(none);
  return box;
}

/* --- en-tête --- */
function hero(cur, prev) {
  const lv = Math.max(0, Math.min(4, cur.alert.level | 0));
  const d = h('div', `hero l${lv}`);
  d.style.setProperty('--lv', lc(lv)); // la couleur du niveau éclaire la carte (voir .hero dans style.css)
  add(d, h('div', 'lv', `${LV[lv].k} · ${cur.alert.label || LV[lv].n}`));
  let line;
  if (!prev) line = '🆕 rapport de référence';
  else {
    const dl = lv - (prev.alert.level | 0);
    line = dl === 0 ? `► inchangé depuis ${fmtDate(prev.date)}`
      : `${dl > 0 ? '▲' : '▼'} ${dl > 0 ? 'monte' : 'baisse'} de N${prev.alert.level} à N${lv} depuis ${fmtDate(prev.date)}`;
  }
  d.append(h('div', 'dl2', line));
  if (cur.alert.summary) d.append(h('p', null, cur.alert.summary));
  if (prev && lv !== prev.alert.level && cur.alert.change_reason) d.append(h('p', null, 'Pourquoi : ' + cur.alert.change_reason));
  d.append(h('div', 'meta', [LV[lv].t, cur.period && 'Période : ' + cur.period,
    cur.generator && 'Source : ' + cur.generator].filter(Boolean).join(' · ')));
  return d;
}

/* --- carte thermique --- */
function heatCard(cur, prev) {
  const pm = new Map((prev ? prev.domains : []).map(x => [x.id || x.name, x]));
  const rows = cur.domains.map(d => {
    const p = pm.get(d.id || d.name);
    const lvl = Math.max(0, Math.min(3, d.level | 0));
    const delta = !prev ? undefined : (p ? lvl - (p.level | 0) : null);
    const changed = !!prev && (!p || p.level !== d.level || (p.note || '') !== (d.note || ''));
    return { d, lvl, delta, changed };
  }).sort((a, b) => b.lvl - a.lvl || (b.changed - a.changed));
  const grid = h('div', 'heat');
  rows.forEach(r => {
    const t = h('div', 'tile' + (r.changed ? ' chg' : (prev ? ' idem' : '')));
    t.style.setProperty('--c', lc(r.lvl));
    const n = h('div', 'n');
    add(n, h('span', null, r.d.name || r.d.id), prev ? arrow(r.delta) : null);
    const show = !prev || r.changed;
    const tx = h('div', 't', show ? (r.d.note || '—') : '= IDEM');
    if (!show) {
      // Domaine inchangé : un tap affiche la note (rappel du jour précédent), un second la replie.
      t.style.cursor = 'pointer';
      t.onclick = () => {
        const open = tx.textContent === '= IDEM';
        tx.textContent = open ? '= IDEM · ' + (r.d.note || '—') : '= IDEM';
      };
    } else {
      t.style.cursor = 'default'; // domaine nouveau ou modifié : la note est déjà affichée, rien à replier
    }
    add(t, n, tx); grid.append(t);
  });
  const n = rows.filter(r => r.changed).length;
  const idemCount = prev ? rows.length - n : 0;
  const hint = idemCount ? h('p', 'mut', 'Tape une tuile « = IDEM » pour revoir sa note.') : null;
  return section('Carte des 8 domaines', prev ? n : null, [grid, hint].filter(Boolean), true);
}

/* --- top changements --- */
function topChanges(cur, prev) {
  const els = cur.top_changes.slice(0, 3).map((c, i) => {
    const d = h('div', 'tc');
    const strong = /fort/i.test(c.strength || '');
    add(d, add(h('div', 'row'), h('span', 'chip ' + (strong ? 'fort' : 'faible'), strong ? 'SIGNAL FORT' : 'SIGNAL FAIBLE'),
      c.domain ? h('span', 'chip', c.domain) : null),
      h('h4', null, `${i + 1}. ${c.title || ''}`));
    [['Fait', c.fact], ['Mécanisme', c.mechanism], ['Effet', c.effect]].forEach(([k, v]) => {
      if (v) add(d, add(h('p'), h('span', 'k', k + ' : '), document.createTextNode(String(v))));
    });
    const refs = srcRefs(cur, [c.fact, c.mechanism, c.effect], c.sources);
    if (refs) d.append(refs);
    return d;
  });
  if (!els.length) els.push(h('p', 'mut', 'Peu de mouvement : = IDEM'));
  const d = section('Top 3 des changements', cur.top_changes.length ? (prev ? cur.top_changes.length : null) : 0, els);
  return d;
}

/* --- scénarios --- */
function scenariosSec(cur, prev) {
  const pm = new Map((prev ? prev.scenarios : []).map(s => [s.id || s.name, s]));
  const list = cur.scenarios.slice().sort((a, b) => (num(b.p90) || 0) - (num(a.p90) || 0));
  let changedCount = 0;
  const els = list.map(s => {
    const p = pm.get(s.id || s.name);
    const changed = !!prev && (!p || HZ.some(([k]) => num(s[k]) !== num(p[k])) || s.confidence !== p.confidence || s.trigger !== p.trigger);
    if (changed) changedCount++;
    const d = h('details', 'sc' + (changed ? ' chg' : ''));
    const sm = h('summary');
    const dl90 = !prev ? undefined : (p ? (num(s.p90) || 0) - (num(p.p90) || 0) : null);
    add(sm, h('span', 'nm', s.name || s.id), h('span', 'p90', num(s.p90) != null ? num(s.p90) + ' %' : '?'),
      prev ? (changed || !p ? arrow(dl90) : h('span', 'chip', '= IDEM')) : null);
    d.append(sm);
    const bd = h('div', 'bd');
    const hz = h('div', 'hz');
    HZ.forEach(([k, lab]) => {
      const v = s[k] || {};
      const dd = !prev ? undefined : (p ? (num(s[k]) || 0) - (num(p[k]) || 0) : null);
      const box = h('div');
      add(box, h('small', null, lab), h('b', null, num(s[k]) != null ? num(s[k]) + ' %' : '?'),
        v.lo != null ? h('div', 'r', `(${v.lo}–${v.hi})`) : null, prev ? arrow(dd) : null);
      hz.append(box);
    });
    bd.append(hz);
    const c = Math.max(0, Math.min(3, s.confidence | 0));
    add(bd, add(h('p'), h('span', 'mut', 'Confiance : '), h('span', 'conf', '●'.repeat(c) + '○'.repeat(3 - c))));
    if (s.trigger) add(bd, add(h('p'), h('span', 'mut', 'Déclencheur : '), document.createTextNode(s.trigger)));
    if (s.justification) bd.append(h('p', 'mut', s.justification));
    bd.append(srcRefs(cur, [s.justification, s.trigger]) || h('p', 'mut', 'Sources : aucune citée pour ce scénario.'));
    d.append(bd);
    return d;
  });
  return section('Scénarios (probabilités)', prev ? changedCount : null, els);
}

/* --- impacts --- */
function impactsSec(cur, prev) {
  const pm = new Map((prev ? prev.impacts : []).map(r => [r.scenario_id || r.scenario, r]));
  const name = id => { const s = cur.scenarios.find(x => (x.id || x.name) === id); return s ? (s.name || id) : id; };
  const tbl = h('table'), thead = h('thead'), hr = h('tr');
  hr.append(h('th', null, 'Scénario'));
  IMPACTS.forEach(([, l]) => hr.append(h('th', null, l)));
  tbl.append(add(thead, hr));
  const tb = h('tbody'); let changedRows = 0;
  cur.impacts.forEach(r => {
    const id = r.scenario_id || r.scenario, p = pm.get(id);
    const rowChanged = !!prev && (!p || IMPACTS.some(([k]) => (r[k] | 0) !== (p[k] | 0)));
    if (rowChanged) changedRows++;
    const tr = h('tr', prev && !rowChanged ? 'idem' : '');
    tr.append(h('td', null, name(id)));
    IMPACTS.forEach(([k]) => {
      const v = Math.max(0, Math.min(3, r[k] | 0));
      const td = h('td', prev && p && (p[k] | 0) !== v ? 'cc' : '');
      if (v === 0) td.textContent = '–'; else { const dt = h('span', 'dot'); dt.style.background = lc(v); dt.title = ['', 'faible', 'moyen', 'élevé'][v]; td.append(dt); }
      tr.append(td);
    });
    tb.append(tr);
  });
  tbl.append(tb);
  const els = cur.impacts.length ? [add(h('div', 'tw'), tbl), impactLegend()] : [h('p', 'mut', 'Aucun impact renseigné.')];
  return section('Impacts quotidiens', prev ? changedRows : null, els);
}

/* --- indicateurs --- */
function indicatorsSec(cur, prev) {
  const pm = new Map((prev ? prev.indicators : []).map(i => [i.name, i]));
  let n = 0;
  const els = cur.indicators.map(i => {
    const p = pm.get(i.name);
    const ch = !!prev && (!p || p.current !== i.current || p.status !== i.status);
    if (ch) n++;
    const d = h('div', 'ind');
    const st = String(i.status || '');
    const cls = /franchi/i.test(st) ? 'fort' : /approche/i.test(st) ? 'faible' : '';
    add(d, add(h('div', 'l1'), h('span', null, i.name), h('span', 'chip ' + cls, st || '—')),
      h('div', 'l2', `Actuel : ${i.current ?? '—'}${p && p.current !== i.current ? ` (avant : ${p.current})` : ''}`),
      h('div', 'l2', `▲ monte si : ${i.up ?? '—'}  ·  ▼ baisse si : ${i.down ?? '—'}`));
    return d;
  });
  return section('Indicateurs à surveiller', prev ? n : null, els.length ? els : [h('p', 'mut', '—')]);
}

/* --- actions --- */
function actionsSec(cur, prev) {
  const lv = cur.alert.level | 0;
  const pk = new Set((prev ? prev.actions : []).map(a => `${a.level}|${a.text}`));
  const prevStatus = new Map((prev ? prev.actions : []).map(a => [`${a.level}|${a.text}`, a.status]));
  const ico = { fait: '✅', afaire: '⬜', interdit: '⛔' };
  const prio = { urgent: '🔥', mois: '⏳', plus_tard: '📅' };
  let n = 0;
  const mk = a => {
    const k = `${a.level}|${a.text}`;
    const isNew = !!prev && !pk.has(k);
    const statusChg = !!prev && pk.has(k) && prevStatus.get(k) !== a.status;
    if (isNew || statusChg) n++;
    const r = h('div', 'li');
    add(r, h('span', 'ico', ico[a.status] || '⬜'),
      h('span', 'tx', a.text), isNew ? h('span', 'chip chg', '🆕') : statusChg ? h('span', 'chip chg', 'mis à jour') : null,
      a.priority && prio[a.priority] ? h('span', null, prio[a.priority]) : null);
    return r;
  };
  const els = [];
  const focus = [lv, Math.min(4, lv + 1)];
  focus.forEach((L, i) => {
    const items = cur.actions.filter(a => (a.level | 0) === L);
    els.push(h('div', 'grp', `${i === 0 ? 'Niveau actuel' : 'Niveau suivant'} · N${L}`));
    els.push(...(items.length ? items.map(mk) : [h('p', 'mut', '—')]));
  });
  const others = cur.actions.filter(a => !focus.includes(a.level | 0));
  if (others.length) {
    const dd = h('details');
    dd.append(h('summary', 'mut', `Autres niveaux : = IDEM (${others.length}) — afficher`));
    others.forEach(a => dd.append(mk(a)));
    els.push(dd);
  }
  els.push(h('p', 'mut', '✅ fait · ⬜ à faire · ⛔ à ne pas faire · 🔥 urgent · ⏳ ce mois · 📅 plus tard'));
  return section('Étapes à mener', prev ? n : null, els);
}

/* --- hypothèses --- */
function hypSec(cur, prev) {
  const ico = { juste: '✅', faux: '❌', indetermine: '❓', nouveau: '🆕' };
  const pk = new Set((prev ? prev.hypotheses : []).map(x => x.text));
  let n = 0;
  const els = cur.hypotheses.map(x => {
    const isNew = !!prev && !pk.has(x.text);
    if (isNew || x.verdict === 'juste' || x.verdict === 'faux') n++;
    const r = h('div', 'li');
    const tx = h('span', 'tx');
    add(tx, document.createTextNode(String(x.text || '')),
      x.comment ? h('div', 'mut', x.comment) : null,
      x.eval_date ? h('div', 'mut', 'À évaluer le ' + fmtDate(x.eval_date)) : null);
    add(r, h('span', 'ico', ico[x.verdict] || '❓'), tx);
    return r;
  });
  return section('Journal des hypothèses', prev ? n : null, els.length ? els : [h('p', 'mut', '—')]);
}

/* --- sources --- */
function sourcesSec(cur) {
  const els = cur.sources.map(s => {
    const p = h('div', 'src');
    p.append(document.createTextNode(`[${s.n}] ${s.title || ''}${s.publisher ? ' — ' + s.publisher : ''}${s.date ? ' (' + s.date + ')' : ''} `));
    if (typeof s.url === 'string' && /^https:\/\//i.test(s.url)) {
      const a = h('a', null, 'ouvrir'); a.href = s.url; a.target = '_blank'; a.rel = 'noopener noreferrer'; p.append(a);
    }
    return p;
  });
  const d = h('details', 'sec');
  add(d, add(h('summary'), h('span', 'st', 'Sources'), h('span', 'chip', String(cur.sources.length))),
    add(h('div', 'sbody'), els.length ? els : [h('p', 'mut', '—')]));
  return d;
}

/* ---------- actions de menu ---------- */
async function copyText(t) {
  try { await navigator.clipboard.writeText(t); return true; }
  catch (e) {
    const ta = h('textarea'); ta.value = t; document.body.append(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch (_) { /* rien */ }
    ta.remove(); return ok;
  }
}
async function fetchJson(url) {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(url + ' → ' + r.status);
  return r.json();
}
/* Synchro incrémentale : ne télécharge que les rapports absents du téléphone (+ le plus récent,
   au cas où il aurait été régénéré dans la journée). Limitée aux MAX_STORED derniers fichiers. */
async function pullFromRepo() {
  const list = await fetchJson('data/index.json');
  if (!Array.isArray(list)) throw new Error('data/index.json doit être une liste de fichiers.');
  const files = list.filter(f => typeof f === 'string' && /^[\w.-]+\.json$/.test(f) && !/^sample-/.test(f))
    .sort().slice(-MAX_STORED);
  const have = new Set(reports.map(r => r.date + '.json'));
  const latest = files[files.length - 1];
  let n = 0;
  for (const f of files) {
    if (have.has(f) && f !== latest) continue;
    try { addReport(parseReport(JSON.stringify(await fetchJson('data/' + f))), true); n++; } catch (e) { /* fichier ignoré */ }
  }
  return n;
}
async function syncRepo() {
  try {
    const n = await pullFromRepo();
    idx = reports.length - 1; render(); toast(`${n} rapport(s) synchronisé(s)`);
  } catch (e) { toast('Synchro impossible : ' + e.message); }
}
async function loadSample() {
  try {
    for (const f of ['sample-prev.json', 'sample-curr.json']) addReport(parseReport(JSON.stringify(await fetchJson('data/' + f))), true);
    render(); toast('Exemple fictif chargé');
  } catch (e) { toast('Exemple indisponible : ' + e.message); }
}

/* ---------- événements ---------- */
function init() {
  reports = load();
  idx = reports.length - 1;
  $('#prev').onclick = () => { if (idx > 0) { idx--; render(); window.scrollTo(0, 0); } };
  $('#next').onclick = () => { if (idx < reports.length - 1) { idx++; render(); window.scrollTo(0, 0); } };
  $('#addBtn').onclick = () => { $('#importErr').textContent = ''; $('#importDlg').showModal(); };
  $('#menuBtn').onclick = () => $('#menuDlg').showModal();
  $('#pasteBtn').onclick = async () => {
    try { $('#importTxt').value = await navigator.clipboard.readText(); } catch (e) { $('#importErr').textContent = 'Collage auto refusé : colle manuellement.'; }
  };
  $('#importOk').onclick = () => {
    try {
      addReport(parseReport($('#importTxt').value));
      $('#importTxt').value = ''; $('#importDlg').close();
    } catch (e) { $('#importErr').textContent = e.message; }
  };
  $('#copyCur').onclick = async () => {
    if (idx < 0) return toast('Aucun rapport');
    toast((await copyText(JSON.stringify(reports[idx], null, 1))) ? 'Rapport copié : colle-le dans le prompt' : 'Copie impossible');
    $('#menuDlg').close();
  };
  $('#syncBtn').onclick = () => { $('#menuDlg').close(); syncRepo(); };
  $('#sampleBtn').onclick = () => { $('#menuDlg').close(); loadSample(); };
  $('#delCur').onclick = () => {
    if (idx < 0) return;
    if (confirm('Supprimer le rapport du ' + fmtDate(reports[idx].date) + ' de cet appareil ?')) {
      reports.splice(idx, 1); idx = Math.min(idx, reports.length - 1); persist(); render();
    }
    $('#menuDlg').close();
  };
  render();
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    // Quand une nouvelle version du service worker prend la main, on recharge une fois la page
    // pour que HTML, CSS et JS soient tous de la même version.
    const hadController = !!navigator.serviceWorker.controller;
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController && !reloaded) { reloaded = true; location.reload(); }
    });
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
      .then(reg => reg.update()).catch(() => { /* hors-ligne indisponible */ });
  }
  // Synchro silencieuse au lancement si le dépôt expose data/index.json
  pullFromRepo().then(n => {
    if (n) { idx = reports.length - 1; render(); }
  }).catch(() => { /* pas de dépôt de données : mode import manuel */ });
}
if (typeof document !== 'undefined' && document.getElementById('app')) init();
