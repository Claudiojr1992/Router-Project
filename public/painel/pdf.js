/* ---------- PDF para o cliente ---------- */
const PDFLIB_URL = '/vendor/pdf-lib.min.js';
let pdfBusy = false;
const dlP = (async () => {
  try {
    return await window.claude?.use?.('downloads');
  } catch (e) {
    return null;
  }
})();
function loadPdfLib() {
  if (window.PDFLib) return Promise.resolve(window.PDFLib);
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = PDFLIB_URL;
    s.onload = () => (window.PDFLib ? res(window.PDFLib) : rej(new Error('Gerador de PDF indisponível')));
    s.onerror = () => rej(new Error('Não foi possível carregar o gerador de PDF. Verifique a conexão e tente de novo.'));
    document.head.appendChild(s);
  });
}
const PX = {
  accent: '#0E6E63',
  ink: '#14211F',
  muted: '#5B6B68',
  line: '#D2DEDB',
  soft: '#F4F8F7',
  asoft: '#E2F1EE',
  ok: '#16A34A',
  warn: '#B7791F',
  ocean: '#D5E6EA',
  land: '#F7FAF8',
  coast: '#9BB4B8',
  grat: '#C3D4D7',
};
const PTC = ['#2F6FD0', '#D9622B', '#22955F', '#B0399A', '#B88A0A', '#14909F', '#D23E5A', '#6F55C8'];
const PSC = {
  'A iniciar': '#64748B',
  Configurado: '#4F46E5',
  'Em transporte': '#EA580C',
  'Material entregue': '#9333EA',
  'Em execução': '#2563EB',
  'Em validação': '#0891B2',
  Faturado: '#DB2777',
  Handover: '#CA8A04',
  Concluída: '#16A34A',
};
const PLC = { Provisória: '#B45309', Definitiva: '#15803D' };
const tcol = (t) => PTC[(t - 1) % 8];
const MESL = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const fml = (key) => {
  const [y, m] = key.split('-');
  const s = MESL[+m - 1];
  return s[0].toUpperCase() + s.slice(1) + ' de ' + y;
};
const mixW = (hex, a) => {
  const c = parseInt(hex.slice(1), 16),
    f = (v) =>
      Math.round(255 - (255 - v) * a)
        .toString(16)
        .padStart(2, '0');
  return '#' + f((c >> 16) & 255) + f((c >> 8) & 255) + f(c & 255);
};
const WINX = '–—‘’“”•…›';
const san = (s) =>
  String(s == null ? '' : s)
    .replace(/[\t\n\r]+/g, ' ')
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, (c) => (WINX.includes(c) ? c : c === '→' ? '->' : ''));
const sumBy = (a, f) => a.reduce((s, x) => s + f(x), 0);
const minD = (a, f) => a.reduce((m, x) => (!m || f(x) < m ? f(x) : m), null),
  maxD = (a, f) => a.reduce((m, x) => (!m || f(x) > m ? f(x) : m), null);

