const E = makeEngine(D);
const U = {};
D.units.forEach((u) => (U[u.id] = u));
const STATUS = [
  'A iniciar',
  'Configurado',
  'Em transporte',
  'Material entregue',
  'Em execução',
  'Em validação',
  'Faturado',
  'Handover',
  'Concluída',
];
const SC = {
  'A iniciar': 'var(--s-ini)',
  Configurado: 'var(--s-cfg)',
  'Em transporte': 'var(--s-tra)',
  'Material entregue': 'var(--s-ent)',
  'Em execução': 'var(--s-exe)',
  'Em validação': 'var(--s-val)',
  Faturado: 'var(--s-fat)',
  Handover: 'var(--s-hnd)',
  Concluída: 'var(--s-con)',
};
const LIC = ['Provisória', 'Definitiva'];
const LC = { Provisória: 'var(--l-pro)', Definitiva: 'var(--l-def)' };
const MODES = { A: 'A · Avião + transportadora', B: 'B · Técnico leva o equipamento', C: 'C · Estrada + transportadora' };
const K_ = 'rotas4-c' + (window.RP_CLIENTE || '') + '-';
function load(n, d) {
  try {
    const v = localStorage.getItem(K_ + n);
    return v == null ? d : v;
  } catch (e) {
    return d;
  }
}
function save(n, v) {
  try {
    localStorage.setItem(K_ + n, v);
  } catch (e) {}
}
function loadJ(n, d) {
  try {
    const v = localStorage.getItem(K_ + n);
    return v ? JSON.parse(v) : d;
  } catch (e) {
    return d;
  }
}
let st = load('st', 'O'),
  k = +(D.equipes || load('k', 5)),
  mode = load('m', 'A'),
  start = load('d', D.P.START),
  plan = load('pl', 'M');
let sel = new Set(),
  month = undefined,
  focus = null,
  ordering = false,
  draft = [],
  openT = new Set([1]);
let status = loadJ('status', {}),
  lic = loadJ('lic', {}),
  pat = loadJ('pat', {}),
  cfg = Object.assign({ cap: 4.8, over: {}, pins: {}, order: [], states: [], moves: {}, assign: {}, force: {} }, loadJ('cfg', {}));
let editTeam = null;
let prevSt = [];
let db = null,
  cST = null,
  cLI = null,
  cPA = null,
  dCF = null;
const stOf = (id) => (STATUS.includes(status[id]) ? status[id] : 'A iniciar');
const lcOf = (id) => (LIC.includes(lic[id]) ? lic[id] : 'Provisória');
const quota = () => Math.max(1, Math.round(k * (+cfg.cap || 4.8)));
const fd = (d) => `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
const fs = (d) => `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
const MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const fm = (key) => {
  const [y, m] = key.split('-');
  return `${MES[+m - 1]}/${y.slice(2)}`;
};
const fmt = (n) => (Math.round(n * 10) / 10).toLocaleString('pt-BR');
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const tc = (t) => `var(--t${((t - 1) % 8) + 1})`;
function wdCount(a, b) {
  let n = 0;
  const d = new Date(a.getTime());
  while (d <= b) {
    const w = d.getUTCDay();
    if (w && w !== 6 && !D.hol.includes(E.iso(d))) n++;
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return n;
}
/* ---------- cálculo ---------- */
let PLAN = null;
function compute() {
  D.semDesl = cfg.semdesl || [];
  D.estEntrega = !!cfg.estEntrega;
  const paths = D[st][k].map((p) => p.filter((id) => !(U[id] && U[id].ok)));
  if (plan === 'C') {
    const sts = cfg.states || [];
    const pp = sts.length ? paths.map((p) => p.filter((id) => sts.includes(U[id].uf))).filter((p) => p.length) : paths;
    const rows = pp.length ? E.continuous(pp, mode, start).flat() : [];
    const mm = {};
    rows.forEach((r) => {
      const m = (mm[r.mon] = mm[r.mon] || { key: r.mon, planned: 0, quota: 0, teams: [] });
      m.planned++;
    });
    PLAN = { rows, months: Object.values(mm).sort((a, b) => (a.key < b.key ? -1 : 1)) };
  } else
    PLAN = E.monthly2(
      rpCadastro(
        rpEtapas({
          paths,
          mode,
          start,
          quota: quota(),
          over: cfg.over,
          pins: cfg.pins,
          order: cfg.order,
          states: cfg.states,
          moves: cfg.moves || {},
          assign: asgFor(),
          force: cfg.force || {},
          mstates: cfg.mstates || {},
          semDesl: cfg.semdesl || [],
          estEntrega: !!cfg.estEntrega,
          dent: Object.fromEntries(D.units.filter((u) => u.de && !u.ok).map((u) => [u.id, u.de])),
          ddesp: Object.fromEntries(D.units.filter((u) => u.dd && !u.ok).map((u) => [u.id, u.dd])),
          quota: cfg.encaixar ? 0 : quota(),
        }),
      ),
    );
  PLAN.byId = {};
  PLAN.rows.forEach((r) => (PLAN.byId[r.id] = r));
  return PLAN;
}
/* ---------- mapa ---------- */
const _BB = (() => {
  if (D.estatico) return [-50.5, -34.2, -0.6, -24.6];
  const la = D.units.map((u) => u.la).concat([D.base.la]),
    lo = D.units.map((u) => u.lo).concat([D.base.lo]);
  let a0 = Math.max(...la),
    a1 = Math.min(...la),
    o0 = Math.min(...lo),
    o1 = Math.max(...lo);
  const mg = Math.max(0.1, (a0 - a1) * 0.12, (o1 - o0) * 0.08);
  a0 += mg;
  a1 -= mg;
  o0 -= mg;
  o1 += mg;
  if (a0 - a1 < 0.5) {
    const m = (a0 + a1) / 2;
    a0 = m + 0.25;
    a1 = m - 0.25;
  }
  const kc = Math.cos((((a0 + a1) / 2) * Math.PI) / 180),
    w = (o1 - o0) * kc,
    h = a0 - a1,
    R = 1.35;
  if (w / h < R) {
    const d = (R * h - w) / kc / 2;
    o0 -= d;
    o1 += d;
  } else {
    const d = (w / R - h) / 2;
    a0 += d;
    a1 -= d;
  }
  return [o0, o1, a0, a1];
})();
const LON0 = _BB[0],
  LON1 = _BB[1],
  LAT0 = _BB[2],
  LAT1 = _BB[3],
  KC = Math.cos(((D.estatico ? 12 : (LAT0 + LAT1) / 2) * Math.PI) / 180),
  SS = D.estatico ? 38 : Math.max(14, Math.min(400, 620 / (LAT0 - LAT1)));
// Projeção de Mercator (a mesma dos mapas de ruas): o desenho casa com as imagens do OpenStreetMap
const MERC = (la) => (-Math.log(Math.tan(Math.PI / 4 + (Math.max(-85, Math.min(85, la)) * Math.PI) / 360)) * 180) / Math.PI;
const SS2 = KC * SS,
  MY0 = MERC(LAT0);
const W = (LON1 - LON0) * SS2,
  H = (MERC(LAT1) - MY0) * SS2,
  px = (la, lo) => [(lo - LON0) * SS2, (MERC(la) - MY0) * SS2];
const COAST = [
  ...(D.estatico
    ? []
    : [
        [6.5, -58],
        [4.2, -51.6],
        [2.6, -50.8],
        [1.0, -49.9],
        [0.0, -50.1],
        [-0.3, -49.2],
        [-0.7, -48.5],
      ]),
  [-1.0, -48.7],
  [-1.45, -48.5],
  [-0.75, -47.9],
  [-0.62, -47.35],
  [-1.05, -46.77],
  [-1.25, -46.1],
  [-1.66, -45.37],
  [-1.83, -44.87],
  [-2.4, -44.41],
  [-2.53, -44.3],
  [-2.55, -44.05],
  [-2.45, -43.4],
  [-2.5, -42.8],
  [-2.7, -42.27],
  [-2.85, -41.65],
  [-2.9, -40.84],
  [-2.79, -40.51],
  [-2.88, -40.12],
  [-3.41, -39.03],
  [-3.72, -38.5],
  [-4.56, -37.77],
  [-4.95, -37.13],
  [-5.11, -36.63],
  [-5.2, -35.46],
  [-5.79, -35.2],
  [-6.5, -34.97],
  [-7.12, -34.82],
  [-8.05, -34.88],
  [-8.9, -35.15],
  [-9.67, -35.7],
  [-10.5, -36.4],
  [-10.92, -37.05],
  [-11.81, -37.61],
  [-12.97, -38.48],
  [-13.37, -38.95],
  [-14.28, -38.99],
  [-14.79, -39.03],
  [-15.67, -38.95],
  [-16.45, -39.06],
  [-17.34, -39.22],
  [-17.73, -39.26],
  [-18.09, -39.55],
  [-18.59, -39.73],
  [-19.65, -39.82],
  [-20.32, -40.29],
  [-20.67, -40.5],
  [-21.04, -40.83],
  [-21.64, -41.05],
  [-22.2, -41.45],
  [-22.88, -42.02],
  [-22.95, -43.17],
  [-23.0, -44.3],
  [-23.43, -45.07],
  [-23.96, -46.33],
  [-24.7, -47.55],
  [-24.6, -47.7],
];
const UFL = [
  ['MA', -5.0, -45.4],
  ['PI', -7.6, -42.6],
  ['CE', -5.1, -39.6],
  ['RN', -5.75, -36.7],
  ['PB', -7.25, -36.4],
  ['PE', -8.25, -37.9],
  ['AL', -9.45, -36.95],
  ['SE', -10.55, -37.45],
  ['BA', -12.6, -41.9],
  ['MG', -18.6, -44.8],
  ['ES', -19.5, -40.75],
  ['RJ', -22.2, -42.6],
  ['SP', -22.6, -48.6],
  ['DF', -15.45, -47.75],
  ['GO', -16.5, -49.6],
  ['TO', -10.2, -48.3],
  ['PA', -3.6, -49.8],
  ['AP', 1.4, -51.8],
  ['AM', -4.5, -63],
  ['RR', 2.1, -61.4],
  ['RO', -10.9, -63],
  ['AC', -9.2, -70.3],
  ['MT', -12.9, -55.9],
  ['MS', -20.5, -54.8],
  ['PR', -24.6, -51.6],
  ['SC', -27.2, -50.3],
  ['RS', -29.7, -53.2],
];
const HAS = [...new Set(D.units.map((u) => u.uf))].sort();
const NS = 'http://www.w3.org/2000/svg',
  el = (t, a, p) => {
    const e = document.createElementNS(NS, t);
    for (const x in a) e.setAttribute(x, a[x]);
    if (p) p.appendChild(e);
    return e;
  };
const svg = document.getElementById('map');
let vb = { x: 0, y: 0, w: W, h: H };
const setVB = () => {
  svg.setAttribute('viewBox', `${vb.x.toFixed(3)} ${vb.y.toFixed(3)} ${vb.w.toFixed(3)} ${vb.h.toFixed(3)}`);
  if (window.rpMapaBase) window.rpMapaBase();
};
setVB();
if (!D.estatico) svg.style.aspectRatio = (W / H).toFixed(3);
el('rect', { x: -W, y: -H, width: 3 * W, height: 3 * H, fill: 'var(--ocean)', class: 'esq' }, svg);
for (let lo = Math.ceil(LON0 / 5) * 5; lo <= LON1; lo += 5) {
  const [x] = px(0, lo);
  el('line', { x1: x, y1: 0, x2: x, y2: H, stroke: 'var(--grat)', 'stroke-width': 1, class: 'esq' }, svg);
}
for (let la = Math.floor(LAT0 / 5) * 5; la >= LAT1; la -= 5) {
  const [, y] = px(la, 0);
  el('line', { x1: 0, y1: y, x2: W, y2: y, stroke: 'var(--grat)', 'stroke-width': 1, class: 'esq' }, svg);
  el('text', { x: 4, y: y - 3, fill: 'var(--muted)', 'font-size': 10, 'font-family': 'Barlow,Arial', class: 'esq' }, svg).textContent = `${-la}°S`;
}
el(
  'polygon',
  {
    points: [[LAT0, LON0], ...COAST, [LAT1, LON0]]
      .map((p) =>
        px(p[0], p[1])
          .map((v) => v.toFixed(1))
          .join(','),
      )
      .join(' '),
    fill: 'var(--land)',
    stroke: 'var(--coast)',
    'stroke-width': 1.4,
    'stroke-linejoin': 'round',
    class: 'esq',
  },
  svg,
);
const gUF = el('g', { class: 'esq' }, svg),
  gB0 = el('g', {}, svg),
  gR = el('g', {}, svg),
  gK = el('g', {}, svg),
  gU = el('g', {}, svg),
  gN = el('g', {}, svg);
const [bx, by] = px((D.base && D.base.la) || -3.73, (D.base && D.base.lo) || -38.53);
const star = (cx, cy, r) => {
  let p = '';
  for (let i = 0; i < 10; i++) {
    const a = Math.PI / 2 + (i * Math.PI) / 5,
      rr = i % 2 ? r * 0.45 : r;
    p += `${(cx + rr * Math.cos(a)).toFixed(1)},${(cy - rr * Math.sin(a)).toFixed(1)} `;
  }
  return p;
};
el('polygon', { points: star(bx, by, 11), fill: 'var(--ink)', stroke: 'var(--panel)', 'stroke-width': 1.5 }, gB0);
el(
  'text',
  { x: bx + 13, y: by - 8, fill: 'var(--ink)', 'font-size': 13, 'font-weight': 700, 'font-family': '"Barlow Condensed",Arial' },
  gB0,
).textContent = RP_BASE.toUpperCase() + ' · BASE';
const tip = document.getElementById('tip'),
  box = document.getElementById('mapbox');
function showTip(target, html) {
  tip.hidden = false;
  tip.innerHTML = html;
  const r = box.getBoundingClientRect(),
    c = target.getBoundingClientRect();
  let L = c.left - r.left + 14,
    T = c.top - r.top - 6;
  if (L > r.width - 250) L = c.left - r.left - 240;
  tip.style.left = L + 'px';
  tip.style.top = T + 'px';
}
// zoom em torno de um ponto (o do mouse) ou do centro
function zoom(f, ux, uy) {
  const cx = ux ?? vb.x + vb.w / 2,
    cy = uy ?? vb.y + vb.h / 2;
  const w0 = vb.w;
  vb.w = Math.min(W * 1.2, Math.max(W / (window.RP_TILES ? 3000 : 8), vb.w * f));
  const r = vb.w / w0;
  vb.h = (vb.w * H) / W;
  vb.x = cx - (cx - vb.x) * r;
  vb.y = cy - (cy - vb.y) * r;
  setVB();
}
document.getElementById('z-in').onclick = () => zoom(0.7);
document.getElementById('z-out').onclick = () => zoom(1 / 0.7);
document.getElementById('z-0').onclick = () => {
  vb = { x: 0, y: 0, w: W, h: H };
  setVB();
};
let drag = null;
svg.addEventListener('pointerdown', (e) => {
  if (e.target.closest('.unit,.uf')) return;
  drag = { x: e.clientX, y: e.clientY, vx: vb.x, vy: vb.y };
  svg.setPointerCapture(e.pointerId);
});
svg.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const s = vb.w / svg.getBoundingClientRect().width;
  vb.x = drag.vx - (e.clientX - drag.x) * s;
  vb.y = drag.vy - (e.clientY - drag.y) * s;
  setVB();
});
svg.addEventListener('pointerup', () => (drag = null));
svg.addEventListener('pointercancel', () => (drag = null));
svg.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const m = svg.getScreenCTM();
    const pt = m ? new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse()) : null;
    zoom(e.deltaY < 0 ? 0.8 : 1 / 0.8, pt && pt.x, pt && pt.y);
  },
  { passive: false },
);
/* ---------- controles ---------- */
function seg(id, items, get, set) {
  const b0 = document.getElementById(id);
  b0.innerHTML = '';
  items.forEach(([v, l]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = l;
    b.setAttribute('aria-pressed', String(get() == v));
    b.onclick = () => {
      set(v);
      render();
    };
    b0.appendChild(b);
  });
}
const cD = document.getElementById('c-d'),
  mCap = document.getElementById('m-cap'),
  mQ = document.getElementById('m-q');
