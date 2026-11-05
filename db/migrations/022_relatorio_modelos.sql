-- Modelos de relatório (tela Relatórios): estrutura, objetivo, identificação, evidências e aceite.
-- Um modelo pode servir a vários checklists; o modelo marcado como padrão vale para quem não tem modelo.
CREATE TABLE relatorio_modelos (
  id            BIGSERIAL PRIMARY KEY,
  nome          TEXT NOT NULL,
  descricao     TEXT,
  modelo        JSONB NOT NULL,
  padrao        BOOLEAN NOT NULL DEFAULT false,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX relatorio_modelos_padrao_uk ON relatorio_modelos (padrao) WHERE padrao;
ALTER TABLE relatorio_modelos ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER aud_relatorio_modelos AFTER INSERT OR UPDATE OR DELETE ON relatorio_modelos FOR EACH ROW EXECUTE FUNCTION rp_auditar();

ALTER TABLE checklists ADD COLUMN modelo_id BIGINT REFERENCES relatorio_modelos(id) ON DELETE SET NULL;

-- Modelos que estavam gravados dentro de cada checklist viram modelos da nova tela, já ligados ao checklist
DO $$
DECLARE c RECORD; nid BIGINT;
BEGIN
  FOR c IN SELECT id, nome, relatorio FROM checklists WHERE relatorio IS NOT NULL LOOP
    INSERT INTO relatorio_modelos (nome, modelo) VALUES ('Relatório · ' || c.nome, c.relatorio) RETURNING id INTO nid;
    UPDATE checklists SET modelo_id = nid WHERE id = c.id;
  END LOOP;
END $$;
