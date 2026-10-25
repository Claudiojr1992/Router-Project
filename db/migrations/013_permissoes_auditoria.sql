-- RoutProject · perfis editáveis (permissões por módulo), auditoria de tudo que muda e limite de tentativas no banco

-- ---------- Perfis e permissões ----------
-- permissoes: { "modulo": "nenhum" | "ver" | "editar" }   acoes: { "reabrir": true, ... }
CREATE TABLE perfis (
  codigo      TEXT PRIMARY KEY CHECK (codigo ~ '^[a-z][a-z0-9_]{1,31}$'),
  nome        TEXT NOT NULL,
  descricao   TEXT,
  sistema     BOOLEAN NOT NULL DEFAULT false,
  permissoes  JSONB NOT NULL DEFAULT '{}',
  acoes       JSONB NOT NULL DEFAULT '{}',
  -- quem tem este perfil entra em Técnicos e times como: tecnico | coordenacao | administrativo (vazio = não entra)
  tipo_pessoa TEXT CHECK (tipo_pessoa IN ('tecnico', 'coordenacao', 'administrativo')),
  ordem       INT NOT NULL DEFAULT 100,
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO perfis (codigo, nome, descricao, sistema, ordem, permissoes, acoes) VALUES
('admin', 'Administrador', 'Acesso total, inclusive usuários, permissões e auditoria', true, 1,
 '{"rota":"editar","projetos":"editar","delegadas":"editar","minhas":"editar","app":"editar","faturamento":"editar","chat":"editar","clientes":"editar","empresas":"editar","atividades":"editar","checklists":"editar","equipe":"editar","usuarios":"editar","conexoes":"editar","auditoria":"ver","permissoes":"editar"}',
 '{"reabrir":true,"excluir":true,"delegar":true,"distribuir":true,"forcar_monitoramento":true}'),
('coordenador', 'Coordenação', 'Planeja, distribui e acompanha a operação', true, 2,
 '{"rota":"editar","projetos":"editar","delegadas":"editar","minhas":"editar","app":"editar","faturamento":"editar","chat":"editar","clientes":"editar","empresas":"editar","atividades":"editar","checklists":"editar","equipe":"editar","usuarios":"nenhum","conexoes":"editar","auditoria":"ver","permissoes":"nenhum"}',
 '{"reabrir":true,"excluir":true,"delegar":true,"distribuir":true,"forcar_monitoramento":false}'),
('supervisor', 'Supervisão', 'Mesmos acessos da coordenação', true, 3,
 '{"rota":"editar","projetos":"editar","delegadas":"editar","minhas":"editar","app":"editar","faturamento":"editar","chat":"editar","clientes":"editar","empresas":"editar","atividades":"editar","checklists":"editar","equipe":"editar","usuarios":"nenhum","conexoes":"editar","auditoria":"ver","permissoes":"nenhum"}',
 '{"reabrir":true,"excluir":true,"delegar":true,"distribuir":true,"forcar_monitoramento":false}'),
('administrativo', 'Administrativo', 'Cadastros, projetos, delegadas e faturamento', true, 4,
 '{"rota":"editar","projetos":"editar","delegadas":"editar","minhas":"editar","app":"editar","faturamento":"editar","chat":"editar","clientes":"editar","empresas":"editar","atividades":"ver","checklists":"ver","equipe":"ver","usuarios":"nenhum","conexoes":"ver","auditoria":"nenhum","permissoes":"nenhum"}',
 '{"reabrir":false,"excluir":false,"delegar":true,"distribuir":false,"forcar_monitoramento":false}'),
('tecnico', 'Técnico', 'Executa as próprias atividades em campo', true, 5,
 '{"rota":"nenhum","projetos":"nenhum","delegadas":"nenhum","minhas":"editar","app":"editar","faturamento":"nenhum","chat":"editar","clientes":"nenhum","empresas":"nenhum","atividades":"nenhum","checklists":"nenhum","equipe":"nenhum","usuarios":"nenhum","conexoes":"nenhum","auditoria":"nenhum","permissoes":"nenhum"}',
 '{"reabrir":false,"excluir":false,"delegar":false,"distribuir":false,"forcar_monitoramento":false}'),
('cliente', 'Cliente', 'Reservado para o portal do cliente', true, 6,
 '{"rota":"nenhum","projetos":"nenhum","delegadas":"nenhum","minhas":"ver","app":"nenhum","faturamento":"nenhum","chat":"nenhum","clientes":"nenhum","empresas":"nenhum","atividades":"nenhum","checklists":"nenhum","equipe":"nenhum","usuarios":"nenhum","conexoes":"nenhum","auditoria":"nenhum","permissoes":"nenhum"}',
 '{}');

UPDATE perfis SET tipo_pessoa = CASE codigo WHEN 'tecnico' THEN 'tecnico' WHEN 'administrativo' THEN 'administrativo' WHEN 'cliente' THEN NULL ELSE 'coordenacao' END;

ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_perfil_check;
ALTER TABLE usuarios ADD CONSTRAINT usuarios_perfil_fk FOREIGN KEY (perfil) REFERENCES perfis(codigo) ON UPDATE CASCADE;

-- ---------- Limite de tentativas (login, cadastro, códigos) ----------
CREATE TABLE tentativas (
  chave      TEXT PRIMARY KEY,
  contagem   INT NOT NULL,
  expira_em  TIMESTAMPTZ NOT NULL
);
CREATE INDEX tentativas_expira_idx ON tentativas (expira_em);

-- ---------- Auditoria ----------
CREATE TABLE auditoria (
  id           BIGSERIAL PRIMARY KEY,
  criado_em    TIMESTAMPTZ NOT NULL DEFAULT now(),
  usuario_id   BIGINT,
  usuario_nome TEXT,
  ip           TEXT,
  acao         TEXT NOT NULL,
  tabela       TEXT,
  registro_id  TEXT,
  resumo       TEXT,
  antes        JSONB,
  depois       JSONB
);
CREATE INDEX auditoria_data_idx ON auditoria (criado_em DESC);
CREATE INDEX auditoria_registro_idx ON auditoria (tabela, registro_id, criado_em DESC);
CREATE INDEX auditoria_usuario_idx ON auditoria (usuario_id, criado_em DESC);

-- Quem está mexendo vem da sessão do app (set_config rp.uid / rp.unome / rp.ip); vazio = o próprio sistema
CREATE OR REPLACE FUNCTION rp_auditar() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  oculto TEXT[] := ARRAY['senha_hash','token_cifrado','token_hash','imagem','dados','conteudo','arquivo'];
  ruido  TEXT[] := ARRAY['atualizado_em','ultimo_acesso','geo_tentado_em'];
  v_old JSONB; v_new JSONB; a JSONB; d JSONB; k TEXT; rid TEXT; uid TEXT;
BEGIN
  IF TG_OP <> 'INSERT' THEN v_old := to_jsonb(OLD) - oculto; END IF;
  IF TG_OP <> 'DELETE' THEN v_new := to_jsonb(NEW) - oculto; END IF;
  IF TG_OP = 'UPDATE' THEN
    a := '{}'; d := '{}';
    FOR k IN SELECT jsonb_object_keys(v_new) LOOP
      IF k = ANY(ruido) THEN CONTINUE; END IF;
      IF (v_new -> k) IS DISTINCT FROM (v_old -> k) THEN
        a := a || jsonb_build_object(k, v_old -> k);
        d := d || jsonb_build_object(k, v_new -> k);
      END IF;
    END LOOP;
    IF d = '{}'::jsonb THEN RETURN NULL; END IF;
    v_old := a; v_new := d;
  END IF;
  rid := COALESCE(COALESCE(v_new, v_old) ->> 'id', COALESCE(v_new, v_old) ->> 'codigo', COALESCE(v_new, v_old) ->> 'tipo');
  IF rid IS NULL AND TG_OP = 'UPDATE' THEN rid := COALESCE(to_jsonb(NEW) ->> 'id', to_jsonb(NEW) ->> 'codigo', to_jsonb(NEW) ->> 'tipo'); END IF;
  IF rid IS NULL THEN rid := COALESCE(to_jsonb(COALESCE(NEW, OLD)) ->> 'endereco_id', to_jsonb(COALESCE(NEW, OLD)) ->> 'medicao_id'); END IF;
  uid := NULLIF(current_setting('rp.uid', true), '');
  INSERT INTO auditoria (usuario_id, usuario_nome, ip, acao, tabela, registro_id, antes, depois)
  VALUES (uid::bigint, NULLIF(current_setting('rp.unome', true), ''), NULLIF(current_setting('rp.ip', true), ''),
          lower(TG_OP), TG_TABLE_NAME, rid, v_old, v_new);
  RETURN NULL;
END $$;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['clientes','contratos','contrato_arquivos','contrato_itens','empresas','enderecos','etapas','equipe_regras',
                           'atividades','checklists','checklist_itens','pessoas','times','time_membros','tarefas','regras_distribuicao',
                           'usuarios','perfis','medicoes','medicao_enderecos','integracoes','monitoramento_ativos','relatorio_assinaturas']
  LOOP
    EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION rp_auditar()', 'aud_' || t, t);
  END LOOP;
END $$;
