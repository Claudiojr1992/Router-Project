-- RoutProject · etapas do projeto e regras das atividades (predecessora e impacto no tempo)

-- Etapas de implantação por cliente: ex.: "Etapa 1" começa em 03/11/2026 (o mês sai da data)
CREATE TABLE etapas (
  id          BIGSERIAL PRIMARY KEY,
  cliente_id  BIGINT NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  nome        TEXT NOT NULL,
  ordem       INT NOT NULL DEFAULT 0,
  data_inicio DATE NOT NULL,
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX etapas_nome_uk ON etapas (cliente_id, lower(nome));

-- Endereço: etapa e ordem de atendimento dentro da etapa (1 = primeiro)
ALTER TABLE enderecos ADD COLUMN etapa_id BIGINT REFERENCES etapas(id) ON DELETE SET NULL;
ALTER TABLE enderecos ADD COLUMN ordem_etapa INT CHECK (ordem_etapa IS NULL OR ordem_etapa >= 1);
CREATE INDEX enderecos_etapa_idx ON enderecos (etapa_id, ordem_etapa);

-- Atividade:
--   tempo_impacto: soma (entra no tempo do endereço), paralelo (acontece junto, conta só a maior), nenhum (não afeta o prazo)
--   predecessora_id: só pode ser concluída depois que a predecessora estiver concluída no mesmo endereço
ALTER TABLE atividades ADD COLUMN tempo_impacto TEXT NOT NULL DEFAULT 'soma' CHECK (tempo_impacto IN ('soma','paralelo','nenhum'));
ALTER TABLE atividades ADD COLUMN predecessora_id BIGINT REFERENCES atividades(id) ON DELETE SET NULL;
UPDATE atividades SET tempo_impacto = 'nenhum' WHERE NOT conta_rota;
