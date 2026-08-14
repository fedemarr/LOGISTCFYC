-- FASE 12 — Notificaciones push (Expo Notifications, §5).
--
-- Registro de tokens push por usuario. RLS ACTIVADO sin políticas
-- SELECT/INSERT para el cliente: el alta se hace desde el servidor
-- (endpoint `POST /api/notifications/register` con la sesión validada por
-- el backend y org derivada del token JWT de la app), no con RLS de la
-- tabla. El envío de tokens Expo se guarda acá y se usa con la Expo
-- Push API (server-side) en el servicio de notificaciones.

CREATE TABLE IF NOT EXISTS public.device_push_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  user_id uuid NOT NULL REFERENCES public.users(id),
  token text NOT NULL,
  device_id text,
  platform text,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS device_push_tokens_user_token_key
  ON public.device_push_tokens (user_id, token);

CREATE INDEX IF NOT EXISTS device_push_tokens_user_id_idx
  ON public.device_push_tokens (user_id);

ALTER TABLE public.device_push_tokens ENABLE ROW LEVEL SECURITY;
