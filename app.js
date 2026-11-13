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
let DOOM = null; // repère annuel Doomsday Clock (data/doomsday.json), mis à jour à la main chaque fin janvier
const DOOM_KEY = 'riskwatch.doomsday.v1';

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
  if (d === null) return h('span', 'dl new', 'NOUV');
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

/* ---------- rendu v10 : « exec brief, engine-spec » en ambiance spatiale ----------
   Résumé = télémétrie · Changements = fiche technique (mode Journal au choix) · Domaines = carte stellaire.
   Pas de cartes ni de bulles : filets de 1 px, codes en Plex Mono, couleur réservée au sens. */
const DCODE = { geo: 'GEO', energie: 'ENE', supply: 'APP', cyber: 'CYB', climat: 'CLI', sante: 'SAN', social: 'SOC', prep: 'PRE' };
const DORDER = ['geo', 'energie', 'supply', 'cyber', 'climat', 'sante', 'social', 'prep'];
const MODE_KEY = 'riskwatch.mode.v1';
let MODE = 'compact';
try { MODE = localStorage.getItem(MODE_KEY) === 'journal' ? 'journal' : 'compact'; } catch (e) { /* stockage indisponible */ }
const pad2 = n => String(n).padStart(2, '0');
const mono = (t, cls) => h('span', 'mono' + (cls ? ' ' + cls : ''), t);
function tag(t, color) { const s = h('span', 'tag', t); if (color) s.style.color = color; return s; }

/* --- section : filet pleine largeur, code + titre + état + compteur + ± --- */
function section(code, title, status, count, bodyEls, open = false) {
  const d = h('details', 'sec');
  const s = h('summary', 'sh');
  const st = status === null ? 'RÉF.' : status > 0 ? `▲ ${status}` : '= IDEM';
  add(s, h('span', 'scode', code), h('span', 'stitle', title),
    h('span', 'sstat' + (status > 0 ? ' chg' : ''), st), count != null ? h('span', 'scount', String(count)) : null,
    h('span', 'stog'));
  d.append(s, add(h('div', 'sbody'), bodyEls));
  d.open = open;
  return d;
}

/* --- références de sources cliquables : [n] trouvés dans les textes + numéros explicites --- */
function srcRefs(cur, texts, extra, label = 'Preuve') {
  const ns = new Set((extra || []).map(Number));
  (texts || []).forEach(t => String(t || '').replace(/\[(\d+)\]/g, (_, n) => { ns.add(Number(n)); return _; }));
  const byN = new Map((cur.sources || []).map(s => [s.n, s]));
  const list = [...ns].filter(n => byN.has(n)).sort((a, b) => a - b);
  if (!list.length) return null;
  const p = h('div', 'proof');
  p.append(mono(label + ' · '));
  list.forEach((n, i) => {
    const s = byN.get(n), label2 = `[${n}] ${s.publisher || s.title || ''}`;
    let el;
    if (typeof s.url === 'string' && /^https:\/\//i.test(s.url)) {
      el = h('a', null, label2); el.href = s.url; el.target = '_blank'; el.rel = 'noopener noreferrer';
    } else el = h('span', null, label2);
    if (s.title) el.title = s.title;
    if (i) p.append(document.createTextNode(' · '));
    p.append(el);
  });
  return p;
}

