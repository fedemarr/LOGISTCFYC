-- FASE 5 (§9.1): el cierre de operación necesita distinguir "paquete que
-- venía en el manifiesto importado" de "paquete que apareció al escanear
-- sin estar en el manifiesto" para poder reportar faltantes/sobrantes. Sin
-- esta columna no hay forma confiable de reconstruirlo después del hecho.
ALTER TABLE public.packages ADD COLUMN IF NOT EXISTS from_manifest boolean NOT NULL DEFAULT false;
