// Teste de ponta a ponta no navegador (Playwright). Roda com o sistema no ar:
//   E2E_URL=http://localhost:8080 E2E_EMAIL=admin@... E2E_SENHA=... npm run test:e2e   (precisa de: npm i -D playwright && npx playwright install chromium)
const test = require('node:test');
const assert = require('node:assert/strict');

let pw = null;
try { pw = require('playwright'); } catch (_) { /* opcional */ }
const URL_BASE = process.env.E2E_URL;
const pular = !pw ? 'instale o playwright para rodar' : !URL_BASE ? 'defina E2E_URL, E2E_EMAIL e E2E_SENHA' : false;

test('telas abrem sem erro no navegador', { skip: pular, timeout: 180000 }, async (t) => {
  const b = await pw.chromium.launch(process.env.E2E_CHROMIUM ? { executablePath: process.env.E2E_CHROMIUM } : {});
  t.after(() => b.close());
  const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const erros = [];
  p.on('pageerror', (e) => erros.push(`${p.url()}: ${e.message}`));
  await p.goto(URL_BASE + '/');
  await p.fill('#email', process.env.E2E_EMAIL);
  await p.fill('#senha', process.env.E2E_SENHA);
  await p.click('#go');
  await p.waitForURL('**/app/**');
  for (const tela of ['projetos', 'tarefas', 'faturamento', 'chat', 'empresas', 'atividades', 'checklists', 'equipe', 'conexoes', 'usuarios', 'permissoes', 'auditoria']) {
    await t.test(tela, async () => {
      await p.goto(`${URL_BASE}/app/${tela}.html`);
      await p.waitForSelector('#content');
      await p.waitForTimeout(600);
      const txt = await p.textContent('#content');
      assert.ok(!/não tem acesso/.test(txt), 'tela bloqueada para o administrador');
    });
  }
  await t.test('painel de rotas monta o plano e o mapa', async () => {
    await p.goto(URL_BASE + '/app/projetos.html');
    const card = await p.waitForSelector('.pjcard', { timeout: 10000 });
    await card.click();
    await p.waitForURL('**/app/rota.html?c=*');
    await p.waitForSelector('#pjabas a[aria-current="page"]', { timeout: 10000 });
    const fr = await (await p.waitForSelector('iframe.rota-frame')).contentFrame();
    await fr.waitForSelector('#map circle', { timeout: 15000 });
    assert.ok((await fr.$$('#map circle')).length > 0);
  });
  await t.test('abas do projeto levam à execução e ao cadastro', async () => {
    await p.click('#pjabas >> text=Execução');
    await p.waitForURL('**/app/projetos.html?id=*');
    await p.waitForSelector('.kpis');
    await p.click('#pjabas >> text=Cadastro e endereços');
    await p.waitForURL('**/app/clientes.html?id=*');
    await p.waitForSelector('.tabs');
  });
  await t.test('telas antigas levam para as novas', async () => {
    await p.goto(URL_BASE + '/app/delegadas.html'); await p.waitForURL('**/app/tarefas.html?f=delegadas');
    await p.goto(URL_BASE + '/app/clientes.html'); await p.waitForURL('**/app/projetos.html');
  });
  assert.deepEqual(erros, [], 'erros de JavaScript nas telas');
});
