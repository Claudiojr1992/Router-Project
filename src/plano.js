// Equipe, início previsto e conclusão manual de cada endereço
const { HttpError } = require('./http');
const { parseData, validarData } = require('./etapas');

const MAX_EQUIPES = 8; // mesmo limite do Painel de rotas

// Aceita 2, "2", "Equipe 2", "E2", "Time 2"; vazio = sem equipe
function parseEquipe(v) {
  if (v === undefined) return undefined;
  const s = String(v ?? '').trim();
  if (!s) return null;
  const m = /^(?:equipe|time|eq\.?|e|t)?\s*0*(\d{1,2})$/i.exec(s);
  const n = m ? +m[1] : NaN;
  if (!Number.isInteger(n) || n < 1 || n > MAX_EQUIPES) throw new HttpError(400, `Equipe inválida: "${s}". Use um número de 1 a ${MAX_EQUIPES}.`);
  return n;
}

function parseDia(v, campo) {
  if (v === undefined) return undefined;
  const s = String(v ?? '').trim();
  if (!s) return null;
  return validarData(parseData(s), campo);
}

const hojeMais = (dias) => new Date(Date.now() + dias * 86400000).toISOString().slice(0, 10);

// b: { equipe, inicio_previsto, concluido_em, entrega_material } — undefined = não mexe
async function aplicarPlano(c, enderecoId, b) {
  const equipe = parseEquipe(b.equipe);
  const inicio = parseDia(b.inicio_previsto, 'Data de início');
  const conclusao = parseDia(b.concluido_em, 'Data de conclusão');
  const entrega = parseDia(b.entrega_material, 'Data de entrega do material');
  if (conclusao && conclusao > hojeMais(1)) throw new HttpError(400, 'A data de conclusão não pode ser no futuro');
  if (equipe !== undefined) await c.query(`UPDATE enderecos SET equipe = $1 WHERE id = $2`, [equipe, enderecoId]);
  if (inicio !== undefined) await c.query(`UPDATE enderecos SET inicio_previsto = $1 WHERE id = $2`, [inicio, enderecoId]);
  if (entrega !== undefined) await c.query(`UPDATE enderecos SET entrega_material = $1 WHERE id = $2`, [entrega, enderecoId]);
  const desp = parseDia(b.despacho_material, 'Data de despacho do material');
  if (desp !== undefined) await c.query(`UPDATE enderecos SET despacho_material = $1 WHERE id = $2`, [desp, enderecoId]);
  const modo = parseModo(b.modo_logistico);
  if (modo !== undefined) await c.query(`UPDATE enderecos SET modo_logistico = $1 WHERE id = $2`, [modo, enderecoId]);
  const naRota = parseNaRota(b.na_rota);
  if (naRota !== undefined) await c.query(`UPDATE enderecos SET na_rota = $1 WHERE id = $2`, [naRota, enderecoId]);
  if (conclusao !== undefined) await concluir(c, enderecoId, conclusao);
}

