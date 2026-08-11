-- FASE 2 — PostGIS, particionado, RLS y bloqueo del event log.
-- Escrita a mano: drizzle-kit no expresa PARTITION BY, columnas
-- geography generadas, ni políticas RLS. Ver docs/DECISIONES.md ADR-013/014.

-- ═══════════════════════════════════════════════════════════════════════
-- 1. EXTENSIONES
-- ═══════════════════════════════════════════════════════════════════════
CREATE EXTENSION IF NOT EXISTS postgis;

-- ═══════════════════════════════════════════════════════════════════════
-- 2. USERS ↔ auth.users (Supabase Auth)
-- ═══════════════════════════════════════════════════════════════════════
-- `users.id` referencia al usuario real de auth.users. Se borra en cascada
-- si se borra el usuario de auth (baja definitiva de Supabase Auth).
ALTER TABLE "users"
  ADD CONSTRAINT "users_id_auth_users_id_fk"
  FOREIGN KEY ("id") REFERENCES auth.users(id) ON DELETE CASCADE;

-- ═══════════════════════════════════════════════════════════════════════
-- 3. POSTGIS: known_addresses.geom (columna generada) + índice GIST
-- ═══════════════════════════════════════════════════════════════════════
ALTER TABLE "known_addresses"
  ADD COLUMN "geom" geography(Point, 4326)
  GENERATED ALWAYS AS (
    CASE
      WHEN "lat" IS NOT NULL AND "lng" IS NOT NULL
        THEN ST_SetSRID(ST_MakePoint("lng", "lat"), 4326)::geography
      ELSE NULL
    END
  ) STORED;

CREATE INDEX "known_addresses_geom_gist_idx" ON "known_addresses" USING GIST ("geom");

-- ═══════════════════════════════════════════════════════════════════════
-- 4. PARTICIONADO MENSUAL: driver_locations y events
--    (las tablas ya se crearon PARTITION BY RANGE en 0000_init_schema.sql)
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.create_monthly_partitions(
  parent_table text,
  start_month date,
  end_month date
) RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  cur date := date_trunc('month', start_month);
  partition_name text;
BEGIN
  WHILE cur < end_month LOOP
    partition_name := parent_table || '_' || to_char(cur, 'YYYY_MM');
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS %I PARTITION OF %I FOR VALUES FROM (%L) TO (%L)',
      partition_name, parent_table, cur, cur + interval '1 month'
    );
    cur := cur + interval '1 month';
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.create_monthly_partitions IS
  'Crea particiones mensuales [start_month, end_month) para una tabla PARTITION BY RANGE. '
  'Bootstrap: FASE 2 crea 2026-01..2027-12. Hay que seguir llamándola (ops o job de FASE 13) '
  'antes de que se acabe el rango, o los inserts fuera de rango caen en la partición _default.';

-- Bootstrap: 2 años de particiones (2026-01 a 2027-12 inclusive).
SELECT public.create_monthly_partitions('driver_locations', '2026-01-01', '2028-01-01');
SELECT public.create_monthly_partitions('events', '2026-01-01', '2028-01-01');

-- Partición default como red de seguridad: sin esto, un INSERT con una
-- fecha fuera del rango bootstrapeado directamente falla.
CREATE TABLE IF NOT EXISTS "driver_locations_default" PARTITION OF "driver_locations" DEFAULT;
CREATE TABLE IF NOT EXISTS "events_default" PARTITION OF "events" DEFAULT;

-- Índices sobre la tabla particionada (Postgres los propaga a cada partición,
-- incluidas las que se creen después).
CREATE INDEX "driver_locations_driver_id_recorded_at_idx"
  ON "driver_locations" ("driver_id", "recorded_at" DESC);

CREATE INDEX "events_entity_type_entity_id_occurred_at_idx"
  ON "events" ("entity_type", "entity_id", "occurred_at");

CREATE INDEX "events_org_id_occurred_at_idx"
  ON "events" ("org_id", "occurred_at" DESC);

-- ═══════════════════════════════════════════════════════════════════════
-- 5. EVENT LOG: append-only de verdad — revocar UPDATE y DELETE (§3, §7)
-- ═══════════════════════════════════════════════════════════════════════
-- `authenticated` es el rol que usa PostgREST/Supabase para cualquier
-- usuario logueado (via anon key + JWT); `anon` para no autenticados.
-- `service_role` (usado por el backend con la service key) SIGUE
-- pudiendo hacer lo que quiera — a propósito, bypassea RLS y GRANTs por
-- diseño de Supabase, y el servicio de eventos de FASE 3 corre con esa
-- key. La app cliente (anon/authenticated) nunca debe poder tocar esto.
REVOKE UPDATE, DELETE ON "events" FROM authenticated, anon;
REVOKE UPDATE, DELETE ON "events_default" FROM authenticated, anon;

-- También bloqueado a nivel trigger, por si alguna vez se le da permiso
-- de UPDATE/DELETE a un rol nuevo sin pensarlo: cinturón y tirantes.
CREATE OR REPLACE FUNCTION public.forbid_events_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'events es append-only: % sobre events está prohibido (usar corrects_event_id)', TG_OP;
END;
$$;

CREATE TRIGGER "events_forbid_update"
  BEFORE UPDATE ON "events"
  FOR EACH ROW EXECUTE FUNCTION public.forbid_events_mutation();

CREATE TRIGGER "events_forbid_delete"
  BEFORE DELETE ON "events"
  FOR EACH ROW EXECUTE FUNCTION public.forbid_events_mutation();

-- INSERT a events: únicamente vía función SECURITY DEFINER (§3, §7). No se
-- otorga GRANT INSERT directo a authenticated/anon; el servicio de eventos
-- de FASE 3 inserta a través de esta función.
CREATE OR REPLACE FUNCTION public.log_event(
  p_org_id uuid,
  p_entity_type event_entity_type,
  p_entity_id uuid,
  p_event_type varchar(100),
  p_actor_id uuid,
  p_actor_role varchar(50),
  p_previous_state varchar(100),
  p_new_state varchar(100),
  p_lat double precision,
  p_lng double precision,
  p_metadata jsonb,
  p_corrects_event_id uuid,
  p_occurred_at timestamptz
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO events (
    org_id, entity_type, entity_id, event_type, actor_id, actor_role,
    previous_state, new_state, lat, lng, metadata, corrects_event_id, occurred_at
  ) VALUES (
    p_org_id, p_entity_type, p_entity_id, p_event_type, p_actor_id, p_actor_role,
    p_previous_state, p_new_state, p_lat, p_lng, COALESCE(p_metadata, '{}'::jsonb),
    p_corrects_event_id, p_occurred_at
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.log_event FROM public;
GRANT EXECUTE ON FUNCTION public.log_event TO authenticated, service_role;
