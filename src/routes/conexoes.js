// Conexões com NetBox e Zabbix: configuração, importar sites/hosts como endereços e subir os ativos para o monitoramento
const db = require('../db');
const v = require('../validate');
const { HttpError } = require('../http');
const { requer, ESCRITORIO, GESTAO } = require('../auth');
const C = require('../conexoes');

const TIPOS = ['netbox', 'zabbix'];
const NOME = { netbox: 'NetBox', zabbix: 'Zabbix' };
const IFACES = ['agent', 'snmp', 'icmp'];
const tipoDe = (t) => { if (!TIPOS.includes(t)) throw new HttpError(404, 'Conexão não encontrada'); return t; };

async function log(tipo, acao, ok, detalhe, { endereco = null, usuario = null } = {}) {
  await db.query(`INSERT INTO integracoes_log (tipo, acao, endereco_id, usuario_id, ok, detalhe) VALUES ($1,$2,$3,$4,$5,$6)`,
    [tipo, acao, endereco, usuario, ok, String(detalhe || '').slice(0, 2000)]).catch(() => {});
}

// Ativo de monitoramento validado
function ativoBody(a, pre = '') {
  const hostname = v.str(a.hostname, `${pre}o hostname`, { max: 128 });
  if (!/^[A-Za-z0-9._\- ]+$/.test(hostname)) throw new HttpError(400, `${pre}Hostname "${hostname}" tem caracteres que o Zabbix não aceita (use letras, números, ponto, hífen, sublinhado e espaço)`);
  const ip = v.str(a.ip, `${pre}o IP`, { max: 64 });
  if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(ip) && !ip.includes(':')) throw new HttpError(400, `${pre}IP "${ip}" inválido`);
  if (ip.includes('.') && ip.split('.').some((n) => +n > 255)) throw new HttpError(400, `${pre}IP "${ip}" inválido`);
  const iface = String(a.interface || 'snmp').toLowerCase().trim();
  return {
    hostname, ip, nome_visivel: v.str(a.nome_visivel, `${pre}o nome`, { max: 128, opcional: true }),
    tipo: v.str(a.tipo, `${pre}o tipo`, { max: 40, opcional: true }) || 'camera',
    interface: v.oneOf(iface === 'agente' ? 'agent' : iface === 'ping' ? 'icmp' : iface, `${pre}Interface`, IFACES),
    porta: v.int(a.porta, `${pre}A porta`, { min: 1, max: 65535, opcional: true }),
    grupo: v.str(a.grupo, `${pre}o grupo`, { max: 128, opcional: true }),
    template: v.str(a.template, `${pre}o template`, { max: 128, opcional: true }),
    comunidade: v.str(a.comunidade, `${pre}a comunidade SNMP`, { max: 64, opcional: true }),
  };
}

// Situação das atividades do endereço (todas concluídas = pode subir)
async function situacao(c, enderecoId) {
  const r = (await c.query(`SELECT count(*)::int AS total, count(*) FILTER (WHERE t.status = 'concluida')::int AS concluidas
                              FROM tarefas t JOIN atividades a ON a.id = t.atividade_id AND a.ativo WHERE t.endereco_id = $1`, [enderecoId])).rows[0];
  return { ...r, pronto: r.total > 0 && r.concluidas === r.total };
}

async function enderecoCompleto(id) {
  const e = await db.one(`SELECT e.*, cl.nome AS cliente, ct.numero AS contrato FROM enderecos e JOIN contratos ct ON ct.id = e.contrato_id
                            JOIN clientes cl ON cl.id = ct.cliente_id WHERE e.id = $1`, [id]);
  if (!e) throw new HttpError(404, 'Endereço não encontrado');
  return e;
}

