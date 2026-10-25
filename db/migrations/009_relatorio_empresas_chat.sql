-- RoutProject · modelo de relatório, assinatura do cliente, empresas, chat, faturamento e endereços fora da rota

-- Modelo do relatório de cada checklist (cabeçalho, campos, termo, assinaturas) — JSON editável ou importado
ALTER TABLE checklists ADD COLUMN relatorio JSONB;

-- Assinatura do relatório pelo cliente, por link (o token fica guardado só como hash)
CREATE TABLE relatorio_assinaturas (
  id          BIGSERIAL PRIMARY KEY,
  tarefa_id   BIGINT NOT NULL REFERENCES tarefas(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  criado_por  BIGINT REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expira_em   TIMESTAMPTZ NOT NULL,
  nome        TEXT,
  documento   TEXT,
  cargo       TEXT,
  imagem      BYTEA,
  ip          TEXT,
  assinado_em TIMESTAMPTZ
);
CREATE INDEX relatorio_assinaturas_tarefa_idx ON relatorio_assinaturas (tarefa_id, assinado_em);

-- Empresas (executora ou parceira) e o vínculo com o contrato
CREATE TABLE empresas (
  id         BIGSERIAL PRIMARY KEY,
  nome       TEXT NOT NULL,
  cnpj       TEXT,
  contato    TEXT,
  email      TEXT,
  telefone   TEXT,
  ativo      BOOLEAN NOT NULL DEFAULT true,
  criado_em  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX empresas_nome_uk ON empresas (lower(nome));
ALTER TABLE contratos ADD COLUMN empresa_id BIGINT REFERENCES empresas(id) ON DELETE SET NULL;

-- Usuário: telefone (meus dados)
ALTER TABLE usuarios ADD COLUMN telefone TEXT;

-- Chat: até onde cada pessoa leu cada canal
CREATE TABLE chat_leituras (
  usuario_id BIGINT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  canal      TEXT NOT NULL,
  lido_em    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (usuario_id, canal)
);

-- Faturamento: datas e observação da medição
ALTER TABLE medicoes ADD COLUMN enviada_em DATE;
ALTER TABLE medicoes ADD COLUMN aprovada_em DATE;
ALTER TABLE medicoes ADD COLUMN observacao TEXT;
CREATE UNIQUE INDEX medicao_enderecos_uk ON medicao_enderecos (endereco_id);

-- Endereço vai (ou não) para o Painel de rotas
ALTER TABLE enderecos ADD COLUMN na_rota BOOLEAN NOT NULL DEFAULT true;

-- Meta de instalações do projeto (card do Painel de rotas); vazio = todos os endereços na rota
ALTER TABLE clientes ADD COLUMN meta_instalacoes INT CHECK (meta_instalacoes IS NULL OR meta_instalacoes > 0);