/* ---------- rendu ---------- */
function render() {
  const app = $('#app');
  app.replaceChildren();
  $('#prev').disabled = idx <= 0;
  $('#next').disabled = idx < 0 || idx >= reports.length - 1;
  if (idx < 0 || !reports[idx]) {
    $('#dateLbl').textContent = 'Canar · Veille'; $('#posLbl').textContent = '';
    const e = h('div', 'empty');
    add(e, h('h2', 'h1', 'Aucun rapport.'),
      h('p', 'lede', 'Importe un rapport (＋), synchronise depuis le dépôt, ou charge l\'exemple fictif.'));
    const b1 = h('button', 'act', 'Importer'); b1.onclick = () => $('#importDlg').showModal();
    const b2 = h('button', 'act', 'Charger l\'exemple'); b2.onclick = loadSample;
    app.append(add(e, add(h('div', 'acts'), b1, b2)));
    return;
  }
  const cur = reports[idx], prev = idx > 0 ? reports[idx - 1] : null;
  $('#dateLbl').textContent = fmtDate(cur.date);
  $('#posLbl').textContent = `${idx + 1}/${reports.length}` + (prev ? ` · vs ${fmtDate(prev.date)}` : ' · référence');
  app.append(hud(cur, prev));
  app.append(changesSec(cur, prev));
  app.append(starMapSec(cur, prev));
  app.append(scenariosSec(cur, prev));
  app.append(impactsSec(cur, prev));
  app.append(indicatorsSec(cur, prev));
  app.append(actionsSec(cur, prev));
  app.append(hypSec(cur, prev));
  app.append(sourcesSec(cur));
  if (cur.caveat) add(app, add(h('div', 'recul'), mono('Recul'), h('p', null, String(cur.caveat))));
}

/* --- RÉSUMÉ : télémétrie (réticule, niveau géant, échelle N0→N4, relevé Doomsday) --- */
function validDoom(d) {
  return d && typeof d.seconds === 'number' && d.seconds > 0 && typeof d.date === 'string' ? d : null;
}
function clockSvg(sec) {
  // Cadran générique (pas le logo officiel), trait fin : aiguilles à « sec » secondes de minuit
  const NS = 'http://www.w3.org/2000/svg';
  const el = (t, a) => { const e = document.createElementNS(NS, t); for (const k in a) e.setAttribute(k, a[k]); return e; };
  const svg = el('svg', { viewBox: '0 0 100 100', class: 'dc-svg', 'aria-hidden': 'true' });
  const R = 44, pt = (deg, r) => [50 + r * Math.sin(deg * Math.PI / 180), 50 - r * Math.cos(deg * Math.PI / 180)];
  svg.append(el('circle', { cx: 50, cy: 50, r: R, fill: 'none', stroke: 'var(--rule-2)', 'stroke-width': 3 }));
  const [x0, y0] = pt(-90, R);
  svg.append(el('path', { d: `M${x0} ${y0} A${R} ${R} 0 0 1 50 ${50 - R}`, stroke: 'var(--l3)', 'stroke-width': 6, fill: 'none' }));
  const [hx, hy] = pt(-sec / 43200 * 360, R - 20), [mx, my] = pt(-sec / 3600 * 360, R - 8);
  svg.append(el('line', { x1: 50, y1: 50, x2: hx, y2: hy, stroke: 'var(--ink)', 'stroke-width': 6 }));
  svg.append(el('line', { x1: 50, y1: 50, x2: mx, y2: my, stroke: 'var(--ink)', 'stroke-width': 3 }));
  return svg;
}
function hud(cur, prev) {
  const lv = Math.max(0, Math.min(4, cur.alert.level | 0));
  const wrap = h('div', 'brief');
  wrap.style.setProperty('--lv', lc(lv));
  // Le modèle qui a produit le rapport (champ "generator") n'est volontairement pas affiché.
  wrap.append(h('div', 'meta', [`Rapport ${fmtDate(cur.date)}`, cur.period].filter(Boolean).join(' · ')));
  const box = h('div', 'hud');
  ['tl', 'tr', 'bl', 'br'].forEach(c => box.append(h('span', 'tick ' + c)));
  let line;
  if (!prev) line = 'Rapport de référence';
  else {
    const dl = lv - (prev.alert.level | 0);
    line = dl === 0 ? `Inchangé depuis ${fmtDate(prev.date)}` : `${dl > 0 ? '▲ Monte' : '▼ Baisse'} de N${prev.alert.level} à N${lv}`;
  }
  const top = h('div', 'lvl');
  add(top, h('span', 'big', LV[lv].k),
    add(h('div', 'lvlside'), h('div', 'lvname', `${cur.alert.label || LV[lv].n} · ${LV[lv].t}`), mono(line)));
  const scale = h('div', 'scale');
  for (let i = 0; i <= 4; i++) scale.append(h('span', i < lv ? 'done' : i === lv ? 'on' : ''));
  const lab = h('div', 'scalelab');
  for (let i = 0; i <= 4; i++) lab.append(mono('N' + i, i === lv ? 'cur' : ''));
  add(box, top, scale, lab);
  if (DOOM) {
    const d = DOOM, sec = d.seconds, row = h('div', 'doom');
    const txt = h('div');
    add(txt, add(h('div', 'doomv'), mono('Doomsday'), h('b', null, sec < 180 ? `${sec} s` : `${Math.round(sec / 60)} min`), mono('avant minuit')));
    if (typeof d.previous === 'number') {
      const dl = d.previous - sec;
      txt.append(mono(`${dl > 0 ? '▲ ' + dl + ' s plus près' : dl < 0 ? '▼ ' + (-dl) + ' s plus loin' : '= inchangée'} · ${d.previous_year || 'avant'} : ${d.previous} s · repère annuel`, dl > 0 ? 'up' : dl < 0 ? 'dn' : ''));
    }
    row.title = (d.source || 'Bulletin of the Atomic Scientists') + ' · ' + fmtDate(d.date);
    add(row, clockSvg(sec), txt);
    box.append(row);
  }
  wrap.append(box);
  if (cur.alert.summary) wrap.append(h('p', 'lede', cur.alert.summary));
  if (prev && lv !== prev.alert.level && cur.alert.change_reason) wrap.append(h('p', 'lede', 'Pourquoi : ' + cur.alert.change_reason));
  return wrap;
}