function mapSVG(rows, o) {
  const pts = rows.map((r) => px(U[r.id].la, U[r.id].lo));
  pts.push([bx, by], [bx + 105, by - 12]);
  let x0 = Math.min(...pts.map((p) => p[0])),
    x1 = Math.max(...pts.map((p) => p[0])),
    y0 = Math.min(...pts.map((p) => p[1])),
    y1 = Math.max(...pts.map((p) => p[1]));
  const pad = 34;
  x0 -= pad;
  y0 -= pad;
  x1 += pad;
  y1 += pad;
  let w = Math.max(x1 - x0, W / 5),
    h = Math.max(y1 - y0, H / 5);
  const ar = o.bw / o.bh;
  if (w / h > ar) h = w / ar;
  else w = h * ar;
  const vx = (x0 + x1) / 2 - w / 2,
    vy = (y0 + y1) / 2 - h / 2,
    u = w / 560,
    f = (v) => v.toFixed(1);
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${f(vx)} ${f(vy)} ${f(w)} ${f(h)}" width="${Math.round(o.bw * 3)}" height="${Math.round(o.bh * 3)}">`;
  s += `<rect x="${f(vx - 10)}" y="${f(vy - 10)}" width="${f(w + 20)}" height="${f(h + 20)}" fill="${PX.ocean}"/>`;
  for (let lo = Math.ceil(LON0 / 5) * 5; lo <= LON1; lo += 5) {
    const [x] = px(0, lo);
    s += `<line x1="${f(x)}" y1="${f(vy)}" x2="${f(x)}" y2="${f(vy + h)}" stroke="${PX.grat}" stroke-width="${f(u)}"/>`;
  }
  for (let la = Math.floor(LAT0 / 5) * 5; la >= LAT1; la -= 5) {
    const [, y] = px(la, 0);
    s += `<line x1="${f(vx)}" y1="${f(y)}" x2="${f(vx + w)}" y2="${f(y)}" stroke="${PX.grat}" stroke-width="${f(u)}"/>`;
  }
  s += `<polygon points="${[[LAT0, LON0], ...COAST, [LAT1, LON0]].map((p) => px(p[0], p[1]).map(f).join(',')).join(' ')}" fill="${PX.land}" stroke="${PX.coast}" stroke-width="${f(1.3 * u)}" stroke-linejoin="round"/>`;
  UFL.forEach(([t, la, lo]) => {
    const [x, y] = px(la, lo);
    s += `<text x="${f(x)}" y="${f(y)}" fill="${PX.coast}" font-size="${f(17 * u)}" font-weight="700" font-family="Arial,Helvetica,sans-serif" text-anchor="middle" letter-spacing="${f(1.5 * u)}">${t}</text>`;
  });
  const inR = new Set(rows.map((r) => r.id));
  D.units.forEach((un) => {
    if (inR.has(un.id)) return;
    const [x, y] = px(un.la, un.lo);
    s += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(2 * u)}" fill="#8A9A97" opacity=".35"/>`;
  });
  const g = {};
  rows.forEach((r) => {
    const key = r.team + '|' + r.mon;
    (g[key] = g[key] || []).push(r);
  });
  Object.values(g).forEach((a) => {
    a.sort((p, q) => p.seq - q.seq);
    const c = tcol(a[0].team),
      pp = a.map((r) => px(U[r.id].la, U[r.id].lo));
    s += `<line x1="${f(bx)}" y1="${f(by)}" x2="${f(pp[0][0])}" y2="${f(pp[0][1])}" stroke="${c}" stroke-width="${f(1.1 * u)}" stroke-dasharray="${f(4 * u)} ${f(4 * u)}" opacity=".55"/>`;
    s += `<polyline points="${pp.map((q) => q.map(f).join(',')).join(' ')}" fill="none" stroke="${c}" stroke-width="${f((o.numbers ? 2.3 : 1.7) * u)}" stroke-linejoin="round" stroke-linecap="round" opacity="${o.numbers ? 0.92 : 0.8}"/>`;
  });
  rows.forEach((r) => {
    const un = U[r.id],
      [x, y] = px(un.la, un.lo),
      done = stOf(r.id) === 'Concluída';
    const rr = o.numbers ? 6.4 * u : (2.4 + Math.sqrt(un.c) * 0.45) * u;
    s += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(rr)}" fill="${done ? PX.ok : tcol(r.team)}" stroke="#FFFFFF" stroke-width="${f(1.2 * u)}"/>`;
    if (o.numbers)
      s += `<text x="${f(x)}" y="${f(y + 2.7 * u)}" fill="#FFFFFF" font-size="${f(7.6 * u)}" font-weight="700" font-family="Arial,Helvetica,sans-serif" text-anchor="middle">${r.seq}</text>`;
  });
  let st = '';
  for (let i = 0; i < 10; i++) {
    const a = Math.PI / 2 + (i * Math.PI) / 5,
      rr = (i % 2 ? 0.45 : 1) * 10 * u;
    st += `${f(bx + rr * Math.cos(a))},${f(by - rr * Math.sin(a))} `;
  }
  s += `<polygon points="${st}" fill="${PX.ink}" stroke="#FFFFFF" stroke-width="${f(1.3 * u)}"/><text x="${f(bx + 12 * u)}" y="${f(by - 8 * u)}" fill="${PX.ink}" font-size="${f(10.5 * u)}" font-weight="700" font-family="Arial,Helvetica,sans-serif">${RP_BASE.toUpperCase()} · BASE</text></svg>`;
  return s;
}
function svgPng(s, bw, bh) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = Math.round(bw * 3);
      c.height = Math.round(bh * 3);
      const g = c.getContext('2d');
      g.fillStyle = PX.ocean;
      g.fillRect(0, 0, c.width, c.height);
      g.drawImage(img, 0, 0, c.width, c.height);
      c.toBlob(
        (b) => (b ? b.arrayBuffer().then((a) => res(new Uint8Array(a)), rej) : rej(new Error('Falha ao desenhar o mapa'))),
        'image/png',
      );
    };
    img.onerror = () => rej(new Error('Falha ao desenhar o mapa'));
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(s);
  });
}

