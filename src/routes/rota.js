// Painel de rotas por cliente (projeto): página do painel, status/licença/patrimônio e configuração do plano
const fs = require('fs');
const path = require('path');
const db = require('../db');
const v = require('../validate');
const { HttpError } = require('../http');
const { requer, loadUser, ESCRITORIO } = require('../auth');
const { montarDados, ehEstatico, cadeia, fatiar } = require('../rota-dados');
const { makeEngine } = require('../../public/painel/engine');
const config = require('../config');
const { aplicarPlano, parseDia, MAX_EQUIPES, REGRA_PADRAO, carregarRegras, regraDe, diasEndereco, calendario, recalcularPrevisao } = require('../plano');

const COLS = {
  status: { coluna: 'status', campo: 's', valores: ['A iniciar', 'Configurado', 'Em transporte', 'Material entregue', 'Em execução', 'Em validação', 'Faturado', 'Handover', 'Concluída'] },
  licenca: { coluna: 'licenca', campo: 'l', valores: ['Provisória', 'Definitiva'] },
  patrimonio: { coluna: 'patrimonio', campo: 'p', valores: null },
};
const TPL = path.join(__dirname, '..', 'views', 'painel.html');
// versão dos arquivos do painel (muda quando algum arquivo muda: o navegador baixa de novo)
function versaoPainel() {
  const dir = path.join(__dirname, '..', '..', 'public', 'painel');
  return fs.readdirSync(dir).reduce((a, f) => Math.max(a, fs.statSync(path.join(dir, f)).mtimeMs), 0).toString(36).slice(0, 8);
}
let tplCache = null;

async function carregar(clienteId) {
  const cliente = await db.one(`SELECT id, nome, base_nome, base_lat, base_lon, equipes FROM clientes WHERE id = $1`, [clienteId]);
  if (!cliente) throw new HttpError(404, 'Cliente não encontrado');
  const enderecos = await db.many(
    `SELECT e.id, e.ref_id, e.codigo, e.nome, e.municipio, e.uf, e.lat, e.lon, e.cameras, e.aeroporto, e.km_aeroporto, e.etapa_id, e.ordem_etapa, e.contrato_id,
            e.equipe, e.inicio_previsto, e.concluido_em, e.status, e.fim_previsto, e.dias_previstos, e.logradouro, e.bairro, e.cep, e.entrega_material, e.na_rota, e.despacho_material, e.modo_logistico, e.geo_fonte,
            COALESCE((SELECT json_agg(json_build_object('nome', ci.nome, 'quantidade', ei.quantidade) ORDER BY ci.ordem, ci.id)
                        FROM endereco_itens ei JOIN contrato_itens ci ON ci.id = ei.item_id WHERE ei.endereco_id = e.id AND ei.quantidade > 0), '[]') AS itens
       FROM enderecos e JOIN contratos ct ON ct.id = e.contrato_id
      WHERE ct.cliente_id = $1 AND ct.status <> 'encerrado' ORDER BY e.id`, [clienteId]);
  const [etapas, ativs] = await Promise.all([
    db.many(`SELECT id, nome, data_inicio FROM etapas WHERE cliente_id = $1 ORDER BY data_inicio, ordem, id`, [clienteId]),
    db.many(`SELECT a.contrato_id, a.tempo_modo, a.tempo_qtd, a.tempo_unidade, a.min_por_camera, a.faixas, a.tempo_impacto
               FROM atividades a JOIN contratos ct ON ct.id = a.contrato_id WHERE ct.cliente_id = $1 AND a.ativo`, [clienteId]),
  ]);
  const atividades = {};
  for (const a of ativs) (atividades[a.contrato_id] = atividades[a.contrato_id] || []).push(a);
  // endereços marcados "fora da rota" não entram no painel nem na distribuição
  return { cliente, enderecos: enderecos.filter((e) => e.na_rota !== false), foraRota: enderecos.filter((e) => e.na_rota === false).length,
    dados: montarDados(cliente, enderecos, { etapas, atividades }) };
}

// No modo BNB (dados da planilha original) a unidade é identificada pelo ref_id; nos demais, pelo id do endereço
async function chaveSql(clienteId) {
  const cliente = await db.one(`SELECT id, base_lat FROM clientes WHERE id = $1`, [clienteId]);
  if (!cliente) throw new HttpError(404, 'Cliente não encontrado');
  const ends = await db.many(`SELECT e.ref_id FROM enderecos e JOIN contratos ct ON ct.id = e.contrato_id
                               WHERE ct.cliente_id = $1 AND ct.status <> 'encerrado'`, [clienteId]);
  return ehEstatico(cliente, ends) ? 'e.ref_id' : 'e.id';
}