cD.value = start;
cD.addEventListener('change', (e) => {
  if (e.target.value) {
    start = e.target.value;
    save('d', start);
    month = undefined;
    render();
  }
});
mCap.addEventListener('change', () => {
  const v = Math.max(0.5, Math.min(30, parseFloat(String(mCap.value).replace(',', '.')) || 4.8));
  cfg.cap = Math.round(v * 100) / 100;
  saveCfg();
  render();
});
mQ.addEventListener('change', () => {
  const v = Math.max(1, Math.min(D.units.length, parseInt(mQ.value, 10) || 24));
  cfg.cap = Math.round((v / k) * 1000) / 1000;
  saveCfg();
  render();
});
document.getElementById('b-clr-uf').onclick = () => {
  if (sdEdit) {
    cfg.semdesl = [];
    saveCfg();
    render();
    return;
  }
  if (etapa) {
    if (month) setMonthStates([]);
    return;
  }
  setStates([]);
};
function setStates(a) {
  cfg.states = a;
  month = null;
  focus = null;
  saveCfg();
  render();
  fitSel();
}
function fitSel() {
  const ids = D.units.filter((u) => (cfg.states || []).includes(u.uf));
  if (!ids.length) {
    vb = { x: 0, y: 0, w: W, h: H };
    setVB();
    return;
  }
  const pts = ids.map((u) => px(u.la, u.lo));
  pts.push(px((D.base && D.base.la) || -3.73, (D.base && D.base.lo) || -38.53));
  let x0 = Math.min(...pts.map((p) => p[0])),
    x1 = Math.max(...pts.map((p) => p[0])),
    y0 = Math.min(...pts.map((p) => p[1])),
    y1 = Math.max(...pts.map((p) => p[1]));
  const pad = 40;
  x0 -= pad;
  y0 -= pad;
  x1 += pad;
  y1 += pad;
  let w = Math.max(x1 - x0, W / 6),
    h = Math.max(y1 - y0, H / 6);
  const ar = W / H;
  if (w / h > ar) h = w / ar;
  else w = h * ar;
  vb = { x: (x0 + x1) / 2 - w / 2, y: (y0 + y1) / 2 - h / 2, w, h };
  setVB();
}
let etapa = load('et', '0') === '1';
// Equipe e data de início do cadastro: com data, a instalação começa nesse dia (e no mês dela); só equipe, entra na região dessa equipe
function rpCadastro(o) {
  D.cadDias = cfg.eqc !== false;
  if (cfg.eqc === false) return o;
  const us = D.units.filter((u) => !u.ok && (u.tm || u.di));
  if (!us.length) return o;
  const force = {},
    pins = {},
    tfix = {},
    dfix = {},
    dfim = {};
  us.forEach((u) => {
    const t = u.tm && u.tm <= k ? u.tm : null;
    if (u.di) {
      const m = u.di.slice(0, 7);
      dfix[u.id] = u.di;
      if (u.df) dfim[u.id] = u.df;
      if (t) force[u.id] = { t, m };
      else pins[u.id] = m;
    } else if (t) tfix[u.id] = t;
  });
  const dated = us
    .filter((u) => u.di)
    .sort((a, b) => (a.di < b.di ? -1 : a.di > b.di ? 1 : 0))
    .map((u) => u.id);
  // meta dos meses com endereços do cadastro: mês de etapa = todos os endereços dele (etapa + data); outros meses = no mínimo os que têm data
  const ov = Object.assign({}, o.over || {}),
    uo = cfg.over || {},
    cnt = {},
    dc = {},
    m0 = String(o.start).slice(0, 7),
    em = {};
  if (cfg.etc)
    (D.etapas || []).forEach((e) => {
      if (e.inicio) em[e.id] = e.mes;
    });
  D.units.forEach((u) => {
    if (u.ok) return;
    let m = u.di ? u.di.slice(0, 7) : (u.et && em[u.et]) || null;
    if (!m) return;
    if (m < m0) m = m0;
    cnt[m] = (cnt[m] || 0) + 1;
    if (u.di) dc[m] = (dc[m] || 0) + 1;
  });
  Object.keys(cnt).forEach((m) => {
    if (uo[m] != null) return;
    if (o.over && o.over[m] != null) ov[m] = cnt[m];
    else if ((dc[m] || 0) > (+o.quota || 0)) ov[m] = dc[m];
  });
  return Object.assign({}, o, {
    over: ov,
    force: Object.assign({}, o.force || {}, force),
    pins: Object.assign({}, o.pins || {}, pins),
    tfix,
    dfix,
    dfim,
    order: dated.concat((o.order || []).filter((id) => !dfix[id])),
  });
}
// Atrasada: devia ter começado (início previsto passou e não está em execução) ou devia ter terminado a instalação
const RP_HOJE = E.parse(new Date().toLocaleDateString('sv'));
const PRE_EXEC = ['A iniciar', 'Configurado', 'Em transporte', 'Material entregue'];
function lateOf(r) {
  if (!r) return null;
  const s = stOf(r.id);
  if (s === 'Concluída') return null;
  if (PRE_EXEC.includes(s) && r.d0 < RP_HOJE) return 'início previsto ' + fs(r.d0);
  if (s === 'Em execução' && r.d1 < RP_HOJE) return 'fim previsto ' + fs(r.d1);
  return null;
}
const fdi = (s) => String(s).slice(0, 10).split('-').reverse().join('/');
async function rpApi(url, method, body) {
  const r = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  let d = null;
  try {
    d = await r.json();
  } catch (e) {}
  if (!r.ok) throw new Error((d && d.erro) || 'Erro ' + r.status);
  return d;
}
async function rpConcluir(id, data) {
  if (data === undefined || data === '') {
    toast('Informe a data de conclusão.');
    return;
  }
  try {
    await rpApi('/api/rota/' + window.RP_CLIENTE + '/conclusao/' + id, 'PUT', { data });
    toast(data ? 'Concluída: saiu da rota. Atualizando…' : 'De volta à rota. Atualizando…');
    setTimeout(() => location.reload(), 700);
  } catch (e) {
    toast('Não foi possível: ' + e.message);
  }
}
async function rpGravar() {
  if (!PLAN || !PLAN.rows.length) {
    toast('Plano vazio.');
    return;
  }
  if (
    !confirm(
      'Gravar no cadastro a equipe e a data de início de ' +
        PLAN.rows.length +
        ' endereço(s), conforme este plano (' +
        k +
        ' equipe(s))? Depois disso o plano passa a seguir essas datas.',
    )
  )
    return;
  try {
    const r = await rpApi('/api/rota/' + window.RP_CLIENTE + '/plano-cadastro', 'PUT', {
      equipes: k,
      itens: PLAN.rows.map((r) => ({ id: r.id, t: r.team, d: E.iso(r.d0) })),
    });
    toast(r.gravados + ' endereço(s) gravados no cadastro. Atualizando…');
    setTimeout(() => location.reload(), 900);
  } catch (e) {
    toast('Não foi possível gravar: ' + e.message);
  }
}
function openLate() {
  openOv(() => {
    const list = PLAN.rows.filter(lateOf).sort((a, b) => a.d0 - b.d0);
    ovb.innerHTML = `<header><h2 id="ov-t"><i class="dot" style="--sc:#D93F3F;width:14px;height:14px"></i>Atrasadas · ${list.length} agência${list.length === 1 ? '' : 's'}</h2><button type="button" class="x">Fechar</button></header>
  <p class="sub">Não concluídas que já deviam ter começado (início previsto passou e ainda não estão em execução) ou terminado a instalação. Hoje: ${fd(RP_HOJE)}.</p>
  ${
    list.length
      ? `<div class="tw" style="border:0"><table class="ag"><thead><tr><th>Agência</th><th>UF</th><th>Mês</th><th>Equipe</th><th>Instalação prevista</th><th>Atraso</th><th>Status</th><th></th></tr></thead><tbody>
  ${list
    .map((r) => {
      const u = U[r.id],
        x = selects(u, 'l');
      return `<tr><td>${esc(u.n)}<br><small>${esc(u.m)} · ${u.c} câm.</small></td><td>${u.uf}</td><td>${fm(r.mon)}</td><td>${r.team}</td><td>${fs(r.d0)}–${fs(r.d1)}</td><td class="lt">${lateOf(r)}</td><td>${x.st}</td><td><button type="button" class="iconbtn" data-det="${u.id}" aria-label="Detalhes">${DOC}</button></td></tr>`;
    })
    .join('')}</tbody></table></div>`
      : '<p class="empty">Nenhuma agência atrasada.</p>'
  }`;
    ovb.querySelector('.x').onclick = closeOv;
    wire(ovb);
  });
}
function openDone() {
  openOv(() => {
    const list = D.units.filter((u) => u.ok).sort((a, b) => (a.ok < b.ok ? 1 : -1));
    ovb.innerHTML = `<header><h2 id="ov-t"><i class="dot" style="--sc:var(--ok);width:14px;height:14px"></i>Concluídas fora da rota · ${list.length}</h2><button type="button" class="x">Fechar</button></header>
  <p class="sub">Agências com data de conclusão: não entram no plano. “Retornar” apaga a data e devolve a agência para a rota.</p>
  ${
    list.length
      ? `<div class="tw" style="border:0"><table class="ag"><thead><tr><th>Agência</th><th>UF</th><th>Câm.</th><th>Concluída em</th><th></th></tr></thead><tbody>
  ${list.map((u) => `<tr><td>${esc(u.n)}<br><small>${esc(u.m)}</small></td><td>${u.uf}</td><td>${u.c}</td><td><b>${fdi(u.ok)}</b></td><td><button type="button" class="act ghost sm" data-back="${u.id}">Retornar à rota</button></td></tr>`).join('')}</tbody></table></div>`
      : '<p class="empty">Nenhuma.</p>'
  }`;
    ovb.querySelector('.x').onclick = closeOv;
    ovb.querySelectorAll('[data-back]').forEach((b) => (b.onclick = () => rpConcluir(+b.dataset.back, null)));
  });
}
function rpPills(rows) {
  const nl = rows.filter(lateOf).length,
    nd = D.units.filter((u) => u.ok).length;
  return (
    (nl
      ? `<button type="button" class="pill late" data-k="late" style="--sc:#D93F3F"><i class="dot"></i>⚠ Atrasadas: <b>${nl}</b></button>`
      : '') +
    (nd
      ? `<button type="button" class="pill" data-k="ok" style="--sc:var(--ok)"><i class="dot"></i>✓ Concluídas fora da rota: <b>${nd}</b></button>`
      : '')
  );
}
// Etapas do cadastro: cada endereço vai para o mês da sua etapa, a partir da data de início, na ordem definida
function rpEtapas(o) {
  D.tempoAtiv = !!cfg.tat;
  if (!cfg.etc || !(D.etapas || []).length) return o;
  const em = {};
  D.etapas.forEach((e) => {
    if (e.inicio) em[e.id] = e;
  });
  const us = D.units.filter((u) => u.et && em[u.et]);
  const pins = {},
    over = {},
    mstart = {};
  us.forEach((u) => {
    const e = em[u.et];
    pins[u.id] = e.mes;
    over[e.mes] = (over[e.mes] || 0) + 1;
  });
  Object.values(em).forEach((e) => {
    const d = String(e.inicio).slice(0, 10);
    if (!mstart[e.mes] || d < mstart[e.mes]) mstart[e.mes] = d;
  });
  const ini = (e) => String(e.inicio).slice(0, 10);
  const ordem = us
    .filter((u) => u.eo)
    .sort((a, b) => (ini(em[a.et]) < ini(em[b.et]) ? -1 : ini(em[a.et]) > ini(em[b.et]) ? 1 : 0) || a.eo - b.eo)
    .map((u) => u.id);
  const first = Object.values(em).map(ini).sort()[0];
  const ord0 = o.order || [];
  return Object.assign({}, o, {
    pins: Object.assign(pins, o.pins || {}),
    over: Object.assign(over, o.over || {}),
    order: ord0.concat(ordem.filter((id) => !ord0.includes(id))),
    mstart,
    start: first || o.start,
  });
}
const fdm = (d) => {
  const p = String(d).slice(0, 10).split('-');
  return p[2] + '/' + p[1];
};
const etaLbl = (k) =>
  cfg.etc
    ? (D.etapas || [])
        .filter((e) => e.mes === k)
        .map((e) => '<small class="selc">' + esc(e.nome) + ' · início ' + fdm(e.inicio) + '</small>')
        .join('')
    : '';
