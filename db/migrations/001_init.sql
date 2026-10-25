-- RoutProject · estrutura inicial
-- Executado automaticamente por scripts/migrate.js (uma única vez, registrado em schema_migrations)

-- ---------- Acesso ----------
CREATE TABLE usuarios (
  id                 BIGSERIAL PRIMARY KEY,
  nome               TEXT NOT NULL,
  email              TEXT NOT NULL,
  senha_hash         TEXT NOT NULL,
  empresa            TEXT,
  perfil             TEXT NOT NULL DEFAULT 'tecnico'
                     CHECK (perfil IN ('admin','coordenador','tecnico','administrativo','cliente')),
  perfil_solicitado  TEXT,
  status             TEXT NOT NULL DEFAULT 'pendente_email'
                     CHECK (status IN ('pendente_email','pendente_aprovacao','ativo','inativo')),
  ultimo_acesso      TIMESTAMPTZ,
  criado_em          TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX usuarios_email_uk ON usuarios (lower(email));

CREATE TABLE codigos (
  id           BIGSERIAL PRIMARY KEY,
  usuario_id   BIGINT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  tipo         TEXT NOT NULL CHECK (tipo IN ('confirmar','reset')),
  codigo_hash  TEXT NOT NULL,
  tentativas   INT NOT NULL DEFAULT 0,
  expira_em    TIMESTAMPTZ NOT NULL,
  usado        BOOLEAN NOT NULL DEFAULT false,
  criado_em    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX codigos_usuario_idx ON codigos (usuario_id, tipo) WHERE NOT usado;

-- ---------- Clientes, contratos e endereços ----------
CREATE TABLE clientes (
  id             BIGSERIAL PRIMARY KEY,
  nome           TEXT NOT NULL,
  razao_social   TEXT,
  cnpj           TEXT,
  segmento       TEXT,
  contato_nome   TEXT,
  contato_email  TEXT,
  contato_fone   TEXT,
  observacoes    TEXT,
  ativo          BOOLEAN NOT NULL DEFAULT true,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE contratos (
  id              BIGSERIAL PRIMARY KEY,
  cliente_id      BIGINT NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  numero          TEXT NOT NULL,
  tipo            TEXT NOT NULL DEFAULT 'principal' CHECK (tipo IN ('principal','aditivo')),
  objeto          TEXT,
  vigencia_inicio DATE,
  vigencia_fim    DATE,
  valor_camera    NUMERIC(12,2),
  valor_endereco  NUMERIC(12,2),
  regra_cobranca  TEXT NOT NULL DEFAULT 'apos_validacao'
                  CHECK (regra_cobranca IN ('apos_validacao','apos_handover')),
  status          TEXT NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo','encerrado','suspenso')),
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX contratos_cliente_idx ON contratos (cliente_id);

CREATE TABLE contrato_arquivos (
  id           BIGSERIAL PRIMARY KEY,
  contrato_id  BIGINT NOT NULL REFERENCES contratos(id) ON DELETE CASCADE,
  nome         TEXT NOT NULL,
  mime         TEXT NOT NULL DEFAULT 'application/pdf',
  tamanho      INT NOT NULL,
  conteudo     BYTEA NOT NULL,
  enviado_por  BIGINT REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE enderecos (
  id           BIGSERIAL PRIMARY KEY,
  contrato_id  BIGINT NOT NULL REFERENCES contratos(id) ON DELETE CASCADE,
  ref_id       INT,                      -- id da unidade no painel de rotas (mapdata)
  codigo       TEXT,
  nome         TEXT NOT NULL,
  logradouro   TEXT,
  bairro       TEXT,
  cep          TEXT,
  municipio    TEXT NOT NULL,
  uf           CHAR(2) NOT NULL,
  lat          DOUBLE PRECISION,
  lon          DOUBLE PRECISION,
  aeroporto    TEXT,
  km_aeroporto INT,
  cameras      INT NOT NULL DEFAULT 0 CHECK (cameras >= 0),
  status       TEXT NOT NULL DEFAULT 'A iniciar'
               CHECK (status IN ('A iniciar','Configurado','Em transporte','Material entregue','Em execução',
                                 'Em validação','Faturado','Handover','Concluída')),
  licenca      TEXT CHECK (licenca IN ('Provisória','Definitiva')),
  patrimonio   TEXT,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX enderecos_contrato_idx ON enderecos (contrato_id);
CREATE UNIQUE INDEX enderecos_ref_uk ON enderecos (ref_id) WHERE ref_id IS NOT NULL;

-- ---------- Checklists e atividades ----------
CREATE TABLE checklists (
  id         BIGSERIAL PRIMARY KEY,
  nome       TEXT NOT NULL,
  descricao  TEXT,
  criado_em  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE checklist_itens (
  id            BIGSERIAL PRIMARY KEY,
  checklist_id  BIGINT NOT NULL REFERENCES checklists(id) ON DELETE CASCADE,
  ordem         INT NOT NULL DEFAULT 0,
  texto         TEXT NOT NULL,
  tipo_resposta TEXT NOT NULL DEFAULT 'check' CHECK (tipo_resposta IN ('check','foto','texto','numero')),
  obrigatorio   BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE atividades (
  id             BIGSERIAL PRIMARY KEY,
  contrato_id    BIGINT NOT NULL REFERENCES contratos(id) ON DELETE CASCADE,
  nome           TEXT NOT NULL,
  curto          TEXT,
  etapa          TEXT,
  funcao         TEXT,                     -- quem normalmente executa (ex.: Técnico de campo)
  tempo_modo     TEXT NOT NULL DEFAULT 'fixo' CHECK (tempo_modo IN ('fixo','por_camera','faixa')),
  tempo_qtd      NUMERIC(8,2) NOT NULL DEFAULT 1,
  tempo_unidade  TEXT NOT NULL DEFAULT 'dia' CHECK (tempo_unidade IN ('hora','dia')),
  min_por_camera INT,
  faixas         JSONB,                    -- ex.: [{"ate":22,"dias":2},{"ate":32,"dias":3},{"ate":null,"dias":4}]
  conta_rota     BOOLEAN NOT NULL DEFAULT true,
  checklist_id   BIGINT REFERENCES checklists(id) ON DELETE SET NULL,
  evidencia      TEXT,
  ordem          INT NOT NULL DEFAULT 0,
  ativo          BOOLEAN NOT NULL DEFAULT true,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX atividades_contrato_idx ON atividades (contrato_id, ordem);

-- ---------- Pessoas e times ----------
CREATE TABLE pessoas (
  id          BIGSERIAL PRIMARY KEY,
  usuario_id  BIGINT UNIQUE REFERENCES usuarios(id) ON DELETE SET NULL,
  nome        TEXT NOT NULL,
  tipo        TEXT NOT NULL CHECK (tipo IN ('tecnico','coordenacao','administrativo')),
  area        TEXT,                        -- ex.: Documentação, Faturamento
  cidade_base TEXT,
  uf_base     CHAR(2),
  telefone    TEXT,
  habilidades TEXT[] NOT NULL DEFAULT '{}',
  ativo       BOOLEAN NOT NULL DEFAULT true,
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE times (
  id         BIGSERIAL PRIMARY KEY,
  nome       TEXT NOT NULL,
  cor        TEXT,
  base       TEXT,
  ativo      BOOLEAN NOT NULL DEFAULT true,
  criado_em  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE time_membros (
  time_id    BIGINT NOT NULL REFERENCES times(id) ON DELETE CASCADE,
  pessoa_id  BIGINT NOT NULL REFERENCES pessoas(id) ON DELETE CASCADE,
  lider      BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (time_id, pessoa_id)
);

-- ---------- Execução: tarefas (atividade x endereço) ----------
CREATE TABLE tarefas (
  id              BIGSERIAL PRIMARY KEY,
  endereco_id     BIGINT NOT NULL REFERENCES enderecos(id) ON DELETE CASCADE,
  atividade_id    BIGINT NOT NULL REFERENCES atividades(id) ON DELETE CASCADE,
  responsavel_id  BIGINT REFERENCES pessoas(id) ON DELETE SET NULL,
  time_id         BIGINT REFERENCES times(id) ON DELETE SET NULL,
  status          TEXT NOT NULL DEFAULT 'a_fazer'
                  CHECK (status IN ('a_fazer','em_andamento','aguardando','concluida')),
  prevista_inicio DATE,
  prevista_fim    DATE,
  realizada_inicio TIMESTAMPTZ,
  realizada_fim   TIMESTAMPTZ,
  observacao      TEXT,
  atualizado_em   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (endereco_id, atividade_id)
);
CREATE INDEX tarefas_resp_idx ON tarefas (responsavel_id, status);

CREATE TABLE regras_distribuicao (
  id            BIGSERIAL PRIMARY KEY,
  contrato_id   BIGINT NOT NULL REFERENCES contratos(id) ON DELETE CASCADE,
  atividade_id  BIGINT NOT NULL REFERENCES atividades(id) ON DELETE CASCADE,
  pessoa_id     BIGINT REFERENCES pessoas(id) ON DELETE SET NULL,
  usar_time     BOOLEAN NOT NULL DEFAULT false,   -- true: responsável = membro do time do endereço
  UNIQUE (contrato_id, atividade_id)
);

CREATE TABLE tarefa_eventos (
  id          BIGSERIAL PRIMARY KEY,
  tarefa_id   BIGINT NOT NULL REFERENCES tarefas(id) ON DELETE CASCADE,
  usuario_id  BIGINT REFERENCES usuarios(id) ON DELETE SET NULL,
  tipo        TEXT NOT NULL,       -- status, atribuicao, comentario
  detalhe     TEXT,
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX tarefa_eventos_idx ON tarefa_eventos (tarefa_id, criado_em);

CREATE TABLE checklist_respostas (
  id         BIGSERIAL PRIMARY KEY,
  tarefa_id  BIGINT NOT NULL REFERENCES tarefas(id) ON DELETE CASCADE,
  item_id    BIGINT NOT NULL REFERENCES checklist_itens(id) ON DELETE CASCADE,
  valor      TEXT,
  ok         BOOLEAN NOT NULL DEFAULT false,
  usuario_id BIGINT REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tarefa_id, item_id)
);

-- ---------- Chat ----------
CREATE TABLE mensagens (
  id          BIGSERIAL PRIMARY KEY,
  canal       TEXT NOT NULL,       -- ex.: time:1, endereco:12, geral
  tipo        TEXT NOT NULL DEFAULT 'mensagem' CHECK (tipo IN ('mensagem','pedido','ocorrencia')),
  usuario_id  BIGINT REFERENCES usuarios(id) ON DELETE SET NULL,
  texto       TEXT NOT NULL,
  endereco_id BIGINT REFERENCES enderecos(id) ON DELETE SET NULL,
  resolvido   BOOLEAN NOT NULL DEFAULT false,
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX mensagens_canal_idx ON mensagens (canal, criado_em);

-- ---------- Faturamento ----------
CREATE TABLE medicoes (
  id           BIGSERIAL PRIMARY KEY,
  contrato_id  BIGINT NOT NULL REFERENCES contratos(id) ON DELETE CASCADE,
  competencia  DATE NOT NULL,            -- primeiro dia do mês
  status       TEXT NOT NULL DEFAULT 'aberta'
               CHECK (status IN ('aberta','enviada','aprovada','nf_emitida','recebida')),
  numero_nf    TEXT,
  valor_total  NUMERIC(14,2) NOT NULL DEFAULT 0,
  emitida_em   DATE,
  recebida_em  DATE,
  criado_em    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE medicao_enderecos (
  medicao_id   BIGINT NOT NULL REFERENCES medicoes(id) ON DELETE CASCADE,
  endereco_id  BIGINT NOT NULL REFERENCES enderecos(id) ON DELETE CASCADE,
  cameras      INT NOT NULL,
  valor        NUMERIC(14,2) NOT NULL,
  PRIMARY KEY (medicao_id, endereco_id)
);

-- ---------- Painel de rotas ----------
CREATE TABLE rota_config (
  id            TEXT PRIMARY KEY,
  data          JSONB NOT NULL,
  atualizado_por BIGINT REFERENCES usuarios(id) ON DELETE SET NULL,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
