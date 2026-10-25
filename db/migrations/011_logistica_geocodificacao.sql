-- RoutProject · logística por endereço (despacho, modo) e localização pelo endereço

-- Data de despacho do material e como a equipe/material chegam: estrada, equipamento com o técnico ou avião (deslocamento zerado)
ALTER TABLE enderecos ADD COLUMN despacho_material DATE;
ALTER TABLE enderecos ADD COLUMN modo_logistico TEXT CHECK (modo_logistico IN ('estrada', 'leva', 'aviao'));

-- De onde veio a latitude/longitude: digitada (manual) ou localizada pelo endereço (endereco); vazio = ainda não localizada
ALTER TABLE enderecos ADD COLUMN geo_fonte TEXT CHECK (geo_fonte IN ('manual', 'endereco'));
ALTER TABLE enderecos ADD COLUMN geo_tentado_em TIMESTAMPTZ;
UPDATE enderecos SET geo_fonte = 'manual' WHERE lat IS NOT NULL AND lon IS NOT NULL;