function setMonthStates(a) {
  const m = Object.assign({}, cfg.mstates || {});
  if (a.length) m[month] = a;
  else delete m[month];
  cfg.mstates = m;
  saveCfg();
  render();
}
let sdEdit = false;
function toggleState(uf) {
  if (sdEdit) {
    const a = (cfg.semdesl || []).slice();
    const i = a.indexOf(uf);
    if (i >= 0) a.splice(i, 1);
    else a.push(uf);
    cfg.semdesl = a;
    saveCfg();
    render();
    return;
  }
  if (etapa) {
    if (!month) {
      toast('Escolha um mês abaixo para definir os estados dele.');
      return;
    }
    const a = ((cfg.mstates || {})[month] || []).slice();
    const i = a.indexOf(uf);
    if (i >= 0) a.splice(i, 1);
    else a.push(uf);
    setMonthStates(a);
    return;
  }
  const a = (cfg.states || []).slice();
  const i = a.indexOf(uf);
  if (i >= 0) a.splice(i, 1);
  else a.push(uf);
  setStates(a);
}
// agências dos estados escolhidos nas etapas que ainda ficaram para depois da última etapa configurada
function restInfo() {
  const P_ = PLAN;
  const conf = ((P_ && P_.months) || []).filter((m) => m.est && m.est.length);
  if (!conf.length) return { n: 0, ufs: [], last: null };
  const last = conf[conf.length - 1];
  const ufs = [...new Set(conf.flatMap((m) => m.est))];
  const ids = P_.rows.filter((r) => r.mon > last.key && ufs.includes(U[r.id].uf) && stOf(r.id) !== 'Concluída').map((r) => r.id);
  const uf2 = [...new Set(ids.map((id) => U[id].uf))];
  return { n: ids.length, ufs: uf2, last };
}
function mesRestante() {
  const ri = restInfo();
  if (!ri.n) {
    toast('Não há agências remanejadas dos estados escolhidos.');
    return;
  }
  const [y, mm] = ri.last.key.split('-').map(Number);
  const nx = new Date(Date.UTC(y, mm, 1)).toISOString().slice(0, 7);
  cfg.mstates = Object.assign({}, cfg.mstates || {}, { [nx]: ri.ufs });
  cfg.over = Object.assign({}, cfg.over || {}, { [nx]: ri.n });
  month = nx;
  saveCfg();
  render();
  toast('Mês ' + fm(nx) + ' criado com o restante: ' + ri.ufs.join(', '));
}
const bOrd = document.getElementById('b-ord'),
  bOrdS = document.getElementById('b-ord-save');
