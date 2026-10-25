-- RoutProject · Painel de rotas por cliente (projeto)
-- Base de saída das equipes de cada cliente (padrão: Fortaleza/CE)
ALTER TABLE clientes ADD COLUMN base_nome TEXT;
ALTER TABLE clientes ADD COLUMN base_lat DOUBLE PRECISION;
ALTER TABLE clientes ADD COLUMN base_lon DOUBLE PRECISION;

-- A configuração do plano passa a ser guardada por cliente: plano2-c<id>
-- A configuração que já existia (do BNB) vai para o primeiro cliente cadastrado
UPDATE rota_config SET id = 'plano2-c' || (SELECT min(id) FROM clientes)
 WHERE id = 'plano2' AND EXISTS (SELECT 1 FROM clientes);
