// Itens do projeto (equipamentos): catálogo por contrato e quantidades por endereço
const { HttpError } = require('./http');

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const ehCamera = (nome) => /^cameras?\b/.test(norm(nome));

function validarItens(lista, onde = '') {
  if (lista === undefined || lista === null) return null;
  if (!Array.isArray(lista) || lista.length > 80) throw new HttpError(400, `${onde}Lista de equipamentos inválida`);
  const out = new Map();
  for (const [i, it] of lista.entries()) {
    const nome = String((it && it.nome) || '').trim().replace(/\s+/g, ' ');
    if (!nome) continue;
    if (nome.length > 80) throw new HttpError(400, `${onde}Nome do equipamento ${i + 1} muito longo`);
    const q = it.quantidade === '' || it.quantidade == null ? 0 : Number(it.quantidade);
    if (!Number.isInteger(q) || q < 0 || q > 100000) throw new HttpError(400, `${onde}Quantidade inválida para "${nome}"`);
    const k = norm(nome);
    out.set(k, { nome, quantidade: (out.get(k)?.quantidade || 0) + q });
  }
  return [...out.values()];
}

async function garantirItem(c, contratoId, nome) {
  const r = await c.query(
    `INSERT INTO contrato_itens (contrato_id, nome, ordem)
     VALUES ($1, $2, (SELECT COALESCE(max(ordem),0)+1 FROM contrato_itens WHERE contrato_id = $1))
     ON CONFLICT (contrato_id, lower(nome)) DO UPDATE SET nome = contrato_itens.nome RETURNING id`, [contratoId, nome]);
  return r.rows[0].id;
}

// Grava os equipamentos do endereço (substitui a lista) e mantém o campo "câmeras" igual ao item Câmera
async function salvarItensEndereco(c, enderecoId, contratoId, itens, cameras) {
  if (itens) {
    await c.query(`DELETE FROM endereco_itens WHERE endereco_id = $1`, [enderecoId]);
    let cam = null;
    for (const it of itens) {
      const id = await garantirItem(c, contratoId, it.nome);
      if (it.quantidade > 0) await c.query(`INSERT INTO endereco_itens (endereco_id, item_id, quantidade) VALUES ($1,$2,$3)`, [enderecoId, id, it.quantidade]);
      if (ehCamera(it.nome)) cam = (cam || 0) + it.quantidade;
    }
    if (cam !== null) await c.query(`UPDATE enderecos SET cameras = $1 WHERE id = $2`, [cam, enderecoId]);
    return;
  }
  // sem lista: só acompanha o número de câmeras no item Câmera do contrato, se existir
  if (cameras == null) return;
  const ci = (await c.query(`SELECT id, nome FROM contrato_itens WHERE contrato_id = $1 ORDER BY ordem, id`, [contratoId])).rows.find((x) => ehCamera(x.nome));
  if (!ci) return;
  await c.query(
    `INSERT INTO endereco_itens (endereco_id, item_id, quantidade) VALUES ($1,$2,$3)
     ON CONFLICT (endereco_id, item_id) DO UPDATE SET quantidade = EXCLUDED.quantidade`, [enderecoId, ci.id, cameras]);
}

module.exports = { validarItens, garantirItem, salvarItensEndereco, ehCamera, norm };
