// Regra de predecessora: a atividade só pode ser concluída depois que a predecessora estiver concluída no mesmo endereço
const { HttpError } = require('./http');

async function conferirConclusao(c, tarefaId) {
  const r = (await c.query(
    `SELECT pa.nome, pt.status FROM tarefas t
       JOIN atividades a ON a.id = t.atividade_id
       JOIN atividades pa ON pa.id = a.predecessora_id AND pa.ativo
       JOIN tarefas pt ON pt.endereco_id = t.endereco_id AND pt.atividade_id = pa.id
      WHERE t.id = $1`, [tarefaId])).rows[0];
  if (r && r.status !== 'concluida') throw new HttpError(400, `Conclua antes a atividade "${r.nome}" (predecessora) neste endereço`);
}

module.exports = { conferirConclusao };
