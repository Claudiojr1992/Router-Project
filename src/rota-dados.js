// Monta os dados do Painel de rotas para um cliente (projeto).
// - BNB (todos os endereços vindos da planilha original, com ref_id): usa src/data/mapdata.json (distâncias de estrada já calculadas).
// - Demais clientes: gera tudo a partir dos endereços do banco (coordenadas, distâncias estimadas, rotas por equipe).
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let MAPDATA = null, MUN = null, AER = null;
const mapdata = () => (MAPDATA = MAPDATA || JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'mapdata.json'), 'utf8')));
const aeroportos = () => (AER = AER || JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'aeroportos.json'), 'utf8')));

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function municipios() {
  if (MUN) return MUN;
  MUN = new Map();
  for (const [nome, uf, la, lo] of JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'municipios.json'), 'utf8'))) {
    MUN.set(`${norm(nome)}|${uf}`, { la, lo, nome });
  }
  return MUN;
}

// Coordenadas do centro do município (quando o endereço não tem latitude/longitude)
function coordMunicipio(nome, uf) {
  return municipios().get(`${norm(nome)}|${String(uf || '').toUpperCase()}`) || null;
}

const RAD = Math.PI / 180;
function haversine(la1, lo1, la2, lo2) {
  const a = Math.sin((la2 - la1) * RAD / 2) ** 2 + Math.cos(la1 * RAD) * Math.cos(la2 * RAD) * Math.sin((lo2 - lo1) * RAD / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}
const FATOR_ESTRADA = 1.3; // distância de estrada ≈ linha reta × 1,3
const estrada = (la1, lo1, la2, lo2) => Math.round(haversine(la1, lo1, la2, lo2) * FATOR_ESTRADA);

function aeroportoProximo(la, lo) {
  let best = null;
  for (const [nome, ala, alo] of aeroportos()) {
    const d = estrada(la, lo, ala, alo);
    if (!best || d < best.km) best = { nome, km: d };
  }
  return best;
}

// Feriados nacionais (inclui Carnaval, Sexta-feira Santa e Corpus Christi)
function pascoa(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31), dia = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(y, mes - 1, dia));
}
function feriados(y0, y1) {
  const out = [];
  const iso = (d) => d.toISOString().slice(0, 10);
  const mais = (d, n) => new Date(d.getTime() + n * 86400000);
  for (let y = y0; y <= y1; y++) {
    const p = pascoa(y);
    out.push(`${y}-01-01`, iso(mais(p, -48)), iso(mais(p, -47)), iso(mais(p, -2)), `${y}-04-21`, `${y}-05-01`, iso(mais(p, 60)),
      `${y}-09-07`, `${y}-10-12`, `${y}-11-02`, `${y}-11-15`, `${y}-11-20`, `${y}-12-25`);
  }
  return [...new Set(out)].sort();
}

function proximoDiaUtil(hol) {
  const d = new Date(); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() + 1);
  const H = new Set(hol);
  while ([0, 6].includes(d.getUTCDay()) || H.has(d.toISOString().slice(0, 10))) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// Cadeia do vizinho mais próximo, saindo da base (id 0)
function cadeia(ids, KM) {
  const rest = new Set(ids), out = [];
  let cur = 0;
  while (rest.size) {
    let b = null, bd = Infinity;
    for (const id of rest) { const d = KM[cur][id]; if (d < bd) { bd = d; b = id; } }
    out.push(b); rest.delete(b); cur = b;
  }
  return out;
}

// Divide uma lista ordenada em k pedaços de tamanho parecido
function fatiar(lista, k) {
  const out = []; let p = 0;
  for (let j = 0; j < k; j++) { const n = Math.floor(lista.length / k) + (j < lista.length % k ? 1 : 0); out.push(lista.slice(p, p + n)); p += n; }
  return out.filter((x) => x.length);
}

const BASE_PADRAO = { nome: 'Fortaleza/CE', la: -3.73, lo: -38.53 };

/**
 * @param cliente {id, nome, base_nome, base_lat, base_lon}
 * @param enderecos [{id, ref_id, nome, municipio, uf, lat, lon, cameras, aeroporto, km_aeroporto, codigo}]
 */
// BNB original: todos os endereços com ref_id, cobrindo as unidades da planilha, e sem base própria
function ehEstatico(cliente, enderecos) {
  if (!enderecos.length || cliente.base_lat != null || !enderecos.every((e) => e.ref_id)) return false;
  const refs = new Set(enderecos.map((e) => e.ref_id));
  return mapdata().units.every((u) => refs.has(u.id));
}

