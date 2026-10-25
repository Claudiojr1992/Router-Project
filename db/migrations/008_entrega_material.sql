-- RoutProject · data de entrega do material em cada endereço
-- Com data: no Painel de rotas a instalação começa no dia útil seguinte à entrega.
-- Sem data: o plano conta só deslocamento e instalação.
ALTER TABLE enderecos ADD COLUMN entrega_material DATE;