bOrd.onclick = () => {
  ordering = !ordering;
  if (ordering) draft = (cfg.order || []).slice();
  render();
};
bOrdS.onclick = () => {
  cfg.order = draft.slice();
  ordering = false;
  saveCfg();
  render();
};
document.getElementById('b-ord-clr').onclick = () => {
  draft = [];
  if (!ordering) {
    cfg.order = [];
    saveCfg();
  }
  render();
};
/* ---------- render ---------- */
function render() {
  seg(
    'c-st',
    [
      ['O', 'Otimizada'],
      ['E', 'Por estados'],
    ],
    () => st,
    (v) => {
      st = v;
      focus = null;
      save('st', v);
    },
  );
  seg(
    'c-k',
    [1, 2, 3, 4, 5, 6, 7, 8].map((i) => [i, String(i)]),
    () => k,
    (v) => {
      k = +v;
      focus = null;
      save('k', v);
    },
  );
  seg(
    'c-m',
    [
      ['A', 'A · Avião'],
      ['B', 'B · Leva equip.'],
      ['C', 'C · Estrada'],
    ],
    () => mode,
    (v) => {
      mode = v;
      save('m', v);
    },
  );
  seg(
    'c-pl',
    [
      ['M', 'Por meta mensal'],
      ['C', 'Contínuo'],
    ],
    () => plan,
    (v) => {
      plan = v;
      month = undefined;
      save('pl', v);
    },
  );
  document.getElementById('m-k').textContent = k;
  if (document.activeElement !== mCap) mCap.value = Math.round(cfg.cap * 10) / 10;
  if (document.activeElement !== mQ) mQ.value = quota();
  sel = new Set(cfg.states || []);
  const P_ = compute(),
    rows = P_.rows,
    S0 = E.parse(start);
  if (month === undefined) month = P_.months[0] ? P_.months[0].key : null;
  if (month && !P_.months.find((m) => m.key === month)) month = P_.months[0] ? P_.months[0].key : null;
  if (etapa) sel = new Set(month ? (cfg.mstates || {})[month] || [] : []);
  if (sdEdit) sel = new Set(cfg.semdesl || []);
  const fin = rows.reduce((m, r) => (r.d1 > m ? r.d1 : m), S0);
  // regras
  const rl = [];
  if (cfg.encaixar) rl.push('Meses pelo período: entram as agências que cabem, com deslocamento e instalação');
  if (cfg.estEntrega) rl.push('Sem data de entrega: estima o transporte do material');
  if ((cfg.semdesl || []).length) rl.push(`Sem deslocamento (avião ou parceiro local): <b>${cfg.semdesl.join(', ')}</b>`);
  if ((cfg.order || []).length) rl.push(`Ordem pelo mapa: <b>${cfg.order.length} agências</b>`);
  if ((cfg.states || []).length) rl.push(`Plano somente com os estados: <b>${cfg.states.join(', ')}</b>`);
  const no = Object.keys(cfg.over || {}).length,
    np = Object.keys(cfg.pins || {}).length;
  if (no)
    rl.push(`Metas próprias: <b>${no} mês(es)</b> <button type="button" class="act ghost sm" id="b-ov-clr">Usar meta padrão</button>`);
  if (np) rl.push(`Fixadas: <b>${np}</b>`);
  const nF = Object.keys(cfg.force || {}).length;
  if (nF)
    rl.push(`Vinculadas pela edição: <b>${nF}</b> <button type="button" class="act ghost sm" id="b-fo-clr">Desfazer vínculos</button>`);
  const am = asgFor();
  const nAm = Object.keys(am).length;
  if (nAm)
    rl.push(
      `Equipes montadas no mapa: <b>${Object.keys(am)
        .map((t) => `${t} (${am[t].length})`)
        .join(', ')}</b> <button type="button" class="act ghost sm" id="b-as-clr">Voltar todas ao automático</button>`,
    );
  const nmv = Object.keys(cfg.moves || {}).length;
  if (nmv) rl.push(`Movidas no mapa: <b>${nmv}</b> <button type="button" class="act ghost sm" id="b-mv-clr">Desfazer movimentos</button>`);
  if (np) {
    const i = rl.findIndex((x) => x.startsWith('Fixadas'));
    if (i >= 0) rl[i] += ` <button type="button" class="act ghost sm" id="b-pin-clr">Soltar fixadas</button>`;
  }
  document.getElementById('rules').innerHTML = rl.length ? rl.join(' · ') : 'Nenhuma — ordem padrão da estratégia';
  const bm = document.getElementById('b-mv-clr');
  if (bm)
    bm.onclick = () => {
      cfg.moves = {};
      saveCfg();
      toast('Movimentos desfeitos');
      render();
    };
  const bf = document.getElementById('b-fo-clr');
  if (bf)
    bf.onclick = () => {
      cfg.force = {};
      saveCfg();
      render();
    };
  const ba = document.getElementById('b-as-clr');
  if (ba)
    ba.onclick = () => {
      cfg.assign = {};
      saveCfg();
      render();
    };
  const bo = document.getElementById('b-ov-clr');
  if (bo)
    bo.onclick = () => {
      cfg.over = {};
      saveCfg();
      render();
    };
  const bp = document.getElementById('b-pin-clr');
  if (bp)
    bp.onclick = () => {
      cfg.pins = {};
      saveCfg();
      render();
    };
  // donut
  const mr = month ? rows.filter((r) => r.mon === month) : rows,
    done = mr.filter((r) => stOf(r.id) === 'Concluída').length,
    pend = mr.length - done,
    pct = mr.length ? Math.round((done * 100) / mr.length) : 0;
  const dn = document.getElementById('donut');
  const R = 46,
    C = 2 * Math.PI * R;
  dn.innerHTML = `<circle cx="60" cy="60" r="${R}" fill="none" stroke="var(--line)" stroke-width="14"/><circle cx="60" cy="60" r="${R}" fill="none" stroke="var(--ok)" stroke-width="14" stroke-dasharray="${((C * pct) / 100).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 60 60)" stroke-linecap="${pct ? 'round' : 'butt'}"/><text x="60" y="58" text-anchor="middle" font-family="Barlow Condensed,Arial" font-size="24" font-weight="700" fill="var(--ink)">${pct}%</text><text x="60" y="76" text-anchor="middle" font-family="Barlow,Arial" font-size="11" fill="var(--muted)">${done} / ${mr.length}</text>`;
  document.getElementById('d-leg').innerHTML =
    `<div><span><i class="dot" style="--sc:var(--ok)"></i>Concluídas</span><b>${done}</b></div><div><span><i class="dot" style="--sc:var(--line)"></i>Pendentes</span><b>${pend}</b></div>`;
  document.getElementById('d-hint').textContent = month
    ? `Total de agências planejadas em ${fm(month)}: ${mr.length}`
    : `Todos os meses: ${mr.length} agências`;
  // KPIs
  const inPlan = new Set(rows.map((r) => r.id));
  const scope = sel.size ? D.units.filter((u) => inPlan.has(u.id)) : D.units;
  const cnt = {};
  STATUS.forEach((s) => (cnt[s] = 0));
  scope.forEach((u) => cnt[stOf(u.id)]++);
  const lcnt = {};
  LIC.forEach((x) => (lcnt[x] = 0));
  scope.forEach((u) => lcnt[lcOf(u.id)]++);
  const kp = document.getElementById('kpis');
  kp.innerHTML = `<div class="kpi"><span class="lbl">Cenário</span><b>${st === 'O' ? 'Otimizada' : 'Por estados'} · ${k} equipe${k > 1 ? 's' : ''}</b></div>
   <div class="kpi"><span class="lbl">${MODES[mode]}</span><b>${wdCount(S0, fin)} dias úteis · ${P_.months.length} meses</b></div>
   <div class="kpi hi"><span class="lbl">Término previsto</span><b>${fd(fin)}</b></div>
   <div class="pills"><span class="lbl">Status das agências ${sel.size ? 'de ' + [...sel].join(', ') : '(todas)'} ${db ? '· compartilhado' : '· só neste navegador'} — clique no número para ver quais</span>
   <div class="stbar">${STATUS.map((x) => `<button type="button" class="pill" data-k="st" data-v="${x}" style="--sc:${SC[x]}"><i class="dot"></i>${x}: <b>${cnt[x]}</b></button>`).join('')}
   ${LIC.map((x) => `<button type="button" class="pill" data-k="lic" data-v="${x}" style="--sc:${LC[x]}"><i class="dot"></i>Licença ${x}: <b>${lcnt[x]}</b></button>`).join('')}${rpPills(rows)}</div></div>`;
  kp.querySelectorAll('.pill').forEach(
    (b) =>
      (b.onclick = () => (b.dataset.k === 'late' ? openLate() : b.dataset.k === 'ok' ? openDone() : openList(b.dataset.k, b.dataset.v))),
  );
  // estados com contador de pendentes
  const cu = document.getElementById('c-uf');
  cu.innerHTML = '';
  const all = document.createElement('button');
  all.type = 'button';
  all.className = 'ufb';
  all.textContent = 'Todos';
  all.setAttribute('aria-pressed', String(!sel.size));
  all.onclick = () => {
    if (sdEdit) {
      cfg.semdesl = [];
      saveCfg();
      render();
      return;
    }
    if (etapa) {
      if (month) setMonthStates([]);
      return;
    }
    setStates([]);
  };
  cu.appendChild(all);
  {
    const et = document.createElement('button');
    et.type = 'button';
    et.className = 'ufb etb' + (etapa ? ' on' : '');
    et.setAttribute('aria-pressed', String(etapa));
    et.title = 'Liga para escolher estados diferentes em cada mês';
    et.textContent = etapa ? 'Estados por mês: ligado' : 'Estados por mês: desligado';
    et.onclick = () => {
      etapa = !etapa;
      save('et', etapa ? '1' : '0');
      if (etapa && !month && PLAN.months[0]) month = PLAN.months[0].key;
      render();
    };
    cu.prepend(et);
    {
      const se = !!cfg.estEntrega;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ufb etb' + (se ? ' on' : '');
      b.setAttribute('aria-pressed', String(se));
      b.title =
        'Endereços sem data de entrega do material: só deslocamento e instalação, ou estimar o prazo de transporte. Com data de entrega, a instalação começa depois dela';
      b.textContent = se ? 'Sem data de entrega: estima transporte' : 'Sem data de entrega: só deslocamento e instalação';
      b.onclick = () => {
        cfg.estEntrega = !se;
        saveCfg();
        render();
      };
      cu.prepend(b);
    }
    {
      const en = !!cfg.encaixar;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ufb etb' + (en ? ' on' : '');
      b.setAttribute('aria-pressed', String(en));
      b.title =
        'Pelo período: cada mês recebe as agências que cabem nos dias úteis, contando deslocamento e instalação. Meta fixa: cada mês recebe a meta';
      b.textContent = en ? 'Meses: encaixar pelo período' : 'Meses: meta fixa';
      b.onclick = () => {
        cfg.encaixar = !en;
        saveCfg();
        render();
      };
      cu.prepend(b);
    }
    {
      const sd = cfg.semdesl || [];
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ufb etb' + (sdEdit || sd.length ? ' on' : '');
      b.setAttribute('aria-pressed', String(sdEdit));
      b.title = 'Estados atendidos por avião ou parceiro local: o tempo de deslocamento até as agências deles não conta no prazo';
      b.textContent = sdEdit
        ? 'Concluir: estados sem deslocamento'
        : sd.length
          ? 'Sem deslocamento: ' + sd.join(', ')
          : 'Estados sem deslocamento';
      b.onclick = () => {
        sdEdit = !sdEdit;
        if (sdEdit) {
          etapa = false;
          save('et', '0');
        }
        render();
      };
      cu.prepend(b);
      if (sdEdit) {
        const h = document.createElement('span');
        h.className = 'ethint';
        h.innerHTML =
          'Clique nos estados atendidos <b>por avião ou por parceiro local</b>: nas agências deles o tempo de deslocamento sai do prazo (a instalação começa direto). “Todos” limpa a seleção. Clique em <b>Concluir</b> para voltar.';
        cu.appendChild(h);
      }
    }
    if ((D.etapas || []).length) {
      const eb = document.createElement('button');
      eb.type = 'button';
      eb.className = 'ufb etb' + (cfg.etc ? ' on' : '');
      eb.setAttribute('aria-pressed', String(!!cfg.etc));
      const nU = D.units.filter((u) => u.et).length;
      eb.title = 'Usa as etapas cadastradas nos endereços: mês, data de início e ordem';
      eb.textContent = cfg.etc ? 'Etapas do cadastro: ligado' : 'Etapas do cadastro: desligado';
      eb.onclick = () => {
        cfg.etc = !cfg.etc;
        month = undefined;
        saveCfg();
        render();
      };
      cu.prepend(eb);
      if (cfg.etc) {
        const h = document.createElement('span');
        h.className = 'ethint';
        h.innerHTML =
          '<b>Etapas do cadastro ligadas:</b> ' +
          D.etapas
            .map((e) => esc(e.nome) + ' (' + fdm(e.inicio) + ', ' + D.units.filter((u) => u.et === e.id).length + ' end.)')
            .join(' · ') +
          '. Cada endereço entra no mês da sua etapa, a partir da data de início e na ordem definida. ' +
          (D.units.length - nU) +
          ' endereço(s) sem etapa seguem a meta normal depois.';
        cu.appendChild(h);
      }
    }
    {
      const tb = document.createElement('button');
      tb.type = 'button';
      tb.className = 'ufb etb' + (cfg.tat ? ' on' : '');
      tb.setAttribute('aria-pressed', String(!!cfg.tat));
      tb.title =
        'Dias de trabalho em cada endereço: pelas faixas de câmeras ou pela soma das atividades do contrato (soma / em paralelo / sem impacto)';
      tb.textContent = cfg.tat ? 'Dias: pelas atividades' : 'Dias: pelas faixas de câmeras';
      tb.onclick = () => {
        cfg.tat = !cfg.tat;
        saveCfg();
        render();
      };
      cu.prepend(tb);
    }
    {
      const gb = document.createElement('button');
      gb.type = 'button';
      gb.className = 'ufb etb';
      gb.title = 'Grava no cadastro dos endereços a equipe e a data de início deste plano';
      gb.textContent = 'Gravar equipes e datas no cadastro';
      gb.onclick = rpGravar;
      cu.prepend(gb);
      const nC = D.units.filter((u) => !u.ok && (u.tm || u.di)).length;
      if (nC) {
        const cb = document.createElement('button');
        cb.type = 'button';
        const on = cfg.eqc !== false;
        cb.className = 'ufb etb' + (on ? ' on' : '');
        cb.setAttribute('aria-pressed', String(on));
        cb.title = 'Usa a equipe e a data de início informadas no cadastro dos endereços';
        cb.textContent = on ? 'Equipes e datas do cadastro: ligado' : 'Equipes e datas do cadastro: desligado';
        cb.onclick = () => {
          cfg.eqc = !on;
          saveCfg();
          render();
        };
        cu.prepend(cb);
        if (on) {
          const nd = D.units.filter((u) => !u.ok && u.di).length,
            nt = D.units.filter((u) => !u.ok && u.tm).length,
            ac = D.units.filter((u) => !u.ok && u.tm > k).length;
          const h = document.createElement('span');
          h.className = 'ethint';
          h.innerHTML =
            '<b>Do cadastro:</b> ' +
            nt +
            ' endereço(s) com equipe e ' +
            nd +
            ' com data de início: entram na equipe e no dia informados.' +
            (ac
              ? ' <span class="warn">' +
                ac +
                ' estão em equipe acima de ' +
                k +
                ' e seguem o automático (o cadastro tem ' +
                (D.equipes || '?') +
                ' equipes).</span>'
              : '');
          cu.appendChild(h);
        }
      }
    }
    if (etapa) {
      const h = document.createElement('span');
      h.className = 'ethint';
      h.innerHTML = month
        ? 'Editando os estados de <b>' +
          fm(month) +
          '</b>: só agências desses estados entram neste mês, até a meta. O que passar fica para os meses seguintes. “Todos” = sem filtro neste mês.'
        : 'Escolha um mês abaixo para definir os estados dele.';
      cu.appendChild(h);
    }
  }
  HAS.forEach((uf) => {
    const p = D.units.filter((u) => u.uf === uf && stOf(u.id) !== 'Concluída').length;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ufb';
    b.innerHTML = `${uf}<span class="badge${p ? '' : ' zero'}" aria-label="${p} pendentes">${p}</span>`;
    b.setAttribute('aria-pressed', String(sel.has(uf)));
    b.title = `${uf}: ${p} agências pendentes`;
    b.onclick = () => toggleState(uf);
    cu.appendChild(b);
  });
  document.getElementById('b-clr-uf').hidden = !sel.size;
  // meses
  const cm = document.getElementById('c-mo');
  cm.innerHTML = '';
  const allM = document.createElement('button');
  allM.type = 'button';
  allM.className = 'mchip';
  allM.setAttribute('aria-pressed', String(!month));
  const dAll = rows.filter((r) => stOf(r.id) === 'Concluída').length;
  allM.innerHTML = `<b>Todos os meses</b><small>${rows.length - dAll} pendentes de ${rows.length} no plano</small>${dAll ? `<small class="ok">✓ ${dAll} concluída${dAll > 1 ? 's' : ''}</small>` : ''}`;
  allM.onclick = () => {
    month = null;
    render();
  };
  cm.appendChild(allM);
  P_.months.forEach((m) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'mchip';
    b.setAttribute('aria-pressed', String(month === m.key));
    const ov = (m.teams || []).some((t) => t.over);
    const sp = (m.teams || [])
      .filter((t) => t.n)
      .map((t) => t.n)
      .join('·');
    const selN = 0;
    const dN = rows.filter((r) => r.mon === m.key && stOf(r.id) === 'Concluída').length,
      pN = m.planned - dN;
    b.innerHTML = `<b>${fm(m.key)}</b><small>${plan === 'M' ? `${pN}${m.quota ? ' / ' + m.quota : ' no período'}${cfg.over && cfg.over[m.key] != null ? ' ✎' : ''}` : `${pN} pendentes`}</small>${dN ? `<small class="ok">✓ ${dN} concluída${dN > 1 ? 's' : ''}${pN ? '' : ' · mês fechado'}</small>` : ''}${sp ? `<small>${sp}</small>` : ''}${m.back ? `<small class="w">${m.back} remanejada${m.back > 1 ? 's' : ''} →</small>` : ''}${(m.teams || []).some((t) => t.over) ? '<small class="w">⚠ passa do mês</small>' : ''}${(() => {
      const nl = rows.filter((r) => r.mon === m.key && lateOf(r)).length;
      return nl ? `<small class="w late">⚠ ${nl} atrasada${nl > 1 ? 's' : ''}</small>` : '';
    })()}${etaLbl(m.key)}${m.est ? `<small class="selc">${m.est.join('+')}${m.rest ? ` · ${m.rest} p/ depois` : ''}</small>` : ''}`;
    b.onclick = () => {
      month = m.key;
      focus = null;
      render();
    };
    cm.appendChild(b);
  });
  if (etapa && plan === 'M') {
    const rN = restInfo().n;
    if (rN) {
      const nb = document.createElement('button');
      nb.type = 'button';
      nb.className = 'mchip mnew';
      nb.innerHTML = '<b>+ Mês para o restante</b><small>' + rN + ' agência(s) remanejada(s) dos estados escolhidos</small>';
      nb.onclick = mesRestante;
      cm.appendChild(nb);
    }
  }
  // ordem
  bOrd.classList.toggle('on', ordering);
  bOrd.setAttribute('aria-pressed', String(ordering));
  bOrd.textContent = ordering ? 'Clique nas agências no mapa…' : 'Definir ordem pelo mapa';
  bOrdS.hidden = !ordering;
  document.getElementById('ord-note').innerHTML = ordering
    ? `<b>${draft.length}</b> agência(s) na ordem — clique de novo para tirar`
    : (cfg.order || []).length
      ? `Regra ativa: <b>${cfg.order.length}</b> agências em ordem definida`
      : '';
  if (editTeam && editTeam > k) editTeam = null;
  drawTeamEdit();
  if (editTeam) drawEditMap();
  else drawMap(rows);
  drawSide(rows, P_);
  drawPdfBar();
}
function vis(r) {
  return (!month || r.mon === month) && (!focus || r.team === focus);
}
function drawMap(rows) {
  gUF.innerHTML = '';
  UFL.forEach(([s, la, lo]) => {
    const [x, y] = px(la, lo);
    const on = HAS.includes(s);
    const t = el(
      'text',
      {
        x,
        y,
        fill: sel.has(s) ? 'var(--accent)' : 'var(--coast)',
        'font-size': sel.has(s) ? 26 : 22,
        'font-weight': 700,
        'font-family': '"Barlow Condensed",Arial',
        'text-anchor': 'middle',
        'letter-spacing': '2',
        class: on ? 'uf' : '',
      },
      gUF,
    );
    t.textContent = s;
    if (on) {
      const p = D.units.filter((u) => u.uf === s && stOf(u.id) !== 'Concluída').length;
      el('circle', { cx: x + 18, cy: y - 18, r: 9, fill: p ? '#D93F3F' : 'var(--ok)' }, gUF);
      el(
        'text',
        {
          x: x + 18,
          y: y - 14.5,
          fill: '#fff',
          'font-size': 10,
          'font-weight': 700,
          'text-anchor': 'middle',
          'font-family': 'Barlow,Arial',
          'pointer-events': 'none',
        },
        gUF,
      ).textContent = p;
      t.setAttribute('tabindex', '0');
      t.setAttribute('role', 'button');
      t.setAttribute('aria-label', `Estado ${s}: ${p} pendentes`);
      const go = () => toggleState(s);
      t.addEventListener('click', go);
      t.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') go();
      });
    }
  });
  gR.innerHTML = '';
  gK.innerHTML = '';
  gU.innerHTML = '';
  gN.innerHTML = '';
  const g = {};
  rows.forEach((r) => {
    const key = r.team + '|' + r.mon + '|' + (plan === 'C' ? '' : 'm');
    (g[key] = g[key] || []).push(r);
  });
  Object.values(g).forEach((a) => {
    a.sort((x, y) => x.seq - y.seq);
    const t = a[0].team,
      on = a.some(vis) && (!sel.size || month || a.some((r) => sel.has(U[r.id].uf)));
    const pts = a.map((r) => px(U[r.id].la, U[r.id].lo));
    if (on || (!sel.size && !month))
      el(
        'line',
        {
          x1: bx,
          y1: by,
          x2: pts[0][0],
          y2: pts[0][1],
          stroke: tc(t),
          'stroke-width': 1.3,
          'stroke-dasharray': '5 5',
          opacity: on ? 0.6 : 0.05,
        },
        gR,
      );
    el(
      'polyline',
      {
        points: pts.map((q) => q.map((v) => v.toFixed(1)).join(',')).join(' '),
        fill: 'none',
        stroke: tc(t),
        'stroke-width': focus === t ? 3.6 : 2.6,
        'stroke-linejoin': 'round',
        'stroke-linecap': 'round',
        opacity: on ? 0.95 : sel.size || month ? 0.04 : 0.07,
      },
      gR,
    );
    if (on && (focus === t || month))
      a.forEach((r, i) => {
        if (i === 0) return;
        const p0 = pts[i - 1],
          p1 = pts[i];
        if (Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) < 46) return;
        const mx = (p0[0] + p1[0]) / 2,
          my = (p0[1] + p1[1]) / 2;
        const gg = el('g', {}, gK);
        const txt = `${r.km} km`;
        const w = txt.length * 5.6 + 8;
        el('rect', { x: mx - w / 2, y: my - 8, width: w, height: 15, rx: 3, fill: 'var(--panel)', stroke: tc(t), 'stroke-width': 1 }, gg);
        el(
          'text',
          {
            x: mx,
            y: my + 3.5,
            fill: 'var(--ink)',
            'font-size': 10,
            'font-weight': 600,
            'text-anchor': 'middle',
            'font-family': 'Barlow,Arial',
          },
          gg,
        ).textContent = txt;
      });
  });
  const planned = new Set(rows.map((r) => r.id));
  D.units.forEach((u) => {
    if (planned.has(u.id)) return;
    const [x, y] = px(u.la, u.lo);
    el(
      'circle',
      { cx: x, cy: y, r: u.ok ? 4 : 3, fill: u.ok ? 'var(--ok)' : 'var(--muted)', opacity: u.ok ? 0.55 : 0.25, 'pointer-events': 'none' },
      gU,
    );
  });
  const ordIdx = {};
  (ordering ? draft : cfg.order || []).forEach((id, i) => (ordIdx[id] = i + 1));
  rows.forEach((r) => {
    const u = U[r.id],
      on = vis(r) || ordering,
      [x, y] = px(u.la, u.lo),
      s = stOf(u.id);
    const hiSel = sel.size && sel.has(u.uf);
    if (hiSel)
      el(
        'circle',
        {
          cx: x,
          cy: y,
          r: 7.5 + Math.sqrt(u.c) * 0.85,
          fill: 'none',
          stroke: 'var(--accent)',
          'stroke-width': 2.2,
          opacity: on ? 0.95 : 0.35,
          'pointer-events': 'none',
        },
        gU,
      );
    const lt = lateOf(r);
    if (lt)
      el(
        'circle',
        {
          cx: x,
          cy: y,
          r: 7.5 + Math.sqrt(u.c) * 0.85,
          fill: 'none',
          stroke: '#D93F3F',
          'stroke-width': 2.4,
          'stroke-dasharray': '3 2',
          opacity: on ? 1 : 0.35,
          'pointer-events': 'none',
        },
        gU,
      );
    if (u.aprox)
      el(
        'circle',
        {
          cx: x,
          cy: y,
          r: 9.5 + Math.sqrt(u.c) * 0.85,
          fill: 'none',
          stroke: 'var(--warn)',
          'stroke-width': 1.3,
          'stroke-dasharray': '2 2',
          opacity: on ? 0.9 : 0.3,
          'pointer-events': 'none',
        },
        gU,
      );
    const c = el(
      'circle',
      {
        cx: x,
        cy: y,
        r: (hiSel ? 4.6 : 3.4) + Math.sqrt(u.c) * 0.85,
        fill: s === 'Concluída' ? 'var(--ok)' : tc(r.team),
        stroke: s === 'A iniciar' ? 'var(--panel)' : SC[s],
        'stroke-width': s === 'A iniciar' ? 1.3 : 3,
        opacity: on ? 1 : sel.size ? 0.12 : 0.15,
        class: 'unit',
        tabindex: on ? 0 : -1,
        role: 'button',
        'aria-label': u.n,
      },
      gU,
    );
    const h = () =>
      showTip(
        c,
        `<b>${esc(u.n)}</b><br>${esc(u.m)} – ${u.uf} · ${u.c} câmeras<br>${fm(r.mon)} · Equipe ${r.team}, parada ${r.seq}<br>${r.semData ? 'Sem data de entrega' : 'Material entregue ' + fs(r.deliv)} · instalação ${fs(r.d0)}<br>${s} · Licença ${lcOf(u.id)}${u.aprox ? '<br><i>Localização aproximada (centro do município)</i>' : ''}${u.ml ? '<br>' + RP_ML[u.ml] : ''}${lt ? '<br><b style="color:#D93F3F">⚠ Atrasada: ' + lt + '</b>' : ''}${ordering ? '<br><b>Clique para incluir na ordem</b>' : ''}`,
      );
    c.addEventListener('mouseenter', h);
    c.addEventListener('focus', h);
    c.addEventListener('mouseleave', () => (tip.hidden = true));
    c.addEventListener('blur', () => (tip.hidden = true));
    c.setAttribute('data-id', u.id);
    const act = () => {
      if (ordering) {
        const i = draft.indexOf(u.id);
        if (i >= 0) draft.splice(i, 1);
        else draft.push(u.id);
        render();
        return;
      }
      focus = focus === r.team ? null : r.team;
      openT = new Set([r.team]);
      render();
    };
    c.addEventListener('pointerdown', (e) => startDrag(e, u.id, x, y, act));
    c.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') act();
    });
    if (ordIdx[u.id]) {
      el(
        'circle',
        { cx: x + 9, cy: y - 9, r: 8, fill: 'var(--accent)', stroke: 'var(--panel)', 'stroke-width': 1.5, 'pointer-events': 'none' },
        gN,
      );
      el(
        'text',
        {
          x: x + 9,
          y: y - 5.5,
          fill: 'var(--onacc)',
          'font-size': 9.5,
          'font-weight': 700,
          'text-anchor': 'middle',
          'font-family': 'Barlow,Arial',
          'pointer-events': 'none',
        },
        gN,
      ).textContent = ordIdx[u.id];
    } else if (on && (focus === r.team || month) && !ordering)
      el(
        'text',
        {
          x,
          y: y + 3.5,
          fill: 'var(--panel)',
          'font-size': 9.5,
          'font-weight': 700,
          'text-anchor': 'middle',
          'font-family': 'Barlow,Arial',
          'pointer-events': 'none',
        },
        gN,
      ).textContent = r.seq;
  });
}
const DOC =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/></svg>';
function selects(u, pre) {
  const s = stOf(u.id),
    l = lcOf(u.id);
  return {
    st: `<select class="st" id="${pre}st-${u.id}" data-id="${u.id}" style="--sc:${SC[s]}" aria-label="Status de ${esc(u.n)}">${STATUS.map((x) => `<option${x === s ? ' selected' : ''}>${x}</option>`).join('')}</select>`,
    lic: `<select class="lic" id="${pre}lc-${u.id}" data-id="${u.id}" style="--sc:${LC[l]}" aria-label="Licença de ${esc(u.n)}">${LIC.map((x) => `<option${x === l ? ' selected' : ''}>${x}</option>`).join('')}</select>`,
    pat: `<input class="pat" id="${pre}pa-${u.id}" data-id="${u.id}" value="${esc(pat[u.id] || '')}" placeholder="Nº patrimônio" aria-label="Patrimônio do servidor de ${esc(u.n)}">`,
  };
}
function drawSide(rows, P_) {
  const side = document.getElementById('side');
  side.innerHTML = '';
  const cur = rows.filter((r) => !month || r.mon === month);
  const mi = month ? P_.months.find((m) => m.key === month) : null;
  const hd = document.createElement('div');
  hd.className = 'card mhead';
  const cams = cur.reduce((s, r) => s + U[r.id].c, 0),
    km = cur.reduce((s, r) => s + r.km, 0),
    teams = [...new Set(cur.map((r) => r.team))].sort((a, b) => a - b);
  const d0 = cur.length ? cur.reduce((m, r) => (r.d0 < m ? r.d0 : m), cur[0].d0) : null,
    d1 = cur.length ? cur.reduce((m, r) => (r.d1 > m ? r.d1 : m), cur[0].d1) : null;
  let h = `<span class="lbl">${month ? 'Plano do mês' : 'Plano completo'}${sel.size ? ' · ' + [...sel].join(', ') : ''}</span><h2>${month ? fm(month) : 'Todos os meses'}</h2>
   <div class="row"><div>Agências<b>${cur.length}</b></div><div>Pendentes<b>${cur.filter((r) => stOf(r.id) !== 'Concluída').length}</b></div><div>Concluídas<b style="color:var(--s-con)">${cur.filter((r) => stOf(r.id) === 'Concluída').length}</b></div><div>Câmeras<b>${cams.toLocaleString('pt-BR')}</b></div><div>Equipes<b>${teams.join(', ') || '—'}</b></div><div>Km rodados<b>${km.toLocaleString('pt-BR')}</b></div><div>Primeira instalação<b>${d0 ? fd(d0) : '—'}</b></div><div>Último término<b>${d1 ? fd(d1) : '—'}</b></div></div>`;
  if (sel.size) {
    const dist = P_.months.map((m) => [m.key, rows.filter((r) => r.mon === m.key).length]).filter((x) => x[1]);
    if (!etapa && sel.size)
      h += `<p class="hint">Plano somente com <b>${[...sel].join(', ')}</b>${Object.keys(asgFor()).length ? ' + agências escolhidas no mapa' : ''}: ${rows.length} agências, meta de ${quota()} por mês, distribuídas em ${dist.length} mês(es) — ${dist.map(([k2, n]) => `${fm(k2)}: <b>${n}</b>`).join(' · ')}. As mais próximas entram primeiro; o que passa da meta vai para o mês seguinte. As demais agências ficam fora até limpar a seleção.</p>`;
  }
  if (mi && plan === 'M' && !mi.quota)
    h += `<p class="hint">Encaixe pelo período: entram no mês as agências que cabem nos dias úteis, contando deslocamento e instalação. O restante vai para o mês seguinte.</p>`;
  if (mi && plan === 'M' && mi.quota) {
    const own = cfg.over && cfg.over[month] != null;
    const ovT = (mi.teams || []).filter((t) => t.over).map((t) => t.team);
    h += `<div class="row" style="align-items:flex-end"><div><label for="mq">Meta deste mês</label><b><input class="num" type="number" id="mq" min="0" max="${D.units.length}" value="${mi.quota}"></b></div>
     <div>Planejadas<b>${mi.planned} / ${mi.quota}</b></div>
     <div>Divisão por equipe<b>${(mi.teams || []).map((t) => t.n).join(' · ')}</b></div>
     ${own ? '<div><button type="button" class="act ghost" id="mq-reset">Usar meta padrão</button></div>' : ''}</div>
     <p class="hint">Meta exata: o mês recebe sempre <b>${mi.quota}</b> agências, divididas igualmente entre as equipes; agências vinculadas ou excluídas não mudam o total (a fila automática compensa). ${
       (mi.teams || []).some((t) => t.over)
         ? `<span class="warn">⚠ Equipe ${(mi.teams || [])
             .filter((t) => t.over)
             .map((t) => t.team)
             .join(', ')}: a agenda passa do último dia útil de ${fm(month)}.</span>`
         : 'Tudo cabe nos dias úteis do mês.'
     }</p>`;
  }
  hd.innerHTML = h;
  side.appendChild(hd);
  const mq = hd.querySelector('#mq');
  if (mq)
    mq.addEventListener('change', () => {
      const v = Math.max(0, Math.min(D.units.length, parseInt(mq.value || '0', 10) || 0));
      cfg.over = Object.assign({}, cfg.over, { [month]: v });
      saveCfg();
      render();
    });
  const rs = hd.querySelector('#mq-reset');
  if (rs)
    rs.onclick = () => {
      const o = Object.assign({}, cfg.over);
      delete o[month];
      cfg.over = o;
      saveCfg();
      render();
    };
  if (!cur.length) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = 'Nenhuma agência neste filtro.';
    side.appendChild(p);
    return;
  }
  teams.forEach((t) => {
    const tr = cur.filter((r) => r.team === t).sort((a, b) => a.d0 - b.d0 || a.seq - b.seq);
    const ufs = [...new Set(tr.map((r) => U[r.id].uf))].join(', ');
    const det = document.createElement('details');
    det.className = 'team';
    det.style.setProperty('--c', tc(t));
    if (openT.has(t) || focus === t) det.open = true;
    const nm = [...new Set(rows.filter((r) => r.team === t).map((r) => r.mon))].length;
    const isMan = !!asgFor()[t];
    det.innerHTML = `<summary><div><h3>Equipe ${t}${isMan ? '<span class="tagm">montada no mapa</span>' : ''} <button type="button" class="editlink" data-agedit="${t}">Editar agências</button> <button type="button" class="editlink" data-edit="${t}">Editar no mapa</button></h3><div class="meta2"><span><b>${tr.length}</b> agências</span><span><b>${tr.reduce((s, r) => s + U[r.id].c, 0)}</b> câmeras</span><span><b>${tr.reduce((s, r) => s + r.km, 0).toLocaleString('pt-BR')}</b> km</span><span>${month ? '' : `<b>${nm}</b> viagens · `}${ufs}</span></div></div>
      <div style="display:flex;align-items:center;gap:10px"><span class="meta2 dates"><b>${fs(tr[0].d0)} – ${fs(tr[tr.length - 1].d1)}</b></span><svg class="chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg></div></summary>
      <div class="tw"><table class="ag"><thead><tr><th title="Posição na rota da equipe no mês">Parada</th><th>Agência</th><th>UF</th>${month ? '' : '<th>Mês</th>'}<th>Material · Instalação</th><th>Licença</th><th>Patrimônio servidor</th><th>Câm.</th><th>Status</th><th>Ações</th></tr></thead><tbody>
      ${tr
        .map((r, ri) => {
          const u = U[r.id],
            s = stOf(u.id),
            x = selects(u, 't');
          const mh =
            !month && (ri === 0 || tr[ri - 1].mon !== r.mon)
              ? `<tr class="msep"><td colspan="11">${fm(r.mon)} · ${tr.filter((z) => z.mon === r.mon).length} agência(s) · saída de ${RP_BASE}</td></tr>`
              : '';
          const cls = s === 'Concluída' ? 'done' : s !== 'A iniciar' ? 'started' : '';
          const oi = (cfg.order || []).indexOf(u.id);
          return (
            mh +
            `<tr class="${cls}"><td class="n">${r.seq}</td><td class="agn">${esc(u.n)}${oi >= 0 ? `<span class="ord" title="Ordem definida no mapa">${oi + 1}</span>` : ''}${r.moved ? '<span class="ord mv" title="Movida no mapa">movida</span>' : ''}${lateOf(r) ? '<span class="ord late" title="' + lateOf(r) + '">atrasada</span>' : ''}${r.ml === 'aviao' ? '<span class="ord cad" title="Deslocamento zerado">avião</span>' : r.lv ? '<span class="ord cad" title="Equipamento vai com o técnico">c/ técnico</span>' : ''}<br><small>${esc(u.m)} · ${r.km.toLocaleString('pt-BR')} km da ${r.ret ? 'base' : 'anterior'}</small></td><td>${u.uf}</td>${month ? '' : `<td>${fm(r.mon)}</td>`}
        <td class="dates"><small>Entrega</small> ${mode === 'B' ? 'c/ técnico' : r.semData ? '—' : fs(r.deliv)}<br><small>Instal.</small> ${fs(r.d0)}–${fs(r.d1)}</td><td>${x.lic}</td><td>${x.pat}</td><td>${u.c}</td><td>${x.st}</td><td><button type="button" class="iconbtn" data-det="${u.id}" aria-label="Detalhes de ${esc(u.n)}">${DOC}</button></td></tr>`
          );
        })
        .join('')}
      </tbody></table></div>`;
    det.addEventListener('toggle', () => {
      if (det.open) openT.add(t);
      else openT.delete(t);
    });
    const ae = det.querySelector('[data-agedit]');
    ae.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openTeamEditor(t);
    });
    const eb = det.querySelector('[data-edit]');
    eb.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      editTeam = t;
      ordering = false;
      render();
      vb = { x: 0, y: 0, w: W, h: H };
      setVB();
      document.getElementById('mapbox').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    wire(det);
    side.appendChild(det);
  });
}
function wire(root) {
  root.querySelectorAll('select.st').forEach((sl) => sl.addEventListener('change', () => setDoc('st', +sl.dataset.id, sl.value)));
  root.querySelectorAll('select.lic').forEach((sl) => sl.addEventListener('change', () => setDoc('lic', +sl.dataset.id, sl.value)));
  root
    .querySelectorAll('input.pat')
    .forEach((inp) => inp.addEventListener('change', () => setDoc('pat', +inp.dataset.id, inp.value.trim().slice(0, 40))));
  root.querySelectorAll('[data-det]').forEach((b) => (b.onclick = () => openDetail(+b.dataset.det)));
}

