-- Controle de material (consumíveis: cabos, conectores, tubulação, fixação…): estoque, entradas e aplicação em campo.
-- Cada movimento guarda quem, quando, quanto, o lote e onde o material foi aplicado (endereço e atividade): é a rastreabilidade.
CREATE TABLE materiais (
  id             BIGSERIAL PRIMARY KEY,
  codigo         TEXT,
  nome           TEXT NOT NULL,
  unidade        TEXT NOT NULL DEFAULT 'un',
  categoria      TEXT,
  fabricante     TEXT,
  estoque_minimo NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (estoque_minimo >= 0),
  ativo          BOOLEAN NOT NULL DEFAULT true,
  observacao     TEXT,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX materiais_codigo_uk ON materiais (lower(codigo)) WHERE codigo IS NOT NULL;

CREATE TABLE material_movimentos (
  id           BIGSERIAL PRIMARY KEY,
  material_id  BIGINT NOT NULL REFERENCES materiais(id) ON DELETE CASCADE,
  tipo         TEXT NOT NULL CHECK (tipo IN ('entrada', 'aplicacao', 'devolucao', 'ajuste')),
  quantidade   NUMERIC(14,3) NOT NULL,            -- entrada/devolução > 0; aplicação > 0 (sai do estoque); ajuste: + ou -
  lote         TEXT,
  documento    TEXT,                               -- nota fiscal, requisição…
  fornecedor   TEXT,
  endereco_id  BIGINT REFERENCES enderecos(id) ON DELETE SET NULL,
  tarefa_id    BIGINT REFERENCES tarefas(id) ON DELETE SET NULL,
  pessoa_id    BIGINT REFERENCES pessoas(id) ON DELETE SET NULL,
  usuario_id   BIGINT REFERENCES usuarios(id) ON DELETE SET NULL,
  lat          DOUBLE PRECISION,
  lon          DOUBLE PRECISION,
  observacao   TEXT,
  cliente_uuid UUID UNIQUE,                        -- ação do app (não duplica ao reenviar)
  criado_em    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (quantidade <> 0),
  CHECK (tipo = 'ajuste' OR quantidade > 0),
  CHECK (tipo <> 'aplicacao' OR endereco_id IS NOT NULL)
);
CREATE INDEX material_mov_mat_idx ON material_movimentos (material_id, criado_em DESC);
CREATE INDEX material_mov_end_idx ON material_movimentos (endereco_id);
CREATE INDEX material_mov_tar_idx ON material_movimentos (tarefa_id);
CREATE INDEX material_mov_lote_idx ON material_movimentos (lower(lote)) WHERE lote IS NOT NULL;

ALTER TABLE materiais ENABLE ROW LEVEL SECURITY;
ALTER TABLE material_movimentos ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER aud_materiais AFTER INSERT OR UPDATE OR DELETE ON materiais FOR EACH ROW EXECUTE FUNCTION rp_auditar();
CREATE TRIGGER aud_material_movimentos AFTER INSERT OR UPDATE OR DELETE ON material_movimentos FOR EACH ROW EXECUTE FUNCTION rp_auditar();

-- Novo módulo de permissão: Materiais (escritório edita; técnico vê o catálogo e registra o que aplicou pelo app)
UPDATE perfis SET permissoes = permissoes || jsonb_build_object('materiais',
  CASE codigo WHEN 'admin' THEN 'editar' WHEN 'coordenador' THEN 'editar' WHEN 'supervisor' THEN 'editar'
              WHEN 'administrativo' THEN 'editar' WHEN 'tecnico' THEN 'ver' ELSE 'nenhum' END)
 WHERE NOT permissoes ? 'materiais';
