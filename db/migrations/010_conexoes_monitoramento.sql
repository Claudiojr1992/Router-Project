-- RoutProject · conexões com NetBox e Zabbix e monitoramento dos endereços

-- Configuração de cada conexão (o token fica criptografado com a chave derivada do SESSION_SECRET)
CREATE TABLE integracoes (
  tipo            TEXT PRIMARY KEY CHECK (tipo IN ('netbox', 'zabbix')),
  url             TEXT NOT NULL,
  token_cifrado   TEXT,
  opcoes          JSONB NOT NULL DEFAULT '{}',
  teste_em        TIMESTAMPTZ,
  teste_ok        BOOLEAN,
  teste_msg       TEXT,
  atualizado_por  BIGINT REFERENCES usuarios(id) ON DELETE SET NULL,
  atualizado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Vínculo do endereço com o site do NetBox e com o host do Zabbix
ALTER TABLE enderecos ADD COLUMN netbox_site_id BIGINT;
ALTER TABLE enderecos ADD COLUMN zabbix_hostid TEXT;
ALTER TABLE enderecos ADD COLUMN monitorado_em TIMESTAMPTZ;
CREATE INDEX enderecos_netbox_idx ON enderecos (netbox_site_id) WHERE netbox_site_id IS NOT NULL;

-- Ativos que sobem para o monitoramento (um host no Zabbix cada)
CREATE TABLE monitoramento_ativos (
  id            BIGSERIAL PRIMARY KEY,
  endereco_id   BIGINT NOT NULL REFERENCES enderecos(id) ON DELETE CASCADE,
  hostname      TEXT NOT NULL,
  nome_visivel  TEXT,
  ip            TEXT NOT NULL,
  tipo          TEXT NOT NULL DEFAULT 'camera',
  interface     TEXT NOT NULL DEFAULT 'snmp' CHECK (interface IN ('agent', 'snmp', 'icmp')),
  porta         INT,
  grupo         TEXT,
  template      TEXT,
  comunidade    TEXT,
  zabbix_hostid TEXT,
  status        TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'enviado', 'erro')),
  erro          TEXT,
  enviado_em    TIMESTAMPTZ,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX monitoramento_ativos_end_idx ON monitoramento_ativos (endereco_id);
CREATE UNIQUE INDEX monitoramento_ativos_host_uk ON monitoramento_ativos (lower(hostname));

-- Histórico dos envios ao Zabbix e das importações
CREATE TABLE integracoes_log (
  id          BIGSERIAL PRIMARY KEY,
  tipo        TEXT NOT NULL,
  acao        TEXT NOT NULL,
  endereco_id BIGINT REFERENCES enderecos(id) ON DELETE CASCADE,
  usuario_id  BIGINT REFERENCES usuarios(id) ON DELETE SET NULL,
  ok          BOOLEAN NOT NULL,
  detalhe     TEXT,
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX integracoes_log_end_idx ON integracoes_log (endereco_id, criado_em DESC);