/* ---------- montar equipe no mapa ---------- */
function asgFor() {
  const o = {};
  Object.keys(cfg.assign || {}).forEach((t) => {
    if (+t <= k && Array.isArray(cfg.assign[t])) o[t] = cfg.assign[t];
  });
  return o;
}
function ownerOf(id) {
  const A = asgFor();
  for (const t of Object.keys(A)) if (A[t].map(Number).includes(id)) return +t;
  return null;
}
function editMonth() {
  return month || (PLAN && PLAN.months[0] ? PLAN.months[0].key : null);
}
function setAssign(t, list) {
  const A = Object.assign({}, cfg.assign || {});
  const old = (A[t] || []).map(Number);
  const P = Object.assign({}, cfg.pins || {});
  old.forEach((id) => {
    if (!list || !list.includes(id)) delete P[id];
  });
  if (list === null) delete A[t];
  else {
    A[t] = list;
    const em = editMonth();
    list.forEach((id) => {
      if (!P[id] && em) P[id] = em;
    });
  }
  cfg.assign = A;
  cfg.pins = P;
  saveCfg();
  render();
}
function toggleAssign(id) {
  const own = ownerOf(id);
  if (own && own !== editTeam) {
    toast(`${U[id].n} já está na Equipe ${own}. Retire de lá primeiro.`);
    return;
  }
  const cur = (asgFor()[editTeam] || []).map(Number);
  const i = cur.indexOf(id);
  const em = editMonth();
  if (i >= 0) {
    cur.splice(i, 1);
    setAssign(editTeam, cur);
    toast(`${U[id].n} retirada da Equipe ${editTeam}.`);
  } else {
    cur.push(id);
    setAssign(editTeam, cur);
    const r = PLAN.byId[id];
    toast(`${U[id].n} (${U[id].uf}) adicionada à Equipe ${editTeam}${em ? ' em ' + fm(em) : ''}${r ? ` · instalação ${fs(r.d0)}` : ''}.`);
  }
}
function drawTeamEdit() {
  const box_ = document.getElementById('teamedit');
  const A = asgFor();
  let h = `<div class="frow"><span class="lbl">Montar equipe no mapa</span>${[...Array(k).keys()]
    .map((i) => {
      const t = i + 1,
        m = A[t];
      return `<button type="button" class="tchip" data-t="${t}" style="--c:${tc(t)}" aria-pressed="${editTeam === t}"><i></i>Equipe ${t}${m ? `<span class="m">${m.length} manual</span>` : ''}</button>`;
    })
    .join('')}</div>`;
  if (editTeam) {
    const m = A[editTeam];
    const n = m ? m.length : 0;
    const em = editMonth();
    const lst = (m || []).map(Number);
    h += `<div class="editbar" style="--c:${tc(editTeam)}"><span>Editando <b>Equipe ${editTeam}</b>${em ? ` para <b>${fm(em)}</b>` : ''} — ${m ? `<b>${n}</b> agência(s) escolhida(s). Clique nas agências do mapa para incluir ou retirar. Todas entram em ${em ? fm(em) : 'no mês'} (as outras equipes completam a meta).` : 'automática. Clique em <b>Limpar agências</b> e depois nas agências do mapa.'}</span>
     ${lst.length ? `<span class="chosen">${lst.map((id) => `<button type="button" class="chip-x" data-x="${id}" title="Retirar">${esc(U[id].n)} · ${U[id].uf} ✕</button>`).join('')}</span>` : ''}
     <button type="button" class="act danger" id="te-clr">Limpar agências</button>${m ? '<button type="button" class="act ghost" id="te-auto">Voltar ao automático</button>' : ''}<button type="button" class="act" id="te-ok">Concluir</button></div>`;
  }
  box_.innerHTML = h;
  box_.querySelectorAll('.tchip').forEach(
    (b) =>
      (b.onclick = () => {
        const t = +b.dataset.t;
        editTeam = editTeam === t ? null : t;
        ordering = false;
        render();
        if (editTeam) {
          vb = { x: 0, y: 0, w: W, h: H };
          setVB();
        }
      }),
  );
  const c1 = document.getElementById('te-clr');
  if (c1)
    c1.onclick = () => {
      setAssign(editTeam, []);
      toast(`Equipe ${editTeam} sem agências. Clique no mapa para escolher.`);
    };
  const c2 = document.getElementById('te-auto');
  if (c2)
    c2.onclick = () => {
      setAssign(editTeam, null);
      toast(`Equipe ${editTeam} voltou ao automático.`);
    };
  const c3 = document.getElementById('te-ok');
  if (c3)
    c3.onclick = () => {
      editTeam = null;
      render();
    };
  box_.querySelectorAll('[data-x]').forEach((b) => (b.onclick = () => toggleAssign(+b.dataset.x)));
  document.getElementById('ordbar').hidden = !!editTeam;
}
function drawEditMap() {
  gR.innerHTML = '';
  gK.innerHTML = '';
  gU.innerHTML = '';
  gN.innerHTML = '';
  const A = asgFor();
  const mine = (A[editTeam] || []).map(Number);
  const tr = PLAN.rows.filter((r) => r.team === editTeam).sort((a, b) => a.d0 - b.d0 || a.seq - b.seq);
  const byMon = {};
  tr.forEach((r) => (byMon[r.mon] = byMon[r.mon] || []).push(r));
  Object.values(byMon).forEach((g) => {
    const pts = g.map((r) => px(U[r.id].la, U[r.id].lo));
    el(
      'line',
      { x1: bx, y1: by, x2: pts[0][0], y2: pts[0][1], stroke: tc(editTeam), 'stroke-width': 1.3, 'stroke-dasharray': '5 5', opacity: 0.6 },
      gR,
    );
    el(
      'polyline',
      {
        points: pts.map((q) => q.map((v) => v.toFixed(1)).join(',')).join(' '),
        fill: 'none',
        stroke: tc(editTeam),
        'stroke-width': 3,
        'stroke-linejoin': 'round',
        opacity: 0.9,
      },
      gR,
    );
  });
  D.units.forEach((u) => {
    const [x, y] = px(u.la, u.lo);
    const own = ownerOf(u.id);
    const inMine = mine.includes(u.id);
    const locked = own && own !== editTeam;
    const r = PLAN.byId[u.id];
    if (inMine)
      el(
        'circle',
        { cx: x, cy: y, r: 8 + Math.sqrt(u.c) * 0.85, fill: 'none', stroke: tc(editTeam), 'stroke-width': 2.5, 'pointer-events': 'none' },
        gU,
      );
    const c = el(
      'circle',
      {
        cx: x,
        cy: y,
        r: 4 + Math.sqrt(u.c) * 0.85,
        fill: inMine ? tc(editTeam) : locked ? tc(own) : r && r.team === editTeam ? tc(editTeam) : 'var(--muted)',
        opacity: inMine ? 1 : locked ? 0.3 : 0.75,
        stroke: 'var(--panel)',
        'stroke-width': 1.2,
        class: 'unit',
        tabindex: locked ? -1 : 0,
        role: 'button',
        'aria-label': u.n,
        'aria-pressed': String(inMine),
      },
      gU,
    );
    c.style.cursor = locked ? 'not-allowed' : 'pointer';
    const h = () =>
      showTip(
        c,
        `<b>${esc(u.n)}</b><br>${esc(u.m)} – ${u.uf} · ${u.c} câmeras<br>${inMine ? `Na Equipe ${editTeam} — clique para retirar` : locked ? `Bloqueada: já está na Equipe ${own}` : `Clique para incluir na Equipe ${editTeam}`}${r ? `<br>Hoje: ${fm(r.mon)} · Equipe ${r.team}` : '<br>Fora do plano atual'}`,
      );
    c.addEventListener('mouseenter', h);
    c.addEventListener('focus', h);
    c.addEventListener('mouseleave', () => (tip.hidden = true));
    c.addEventListener('blur', () => (tip.hidden = true));
    const go = () => {
      tip.hidden = true;
      toggleAssign(u.id);
    };
    c.addEventListener('click', go);
    c.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        go();
      }
    });
    if (inMine) {
      const r2 = PLAN.byId[u.id];
      if (r2)
        el(
          'text',
          {
            x,
            y: y + 3.5,
            fill: 'var(--on-sc)',
            'font-size': 9.5,
            'font-weight': 700,
            'text-anchor': 'middle',
            'font-family': 'Barlow,Arial',
            'pointer-events': 'none',
          },
          gN,
        ).textContent = r2.seq;
    }
  });
}
/* ---------- arrastar agência no mapa ---------- */
let dg = null;
function svgPt(e) {
  const p = svg.createSVGPoint();
  p.x = e.clientX;
  p.y = e.clientY;
  return p.matrixTransform(svg.getScreenCTM().inverse());
}
function startDrag(e, id, x, y, act) {
  e.preventDefault();
  e.stopPropagation();
  tip.hidden = true;
  dg = { id, x, y, cx: e.clientX, cy: e.clientY, act, on: false, ghost: null, line: null, target: null };
  window.addEventListener('pointermove', moveDrag);
  window.addEventListener('pointerup', endDrag, { once: true });
}
function moveDrag(e) {
  if (!dg) return;
  if (!dg.on) {
    if (Math.hypot(e.clientX - dg.cx, e.clientY - dg.cy) < 16) return;
    if (ordering || plan !== 'M') {
      return;
    }
    dg.on = true;
    dg.line = el(
      'line',
      {
        x1: dg.x,
        y1: dg.y,
        x2: dg.x,
        y2: dg.y,
        stroke: 'var(--ink)',
        'stroke-width': 1.5,
        'stroke-dasharray': '4 4',
        'pointer-events': 'none',
      },
      gN,
    );
    dg.ghost = el(
      'circle',
      {
        cx: dg.x,
        cy: dg.y,
        r: 9,
        fill: 'var(--accent)',
        stroke: 'var(--panel)',
        'stroke-width': 2,
        opacity: 0.85,
        'pointer-events': 'none',
      },
      gN,
    );
    svg.style.cursor = 'grabbing';
  }
  const p = svgPt(e);
  dg.ghost.setAttribute('cx', p.x);
  dg.ghost.setAttribute('cy', p.y);
  dg.line.setAttribute('x2', p.x);
  dg.line.setAttribute('y2', p.y);
  const hit = document.elementFromPoint(e.clientX, e.clientY);
  const tgt = hit && hit.closest ? hit.closest('circle.unit') : null;
  const tid = tgt ? +tgt.getAttribute('data-id') : null;
  if (dg.target && dg.target !== tgt) dg.target.removeAttribute('data-hover');
  dg.target = tgt && tid !== dg.id ? tgt : null;
  if (dg.target) dg.target.setAttribute('data-hover', '1');
  if (dg.target) {
    const a = U[dg.id],
      b = U[tid],
      rb = PLAN.byId[tid];
    showTip(
      dg.target,
      `Soltar <b>${esc(a.n)}</b> (${a.uf})<br>depois de <b>${esc(b.n)}</b> (${b.uf})<br>${fm(rb.mon)} · Equipe ${rb.team}`,
    );
  } else tip.hidden = true;
}
function endDrag(e) {
  window.removeEventListener('pointermove', moveDrag);
  const d = dg;
  dg = null;
  svg.style.cursor = '';
  tip.hidden = true;
  if (!d) return;
  if (!d.on) {
    d.act();
    return;
  }
  const tgt = d.target;
  if (d.ghost) d.ghost.remove();
  if (d.line) d.line.remove();
  if (tgt) tgt.removeAttribute('data-hover');
  if (!tgt) {
    toast('Solte a agência sobre outra agência para mudar a rota');
    return;
  }
  const tid = +tgt.getAttribute('data-id');
  const m = Object.assign({}, cfg.moves);
  m[d.id] = tid;
  // a agência movida não pode ser alvo de outra (evita ciclos)
  Object.keys(m).forEach((a) => {
    if (+m[a] === d.id) delete m[a];
  });
  const pins = Object.assign({}, cfg.pins);
  delete pins[d.id];
  cfg.pins = pins;
  cfg.moves = m;
  saveCfg();
  render();
  const r = PLAN.byId[d.id];
  toast(`${U[d.id].n} (${U[d.id].uf}) agora está em ${fm(r.mon)}, Equipe ${r.team}, depois de ${U[tid].n} (${U[tid].uf}). Regra salva.`);
}
const toastEl = document.createElement('div');
toastEl.className = 'toast';
toastEl.setAttribute('role', 'status');
toastEl.hidden = true;
document.body.appendChild(toastEl);
let tT = null;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.hidden = false;
  clearTimeout(tT);
  tT = setTimeout(() => (toastEl.hidden = true), 4200);
}

