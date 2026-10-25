// Etapas de implantação por cliente (ex.: "Etapa 1" começando em 03/11/2026)
const { HttpError } = require('./http');

// Aceita 2026-11-03, 03/11/2026, 3/11/26 ou número de série de data do Excel
function parseData(v) {
  if (v === undefined || v === null || v === '') return null;
  const s = String(v).trim();
  let m;
  if ((m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s))) return `${m[1]}-${m[2]}-${m[3]}`;
  if ((m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(s))) {
    const y = m[3].length === 2 ? '20' + m[3] : m[3];
    return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  if (/^\d{5}(\.\d+)?$/.test(s)) { // série do Excel (dias desde 1899-12-30)
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(+s) * 86400000);
    return d.toISOString().slice(0, 10);
  }
  throw new HttpError(400, `Data inválida: "${s}". Use dd/mm/aaaa.`);
}

function validarData(iso, campo) {
  const d = new Date(iso + 'T12:00:00Z');
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso) throw new HttpError(400, `${campo} inválida`);
  return iso;
}

async function clienteDoContrato(c, contratoId) {
  const r = (await c.query(`SELECT cliente_id FROM contratos WHERE id = $1`, [contratoId])).rows[0];
  if (!r) throw new HttpError(404, 'Contrato não encontrado');
  return r.cliente_id;
}

// Acha (ou cria) a etapa pelo nome; se vier data, atualiza a data de início
async function garantirEtapa(c, clienteId, nome, dataInicio) {
  nome = String(nome || '').trim().replace(/\s+/g, ' ');
  if (!nome) return null;
  if (/^\d+$/.test(nome)) nome = `Etapa ${nome}`;
  if (nome.length > 60) throw new HttpError(400, 'Nome da etapa muito longo');
  const data = dataInicio ? validarData(parseData(dataInicio), 'Data de início da etapa') : null;
  const ex = (await c.query(`SELECT id, data_inicio FROM etapas WHERE cliente_id = $1 AND lower(nome) = lower($2)`, [clienteId, nome])).rows[0];
  if (ex) {
    if (data && ex.data_inicio !== data) await c.query(`UPDATE etapas SET data_inicio = $1 WHERE id = $2`, [data, ex.id]);
    return ex.id;
  }
  if (!data) throw new HttpError(400, `Informe a data de início da etapa "${nome}" (coluna "Início da etapa")`);
  return (await c.query(
    `INSERT INTO etapas (cliente_id, nome, data_inicio, ordem) VALUES ($1,$2,$3,(SELECT COALESCE(max(ordem),0)+1 FROM etapas WHERE cliente_id = $1)) RETURNING id`,
    [clienteId, nome, data])).rows[0].id;
}

// Aplica a etapa vinda do formulário (etapa_id) ou da planilha (etapa + etapa_inicio). undefined = não mexe.
async function aplicarEtapa(c, enderecoId, contratoId, b) {
  let etapaId;
  if (b.etapa_id !== undefined) {
    etapaId = b.etapa_id === null || b.etapa_id === '' ? null : Number(b.etapa_id);
    if (etapaId !== null) {
      const cli = await clienteDoContrato(c, contratoId);
      const ok = (await c.query(`SELECT 1 FROM etapas WHERE id = $1 AND cliente_id = $2`, [etapaId, cli])).rows.length;
      if (!ok) throw new HttpError(400, 'Etapa não pertence a este cliente');
    }
  } else if (b.etapa !== undefined && b.etapa !== null && String(b.etapa).trim() !== '') {
    etapaId = await garantirEtapa(c, await clienteDoContrato(c, contratoId), b.etapa, b.etapa_inicio);
  } else etapaId = undefined;
  // ordem de atendimento dentro da etapa (1 = primeiro); vazio = sem ordem definida
  let ordem;
  if (b.ordem_etapa !== undefined) {
    const s = String(b.ordem_etapa ?? '').trim();
    ordem = s === '' ? null : Number(s);
    if (ordem !== null && (!Number.isInteger(ordem) || ordem < 1 || ordem > 100000)) throw new HttpError(400, 'Ordem na etapa inválida (use 1, 2, 3…)');
  }
  if (etapaId === undefined && ordem === undefined) return;
  if (etapaId !== undefined) await c.query(`UPDATE enderecos SET etapa_id = $1 WHERE id = $2`, [etapaId, enderecoId]);
  if (ordem !== undefined) await c.query(`UPDATE enderecos SET ordem_etapa = $1 WHERE id = $2`, [ordem, enderecoId]);
}

module.exports = { parseData, validarData, garantirEtapa, aplicarEtapa, clienteDoContrato };
