-- RoutProject · faturamento por item do contrato e controle de patrimônio (ativos)

-- ---------- Itens do contrato: o que é cobrado e por quanto ----------
-- faturavel: entra no valor do endereço (quantidade × valor_unitario)
-- controla_patrimonio: cada unidade instalada é um ativo com patrimônio / número de série
ALTER TABLE contrato_itens ADD COLUMN faturavel BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE contrato_itens ADD COLUMN valor_unitario NUMERIC(14,2) CHECK (valor_unitario IS NULL OR valor_unitario >= 0);
ALTER TABLE contrato_itens ADD COLUMN controla_patrimonio BOOLEAN NOT NULL DEFAULT false;

-- Contrato pode exigir patrimônio de todos os itens controlados antes de o endereço ficar apto a faturar
ALTER TABLE contratos ADD COLUMN exige_patrimonio BOOLEAN NOT NULL DEFAULT false;

-- O antigo "valor por câmera" vira o preço do item Câmera (o valor por endereço continua como taxa fixa)
INSERT INTO contrato_itens (contrato_id, nome, ordem)
SELECT ct.id, 'Câmera', 0 FROM contratos ct
 WHERE COALESCE(ct.valor_camera, 0) > 0
   AND NOT EXISTS (SELECT 1 FROM contrato_itens ci WHERE ci.contrato_id = ct.id AND lower(ci.nome) IN ('câmera', 'camera', 'câmeras', 'cameras'));
UPDATE contrato_itens ci SET faturavel = true, valor_unitario = ct.valor_camera, controla_patrimonio = true
  FROM contratos ct
 WHERE ct.id = ci.contrato_id AND COALESCE(ct.valor_camera, 0) > 0 AND lower(ci.nome) IN ('câmera', 'camera', 'câmeras', 'cameras');
-- endereços com câmeras e sem a linha do item Câmera ganham a linha (para o valor continuar o mesmo)
INSERT INTO endereco_itens (endereco_id, item_id, quantidade)
SELECT e.id, ci.id, e.cameras FROM enderecos e JOIN contrato_itens ci ON ci.contrato_id = e.contrato_id AND ci.faturavel AND lower(ci.nome) IN ('câmera', 'camera', 'câmeras', 'cameras')
 WHERE e.cameras > 0 ON CONFLICT (endereco_id, item_id) DO NOTHING;
UPDATE contratos SET valor_camera = NULL WHERE valor_camera IS NOT NULL;

-- ---------- Medição: o detalhe por item fica gravado (o valor não muda se o preço mudar depois) ----------
CREATE TABLE medicao_itens (
  id             BIGSERIAL PRIMARY KEY,
  medicao_id     BIGINT NOT NULL REFERENCES medicoes(id) ON DELETE CASCADE,
  endereco_id    BIGINT NOT NULL REFERENCES enderecos(id) ON DELETE CASCADE,
  item           TEXT NOT NULL,                  -- nome do item (ou "Taxa por endereço")
  quantidade     NUMERIC(14,2) NOT NULL,
  valor_unitario NUMERIC(14,2) NOT NULL,
  total          NUMERIC(14,2) NOT NULL
);
CREATE INDEX medicao_itens_med_idx ON medicao_itens (medicao_id);

-- ---------- Patrimônio: cada equipamento controlado, onde está e em que situação ----------
CREATE TABLE ativos (
  id            BIGSERIAL PRIMARY KEY,
  contrato_id   BIGINT NOT NULL REFERENCES contratos(id) ON DELETE CASCADE,
  item_id       BIGINT REFERENCES contrato_itens(id) ON DELETE SET NULL,
  endereco_id   BIGINT REFERENCES enderecos(id) ON DELETE SET NULL,   -- vazio = em estoque / sem local
  patrimonio    TEXT,
  numero_serie  TEXT,
  fabricante    TEXT,
  modelo        TEXT,
  mac           TEXT,
  ip            TEXT,
  status        TEXT NOT NULL DEFAULT 'estoque'
                CHECK (status IN ('estoque', 'em_transporte', 'instalado', 'manutencao', 'baixado')),
  instalado_em  DATE,
  garantia_ate  DATE,
  observacao    TEXT,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (patrimonio IS NOT NULL OR numero_serie IS NOT NULL)
);
CREATE UNIQUE INDEX ativos_patrimonio_uk ON ativos (lower(patrimonio)) WHERE patrimonio IS NOT NULL;
CREATE UNIQUE INDEX ativos_serie_uk ON ativos (lower(numero_serie)) WHERE numero_serie IS NOT NULL;
CREATE INDEX ativos_contrato_idx ON ativos (contrato_id, status);
CREATE INDEX ativos_endereco_idx ON ativos (endereco_id);

ALTER TABLE ativos ENABLE ROW LEVEL SECURITY;
ALTER TABLE medicao_itens ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER aud_ativos AFTER INSERT OR UPDATE OR DELETE ON ativos FOR EACH ROW EXECUTE FUNCTION rp_auditar();

-- ---------- Permissão do módulo Patrimônio nos perfis do sistema ----------
UPDATE perfis SET permissoes = permissoes || jsonb_build_object('patrimonio',
  CASE codigo WHEN 'admin' THEN 'editar' WHEN 'coordenador' THEN 'editar' WHEN 'supervisor' THEN 'editar'
              WHEN 'administrativo' THEN 'editar' ELSE 'nenhum' END)
 WHERE NOT permissoes ? 'patrimonio';