/* ---------- editar agências da equipe (pesquisa + excluir + salvar) ---------- */
const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
function nextKey(m) {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(Date.UTC(y, mo, 1));
  return d.toISOString().slice(0, 7);
}
function openTeamEditor(t) {
  const m0 = month || (PLAN.months[0] ? PLAN.months[0].key : null);
  if (!m0) {
    toast('Sem meses no plano.');
    return;
  }
  const ed = { t, m: m0, add: [], del: new Set(), q: '' };
  const current = () => {
    const base = PLAN.rows.filter((r) => r.team === t && r.mon === ed.m).map((r) => r.id);
    const out = base.filter((id) => !ed.del.has(id));
    ed.add.forEach((id) => {
      if (!out.includes(id)) out.push(id);
    });
    return out;
  };
  const where = (id) => {
    const r = PLAN.byId[id];
    return r ? `${fm(r.mon)} · Equipe ${r.team}` : 'fora do plano atual';
  };
  openOv(() => {
    ovb.innerHTML = `<header><h2 id="ov-t"><i class="dot" style="--sc:${tc(t)};width:14px;height:14px"></i>Editar agências — Equipe ${t}</h2><button type="button" class="x">Cancelar</button></header>
     <div class="frow" style="gap:12px;align-items:flex-end;margin-bottom:10px">
      <label class="ctl"><span class="lbl">Mês</span><select class="lic" id="ae-m" style="--sc:var(--accent);max-width:none">${PLAN.months.map((x) => `<option value="${x.key}"${x.key === ed.m ? ' selected' : ''}>${fm(x.key)}</option>`).join('')}</select></label>
      <label class="ctl" style="flex:1;min-width:220px"><span class="lbl">Pesquisar agência (nome, município ou UF)</span><input id="ae-q" type="search" autocomplete="off" placeholder="Ex.: Pirapora, Salvador, MG…" style="height:34px;border:1px solid var(--line);border-radius:6px;background:var(--soft);color:var(--ink);padding:0 10px;font:500 .95rem var(--body);width:100%"></label></div>
     <div id="ae-res" class="aeres"></div>
     <div class="lbl" style="margin:12px 0 6px">Agências da Equipe ${t} em <span id="ae-ml">${fm(ed.m)}</span></div>
     <div id="ae-cur" class="aecur"></div>
     <div class="frow" style="justify-content:flex-end;margin-top:14px;gap:8px"><span class="sync" id="ae-sum"></span><button type="button" class="act ghost" id="ae-cancel">Cancelar</button><button type="button" class="act on" id="ae-save">Salvar</button></div>`;
    const resEl = ovb.querySelector('#ae-res'),
      curEl = ovb.querySelector('#ae-cur'),
      q = ovb.querySelector('#ae-q');
    const drawCur = () => {
      const cur = current();
      curEl.innerHTML = cur.length
        ? cur
            .map((id, i) => {
              const u = U[id],
                isNew = ed.add.includes(id);
              return `<div class="aerow${isNew ? ' new' : ''}"><span class="n" style="--c:${tc(t)}">${i + 1}</span><span><b>${esc(u.n)}</b> <small>· ${esc(u.m)}/${u.uf} · ${u.c} câm.${isNew ? ` · <em>nova (vem de ${where(id)})</em>` : ''}</small></span><button type="button" class="act danger sm" data-del="${id}">Excluir</button></div>`;
            })
            .join('')
        : '<p class="empty">Nenhuma agência nesta equipe neste mês.</p>';
      const nd = ed.del.size,
        na = ed.add.length;
      ovb.querySelector('#ae-sum').textContent =
        na || nd ? `${na} a vincular · ${nd} a excluir — clique em Salvar para aplicar` : 'Sem alterações';
      curEl.querySelectorAll('[data-del]').forEach(
        (b) =>
          (b.onclick = () => {
            const id = +b.dataset.del;
            const i = ed.add.indexOf(id);
            if (i >= 0) ed.add.splice(i, 1);
            else ed.del.add(id);
            drawCur();
            drawRes();
          }),
      );
    };
    const drawRes = () => {
      const qq = norm(ed.q.trim());
      if (!qq) {
        resEl.innerHTML = '<p class="hint" style="margin:0">Digite para buscar entre as ' + D.units.length + ' unidades.</p>';
        return;
      }
      const cur = new Set(current());
      const hits = D.units
        .filter((u) => !cur.has(u.id) && (norm(u.n).includes(qq) || norm(u.m).includes(qq) || norm(u.uf) === qq))
        .slice(0, 12);
      resEl.innerHTML = hits.length
        ? hits
            .map(
              (u) =>
                `<div class="aerow"><span></span><span><b>${esc(u.n)}</b> <small>· ${esc(u.m)}/${u.uf} · ${u.c} câm. · hoje: ${where(u.id)}</small></span><button type="button" class="act sm" data-add="${u.id}">Vincular</button></div>`,
            )
            .join('')
        : '<p class="empty">Nenhuma agência encontrada.</p>';
      resEl.querySelectorAll('[data-add]').forEach(
        (b) =>
          (b.onclick = () => {
            const id = +b.dataset.add;
            ed.del.delete(id);
            if (!ed.add.includes(id)) ed.add.push(id);
            drawCur();
            drawRes();
            q.focus();
          }),
      );
    };
    q.value = ed.q;
    q.addEventListener('input', () => {
      ed.q = q.value;
      drawRes();
    });
    ovb.querySelector('#ae-m').onchange = (e) => {
      ed.m = e.target.value;
      ed.add = [];
      ed.del = new Set();
      ovb.querySelector('#ae-ml').textContent = fm(ed.m);
      drawCur();
      drawRes();
    };
    ovb.querySelector('.x').onclick = closeOv;
    ovb.querySelector('#ae-cancel').onclick = closeOv;
    ovb.querySelector('#ae-save').onclick = () => {
      const F = Object.assign({}, cfg.force || {}),
        Pn = Object.assign({}, cfg.pins || {}),
        A = {};
      Object.keys(cfg.assign || {}).forEach((x) => (A[x] = (cfg.assign[x] || []).map(Number)));
      const Mv = Object.assign({}, cfg.moves || {});
      ed.add.forEach((id) => {
        F[id] = { t, m: ed.m };
        delete Pn[id];
        delete Mv[id];
        Object.keys(A).forEach((x) => {
          A[x] = A[x].filter((z) => z !== id);
        });
      });
      ed.del.forEach((id) => {
        delete F[id];
        delete Mv[id];
        Object.keys(A).forEach((x) => {
          A[x] = A[x].filter((z) => z !== id);
        });
        Pn[id] = nextKey(ed.m);
      });
      cfg.force = F;
      cfg.pins = Pn;
      cfg.assign = A;
      cfg.moves = Mv;
      saveCfg();
      const na = ed.add.length,
        nd = ed.del.size;
      closeOv();
      render();
      toast(
        `Equipe ${t} · ${fm(ed.m)}: ${na} agência(s) vinculada(s), ${nd} excluída(s)${nd ? ' (voltam para a fila a partir de ' + fm(nextKey(ed.m)) + ')' : ''}. Salvo.`,
      );
    };
    drawCur();
    drawRes();
  });
  setTimeout(() => {
    const q = document.getElementById('ae-q');
    if (q) q.focus();
  }, 50);
}
/* ---------- popups ---------- */
const ov = document.getElementById('ov'),
  ovb = document.getElementById('ov-box');
