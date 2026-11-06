-- Empresa responsável pelo projeto: o logo dela vai no relatório quando o contrato não tem empresa própria
ALTER TABLE clientes ADD COLUMN empresa_id BIGINT REFERENCES empresas(id) ON DELETE SET NULL;
