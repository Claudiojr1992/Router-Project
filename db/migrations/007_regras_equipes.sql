-- RoutProject · regras de cada equipe (dias de trabalho e produção por dia de cada equipamento)

CREATE TABLE equipe_regras (
  cliente_id   BIGINT NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  equipe       INT NOT NULL CHECK (equipe BETWEEN 1 AND 8),
  -- dias da semana em que a equipe trabalha: 0 = domingo … 6 = sábado
  dias_semana  INT[] NOT NULL DEFAULT '{1,2,3,4,5}',
  -- a equipe só começa a partir desta data (opcional)
  inicio       DATE,
  -- quantidade por dia de cada equipamento, pelo nome: {"Câmera": 8, "Servidor / NVR": 2}
  producao     JSONB NOT NULL DEFAULT '{}',
  -- mínimo de dias em cada endereço
  min_dias     NUMERIC(4,1) NOT NULL DEFAULT 0.5 CHECK (min_dias > 0 AND min_dias <= 30),
  PRIMARY KEY (cliente_id, equipe)
);

-- Duração prevista (dias de trabalho) e último dia previsto em cada endereço
ALTER TABLE enderecos ADD COLUMN dias_previstos NUMERIC(6,1);
ALTER TABLE enderecos ADD COLUMN fim_previsto DATE;
