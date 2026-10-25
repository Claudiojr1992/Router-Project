-- RoutProject · equipes do projeto (mesmo sem técnico), início previsto e conclusão manual dos endereços

-- Quantidade de equipes do projeto (1 a 8, igual ao Painel de rotas)
ALTER TABLE clientes ADD COLUMN equipes INT CHECK (equipes IS NULL OR equipes BETWEEN 1 AND 8);

-- Endereço: equipe que atende (1..8), data prevista de início e data de conclusão informada à mão
ALTER TABLE enderecos ADD COLUMN equipe INT CHECK (equipe IS NULL OR equipe BETWEEN 1 AND 8);
ALTER TABLE enderecos ADD COLUMN inicio_previsto DATE;
ALTER TABLE enderecos ADD COLUMN concluido_em DATE;
-- status que o endereço tinha antes de ser concluído (volta para ele ao reabrir)
ALTER TABLE enderecos ADD COLUMN status_antes TEXT;
CREATE INDEX enderecos_equipe_idx ON enderecos (contrato_id, equipe);