let ovS = null,
  lastFocus = null;
function openOv(fn) {
  ovS = fn;
  lastFocus = document.activeElement;
  ov.hidden = false;
  fn();
  const x = ovb.querySelector('.x');
  if (x) x.focus();
}
function refreshOv() {
  if (ovS && !ov.hidden) ovS();
}
function closeOv() {
  ov.hidden = true;
  ovS = null;
  if (lastFocus && lastFocus.focus) lastFocus.focus();
}
ov.addEventListener('click', (e) => {
  if (e.target === ov) closeOv();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !ov.hidden) closeOv();
});
function openList(kind, v) {
  openOv(() => {
    const isSt = kind === 'st';
    const list = D.units
      .filter((u) => (!sel.size || PLAN.byId[u.id]) && (isSt ? stOf(u.id) : lcOf(u.id)) === v)
      .map((u) => ({ u, r: PLAN.byId[u.id] }))
      .sort((a, b) => (a.r ? a.r.d0 : 0) - (b.r ? b.r.d0 : 0));
    ovb.innerHTML = `<header><h2 id="ov-t"><i class="dot" style="--sc:${isSt ? SC[v] : LC[v]};width:14px;height:14px"></i>${isSt ? '' : 'Licença '}${v} · ${list.length} agência${list.length === 1 ? '' : 's'}</h2><button type="button" class="x">Fechar</button></header>
  ${
    list.length
      ? `<div class="tw" style="border:0"><table class="ag"><thead><tr><th>Agência</th><th>UF</th><th>Mês</th><th>Equipe</th><th>Material entregue</th><th>Instalação</th><th>Licença</th><th>Patrimônio</th><th>Status</th><th></th></tr></thead><tbody>
  ${list
    .map(({ u, r }) => {
      const x = selects(u, 'o');
      return `<tr><td>${esc(u.n)}<br><small>${esc(u.m)} · ${u.c} câm.</small></td><td>${u.uf}</td><td>${r ? fm(r.mon) : '—'}</td><td>${r ? r.team : '—'}</td><td>${r ? fs(r.deliv) : '—'}</td><td>${r ? fs(r.d0) + '–' + fs(r.d1) : '—'}</td><td>${x.lic}</td><td>${x.pat}</td><td>${x.st}</td><td><button type="button" class="iconbtn" data-det="${u.id}" aria-label="Detalhes">${DOC}</button></td></tr>`;
    })
    .join('')}</tbody></table></div>`
      : '<p class="empty">Nenhuma agência aqui.</p>'
  }`;
    ovb.querySelector('.x').onclick = closeOv;
    wire(ovb);
  });
}
function openDetail(id) {
  if (!PLAN.byId[id]) {
    toast(
      U[id] && U[id].ok
        ? 'Concluída em ' + fdi(U[id].ok) + ': fora da rota. Use “Concluídas fora da rota” para retornar.'
        : 'Esta agência está fora dos estados selecionados.',
    );
    return;
  }
  openOv(() => {
    const u = U[id],
      r = PLAN.byId[id],
      x = selects(u, 'd');
    const q = encodeURIComponent(
      u.gf && u.la != null
        ? `${u.la},${u.lo}`
        : u.ad
          ? `${u.ad.replace(/ · /g, ', ')}, ${u.m} - ${u.uf}`
          : `${D.estatico ? 'Banco do Nordeste ' : ''}${u.m} ${u.uf}`,
    );
    const pins = cfg.pins || {};
    ovb.innerHTML = `<header><h2 id="ov-t">${esc(u.n)}</h2><button type="button" class="x">Fechar</button></header>
   <p class="sub">${esc(u.m)} – ${u.uf} · ${u.c} câmeras · ${r.H} dias de instalação · ${fm(r.mon)} · Equipe ${r.team}, parada ${r.seq}</p>
   <div class="steps"><div>Despacho do material<b>${mode === 'B' || r.lv ? 'com o técnico' : r.semData ? '—' : fd(r.disp)}</b>${u.dd && !r.lv ? '<small>informado</small>' : ''}</div><div>Material entregue<b>${mode === 'B' || r.lv ? 'com o técnico' : r.semData ? '—' : fd(r.deliv)}</b>${u.de && !r.lv ? '<small>informado</small>' : ''}</div><div>Início da instalação<b>${fd(r.d0)}</b>${r.fxp ? '<small>adiado: após a entrega</small>' : ''}</div><div>Fim da instalação<b>${fd(r.d1)}</b></div><div>Deslocamento<b>${r.ml === 'aviao' || (r.K === 0 && r.km > 0) ? 'Avião · 0 h' : r.km.toLocaleString('pt-BR') + ' km · ' + fmt(r.h) + ' h'}</b>${r.ml ? '<small>' + RP_ML[r.ml] + '</small>' : ''}</div></div>
   <div class="frow" style="gap:12px"><label class="ctl"><span class="lbl">Status</span>${x.st}</label><label class="ctl"><span class="lbl">Licença</span>${x.lic}</label><label class="ctl"><span class="lbl">Patrimônio do servidor</span>${x.pat}</label>
   ${plan === 'M' ? `<label class="ctl"><span class="lbl">Fixar no mês</span><select class="lic" id="d-pin" style="--sc:var(--accent)"><option value="">Automático</option>${PLAN.months.map((m) => `<option value="${m.key}"${pins[id] === m.key ? ' selected' : ''}>${fm(m.key)}</option>`).join('')}</select></label>` : ''}</div>
   ${lateOf(r) ? `<p class="warn">⚠ Atrasada: ${lateOf(r)}</p>` : ''}${u.di || u.tm ? `<p class="sub">Do cadastro: ${u.tm ? 'Equipe ' + u.tm : ''}${u.tm && u.di ? ' · ' : ''}${u.di ? 'início ' + fdi(u.di) : ''}</p>` : ''}<div class="lgbox"><span class="lbl">Logística deste endereço</span><div class="frow" style="gap:10px;align-items:flex-end"><label class="ctl"><span class="lbl">Despacho do material</span><input type="date" id="d-dd" value="${u.dd || ''}"></label><label class="ctl"><span class="lbl">Material entregue</span><input type="date" id="d-de" value="${u.de || ''}"></label><label class="ctl"><span class="lbl">Como a equipe e o material chegam</span><select id="d-ml"><option value="">Padrão do plano (${MODES[mode]})</option>${Object.entries(
     RP_ML,
   )
     .map(([k, t]) => `<option value="${k}"${u.ml === k ? ' selected' : ''}>${t}</option>`)
     .join(
       '',
     )}</select></label><button type="button" class="act" id="d-lgs">Salvar logística</button></div><p class="note" style="margin:6px 0 0">Com entrega informada, a instalação começa no dia útil seguinte. Só com o despacho, a entrega é estimada pelo prazo de transporte do estado. <b>Equipamento com o técnico</b>: não espera transporte. <b>Avião</b>: deslocamento zerado.</p></div><p class="sub" style="margin:8px 0">Localização no mapa: ${u.gf === 'endereco' ? '<b>pelo endereço</b> (mapa)' : u.gf === 'manual' ? 'latitude/longitude do cadastro' : u.aprox ? '<b class="warn">aproximada, pelo centro do município</b> <button type="button" class="act ghost" id="d-geo">Localizar pelo endereço</button>' : D.estatico ? 'planilha original' : '—'}</p><div class="frow" style="gap:8px;align-items:flex-end;margin:10px 0"><label class="ctl"><span class="lbl">Data de conclusão</span><input type="date" id="d-ok" max="${E.iso(RP_HOJE)}" value="${E.iso(RP_HOJE)}" style="height:34px;border:1px solid var(--line);border-radius:6px;background:var(--soft);color:var(--ink);padding:0 8px"></label><button type="button" class="act" id="d-okb">Concluir e tirar da rota</button></div>
   <p class="note"><a href="https://www.google.com/maps/search/?api=1&query=${q}" target="_blank" rel="noopener">Abrir a localização no Google Maps</a></p>`;
    ovb.querySelector('.x').onclick = closeOv;
    wire(ovb);
    rpLigarLogistica(id);
    const okb = ovb.querySelector('#d-okb');
    if (okb) okb.onclick = () => rpConcluir(id, ovb.querySelector('#d-ok').value);
    const dp = ovb.querySelector('#d-pin');
    if (dp)
      dp.onchange = () => {
        const p = Object.assign({}, cfg.pins);
        if (dp.value) p[id] = dp.value;
        else delete p[id];
        cfg.pins = p;
        saveCfg();
        render();
        refreshOv();
      };
  });
}
/* ---------- persistência ---------- */
const STORE = { st: () => status, lic: () => lic, pat: () => pat };
async function setDoc(kind, id, v) {
  if (kind === 'st') status = Object.assign({}, status, { [id]: v });
  else if (kind === 'lic') lic = Object.assign({}, lic, { [id]: v });
  else pat = Object.assign({}, pat, { [id]: v });
  render();
  refreshOv();
  const c = kind === 'st' ? cST : kind === 'lic' ? cLI : cPA;
  const f = kind === 'st' ? 's' : kind === 'lic' ? 'l' : 'p';
  if (c) {
    try {
      await c.doc(String(id)).set({ [f]: v });
    } catch (e) {}
  } else save(kind === 'st' ? 'status' : kind, JSON.stringify(STORE[kind]()));
}
async function saveCfg() {
  const v = {
    cap: cfg.cap,
    over: cfg.over || {},
    pins: cfg.pins || {},
    order: cfg.order || [],
    states: cfg.states || [],
    moves: cfg.moves || {},
    assign: cfg.assign || {},
    force: cfg.force || {},
    mstates: cfg.mstates || {},
    etc: !!cfg.etc,
    tat: !!cfg.tat,
    eqc: cfg.eqc !== false,
    semdesl: cfg.semdesl || [],
    estEntrega: !!cfg.estEntrega,
    encaixar: !!cfg.encaixar,
  };
  if (dCF) {
    try {
      await dCF.set(v);
    } catch (e) {}
  } else save('cfg', JSON.stringify(v));
}
function fitGrid() {
  const g = document.querySelector('.grid');
  if (!g) return;
  if (innerWidth <= 1100) {
    g.style.removeProperty('--gh');
    return;
  }
  const top = g.getBoundingClientRect().top + scrollY;
  const h = Math.max(640, innerHeight - Math.min(top, innerHeight * 0.4) - 14);
  g.style.setProperty('--gh', h + 'px');
}
addEventListener('resize', fitGrid);
render();
fitGrid();
setTimeout(fitGrid, 300);
if ((cfg.states || []).length) fitSel();
(async () => {
  try {
    db = await window.claude?.use?.('db');
  } catch (e) {
    db = null;
  }
  if (!db) {
    render();
    return;
  }
  cST = db.collection('status');
  cLI = db.collection('licenca');
  cPA = db.collection('patrimonio');
  dCF = db.doc('config/plano2');
  const sub = (c, f, ok, setter) =>
    c.onSnapshot(
      (snap) => {
        const n = {};
        snap.docs.forEach((d) => {
          const v = d.data();
          if (v && ok(v[f])) n[+d.id] = v[f];
        });
        setter(n);
        render();
        refreshOv();
      },
      () => {},
    );
  sub(
    cST,
    's',
    (v) => STATUS.includes(v),
    (n) => (status = n),
  );
  sub(
    cLI,
    'l',
    (v) => LIC.includes(v),
    (n) => (lic = n),
  );
  sub(
    cPA,
    'p',
    (v) => typeof v === 'string',
    (n) => (pat = n),
  );
  dCF.onSnapshot(
    (s) => {
      const v = s.exists ? s.data() : null;
      if (v) {
        cfg = {
          cap: +v.cap || 4.8,
          over: v.over || {},
          pins: v.pins || {},
          order: Array.isArray(v.order) ? v.order.map(Number) : [],
          states: Array.isArray(v.states) ? v.states : [],
          moves: v.moves && typeof v.moves === 'object' ? v.moves : {},
          assign: v.assign && typeof v.assign === 'object' ? v.assign : {},
          force: v.force && typeof v.force === 'object' ? v.force : {},
          mstates: v.mstates && typeof v.mstates === 'object' ? v.mstates : {},
          etc: !!v.etc,
          tat: !!v.tat,
          eqc: v.eqc !== false,
          semdesl: Array.isArray(v.semdesl) ? v.semdesl : [],
          estEntrega: !!v.estEntrega,
          encaixar: !!v.encaixar,
        };
        const ch = JSON.stringify(prevSt) !== JSON.stringify(cfg.states);
        prevSt = cfg.states.slice();
        render();
        refreshOv();
        if (ch) fitSel();
      }
    },
    () => {},
  );
})();

