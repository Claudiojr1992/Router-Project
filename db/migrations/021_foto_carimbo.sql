-- Foto com carimbo: altitude, precisão do GPS e o endereço do local onde a foto foi tirada
ALTER TABLE evidencias ADD COLUMN altitude NUMERIC(8,1);
ALTER TABLE evidencias ADD COLUMN precisao NUMERIC(8,1);
ALTER TABLE evidencias ADD COLUMN local_texto TEXT;
