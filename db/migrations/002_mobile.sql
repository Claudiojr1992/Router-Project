-- RoutProject · app do técnico (PWA): fotos de evidência e fila de sincronização offline

CREATE TABLE evidencias (
  id          BIGSERIAL PRIMARY KEY,
  client_id   UUID NOT NULL UNIQUE,          -- gerado no celular; evita foto duplicada ao reenviar
  tarefa_id   BIGINT NOT NULL REFERENCES tarefas(id) ON DELETE CASCADE,
  item_id     BIGINT REFERENCES checklist_itens(id) ON DELETE SET NULL,
  usuario_id  BIGINT REFERENCES usuarios(id) ON DELETE SET NULL,
  legenda     TEXT,
  mime        TEXT NOT NULL DEFAULT 'image/jpeg',
  tamanho     INT NOT NULL,
  conteudo    BYTEA NOT NULL,
  lat         DOUBLE PRECISION,
  lon         DOUBLE PRECISION,
  tirada_em   TIMESTAMPTZ,
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX evidencias_tarefa_idx ON evidencias (tarefa_id, criado_em);

-- Ações feitas sem internet e enviadas depois (cada uma processada uma única vez)
CREATE TABLE sync_acoes (
  client_id   UUID PRIMARY KEY,
  usuario_id  BIGINT REFERENCES usuarios(id) ON DELETE CASCADE,
  tipo        TEXT NOT NULL,
  resultado   TEXT,
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);