function makeDoc(L, pdf, F, B) {
  const PW = 842,
    PH = 595,
    M = 36,
    CW = PW - 2 * M,
    TOP = 58,
    BOT = PH - 42;
  const col = (h) => {
    const c = parseInt(h.slice(1), 16);
    return L.rgb(((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255);
  };
  const d = { pdf, PW, PH, M, CW, TOP, BOT, page: null, y: TOP, pages: [], sub: '' };
  d.w = (s, sz, b) => (b ? B : F).widthOfTextAtSize(san(s), sz);
  d.fit = (s, mw, sz, b) => {
    s = san(s);
    if (d.w(s, sz, b) <= mw) return s;
    while (s.length > 1 && d.w(s + '…', sz, b) > mw) s = s.slice(0, -1);
    return s.trimEnd() + '…';
  };
  d.text = (s, x, y, o = {}) => {
    const sz = o.size || 9,
      b = !!o.bold;
    const t = o.maxW ? d.fit(s, o.maxW, sz, b) : san(s);
    if (!t) return;
    let xx = x;
    if (o.align === 'r') xx = x - d.w(t, sz, b);
    else if (o.align === 'c') xx = x - d.w(t, sz, b) / 2;
    d.page.drawText(t, { x: xx, y: PH - y, size: sz, font: b ? B : F, color: col(o.color || PX.ink) });
  };
  d.rect = (x, y, w, h, o = {}) => {
    const a = { x, y: PH - y - h, width: w, height: h };
    if (o.fill) a.color = col(o.fill);
    if (o.stroke) {
      a.borderColor = col(o.stroke);
      a.borderWidth = o.bw || 0.6;
    } else a.borderWidth = 0;
    d.page.drawRectangle(a);
  };
  d.line = (x1, y1, x2, y2, c, t) =>
    d.page.drawLine({ start: { x: x1, y: PH - y1 }, end: { x: x2, y: PH - y2 }, thickness: t || 0.6, color: col(c || PX.line) });
  d.dot = (x, y, r, c) => d.page.drawCircle({ x, y: PH - y, size: r, color: col(c) });
  d.wrap = (s, mw, sz, b) => {
    const out = [];
    let cur = '';
    san(s)
      .split(' ')
      .forEach((wd) => {
        const t = cur ? cur + ' ' + wd : wd;
        if (d.w(t, sz, b) > mw && cur) {
          out.push(cur);
          cur = wd;
        } else cur = t;
      });
    if (cur) out.push(cur);
    return out;
  };
  d.newPage = () => {
    const p = pdf.addPage([PW, PH]);
    d.page = p;
    d.pages.push(p);
    d.rect(0, 0, PW, 5, { fill: PX.accent });
    d.text('PLANO DE ROTAS · ' + RP_TIT, M, 27, { size: 8.5, bold: true, color: PX.accent });
    d.text(d.sub, PW - M, 27, { size: 8.5, color: PX.muted, align: 'r' });
    d.line(M, 35, PW - M, 35);
    d.y = TOP;
    return p;
  };
  d.footer = (gen) => {
    const n = d.pages.length;
    d.pages.forEach((p, i) => {
      d.page = p;
      d.line(M, PH - 30, PW - M, PH - 30);
      d.text(
        `L&K Tecnologia · Plano de rotas de instalação · ${D.estatico ? 'CFTV · Banco do Nordeste' : RP_NOME} · gerado em ${gen}`,
        M,
        PH - 18,
        { size: 7, color: PX.muted },
      );
      d.text(`Página ${i + 1} de ${n}`, PW - M, PH - 18, { size: 7, color: PX.muted, align: 'r' });
    });
  };
  d.h2 = (t, sub) => {
    if (d.y + 60 > BOT) d.newPage();
    d.text(t, M, d.y + 12, { size: 13, bold: true });
    if (sub) d.text(sub, PW - M, d.y + 12, { size: 8, color: PX.muted, align: 'r', maxW: CW - d.w(t, 13, true) - 20 });
    d.y += 22;
  };
  d.tiles = (items, x, y, w, h, perRow, gap = 8) => {
    const tw = (w - (perRow - 1) * gap) / perRow;
    items.forEach((it, i) => {
      const cx = x + (i % perRow) * (tw + gap),
        cy = y + Math.floor(i / perRow) * (h + gap);
      d.rect(cx, cy, tw, h, { fill: it.hl ? PX.asoft : '#FFFFFF', stroke: it.hl ? PX.accent : PX.line });
      if (it.c) d.rect(cx, cy, 3, h, { fill: it.c });
      d.text(String(it.l).toUpperCase(), cx + 9, cy + 13, { size: 6.5, bold: true, color: PX.muted, maxW: tw - 14 });
      d.text(it.v, cx + 9, cy + h - 10, { size: h > 40 ? 15 : 12, bold: true, color: it.hl ? PX.accent : PX.ink, maxW: tw - 14 });
    });
  };
  d.table = (cols0, data0, o = {}) => {
    const keep = cols0.map((c) => !c.hide);
    const cols = cols0.filter((c, i) => keep[i]);
    const sobra = cols0.filter((c, i) => !keep[i]).reduce((a, c) => a + c.w, 0);
    if (sobra && cols.length) {
      const wi = cols.reduce((m, c, i) => (c.w > cols[m].w ? i : m), 0);
      cols[wi] = Object.assign({}, cols[wi], { w: cols[wi].w + sobra });
    }
    const data = data0.map((r) => (r.c ? Object.assign({}, r, { c: r.c.filter((x, i) => keep[i]) }) : r));
    const rh = o.rh || 15,
      hh = 18,
      fz = o.fs || 7.5,
      x0 = M;
    const head = () => {
      d.rect(x0, d.y, CW, hh, { fill: PX.ink });
      let x = x0;
      cols.forEach((c) => {
        const tx = c.a === 'r' ? x + c.w - 4 : c.a === 'c' ? x + c.w / 2 : x + 4;
        d.text(c.h, tx, d.y + hh / 2 + fz * 0.36, { size: fz, bold: true, color: '#FFFFFF', align: c.a, maxW: c.w - 6 });
        x += c.w;
      });
      d.y += hh;
    };
    if (d.y + hh + rh * 2 > BOT) d.newPage();
    head();
    let z = 0;
    data.forEach((r) => {
      if (r.group) {
        const gh = 17;
        if (d.y + gh + rh * 2 > BOT) {
          d.newPage();
          head();
        }
        d.rect(x0, d.y, CW, gh, { fill: mixW(r.color, 0.14) });
        d.rect(x0, d.y, 4, gh, { fill: r.color });
        d.text(r.group, x0 + 10, d.y + gh / 2 + 3, { size: 8, bold: true, maxW: CW - 20 });
        d.y += gh;
        z = 0;
        return;
      }
      if (d.y + rh > BOT) {
        d.newPage();
        head();
        z = 0;
      }
      if (r.total) d.rect(x0, d.y, CW, rh, { fill: PX.asoft });
      else if (z++ % 2) d.rect(x0, d.y, CW, rh, { fill: PX.soft });
      let x = x0;
      r.c.forEach((cell, j) => {
        const c = cols[j];
        const cc = cell && typeof cell === 'object' ? cell : { t: cell };
        let tx = c.a === 'r' ? x + c.w - 4 : c.a === 'c' ? x + c.w / 2 : x + 4,
          mw = c.w - 8,
          al = c.a;
        if (cc.dot) {
          d.dot(x + 8, d.y + rh / 2, 2.7, cc.dot);
          tx = x + 14;
          mw = c.w - 18;
          al = undefined;
        }
        d.text(cc.t == null ? '' : String(cc.t), tx, d.y + rh / 2 + fz * 0.36, {
          size: fz,
          bold: cc.b || r.total,
          color: cc.color || PX.ink,
          align: al,
          maxW: mw,
        });
        x += c.w;
      });
      d.line(x0, d.y + rh, x0 + CW, d.y + rh, PX.line, 0.4);
      d.y += rh;
    });
    d.y += 10;
  };
  d.image = async (png, x, y, w, h) => {
    const img = await pdf.embedPng(png);
    d.page.drawImage(img, { x, y: PH - y - h, width: w, height: h });
    d.rect(x, y, w, h, { stroke: PX.line, bw: 0.8 });
  };
  return d;
}

function pdfCtx() {
  const P_ = PLAN,
    rows = P_.rows,
    S0 = E.parse(start),
    fin = rows.reduce((m, r) => (r.d1 > m ? r.d1 : m), S0);
  return { P_, rows, S0, fin };
}
function paramList(c) {
  const n = Object.keys(cfg.force || {}).length,
    mv = Object.keys(cfg.moves || {}).length,
    am = Object.keys(asgFor()).length,
    oc = (cfg.order || []).length;
  const adj = [
    n ? `${n} vinculada(s) manualmente` : '',
    mv ? `${mv} movida(s) no mapa` : '',
    am ? `${am} equipe(s) montada(s) no mapa` : '',
    oc ? `ordem definida para ${oc} agência(s)` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  return [
    ['Base de saída', (D.base && D.base.nome) || 'Fortaleza/CE'],
    ['Estratégia de rota', st === 'O' ? 'Otimizada (menor deslocamento)' : 'Por estados'],
    ['Equipes', `${k} equipe${k > 1 ? 's' : ''}`],
    ['Logística do material', MODES[mode]],
    [
      'Planejamento',
      plan === 'M' && cfg.encaixar
        ? 'Por período: cada mês recebe as agências que cabem nos dias úteis, com deslocamento e instalação'
        : plan === 'M'
          ? `Por meta mensal: ${quota()} agências/mês, divididas igualmente entre as equipes`
          : 'Contínuo (sem meta mensal)',
    ],
    ['Início do deslocamento', fd(c.S0)],
    ['Término previsto', fd(c.fin)],
    ['Dias úteis', `${wdCount(c.S0, c.fin)} dias úteis em ${c.P_.months.length} meses`],
    ['Estados no plano', (cfg.states || []).length ? cfg.states.join(', ') : 'Todos'],
    [
      'Regras de campo',
      D.cadDias && D.units.some((u) => u.dp)
        ? 'Até 12 h de viagem por dia · dias em cada endereço pela produção diária de cada equipe (regras das equipes)'
        : 'Até 12 h de viagem por dia · até 22 câmeras = 2 dias de instalação · 23 a 32 = 3 dias · acima = 4 dias',
    ],
    ['Ajustes manuais', adj || 'Nenhum'],
  ];
}
async function coverPage(d, c) {
  const { rows, P_, S0, fin } = c,
    M = d.M;
  d.newPage();
  d.text('Plano de Rotas de Instalação', M, 80, { size: 26, bold: true });
  d.text((D.estatico ? 'CFTV · Banco do Nordeste' : RP_NOME) + ' — visão geral completa do planejamento', M, 99, {
    size: 11.5,
    color: PX.muted,
  });
  const done = rows.filter((r) => stOf(r.id) === 'Concluída').length;
  d.tiles(
    [
      { l: 'Agências no plano', v: String(rows.length), hl: true },
      ...(RP_CAM ? [{ l: 'Câmeras', v: sumBy(rows, (r) => U[r.id].c).toLocaleString('pt-BR') }] : []),
      { l: 'Meses', v: String(P_.months.length) },
      { l: 'Equipes', v: String(k) },
      { l: 'Início', v: fs(S0) + '/' + S0.getUTCFullYear() },
      { l: 'Término previsto', v: fd(fin) },
      { l: 'Concluídas', v: `${done} (${rows.length ? Math.round((done * 100) / rows.length) : 0}%)`, c: PX.ok },
    ],
    M,
    114,
    d.CW,
    46,
    RP_CAM ? 7 : 6,
  );
  let y = 184;
  const LW = 340;
  d.text('Parâmetros do planejamento', M, y, { size: 11, bold: true });
  y += 10;
  paramList(c).forEach(([kk, v]) => {
    const ls = d.wrap(v, LW - 118, 8);
    const h = Math.max(16, ls.length * 10 + 6);
    d.line(M, y, M + LW, y);
    d.text(kk, M, y + 11, { size: 7.5, bold: true, color: PX.muted, maxW: 112 });
    ls.forEach((l, i) => d.text(l, M + 118, y + 11 + i * 10, { size: 8 }));
    y += h;
  });
  d.line(M, y, M + LW, y);
  y += 16;
  d.text('Equipes', M, y, { size: 9, bold: true });
  y += 6;
  const ts = [...new Set(rows.map((r) => r.team))].sort((a, b) => a - b);
  ts.forEach((t, i) => {
    const cx = M + (i % 4) * 85,
      cy = y + Math.floor(i / 4) * 16 + 8;
    const n = rows.filter((r) => r.team === t).length;
    d.rect(cx, cy - 6, 12, 6, { fill: tcol(t) });
    d.text(`Equipe ${t} · ${n}`, cx + 16, cy, { size: 7.5 });
  });
  const mx = M + LW + 18,
    mw = d.CW - LW - 18,
    my = 176,
    mh = d.BOT - my - 14;
  await d.image(await svgPng(mapSVG(rows, { bw: mw, bh: mh, numbers: false }), mw, mh), mx, my, mw, mh);
  d.text(
    'Rotas de todas as equipes em todos os meses · cor = equipe · verde = concluída · tracejado = saída de ' + RP_BASE,
    mx,
    my + mh + 10,
    { size: 6.8, color: PX.muted, maxW: mw },
  );
}
function addressPages(d, c) {
  const { rows } = c;
  d.newPage();
  d.h2('Lista de endereços', rows.length + ' endereço(s) no plano · por equipe e data de início');
  const cols = [
    { h: 'Início', w: 50, a: 'c' },
    { h: 'Fim', w: 50, a: 'c' },
    { h: 'Código', w: 46 },
    { h: 'Agência / unidade', w: 118 },
    { h: 'Endereço', w: 196 },
    { h: 'Município/UF', w: 92 },
    { h: 'Equipamentos', w: 218 },
  ];
  const data = [];
  const ts = [...new Set(rows.map((r) => r.team))].sort((a, b) => a - b);
  ts.forEach((t) => {
    const a = rows.filter((r) => r.team === t).sort((p, q) => p.d0 - q.d0 || p.seq - q.seq);
    data.push({
      group: `Equipe ${t} · ${a.length} endereço(s)${RP_CAM ? ' · ' + sumBy(a, (r) => U[r.id].c) + ' câmeras' : ''} · ${fd(minD(a, (r) => r.d0))} a ${fd(maxD(a, (r) => r.d1))}`,
      color: tcol(t),
    });
    a.forEach((r) => {
      const un = U[r.id];
      data.push({
        c: [
          fd(r.d0),
          fd(r.d1),
          un.cd || '—',
          { t: un.n, b: true },
          un.ad || '—',
          `${un.m}/${un.uf}`,
          un.it || (un.c ? un.c + ' câmeras' : '—'),
        ],
      });
    });
  });
  const ok = D.units.filter((u) => u.ok).sort((a, b) => (a.ok < b.ok ? -1 : 1));
  if (ok.length) {
    data.push({ group: `Concluídos (fora da rota) · ${ok.length} endereço(s) · coluna Início = data de conclusão`, color: PX.ok });
    ok.forEach((un) =>
      data.push({
        c: [
          fd(E.parse(un.ok)),
          '',
          un.cd || '—',
          { t: un.n, b: true },
          un.ad || '—',
          `${un.m}/${un.uf}`,
          un.it || (un.c ? un.c + ' câmeras' : '—'),
        ],
      }),
    );
  }
  d.table(cols, data, { fs: 7 });
}
// quantidade de cada equipamento por endereço (sem itens cadastrados: câmeras)
const qtdU = (u) => (u.q && Object.keys(u.q).length ? u.q : u.c ? { Câmera: u.c } : {});
const itensPdf = (rows) => {
  const o = [];
  rows.forEach((r) =>
    Object.keys(qtdU(U[r.id])).forEach((n) => {
      if (!o.includes(n)) o.push(n);
    }),
  );
  return o;
};
const somaItem = (rows, n) => rows.reduce((a, r) => a + (qtdU(U[r.id])[n] || 0), 0);
function quantTable(d, c) {
  const { rows, P_ } = c;
  const its = itensPdf(rows).slice(0, 12);
  if (!its.length) return;
  d.h2('Quantitativo por mês', 'Equipamentos a instalar nas agências planejadas em cada mês');
  const w = Math.max(46, Math.min(110, (d.CW - 260) / its.length));
  const cols = [
    { h: 'Mês', w: 70 },
    { h: 'Período de instalação', w: 130 },
    { h: 'Agências', w: 60, a: 'r' },
    ...its.map((n) => ({ h: n, w, a: 'r' })),
  ];
  const sobra = d.CW - cols.reduce((a, x) => a + x.w, 0);
  if (sobra > 0) cols[1] = Object.assign({}, cols[1], { w: cols[1].w + sobra });
  const data = P_.months.map((m) => {
    const mr = rows.filter((r) => r.mon === m.key);
    return {
      c: [
        { t: fm(m.key), b: true },
        mr.length ? fs(minD(mr, (r) => r.d0)) + ' a ' + fd(maxD(mr, (r) => r.d1)) : '—',
        mr.length,
        ...its.map((n) => somaItem(mr, n).toLocaleString('pt-BR')),
      ],
    };
  });
  data.push({ total: true, c: ['Total', '', rows.length, ...its.map((n) => somaItem(rows, n).toLocaleString('pt-BR'))] });
  d.table(cols, data);
}
function agenciasMes(d, c) {
  const { rows, P_ } = c;
  const ms = P_.months;
  if (!ms.length) return;
  const H = 150,
    top = d.y;
  if (top + H + 40 > d.BOT) d.newPage();
  d.h2('Total de agências por mês', rows.length + ' agências no plano · ' + ms.length + ' mês(es) · barra cheia = concluídas');
  const y0 = d.y + 14,
    ch = H - 44,
    base = y0 + ch,
    x0 = d.M + 26,
    w = d.CW - 26;
  const vals = ms.map((m) => {
    const mr = rows.filter((r) => r.mon === m.key);
    return { m, n: mr.length, ok: mr.filter((r) => stOf(r.id) === 'Concluída').length, cam: sumBy(mr, (r) => U[r.id].c) };
  });
  const mx = Math.max(1, ...vals.map((v) => v.n));
  const step = mx <= 10 ? 2 : mx <= 25 ? 5 : mx <= 60 ? 10 : 20;
  const top2 = Math.ceil(mx / step) * step;
  for (let t = 0; t <= top2; t += step) {
    const y = base - (ch * t) / top2;
    d.line(x0, y, x0 + w, y, PX.line, t ? 0.4 : 0.8);
    d.text(String(t), x0 - 5, y + 2.5, { size: 6.5, color: PX.muted, align: 'r' });
  }
  const slot = w / vals.length,
    bw = Math.min(46, slot * 0.62);
  vals.forEach((v, i) => {
    const cx = x0 + slot * i + slot / 2,
      h = (ch * v.n) / top2,
      ho = (ch * v.ok) / top2;
    if (v.n) {
      d.rect(cx - bw / 2, base - h, bw, h, { fill: PX.asoft, stroke: PX.accent, bw: 0.7 });
      if (v.ok) d.rect(cx - bw / 2, base - ho, bw, ho, { fill: PX.accent });
    }
    d.text(String(v.n), cx, base - h - 4, { size: 8.5, bold: true, align: 'c' });
    d.text(fm(v.m.key), cx, base + 11, { size: 7.5, bold: true, align: 'c', maxW: slot - 2 });
    d.text(v.ok ? v.ok + ' concl.' : v.cam ? v.cam + ' câm.' : '', cx, base + 21, {
      size: 6.5,
      color: v.ok ? PX.ok : PX.muted,
      align: 'c',
      maxW: slot - 2,
    });
  });
  d.y = base + 30;
}
function schedulePages(d, c) {
  const { rows, P_ } = c;
  d.newPage();
  agenciasMes(d, c);
  d.h2(
    'Cronograma mensal',
    plan === 'M' && cfg.encaixar
      ? 'Agências que cabem em cada mês'
      : plan === 'M'
        ? `Meta exata de ${quota()} agências por mês`
        : 'Planejamento contínuo',
  );
  const fixed = [
    { h: 'Mês', w: 62 },
    { h: 'Período de instalação', w: 112 },
    { h: 'Meta', w: 36, a: 'r' },
    { h: 'Planejadas', w: 52, a: 'r' },
    { h: 'Câmeras', w: 46, a: 'r', hide: !RP_CAM },
  ];
  const ts = [...Array(k).keys()].map((i) => i + 1);
  const rest = d.CW - sumBy(fixed, (x) => x.w) - 58;
  const obs = Math.max(110, rest - ts.length * 40),
    tw = (rest - obs) / ts.length;
  const cols = [
    ...fixed,
    ...ts.map((t) => ({ h: `Eq. ${t}`, w: tw, a: 'c' })),
    { h: 'Concluídas', w: 58, a: 'r' },
    { h: 'Observação', w: obs },
  ];
  const data = P_.months.map((m) => {
    const mr = rows.filter((r) => r.mon === m.key);
    const dn = mr.filter((r) => stOf(r.id) === 'Concluída').length;
    const ov = (m.teams || []).filter((t) => t.over).map((t) => t.team);
    return {
      c: [
        { t: fm(m.key), b: true },
        mr.length ? `${fs(minD(mr, (r) => r.d0))} a ${fd(maxD(mr, (r) => r.d1))}` : '—',
        m.quota || '—',
        mr.length,
        sumBy(mr, (r) => U[r.id].c),
        ...ts.map((t) => mr.filter((r) => r.team === t).length || '—'),
        { t: dn, color: dn ? PX.ok : PX.ink },
        ov.length ? { t: `Equipe ${ov.join(', ')} passa do fim do mês`, color: PX.warn } : m.back ? `${m.back} remanejada(s)` : '—',
      ],
    };
  });
  data.push({
    total: true,
    c: [
      'Total',
      '',
      plan === 'M' ? '' : '—',
      rows.length,
      sumBy(rows, (r) => U[r.id].c).toLocaleString('pt-BR'),
      ...ts.map((t) => rows.filter((r) => r.team === t).length),
      rows.filter((r) => stOf(r.id) === 'Concluída').length,
      '',
    ],
  });
  d.table(cols, data);
  quantTable(d, c);
  d.h2('Situação das agências', (cfg.states || []).length ? `Estados: ${cfg.states.join(', ')}` : 'Todas as agências do plano');
  const ids = rows.map((r) => r.id);
  const tl = [
    ...STATUS.map((s) => ({ l: s, v: String(ids.filter((id) => stOf(id) === s).length), c: PSC[s] })),
    ...LIC.map((x) => ({ l: 'Licença ' + x, v: String(ids.filter((id) => lcOf(id) === x).length), c: PLC[x] })),
  ];
  const rowsN = Math.ceil(tl.length / 6);
  if (d.y + rowsN * 46 > d.BOT) d.newPage();
  d.tiles(tl, d.M, d.y, d.CW, 40, 6, 6);
  d.y += rowsN * 46 + 12;
  d.h2('Agências por estado');
  const ufs = [...new Set(rows.map((r) => U[r.id].uf))].sort();
  d.table(
    [
      { h: 'UF', w: 50 },
      { h: 'Agências', w: 70, a: 'r' },
      { h: 'Câmeras', w: 70, a: 'r', hide: !RP_CAM },
      { h: 'Concluídas', w: 70, a: 'r' },
      { h: 'Equipes', w: 120 },
      { h: 'Meses de instalação', w: d.CW - 380 },
    ],
    ufs.map((uf) => {
      const a = rows.filter((r) => U[r.id].uf === uf);
      return {
        c: [
          { t: uf, b: true },
          a.length,
          sumBy(a, (r) => U[r.id].c),
          a.filter((r) => stOf(r.id) === 'Concluída').length,
          [...new Set(a.map((r) => r.team))]
            .sort((x, y) => x - y)
            .map((t) => 'Eq. ' + t)
            .join(', '),
          [...new Set(a.map((r) => r.mon))].sort().map(fm).join(', '),
        ],
      };
    }),
  );
}
const DCOLS = () => [
  { h: 'Seq', w: 20, a: 'c' },
  { h: 'Agência', w: 92 },
  { h: 'Endereço', w: 150 },
  { h: 'Município/UF', w: 80 },
  { h: 'Câm.', w: 26, a: 'r', hide: !RP_CAM },
  { h: 'Km', w: 32, a: 'r' },
  { h: 'Dias', w: 30, a: 'r' },
  { h: 'Entrega', w: 52, a: 'c' },
  { h: 'Início', w: 48, a: 'c' },
  { h: 'Fim', w: 48, a: 'c' },
  { h: 'Status', w: 72 },
  { h: 'Licença', w: 52 },
  { h: 'Patrimônio', w: 68 },
];
async function monthSection(d, c, m, alone) {
  const { rows, P_, S0 } = c,
    M = d.M;
  d.newPage();
  const mr = rows.filter((r) => r.mon === m.key);
  const ts = [...new Set(mr.map((r) => r.team))].sort((a, b) => a - b);
  const cams = sumBy(mr, (r) => U[r.id].c),
    km = sumBy(mr, (r) => r.km),
    dn = mr.filter((r) => stOf(r.id) === 'Concluída').length;
  const idx = P_.months.findIndex((x) => x.key === m.key);
  d.text(`Mês ${idx + 1} de ${P_.months.length}`.toUpperCase(), M, 56, { size: 7.5, bold: true, color: PX.accent });
  d.text(fml(m.key), M, 76, { size: 20, bold: true });
  d.text(
    mr.length
      ? `${mr.length} agências${RP_CAM ? ' · ' + cams + ' câmeras' : ''} · ${ts.length} equipe${ts.length > 1 ? 's' : ''} · despacho a partir de ${fd(minD(mr, (r) => r.disp))} · instalação de ${fd(minD(mr, (r) => r.d0))} a ${fd(maxD(mr, (r) => r.d1))}`
      : 'Nenhuma agência neste mês',
    M,
    92,
    { size: 9, color: PX.muted, maxW: d.CW },
  );
  if (alone)
    d.text(
      `Cenário: ${st === 'O' ? 'rota otimizada' : 'por estados'} · ${k} equipes · ${MODES[mode]} · ${plan === 'M' ? `meta ${quota()} agências/mês` : 'contínuo'} · início do plano ${fd(S0)}${(cfg.states || []).length ? ' · estados ' + cfg.states.join(', ') : ''}`,
      M,
      105,
      { size: 7.5, color: PX.muted, maxW: d.CW },
    );
  const my = 114,
    mw = 430,
    mh = d.BOT - my - 14;
  await d.image(await svgPng(mapSVG(mr, { bw: mw, bh: mh, numbers: true }), mw, mh), M, my, mw, mh);
  d.text('Número = ordem de visita da equipe · cor = equipe · verde = concluída · tracejado = saída de ' + RP_BASE, M, my + mh + 10, {
    size: 6.8,
    color: PX.muted,
    maxW: mw,
  });
  const rx = M + mw + 16,
    rw = d.CW - mw - 16;
  d.tiles(
    [
      { l: 'Agências', v: plan === 'M' && m.quota ? `${mr.length} / meta ${m.quota}` : String(mr.length), hl: true },
      RP_CAM ? { l: 'Câmeras', v: String(cams) } : { l: 'Equipes', v: String(ts.length) },
      { l: 'Km estimados', v: Math.round(km).toLocaleString('pt-BR') + ' km' },
      { l: 'Concluídas', v: `${dn} (${mr.length ? Math.round((dn * 100) / mr.length) : 0}%)`, c: PX.ok },
    ],
    rx,
    my,
    rw,
    40,
    2,
  );
  let y = my + 40 * 2 + 8 + 20;
  d.text('Equipes do mês', rx, y, { size: 11, bold: true });
  y += 8;
  const avail = d.BOT - y,
    bh = Math.min(50, avail / Math.max(1, ts.length)),
    three = bh >= 38;
  ts.forEach((t) => {
    const a = mr.filter((r) => r.team === t).sort((p, q) => p.seq - q.seq),
      tt = (m.teams || []).find((x) => x.team === t);
    d.rect(rx, y + 2, rw, bh - 5, { fill: mixW(tcol(t), 0.08) });
    d.rect(rx, y + 2, 4, bh - 5, { fill: tcol(t) });
    d.text(
      `Equipe ${t} — ${a.length} agência${a.length > 1 ? 's' : ''}${RP_CAM ? ' · ' + sumBy(a, (r) => U[r.id].c) + ' câmeras' : ''}`,
      rx + 11,
      y + 13,
      { size: 8.5, bold: true, maxW: rw - 16 },
    );
    d.text(
      `Despacho ${fs(minD(a, (r) => r.disp))} · instalação ${fs(minD(a, (r) => r.d0))} a ${fs(maxD(a, (r) => r.d1))} · ${fmt(sumBy(a, (r) => r.km))} km${tt && tt.over ? ' · atenção: passa do fim do mês' : ''}`,
      rx + 11,
      y + 24,
      { size: 7.3, color: tt && tt.over ? PX.warn : PX.muted, maxW: rw - 16 },
    );
    if (three)
      d.text('Roteiro: ' + a.map((r) => `${r.seq}. ${U[r.id].m}/${U[r.id].uf}`).join('  ›  '), rx + 11, y + 35, {
        size: 6.8,
        maxW: rw - 16,
      });
    y += bh;
  });
  d.newPage();
  d.h2(`Detalhamento — ${fml(m.key)}`, 'Datas previstas pelo plano · status, licença e patrimônio conforme o controle atual');
  {
    const its = itensPdf(mr);
    if (its.length) {
      d.text('Quantitativo do mês', d.M, d.y + 4, { size: 9, bold: true });
      d.y += 10;
      const n = Math.min(its.length, 8);
      d.tiles(
        [
          { l: 'Agências', v: String(mr.length), hl: true },
          ...its.slice(0, n - 1 + (its.length <= 7 ? 1 : 0)).map((x) => ({ l: x, v: somaItem(mr, x).toLocaleString('pt-BR') })),
        ],
        d.M,
        d.y,
        d.CW,
        36,
        Math.min(8, 1 + Math.min(its.length, 7)),
        6,
      );
      d.y += 48;
    }
  }
  const data = [];
  ts.forEach((t) => {
    const a = mr.filter((r) => r.team === t).sort((p, q) => p.seq - q.seq);
    data.push({
      group: `Equipe ${t} · ${a.length} agências${RP_CAM ? ' · ' + sumBy(a, (r) => U[r.id].c) + ' câmeras' : ''} · ${fmt(sumBy(a, (r) => r.km))} km · instalação de ${fd(minD(a, (r) => r.d0))} a ${fd(maxD(a, (r) => r.d1))}`,
      color: tcol(t),
    });
    a.forEach((r) => {
      const un = U[r.id],
        s = stOf(r.id),
        l = lcOf(r.id);
      data.push({
        c: [
          r.seq,
          { t: un.n, b: true },
          un.ad || '—',
          `${un.m}/${un.uf}`,
          un.c,
          fmt(r.km),
          fmt(r.H),
          mode === 'B' ? 'c/ técnico' : r.semData ? '—' : fd(r.deliv),
          fd(r.d0),
          fd(r.d1),
          { t: s, dot: PSC[s] },
          { t: l, dot: PLC[l] },
          pat[r.id] || '—',
        ],
      });
    });
  });
  d.table(DCOLS(), data);
}
async function buildPdf(L, which) {
  const pdf = await L.PDFDocument.create();
  const F = await pdf.embedFont(L.StandardFonts.Helvetica),
    B = await pdf.embedFont(L.StandardFonts.HelveticaBold);
  const d = makeDoc(L, pdf, F, B),
    c = pdfCtx(),
    now = new Date();
  const gen = now.toLocaleDateString('pt-BR') + ' ' + now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  pdf.setAuthor('L&K Tecnologia');
  pdf.setCreator('Rotas ' + RP_NOME);
  pdf.setProducer('Rotas ' + RP_NOME);
  if (which === 'all') {
    pdf.setTitle('Plano de rotas ' + RP_NOME + ' — visão geral completa');
    d.sub = 'Visão geral completa';
    await coverPage(d, c);
    schedulePages(d, c);
    addressPages(d, c);
    for (const m of c.P_.months) {
      d.sub = `Visão geral completa · ${fml(m.key)}`;
      await monthSection(d, c, m, false);
    }
  } else {
    const m = c.P_.months.find((x) => x.key === which);
    if (!m) throw new Error('Este mês não está mais no plano atual');
    pdf.setTitle(`Plano de rotas ${RP_NOME} — ${fml(m.key)}`);
    d.sub = `Plano do mês · ${fml(m.key)}`;
    await monthSection(d, c, m, true);
  }
  d.footer(gen);
  return await pdf.save();
}
const DLMSG = {
  declined: 'Download cancelado na confirmação.',
  rate_limited: 'Já existe uma confirmação de download aberta. Conclua e tente de novo.',
  too_large: 'O arquivo ficou grande demais para este download.',
};
function anchorSave(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 60000);
}
async function deliverFile(bytes, name) {
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const dl = await dlP;
  if (dl) {
    try {
      await dl.save({ filename: name, data: blob });
      toast('PDF salvo: ' + name);
      return;
    } catch (e) {
      const code = e && e.code;
      if (DLMSG[code]) {
        toast(DLMSG[code]);
        return;
      }
      if (code === 'not_granted' || code === 'capability_disabled') {
        showDlHelp(name, blob, 'Os downloads desta página não estão liberados para você.');
        return;
      }
      showDlHelp(name, blob, `O Claude não conseguiu entregar o arquivo (${code || 'erro'}).`);
      return;
    }
  }
  anchorSave(blob, name);
  toast('PDF baixado: ' + name);
}
function showDlHelp(name, blob, why) {
  openOv(() => {
    ovb.innerHTML = `<header><h2 id="ov-t">Baixar PDF</h2><button type="button" class="x">Fechar</button></header>
  <p>${why ? esc(why) + ' ' : ''}O PDF <b>${esc(name)}</b> está pronto (${Math.round(blob.size / 1024)} KB).</p>
  <p><button type="button" class="act on" id="dl-try">Baixar agora</button> <button type="button" class="act ghost" id="dl-perm">Liberar downloads desta página</button></p>
  <p class="hint">Se nada acontecer: entre no Claude com sua conta e abra o painel pelo link compartilhado (não por um arquivo salvo); confira em <b>Permissões</b> da página se “downloads” está permitido; e veja se o navegador não bloqueou o download (ícone na barra de endereço).</p>`;
    ovb.querySelector('.x').onclick = closeOv;
    ovb.querySelector('#dl-try').onclick = () => {
      anchorSave(blob, name);
      toast('Download iniciado — confira a pasta de downloads');
    };
    ovb.querySelector('#dl-perm').onclick = async () => {
      try {
        const pm = await window.claude?.use?.('permissions');
        if (!pm) throw 0;
        await pm.manage();
        const dl = await dlP;
        if (dl) {
          await dl.save({ filename: name, data: blob });
          toast('PDF salvo: ' + name);
          closeOv();
        }
      } catch (e) {
        toast(e && e.code && DLMSG[e.code] ? DLMSG[e.code] : 'Abra o menu Permissões da página e permita downloads.');
      }
    };
  });
}
async function makePdf(which) {
  if (pdfBusy) return;
  pdfBusy = true;
  drawPdfBar(which);
  try {
    const L = await loadPdfLib();
    const bytes = await buildPdf(L, which);
    await deliverFile(
      bytes,
      which === 'all' ? 'Plano_Rotas_' + RP_ARQ + '_Visao_Geral.pdf' : `Plano_Rotas_${RP_ARQ}_${fm(which).replace('/', '-')}.pdf`,
    );
  } catch (e) {
    toast(e && e.message ? e.message : 'Não foi possível gerar o PDF');
  } finally {
    pdfBusy = false;
    drawPdfBar();
  }
}
function drawPdfBar(busy) {
  const pb = document.getElementById('pdfbar');
  if (!pb || !PLAN) return;
  const ms = PLAN.months;
  const b = (key, label, cls) =>
    `<button type="button" class="act ${cls}" data-pdf="${key}"${pdfBusy ? ' disabled' : ''}>${busy === key ? 'Gerando…' : label}</button>`;
  pb.innerHTML = `<span class="lbl">Gerar PDF para o cliente</span><div class="pdfbtns">${b('all', DOC + ' Visão geral completa', 'on')}${ms.map((m) => b(m.key, fm(m.key), 'ghost')).join('')}</div>`;
  pb.querySelectorAll('[data-pdf]').forEach((x) => (x.onclick = () => makePdf(x.dataset.pdf)));
}