/* --- CHANGEMENTS : fiche technique (compact) ou journal de bord (didactique) --- */
function changeDetail(cur, c) {
  const d = h('div', 'cdet');
  if (c.fact) d.append(h('p', null, c.fact));
  const dl = h('dl');
  [['Mécanisme', c.mechanism], ['Effet', c.effect]].forEach(([k, v]) => { if (v) add(dl, h('dt', null, k), h('dd', null, v)); });
  if (dl.children.length) d.append(dl);
  const refs = srcRefs(cur, [c.fact, c.mechanism, c.effect], c.sources);
  if (refs) d.append(refs);
  return d;
}
function changesSec(cur, prev) {
  const yymm = (cur.date || '').slice(5).replace('-', '');
  const body = [];
  const sw = h('div', 'modesw');
  [['compact', 'Compact'], ['journal', 'Journal']].forEach(([m, l]) => {
    const b = h('button', 'act' + (MODE === m ? ' on' : ''), l);
    b.onclick = () => { MODE = m; try { localStorage.setItem(MODE_KEY, m); } catch (e) { /* rien */ } render(); };
    sw.append(b);
  });
  body.push(sw);
  const list = h('div', MODE === 'journal' ? 'log' : 'rows');
  cur.top_changes.slice(0, 3).forEach((c, i) => {
    const strong = /fort/i.test(c.strength || '');
    const dom = cur.domains.find(d => d.name === c.domain || d.id === c.domain);
    const dcol = dom ? lc(Math.min(3, dom.level | 0)) : 'var(--ink-3)';
    const code = `${(dom && DCODE[dom.id]) || 'CHG'}-${pad2(i + 1)}`;
    const color = strong ? 'var(--accent)' : 'var(--l1)';
    if (MODE === 'journal') {
      const e = h('div', 'ent'); e.style.setProperty('--c', color);
      add(e, add(h('div', 'code'), document.createTextNode(`LOG-${yymm}-${pad2(i + 1)} · ${c.domain || ''} · ${strong ? 'fort' : 'faible'}`)),
        h('div', 'hl', c.title || ''), changeDetail(cur, c));
      e.querySelector('.code').style.color = color;
      list.append(e);
    } else {
      const r = h('div', 'row');
      const ctx = h('div', 'ctx');
      const s = h('span', 'sw'); s.style.background = dcol;
      add(ctx, s, h('b', null, c.domain || ''), document.createTextNode(` · ${strong ? 'fort' : 'faible'}`));
      const det = changeDetail(cur, c); det.hidden = true;
      const tg = h('button', 'act tg', '+');
      tg.onclick = () => { det.hidden = !det.hidden; tg.textContent = det.hidden ? '+' : '−'; };
      const cd = h('span', 'code', code); cd.style.color = color;
      add(r, cd, add(h('div'), h('div', 'hl', c.title || ''), ctx, det), tg);
      list.append(r);
    }
  });
  if (!cur.top_changes.length) list.append(h('p', 'note', 'Aucun changement significatif : = IDEM.'));
  body.push(list);
  return section('CHG', 'Changements', prev ? cur.top_changes.length : null, cur.top_changes.length, body);
}

