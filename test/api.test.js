// Testes de API contra um banco PostgreSQL de teste (vazio). Rodam com: RUN_API_TESTS=1 DATABASE_URL=postgres://… npm run test:api
// Sobem o servidor numa porta livre, migram o banco e conferem permissões, auditoria e limite de tentativas.
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn, execFileSync } = require('child_process');
const path = require('path');

const ATIVO = process.env.RUN_API_TESTS === '1';
const RAIZ = path.join(__dirname, '..');
const PORTA = 18000 + Math.floor(Math.random() * 1000);
const BASE = `http://127.0.0.1:${PORTA}`;
const ENV = { ...process.env, PORT: String(PORTA), NODE_ENV: 'test', SESSION_SECRET: 'segredo-de-teste-0123456789-abcdef', ADMIN_EMAIL: 'admin@teste.local',
  ADMIN_PASSWORD: 'Senha1234', ADMIN_NAME: 'Admin Teste', SEED_BNB: 'false', GEOCODER: 'off', TILE_URL: 'off' };
let srv;

// cliente HTTP com cookie de sessão
function cliente() {
  let cookie = '';
  const req = async (metodo, url, body) => {
    const r = await fetch(BASE + url, { method: metodo, headers: { 'Content-Type': 'application/json', Origin: BASE, ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    const txt = await r.text(); let json = null; try { json = JSON.parse(txt); } catch (_) { /* não é JSON */ }
    return { status: r.status, json };
  };
  return { cookie: () => cookie, get: (u) => req('GET', u), post: (u, b) => req('POST', u, b || {}), put: (u, b) => req('PUT', u, b || {}), patch: (u, b) => req('PATCH', u, b || {}), del: (u) => req('DELETE', u) };
}

test('API', { skip: !ATIVO && 'defina RUN_API_TESTS=1 e DATABASE_URL de um banco de teste' }, async (t) => {
  execFileSync(process.execPath, ['scripts/bootstrap.js'], { cwd: RAIZ, env: ENV, stdio: 'pipe' });
  srv = spawn(process.execPath, ['src/server.js'], { cwd: RAIZ, env: ENV, stdio: 'pipe' });
  for (let i = 0; i < 50; i++) { try { if ((await fetch(BASE + '/api/health')).ok) break; } catch (_) { /* subindo */ } await new Promise((r) => setTimeout(r, 200)); }
  t.after(() => srv.kill());

  const admin = cliente();
  const sufixo = Date.now().toString(36);

  await t.test('login do administrador traz as permissões', async () => {
    const r = await admin.post('/api/auth/login', { email: 'admin@teste.local', senha: 'Senha1234' });
    assert.equal(r.status, 200);
    assert.equal(r.json.usuario.perfil, 'admin');
    assert.equal(r.json.usuario.permissoes.clientes, 'editar');
  });

  let cli, ct, end;
  await t.test('cadastro de cliente, contrato e endereço', async () => {
    cli = (await admin.post('/api/clientes', { nome: 'Cliente ' + sufixo })).json;
    assert.ok(cli.id);
    const c = await admin.post(`/api/clientes/${cli.id}/contratos`, { numero: 'C-' + sufixo, tipo: 'principal' });
    assert.equal(c.status, 200, JSON.stringify(c.json));
    ct = c.json.id;
    end = (await admin.post(`/api/contratos/${ct}/enderecos`, { nome: 'Agência Teste', municipio: 'Fortaleza', uf: 'CE', cameras: 4 })).json;
    assert.ok(end.id);
  });

  await t.test('contrato novo já nasce com as atividades padrão e o guia mostra o que falta', async () => {
    const p = (await admin.get(`/api/contratos/${ct}/preparacao`)).json;
    assert.ok(p.atividades >= 1, 'atividades padrão');
    assert.ok(p.tarefas >= p.atividades, 'uma tarefa por atividade no endereço');
    assert.equal(p.sem_responsavel, p.tarefas);
    const sem = await admin.post(`/api/clientes/${cli.id}/contratos`, { numero: 'S-' + sufixo, tipo: 'aditivo', atividades_padrao: false });
    assert.equal((await admin.get(`/api/contratos/${sem.json.id}/preparacao`)).json.atividades, 0);
  });

  await t.test('faturamento por item: valor ao concluir, patrimônio exigido e medição com detalhe', async () => {
    const c = await admin.post(`/api/clientes/${cli.id}/contratos`, { numero: 'F-' + sufixo, tipo: 'aditivo', valor_endereco: 50, exige_patrimonio: true, atividades_padrao: false,
      itens: [{ nome: 'Câmera', faturavel: true, valor_unitario: '100', controla_patrimonio: true }, { nome: 'Cabo', faturavel: false }] });
    assert.equal(c.status, 200, JSON.stringify(c.json));
    const fct = c.json.id;
    const e = (await admin.post(`/api/contratos/${fct}/enderecos`, { nome: 'Agência Fat', municipio: 'Fortaleza', uf: 'CE', cameras: 2, itens: [{ nome: 'Câmera', quantidade: 2 }, { nome: 'Cabo', quantidade: 30 }] })).json;
    assert.ok(e.id, JSON.stringify(e));
    const lista = (await admin.get(`/api/contratos/${fct}/enderecos`)).json;
    assert.ok(Array.isArray(lista), JSON.stringify(lista));
    assert.equal(lista.find((x) => x.id === e.id).valor, 250, 'previsto: 2 × 100 + taxa 50 (cabo não é faturável)');
    await admin.post(`/api/enderecos/${e.id}/conclusao`, { data: new Date().toISOString().slice(0, 10) });
    let f = (await admin.get('/api/faturamento/contratos/' + fct)).json;
    assert.equal(f.aptos.length, 0, 'sem patrimônio não fica apto');
    assert.equal(f.pendentes_patrimonio.length, 1);
    const cam = f.itens.find((i) => i.nome === 'Câmera');
    for (const n of [1, 2]) assert.equal((await admin.post('/api/ativos', { contrato_id: fct, item_id: cam.id, endereco_id: e.id, patrimonio: `P${sufixo}-${n}`, status: 'instalado' })).status, 200);
    assert.equal((await admin.post('/api/ativos', { contrato_id: fct, patrimonio: `P${sufixo}-1` })).status, 409, 'patrimônio repetido');
    f = (await admin.get('/api/faturamento/contratos/' + fct)).json;
    assert.equal(f.aptos.length, 1);
    assert.equal(f.aptos[0].valor, 250);
    const m = await admin.post(`/api/faturamento/contratos/${fct}/medicoes`, { competencia: new Date().toISOString().slice(0, 7), endereco_ids: [e.id] });
    assert.equal(m.status, 200, JSON.stringify(m.json));
    const md = (await admin.get('/api/medicoes/' + m.json.id)).json;
    assert.equal(md.valor_total, 250);
    assert.deepEqual(md.resumo.map((r) => [r.item, r.quantidade, r.total]), [['Câmera', 2, 200], ['Taxa por endereço', 1, 50]]);
    const prev = (await admin.get('/api/faturamento/previsao?contrato=' + fct)).json;
    assert.equal(prev.meses.length, 18);
    assert.equal(prev.meses.find((x) => x.mes === prev.atual).gerado, 250, 'concluído hoje entra como gerado no mês atual');
    // patrimônio registrado pelo app (fila offline) fica instalado no endereço da atividade
    const tarefa = (await admin.get('/api/projetos/' + ct)).json.enderecos.flatMap((x) => x.tarefas)[0];
    const r = (await admin.post('/api/mobile/acoes', { acoes: [{ id: require('crypto').randomUUID(), tipo: 'ativo', tarefa_id: tarefa.id, patrimonio: `APP${sufixo}` }] })).json;
    assert.equal(r.resultados[0].ok, true, JSON.stringify(r));
    const noEnd = (await admin.get(`/api/enderecos/${tarefa.endereco_id}/ativos`)).json;
    assert.ok(noEnd.some((x) => x.patrimonio === `APP${sufixo}` && x.status === 'instalado'));
    const imp = (await admin.post('/api/ativos/lote', { contrato_id: fct, linhas: [{ patrimonio: `P${sufixo}-3`, item: 'Câmera' }, { patrimonio: `P${sufixo}-4`, item: 'Inexistente' }] })).json;
    assert.equal(imp.novos, 1); assert.equal(imp.erros.length, 1);
  });

  await t.test('atividade extra no endereço: registro, checklist, faturamento ao concluir e app', async () => {
    const c = await admin.post(`/api/clientes/${cli.id}/contratos`, { numero: 'X-' + sufixo, tipo: 'aditivo', atividades_padrao: false,
      itens: [{ nome: 'Câmera', faturavel: true, valor_unitario: '100' }] });
    const xct = c.json.id;
    const pad = await admin.post(`/api/contratos/${xct}/atividades`, { nome: 'Instalação', tempo_modo: 'fixo', tempo_qtd: 1, tempo_unidade: 'dia' });
    const ck = (await admin.post('/api/checklists', { nome: 'Poste ' + sufixo, itens: [{ texto: 'Poste aprumado', tipo_resposta: 'check' }] })).json;
    // extra no catálogo, com item novo e preço: não entra sozinha nos endereços
    const ex = await admin.post(`/api/contratos/${xct}/atividades`, { nome: 'Instalação de poste', extra: true, checklist_id: ck.id, tempo_modo: 'fixo', tempo_qtd: 1, tempo_unidade: 'dia',
      item_novo: { nome: 'Poste', unidade: 'un', valor_unitario: '850,50' } });
    assert.equal(ex.status, 200, JSON.stringify(ex.json));
    assert.ok(ex.json.extra && ex.json.item_id);
    const e = (await admin.post(`/api/contratos/${xct}/enderecos`, { nome: 'Agência Extra', municipio: 'Fortaleza', uf: 'CE', cameras: 1, itens: [{ nome: 'Câmera', quantidade: 1 }] })).json;
    let p = (await admin.get('/api/projetos/' + xct)).json;
    assert.deepEqual(p.atividades.map((a) => a.id), [pad.json.id], 'extra não vira coluna nem tarefa automática');
    assert.equal(p.extras.length, 1);
    assert.equal(p.enderecos[0].tarefas.length, 1);
    // inclui no endereço com quantidade e motivo
    const t1 = await admin.post('/api/tarefas/extra', { endereco_id: e.id, atividade_id: ex.json.id, quantidade: 2, motivo: 'Fachada sem fixação' });
    assert.equal(t1.status, 200, JSON.stringify(t1.json));
    assert.equal((await admin.post('/api/tarefas/extra', { endereco_id: e.id, atividade_id: ex.json.id })).status, 400, 'não duplica no endereço');
    assert.equal((await admin.post('/api/tarefas/extra', { endereco_id: e.id, atividade_id: pad.json.id })).status, 400, 'padrão não entra como extra');
    // tipo novo criado na hora, sem item faturável
    const t2 = await admin.post('/api/tarefas/extra', { endereco_id: e.id, nova: { nome: 'Escavação' }, quantidade: '12,5' });
    assert.equal(t2.status, 200, JSON.stringify(t2.json));
    assert.equal(Number(t2.json.quantidade), 12.5);
    p = (await admin.get('/api/projetos/' + xct)).json;
    const ext = p.enderecos[0].tarefas.find((x) => x.id === t1.json.id);
    assert.equal(ext.extra, true); assert.equal(ext.item_nome, 'Poste'); assert.equal(ext.ck_total, 1); assert.equal(ext.motivo, 'Fachada sem fixação');
    assert.ok((await admin.get(`/api/tarefas/${t1.json.id}/eventos`)).json.some((x) => x.tipo === 'extra'), 'inclusão no histórico');
    // endereço concluído com extra faturável aberta: fica fora da medição até concluir a extra
    await admin.post(`/api/enderecos/${e.id}/conclusao`, { data: new Date().toISOString().slice(0, 10) });
    let f = (await admin.get('/api/faturamento/contratos/' + xct)).json;
    assert.equal(f.aptos.length, 0); assert.equal(f.pendentes_extra.length, 1);
    assert.equal((await admin.patch('/api/tarefas/' + t1.json.id, { quantidade: 3 })).status, 200);
    assert.equal((await admin.patch('/api/tarefas/' + t1.json.id, { status: 'concluida' })).status, 200);
    f = (await admin.get('/api/faturamento/contratos/' + xct)).json;
    assert.equal(f.aptos.length, 1, 'escavação sem item não segura a medição');
    assert.equal(f.aptos[0].valor, 100 + 3 * 850.5);
    assert.ok(f.aptos[0].detalhe.some((d) => d.extra && /Poste · extra: Instalação de poste/.test(d.item)));
    const m = (await admin.post(`/api/faturamento/contratos/${xct}/medicoes`, { competencia: new Date().toISOString().slice(0, 7), endereco_ids: [e.id] })).json;
    const md = (await admin.get('/api/medicoes/' + m.id)).json;
    assert.equal(md.valor_total, 100 + 3 * 850.5);
    // app: técnico inclui a extra pela fila offline e ela fica com ele
    const t3 = (await admin.post('/api/mobile/acoes', { acoes: [{ id: require('crypto').randomUUID(), tipo: 'extra', endereco_id: e.id, atividade_id: t2.json.atividade_id }] })).json;
    assert.equal(t3.resultados[0].ok, false, 'já existe no endereço');
    // remover extra incluída por engano
    assert.equal((await admin.del('/api/tarefas/' + t2.json.id)).status, 200);
    assert.equal((await admin.del('/api/tarefas/' + p.enderecos[0].tarefas.find((x) => !x.extra).id)).status, 400, 'padrão não se remove');
  });

  await t.test('site: pedido de demonstração sem login chega em Contatos do site', async () => {
    const anon = cliente();
    const r = await anon.post('/api/site/contato', { nome: 'Lead ' + sufixo, email: `lead_${sufixo}@empresa.com.br`, empresa: 'Integradora', enderecos: '51 a 200', origem: 'Hero' });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal((await anon.post('/api/site/contato', { nome: 'X', email: 'invalido' })).status, 400);
    assert.equal((await anon.get('/api/contatos')).status, 401);
    const lista = (await admin.get('/api/contatos')).json;
    const c = lista.find((x) => x.nome === 'Lead ' + sufixo);
    assert.ok(c && c.status === 'novo');
    assert.equal((await admin.patch('/api/contatos/' + c.id, { status: 'em_contato', nota: 'Ligar terça' })).json.status, 'em_contato');
  });

  await t.test('relatórios: modelo com estrutura própria, ligado ao checklist, e lista de evidências do endereço', async () => {
    const meta = (await admin.get('/api/relatorio-modelos/meta')).json;
    assert.ok(meta.padrao.estrutura.length >= 8);
    const ck = (await admin.post('/api/checklists', { nome: 'Rel ' + sufixo, itens: [{ texto: 'Foto da fachada', tipo_resposta: 'foto' }] })).json;
    const estrutura = meta.padrao.estrutura.map((x) => (x.tipo === 'checklist' ? { ...x, ativo: false } : x));
    estrutura.splice(1, 0, { tipo: 'texto', titulo: 'Escopo', ativo: true, texto: 'Escopo de {cliente}' });
    const r = await admin.post('/api/relatorio-modelos', { nome: 'Modelo ' + sufixo, padrao: true, checklist_ids: [ck.id], modelo: { ...meta.padrao, estrutura, evidencias: { colunas: 3, excluir: ['__geral__'] } } });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const g = (await admin.get('/api/relatorio-modelos/' + r.json.id)).json;
    assert.deepEqual(g.checklist_ids, [ck.id]);
    assert.equal(g.modelo.estrutura[1].titulo, 'Escopo');
    assert.equal(g.modelo.evidencias.colunas, 3);
    assert.equal(g.modelo.estrutura.find((x) => x.tipo === 'checklist').ativo, false);
    const pv = await fetch(BASE + '/api/relatorio-modelos/previa', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE, Cookie: admin.cookie() }, body: JSON.stringify({ modelo: g.modelo }) }).catch(() => null);
    if (pv) assert.equal(pv.status, 200);
    const ev = (await admin.get(`/api/enderecos/${end.id}/evidencias`)).json;
    assert.ok(Array.isArray(ev.tarefas) && ev.endereco.id === end.id);
    assert.equal((await admin.del('/api/relatorio-modelos/' + r.json.id)).status, 200);
  });

  await t.test('auditoria registra quem mudou o endereço, com antes e depois', async () => {
    const r = await admin.put('/api/enderecos/' + end.id, { nome: 'Agência Teste', logradouro: 'Rua Nova, 10', municipio: 'Fortaleza', uf: 'CE', cameras: 6 });
    assert.equal(r.status, 200);
    const h = (await admin.get(`/api/enderecos/${end.id}/historico`)).json;
    const up = h.find((x) => x.acao === 'update' && x.depois && x.depois.cameras === 6);
    assert.ok(up, 'linha de alteração');
    assert.equal(up.antes.cameras, 4);
    assert.equal(up.usuario_nome, 'Admin Teste');
    const a = (await admin.get('/api/auditoria?tabela=enderecos&registro=' + end.id)).json;
    assert.ok(a.linhas.length >= 2);
  });

  const visitante = cliente();
  await t.test('perfil novo só com leitura de clientes', async () => {
    const p = await admin.post('/api/perfis', { codigo: 'visitante_' + sufixo, nome: 'Visitante ' + sufixo, permissoes: { clientes: 'ver' }, acoes: {} });
    assert.equal(p.status, 200);
    const u = await admin.post('/api/usuarios', { nome: 'Visitante', email: `v_${sufixo}@teste.local`, perfil: p.json.codigo, senha: 'Senha1234' });
    assert.equal(u.status, 200);
    assert.equal((await visitante.post('/api/auth/login', { email: `v_${sufixo}@teste.local`, senha: 'Senha1234' })).status, 200);
    // senha definida pelo administrador é temporária: antes de trocar, só /api/auth fica liberado
    const bloq = await visitante.get('/api/clientes');
    assert.equal(bloq.status, 403); assert.equal(bloq.json.trocar_senha, true);
    assert.equal((await visitante.post('/api/auth/senha', { atual: 'Senha1234', nova: 'Senha5678x' })).status, 200);
    assert.equal((await visitante.get('/api/clientes')).status, 200);
    assert.equal((await visitante.put('/api/enderecos/' + end.id, { nome: 'x', municipio: 'Fortaleza', uf: 'CE', cameras: 1 })).status, 403);
    assert.equal((await visitante.get('/api/auditoria')).status, 403);
    assert.equal((await visitante.get('/api/faturamento/contratos')).status, 403);
    assert.equal((await visitante.get('/api/perfis')).status, 403);
  });

  await t.test('perfil do sistema não pode ser excluído; administrador mantém acesso total', async () => {
    assert.equal((await admin.del('/api/perfis/coordenador')).status, 400);
    await admin.put('/api/perfis/admin', { nome: 'Administrador', permissoes: {}, acoes: {} });
    assert.equal((await admin.get('/api/auditoria')).status, 200);
  });

  await t.test('reabrir atividade concluída exige a permissão', async () => {
    const at = await admin.post(`/api/contratos/${ct}/atividades`, { nome: 'Instalação', tempo_modo: 'fixo', tempo_qtd: 1, tempo_unidade: 'dia' });
    assert.equal(at.status, 200, JSON.stringify(at.json));
    const proj = (await admin.get('/api/projetos/' + ct)).json;
    const tarefa = proj.enderecos.flatMap((e) => e.tarefas)[0];
    assert.ok(tarefa, 'tarefa criada para o endereço');
    assert.equal((await admin.patch('/api/tarefas/' + tarefa.id, { status: 'concluida' })).status, 200);
    await admin.put('/api/perfis/visitante_' + sufixo, { nome: 'Visitante', permissoes: { clientes: 'ver', projetos: 'editar' }, acoes: { reabrir: false } });
    const r = await visitante.patch('/api/tarefas/' + tarefa.id, { status: 'em_andamento' });
    assert.equal(r.status, 403);
    assert.match(r.json.erro, /reabrir/);
    assert.equal((await admin.patch('/api/tarefas/' + tarefa.id, { status: 'em_andamento' })).status, 200);
  });

  await t.test('limite de tentativas de login fica no banco', async () => {
    const anon = cliente();
    let ultimo;
    for (let i = 0; i < 11; i++) ultimo = await anon.post('/api/auth/login', { email: `ninguem_${sufixo}@teste.local`, senha: 'errada' });
    assert.equal(ultimo.status, 429);
    const a = (await admin.get('/api/auditoria?acao=login_falhou&limite=10')).json;
    assert.ok(a.linhas.length > 0, 'tentativas recusadas na auditoria');
  });
});