// Modo logístico: estrada | leva (equipamento com o técnico) | aviao; "padrão"/vazio = segue o plano; ausente = não mexe
function parseModo(x) {
  if (x === undefined) return undefined;
  const t = String(x ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
  if (!t || t.startsWith('padrao')) return null;
  if (t.startsWith('estrada') || t.startsWith('rodov')) return 'estrada';
  if (t.startsWith('leva') || t.includes('com o tecnico') || t.includes('com tecnico')) return 'leva';
  if (t.startsWith('aviao') || t.startsWith('aereo')) return 'aviao';
  throw new HttpError(400, `Logística deve ser Estrada, Leva equipamento ou Avião (veio "${String(x).slice(0, 20)}")`);
}

// "Vai para a rota": true/false ou texto da planilha (Sim/Não); vazio ou ausente = não mexe
function parseNaRota(x) {
  if (x === undefined || x === null || x === '') return undefined;
  if (typeof x === 'boolean') return x;
  const t = String(x).normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
  if (['sim', 's', 'x', '1', 'true', 'yes', 'rota', 'na rota'].includes(t)) return true;
  if (['nao', 'n', '0', 'false', 'no', 'fora', 'fora da rota'].includes(t)) return false;
  throw new HttpError(400, `"Vai para a rota" deve ser Sim ou Não (veio "${String(x).slice(0, 20)}")`);
}

// Conclusão manual: com data, o endereço vira "Concluída" e sai do Painel de rotas; sem data, volta ao status anterior
async function concluir(c, enderecoId, data) {
  if (data) {
    await c.query(
      `UPDATE enderecos SET status_antes = CASE WHEN status <> 'Concluída' THEN status ELSE status_antes END,
              status = 'Concluída', concluido_em = $1, atualizado_em = now() WHERE id = $2`, [data, enderecoId]);
  } else {
    await c.query(
      `UPDATE enderecos SET status = CASE WHEN concluido_em IS NOT NULL THEN COALESCE(status_antes, 'A iniciar') ELSE status END,
              status_antes = NULL, concluido_em = NULL, atualizado_em = now() WHERE id = $1`, [enderecoId]);
  }
}

// A quantidade de equipes do projeto acompanha a maior equipe usada nos endereços
async function ajustarEquipes(c, clienteId) {
  await c.query(
    `UPDATE clientes cl SET equipes = x.m
       FROM (SELECT max(e.equipe) AS m FROM enderecos e JOIN contratos ct ON ct.id = e.contrato_id WHERE ct.cliente_id = $1) x
      WHERE cl.id = $1 AND x.m IS NOT NULL AND (cl.equipes IS NULL OR cl.equipes < x.m)`, [clienteId]);
}

// ---------- Regras das equipes: dias de trabalho e produção por dia ----------
const REGRA_PADRAO = Object.freeze({ dias_semana: [1, 2, 3, 4, 5], inicio: null, producao: {}, min_dias: 0.5 });
const DIAS_NOME = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const isoD = (d) => d.toISOString().slice(0, 10);
const nn = (s) => require('./rota-dados').norm(s);
const ehCam = (n) => /^cameras?\b/.test(nn(n));

let HOL = null;
function feriadosPadrao() {
  if (!HOL) { const y = new Date().getUTCFullYear(); HOL = require('./rota-dados').feriados(y - 1, y + 4); }
  return HOL;
}

// Faixas de câmeras do Painel de rotas (sem produção cadastrada): até 22 = 2 dias, até 32 = 3, acima = 4
function diasFaixa(cameras) {
  const P = require('./rota-dados').parametros();
  const c = cameras || 0;
  return c <= P.FX1 ? P.FX1D : c <= P.FX2 ? P.FX2D : P.FX3D;
}

// Dias de trabalho no endereço: soma de (quantidade ÷ produção por dia) de cada equipamento com produção cadastrada
function diasEndereco(regra, itens, cameras) {
  const prod = new Map(Object.entries((regra && regra.producao) || {}).map(([n, q]) => [nn(n), +q]).filter(([, q]) => q > 0));
  if (!prod.size) return { dias: diasFaixa(cameras), fonte: 'faixa' };
  let t = 0, usado = false;
  const lista = (itens || []).filter((i) => i && i.quantidade > 0);
  for (const it of lista) { const q = prod.get(nn(it.nome)); if (q > 0) { t += it.quantidade / q; usado = true; } }
  if (!lista.some((i) => ehCam(i.nome)) && cameras > 0) {
    const qc = [...prod].find(([n]) => /^cameras?\b/.test(n));
    if (qc) { t += cameras / qc[1]; usado = true; }
  }
  if (!usado) return { dias: diasFaixa(cameras), fonte: 'faixa' };
  return { dias: Math.max(+regra.min_dias || 0.5, Math.ceil(t * 2 - 1e-9) / 2), fonte: 'producao' };
}

// Calendário da equipe: dia(base, n) = n-ésimo dia de trabalho a partir de base (0 = a própria base, ou o próximo dia de trabalho)
function calendario(regra, hol) {
  const W = new Set((regra && regra.dias_semana && regra.dias_semana.length) ? regra.dias_semana : [1, 2, 3, 4, 5]);
  const H = new Set(hol || feriadosPadrao());
  const util = (d) => W.has(d.getUTCDay()) && !H.has(isoD(d));
  const dia = (base, n) => {
    const d = new Date(String(base).slice(0, 10) + 'T00:00:00Z');
    let g = 0; while (!util(d) && g++ < 400) d.setUTCDate(d.getUTCDate() + 1);
    let c = Math.max(0, n); while (c > 0 && g++ < 4000) { d.setUTCDate(d.getUTCDate() + 1); if (util(d)) c--; }
    return isoD(d);
  };
  // quantos dias de trabalho de base até data (data já ajustada para dia de trabalho)
  const entre = (base, data) => { let n = 0; const b = dia(base, 0); const d = new Date(b + 'T00:00:00Z'); const fim = dia(data, 0); let g = 0;
    while (isoD(d) < fim && g++ < 4000) { d.setUTCDate(d.getUTCDate() + 1); if (util(d)) n++; } return n; };
  return { util, dia, entre };
}

const regraDe = (regras, t) => (regras && regras.get(t)) || REGRA_PADRAO;

async function carregarRegras(c, clienteId) {
  const r = await c.query(`SELECT equipe, dias_semana, inicio, producao, min_dias FROM equipe_regras WHERE cliente_id = $1`, [clienteId]);
  const arr = (v) => (Array.isArray(v) ? v.map(Number) : String(v || '').replace(/[{}]/g, '').split(',').filter(Boolean).map(Number));
  const obj = (v) => (typeof v === 'string' ? JSON.parse(v || '{}') : v || {});
  return new Map(r.rows.map((x) => [x.equipe, { dias_semana: arr(x.dias_semana), inicio: x.inicio, producao: obj(x.producao), min_dias: +x.min_dias || 0.5 }]));
}

function validarRegras(lista) {
  if (!Array.isArray(lista) || lista.length > MAX_EQUIPES) throw new HttpError(400, 'Regras inválidas');
  return lista.map((r, i) => {
    const equipe = parseEquipe(r.equipe);
    if (!equipe) throw new HttpError(400, `Regra ${i + 1}: informe a equipe`);
    const dias = [...new Set((r.dias_semana || []).map(Number))].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6).sort();
    if (!dias.length) throw new HttpError(400, `Equipe ${equipe}: marque pelo menos um dia de trabalho`);
    const producao = {};
    const ent = Object.entries(r.producao || {});
    if (ent.length > 80) throw new HttpError(400, `Equipe ${equipe}: equipamentos demais`);
    for (const [nome, q] of ent) {
      const n = String(nome).trim().replace(/\s+/g, ' ');
      if (!n || n.length > 80) continue;
      if (q === '' || q === null || q === undefined) continue;
      const v = Number(String(q).replace(',', '.'));
      if (!(v > 0 && v <= 10000)) throw new HttpError(400, `Equipe ${equipe}: quantidade por dia inválida para "${n}"`);
      producao[n] = Math.round(v * 100) / 100;
    }
    const min = r.min_dias === '' || r.min_dias == null ? 0.5 : Number(String(r.min_dias).replace(',', '.'));
    if (!(min > 0 && min <= 30)) throw new HttpError(400, `Equipe ${equipe}: mínimo de dias inválido`);
    return { equipe, dias_semana: dias, inicio: parseDia(r.inicio, `Início da equipe ${equipe}`) || null, producao, min_dias: Math.round(min * 2) / 2 || 0.5 };
  });
}