/* --- DOMAINES : carte stellaire (orbite = niveau, plus près du centre = plus critique) --- */
function starMapSec(cur, prev) {
  const pm = new Map((prev ? prev.domains : []).map(x => [x.id || x.name, x]));
  const NS = 'http://www.w3.org/2000/svg';
  const el = (t, a) => { const e = document.createElementNS(NS, t); for (const k in a) e.setAttribute(k, a[k]); return e; };
  const W = 340, H = 300, cx = 170, cy = 150, R = { 3: 44, 2: 80, 1: 114, 0: 140 };
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'orbit', role: 'img', 'aria-label': 'Carte des 8 domaines' });
  [44, 80, 114, 140].forEach(r => svg.append(el('circle', { cx, cy, r, fill: 'none', stroke: 'var(--rule-2)', 'stroke-dasharray': '2 4' })));
  const lv = Math.max(0, Math.min(4, cur.alert.level | 0));
  svg.append(el('rect', { x: cx - 5, y: cy - 5, width: 10, height: 10, fill: lc(lv) }));
  const rows = h('div', 'rows');
  const rowById = {};
  let nChg = 0;
  DORDER.forEach((id, i) => {
    const d = cur.domains.find(x => x.id === id); if (!d) return;
    const p = pm.get(id), lvl = Math.max(0, Math.min(3, d.level | 0));
    const changed = !!prev && (!p || p.level !== d.level || (p.note || '') !== (d.note || ''));
    if (changed) nChg++;
    const delta = !prev ? '' : !p ? ' NOUV' : lvl > (p.level | 0) ? ' ▲' : lvl < (p.level | 0) ? ' ▼' : changed ? ' •' : '';
    const ang = (i * 45 + 22.5) * Math.PI / 180, r = R[lvl];
    const x = cx + r * Math.sin(ang), y = cy - r * Math.cos(ang);
    const g = el('g', { class: 'planet' + (changed ? ' chg' : ''), tabindex: '0' });
    if (changed) g.append(el('rect', { x: x - 7, y: y - 7, width: 14, height: 14, fill: 'none', stroke: 'var(--ink)', 'stroke-width': 1 }));
    g.append(el('rect', { x: x - 4, y: y - 4, width: 8, height: 8, fill: lc(lvl) }));
    const right = x >= cx;
    const t = el('text', { x: x + (right ? 11 : -11), y: y + 3, 'text-anchor': right ? 'start' : 'end' });
    t.textContent = (DCODE[id] || id) + delta;
    g.append(t);
    g.addEventListener('click', () => openRow(id));
    g.addEventListener('keydown', ev => { if (ev.key === 'Enter') openRow(id); });
    svg.append(g);
    // ligne correspondante sous la carte
    const row = h('div', 'row drow' + (changed ? '' : prev ? ' idem' : ''));
    const cd = h('span', 'code', DCODE[id]); cd.style.color = lc(lvl);
    const show = !prev || changed;
    const note = h('div', 'ctx', show ? (d.note || '—') : '= IDEM');
    const head = h('div', 'hl');
    add(head, document.createTextNode(d.name || id), mono(` N${lvl}${delta}`, delta.includes('▲') ? 'up' : delta.includes('▼') ? 'dn' : ''));
    add(row, cd, add(h('div'), head, note));
    row._toggle = () => { if (!show) note.textContent = note.textContent === '= IDEM' ? '= IDEM · ' + (d.note || '—') : '= IDEM'; };
    if (!show) row.onclick = row._toggle;
    rowById[id] = row; rows.append(row);
  });
  function openRow(id) {
    const r = rowById[id]; if (!r) return;
    Object.values(rowById).forEach(x => x.classList.remove('sel'));
    r.classList.add('sel'); if (r._toggle && r.classList.contains('idem')) r._toggle();
    r.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  const lg = h('div', 'legend');
  [[3, 'N3'], [2, 'N2'], [1, 'N1'], [0, 'N0']].forEach(([v, l]) => { const s = h('span', 'sw'); s.style.background = lc(v); add(lg, add(h('span'), s, mono(l))); });
  add(lg, add(h('span'), h('span', 'sw ring'), mono('modifié')));
  return section('DOM', 'Domaines', prev ? nChg : null, 8, [svg, lg, rows], true);
}

