# RoutProject

Sistema web para planejar e acompanhar implantações em vários endereços. Ele junta o Painel de rotas, os projetos por contrato, a delegação de atividades e o cadastro de equipes, tudo gravado em **PostgreSQL**.

A primeira carga de dados já vem com o cliente **BNB**: contrato principal com 96 endereços, 5º aditivo com o Centro Cultural Mossoró, 2.172 câmeras, as 6 atividades padrão e 3 checklists.

---

## Sumário

1. [O que tem nesta versão](#1-o-que-tem-nesta-versão)
2. [Como o projeto está organizado](#2-como-o-projeto-está-organizado)
3. [Rodar no seu computador](#3-rodar-no-seu-computador)
4. [Colocar na AWS, passo a passo](#4-colocar-na-aws-passo-a-passo)
5. [Variáveis de ambiente](#5-variáveis-de-ambiente)
6. [Perfis e permissões](#6-perfis-e-permissões)
7. [Painel de rotas dentro do sistema](#7-painel-de-rotas-dentro-do-sistema)
8. [App do técnico (celular)](#8-app-do-técnico-celular)
9. [Próximos passos](#9-próximos-passos)

---

## 1. O que tem nesta versão

| Tela | O que faz |
|---|---|
| **Entrar, Criar cadastro, Confirmar e-mail, Recuperar acesso, Nova senha** | Cadastro com código de 6 dígitos por e-mail. O administrador aprova cada acesso. Recuperação de senha também por código. |
| **Painel de rotas** | Abre com o resumo dos projetos em cards: situação (Requer atenção, Em execução, Concluído), meta de instalações editável, % instalado, unidades, concluídas e atrasadas, com busca e filtros. Ao abrir um projeto: meta mensal, rotas por time, status e PDF para o cliente. Todas as regras de cálculo ficam juntas no painel **Regras do plano** (Equipes e datas, Logística, Meses). O PDF traz o gráfico **Total de agências por mês**. |
| **Projetos** | Um projeto por contrato. Mostra a matriz *endereço × atividade*. Cada atividade pode ir para um técnico, para a coordenação ou para alguém do administrativo. Também faz distribuição em lote com regra por projeto. |
| **Delegadas** | Kanban com o que foi enviado para coordenação e administrativo (ex.: handover), com histórico e comentários. |
| **Minhas atividades** | Lista do técnico ou analista logado, com os botões Iniciar, Pausar e Concluir. Funciona no celular. |
| **Clientes** | Clientes → contratos (com PDF anexado e empresa executora) → endereços. Cada endereço tem a chave **Rota**: desligada, ele fica fora do Painel de rotas e da distribuição (continua em Projetos e no faturamento). Dá para mudar um a um, em lote (“Alterar os listados”) ou pela coluna “Na rota” (Sim/Não) da planilha. |
| **Empresas** | Empresas executoras ou parceiras, vinculadas ao contrato. |
| **Atividades** | Escolha o cliente e o contrato, depois cadastre as atividades com tempo de execução: fixo, por câmera ou por faixa de câmeras. Cada uma pode ter um checklist. |
| **Checklists** | Passos que o técnico confirma: marcar feito, foto, texto ou número. Cada checklist tem o **Modelo do relatório**: título, cabeçalho com campos e variáveis ({cliente}, {endereco}…), logo, cor, termo de aceite e assinaturas. Edite na tela ou importe/exporte em JSON, com prévia em PDF. |
| **Técnicos e times** | Técnicos, coordenação e administrativo. Os times são montados escolhendo os técnicos. |
| **Usuários e acessos** | Cadastro manual de integrantes (com senha inicial), editar, aprovar ou recusar cadastros, mudar perfil, desativar. |
| **Conexões** | Liga o sistema ao **NetBox** e ao **Zabbix** (URL + token de API, guardado criptografado). Busca os sites do NetBox ou os hosts do Zabbix e importa como endereços do contrato (com as atividades), revisando município e UF antes. Também cria no NetBox os sites dos endereços cadastrados aqui. |
| **Projetos → Monitoramento** | Coluna com a situação de cada endereço (Atividades x/y, Cadastrar ativos, Pronto para subir, No Zabbix ✓, Erro). Os ativos (hostname, IP, tipo, interface SNMP/agente/ping, grupo, template) entram à mão, gerados pelas câmeras ou pela planilha modelo. Com **todas as atividades concluídas**, “Subir para o Zabbix” cria ou atualiza os hosts, com o endereço no inventário. |
| **Menu do usuário** (rodapé do menu) | Meus dados e senha, tema Automático/Claro/Escuro e Sair. |
| **Projetos → atividade** | Link de **assinatura do relatório pelo cliente** (copiar, WhatsApp ou e-mail; vale 30 dias) e download das **evidências (.zip)** com fotos e relatórios, por atividade ou por endereço. |
| **App do técnico** (`/m/`) | App para celular, instalável: atividades do dia, checklist, fotos com localização e funcionamento sem internet. |
| **Faturamento** | Medição mensal por contrato: endereços aptos pela regra de cobrança, valor (câmera × valor + valor por endereço), fluxo Aberta → Enviada → Aprovada → NF emitida → Recebida e planilha da medição. |
| **Chat** | Canal Geral e um canal por projeto, com mensagens, pedidos e ocorrências ligados a um endereço e marcação de resolvido. |

---

## 2. Como o projeto está organizado

```
routproject/
├─ Dockerfile, docker-compose.yml   → container do app (+ Postgres local)
├─ .ebextensions/                   → ajustes do Elastic Beanstalk (health check)
├─ .env.example                     → modelo das variáveis de ambiente
├─ db/
│  ├─ migrations/001_init.sql       → estrutura do banco
│  └─ seeds/bnb.sql                 → carga inicial BNB
├─ scripts/
│  ├─ bootstrap.js                  → roda a cada subida: migra, carrega BNB, cria admin
│  ├─ migrate.js / seed.js / create-admin.js
│  └─ gen-seed-bnb.js               → gera db/seeds/bnb.sql a partir de src/data/mapdata.json
├─ public/painel/                   → Painel de rotas: engine.js (cálculo), app.js (tela), pdf.js, mapa-base.js (mapa de ruas), painel.css
├─ test/                            → testes automáticos (unidade, API e navegador)
├─ src/
│  ├─ server.js, http.js            → servidor HTTP (sem framework, só node:http)
│  ├─ config.js, db.js              → configuração e conexão PostgreSQL
│  ├─ security.js, auth.js          → senhas (scrypt), sessão assinada, perfis
│  ├─ mail.js                       → e-mails (SMTP/Amazon SES)
│  └─ routes/                       → API: auth, usuários, cadastros, equipe, projetos, rota
└─ public/                          → telas (HTML + JS puro, sem etapa de build)
```

Dependências: só `pg` (PostgreSQL) e `nodemailer` (e-mail). O servidor HTTP usa o módulo nativo do Node, o que deixa pouca coisa para atualizar e auditar.

---

## 3. Rodar no seu computador

### Opção A: com Docker Desktop (recomendado)

1. Instale o [Docker Desktop](https://www.docker.com/products/docker-desktop/).
2. Na pasta do projeto, copie o arquivo de exemplo:
   - Windows (PowerShell): `Copy-Item .env.example .env`
   - Mac/Linux: `cp .env.example .env`
3. Abra o `.env` e preencha pelo menos:
   ```
   ADMIN_EMAIL=seu.email@empresa.com.br
   ADMIN_PASSWORD=UmaSenhaForte123
   SESSION_SECRET=(um texto longo e aleatório; veja o passo 4.3)
   ```
4. Suba tudo:
   ```
   docker compose up --build
   ```
5. Abra **http://localhost:8080** e entre com o e-mail e a senha do admin.

Sem SMTP configurado, os códigos de confirmação e de recuperação aparecem no log. Para vê-los, rode `docker compose logs -f app`.

Para zerar o banco local, rode `docker compose down -v`.

### Opção B: sem Docker

Você precisa do Node.js 20+ e de um PostgreSQL 16 rodando.

```
npm install
# ajuste DATABASE_URL no .env para o seu Postgres
npm start
```

---

## 4. Colocar na AWS, passo a passo

### 4.0 Como fica a arquitetura

```
 Usuários (navegador / celular)
          │  HTTPS
          ▼
 ┌─────────────────────────────┐
 │ Elastic Beanstalk (Docker)  │  ← app Node.js do RoutProject
 │ região sa-east-1 (São Paulo)│
 └──────────────┬──────────────┘
                │ porta 5432, conexão criptografada (SSL)
                ▼
 ┌─────────────────────────────┐
 │ Amazon RDS · PostgreSQL 16  │  ← sem acesso público
 └─────────────────────────────┘
 Amazon SES → envia os e-mails com códigos (opcional no início)
```

- **Elastic Beanstalk** cria e gerencia o servidor que roda o container. Você só envia um `.zip`.
- **RDS** é o PostgreSQL gerenciado, com backup automático. Ele não fica exposto na internet: só o app consegue conectar.

> **Custos:** os itens que geram cobrança são a instância do RDS e o armazenamento dela, a instância EC2 do Beanstalk, o load balancer (se usar HTTPS com domínio) e a transferência de dados. Monte a estimativa na [AWS Pricing Calculator](https://calculator.aws/) com a região **América do Sul (São Paulo)**. Contas novas podem ter crédito ou nível gratuito; confira as condições atuais na página da AWS.

### 4.1 Conta e segurança (uma vez só)

1. Crie a conta em **aws.amazon.com** e entre como usuário raiz (root).
2. Ative **MFA** no usuário raiz: menu da conta → *Security credentials* → *Assign MFA*.
3. Crie um usuário para o dia a dia. A forma mais simples é **IAM** → *Users* → *Create user*, com acesso ao console e a política `AdministratorAccess`. Ative MFA nele também. Daqui em diante, use esse usuário em vez do raiz.
4. Crie um alerta de gastos: **Billing and Cost Management** → *Budgets* → *Create budget* → *Monthly cost budget*, com um valor limite e o seu e-mail.
5. No canto superior direito do console, escolha a região **South America (São Paulo) sa-east-1**. Crie tudo nela.

### 4.2 Criar o banco PostgreSQL (RDS)

1. Abra **RDS** → *Databases* → **Create database**.
2. Preencha:
   - *Choose a database creation method*: **Standard create**
   - *Engine*: **PostgreSQL**. *Engine version*: a **16.x** mais recente.
   - *Templates*: **Free tier** (se aparecer) ou **Dev/Test**
   - *DB instance identifier*: `routproject-db`
   - *Master username*: `routproject_admin`
   - *Credentials management*: **Self managed**. Crie uma senha forte e guarde-a.
   - *Instance configuration*: **db.t4g.micro** para começar (dá para aumentar depois).
   - *Storage*: **gp3**, 20 GB. Deixe o *autoscaling* ligado.
   - *Connectivity*:
     - *Compute resource*: Don't connect to an EC2 compute resource
     - *VPC*: **Default VPC**
     - *Public access*: **No**
     - *VPC security group*: **Create new**, com o nome `routproject-db-sg`
   - *Additional configuration*:
     - *Initial database name*: **`routproject`** (importante)
     - *Backup retention*: 7 dias
     - Deixe *Enable deletion protection* marcado.
3. Clique em **Create database** e espere o status ficar **Available** (leva uns 10 minutos).
4. Abra o banco e copie o **Endpoint**, algo como `routproject-db.xxxxxxxx.sa-east-1.rds.amazonaws.com`.

A sua `DATABASE_URL` fica assim:
```
postgres://routproject_admin:SUA_SENHA@ENDPOINT:5432/routproject
```
> Se a senha tiver caracteres especiais (`@ : / ? # %`), troque-os pelo código de URL (ex.: `@` vira `%40`). Outra saída é usar uma senha só com letras e números, longa.

### 4.3 Gerar o segredo da sessão

Rode um destes comandos e guarde o resultado. Ele vai em `SESSION_SECRET`.

- Mac/Linux: `openssl rand -hex 32`
- Windows (PowerShell):
  ```
  -join ((1..64) | ForEach-Object { '{0:x}' -f (Get-Random -Max 16) })
  ```

### 4.4 Preparar o pacote (.zip)

O `Dockerfile` precisa ficar **na raiz do zip**, não dentro de uma subpasta. Não inclua `node_modules` nem `.env`.

- **Windows (PowerShell)**, dentro da pasta do projeto:
  ```
  Get-ChildItem -Force | Where-Object { $_.Name -notin 'node_modules','.env','.git','deploy.zip' } |
    Compress-Archive -DestinationPath deploy.zip -Force
  ```
- **Mac/Linux**, dentro da pasta do projeto:
  ```
  zip -r deploy.zip . -x "node_modules/*" ".env" ".git/*" "deploy.zip"
  ```

### 4.5 Criar o ambiente no Elastic Beanstalk

1. Abra **Elastic Beanstalk** → **Create application**.
2. **Passo 1, Configure environment:**
   - *Environment tier*: **Web server environment**
   - *Application name*: `RoutProject`
   - *Environment name*: `routproject-prod`
   - *Platform*: **Docker**. *Platform branch*: **Docker running on 64bit Amazon Linux 2023**.
   - *Application code*: **Upload your code** → *Local file* → escolha o `deploy.zip`. Em *Version label*, use por exemplo `v1`.
   - *Presets*:
     - **Single instance**: mais barato, bom para começar (acesso por HTTP).
     - **High availability**: inclui load balancer. É o caminho para usar **HTTPS com o seu domínio** (passo 4.8).
3. **Passo 2, Configure service access:**
   - *Service role*: **Create and use new service role** (`aws-elasticbeanstalk-service-role`).
   - *EC2 instance profile*: se não existir nenhum, crie em **IAM** → *Roles* → *Create role* → *AWS service* → **EC2**, com as políticas `AWSElasticBeanstalkWebTier` e `AWSElasticBeanstalkMulticontainerDocker`, e o nome `aws-elasticbeanstalk-ec2-role`. Depois volte e selecione-o.
4. **Passo 3, Set up networking, database, and tags:**
   - *VPC*: a **mesma Default VPC** do RDS.
   - *Public IP address*: **marcado** (para o modo Single instance).
   - *Instance subnets*: marque todas.
   - *Database*: **não** crie o banco aqui, porque ele já foi criado no 4.2. Assim o banco não é apagado se você recriar o ambiente.
5. **Passo 4, Configure instance traffic and scaling:**
   - *Instance types*: deixe só **t4g.small** (ou **t3.small**).
6. **Passo 5, Configure updates, monitoring, and logging** → **Environment properties**. Adicione:

   | Name | Value |
   |---|---|
   | `NODE_ENV` | `production` |
   | `DATABASE_URL` | `postgres://routproject_admin:SENHA@ENDPOINT:5432/routproject` |
   | `DB_SSL` | `true` |
   | `DB_SSL_CA` | `/app/certs/rds-global-bundle.pem` |
   | `SESSION_SECRET` | (o valor do passo 4.3) |
   | `APP_URL` | por enquanto `http://` + o endereço que o Beanstalk vai mostrar. Ajuste depois. |
   | `TRUST_PROXY_HOPS` | `1` (Single instance) ou `2` (High availability) |
   | `ADMIN_NAME` | seu nome |
   | `ADMIN_EMAIL` | seu e-mail |
   | `ADMIN_PASSWORD` | senha inicial, com 8+ caracteres, letras e números |
   | `SEED_BNB` | `true` |

7. Revise e clique em **Submit**. A criação leva de 5 a 10 minutos. No começo a saúde fica vermelha, porque o app ainda não alcança o banco. Isso se resolve no próximo passo.

### 4.6 Liberar o banco para o app

1. No Beanstalk, abra o ambiente → *Configuration* → *Instance traffic and scaling* (ou *Networking*). Anote o **security group das instâncias**. Ele tem um nome parecido com `awseb-e-xxxx-stack-AWSEBSecurityGroup-...`.
2. Vá em **EC2** → *Security Groups* → abra o `routproject-db-sg` (do RDS) → **Edit inbound rules** → **Add rule**:
   - *Type*: **PostgreSQL** (porta 5432)
   - *Source*: **Custom** → selecione o security group do Beanstalk anotado acima
3. Salve. No Beanstalk, clique em **Actions → Restart app server(s)**. Em um minuto a saúde fica **Ok** (verde).

> Se continuar vermelho, abra **Logs → Request logs → Last 100 lines** e procure por `[bootstrap]`. A causa mais comum é usuário, senha ou endpoint errado na `DATABASE_URL`, ou a regra do security group que faltou.

### 4.7 Primeiro acesso

1. Clique no endereço do ambiente, algo como `routproject-prod.xxxx.sa-east-1.elasticbeanstalk.com`.
2. Entre com o `ADMIN_EMAIL` e o `ADMIN_PASSWORD`.
3. Volte em **Configuration → Environment properties** e:
   - mude `SEED_BNB` para `false`. A carga só roda com o banco vazio, mas assim fica explícito;
   - apague o `ADMIN_PASSWORD`. O admin já foi criado, e a senha não precisa ficar guardada ali.
4. Para a equipe entrar: cada pessoa usa **Criar cadastro**, confirma o e-mail e você aprova em **Usuários e acessos**. Enquanto o e-mail não estiver configurado (passo 4.9), os códigos aparecem nos logs do Beanstalk.

### 4.8 Domínio próprio e HTTPS

Para isso, o ambiente precisa ser **High availability** (com load balancer). Se você criou como Single instance, vá em **Configuration → Capacity → Environment type: Load balanced**.

1. **Certificado:** abra **AWS Certificate Manager (ACM)** na região **sa-east-1** → *Request* → *Request a public certificate* → domínio, por exemplo `rotas.suaempresa.com.br` → validação por **DNS**.
2. O ACM mostra um registro **CNAME**. Crie esse registro no DNS do seu domínio (registro.br, Route 53, Cloudflare etc.). Em alguns minutos o certificado fica **Issued**.
3. No Beanstalk: **Configuration → Load balancer → Edit → Listeners → Add listener**:
   - *Port*: **443**, *Protocol*: **HTTPS**, *SSL certificate*: o do passo 1.
4. No DNS do seu domínio, crie um **CNAME** de `rotas` apontando para o endereço do ambiente (`routproject-prod.xxxx.sa-east-1.elasticbeanstalk.com`).
5. Atualize as variáveis:
   - `APP_URL` = `https://rotas.suaempresa.com.br`. O cookie de sessão passa a ser só HTTPS automaticamente.
   - `TRUST_PROXY_HOPS` = `2`
6. Opcional: para mandar todo acesso HTTP para HTTPS, configure no listener 80 do load balancer (EC2 → Load Balancers → Listeners) uma ação de **Redirect** para HTTPS 443.

### 4.9 E-mail com Amazon SES

1. Abra **Amazon SES** (sa-east-1) → *Identities* → **Create identity** → *Domain* → seu domínio. Crie no DNS os registros **DKIM** que o SES mostrar.
2. A conta começa no modo *sandbox*, que só envia para e-mails verificados. Peça a liberação em **Account dashboard → Request production access**.
3. Gere as credenciais em **SMTP settings → Create SMTP credentials**. Guarde o usuário e a senha.
4. No Beanstalk, adicione:

   | Name | Value |
   |---|---|
   | `SMTP_HOST` | `email-smtp.sa-east-1.amazonaws.com` |
   | `SMTP_PORT` | `587` |
   | `SMTP_USER` | (usuário SMTP do SES) |
   | `SMTP_PASS` | (senha SMTP do SES) |
   | `MAIL_FROM` | `RoutProject <nao-responda@suaempresa.com.br>` |

### 4.10 Atualizar o sistema

1. Gere um novo `deploy.zip` (passo 4.4).
2. No Beanstalk: **Upload and deploy** → escolha o zip e use um novo *Version label* (`v2`, `v3`…).
3. As migrações novas do banco (`db/migrations/00X_*.sql`) rodam sozinhas na subida. Cada uma roda uma única vez.

Para voltar uma versão, use **Application versions**, escolha a anterior e clique em **Deploy**.

### 4.11 Backup e acompanhamento

- **Backup automático** do RDS: 7 dias, com restauração para qualquer momento. Antes de mudanças grandes, faça um **snapshot manual** (RDS → Actions → Take snapshot).
- **Logs** do app: Beanstalk → *Logs*. Para guardar por mais tempo, ative *Instance log streaming to CloudWatch Logs* em **Configuration → Updates, monitoring and logging**.
- **Saúde**: o Beanstalk consulta `/api/health`, que também testa o banco.

### 4.12 Checklist de segurança

- [ ] MFA no usuário raiz e no seu usuário IAM. O raiz não é usado no dia a dia.
- [ ] Alerta de orçamento criado.
- [ ] RDS com **Public access = No**. A porta 5432 fica liberada só para o security group do Beanstalk.
- [ ] `DB_SSL=true` com `DB_SSL_CA` apontando para o certificado do RDS.
- [ ] `SESSION_SECRET` longo e aleatório, diferente do ambiente local.
- [ ] HTTPS ativo com domínio próprio e `APP_URL` começando com `https://`.
- [ ] `ADMIN_PASSWORD` removido depois do primeiro acesso.
- [ ] Deletion protection ligado no RDS.
- [ ] Nunca enviar o `.env` para o GitHub (o `.gitignore` já bloqueia).

O que o sistema já faz por conta própria:
- senhas com **scrypt**;
- sessão em cookie **HttpOnly** + **SameSite** assinado;
- códigos de 6 dígitos guardados só como hash, com validade e limite de tentativas;
- limite de tentativas por IP em login e cadastro;
- bloqueio de requisições de outra origem;
- cabeçalhos de segurança (CSP, X-Frame-Options, HSTS com HTTPS);
- validação de toda entrada da API;
- consultas SQL sempre parametrizadas.

---

## 5. Variáveis de ambiente

| Variável | Obrigatória | Para que serve |
|---|---|---|
| `DATABASE_URL` | sim | Conexão com o PostgreSQL |
| `DB_SSL` | na AWS | `true` para conexão criptografada com o RDS |
| `DB_SSL_CA` | recomendada | Certificado do RDS. No container: `/app/certs/rds-global-bundle.pem` |
| `SESSION_SECRET` | sim | Assina as sessões e os códigos. Mínimo de 24 caracteres. |
| `APP_URL` | sim | Endereço público usado nos links dos e-mails. Com `https://`, o cookie vira só HTTPS. |
| `NODE_ENV` | sim na AWS | `production` |
| `PORT` | não | Padrão 8080 |
| `TRUST_PROXY_HOPS` | não | 1 = instância única; 2 = com load balancer |
| `SESSION_HOURS` | não | Duração da sessão, padrão 12 h |
| `ADMIN_NAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` | 1º acesso | Criam o administrador se ainda não houver nenhum |
| `SEED_BNB` | não | `true` carrega o BNB quando o banco não tem clientes |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | não | Envio de e-mail. Sem isso, os códigos vão para o log. |

Comandos úteis (local ou no container):
```
npm run migrate        # aplica migrações pendentes
npm run seed           # carga BNB (só com o banco sem clientes)
npm run create-admin   # cria/reativa o admin com ADMIN_EMAIL/ADMIN_PASSWORD
npm test               # testes de unidade (e de API com RUN_API_TESTS=1 e um banco de teste)
npm run test:e2e       # teste no navegador com o sistema no ar (E2E_URL, E2E_EMAIL, E2E_SENHA)
```

---

## 6. Perfis e permissões

Os perfis são editáveis na tela **Permissões** (menu Administração). Para cada perfil:

- cada tela/módulo tem um nível: **Sem acesso**, **Ver** ou **Ver e editar** (Auditoria é só leitura);
- **ações especiais**: reabrir atividade concluída, excluir registros, trocar o responsável, distribuir em lote e subir ao Zabbix sem concluir as atividades;
- **em Técnicos e times entra como**: técnico, coordenação, administrativo ou não entra.

Dá para criar perfis novos (começando de um existente), duplicar e comparar todos lado a lado. Os perfis do sistema (Administrador, Coordenação, Supervisão, Administrativo, Técnico e Cliente) podem ser editados, mas não excluídos; o **Administrador mantém sempre acesso total**. A regra vale no servidor (toda rota da API passa pela tabela de `src/permissoes.js`), no menu e nos botões de cada tela.

| Perfil (padrão) | Pode |
|---|---|
| **Administrador** | Tudo, incluindo usuários, permissões e auditoria |
| **Coordenação** / **Supervisão** | Operação e cadastros completos; reabrir, excluir, delegar e distribuir; ver a auditoria |
| **Administrativo** | Rotas, projetos, delegadas, faturamento e clientes; atividades, checklists, equipe e conexões só leitura; delegar |
| **Técnico** | Minhas atividades, app e chat (não reabre concluída) |
| **Cliente** | Reservado para o portal do cliente |

### Auditoria

A tela **Auditoria** mostra tudo o que muda no sistema: quem, quando, IP, o que era antes e o que ficou (gatilhos no banco em clientes, contratos, endereços, atividades, checklists, usuários, perfis, medições, conexões e demais cadastros), além de logins e logins recusados. Filtros por período, pessoa, área, ação e texto, e exportação para Excel. Em **Clientes**, o endereço, o contrato e a aba Dados têm o botão **Histórico de alterações**.

### Limite de tentativas

Login, cadastro, códigos e troca de senha têm limite por IP e (no login) por e-mail, guardado no banco (tabela `tentativas`): vale mesmo com várias instâncias na AWS. Um login certo zera a contagem.

---|---|
| **Administrador** | Tudo, incluindo aprovar usuários e mudar perfis |
| **Coordenação** | Painel de rotas, projetos, distribuir e delegar atividades, cadastros |
| **Administrativo** | Painel de rotas, projetos (atualizar e delegar), delegadas, clientes e endereços |
| **Supervisão** | Mesmos acessos da coordenação |
| **Técnico** | Minhas atividades: iniciar, pausar e concluir as que estão com ele (não reabre concluída) |
| **Cliente** | Reservado para um portal futuro (por enquanto vê só um aviso) |

**Reabrir atividade concluída:** só Coordenação, Supervisão ou Administrador, em Projetos, Delegadas e no app (o servidor recusa para os demais, inclusive ações feitas sem internet).

Ao aprovar alguém como técnico, coordenação ou administrativo, a pessoa entra automaticamente em **Técnicos e times** e pode receber atividades.

---

## 7. Painel de rotas dentro do sistema

- O painel publicado como link **continua igual** e com os dados dele.
- No sistema, a tela **Painel de rotas** tem um seletor de **projetos (clientes)** no topo: BNB, Banpará etc. Cada projeto tem as suas rotas, metas, status e PDF, salvos separadamente no banco.
- **BNB**: usa as distâncias de estrada da planilha original (as 97 unidades). Se você incluir endereços novos no BNB ou mudar a base de saída, ele passa a usar distâncias estimadas, como os demais.
- **Demais clientes**: o painel é montado a partir dos endereços cadastrados:
  - a localização vem da latitude/longitude do endereço ou, se estiver vazia, do **centro do município** (tabela do IBGE inclusa no sistema);
  - a distância entre pontos é estimada pela linha reta × 1,3, e o aeroporto é o mais próximo de uma lista dos principais aeroportos;
  - as rotas de 1 a 8 equipes são montadas por setores a partir da base e pelo vizinho mais próximo;
  - os feriados nacionais (com Carnaval, Sexta-feira Santa e Corpus Christi) são calculados automaticamente.
- **Base de saída**: cada projeto tem a sua (padrão Fortaleza/CE). Troque no botão **Alterar** do painel, informando Cidade/UF (ex.: Belém/PA).
- Endereços com município não reconhecido ficam fora da rota e aparecem em vermelho no topo do painel. Corrija município e UF em **Clientes**.
- Status, licença e patrimônio marcados no painel ficam gravados no próprio endereço, então aparecem também em Clientes e Projetos.
- Quem estiver com o painel aberto recebe as mudanças dos colegas a cada 15 segundos. O PDF para o cliente baixa direto no navegador, com o nome do projeto.
- O painel fica em `public/painel/` (código legível, sem etapa de build) e a página em `src/views/painel.html`. O mesmo `engine.js` calcula no navegador e no servidor (distribuição).
- **Mapa de ruas:** os pontos ficam sobre o mapa do OpenStreetMap, no endereço real, com zoom até o nível da rua. As imagens passam pelo servidor do RoutProject (`/tiles/…`), que se identifica para o OpenStreetMap, faz no máximo 2 downloads por vez e guarda cache por 14 dias (pasta `TILE_CACHE_DIR`, padrão a pasta temporária) — o OpenStreetMap bloqueia chamadas diretas do navegador sem identificação. `TILE_URL` troca o servidor de imagens (padrão `https://tile.openstreetmap.org/{z}/{x}/{y}.png`; `TILE_URL=off` volta ao mapa desenhado).
- Dentro do sistema o painel tem duas abas: **Mapa e rotas** e **Planejamento e regras**; a barra de cima mostra projeto, avanço, base de saída e a qualidade das localizações.

### Etapas do projeto (endereços por mês)

- Em **Clientes → Endereços**, o botão **Etapas** cria as etapas do projeto, cada uma com nome e **data de início**. Ex.: Etapa 1 começa em 09/11/2026, Etapa 2 em 07/12/2026. O mês da data é o mês em que os endereços daquela etapa são atacados.
- Em cada endereço, escolha a **Etapa** e a **Ordem na etapa** (1 = primeiro).
- Para vários endereços de uma vez, filtre a lista e use **Etapa dos N listados**.
- Pela planilha, use as colunas **Etapa**, **Início da etapa** (dd/mm/aaaa, basta informar uma vez por etapa) e **Ordem**. Uma etapa que ainda não existe é criada na importação. A exportação traz essas colunas.
- No **Painel de rotas**, ligue **Etapas do cadastro**:
  - cada endereço vai para o mês da sua etapa;
  - a meta desse mês passa a ser o número de endereços da etapa;
  - as instalações começam na data de início da etapa, e o envio do material é calculado para trás;
  - a ordem segue o campo Ordem;
  - endereços sem etapa entram depois, pela meta normal;
  - ajustes manuais feitos no mapa continuam valendo.
- Em **Projetos**, a etapa aparece embaixo de cada endereço e há um filtro por etapa.

### Equipes, início previsto e conclusão manual

- **Equipes** (topo da aba Endereços): escolha quantas equipes o projeto tem (1 a 8). Não precisa ter técnico cadastrado. Cada equipe mostra quantos endereços tem, o primeiro e o último início e quantos estão atrasados. Clique numa equipe para filtrar.
- **Distribuir equipes e datas**: divide os endereços em aberto entre as equipes por região a partir da base, monta a rota de cada equipe e calcula a data de início (dias pelas câmeras + deslocamento, sem fim de semana e feriado). Endereços com etapa começam na data da etapa, na ordem definida.
- Cada endereço tem **Equipe**, **Início previsto** e **Data de conclusão**. Com data de conclusão, o endereço vira "Concluída", sai do Painel de rotas e vai para a lista **Concluídos**. **Retornar** apaga a data e volta para a rota, com o status de antes.
- **Atrasado**: início previsto já passou e o endereço ainda não está em execução.
- **Alterar os N listados**: muda etapa, equipe e/ou início de todos os endereços filtrados.
- Planilha: colunas **Equipe** (1 a 8 ou "Equipe 2"), **Início** (dd/mm/aaaa) e **Conclusão**. A quantidade de equipes do projeto sobe sozinha se a planilha usar uma equipe maior.
- **Painel de rotas**: com "Equipes e datas do cadastro: ligado", cada endereço com equipe e início entra nessa equipe e começa nesse dia; só com equipe, entra na região da equipe. Concluídos com data saem do plano (pílula "Concluídas fora da rota", com Retornar). A pílula **⚠ Atrasadas**, o anel vermelho no mapa e a marca nas tabelas mostram os atrasos (início passou sem execução, ou fim da instalação passou ainda em execução). No detalhe da agência dá para concluir com data. "Gravar equipes e datas no cadastro" leva o plano do painel para os endereços.

### Regras das equipes (produção por dia) e distribuição

- **Regras das equipes** (botão na barra de equipes): para cada equipe, os dias da semana em que trabalha, a data a partir da qual começa (opcional) e a **quantidade que instala por dia** de cada equipamento do projeto (ex.: 8 câmeras/dia, 1 servidor/dia). "Copiar a Equipe 1 para todas" repete a regra.
- Dias em cada endereço = soma de (quantidade ÷ produção por dia) de cada equipamento, arredondado para meio dia, com mínimo por endereço. Sem produção cadastrada vale a faixa de câmeras (até 22 = 2 dias, até 32 = 3, acima = 4).
- **Distribuir equipes e datas** usa só os endereços **não concluídos** (os em execução ficam como estão e ocupam a equipe até o fim previsto). Divide por região, na proporção da capacidade de cada equipe, e calcula início e fim nos dias de trabalho da equipe, sem feriado.
- A distribuição abre uma **prévia editável**: mude a equipe ou o início de qualquer linha, "Recalcular datas" refaz a sequência mantendo o que você mudou, e "Gravar nos endereços" grava equipe, início, fim e dias na tela de endereços.
- **Meta de agências por dia** (opção na distribuição): cada equipe recebe até N agências por dia, na ordem da rota (ex.: 43 endereços, 3 equipes, 5 por equipe = 15 por dia → 3 dias). A meta pode ser **por equipe** ou **no total** (dividida entre as equipes: 5 no total com 3 equipes = 2 + 2 + 1) e contar **só dias úteis** (seg–sex, sem feriado) ou **dias corridos**. Com a meta ligada a produção por equipamento não é usada; a prévia continua editável.
- Mudar equipe ou início de um endereço à mão recalcula o fim pela regra da equipe. Salvar as regras recalcula a duração de todos os endereços em aberto.
- No Painel de rotas (com "Equipes e datas do cadastro" ligado) os dias de cada endereço e o fim vêm do cadastro.
- **PDF do Painel de rotas**: o detalhamento do mês traz o endereço (logradouro, bairro, CEP) e a visão geral completa ganhou a **Lista de endereços** por equipe, com início, fim, código, endereço, município e equipamentos, mais os concluídos.

### Regras das atividades: impacto no tempo e predecessora

- Em **Atividades**, cada atividade tem **Impacto no tempo do endereço**:
  - **Soma**: aumenta os dias no endereço;
  - **Em paralelo**: feita junto com as outras, não soma (só conta se for maior que a soma);
  - **Sem impacto**: não muda o prazo da rota.
- No Painel de rotas, o botão **Dias: pelas faixas de câmeras / pelas atividades** escolhe como calcular os dias de cada endereço. O padrão continua sendo pelas faixas: até 22 câmeras = 2 dias, até 32 = 3 dias, acima disso = 4 dias.
- **Predecessora (depende de)**: a atividade só pode ser **concluída** depois que a predecessora estiver concluída no mesmo endereço.
  - Em Projetos aparece "🔒 aguarda …".
  - No app do técnico aparece o aviso, e o botão Concluir explica o que falta.
  - O servidor recusa a conclusão fora de ordem, inclusive o que foi feito sem internet.
  - A predecessora não pode fechar um ciclo (A depende de B, que depende de A).

### Itens do projeto (equipamentos)

- Ao criar o cliente ou um contrato, informe os **itens do projeto**: câmera, servidor, switch, nobreak… É um campo de texto livre com sugestões, e o botão **+** inclui mais itens.
- Em cada endereço, a seção **Equipamentos para instalar** lista esses itens para preencher a quantidade, e o **+** inclui outros. Equipamento novo digitado ali entra automaticamente nos itens do projeto.
- A quantidade de **Câmera** atualiza o campo Câmeras, que é o que o Painel de rotas usa para calcular os dias de instalação.
- O botão **Itens do projeto**, na aba Endereços e na aba Contratos, mostra os totais de cada equipamento no contrato.
- Na importação, toda coluna além das padrão vira um equipamento, com a quantidade por endereço. A planilha modelo já sai com uma coluna para cada item do projeto. A exportação traz as quantidades.
- Os equipamentos do endereço aparecem no app do técnico e no relatório PDF.

### Estados por mês no Painel de rotas

- Na barra **Estados**, ligue **Estados por mês** e escolha um mês na linha de meses.
- Os estados marcados valem **só para aquele mês**. Entram agências desses estados até a meta, e o que passar fica para depois. O mês mostra os estados escolhidos e quantas agências ficaram para depois.
- No mês seguinte, escolha outros estados: as que ficaram do mês anterior não entram enquanto o estado delas não for escolhido de novo.
- **+ Mês para o restante** cria o mês seguinte à última etapa com os estados e a quantidade que sobraram. Depois dá para ajustar a meta do mês normalmente.
- **Todos** (ou **Limpar seleção**) tira o filtro do mês. Meses sem estados escolhidos pegam de todos os estados.
- Com **Estados por mês** desligado, a barra funciona como antes: o plano inteiro só com os estados marcados.

### Importar e exportar endereços

- Em **Clientes → aba Endereços**, o botão **Importar planilha** aceita **.xlsx** ou **.csv**, ou linhas coladas do Excel.
- No mesmo lugar tem **Baixar modelo (.xlsx)** e **Modelo .csv**. A planilha modelo traz as colunas certas e uma aba de instruções.
- Campos obrigatórios: **Nome, Município e UF**. O sistema aponta as linhas em que falta algum deles antes de importar.
- Com **Atualizar pelo código** marcado, os endereços que têm o mesmo código no contrato são atualizados em vez de duplicados.
- **Exportar** baixa os endereços do contrato em .xlsx ou .csv, com status, licença e patrimônio. Dá para editar e importar de volta.

### Relatório da atividade (PDF)

- Cada atividade tem um relatório em PDF com:
  - os dados do endereço;
  - o **início e a conclusão reais, com horário**, gravados quando o técnico toca em Iniciar e em Concluir;
  - a duração;
  - o checklist, com quem preencheu e quando;
  - o histórico, os comentários e as fotos com data e localização.
- Na tela **Projetos**, cada atividade mostra o andamento do checklist e um ícone de relatório:
  - **verde** = relatório final (atividade concluída);
  - **cinza** = relatório parcial (em andamento).
- Clicar na atividade mostra o checklist preenchido, os horários reais e os botões do PDF. O mesmo vale em **Delegadas** e no app do técnico.
- No editor de **Checklists**, cada item pode ser marcado como **Obrigatório**. No app, ele aparece com <span>*</span> em vermelho, e a atividade só pode ser concluída com esses itens preenchidos.

### Cadastrar um cliente novo do zero

1. **Clientes → + Novo cliente.** Se não informar o número do contrato, ele é criado como "Contrato principal".
2. Na aba **Endereços**, use **Colar lista do Excel**: copie as linhas da planilha, com a linha de títulos, e cole. Colunas reconhecidas: Código, Nome, Endereço, Bairro, CEP, Município, UF, Câmeras, Latitude, Longitude. Só Nome, Município e UF são obrigatórios.
3. Em **Atividades**, escolha o cliente e clique em **Usar as atividades padrão**, ou cadastre as suas.
4. Em **Painel de rotas**, escolha o projeto e ajuste a base de saída.

---

### Logística por endereço e localização pelo endereço

- No detalhe da agência (Painel de rotas), o bloco **Logística deste endereço** grava a **data de despacho**, a **data de entrega do material** e **como a equipe e o material chegam**:
  - **Padrão do plano**: segue o modo escolhido no painel (A, B ou C);
  - **Técnico pela estrada**: deslocamento por estrada mesmo no modo Avião;
  - **Equipamento vai com o técnico**: não espera transporte nem entrega;
  - **Avião**: deslocamento zerado.
- Com entrega informada, a instalação começa no dia útil seguinte (mesmo que o cadastro tenha um início antes; o detalhe mostra “adiado: após a entrega”). Só com o despacho, a entrega é estimada pelo prazo de transporte do estado.
- Os mesmos campos estão no cadastro do endereço (Clientes) e na planilha (colunas **Despacho do material** e **Logística**: Estrada, Leva equipamento, Avião).
- **Localização pelo endereço**: endereços sem latitude/longitude são localizados pelo logradouro, município e CEP (OpenStreetMap/Nominatim), logo ao salvar e em segundo plano a cada 10 minutos. O ponto só é aceito se cair perto do município. Enquanto isso, o ponto fica no centro do município, com um anel tracejado no mapa e o aviso no detalhe, onde há o botão **Localizar pelo endereço**. No topo do painel há o mesmo botão para todos os pendentes.
  - `GEOCODER=off` desliga; `GEOCODER_URL` aponta para outro servidor compatível com o Nominatim; `GEOCODER_EMAIL` identifica o contato nas consultas.
- No BNB (distâncias da planilha original), nome, município, UF e câmeras editados em Clientes passam a valer no painel.

---

## 8. App do técnico (celular)

O app fica em **`/m/`** (ex.: `https://rotas.suaempresa.com.br/m/`). É um PWA: abre no navegador do celular e pode ser instalado na tela inicial, sem loja de aplicativos. O técnico usa o mesmo login do sistema e, ao entrar pelo site, já é levado para o app.

**O que o técnico faz no app**
- Vê as atividades em aberto agrupadas por endereço, com cliente, câmeras, aeroporto e botão para abrir no mapa.
- Inicia, pausa, conclui e reabre cada atividade.
- Preenche o checklist da atividade: marcar feito, texto, número e foto. O botão Concluir só libera quando os itens obrigatórios estão preenchidos.
- Tira fotos pela câmera do celular, no item do checklist ou como foto geral. A foto é reduzida no aparelho para no máximo 1600 px e guarda a localização (pode desligar).
- Escreve comentários que aparecem no histórico da atividade.

**Sem internet**
- Na primeira vez é preciso entrar com internet. Depois disso, as atividades ficam salvas no aparelho e o app abre mesmo sem sinal.
- Tudo o que for feito sem internet entra numa fila (aba **Sincronizar**). Quando a conexão volta, o app envia sozinho: primeiro as fotos, depois status, checklist e comentários, na ordem em que foram feitos. Nada é enviado em dobro.
- Se o servidor recusar algum item (por exemplo, a atividade foi passada para outra pessoa), ele aparece em "Não aceitos pelo servidor" para o técnico ver.
- Se a sessão expirar com itens na fila, o app pede o login de novo e só então envia. Os itens não se perdem.
- Para técnicos que ficam vários dias sem sinal, aumente a duração da sessão no Beanstalk: `SESSION_HOURS=168` (7 dias).

**Instalar no celular**
- **Android (Chrome):** abra o endereço `/m/`. Na tela inicial do app aparece o cartão **Usar como aplicativo** com o botão **Instalar aplicativo** (também na aba Conta). Se o botão não aparecer, use o menu ⋮ do Chrome → **Instalar app**. Não precisa de arquivo .APK nem de loja.
- **iPhone (Safari):** abra o endereço `/m/`, toque em **Compartilhar** e depois em **Adicionar à Tela de Início**.
- A instalação e o funcionamento sem internet exigem **HTTPS** (passo 4.8). Pelo endereço `http://` do Beanstalk o app abre, mas não instala nem funciona offline.

**No escritório:** as fotos enviadas pelo app aparecem no detalhe da atividade em **Projetos** e em **Delegadas**. As fotos ficam guardadas no próprio PostgreSQL. Com volume grande, o próximo passo é movê-las para o Amazon S3.

---

## 8.1 NetBox e Zabbix

1. Em **Conexões**, informe a URL e o token de cada sistema e clique em **Salvar** (o teste roda na hora).
   - **NetBox:** token em *seu usuário → API Tokens*. Para criar sites pelo sistema, o token precisa de escrita.
   - **Zabbix:** token em *Usuários → API tokens*, de um usuário que possa criar hosts e grupos. Para Zabbix anterior à 6.4, marque a opção correspondente.
   - HTTPS interno com certificado próprio: marque **Aceitar certificado próprio**.
   - O servidor do RoutProject (o container) precisa alcançar o NetBox e o Zabbix pela rede. Na AWS, libere o acesso a partir do security group do Beanstalk (ou use VPN/peering).
2. **Trazer sites:** escolha o contrato, busque no NetBox (ou no Zabbix), confira município e UF e clique em **Importar selecionados**. O vínculo fica no endereço (re-importar atualiza em vez de duplicar).
3. **Monitoramento:** em **Projetos**, clique na situação do endereço na coluna **Monitoramento** e cadastre os ativos, ou use o botão **Monitoramento** no topo para baixar o modelo (.xlsx), preencher e importar.
4. Quando todas as atividades do endereço estiverem concluídas, **Subir para o Zabbix** (um endereço) ou **Subir os prontos** (contrato inteiro). Cada ativo vira um host com grupo (criado se não existir), template, interface, inventário (endereço, cidade, UF, coordenadas) e as tags `routproject`, `endereco` e `tipo`. Reenviar atualiza o host existente.

---

## 8.2 Testes automáticos

- `npm test`: testes de unidade (permissões e cobertura de todas as rotas da API, leitura de endereço, criptografia, sessão, zip, relatório e o motor do Painel de rotas).
- `RUN_API_TESTS=1 DATABASE_URL=postgres://…/banco_de_teste npm test`: sobe o servidor num banco vazio e confere cadastro, auditoria (antes/depois), perfis, regra de reabrir e limite de tentativas.
- `npm run test:e2e`: abre todas as telas no navegador e confere o Painel de rotas (precisa do Playwright).
- No GitHub, `.github/workflows/testes.yml` roda os testes de unidade e de API a cada envio, com um PostgreSQL de teste.

---

## 9. Próximos passos

1. **Fotos no Amazon S3**.
2. Chat também no app do técnico (hoje fica no sistema completo).
3. Enviar a medição ao cliente por e-mail direto do Faturamento.
4. Portal do cliente e avisos em tempo real.

## Vercel + Supabase

O mesmo código roda no Vercel como uma função só (`api/index.js`), com o banco no Supabase.

- `vercel.json` manda todas as rotas para a função e inclui `public/`, `src/` e `db/` no pacote.
- As migrações rodam sozinhas na primeira requisição de cada instância (trava no banco evita corrida).
- O `db.js` grava "quem mexeu" com `set_config` local dentro de uma transação curta, o que funciona com o pooler do Supabase (porta 6543, modo transação).
- A migração `014_rls_supabase.sql` liga o RLS em todas as tabelas: o app (dono das tabelas) não é afetado e a API pública do Supabase fica fechada.
- A localização automática de endereços roda pelo Vercel Cron (`/api/cron/geocodificar`, 1x por dia, protegido por `CRON_SECRET`); o botão de localizar no Painel de rotas continua funcionando a qualquer hora.
- Limite do Vercel: cada requisição aceita até 4,5 MB (fotos e arquivos maiores precisam ser reduzidos antes do envio).

Variáveis no projeto do Vercel: `DATABASE_URL` (string do pooler do Supabase, porta 6543), `DB_SSL=true`, `DB_POOL_MAX=3`, `APP_URL`, `NODE_ENV=production`, `NODEJS_HELPERS=0`, `ADMIN_EMAIL` e `ADMIN_PASSWORD` (primeiro acesso). Opcionais: `SESSION_SECRET` (sem ele, o segredo é derivado da `DATABASE_URL`) e `CRON_SECRET` (liga a localização diária).