// Recalcula duração (dias) e fim previsto dos endereços em aberto do cliente (todos ou só os ids)
async function recalcularPrevisao(c, clienteId, ids = null) {
  const regras = await carregarRegras(c, clienteId);
  const r = await c.query(
    `SELECT e.id, e.equipe, e.inicio_previsto, e.cameras,
            COALESCE((SELECT json_agg(json_build_object('nome', ci.nome, 'quantidade', ei.quantidade)) FROM endereco_itens ei JOIN contrato_itens ci ON ci.id = ei.item_id WHERE ei.endereco_id = e.id), '[]') AS itens
       FROM enderecos e JOIN contratos ct ON ct.id = e.contrato_id
      WHERE ct.cliente_id = $1 AND e.concluido_em IS NULL ${ids ? 'AND e.id = ANY($2)' : ''}`, ids ? [clienteId, ids] : [clienteId]);
  for (const e of r.rows) {
    const regra = regraDe(regras, e.equipe);
    const { dias } = diasEndereco(regra, typeof e.itens === 'string' ? JSON.parse(e.itens) : e.itens, e.cameras);
    const fim = e.inicio_previsto ? calendario(regra).dia(e.inicio_previsto, Math.ceil(dias) - 1) : null;
    await c.query(`UPDATE enderecos SET dias_previstos = $1, fim_previsto = $2 WHERE id = $3`, [dias, fim, e.id]);
  }
}

module.exports = { parseNaRota, parseEquipe, parseDia, aplicarPlano, concluir, ajustarEquipes, MAX_EQUIPES,
  REGRA_PADRAO, DIAS_NOME, diasEndereco, diasFaixa, calendario, carregarRegras, validarRegras, recalcularPrevisao, regraDe };
