-- FASE 13 — Job de mantenimiento: purga por política de retención +
-- mantenimiento de particiones. Se ejecuta bajo demanda (ruta
-- `/api/cron/maintenance` protegida por CRON_SECRET) o a mano desde SQL.
-- Requisito del documento madre: "Jobs de purga por política de retención".
--
-- Reglas:
--   * driver_locations  → 90 días (§7). Se DETACH + DROP la partición
--     mensual completa cuando su rango ya está vencido; la partición
--     `_default` se barre por DELETE.
--   * events            → jamás se purga (append-only). Solo se extienden
--     las particiones futuras.
--   * rate_limits       → ventanas viejas (> 24h) ya no sirven.
--   * sync_queue        → completados > 30 días, fallados > 90 días.
--   * geocode_cache     → entradas > 365 días (vuelve a pagar el
--     geocoding si se pide de nuevo; conservador a propósito).
--
-- Nunca se borra NADA de tablas de negocio: el soft delete es la regla
-- (docs/MODELO-DATOS.md). La purga toca solo infraestructura interna y
-- telemetría.
CREATE OR REPLACE FUNCTION public.maintenance_purge()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  cutoff90 timestamptz;
  months_ahead integer := 24;
BEGIN
  -- ── 1. Particiones futuras (events y driver_locations) ──────────────
  -- Extiende el rango [hoy, hoy + 24 meses) para no caer en `_default`.
  PERFORM public.create_monthly_partitions(
    'events',
    date_trunc('month', now())::date,
    (date_trunc('month', now()) + make_interval(months => months_ahead))::date
  );
  PERFORM public.create_monthly_partitions(
    'driver_locations',
    date_trunc('month', now())::date,
    (date_trunc('month', now()) + make_interval(months => months_ahead))::date
  );

  -- ── 2. driver_locations: retención 90 días ──────────────────────────
  cutoff90 := now() - interval '90 days';

  -- Particiones mensuales vencidas: DETACH + DROP (más barato y limpio
  -- que DELETE masivo). El nombre `driver_locations_YYYY_MM` es el
  -- convenio de create_monthly_partitions; el fin de la partición es el
  -- 1ro del mes siguiente.
  FOR r IN
    SELECT child.relname AS child_name
    FROM pg_inherits i
    JOIN pg_class child ON child.oid = i.inhrelid
    JOIN pg_class parent ON parent.oid = i.inhparent
    WHERE parent.oid = 'public.driver_locations'::regclass
      AND child.relispartition
      AND child.relname ~ '^driver_locations_[0-9]{4}_[0-9]{2}$'
  LOOP
    IF to_date(substr(r.child_name, 18), 'YYYY_MM') + interval '1 month' < cutoff90 THEN
      EXECUTE format('ALTER TABLE public.driver_locations DETACH PARTITION %I', r.child_name);
      EXECUTE format('DROP TABLE %I', r.child_name);
    END IF;
  END LOOP;

  -- Fila suelta en la partición _default (fechas fuera del rango).
  DELETE FROM public.driver_locations_default WHERE recorded_at < cutoff90;

  -- ── 3. rate_limits: ventanas viejas ─────────────────────────────────
  DELETE FROM public.rate_limits WHERE window_start < now() - interval '24 hours';

  -- ── 4. sync_queue: procesados > 30 días, fallados > 90 días ─────────
  DELETE FROM public.sync_queue
    WHERE processed_at IS NOT NULL AND processed_at < now() - interval '30 days';
  DELETE FROM public.sync_queue
    WHERE status = 'FAILED' AND created_at < now() - interval '90 days';

  -- ── 5. geocode_cache: > 365 días ────────────────────────────────────
  DELETE FROM public.geocode_cache WHERE created_at < now() - interval '365 days';
END;
$$;

COMMENT ON FUNCTION public.maintenance_purge IS
  'FASE 13: job de mantenimiento (purga por retención + extension de particiones). '
  'Llamar periodicamente (ruta /api/cron/maintenance con CRON_SECRET, o pg_cron en Supabase).';

-- Seguridad: la función es SECURITY DEFINER pero el search_path está
-- fijado a public y la ejecución real es contra tablas de infraestructura.
REVOKE ALL ON FUNCTION public.maintenance_purge() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.maintenance_purge() TO postgres;
