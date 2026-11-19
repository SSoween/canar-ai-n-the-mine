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
const DCODE = { geo: 'GEO', energie: 'ENE', supply: 'APP', cyber: 'CYB', climat: 'CLI', sante: 'SAN', social: 'MEN', prep: 'PRE' };
const DORDER = ['geo', 'energie', 'supply', 'cyber', 'climat', 'sante', 'social', 'prep'];
const MODE_KEY = 'riskwatch.mode.v1';
let MODE = 'compact';
try { MODE = localStorage.getItem(MODE_KEY) === 'journal' ? 'journal' : 'compact'; } catch (e) { /* stockage indisponible */ }
const pad2 = n => String(n).padStart(2, '0');
const mono = (t, cls) => h('span', 'mono' + (cls ? ' ' + cls : ''), t);
function chgTag(isNew) { return tag(isNew ? 'NOUV' : 'MODIF.', 'var(--accent)'); }
function tag(t, color) { const s = h('span', 'tag', t); if (color) s.style.color = color; return s; }

/* --- section : filet pleine largeur, code + titre + état + compteur + ± --- */
function section(code, title, status, count, bodyEls, open = false) {
  const d = h('details', 'sec');
  const s = h('summary', 'sh');
  const st = status === null ? 'RÉF.' : status > 0 ? `${status} MODIF.` : '= IDEM';
  add(s, h('span', 'scode', code), h('span', 'stitle', title),
    h('span', 'sstat' + (status > 0 ? ' chg' : ''), st), count != null ? h('span', 'scount', String(count)) : null,
    h('span', 'stog'));
  d.append(s, add(h('div', 'sbody'), bodyEls));
  d.open = open;
  d.dataset.n = status > 0 ? status : 0;
  d.dataset.key = code;
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

/* ---------- rendu v16 : quatre parties (Brief · Faits · Analyse · Agir) + annexes ----------
   Faits = ce qui s'est passé (sources, aucune probabilité) ; Analyse = ce qu'on en pense.
   Une seule façon de classer les faits : 5 théâtres + 8 domaines. Les canaux de veille, le dossier (focus)
   et les tests sont rangés dans leur domaine. */
const WMAP = { pan: 'cyber', gaz: 'energie', res: 'energie', eng: 'supply', sab: 'supply', h5n: 'sante', tau: 'social' };
const DNAME = { cyber: 'Cyber et pannes', social: 'Économie des ménages' };
const PARTS = [['brief', 'Brief'], ['faits', 'Faits'], ['analyse', 'Analyse'], ['agir', 'Agir'], ['lus', 'Lus']];
const READ_KEY = 'riskwatch.read.v1';
function readGet(date) { try { const o = JSON.parse(localStorage.getItem(READ_KEY) || '{}'); return new Set(o[date] || []); } catch (e) { return new Set(); } }
function readToggle(date, key) {
  let o = {}; try { o = JSON.parse(localStorage.getItem(READ_KEY) || '{}'); } catch (e) { o = {}; }
  const s = new Set(o[date] || []); s.has(key) ? s.delete(key) : s.add(key);
  o = { [date]: [...s] }; // seul le rapport affiché garde ses lectures : un nouveau rapport repart de zéro
  try { localStorage.setItem(READ_KEY, JSON.stringify(o)); } catch (e) { /* stockage indisponible */ }
  const y = window.scrollY || 0; render(); try { window.scrollTo(0, y); } catch (e) { /* rien */ }
}
const nOf = el => [...el.querySelectorAll('[data-n]')].reduce((s, e) => s + (Number(e.dataset.n) || 0), 0);
const ddmm = d => (/^\d{4}-\d{2}-\d{2}$/.test(d || '') ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : '—');

function partHead(num, id, title, hint) {
  const d = h('div', 'part'); d.id = 'part-' + id;
  add(d, h('span', 'ph', num), h('h2', null, title), hint ? h('p', null, hint) : null);
  return d;
}
/* carte biseautée repliable (même logique que section) */
function card(code, title, lvl, n, prev, bodyEls, open, extraCls, prevLvl) {
  const d = h('details', 'card' + (extraCls ? ' ' + extraCls : '') + (n > 0 ? ' chg' : ''));
  if (lvl != null) d.style.setProperty('--lv', lc(lvl));
  d.dataset.n = n > 0 ? n : 0;
  d.dataset.key = code;
  const s = h('summary', 'ch');
  const cd = h('span', 'code', code); if (lvl != null) cd.style.color = lc(lvl);
  const st = !prev ? 'RÉF.' : n > 0 ? `${n} MODIF.` : '= IDEM';
  add(s, cd, h('span', 'ctitle', title), lvl != null ? lvlLabel(lvl, prevLvl) : null, h('span', 'sstat' + (n > 0 ? ' chg' : ''), st), h('span', 'stog'));
  d.append(s, add(h('div', 'cbody'), bodyEls));
  d.open = !!open;
  return d;
}
/* niveau affiché ; s'il a changé : « N2 → N3 », la couleur passe en fondu de l'ancienne à la nouvelle */
function lvlLabel(lvl, prevLvl) {
  if (prevLvl == null || prevLvl === lvl) return mono('N' + lvl);
  const s = h('span', 'lvchg', `N${prevLvl} → N${lvl}`);
  s.style.setProperty('--from', lc(prevLvl)); s.style.setProperty('--to', lc(lvl));
  s.title = `Niveau ${lvl > prevLvl ? 'en hausse' : 'en baisse'} depuis le rapport précédent`;
  return s;
}
function jump(id) { const t = document.getElementById('part-' + id); if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
function navBar(counts) {
  const n = h('nav', 'pnav');
  PARTS.forEach(([id, l]) => {
    const b = h('button', 'pchip', l); b.dataset.p = id;
    if (id === 'lus') { if (counts.lus > 0) b.append(h('i', 'rc', String(counts.lus))); }
    else if (counts[id] > 0) b.append(h('i', null, '●'));
    b.onclick = () => jump(id);
    n.append(b);
  });
  return n;
}

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
  $('#posLbl').textContent = `n° ${idx + 1} sur ${reports.length}` + (prev ? ` · comparé au ${fmtDate(prev.date).slice(0, 5)}` : ' · référence');

  const parts = {
    brief: add(h('section', 'pt'), partHead('01', 'brief', 'Brief', '30 secondes'), briefPart(cur, prev)),
    faits: add(h('section', 'pt'), partHead('02', 'faits', 'Faits', 'ce qui s\'est passé · sans %'), factsPart(cur, prev)),
    analyse: add(h('section', 'pt'), partHead('03', 'analyse', 'Analyse', 'ce qu\'on en pense'), analysisPart(cur, prev)),
    agir: add(h('section', 'pt'), partHead('04', 'agir', 'Agir', 'que faire'), actionsSec(cur, prev), calendarSec(cur, prev))
  };
  // lecture : chaque carte des parties Faits, Analyse et Agir peut être marquée lue et rangée dans « Lus »
  const read = readGet(cur.date);
  const lus = add(h('section', 'pt'), partHead('05', 'lus', 'Lus', 'remis à zéro à chaque rapport'));
  const lusBox = h('div');
  ['faits', 'analyse', 'agir'].forEach(k => {
    parts[k].querySelectorAll('[data-key]').forEach(el => {
      const key = el.dataset.key, isRead = read.has(key);
      const sum = el.querySelector('summary');
      const b = h('button', 'rdbtn' + (isRead ? ' on' : ''), isRead ? 'Relire' : '✓ Lu');
      b.title = isRead ? 'Remettre à sa place' : 'Marquer lu et ranger en bas';
      b.onclick = ev => { ev.preventDefault(); ev.stopPropagation(); readToggle(cur.date, key); };
      if (sum) sum.insertBefore(b, sum.querySelector('.stog'));
      if (isRead) { el.open = false; el.classList.add('isread'); lusBox.append(el); }
    });
  });
  if (!lusBox.children.length) lusBox.append(h('p', 'note', 'Touche « ✓ Lu » sur une carte pour la ranger ici. La liste repart de zéro à chaque nouveau rapport.'));
  lus.append(lusBox);
  const counts = {}; Object.keys(parts).forEach(k => { counts[k] = nOf(parts[k]); });
  counts.brief = 0; // le Brief résume, il ne compte pas
  counts.lus = read.size;
  app.append(navBar(counts), ...Object.values(parts), lus);
  const ann = add(h('section', 'pt'), partHead('—', 'annexes', 'Annexes', 'sources · recul'), sourcesSec(cur));
  if (cur.caveat) ann.append(add(h('div', 'recul'), mono('Recul'), h('p', null, String(cur.caveat))));
  app.append(ann);
  setNavTop(); markNav();
}

/* ===== 01 BRIEF ===== */
function briefPart(cur, prev) {
  const out = [hud(cur, prev)];
  // ce qui change aujourd'hui : titres seulement, le détail est dans Analyse
  const ch = h('div', 'card flat');
  add(ch, add(h('div', 'ch'), h('span', 'code', 'CHG'), h('span', 'ctitle', 'Ce qui change aujourd\'hui')));
  const rows = h('div', 'rows');
  cur.top_changes.slice(0, 3).forEach((c, i) => {
    const strong = /fort/i.test(c.strength || '');
    const r = h('div', 'row xrow');
    add(r, mono(`CHG-${pad2(i + 1)}`), add(h('div', 'hl'), tag(strong ? 'FORT' : 'FAIBLE', strong ? 'var(--accent)' : 'var(--l1)'), document.createTextNode(c.title || '')));
    rows.append(r);
  });
  if (!cur.top_changes.length) rows.append(h('p', 'note', 'Aucun changement significatif : = IDEM.'));
  const more = h('button', 'act lnk', '› mécanisme et effet : Analyse'); more.onclick = () => jump('analyse');
  add(ch, add(h('div', 'cbody'), rows, cur.top_changes.length ? more : null));
  out.push(ch);
  // pas d'inquiétude : tests et rumeurs
  const D = Array.isArray(cur.drills) ? cur.drills : [];
  if (D.length) {
    const V = { test_officiel: ['TEST OFFICIEL', 'var(--l0)'], exercice_sur_table: ['SUR TABLE', 'var(--l0)'], rumeur_infondee: ['RUMEUR INFONDÉE', 'var(--l1)'], a_confirmer: ['À CONFIRMER', 'var(--ink-3)'] };
    const pmD = new Map(((prev && prev.drills) || []).map(x => [x.title, x]));
    let nD = 0;
    const rr = h('div', 'rows');
    D.forEach(x => {
      const p = pmD.get(x.title), changed = !!prev && (!p || p.verdict !== x.verdict || p.what !== x.what || (p.rumor || '') !== (x.rumor || ''));
      if (changed) nD++;
      const [vl, vc] = V[x.verdict] || V.a_confirmer;
      const r = h('div', 'row xrow' + (changed ? ' chg' : ''));
      add(r, mono(ddmm(x.date)), add(h('div'), add(h('div', 'hl'), changed ? chgTag(!p) : null, document.createTextNode((x.title || '') + ' '), tag(vl, vc)), mono(x.zone || '')));
      rr.append(r);
    });
    const more = h('button', 'act lnk', '› détail : Faits › Préparation'); more.onclick = () => { const t = document.getElementById('dom-prep'); if (t) { t.open = true; t.scrollIntoView({ behavior: 'smooth', block: 'start' }); } };
    out.push(card('TST', `Pas d'inquiétude · ${D.length} tests et rumeurs`, null, nD, prev,
      [h('p', 'note', 'Encadrés ou démentis : aucune action requise.'), rr, more], false, 'calm'));
  }
  // prochaines échéances
  const C = (Array.isArray(cur.calendar) ? cur.calendar : []).filter(x => x.date >= cur.date).sort(byDate).slice(0, 3);
  if (C.length) {
    const c = h('div', 'card flat');
    const rr = h('div', 'rows');
    C.forEach(x => rr.append(add(h('div', 'row xrow'), mono(ddmm(x.date)), h('div', 'hl', x.label || ''))));
    add(c, add(h('div', 'ch'), h('span', 'code', 'CAL'), h('span', 'ctitle', 'Prochaines échéances')), add(h('div', 'cbody'), rr));
    out.push(c);
  }
  return out;
}

/* ===== 02 FAITS ===== */
function factsPart(cur, prev) {
  const out = [];
  const T = Array.isArray(cur.theaters) ? cur.theaters : [];
  if (T.length) {
    out.push(h('div', 'subh', `Géopolitique · ${T.length} théâtres`));
    const pm = new Map(((prev && prev.theaters) || []).map(t => [t.id, t]));
    T.forEach(t => {
      const p = pm.get(t.id), lvl = Math.max(0, Math.min(3, t.level | 0));
      const changed = !!prev && (!p || p.level !== t.level || p.note !== t.note);
      const d = !prev || !p ? '' : lvl > (p.level | 0) ? ' ▲' : lvl < (p.level | 0) ? ' ▼' : '';
      out.push(card(String(t.id).toUpperCase(), t.name || t.id, lvl, changed ? 1 : 0, prev,
        [h('p', 'txt', t.note || ''), srcRefs(cur, [t.note], [], 'Sources')], !prev || changed, null, p ? (p.level | 0) : null));
    });
  }
  out.push(h('div', 'subh', 'Systèmes · domaines, canaux et dossiers'));
  out.push(levelBoard(cur, prev, !T.length));
  const W = Array.isArray(cur.watch) ? cur.watch : [];
  const pw = new Map(((prev && prev.watch) || []).map(w => [w.id, w]));
  const pd = new Map(((prev && prev.domains) || []).map(d => [d.id, d]));
  const focusDom = cur.focus ? (cur.focus.domain || 'energie') : null;
  const placed = new Set();
  DORDER.forEach(id => {
    if (id === 'geo' && T.length) return; // les théâtres tiennent lieu de domaine géopolitique
    const d = cur.domains.find(x => x.id === id); if (!d) return;
    const p = pd.get(id), lvl = Math.max(0, Math.min(3, d.level | 0));
    const dChg = !!prev && (!p || p.level !== d.level || (p.note || '') !== (d.note || ''));
    const delta = !prev || !p ? '' : lvl > (p.level | 0) ? ' ▲' : lvl < (p.level | 0) ? ' ▼' : '';
    let n = dChg ? 1 : 0;
    const body = [h('p', 'txt', d.note || '—'), srcRefs(cur, [d.note], [], 'Sources')];
    if (focusDom === id) { const f = focusBlock(cur, prev); n += f.n; body.push(f.el); }
    W.filter(w => (w.domain || WMAP[w.id]) === id).forEach(w => {
      placed.add(w.id); const x = channelBlock(cur, w, pw.get(w.id), prev); n += x.n; body.push(x.el);
    });
    if (id === 'prep') { const x = drillsBlock(cur, prev); if (x) { n += x.n; body.push(x.el); } }
    const c = card(DCODE[id] || id.toUpperCase(), DNAME[id] || d.name || id, lvl, n, prev, body, !prev || n > 0, null, p ? (p.level | 0) : null);
    c.id = 'dom-' + id;
    out.push(c);
  });
  const rest = W.filter(w => !placed.has(w.id));
  if (rest.length) {
    let n = 0; const body = [];
    rest.forEach(w => { const x = channelBlock(cur, w, pw.get(w.id), prev); n += x.n; body.push(x.el); });
    out.push(card('AUT', 'Autres canaux', null, n, prev, body, n > 0));
  }
  const rad = radarSec(cur, prev);
  if (rad) { rad.querySelector('.stitle').textContent = 'Hors champ · Radar'; out.push(rad); }
  return out;
}
/* canal de veille, imbriqué dans son domaine */
function channelBlock(cur, w, p, prev) {
  const lvl = Math.max(0, Math.min(3, w.level | 0));
  const changed = !!prev && (!p || p.level !== w.level || p.note !== w.note || (p.local || '') !== (w.local || ''));
  const d = !prev || !p ? '' : lvl > (p.level | 0) ? ' ▲' : lvl < (p.level | 0) ? ' ▼' : '';
  const el = h('div', 'nest' + (changed ? ' chg' : ''));
  el.style.setProperty('--lv', lc(lvl));
  const cd = h('span', 'code', String(w.id).toUpperCase()); cd.style.color = lc(lvl);
  const head = add(h('div', 'nh'), cd, h('span', 'ntitle', (w.name || w.id) + d), mono('N' + lvl), changed ? chgTag(!p) : null);
  const det = add(h('div'), h('p', 'txt', w.note || ''),
    w.local ? add(h('p', 'loc'), mono('Chez toi · '), document.createTextNode(w.local)) : null,
    srcRefs(cur, [w.note], [], 'Sources'));
  if (prev && !changed) {
    det.hidden = true;
    const t = h('button', 'act lnk', '= IDEM · relire'); t.onclick = () => { det.hidden = !det.hidden; };
    add(el, head, t, det);
  } else add(el, head, det);
  return { el, n: changed ? 1 : 0 };
}
/* dossier approfondi (focus), imbriqué dans son domaine */
function focusBlock(cur, prev) {
  const f = cur.focus;
  const pf = prev && prev.focus && prev.focus.title === f.title ? prev.focus : null;
  const MS = { ok: ['OK', 'var(--l0)'], surveille: ['À SURVEILLER', 'var(--l1)'], alerte: ['ALERTE', 'var(--accent)'] };
  const CS = { en_cours: ['EN COURS', 'var(--accent)'], surveille: ['SURVEILLÉ', 'var(--l1)'], inactif: ['INACTIF', 'var(--ink-3)'] };
  let n = 0;
  const body = [];
  if (f.why) body.push(h('p', 'txt', f.why));
  body.push(h('div', 'grp', 'Quantités et stocks'));
  const pm = new Map(((pf && pf.metrics) || []).map(m => [m.name, m]));
  const mrows = h('div', 'rows');
  (f.metrics || []).forEach((m, k) => {
    const p = pm.get(m.name), changed = !!pf && (!p || p.value !== m.value || p.status !== m.status);
    if (changed) n++;
    const [sl, sc] = MS[m.status] || MS.surveille;
    const r = h('div', 'row frow' + (changed ? ' chg' : ''));
    const cd = h('span', 'code', `STK-${pad2(k + 1)}`); cd.style.color = sc;
    add(r, cd, add(h('div'), add(h('div', 'fname'), changed ? chgTag(!p) : null, document.createTextNode(m.name + ' '), tag(sl, sc)),
      add(h('div', 'fval'), h('b', null, m.value), p && p.value !== m.value ? h('span', 'was', `  avant : ${p.value}`) : null),
      m.context ? h('div', 'ctx', m.context) : null));
    mrows.append(r);
  });
  body.push(mrows);
  const active = (f.cascade || []).filter(c => c.status === 'en_cours').length;
  body.push(h('div', 'grp', `Cascade · ${active} étape${active > 1 ? 's' : ''} en cours sur ${(f.cascade || []).length}`));
  const pc = new Map(((pf && pf.cascade) || []).map(c => [c.stage, c]));
  const casc = h('div', 'casc');
  (f.cascade || []).forEach(c => {
    const p = pc.get(c.stage), changed = !!pf && (!p || p.status !== c.status || p.effect !== c.effect);
    if (changed) n++;
    const [sl, sc] = CS[c.status] || CS.inactif;
    const st = h('div', 'stage ' + (c.status || 'inactif') + (changed ? ' chg' : ''));
    st.style.setProperty('--c', sc);
    add(st, add(h('div', 'shead'), h('span', 'code', c.stage), mono(c.delay || ''), tag(sl, sc), changed ? chgTag(!p) : null),
      h('div', 'hl', c.label || ''), h('div', 'ctx', c.effect || ''));
    casc.append(st);
  });
  body.push(casc);
  if (f.note) body.push(h('p', 'note', f.note));
  body.push(srcRefs(cur, [...(f.metrics || []).map(m => m.context), ...(f.cascade || []).map(c => c.effect)], [], 'Sources'));
  // rail de la cascade : visible même replié
  const rail = h('div', 'rail');
  (f.cascade || []).forEach(c => { const s = h('span', 'st ' + (c.status === 'en_cours' ? 'en' : c.status === 'surveille' ? 'su' : ''), c.stage); s.title = c.label || ''; rail.append(s); });
  const det = h('details', 'nest dossier' + (n > 0 ? ' chg' : ''));
  const s = h('summary', 'nh');
  add(s, h('span', 'code', 'DOS'), h('span', 'ntitle', 'Dossier · ' + f.title), mono(`${active}/${(f.cascade || []).length} en cours`), n > 0 ? tag(`${n} MODIF.`, 'var(--accent)') : null, h('span', 'stog'));
  add(det, s, rail, add(h('div', 'cbody'), body));
  det.open = !pf || n > 0;
  return { el: det, n };
}
/* tests et exercices : détail dans Préparation officielle */
function drillsBlock(cur, prev) {
  const D = cur.drills; if (!Array.isArray(D) || !D.length) return null;
  const V = { test_officiel: ['TEST OFFICIEL', 'var(--l0)'], exercice_sur_table: ['EXERCICE SUR TABLE', 'var(--l0)'],
    rumeur_infondee: ['RUMEUR INFONDÉE', 'var(--l1)'], a_confirmer: ['À CONFIRMER', 'var(--ink-3)'] };
  const pm = new Map(((prev && prev.drills) || []).map(x => [x.title, x]));
  let n = 0;
  const rows = h('div', 'rows');
  D.forEach(x => {
    const p = pm.get(x.title), changed = !!prev && (!p || p.verdict !== x.verdict || p.what !== x.what || (p.rumor || '') !== (x.rumor || ''));
    if (changed) n++;
    const [vl, vc] = V[x.verdict] || V.a_confirmer;
    const r = h('div', 'row xrow' + (changed ? ' chg' : ''));
    add(r, add(h('div', 'dcol'), mono(ddmm(x.date)), mono(x.zone || '')),
      add(h('div'), add(h('div', 'hl'), changed ? chgTag(!p) : null, document.createTextNode((x.title || '') + ' '), tag(vl, vc)),
        h('div', 'ctx', x.what || ''),
        x.rumor ? add(h('div', 'ctx rumor'), mono('Ce qui circule · '), document.createTextNode(x.rumor)) : null));
    rows.append(r);
  });
  const el = h('div', 'nest calm' + (n > 0 ? ' chg' : ''));
  add(el, add(h('div', 'nh'), h('span', 'code', 'TST'), h('span', 'ntitle', 'Tests et exercices'), n > 0 ? tag(`${n} MODIF.`, 'var(--accent)') : null),
    rows, srcRefs(cur, D.flatMap(x => [x.what, x.rumor]), D.flatMap(x => x.sources || []), 'Sources'));
  return { el, n };
}
/* tableau des niveaux par domaine : nom complet, jauge à 4 crans (N0 calme → N3 critique), du plus critique au plus calme.
   Remplace l'ancienne carte en orbite, jugée illisible. Toucher une ligne ouvre la carte du domaine. */
function levelBoard(cur, prev, withGeo) {
  const pm = new Map((prev ? prev.domains : []).map(x => [x.id, x]));
  const wrap = h('div', 'lvb');
  add(wrap, add(h('div', 'lvh'), h('span', null, 'Niveau par domaine'), h('span', null, 'barres = niveau · N0 calme → N3 critique')));
  const ds = DORDER.map(id => cur.domains.find(x => x.id === id)).filter(Boolean)
    .sort((a, b) => (b.level | 0) - (a.level | 0) || DORDER.indexOf(a.id) - DORDER.indexOf(b.id));
  const same = [];
  ds.forEach(d => {
    const p = pm.get(d.id), lvl = Math.max(0, Math.min(3, d.level | 0)), pl = p ? Math.max(0, Math.min(3, p.level | 0)) : null;
    const changed = !!prev && (!p || p.level !== d.level || (p.note || '') !== (d.note || ''));
    const row = h('button', 'lvrow' + (changed ? ' chg' : ''));
    const gauge = h('span', 'gauge');
    for (let i = 1; i <= 3; i++) {
      const s = h('span');
      const to = i <= lvl ? lc(lvl) : 'transparent';
      s.style.background = to;
      if (pl != null && pl !== lvl) { s.className = 'flash'; s.style.setProperty('--from', i <= pl ? lc(pl) : 'transparent'); s.style.setProperty('--to', to); }
      gauge.append(s);
    }
    const nv = pl != null && pl !== lvl ? lvlLabel(lvl, pl) : h('span', null, 'N' + lvl);
    nv.classList.add('nv'); if (pl == null || pl === lvl) nv.style.color = lc(lvl);
    add(row, add(h('span', 'nm'), document.createTextNode((DNAME[d.id] || d.name || d.id) + ' '), changed ? tag(p ? 'MODIF.' : 'NOUV', 'var(--accent)') : null), gauge, nv,
      (!prev || changed) && d.note ? h('span', 'lvnote', d.note.replace(/\s*\[\d+\](\[\d+\])*/g, '')) : null);
    row.onclick = () => {
      const tg = d.id === 'geo' && !withGeo ? document.getElementById('part-faits') : document.getElementById('dom-' + d.id);
      if (tg) { if (tg.tagName === 'DETAILS') tg.open = true; tg.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    };
    if (!prev || changed) wrap.append(row); else same.push(row);
  });
  if (same.length) {
    const dd = h('details', 'lvsame');
    dd.append(add(h('summary', null), mono(`Inchangés · ${same.length} · = IDEM`), h('span', 'stog')), add(h('div'), same));
    wrap.append(dd);
  }
  return wrap;
}

/* ===== 03 ANALYSE ===== */
/* scénarios et impacts dans une seule section : ce sont les mêmes SCN */
function scenImpSec(cur, prev) {
  const s = scenariosSec(cur, prev), i = impactsSec(cur, prev);
  const sb = s.querySelector('.sbody'), ib = i.querySelector('.sbody');
  sb.append(h('div', 'grp', 'Impacts sur la vie quotidienne · mêmes SCN'));
  [...ib.children].forEach(c => sb.append(c));
  const n = (Number(s.dataset.n) || 0) + (Number(i.dataset.n) || 0);
  s.dataset.n = n;
  if (prev) { const st = s.querySelector('.sstat'); st.textContent = n > 0 ? `${n} MODIF.` : '= IDEM'; st.classList.toggle('chg', n > 0); }
  s.querySelector('.stitle').textContent = 'Scénarios et impacts';
  return s;
}
function analysisPart(cur, prev) {
  const out = [];
  if (cur.contradiction) {
    const chg = !!prev && prev.contradiction !== cur.contradiction;
    out.push(card('CTR', 'Contre-lecture', null, chg ? 1 : 0, prev, [h('p', 'txt', cur.contradiction), srcRefs(cur, [cur.contradiction], [], 'Sources')], true, 'ctr'));
  }
  const cs = changesSec(cur, prev); cs.querySelector('.stitle').textContent = 'Pourquoi ça compte'; cs.open = true; out.push(cs);
  out.push(scenImpSec(cur, prev), indicatorsSec(cur, prev), hypSec(cur, prev));
  return out;
}

/* barre des parties : collée sous l'en-tête, la puce active suit le défilement */
function setNavTop() {
  const top = document.querySelector('.top');
  document.documentElement.style.setProperty('--hh', (top ? top.offsetHeight : 52) + 'px');
}
function markNav() {
  const chips = [...document.querySelectorAll('.pchip')]; if (!chips.length) return;
  const top = document.querySelector('.top');
  const y = (top ? top.offsetHeight : 52) + 70;
  let curId = 'brief';
  PARTS.forEach(([id]) => { const t = document.getElementById('part-' + id); if (t && t.getBoundingClientRect().top <= y) curId = id; });
  chips.forEach(c => c.classList.toggle('on', c.dataset.p === curId));
}



/* --- RADAR : signaux faibles hors périmètre, avec une décision --- */
function radarSec(cur, prev) {
  const R = cur.radar; if (!Array.isArray(R) || !R.length) return null;
  const DC = { suivre: ['SUIVRE', 'var(--accent)'], verifier: ['VÉRIFIER', 'var(--l1)'], ignorer: ['IGNORER', 'var(--ink-3)'] };
  const pm = new Map(((prev && prev.radar) || []).map(x => [x.title, x]));
  let n = 0;
  const rows = h('div', 'rows');
  R.forEach((x, k) => {
    const p = pm.get(x.title), changed = !!prev && (!p || p.decision !== x.decision || p.why !== x.why);
    if (changed) n++;
    const [dl, dc] = DC[x.decision] || DC.verifier;
    const r = h('div', 'row' + (changed ? ' chg' : ''));
    const cd = h('span', 'code', `RAD-${pad2(k + 1)}`); cd.style.color = dc;
    add(r, cd, add(h('div'), add(h('div', 'hl'), changed ? chgTag(!p) : null, document.createTextNode((x.title || '') + ' '), tag(dl, dc)),
      h('div', 'ctx', x.why || '')));
    rows.append(r);
  });
  const refs = srcRefs(cur, R.map(x => x.why), R.flatMap(x => x.sources || []), 'Sources');
  return section('RAD', 'Radar · hors périmètre', prev ? n : null, R.length, [rows, refs].filter(Boolean), true);
}

/* --- ÉCHÉANCES : dates à venir qui peuvent déplacer un risque --- */
function calendarSec(cur, prev) {
  const C = cur.calendar; if (!Array.isArray(C) || !C.length) return null;
  const pk = new Set(((prev && prev.calendar) || []).map(x => `${x.date}|${x.label}`));
  let n = 0;
  const rows = h('div', 'rows');
  [...C].sort(byDate).forEach(x => {
    const isNew = !!prev && !pk.has(`${x.date}|${x.label}`);
    if (isNew) n++;
    const r = h('div', 'row xrow' + (isNew ? ' chg' : ''));
    add(r, add(h('div', 'dcol'), mono(fmtDate(x.date))),
      add(h('div'), add(h('div', 'hl'), isNew ? chgTag(true) : null, document.createTextNode(x.label || '')), x.why ? h('div', 'ctx', x.why) : null,
        srcRefs(cur, [x.why], x.sources || [], 'Sources')));
    rows.append(r);
  });
  return section('CAL', 'Échéances', prev ? n : null, C.length, [rows]);
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
    const name = h('button', 'gname' + (changed ? ' chg' : ''));
    const cd = h('span', 'code', `SCN-${pad2(i + 1)} `);
    add(name, changed ? chgTag(!p) : null, cd, document.createTextNode(s.name || s.id));
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
    const tr = h('tr', prev ? (rowChanged ? 'chg' : 'idem') : '');
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
    const changed = !!prev && (!p || p.current !== i.current || p.status !== i.status);
    if (changed) n++;
    const st = String(i.status || '');
    const col = /franchi/i.test(st) ? 'var(--l3)' : /approche/i.test(st) ? 'var(--accent)' : 'var(--ink-3)';
    const r = h('div', 'row' + (changed ? ' chg' : ''));
    const cd = h('span', 'code', `IND-${pad2(k + 1)}`); cd.style.color = col;
    const cur1 = h('div', 'ctx');
    add(cur1, document.createTextNode('Actuel : '), h(changed ? 'b' : 'span', null, String(i.current ?? '—')),
      p && p.current !== i.current ? h('span', 'was', `  avant : ${p.current}`) : null);
    add(r, cd, add(h('div'), add(h('div', 'hl'), changed ? chgTag(!p) : null, document.createTextNode(i.name + ' '), tag(st.toUpperCase() || '—', col)),
      cur1,
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
    const r = h('div', 'row arow' + (isNew || stChg ? ' chg' : ''));
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
  const pm = new Map((prev ? prev.hypotheses : []).map(x => [x.text, x]));
  let n = 0;
  const rows = h('div', 'rows');
  cur.hypotheses.forEach(x => {
    const p = pm.get(x.text);
    const changed = !!prev && (!p || p.verdict !== x.verdict || (p.comment || '') !== (x.comment || ''));
    if (changed) n++;
    const [vl, vc] = V[x.verdict] || V.indetermine;
    const r = h('div', 'row arow' + (changed ? ' chg' : ''));
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
  window.addEventListener('scroll', markNav, { passive: true });
  window.addEventListener('resize', setNavTop);
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
