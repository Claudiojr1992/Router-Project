-- Atividades extras (sob demanda): não entram em todos os endereços; são incluídas no endereço quando aparece a necessidade
-- (ex.: escavação, instalação de poste). Podem ter checklist e um item do contrato que é faturado quando a atividade é concluída.
ALTER TABLE atividades ADD COLUMN extra BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE atividades ADD COLUMN item_id BIGINT REFERENCES contrato_itens(id) ON DELETE SET NULL;

-- Na tarefa extra fica quem pediu, quando, por quê e a quantidade (ex.: 1 poste, 12 metros de escavação)
ALTER TABLE tarefas ADD COLUMN extra BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE tarefas ADD COLUMN quantidade NUMERIC(10,2) NOT NULL DEFAULT 1 CHECK (quantidade > 0);
ALTER TABLE tarefas ADD COLUMN motivo TEXT;
ALTER TABLE tarefas ADD COLUMN solicitado_por BIGINT REFERENCES usuarios(id) ON DELETE SET NULL;
ALTER TABLE tarefas ADD COLUMN solicitado_em TIMESTAMPTZ;
CREATE INDEX tarefas_extra_idx ON tarefas (endereco_id) WHERE extra;

-- Nova ação de perfil: incluir atividade extra num endereço (todos os perfis internos começam com ela liberada)
UPDATE perfis SET acoes = acoes || '{"incluir_extra": true}'::jsonb WHERE codigo IN ('admin','coordenador','supervisor','administrativo','tecnico');