// Dias de trabalho no endereço pelas atividades do contrato:
// soma das atividades "soma"; as "em paralelo" só contam se forem maiores que essa soma; "sem impacto" não conta
const HORAS_DIA = 8;
function diasAtividades(atividades, cameras) {
  let soma = 0, par = 0;
  for (const a of atividades || []) {
    if (a.tempo_impacto === 'nenhum') continue;
    let d = 0;
    if (a.tempo_modo === 'por_camera') d = ((a.min_por_camera || 0) * (cameras || 0)) / 60 / HORAS_DIA;
    else if (a.tempo_modo === 'faixa') { const f = (a.faixas || []).find((x) => x.ate == null || (cameras || 0) <= x.ate); d = f ? +f.dias : 0; }
    else d = a.tempo_unidade === 'hora' ? (+a.tempo_qtd || 0) / HORAS_DIA : (+a.tempo_qtd || 0);
    if (a.tempo_impacto === 'paralelo') par = Math.max(par, d); else soma += d;
  }
  const t = Math.max(soma, par);
  return t > 0 ? Math.max(0.5, Math.ceil(t * 2) / 2) : 0;
}

// extra = { etapas: [{id, nome, data_inicio}], atividades: {contrato_id: [...]}}
function infoEtapas(extra) {
  return (extra && extra.etapas || []).map((e) => ({ id: e.id, nome: e.nome, inicio: e.data_inicio, mes: String(e.data_inicio).slice(0, 7) }));
}

// Do cadastro: equipe (tm), início previsto (di) e data de conclusão manual (ok = sai do plano)
const dia = (d) => (d ? String(d).slice(0, 10) : null);
const itensTxt = (its) => (typeof its === 'string' ? JSON.parse(its || '[]') : its || []).filter((i) => i.quantidade > 0).map((i) => `${i.nome} ${i.quantidade}`).join(' · ');
const plano = (e) => ({ tm: e.equipe || null, di: dia(e.inicio_previsto), ok: dia(e.concluido_em), de: dia(e.entrega_material), dd: dia(e.despacho_material), ml: e.modo_logistico || null, gf: e.geo_fonte || null,
  df: dia(e.fim_previsto), dp: e.dias_previstos != null ? +e.dias_previstos : null,
  cd: e.codigo || null, ad: [e.logradouro, e.bairro, e.cep].filter(Boolean).join(' · ') || null, it: e.itens ? itensTxt(e.itens) || null : null,
  q: e.itens ? Object.fromEntries((typeof e.itens === 'string' ? JSON.parse(e.itens || '[]') : e.itens).filter((i) => i.quantidade > 0).map((i) => [i.nome, i.quantidade])) : null });

