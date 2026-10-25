-- RoutProject · itens do projeto (equipamentos) e quantidades por endereço

-- Catálogo de equipamentos do contrato (ex.: Câmera, Servidor, Switch PoE, Nobreak)
CREATE TABLE contrato_itens (
  id           BIGSERIAL PRIMARY KEY,
  contrato_id  BIGINT NOT NULL REFERENCES contratos(id) ON DELETE CASCADE,
  nome         TEXT NOT NULL,
  unidade      TEXT NOT NULL DEFAULT 'un',
  ordem        INT NOT NULL DEFAULT 0,
  criado_em    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX contrato_itens_nome_uk ON contrato_itens (contrato_id, lower(nome));

-- Quantidade de cada equipamento a instalar em cada endereço
CREATE TABLE endereco_itens (
  endereco_id  BIGINT NOT NULL REFERENCES enderecos(id) ON DELETE CASCADE,
  item_id      BIGINT NOT NULL REFERENCES contrato_itens(id) ON DELETE CASCADE,
  quantidade   INT NOT NULL DEFAULT 0 CHECK (quantidade >= 0),
  PRIMARY KEY (endereco_id, item_id)
);

-- Contratos existentes já começam com "Câmera" (quantidade = câmeras de cada endereço)
INSERT INTO contrato_itens (contrato_id, nome, ordem) SELECT id, 'Câmera', 1 FROM contratos;
INSERT INTO endereco_itens (endereco_id, item_id, quantidade)
SELECT e.id, ci.id, e.cameras FROM enderecos e JOIN contrato_itens ci ON ci.contrato_id = e.contrato_id AND ci.nome = 'Câmera' WHERE e.cameras > 0;