// Envia todos os ativos do endereço ao Zabbix
async function enviarEndereco(cfg, id, usuario, cache = {}) {
  const e = await enderecoCompleto(id);
  const ativos = await db.many(`SELECT * FROM monitoramento_ativos WHERE endereco_id = $1 ORDER BY id`, [id]);
  if (!ativos.length) throw new HttpError(400, `${e.nome}: cadastre os ativos (hostname e IP) antes de subir`);
  let ok = 0; const erros = [];
  for (const a of ativos) {
    try {
      const hid = await C.enviarAtivo(cfg, a, e, cache);
      await db.query(`UPDATE monitoramento_ativos SET zabbix_hostid = $1, status = 'enviado', erro = NULL, enviado_em = now() WHERE id = $2`, [hid, a.id]);
      ok++;
    } catch (err) {
      erros.push(`${a.hostname}: ${err.message}`);
      await db.query(`UPDATE monitoramento_ativos SET status = 'erro', erro = $1 WHERE id = $2`, [err.message.slice(0, 500), a.id]);
    }
  }
  if (!erros.length) await db.query(`UPDATE enderecos SET monitorado_em = now() WHERE id = $1`, [id]);
  await log('zabbix', 'enviar', !erros.length, erros.length ? erros.join('\n') : `${ok} host(s) no Zabbix`, { endereco: id, usuario });
  return { endereco_id: id, nome: e.nome, enviados: ok, erros };
}