function montarDados(cliente, enderecos, extra = {}) {
  const ativ = extra.atividades || {};
  const dias = (e) => diasAtividades(ativ[e.contrato_id], e.cameras);
  const etapas = infoEtapas(extra);
  if (ehEstatico(cliente, enderecos)) {
    const md = mapdata();
    const porRef = new Map(enderecos.map((e) => [e.ref_id, e]));
    const units = md.units.filter((u) => porRef.get(u.id)?.na_rota !== false)
      .map((u) => {
        const e = porRef.get(u.id);
        if (!e) return u;
        // nome, município, UF e câmeras vêm do cadastro (editáveis); a posição só muda se o cadastro tiver coordenada própria
        const pos = e.geo_fonte && e.lat != null && e.lon != null ? { la: +(+e.lat).toFixed(4), lo: +(+e.lon).toFixed(4) } : {};
        return { ...u, n: e.nome || u.n, m: e.municipio || u.m, uf: String(e.uf || u.uf).toUpperCase(), c: e.cameras ?? u.c, ...pos, et: e.etapa_id || null, eo: e.ordem_etapa || null, d: dias(e), ...plano(e) };
      });
    // rotas pré-calculadas da planilha: tira os endereços fora da rota
    const fora = new Set(enderecos.filter((e) => e.na_rota === false).map((e) => e.ref_id));
    const semFora = (g) => (fora.size ? Object.fromEntries(Object.entries(g).map(([k, ps]) => [k, ps.map((p) => p.filter((id) => !fora.has(id)))])) : g);
    return { ...md, O: semFora(md.O), E: semFora(md.E), B: semFora(md.B), units, estatico: true, titulo: cliente.nome, base: BASE_PADRAO, semCoord: [], etapas, equipes: cliente.equipes || null };
  }

  const base = cliente.base_lat != null && cliente.base_lon != null
    ? { nome: cliente.base_nome || 'Base', la: +cliente.base_lat, lo: +cliente.base_lon } : BASE_PADRAO;

  const semCoord = [];
  const units = [];
  for (const e of enderecos) {
    if (e.na_rota === false) continue;
    let la = e.lat, lo = e.lon, aprox = false;
    if (la == null || lo == null) {
      const c = coordMunicipio(e.municipio, e.uf);
      if (!c) { semCoord.push({ id: e.id, nome: e.nome, municipio: e.municipio, uf: e.uf }); continue; }
      la = c.la; lo = c.lo; aprox = true;
    }
    const aer = e.aeroporto ? { nome: e.aeroporto, km: e.km_aeroporto ?? aeroportoProximo(la, lo).km } : aeroportoProximo(la, lo);
    units.push({ id: e.id, n: e.nome, m: e.municipio, uf: String(e.uf || '').toUpperCase(), la: +(+la).toFixed(4), lo: +(+lo).toFixed(4), c: e.cameras || 0, ka: aer.km, ap: aer.nome, aprox, et: e.etapa_id || null, eo: e.ordem_etapa || null, d: dias(e), ...plano(e) });
  }

  // endereços no mesmo ponto (ex.: várias agências pelo centro do mesmo município): espalha em um pequeno círculo (~1,5 km)
  const mesmos = new Map();
  for (const u of units) { const k = `${u.la}|${u.lo}`; if (!mesmos.has(k)) mesmos.set(k, []); mesmos.get(k).push(u); }
  for (const g of mesmos.values()) {
    if (g.length < 2) continue;
    g.forEach((u, i) => { const a = (2 * Math.PI * i) / g.length; u.la = +(u.la + 0.014 * Math.sin(a)).toFixed(4); u.lo = +(u.lo + 0.014 * Math.cos(a)).toFixed(4); });
  }

  // endereço praticamente em cima da base (mesma cidade, sem coordenada): afasta um pouco para não ficar escondido sob a estrela
  for (const u of units) {
    if (haversine(u.la, u.lo, base.la, base.lo) < 0.8) { u.la = +(u.la - 0.02).toFixed(4); u.lo = +(u.lo + 0.03).toFixed(4); }
  }

  // matriz de distâncias (0 = base de saída)
  const KM = { 0: { 0: 0 } };
  for (const u of units) { KM[0][u.id] = estrada(base.la, base.lo, u.la, u.lo); KM[u.id] = { 0: KM[0][u.id] }; }
  for (let i = 0; i < units.length; i++) {
    for (let j = i + 1; j < units.length; j++) {
      const a = units[i], b = units[j]; const d = estrada(a.la, a.lo, b.la, b.lo);
      KM[a.id][b.id] = d; KM[b.id][a.id] = d;
    }
    KM[units[i].id][units[i].id] = 0;
  }

  // dias de transporte do material por estado (estimativa pela distância da base)
  const tr = {};
  const porUf = {};
  for (const u of units) (porUf[u.uf] = porUf[u.uf] || []).push(u);
  for (const [uf, us] of Object.entries(porUf)) {
    const km = us.reduce((s, u) => s + KM[0][u.id], 0) / us.length;
    tr[uf] = Math.min(10, 2 + Math.round(km / 500));
  }

  // rotas pré-montadas para 1 a 8 equipes
  const cs = Math.cos(((base.la + (units.reduce((s, u) => s + u.la, 0) / (units.length || 1))) / 2) * RAD);
  const ang = (u) => Math.atan2(u.la - base.la, (u.lo - base.lo) * cs);
  const porAng = units.slice().sort((a, b) => ang(a) - ang(b));
  const angUf = {};
  for (const [uf, us] of Object.entries(porUf)) angUf[uf] = Math.atan2(us.reduce((s, u) => s + u.la, 0) / us.length - base.la, (us.reduce((s, u) => s + u.lo, 0) / us.length - base.lo) * cs);
  const porEstado = units.slice().sort((a, b) => (angUf[a.uf] - angUf[b.uf]) || (ang(a) - ang(b)));
  const O = {}, E = {};
  for (let k = 1; k <= 8; k++) {
    O[k] = fatiar(porAng.map((u) => u.id), k).map((g) => cadeia(g, KM));
    E[k] = fatiar(porEstado.map((u) => u.id), k).map((g) => cadeia(g, KM));
    while (O[k].length < k) O[k].push([]);
    while (E[k].length < k) E[k].push([]);
  }

  const ano = new Date().getUTCFullYear();
  const hol = feriados(ano, ano + 3);
  const P = { ...mapdata().P, START: proximoDiaUtil(hol) };

  return { units, km: KM, tr, hol, O, E, B: {}, links: {}, P, estatico: false, titulo: cliente.nome, base, semCoord, etapas, equipes: cliente.equipes || null };
}

const parametros = () => mapdata().P;

module.exports = { montarDados, ehEstatico, diasAtividades, coordMunicipio, aeroportoProximo, norm, cadeia, fatiar, feriados, parametros, BASE_PADRAO };
