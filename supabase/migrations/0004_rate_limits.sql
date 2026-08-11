-- Tabla de rate limiting sin Redis (PROMPT-MAESTRO §5). Infraestructura
-- interna del backend: RLS activado SIN políticas → inaccesible desde el
-- cliente (authenticated/anon), solo la conexión de servidor la toca.
-- La limpieza de ventanas viejas va en el job de mantenimiento de FASE 12/13.
CREATE TABLE IF NOT EXISTS public.rate_limits (
  key text NOT NULL,
  window_start timestamptz NOT NULL,
  count integer NOT NULL DEFAULT 1,
  PRIMARY KEY (key, window_start)
);

ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;