// Próximo dia útil (sem fim de semana e feriado) a partir de uma data ISO
function diaUtil(iso, hol) {
  const H = new Set(hol || []);
  const d = new Date(iso + 'T00:00:00Z');
  while ([0, 6].includes(d.getUTCDay()) || H.has(d.toISOString().slice(0, 10))) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

const PRE_EXEC = ['A iniciar', 'Configurado', 'Em transporte', 'Material entregue'];
const CONCL = `(e.concluido_em IS NOT NULL OR e.status = 'Concluída')`;
const umDia = (iso) => new Date(new Date(iso + 'T00:00:00Z').getTime() + 86400000).toISOString().slice(0, 10);

// Distribuição dos endereços em aberto entre as equipes, com as regras de cada equipe
//  - divide por região a partir da base (setores começando no maior vazio), proporcional à capacidade de cada equipe
//  - rota de cada equipe pelo vizinho mais próximo (ordem na etapa primeiro)
//  - dias em cada endereço = quantidade de cada equipamento ÷ produção por dia da equipe (ou faixas de câmeras)
//  - datas só nos dias de trabalho da equipe, sem feriado; uma equipe só começa um grupo depois de terminar o anterior
// o: { k, inicio, todos, fixos: Map(endereco_id -> {equipe, inicio}), regras }
function planejarDistribuicao(D, E, enderecos, o) {
  const chave = (e) => (D.estatico ? e.ref_id : e.id);
  const U = new Map(D.units.map((u) => [u.id, u]));
  const porChave = new Map();
  const etapas = new Map((D.etapas || []).map((t) => [t.id, t]));
  const regraT = (t) => regraDe(o.regras, t + 1);
  // meta de agências por dia: dias úteis (seg–sex, sem feriado) ou dias corridos (todos os dias)
  const M = o.meta || null;
  const cal = [...Array(o.k).keys()].map((t) => (M ? (M.corridos ? calendario({ dias_semana: [0, 1, 2, 3, 4, 5, 6] }, ['x']) : calendario(REGRA_PADRAO, D.hol && D.hol.length ? D.hol : null))
    : calendario(regraT(t), D.hol && D.hol.length ? D.hol : null)));
  const livre = new Array(o.k).fill(null);
  const ab = enderecos.filter((e) => !e.concluido_em);
  const mover = ab.filter((e) => o.fixos.has(e.id) || (o.todos ? PRE_EXEC.includes(e.status) : !e.equipe));
  const moverIds = new Set(mover.map((e) => e.id));
  // quem fica como está ocupa a equipe até o fim previsto
  for (const e of ab) {
    if (moverIds.has(e.id) || !e.equipe || e.equipe > o.k) continue;
    const f = e.fim_previsto || e.inicio_previsto;
    if (f && (!livre[e.equipe - 1] || f >= livre[e.equipe - 1])) livre[e.equipe - 1] = umDia(String(f).slice(0, 10));
  }
  const grupos = new Map();
  let semLocal = 0;
  for (const e of mover) {
    if (!U.has(chave(e))) { semLocal++; continue; }
    if (typeof e.itens === 'string') e.itens = JSON.parse(e.itens || '[]');
    porChave.set(chave(e), e);
    const et = e.etapa_id && etapas.get(e.etapa_id);
    const g = et ? 'e' + et.id : 'sem';
    if (!grupos.has(g)) grupos.set(g, { inicio: et ? String(et.inicio).slice(0, 10) : o.inicio, nome: et ? et.nome : null, ids: [] });
    grupos.get(g).ids.push(chave(e));
  }
  const diasDe = (id, t) => diasEndereco(regraT(t), porChave.get(id).itens, porChave.get(id).cameras);
  const b = D.base, cs = Math.cos(b.la * Math.PI / 180);
  const ang = (id) => Math.atan2(U.get(id).la - b.la, (U.get(id).lo - b.lo) * cs);
  const out = [];
  for (const g of [...grupos.values()].sort((x, y) => (x.inicio < y.inicio ? -1 : 1))) {
    const listas = [...Array(o.k)].map(() => []);
    const livres = [];
    for (const id of g.ids) { const f = o.fixos.get(porChave.get(id).id); if (f && f.equipe && f.equipe <= o.k) listas[f.equipe - 1].push(id); else livres.push(id); }
    if (livres.length) {
      const srt = livres.slice().sort((x, y) => ang(x) - ang(y));
      if (srt.length > 2) {
        let gi = 0, gv = -1;
        srt.forEach((id, i) => { const nx = srt[(i + 1) % srt.length]; let gg = ang(nx) - ang(id); if (gg <= 0) gg += 2 * Math.PI; if (gg > gv) { gv = gg; gi = (i + 1) % srt.length; } });
        srt.push(...srt.splice(0, gi));
      }
      // capacidade de cada equipe: dias de trabalho por semana ÷ tempo total que ela levaria para fazer tudo
      const tot = [...Array(o.k).keys()].map((t) => srt.reduce((s2, id) => s2 + diasDe(id, t).dias, 0) || 1);
      const cap = tot.map((T, t) => (regraT(t).dias_semana || [1, 2, 3, 4, 5]).length / T);
      const sc = cap.reduce((a, c) => a + c, 0);
      const somaM = M ? M.porDia.reduce((a, c) => a + c, 0) : 0;
      const alvo = M ? M.porDia.map((c) => c / somaM) : cap.map((c) => c / sc);
      const peso = (id, t) => (M ? 1 / srt.length : diasDe(id, t).dias / tot[t]);
      if (M) {
        // meta: quantidade de endereços de cada equipe proporcional à meta diária dela (maiores restos), em fatias contíguas da região
        const n = srt.length, cnt = alvo.map((a) => Math.floor(n * a));
        alvo.map((a, t) => [n * a - cnt[t], t]).sort((x, y) => y[0] - x[0]).slice(0, n - cnt.reduce((x, y) => x + y, 0)).forEach(([, t]) => cnt[t]++);
        let p0 = 0; cnt.forEach((c, t) => { listas[t].push(...srt.slice(p0, p0 + c)); p0 += c; });
      } else {
        let j = 0, acc = 0;
        srt.forEach((id) => {
          const w = peso(id, j);
          while (j < o.k - 1 && (alvo[j] === 0 || (acc > 0 && acc + w / 2 > alvo[j]))) { j++; acc = 0; }
          listas[j].push(id); acc += peso(id, j);
        });
      }
    }
    listas.forEach((lista, t) => {
      if (!lista.length) return;
      const ordem = (id) => porChave.get(id).ordem_etapa || 0;
      const cad = cadeia(lista, D.km);
      const path = cad.filter(ordem).sort((x, y) => ordem(x) - ordem(y)).concat(cad.filter((id) => !ordem(id)));
      const rg = regraT(t);
      let base = g.inicio;
      if (rg.inicio && String(rg.inicio).slice(0, 10) > base) base = String(rg.inicio).slice(0, 10);
      if (livre[t] && livre[t] > base) base = livre[t];
      base = cal[t].dia(base, 0);
      let p = 0, prev = 0, ultimo = null;
      if (M) {
        // meta: cada dia da equipe recebe até porDia agências, na ordem da rota; datas fixadas na prévia ocupam o dia delas
        const n = M.porDia[t] || 1, uso = new Map();
        const fixa = path.filter((id) => { const f = o.fixos.get(porChave.get(id).id); return f && f.inicio; });
        const dataDe = new Map();
        fixa.forEach((id) => { const d0 = cal[t].dia(o.fixos.get(porChave.get(id).id).inicio, 0); dataDe.set(id, d0); uso.set(d0, (uso.get(d0) || 0) + 1); });
        let idx = 0;
        for (const id of path) {
          if (dataDe.has(id)) continue;
          let d0 = cal[t].dia(base, idx); let g2 = 0;
          while ((uso.get(d0) || 0) >= n && g2++ < 3000) { idx++; d0 = cal[t].dia(base, idx); }
          uso.set(d0, (uso.get(d0) || 0) + 1); dataDe.set(id, d0);
        }
        for (const id of path) {
          const e = porChave.get(id), f = o.fixos.get(e.id), d0 = dataDe.get(id);
          const km = D.km[prev] && D.km[prev][id] != null ? D.km[prev][id] : 0;
          out.push({ id: e.id, nome: e.nome, municipio: e.municipio, uf: e.uf, codigo: e.codigo, etapa: g.nome, equipe: t + 1, inicio: d0, fim: d0, dias: 1, fonte: 'meta', km, itens: e.itens, cameras: e.cameras, status: e.status, fixo: !!(f && f.inicio) });
          if (!ultimo || d0 > ultimo) ultimo = d0;
          prev = id;
        }
        if (ultimo) livre[t] = umDia(ultimo);
        return;
      }
      for (const id of path) {
        const e = porChave.get(id), f = o.fixos.get(e.id);
        const km = D.km[prev] && D.km[prev][id] != null ? D.km[prev][id] : 0;
        const { dias: H, fonte } = diasDe(id, t);
        let ini, fim;
        if (f && f.inicio) {
          ini = cal[t].dia(f.inicio, 0);
          fim = cal[t].dia(ini, Math.ceil(H) - 1);
          if (ini >= base) { const s0 = cal[t].entre(base, ini); p = Math.max(p, s0 + H); }
        } else {
          const s0 = p + E.trav(km);
          const a = Math.floor(s0 + 1e-9);
          ini = cal[t].dia(base, a);
          fim = cal[t].dia(base, Math.max(a, Math.ceil(s0 + H - 1e-9) - 1));
          p = s0 + H;
        }
        out.push({ id: e.id, nome: e.nome, municipio: e.municipio, uf: e.uf, codigo: e.codigo, etapa: g.nome, equipe: t + 1, inicio: ini, fim, dias: H, fonte, km, itens: e.itens, cameras: e.cameras, status: e.status, fixo: !!(f && f.inicio) });
        if (!ultimo || fim > ultimo) ultimo = fim;
        prev = id;
      }
      if (ultimo) livre[t] = umDia(ultimo);
    });
  }
  out.sort((x, y) => x.equipe - y.equipe || (x.inicio < y.inicio ? -1 : x.inicio > y.inicio ? 1 : 0));
  return { itens: out, sem_localizacao: semLocal };
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function paginaAviso(titulo, texto) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="/css/app.css"></head><body><div class="card empty" style="margin:24px"><h2 style="margin-bottom:8px">${esc(titulo)}</h2><p>${texto}</p></div></body></html>`;
}

module.exports = (app) => {
  const escritorio = requer(ESCRITORIO);

  // Projetos do painel com o resumo dos cards: meta, concluídas, em execução e atenção (atrasadas)
  app.get('/api/rota/clientes', escritorio, async () => db.many(
    `SELECT c.id, c.nome, c.base_nome, c.base_lat, c.base_lon, c.criado_em, c.meta_instalacoes, c.equipes,
            count(e.id) FILTER (WHERE e.na_rota)::int AS enderecos,
            count(e.id) FILTER (WHERE NOT e.na_rota)::int AS fora_rota,
            COALESCE(sum(e.cameras) FILTER (WHERE e.na_rota),0)::int AS cameras,
            count(e.id) FILTER (WHERE e.na_rota AND (e.lat IS NULL OR e.lon IS NULL))::int AS sem_coordenada,
            count(e.id) FILTER (WHERE e.na_rota AND ${CONCL})::int AS concluidos,
            count(e.id) FILTER (WHERE e.na_rota AND NOT ${CONCL} AND e.status <> ALL($1))::int AS em_execucao,
            count(e.id) FILTER (WHERE e.na_rota AND NOT ${CONCL} AND (
              (e.inicio_previsto < CURRENT_DATE AND e.status = ANY($1)) OR e.fim_previsto < CURRENT_DATE))::int AS atencao,
            min(e.inicio_previsto) FILTER (WHERE e.na_rota AND NOT ${CONCL}) AS proximo_inicio,
            max(COALESCE(e.fim_previsto, e.inicio_previsto)) FILTER (WHERE e.na_rota AND NOT ${CONCL}) AS fim_previsto
       FROM clientes c
       LEFT JOIN contratos ct ON ct.cliente_id = c.id AND ct.status <> 'encerrado'
       LEFT JOIN enderecos e ON e.contrato_id = ct.id
      WHERE c.ativo GROUP BY c.id ORDER BY count(e.id) DESC, c.nome`, [PRE_EXEC]));

  // Lista única de projetos (tela Projetos): um card por cliente, com contratos e pendências de responsável.
  // Liberada para quem vê o Painel de rotas, a Execução ou o Cadastro (tabela de permissões).
  app.get('/api/carteira', requer(), async () => db.many(
    `SELECT c.id, c.nome, c.criado_em, c.meta_instalacoes, c.equipes,
            count(e.id) FILTER (WHERE e.na_rota)::int AS enderecos,
            count(e.id)::int AS enderecos_total,
            count(e.id) FILTER (WHERE NOT e.na_rota)::int AS fora_rota,
            COALESCE(sum(e.cameras) FILTER (WHERE e.na_rota),0)::int AS cameras,
            count(e.id) FILTER (WHERE e.na_rota AND ${CONCL})::int AS concluidos,
            count(e.id) FILTER (WHERE e.na_rota AND NOT ${CONCL} AND e.status <> ALL($1))::int AS em_execucao,
            count(e.id) FILTER (WHERE e.na_rota AND NOT ${CONCL} AND (
              (e.inicio_previsto < CURRENT_DATE AND e.status = ANY($1)) OR e.fim_previsto < CURRENT_DATE))::int AS atencao,
            max(COALESCE(e.fim_previsto, e.inicio_previsto)) FILTER (WHERE e.na_rota AND NOT ${CONCL}) AS fim_previsto,
            (SELECT COALESCE(json_agg(json_build_object('id', x.id, 'numero', x.numero, 'tipo', x.tipo) ORDER BY x.tipo DESC, x.id), '[]')
               FROM contratos x WHERE x.cliente_id = c.id AND x.status <> 'encerrado') AS contratos,
            (SELECT count(*)::int FROM tarefas t JOIN enderecos e2 ON e2.id = t.endereco_id JOIN contratos x ON x.id = e2.contrato_id
              WHERE x.cliente_id = c.id AND x.status <> 'encerrado' AND t.responsavel_id IS NULL AND t.status <> 'concluida') AS sem_responsavel
       FROM clientes c
       LEFT JOIN contratos ct ON ct.cliente_id = c.id AND ct.status <> 'encerrado'
       LEFT JOIN enderecos e ON e.contrato_id = ct.id
      WHERE c.ativo GROUP BY c.id ORDER BY count(e.id) DESC, c.nome`, [PRE_EXEC]));

  // Meta de instalações do projeto (vazio = todos os endereços na rota)
  app.put('/api/rota/:cliente/meta', escritorio, async (req) => {
    const id = v.id(req.params.cliente, 'Cliente');
    const meta = v.int(req.body.meta, 'A meta de instalações', { min: 1, max: 100000, opcional: true });
    const r = await db.query(`UPDATE clientes SET meta_instalacoes = $1 WHERE id = $2`, [meta ?? null, id]);
    if (!r.rowCount) throw new HttpError(404, 'Cliente não encontrado');
    return { ok: true, meta: meta ?? null };
  });

  // Resumo da montagem (endereços que ficaram fora por falta de localização)
  app.get('/api/rota/:cliente/resumo', escritorio, async (req) => {
    const { dados, foraRota } = await carregar(v.id(req.params.cliente, 'Cliente'));
    return { estatico: !!dados.estatico, unidades: dados.units.length, fora_rota: foraRota, base: dados.base,
      aproximados: dados.units.filter((u) => u.aprox).length, pelo_endereco: dados.units.filter((u) => u.gf === 'endereco').length, sem_localizacao: dados.semCoord,
      geocoder: require('../geocodificar').LIGADO };
  });

  // Base de saída das equipes do cliente
  app.put('/api/rota/:cliente/base', requer('admin', 'coordenador', 'supervisor'), async (req) => {
    const id = v.id(req.params.cliente, 'Cliente');
    const nome = v.str(req.body.base_nome, 'a base', { max: 100, opcional: true });
    let lat = v.num(req.body.base_lat, 'A latitude', { min: -90, max: 90, opcional: true });
    let lon = v.num(req.body.base_lon, 'A longitude', { min: -180, max: 180, opcional: true });
    if (nome && (lat == null || lon == null)) {
      const [mun, uf] = nome.split('/').map((s) => s.trim());
      const c = require('../rota-dados').coordMunicipio(mun, uf);
      if (!c) throw new HttpError(400, 'Não achei esse município. Use o formato Cidade/UF (ex.: Belém/PA).');
      lat = c.la; lon = c.lo;
    }
    await db.query(`UPDATE clientes SET base_nome = $1, base_lat = $2, base_lon = $3 WHERE id = $4`, [nome, nome ? lat : null, nome ? lon : null, id]);
    return { ok: true };
  });

  // Página do painel com os dados do cliente
  app.get('/app/rota/:cliente', async (req, res) => {
    const u = await loadUser(req);
    if (!u) { res.writeHead(302, { Location: '/?volta=' + encodeURIComponent('/app/rota.html') }); res.end(); return; }
    if (!require('../auth').pode(u, 'rota', 'ver')) throw new HttpError(403, 'Seu perfil não tem acesso a esta tela');
    const id = v.id(req.params.cliente, 'Cliente');
    const { dados } = await carregar(id);
    let html;
    if (!dados.units.length) {
      html = paginaAviso('Nenhum endereço para montar a rota',
        dados.semCoord.length
          ? `Há ${dados.semCoord.length} endereço(s), mas sem município reconhecido. Confira município e UF em <b>Clientes</b>.`
          : 'Cadastre os endereços deste cliente em <b>Clientes</b> (dá para colar uma lista do Excel) e volte aqui.');
    } else {
      if (!tplCache || process.env.NODE_ENV !== 'production') tplCache = fs.readFileSync(TPL, 'utf8').replace(/__RP_VER__/g, versaoPainel());
      const json = JSON.stringify(dados).replace(/</g, '\\u003c');
      html = tplCache.replace('__RP_CLIENTE__', () => String(id)).replace('__RP_TILES__', () => JSON.stringify(config.tileUrl ? '/tiles/{z}/{x}/{y}.png' : '')).replace('__RP_DATA__', () => json);
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(html);
  });

  // Distribuição (prévia): { equipes, inicio, todos, fixos: [{id, equipe, inicio}] } → não grava nada
  app.post('/api/clientes/:cliente/distribuir', escritorio, async (req) => {
    const id = v.id(req.params.cliente, 'Cliente');
    const k = v.int(req.body.equipes, 'A quantidade de equipes', { min: 1, max: MAX_EQUIPES });
    const { enderecos, dados: D } = await carregar(id);
    const inicio = parseDia(req.body.inicio, 'Data de início') || new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const fixos = new Map();
    for (const f of Array.isArray(req.body.fixos) ? req.body.fixos.slice(0, 5000) : []) {
      const eq = f.equipe ? v.int(f.equipe, 'Equipe', { min: 1, max: k }) : null;
      fixos.set(v.id(f.id, 'Endereço'), { equipe: eq, inicio: parseDia(f.inicio, 'Data de início') || null });
    }
    const regras = await db.tx((c) => carregarRegras(c, id));
    // meta de agências por dia: { por_dia, escopo: 'equipe' | 'total', dias: 'uteis' | 'corridos' }
    let meta = null;
    if (req.body.meta && req.body.meta.ativo) {
      const n = v.int(req.body.meta.por_dia, 'A meta de agências por dia', { min: 1, max: 200 });
      const total = req.body.meta.escopo === 'total';
      if (total && n < k) throw new HttpError(400, `Com meta total de ${n} por dia, use no máximo ${n} equipe(s)`);
      const porDia = [...Array(k).keys()].map((t) => (total ? Math.floor(n / k) + (t < n % k ? 1 : 0) : n));
      meta = { porDia, corridos: req.body.meta.dias === 'corridos', total, n };
    }
    const r = planejarDistribuicao(D, makeEngine(D), enderecos, { k, inicio, todos: req.body.todos === true, fixos, regras, meta });
    const resumo = [...Array(k).keys()].map((t) => {
      const l = r.itens.filter((x) => x.equipe === t + 1);
      return { equipe: t + 1, enderecos: l.length, dias: meta ? new Set(l.map((x) => x.inicio)).size : l.reduce((s2, x) => s2 + x.dias, 0), inicio: l.map((x) => x.inicio).sort()[0] || null, fim: l.map((x) => x.fim).sort().pop() || null };
    });
    return { ...r, resumo, meta: meta && { por_dia: meta.n, por_equipe: meta.porDia, escopo: meta.total ? 'total' : 'equipe', dias: meta.corridos ? 'corridos' : 'uteis' } };
  });

  // Grava a distribuição (prévia aprovada/editada): { equipes, itens: [{id, equipe, inicio, fim, dias}] }
  app.post('/api/clientes/:cliente/distribuir/aplicar', { limit: 2 * 1024 * 1024 }, escritorio, async (req) => {
    const id = v.id(req.params.cliente, 'Cliente');
    const k = v.int(req.body.equipes, 'A quantidade de equipes', { min: 1, max: MAX_EQUIPES });
    const itens = Array.isArray(req.body.itens) ? req.body.itens : [];
    if (!itens.length || itens.length > 5000) throw new HttpError(400, 'Nada para gravar');
    let n = 0;
    await db.tx(async (c) => {
      for (const it of itens) {
        const r = await c.query(
          `UPDATE enderecos e SET equipe = $1, inicio_previsto = $2, fim_previsto = $3, dias_previstos = $4, atualizado_em = now()
             FROM contratos ct WHERE ct.id = e.contrato_id AND ct.cliente_id = $5 AND e.id = $6 AND e.concluido_em IS NULL`,
          [v.int(it.equipe, 'Equipe', { min: 1, max: k }), parseDia(it.inicio, 'Data de início') || null, parseDia(it.fim, 'Data de fim') || null,
            it.dias == null || it.dias === '' ? null : v.num(it.dias, 'Dias', { min: 0, max: 365 }), id, v.id(it.id, 'Endereço')]);
        n += r.rowCount;
      }
      await c.query(`UPDATE clientes SET equipes = GREATEST(COALESCE(equipes, 0), $1) WHERE id = $2`, [k, id]);
    });
    return { ok: true, gravados: n };
  });

  // Grava no cadastro a equipe e a data de início que o Painel de rotas calculou: { equipes, itens: [{id, t, d}] }
  app.put('/api/rota/:cliente/plano-cadastro', { limit: 2 * 1024 * 1024 }, escritorio, async (req) => {
    const cliente = v.id(req.params.cliente, 'Cliente');
    const k = v.int(req.body.equipes, 'A quantidade de equipes', { min: 1, max: MAX_EQUIPES });
    const itens = Array.isArray(req.body.itens) ? req.body.itens : [];
    if (!itens.length || itens.length > 5000) throw new HttpError(400, 'Plano vazio');
    const chave = await chaveSql(cliente);
    let n = 0;
    await db.tx(async (c) => {
      for (const it of itens) {
        const key = v.int(it.id, 'Unidade', { min: 1 });
        const t = v.int(it.t, 'Equipe', { min: 1, max: k });
        const d = parseDia(it.d, 'Data de início');
        const r = await c.query(
          `UPDATE enderecos e SET equipe = $1, inicio_previsto = $2, atualizado_em = now() FROM contratos ct
            WHERE ct.id = e.contrato_id AND ct.cliente_id = $3 AND ${chave} = $4 AND e.concluido_em IS NULL`, [t, d, cliente, key]);
        n += r.rowCount;
      }
      await c.query(`UPDATE clientes SET equipes = $1 WHERE id = $2`, [k, cliente]);
      await recalcularPrevisao(c, cliente);
    });
    return { ok: true, gravados: n };
  });

  // Conclusão manual pelo painel: { data } conclui e tira da rota; { data: null } devolve para a rota
  app.put('/api/rota/:cliente/conclusao/:key', escritorio, async (req) => {
    const cliente = v.id(req.params.cliente, 'Cliente');
    const key = v.int(req.params.key, 'Unidade', { min: 1 });
    const chave = await chaveSql(cliente);
    const e = await db.one(`SELECT e.id FROM enderecos e JOIN contratos ct ON ct.id = e.contrato_id WHERE ct.cliente_id = $1 AND ${chave} = $2`, [cliente, key]);
    if (!e) throw new HttpError(404, 'Unidade não encontrada neste projeto');
    await db.tx((c) => aplicarPlano(c, e.id, { concluido_em: req.body.data ?? '' }));
    return { ok: true };
  });

  // Logística do endereço no painel: datas de despacho e entrega do material e modo (estrada, equipamento com o técnico, avião)
  app.put('/api/rota/:cliente/logistica/:key', escritorio, async (req) => {
    const cliente = v.id(req.params.cliente, 'Cliente');
    const key = v.int(req.params.key, 'Unidade', { min: 1 });
    const chave = await chaveSql(cliente);
    const e = await db.one(`SELECT e.id FROM enderecos e JOIN contratos ct ON ct.id = e.contrato_id WHERE ct.cliente_id = $1 AND ${chave} = $2`, [cliente, key]);
    if (!e) throw new HttpError(404, 'Unidade não encontrada neste projeto');
    const desp = parseDia(req.body.despacho, 'Data de despacho') ?? null;
    const ent = parseDia(req.body.entrega, 'Data de entrega do material') ?? null;
    if (desp && ent && ent < desp) throw new HttpError(400, 'A entrega do material não pode ser antes do despacho');
    const modo = req.body.modo ? v.oneOf(req.body.modo, 'Modo', ['estrada', 'leva', 'aviao']) : null;
    await db.query(`UPDATE enderecos SET despacho_material = $1, entrega_material = $2, modo_logistico = $3, atualizado_em = now() WHERE id = $4`, [desp, ent, modo, e.id]);
    return { ok: true, dd: desp, de: ent, ml: modo };
  });

  // Localizar pelo endereço (sem latitude/longitude): um endereço do painel ou os pendentes do projeto
  app.post('/api/rota/:cliente/localizar/:key', escritorio, async (req) => {
    const cliente = v.id(req.params.cliente, 'Cliente');
    const key = v.int(req.params.key, 'Unidade', { min: 1 });
    const chave = await chaveSql(cliente);
    const e = await db.one(`SELECT e.id FROM enderecos e JOIN contratos ct ON ct.id = e.contrato_id WHERE ct.cliente_id = $1 AND ${chave} = $2`, [cliente, key]);
    if (!e) throw new HttpError(404, 'Unidade não encontrada neste projeto');
    const r = await require('../geocodificar').geocodificarEndereco(e.id);
    if (!r.ok) throw new HttpError(400, r.erro);
    return r;
  });
  app.post('/api/rota/:cliente/localizar', escritorio, async (req) => {
    const cliente = v.id(req.params.cliente, 'Cliente');
    return require('../geocodificar').processar({ cliente, limite: 40, refazer: req.body.refazer === true });
  });

  // Configuração do plano (registrar antes de /:cliente/:col/:key)
  app.get('/api/rota/:cliente/config/plano2', escritorio, async (req) => {
    const id = `plano2-c${v.id(req.params.cliente, 'Cliente')}`;
    const r = await db.one(`SELECT data, atualizado_em FROM rota_config WHERE id = $1`, [id]);
    return r ? { exists: true, data: r.data, atualizado_em: r.atualizado_em } : { exists: false, data: null };
  });

  app.put('/api/rota/:cliente/config/plano2', { limit: 2 * 1024 * 1024 }, escritorio, async (req) => {
    const id = `plano2-c${v.id(req.params.cliente, 'Cliente')}`;
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) throw new HttpError(400, 'Configuração inválida');
    await db.query(
      `INSERT INTO rota_config (id, data, atualizado_por, atualizado_em) VALUES ($1, $2::jsonb, $3, now())
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, atualizado_por = EXCLUDED.atualizado_por, atualizado_em = now()`,
      [id, JSON.stringify(req.body), req.user.id]);
    return { ok: true };
  });

  app.get('/api/rota/:cliente/:col', escritorio, async (req) => {
    const def = COLS[req.params.col];
    if (!def) throw new HttpError(404, 'Coleção não encontrada');
    const cliente = v.id(req.params.cliente, 'Cliente');
    const chave = await chaveSql(cliente);
    const rows = await db.many(
      `SELECT ${chave} AS k, e.${def.coluna} AS valor FROM enderecos e JOIN contratos ct ON ct.id = e.contrato_id
        WHERE ct.cliente_id = $1 AND ${chave} IS NOT NULL AND e.${def.coluna} IS NOT NULL`, [cliente]);
    return rows.map((r) => ({ id: String(r.k), data: { [def.campo]: r.valor } }));
  });

  app.put('/api/rota/:cliente/:col/:key', escritorio, async (req) => {
    const def = COLS[req.params.col];
    if (!def) throw new HttpError(404, 'Coleção não encontrada');
    const cliente = v.id(req.params.cliente, 'Cliente');
    const key = v.int(req.params.key, 'Unidade', { min: 1 });
    let valor = req.body[def.campo];
    if (def.valores) valor = v.oneOf(valor, 'Valor', def.valores);
    else valor = v.str(valor, 'o patrimônio', { max: 500, opcional: true }) || '';
    const chave = await chaveSql(cliente);
    const r = await db.query(
      `UPDATE enderecos e SET ${def.coluna} = $1, atualizado_em = now() FROM contratos ct
        WHERE ct.id = e.contrato_id AND ct.cliente_id = $2 AND ${chave} = $3`, [valor, cliente, key]);
    if (!r.rowCount) throw new HttpError(404, 'Unidade não encontrada neste projeto');
    return { ok: true };
  });
};