const RP_ML = { estrada: 'Técnico pela estrada', leva: 'Equipamento vai com o técnico', aviao: 'Avião · deslocamento zerado' };
function rpLigarLogistica(id) {
  const b = ovb.querySelector('#d-lgs');
  if (b)
    b.onclick = async () => {
      const dd = ovb.querySelector('#d-dd').value,
        de = ovb.querySelector('#d-de').value,
        ml = ovb.querySelector('#d-ml').value;
      if (dd && de && de < dd) {
        toast('A entrega não pode ser antes do despacho.');
        return;
      }
      try {
        await rpApi('/api/rota/' + window.RP_CLIENTE + '/logistica/' + id, 'PUT', {
          despacho: dd || null,
          entrega: de || null,
          modo: ml || null,
        });
        const u = U[id];
        u.dd = dd || null;
        u.de = de || null;
        u.ml = ml || null;
        toast('Logística salva. Plano recalculado.');
        render();
        refreshOv();
      } catch (e) {
        toast('Não foi possível salvar: ' + e.message);
      }
    };
  const g = ovb.querySelector('#d-geo');
  if (g)
    g.onclick = async () => {
      g.disabled = true;
      g.textContent = 'Localizando…';
      try {
        const r = await rpApi('/api/rota/' + window.RP_CLIENTE + '/localizar/' + id, 'POST', {});
        toast('Localizado pelo endereço. Atualizando o mapa…');
        setTimeout(() => location.reload(), 800);
      } catch (e) {
        toast(e.message);
        g.disabled = false;
        g.textContent = 'Localizar pelo endereço';
      }
    };
}
// ---------- Regras do plano: todos os botões de regra num só painel, agrupados ----------
(function () {
  const GR = [
    ['eq', 'Equipes e datas', 'Do cadastro, dias por endereço e gravação'],
    ['lg', 'Logística', 'Deslocamento e entrega do material'],
    ['ms', 'Meses', 'Como o cronograma enche cada mês'],
  ];
  const grupo = (t) =>
    /^(Etapas do cadastro|Equipes e datas|Gravar|Dias:)/.test(t)
      ? 'eq'
      : /deslocamento|entrega/i.test(t)
        ? 'lg'
        : /^(Meses|Estados por m)/.test(t)
          ? 'ms'
          : 'eq';
  let aberto = true;
  try {
    aberto = localStorage.getItem('rp-regras-aberto') !== '0';
  } catch (_) {}
  function rpRegras() {
    const cu = document.getElementById('c-uf');
    const slot = document.getElementById('regras-slot');
    if (!cu || !slot) return;
    let box = document.getElementById('rp-regras');
    if (!box) {
      box = document.createElement('details');
      box.id = 'rp-regras';
      box.className = 'card rpreg';
      box.open = aberto;
      box.innerHTML =
        '<summary><span class="rt">Regras do plano</span><span class="rc" id="rp-reg-n"></span><span class="rh">Tudo o que muda o cálculo das rotas e das datas fica aqui</span></summary><div class="rgrid">' +
        GR.map(
          (g) => '<div class="rg" data-g="' + g[0] + '"><b>' + g[1] + '</b><small>' + g[2] + '</small><div class="rb"></div></div>',
        ).join('') +
        '</div><div class="rhints"></div>';
      box.addEventListener('toggle', () => {
        try {
          localStorage.setItem('rp-regras-aberto', box.open ? '1' : '0');
        } catch (_) {}
      });
      slot.appendChild(box);
    }
    box.querySelectorAll('.rb').forEach((x) => (x.innerHTML = ''));
    const hs = box.querySelector('.rhints');
    hs.innerHTML = '';
    [...cu.querySelectorAll('.ufb.etb')]
      .reverse()
      .forEach((b) => box.querySelector('.rg[data-g="' + grupo(b.textContent) + '"] .rb').prepend(b));
    cu.querySelectorAll('.ethint').forEach((h) => hs.appendChild(h));
    box.querySelectorAll('.rg').forEach((g) => (g.hidden = !g.querySelector('.rb').children.length));
    const n = box.querySelectorAll('.ufb.etb.on').length;
    document.getElementById('rp-reg-n').textContent = n ? n + ' ligada' + (n > 1 ? 's' : '') : 'nenhuma ligada';
  }
  const r0 = render;
  render = function () {
    const x = r0.apply(this, arguments);
    try {
      rpRegras();
    } catch (e) {
      console.error(e);
    }
    return x;
  };
  try {
    rpRegras();
  } catch (_) {}

})();