/* --- SCÉNARIOS : grille de chiffres, détail au toucher --- */
function scenariosSec(cur, prev) {
  const pm = new Map((prev ? prev.scenarios : []).map(s => [s.id || s.name, s]));
  const list = cur.scenarios.slice().sort((a, b) => (num(b.p90) || 0) - (num(a.p90) || 0));
  let n = 0;
  const grid = h('div', 'grid4');
  add(grid, mono(''), mono('30 j', 'r'), mono('90 j', 'r'), mono('1 an', 'r'));
  list.forEach((s, i) => {
    const p = pm.get(s.id || s.name);
    const changed = !!prev && (!p || HZ.some(([k]) => num(s[k]) !== num(p[k])) || s.confidence !== p.confidence || s.trigger !== p.trigger);
    if (changed) n++;
    const name = h('button', 'gname');
    const cd = h('span', 'code', `SCN-${pad2(i + 1)} `);
    add(name, cd, document.createTextNode(s.name || s.id));
    grid.append(name);
    HZ.forEach(([k]) => {
      const v = num(s[k]), d = !prev ? 0 : p ? (v || 0) - (num(p[k]) || 0) : 0;
      grid.append(h('span', 'gnum' + (d > 0 ? ' up' : d < 0 ? ' dn' : ''), v != null ? String(v) : '?'));
    });
    const det = h('div', 'gdet'); det.hidden = true;
    const c = Math.max(0, Math.min(3, s.confidence | 0));
    const dl = h('dl');
    add(dl, h('dt', null, 'Fourchettes'), h('dd', null, HZ.map(([k, l]) => `${l} : ${(s[k] || {}).lo ?? '?'}–${(s[k] || {}).hi ?? '?'} %`).join(' · ')),
      h('dt', null, 'Confiance'), h('dd', null, `${c}/3`),
      s.trigger ? h('dt', null, 'Déclencheur') : null, s.trigger ? h('dd', null, s.trigger) : null,
      s.justification ? h('dt', null, 'Pourquoi') : null, s.justification ? h('dd', null, s.justification) : null);
    add(det, dl, srcRefs(cur, [s.justification, s.trigger]));
    grid.append(det);
    name.onclick = () => { det.hidden = !det.hidden; };
  });
  return section('SCN', 'Scénarios', prev ? n : null, list.length, [grid, h('p', 'note', 'Probabilités en %. Bleu : en baisse, orange : en hausse. Toucher un scénario pour le détail.')]);
}

