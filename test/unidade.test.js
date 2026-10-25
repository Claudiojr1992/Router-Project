// Testes de unidade: rodam sem banco (node --test test/)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'segredo-de-teste-0123456789-abcdef';

test('permissões: nível por módulo e ações especiais', () => {
  const perm = require('../src/permissoes');
  const u = { perfil: 'visitante', perm: { permissoes: { clientes: 'ver', projetos: 'editar' }, acoes: { reabrir: true } } };
  assert.equal(perm.pode(u, 'clientes', 'ver'), true);
  assert.equal(perm.pode(u, 'clientes', 'editar'), false);
  assert.equal(perm.pode(u, 'projetos', 'editar'), true);
  assert.equal(perm.pode(u, 'faturamento', 'ver'), false);
  assert.equal(perm.podeAcao(u, 'reabrir'), true);
  assert.equal(perm.podeAcao(u, 'excluir'), false);
  const admin = { perfil: 'admin', perm: { permissoes: {}, acoes: {} } };
  assert.equal(perm.pode(admin, 'usuarios', 'editar'), true, 'o administrador nunca perde o acesso');
});

test('permissões: a tabela de rotas decide GET = ver, demais = editar', () => {
  const perm = require('../src/permissoes');
  const u = { perfil: 'x', perm: { permissoes: { clientes: 'ver' }, acoes: {} } };
  assert.equal(perm.checarRota(u, 'GET', '/api/clientes/1'), true);
  assert.match(String(perm.checarRota(u, 'PUT', '/api/enderecos/1')), /não pode alterar/);
  assert.match(String(perm.checarRota(u, 'GET', '/api/auditoria')), /não pode ver Auditoria/);
  const ed = { perfil: 'x', perm: { permissoes: { clientes: 'editar' }, acoes: {} } };
  assert.match(String(perm.checarRota(ed, 'DELETE', '/api/enderecos/9')), /Excluir/);
  assert.equal(perm.checarRota(ed, 'GET', '/api/auth/me'), true);
});

test('permissões: toda rota da API está coberta pela tabela', () => {
  const perm = require('../src/permissoes');
  const dir = path.join(__dirname, '..', 'src', 'routes');
  const publicas = /^\/api\/(auth\/|assinar\/|health$)/;
  const faltando = [];
  for (const f of fs.readdirSync(dir)) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const m of src.matchAll(/app\.(get|post|put|patch|delete)\(['`]([^'`]+)['`]/g)) {
      const metodo = m[1].toUpperCase(), rota = m[2].replace(/:[a-zA-Z_]+/g, '1').replace(/\$\{[^}]+\}/g, 'enderecos');
      if (!rota.startsWith('/api/') || publicas.test(rota)) continue;
      if (perm.checarRota({ perfil: 'x', perm: { permissoes: {}, acoes: {} } }, metodo, rota) === null) faltando.push(`${metodo} ${rota} (${f})`);
    }
  }
  assert.deepEqual(faltando, [], 'rotas sem regra de permissão');
});

test('permissões: normalizar respeita módulos só de leitura', () => {
  const perm = require('../src/permissoes');
  const n = perm.normalizar({ permissoes: { auditoria: 'editar', clientes: 'qualquer' }, acoes: { reabrir: 1 } });
  assert.equal(n.permissoes.auditoria, 'ver');
  assert.equal(n.permissoes.clientes, 'nenhum');
  assert.equal(n.acoes.reabrir, true);
  assert.equal(n.acoes.excluir, false);
});

test('endereço: município, UF e CEP lidos do texto', () => {
  const { lerEndereco } = require('../src/conexoes');
  assert.deepEqual(lerEndereco('Rua X, 100 - Centro, Fortaleza - CE, 60000-000'), { municipio: 'Fortaleza', uf: 'CE', cep: '60000-000' });
  assert.equal(lerEndereco('Av. Brasil 200, Belém/PA').municipio, 'Belém');
  assert.equal(lerEndereco('Praça da Sé s/n\nSão Paulo - SP 01001000').cep, '01001-000');
  assert.equal(lerEndereco('Rua B 10 - Centro - Juazeiro do Norte - CE').municipio, 'Juazeiro do Norte');
});

test('conexões: token criptografado volta igual', () => {
  const { cifrar, decifrar } = require('../src/conexoes');
  const c = cifrar('meu-token');
  assert.notEqual(c, 'meu-token');
  assert.equal(decifrar(c), 'meu-token');
});

test('segurança: senha e sessão assinada', async () => {
  const sec = require('../src/security');
  const h = await sec.hashPassword('Senha1234');
  assert.equal(await sec.verifyPassword('Senha1234', h), true);
  assert.equal(await sec.verifyPassword('errada', h), false);
  const t = sec.signSession({ uid: 7 });
  assert.equal(sec.verifySession(t).uid, 7);
  assert.equal(sec.verifySession(t.slice(0, -2) + 'xx'), null);
  assert.equal(sec.senhaValida('abc'), false);
});

test('zip: arquivo válido com nomes repetidos renomeados', () => {
  const { criarZip, crc32 } = require('../src/zip');
  const z = criarZip([{ nome: 'a.txt', dados: Buffer.from('oi') }, { nome: 'a.txt', dados: Buffer.from('tchau') }]);
  assert.equal(z.readUInt32LE(0), 0x04034b50);
  assert.equal(z.readUInt32LE(z.length - 22), 0x06054b50);
  assert.equal(z.readUInt16LE(z.length - 12), 2);
  assert.ok(z.includes(Buffer.from('a_2.txt')));
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
});

test('relatório: modelo normalizado e limites', () => {
  const { normalizarModelo } = require('../src/relatorio');
  const m = normalizarModelo({ titulo: 'Entrega · {endereco}', assinaturas: ['Técnico', 'Cliente'] });
  assert.equal(m.titulo, 'Entrega · {endereco}');
  assert.deepEqual(m.assinaturas, ['Técnico', 'Cliente']);
  assert.throws(() => normalizarModelo({ assinaturas: ['A', 'B', 'C', 'D', 'E'] }), /até 4/);
});

test('cadastro: "vai para a rota" aceita Sim/Não da planilha', () => {
  const { parseNaRota } = require('../src/plano');
  assert.equal(parseNaRota('Sim'), true);
  assert.equal(parseNaRota('não'), false);
  assert.equal(parseNaRota(''), undefined);
  assert.throws(() => parseNaRota('talvez'));
});

test('painel de rotas: o motor monta o plano mensal do BNB', () => {
  const { makeEngine } = require('../public/painel/engine');
  const { montarDados } = require('../src/rota-dados');
  const md = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src', 'data', 'mapdata.json'), 'utf8'));
  const ends = md.units.map((u) => ({ ref_id: u.id, cameras: u.c, contrato_id: 1, nome: u.n, municipio: u.m, uf: u.uf }));
  const D = montarDados({ id: 1, nome: 'BNB', base_lat: null }, ends, {});
  assert.equal(D.units.length, md.units.length);
  const E = makeEngine(D);
  assert.equal(typeof E.monthly2, 'function');
  const P = E.monthly2({ paths: D.O[3], k: 3, mode: 'A', start: '2026-11-03', quota: 15, pins: {}, cfgOrder: {}, force: {} });
  assert.ok(P.rows.length > 0 && P.rows.length <= D.units.length, 'plano com linhas');
  for (const r of P.rows) assert.ok(r.d1 >= r.d0, 'fim depois do início');
});
