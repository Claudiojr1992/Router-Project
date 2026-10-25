-- Fixa o search_path da função de auditoria (recomendação de segurança do Supabase)
ALTER FUNCTION public.rp_auditar() SET search_path = public, pg_temp;