/* --- IMPACTS : matrice à filets internes --- */
function impactsSec(cur, prev) {
  const pm = new Map((prev ? prev.impacts : []).map(r => [r.scenario_id || r.scenario, r]));
  const name = id => { const s = cur.scenarios.find(x => (x.id || x.name) === id); return s ? (s.name || id) : id; };
  // mêmes codes SCN-xx que la section Scénarios (tri par probabilité à 90 jours)
  const order = cur.scenarios.slice().sort((a, b) => (num(b.p90) || 0) - (num(a.p90) || 0)).map(s => s.id || s.name);
  const tbl = h('table', 'mx'), tr0 = h('tr');
  tr0.append(h('th', null, ''));
  IMPACTS.forEach(([, l]) => tr0.append(h('th', null, l)));
  tbl.append(add(h('thead'), tr0));
  const tb = h('tbody'); let n = 0;
  cur.impacts.forEach(r => {
    const id = r.scenario_id || r.scenario, p = pm.get(id);
    const rowChanged = !!prev && (!p || IMPACTS.some(([k]) => (r[k] | 0) !== (p[k] | 0)));
    if (rowChanged) n++;
    const tr = h('tr', prev && !rowChanged ? 'idem' : '');
    const first = h('td', 'mxname'); first.title = name(id);
    add(first, h('span', 'code', `SCN-${pad2(order.indexOf(id) + 1)} `), h('span', 'mxn', name(id)));
    tr.append(first);
    IMPACTS.forEach(([k]) => {
      const v = Math.max(0, Math.min(3, r[k] | 0));
      const td = h('td', prev && p && (p[k] | 0) !== v ? 'cc' : '');
      if (v === 0) td.textContent = '·'; else { const s = h('span', 'sw'); s.style.background = lc(v); s.title = ['', 'faible', 'moyen', 'élevé'][v]; td.append(s); }
      tr.append(td);
    });
    tb.append(tr);
  });
  tbl.append(tb);
  const lg = h('div', 'legend');
  [[1, 'faible'], [2, 'moyen'], [3, 'élevé']].forEach(([v, l]) => { const s = h('span', 'sw'); s.style.background = lc(v); add(lg, add(h('span'), s, mono(l))); });
  add(lg, add(h('span'), h('span', 'sw ring'), mono('changement')), add(h('span'), mono('· aucun')));
  return section('IMP', 'Impacts', prev ? n : null, cur.impacts.length, cur.impacts.length ? [add(h('div', 'tw'), tbl), lg] : [h('p', 'note', '—')]);
}

/* --- INDICATEURS --- */
function indicatorsSec(cur, prev) {
  const pm = new Map((prev ? prev.indicators : []).map(i => [i.name, i]));
  let n = 0;
  const rows = h('div', 'rows');
  cur.indicators.forEach((i, k) => {
    const p = pm.get(i.name);
    if (!!prev && (!p || p.current !== i.current || p.status !== i.status)) n++;
    const st = String(i.status || '');
    const col = /franchi/i.test(st) ? 'var(--l3)' : /approche/i.test(st) ? 'var(--accent)' : 'var(--ink-3)';
    const r = h('div', 'row');
    const cd = h('span', 'code', `IND-${pad2(k + 1)}`); cd.style.color = col;
    add(r, cd, add(h('div'), add(h('div', 'hl'), document.createTextNode(i.name + ' '), tag(st.toUpperCase() || '—', col)),
      h('div', 'ctx', `Actuel : ${i.current ?? '—'}${p && p.current !== i.current ? `  (avant : ${p.current})` : ''}`),
      mono(`▲ si ${i.up ?? '—'} · ▼ si ${i.down ?? '—'}`)));
    rows.append(r);
  });
  return section('IND', 'Indicateurs', prev ? n : null, cur.indicators.length, [rows]);
}

/* --- ÉTAPES À MENER --- */
function actionsSec(cur, prev) {
  const lv = cur.alert.level | 0;
  const pk = new Map((prev ? prev.actions : []).map(a => [`${a.level}|${a.text}`, a.status]));
  const ST = { fait: ['FAIT', 'var(--l0)'], afaire: ['À FAIRE', 'var(--ink)'], interdit: ['À ÉVITER', 'var(--l3)'] };
  const PR = { urgent: ['URGENT', 'var(--accent)'], mois: ['CE MOIS', 'var(--ink-3)'], plus_tard: ['PLUS TARD', 'var(--ink-3)'] };
  let n = 0;
  const mk = a => {
    const k = `${a.level}|${a.text}`, isNew = !!prev && !pk.has(k), stChg = !!prev && pk.has(k) && pk.get(k) !== a.status;
    if (isNew || stChg) n++;
    const [stl, stc] = ST[a.status] || ST.afaire;
    const r = h('div', 'row arow');
    add(r, tag(stl, stc), add(h('div'), h('div', 'ctx strong', a.text),
      add(h('div', 'tags'), a.priority && PR[a.priority] ? tag(PR[a.priority][0], PR[a.priority][1]) : null,
        isNew ? tag('NOUV', 'var(--accent)') : stChg ? tag('MIS À JOUR', 'var(--accent)') : null)));
    return r;
  };
  const els = [];
  [lv, Math.min(4, lv + 1)].forEach((L, i) => {
    els.push(h('div', 'grp', `${i === 0 ? 'Niveau actuel' : 'Niveau suivant'} · N${L}`));
    const items = cur.actions.filter(a => (a.level | 0) === L);
    els.push(add(h('div', 'rows'), items.length ? items.map(mk) : [h('p', 'note', '—')]));
  });
  const others = cur.actions.filter(a => ![lv, lv + 1].includes(a.level | 0));
  if (others.length) {
    const dd = h('details', 'sub');
    dd.append(h('summary', 'act', `Autres niveaux (${others.length})`), add(h('div', 'rows'), others.map(mk)));
    els.push(dd);
  }
  return section('ACT', 'Étapes à mener', prev ? n : null, cur.actions.length, els);
}

