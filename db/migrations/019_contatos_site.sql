-- Pedidos de demonstração e contatos vindos do site comercial (página inicial)
CREATE TABLE contatos (
  id          BIGSERIAL PRIMARY KEY,
  nome        TEXT NOT NULL,
  empresa     TEXT,
  email       TEXT NOT NULL,
  telefone    TEXT,
  enderecos   TEXT,                 -- faixa de endereços por ano informada no formulário
  interesse   TEXT,                 -- o que a pessoa quer ver (rotas, app de campo, faturamento…)
  mensagem    TEXT,
  origem      TEXT,                 -- botão/seção do site que gerou o contato
  status      TEXT NOT NULL DEFAULT 'novo' CHECK (status IN ('novo','em_contato','proposta','fechado','descartado')),
  nota        TEXT,
  ip          TEXT,
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX contatos_criado_idx ON contatos (criado_em DESC);
ALTER TABLE contatos ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER aud_contatos AFTER INSERT OR UPDATE OR DELETE ON contatos FOR EACH ROW EXECUTE FUNCTION rp_auditar();

-- Novo módulo de permissão: Contatos do site (administração e coordenação começam com acesso)
UPDATE perfis SET permissoes = permissoes || '{"contatos":"editar"}'::jsonb WHERE codigo IN ('admin','coordenador');
UPDATE perfis SET permissoes = permissoes || '{"contatos":"nenhum"}'::jsonb WHERE codigo NOT IN ('admin','coordenador');