module.exports = (app) => {
  const escritorio = requer(ESCRITORIO);
  const gestao = requer(GESTAO);

  // ---------- configuração ----------
  app.get('/api/conexoes', escritorio, async () => {
    const rs = await db.many(`SELECT tipo, url, token_cifrado IS NOT NULL AS tem_token, opcoes, teste_em, teste_ok, teste_msg, atualizado_em FROM integracoes`);
    return TIPOS.map((t) => rs.find((r) => r.tipo === t) || { tipo: t, url: '', tem_token: false, opcoes: {}, teste_em: null, teste_ok: null, teste_msg: null });
  });

  app.put('/api/conexoes/:tipo', gestao, async (req) => {
    const tipo = tipoDe(req.params.tipo);
    const url = v.str(req.body.url, 'a URL', { max: 300 });
    if (!/^https?:\/\/[^\s/]+/i.test(url)) throw new HttpError(400, 'Informe a URL completa, começando com http:// ou https://');
    const token = v.str(req.body.token, 'o token', { max: 500, opcional: true });
    const o = req.body.opcoes || {};
    const s = (x, n = 128) => (x == null || x === '' ? undefined : String(x).trim().slice(0, n));
    const opcoes = tipo === 'netbox'
      ? { inseguro: !!o.inseguro, status_novo: s(o.status_novo, 20) || 'planned' }
      : { inseguro: !!o.inseguro, auth_corpo: !!o.auth_corpo, grupo: s(o.grupo), template_snmp: s(o.template_snmp), template_agent: s(o.template_agent), template_icmp: s(o.template_icmp), comunidade: s(o.comunidade, 64) };
    const ex = await db.one(`SELECT token_cifrado FROM integracoes WHERE tipo = $1`, [tipo]);
    if (!token && !(ex && ex.token_cifrado)) throw new HttpError(400, 'Informe o token de acesso');
    await db.query(
      `INSERT INTO integracoes (tipo, url, token_cifrado, opcoes, atualizado_por, atualizado_em) VALUES ($1,$2,$3,$4,$5,now())
       ON CONFLICT (tipo) DO UPDATE SET url = EXCLUDED.url, token_cifrado = COALESCE(EXCLUDED.token_cifrado, integracoes.token_cifrado),
         opcoes = EXCLUDED.opcoes, atualizado_por = EXCLUDED.atualizado_por, atualizado_em = now(), teste_em = NULL, teste_ok = NULL, teste_msg = NULL`,
      [tipo, url.replace(/\/+$/, ''), token ? C.cifrar(token) : null, opcoes, req.user.id]);
    return { ok: true };
  });

  app.delete('/api/conexoes/:tipo', gestao, async (req) => {
    await db.query(`DELETE FROM integracoes WHERE tipo = $1`, [tipoDe(req.params.tipo)]);
    return { ok: true };
  });

  app.post('/api/conexoes/:tipo/testar', gestao, async (req) => {
    const tipo = tipoDe(req.params.tipo);
    const cfg = await C.carregar(tipo);
    let ok = false, msg;
    try {
      if (tipo === 'netbox') {
        const st = await C.netbox(cfg, 'status/').catch(() => null);
        const pg = await C.netbox(cfg, 'dcim/sites/?limit=1');
        msg = `Conectado${st && st['netbox-version'] ? ' · NetBox ' + st['netbox-version'] : ''} · ${pg.count ?? 0} site(s)`;
      } else {
        const ver = await C.zabbix(cfg, 'apiinfo.version', {});
        const n = await C.zabbix(cfg, 'host.get', { countOutput: true });
        msg = `Conectado · Zabbix ${ver} · ${n} host(s)`;
      }
      ok = true;
    } catch (e) { msg = e.message; }
    await db.query(`UPDATE integracoes SET teste_em = now(), teste_ok = $1, teste_msg = $2 WHERE tipo = $3`, [ok, msg, tipo]);
    await log(tipo, 'testar', ok, msg, { usuario: req.user.id });
    return { ok, msg };
  });

  // ---------- sites do NetBox / hosts do Zabbix ----------
  app.get('/api/conexoes/:tipo/sites', escritorio, async (req) => {
    const tipo = tipoDe(req.params.tipo);
    const cfg = await C.carregar(tipo);
    const q = v.str(req.query.q, 'a busca', { max: 100, opcional: true }) || '';
    const lista = tipo === 'netbox' ? await C.netboxSites(cfg, { q }) : await C.zabbixHosts(cfg, { q });
    // marca o que já existe como endereço (no contrato escolhido, ou em qualquer um)
    const ct = req.query.contrato ? v.id(req.query.contrato, 'Contrato') : null;
    const col = tipo === 'netbox' ? 'netbox_site_id' : 'zabbix_hostid';
    const ex = await db.many(`SELECT e.id, e.nome, e.codigo, e.contrato_id, e.${col} AS ref, ct.numero AS contrato, cl.nome AS cliente FROM enderecos e
                                JOIN contratos ct ON ct.id = e.contrato_id JOIN clientes cl ON cl.id = ct.cliente_id
                               WHERE e.${col} IS NOT NULL ${ct ? 'OR (e.contrato_id = $1 AND e.codigo IS NOT NULL)' : ''}`, ct ? [ct] : []);
    const porRef = new Map(ex.filter((e) => e.ref != null).map((e) => [String(e.ref), e]));
    const porCod = new Map(ex.filter((e) => e.contrato_id === ct && e.codigo).map((e) => [e.codigo.toLowerCase(), e]));
    return lista.map((s) => { const e = porRef.get(String(s.ref)) || (s.codigo && porCod.get(String(s.codigo).toLowerCase())); return { ...s, existente: e ? { id: e.id, nome: e.nome, cliente: e.cliente, contrato: e.contrato, mesmo: e.contrato_id === ct } : null }; });
  });

  // Importa sites/hosts como endereços do contrato: { contrato_id, itens: [{ref, nome, codigo, logradouro, municipio, uf, cep, lat, lon}], atualizar }
  app.post('/api/conexoes/:tipo/importar', { limit: 4 * 1024 * 1024 }, escritorio, async (req) => {
    const tipo = tipoDe(req.params.tipo);
    const contrato = v.id(req.body.contrato_id, 'Contrato');
    const itens = Array.isArray(req.body.itens) ? req.body.itens : [];
    if (!itens.length || itens.length > 3000) throw new HttpError(400, 'Selecione de 1 a 3.000 itens');
    const col = tipo === 'netbox' ? 'netbox_site_id' : 'zabbix_hostid';
    const linhas = itens.map((b, i) => {
      const p = `Linha ${i + 1} (${String(b.nome || '').slice(0, 40)}): `;
      try {
        return {
          ref: tipo === 'netbox' ? v.int(b.ref, 'O id do site', { min: 1 }) : v.str(String(b.ref ?? ''), 'o hostid', { max: 40 }),
          codigo: v.str(b.codigo, 'o código', { max: 40, opcional: true }), nome: v.str(b.nome, 'o nome', { max: 160 }),
          logradouro: v.str(b.logradouro, 'o logradouro', { max: 200, opcional: true }), cep: v.str(b.cep, 'o CEP', { max: 10, opcional: true }),
          municipio: v.str(b.municipio, 'o município', { max: 100 }), uf: v.oneOf(String(b.uf || '').toUpperCase(), 'UF', C.UFS),
          lat: v.num(b.lat, 'A latitude', { min: -90, max: 90, opcional: true }), lon: v.num(b.lon, 'A longitude', { min: -180, max: 180, opcional: true }),
        };
      } catch (e) { throw new HttpError(400, p + e.message); }
    });
    const atualizar = req.body.atualizar !== false;
    const r = await db.tx(async (c) => {
      if (!(await c.query(`SELECT 1 FROM contratos WHERE id = $1`, [contrato])).rows.length) throw new HttpError(404, 'Contrato não encontrado');
      const novos = []; let atualizados = 0, ignorados = 0;
      for (const l of linhas) {
        const ex = (await c.query(`SELECT id FROM enderecos WHERE contrato_id = $1 AND (${col} = $2 OR ($3::text IS NOT NULL AND lower(codigo) = lower($3))) LIMIT 1`, [contrato, String(l.ref), l.codigo])).rows[0];
        if (ex) {
          if (!atualizar) { ignorados++; continue; }
          await c.query(`UPDATE enderecos SET ${col} = $2, codigo = COALESCE($3, codigo), nome = $4, logradouro = COALESCE($5, logradouro), cep = COALESCE($6, cep),
                           municipio = $7, uf = $8, lat = COALESCE($9, lat), lon = COALESCE($10, lon), atualizado_em = now() WHERE id = $1`,
          [ex.id, l.ref, l.codigo, l.nome, l.logradouro, l.cep, l.municipio, l.uf, l.lat, l.lon]);
          atualizados++;
        } else {
          novos.push((await c.query(`INSERT INTO enderecos (contrato_id, ${col}, codigo, nome, logradouro, cep, municipio, uf, lat, lon, cameras)
                                      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,0) RETURNING id`,
          [contrato, l.ref, l.codigo, l.nome, l.logradouro, l.cep, l.municipio, l.uf, l.lat, l.lon])).rows[0].id);
        }
      }
      if (novos.length) {
        await c.query(`INSERT INTO tarefas (endereco_id, atividade_id) SELECT e.id, a.id FROM enderecos e JOIN atividades a ON a.contrato_id = e.contrato_id AND a.ativo
                        WHERE e.id = ANY($1) ON CONFLICT DO NOTHING`, [novos]);
        await c.query(`UPDATE tarefas t SET responsavel_id = r.pessoa_id FROM regras_distribuicao r
                        WHERE t.endereco_id = ANY($1) AND r.contrato_id = $2 AND r.atividade_id = t.atividade_id AND r.pessoa_id IS NOT NULL`, [novos, contrato]);
      }
      return { ok: true, criados: novos.length, atualizados, ignorados };
    });
    await log(tipo, 'importar', true, `${r.criados} criado(s), ${r.atualizados} atualizado(s) no contrato ${contrato}`, { usuario: req.user.id });
    return r;
  });

  // Cria no NetBox os sites dos endereços que ainda não têm vínculo: { endereco_ids }
  app.post('/api/conexoes/netbox/enviar', escritorio, async (req) => {
    const ids = Array.isArray(req.body.endereco_ids) ? req.body.endereco_ids.map((x) => v.id(x, 'Endereço')) : [];
    if (!ids.length || ids.length > 500) throw new HttpError(400, 'Selecione de 1 a 500 endereços');
    const cfg = await C.carregar('netbox');
    const ends = await db.many(`SELECT e.*, cl.nome AS cliente FROM enderecos e JOIN contratos ct ON ct.id = e.contrato_id JOIN clientes cl ON cl.id = ct.cliente_id
                                 WHERE e.id = ANY($1) AND e.netbox_site_id IS NULL`, [ids]);
    const slug = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 90);
    let criados = 0; const erros = [];
    for (const e of ends) {
      try {
        const s = await C.netbox(cfg, 'dcim/sites/', { method: 'POST', body: {
          name: e.nome.slice(0, 100), slug: slug(`${e.codigo || ''} ${e.nome}`) || 'site-' + e.id, status: cfg.opcoes.status_novo || 'planned', facility: (e.codigo || '').slice(0, 50),
          physical_address: [e.logradouro, e.bairro, `${e.municipio} - ${e.uf}`, e.cep].filter(Boolean).join(', ').slice(0, 200),
          ...(e.lat != null ? { latitude: +(+e.lat).toFixed(6), longitude: +(+e.lon).toFixed(6) } : {}), description: `RoutProject · ${e.cliente}`.slice(0, 200) } });
        await db.query(`UPDATE enderecos SET netbox_site_id = $1 WHERE id = $2`, [s.id, e.id]);
        criados++;
      } catch (err) { erros.push(`${e.nome}: ${err.message}`); }
    }
    await log('netbox', 'enviar', !erros.length, `${criados} site(s) criados${erros.length ? '\n' + erros.join('\n') : ''}`, { usuario: req.user.id });
    return { criados, ja_vinculados: ids.length - ends.length, erros };
  });

  // Grupos e templates do Zabbix (para as listas de sugestão)
  app.get('/api/conexoes/zabbix/opcoes', escritorio, async () => {
    const cfg = await C.carregar('zabbix', { exigir: false });
    if (!cfg) return { grupos: [], templates: [], padrao: {} };
    const [g, t] = await Promise.all([
      C.zabbix(cfg, 'hostgroup.get', { output: ['name'], sortfield: 'name' }).catch(() => []),
      C.zabbix(cfg, 'template.get', { output: ['host', 'name'], sortfield: 'name' }).catch(() => []),
    ]);
    return { grupos: g.map((x) => x.name), templates: t.map((x) => x.host), padrao: cfg.opcoes };
  });

  // ---------- monitoramento ----------
  // Resumo por endereço do contrato (coluna "Monitoramento" em Projetos)
  app.get('/api/contratos/:id/monitoramento', escritorio, async (req) => db.many(
    `SELECT e.id AS endereco_id, e.codigo, e.nome, e.monitorado_em, e.netbox_site_id, e.zabbix_hostid,
            (SELECT count(*)::int FROM monitoramento_ativos m WHERE m.endereco_id = e.id) AS ativos,
            (SELECT count(*)::int FROM monitoramento_ativos m WHERE m.endereco_id = e.id AND m.status = 'enviado') AS enviados,
            (SELECT count(*)::int FROM monitoramento_ativos m WHERE m.endereco_id = e.id AND m.status = 'erro') AS erros,
            (SELECT count(*)::int FROM tarefas t JOIN atividades a ON a.id = t.atividade_id AND a.ativo WHERE t.endereco_id = e.id) AS tarefas,
            (SELECT count(*)::int FROM tarefas t JOIN atividades a ON a.id = t.atividade_id AND a.ativo WHERE t.endereco_id = e.id AND t.status = 'concluida') AS concluidas
       FROM enderecos e WHERE e.contrato_id = $1 ORDER BY e.id`, [v.id(req.params.id)]));

  app.get('/api/enderecos/:id/monitoramento', escritorio, async (req) => {
    const id = v.id(req.params.id);
    const e = await enderecoCompleto(id);
    const [ativos, sit, hist, zb] = await Promise.all([
      db.many(`SELECT * FROM monitoramento_ativos WHERE endereco_id = $1 ORDER BY id`, [id]),
      situacao(db, id),
      db.many(`SELECT l.acao, l.ok, l.detalhe, l.criado_em, u.nome AS usuario FROM integracoes_log l LEFT JOIN usuarios u ON u.id = l.usuario_id
                WHERE l.endereco_id = $1 ORDER BY l.criado_em DESC LIMIT 10`, [id]),
      db.one(`SELECT opcoes FROM integracoes WHERE tipo = 'zabbix' AND token_cifrado IS NOT NULL`),
    ]);
    return { endereco: { id: e.id, nome: e.nome, codigo: e.codigo, municipio: e.municipio, uf: e.uf, cliente: e.cliente, contrato: e.contrato, monitorado_em: e.monitorado_em, netbox_site_id: e.netbox_site_id },
      ativos, tarefas: sit, zabbix: zb ? { configurado: true, padrao: zb.opcoes } : { configurado: false }, historico: hist };
  });

  // Lista completa dos ativos do endereço (manual): { ativos: [...] } — substitui a lista
  app.put('/api/enderecos/:id/monitoramento', escritorio, async (req) => {
    const id = v.id(req.params.id);
    const lista = Array.isArray(req.body.ativos) ? req.body.ativos : [];
    if (lista.length > 300) throw new HttpError(400, 'No máximo 300 ativos por endereço');
    const ativos = lista.map((a, i) => ({ id: a.id ? v.id(a.id, 'Ativo') : null, ...ativoBody(a, `Linha ${i + 1}: `) }));
    const dup = ativos.map((a) => a.hostname.toLowerCase()).find((h, i, arr) => arr.indexOf(h) !== i);
    if (dup) throw new HttpError(400, `Hostname repetido: ${dup}`);
    await db.tx(async (c) => {
      await enderecoCompleto(id);
      const manter = ativos.filter((a) => a.id).map((a) => a.id);
      await c.query(`DELETE FROM monitoramento_ativos WHERE endereco_id = $1 AND NOT (id = ANY($2))`, [id, manter]);
      for (const a of ativos) {
        const vals = [a.hostname, a.nome_visivel, a.ip, a.tipo, a.interface, a.porta, a.grupo, a.template, a.comunidade];
        try {
          if (a.id) await c.query(`UPDATE monitoramento_ativos SET hostname=$1, nome_visivel=$2, ip=$3, tipo=$4, interface=$5, porta=$6, grupo=$7, template=$8, comunidade=$9,
                                     status = CASE WHEN status = 'enviado' THEN 'pendente' ELSE status END WHERE id = $10 AND endereco_id = $11`, [...vals, a.id, id]);
          else await c.query(`INSERT INTO monitoramento_ativos (hostname, nome_visivel, ip, tipo, interface, porta, grupo, template, comunidade, endereco_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [...vals, id]);
        } catch (e) { if (e.code === '23505') throw new HttpError(400, `O hostname ${a.hostname} já está em outro endereço`); throw e; }
      }
    });
    return { ok: true, ativos: ativos.length };
  });

  // Importa a planilha modelo: { linhas: [{codigo, hostname, ip, ...}], substituir }
  app.post('/api/contratos/:id/monitoramento/importar', { limit: 4 * 1024 * 1024 }, escritorio, async (req) => {
    const contrato = v.id(req.params.id);
    const linhas = Array.isArray(req.body.linhas) ? req.body.linhas : [];
    if (!linhas.length || linhas.length > 10000) throw new HttpError(400, 'A planilha precisa ter de 1 a 10.000 linhas');
    const ends = await db.many(`SELECT id, codigo, nome FROM enderecos WHERE contrato_id = $1`, [contrato]);
    const porCod = new Map(ends.filter((e) => e.codigo).map((e) => [e.codigo.trim().toLowerCase(), e.id]));
    const porNome = new Map(ends.map((e) => [e.nome.trim().toLowerCase(), e.id]));
    const itens = linhas.map((l, i) => {
      const p = `Linha ${i + 2}: `;
      const eid = porCod.get(String(l.codigo || '').trim().toLowerCase()) || porNome.get(String(l.endereco || '').trim().toLowerCase());
      if (!eid) throw new HttpError(400, `${p}endereço "${l.codigo || l.endereco || ''}" não existe neste contrato (use o código do endereço)`);
      return { endereco_id: eid, ...ativoBody(l, p) };
    });
    const dup = itens.map((a) => a.hostname.toLowerCase()).find((h, i, arr) => arr.indexOf(h) !== i);
    if (dup) throw new HttpError(400, `Hostname repetido na planilha: ${dup}`);
    const r = await db.tx(async (c) => {
      const alvo = [...new Set(itens.map((a) => a.endereco_id))];
      if (req.body.substituir) await c.query(`DELETE FROM monitoramento_ativos WHERE endereco_id = ANY($1)`, [alvo]);
      let novos = 0, atual = 0;
      for (const a of itens) {
        const vals = [a.endereco_id, a.hostname, a.nome_visivel, a.ip, a.tipo, a.interface, a.porta, a.grupo, a.template, a.comunidade];
        const ex = (await c.query(`SELECT id, endereco_id FROM monitoramento_ativos WHERE lower(hostname) = lower($1)`, [a.hostname])).rows[0];
        if (ex && !ends.some((e) => e.id === ex.endereco_id)) throw new HttpError(400, `O hostname ${a.hostname} já está em um endereço de outro contrato`);
        if (ex) { await c.query(`UPDATE monitoramento_ativos SET endereco_id=$1, hostname=$2, nome_visivel=$3, ip=$4, tipo=$5, interface=$6, porta=$7, grupo=$8, template=$9, comunidade=$10, status='pendente', erro=NULL WHERE id = $11`, [...vals, ex.id]); atual++; }
        else { await c.query(`INSERT INTO monitoramento_ativos (endereco_id, hostname, nome_visivel, ip, tipo, interface, porta, grupo, template, comunidade) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, vals); novos++; }
      }
      return { ok: true, criados: novos, atualizados: atual, enderecos: alvo.length };
    });
    await log('zabbix', 'importar', true, `${r.criados} ativo(s) novos, ${r.atualizados} atualizados em ${r.enderecos} endereço(s)`, { usuario: req.user.id });
    return r;
  });

  // Sobe o endereço para o monitoramento (todas as atividades concluídas; administrador pode forçar)
  app.post('/api/enderecos/:id/monitoramento/enviar', escritorio, async (req) => {
    const id = v.id(req.params.id);
    const sit = await situacao(db, id);
    if (!sit.pronto && !(req.body.forcar && require('../auth').podeAcao(req.user, 'forcar_monitoramento'))) {
      throw new HttpError(400, sit.total ? `Faltam ${sit.total - sit.concluidas} de ${sit.total} atividade(s) para concluir antes de subir para o monitoramento` : 'Este endereço não tem atividades');
    }
    const cfg = await C.carregar('zabbix');
    return enviarEndereco(cfg, id, req.user.id);
  });

  // Sobe todos os endereços prontos do contrato (atividades concluídas, com ativos e ainda não monitorados)
  app.post('/api/contratos/:id/monitoramento/enviar', escritorio, async (req) => {
    const contrato = v.id(req.params.id);
    const cfg = await C.carregar('zabbix');
    const prontos = await db.many(
      `SELECT e.id FROM enderecos e WHERE e.contrato_id = $1
          AND EXISTS (SELECT 1 FROM monitoramento_ativos m WHERE m.endereco_id = e.id AND m.status <> 'enviado')
          AND EXISTS (SELECT 1 FROM tarefas t JOIN atividades a ON a.id = t.atividade_id AND a.ativo WHERE t.endereco_id = e.id)
          AND NOT EXISTS (SELECT 1 FROM tarefas t JOIN atividades a ON a.id = t.atividade_id AND a.ativo WHERE t.endereco_id = e.id AND t.status <> 'concluida')
        ORDER BY e.id LIMIT 200`, [contrato]);
    const cache = {}; const res = [];
    for (const p of prontos) {
      try { res.push(await enviarEndereco(cfg, p.id, req.user.id, cache)); } catch (e) { res.push({ endereco_id: p.id, enviados: 0, erros: [e.message] }); }
    }
    return { enderecos: res.length, enviados: res.reduce((a, r) => a + r.enviados, 0), com_erro: res.filter((r) => r.erros.length).map((r) => ({ nome: r.nome, erros: r.erros })) };
  });
};