/* --- HYPOTHÈSES --- */
function hypSec(cur, prev) {
  const V = { juste: ['JUSTE', 'var(--l0)'], faux: ['FAUX', 'var(--l3)'], indetermine: ['INDÉT.', 'var(--ink-3)'], nouveau: ['NOUV', 'var(--accent)'] };
  const pk = new Set((prev ? prev.hypotheses : []).map(x => x.text));
  let n = 0;
  const rows = h('div', 'rows');
  cur.hypotheses.forEach(x => {
    if ((!!prev && !pk.has(x.text)) || x.verdict === 'juste' || x.verdict === 'faux') n++;
    const [vl, vc] = V[x.verdict] || V.indetermine;
    const r = h('div', 'row arow');
    add(r, tag(vl, vc), add(h('div'), h('div', 'ctx strong', x.text || ''),
      x.comment ? h('div', 'ctx', x.comment) : null, x.eval_date ? mono('Échéance ' + fmtDate(x.eval_date)) : null));
    rows.append(r);
  });
  return section('HYP', 'Hypothèses', prev ? n : null, cur.hypotheses.length, [rows]);
}

/* --- SOURCES --- */
function sourcesSec(cur) {
  const rows = h('div', 'rows');
  cur.sources.forEach(s => {
    const r = h('div', 'row srow');
    const body = h('div', 'ctx');
    body.append(document.createTextNode(`${s.title || ''}${s.publisher ? ' — ' + s.publisher : ''}${s.date ? ' (' + s.date + ')' : ''} `));
    if (typeof s.url === 'string' && /^https:\/\//i.test(s.url)) {
      const a = h('a', 'act', 'Ouvrir'); a.href = s.url; a.target = '_blank'; a.rel = 'noopener noreferrer'; body.append(a);
    }
    add(r, h('span', 'code', `[${s.n}]`), body);
    rows.append(r);
  });
  const d = h('details', 'sec');
  add(d, add(h('summary', 'sh'), h('span', 'scode', 'SRC'), h('span', 'stitle', 'Sources'), h('span', 'sstat', ''), h('span', 'scount', String(cur.sources.length)), h('span', 'stog')),
    add(h('div', 'sbody'), cur.sources.length ? [rows] : [h('p', 'note', '—')]));
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
  try { DOOM = validDoom(JSON.parse(localStorage.getItem(DOOM_KEY) || 'null')); } catch (e) { DOOM = null; }
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
  // Repère Doomsday Clock (facultatif) : affiché si data/doomsday.json existe et est valide
  fetchJson('data/doomsday.json').then(d => {
    const v = validDoom(d);
    if (JSON.stringify(v) !== JSON.stringify(DOOM)) {
      DOOM = v;
      try { localStorage.setItem(DOOM_KEY, JSON.stringify(v)); } catch (e) { /* stockage indisponible */ }
      render();
    }
  }).catch(() => { /* pas de fichier : bandeau pleine largeur */ });
  pullFromRepo().then(n => {
    if (n) { idx = reports.length - 1; render(); }
  }).catch(() => { /* pas de dépôt de données : mode import manuel */ });
}
if (typeof document !== 'undefined' && document.getElementById('app')) init();
