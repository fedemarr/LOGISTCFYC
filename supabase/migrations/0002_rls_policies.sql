-- FASE 2 — Row Level Security (§7, §3). Políticas por org_id + rol.
--
-- Patrón: helpers SECURITY DEFINER (`current_org_id`, `has_role`) para
-- evitar recursión de RLS al consultar `users`/`user_roles` desde dentro
-- de una policy de otra tabla. Ver docs/DECISIONES.md ADR-015 por los
-- matices que quedan pendientes de afinar en FASE 3 (p. ej. "del día en
-- curso" para las rutas del chofer).

-- ═══════════════════════════════════════════════════════════════════════
-- 0. GRANTs base (Supabase ya los da por defecto en proyectos nuevos, se
--    declaran explícitos acá para no depender de eso).
-- ═══════════════════════════════════════════════════════════════════════
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 1. HELPERS
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.current_org_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT org_id FROM users WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.has_role(check_role user_role)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = check_role
  )
$$;

COMMENT ON FUNCTION public.current_org_id IS
  'org_id del usuario autenticado actual. SECURITY DEFINER para no recursar RLS de `users`.';
COMMENT ON FUNCTION public.has_role IS
  'true si el usuario autenticado actual tiene el rol dado (puede tener varios, §3).';

-- ═══════════════════════════════════════════════════════════════════════
-- 2. ENABLE RLS — todas las tablas de negocio (§7). Las particiones de
--    driver_locations/events heredan RLS de la tabla padre automáticamente.
-- ═══════════════════════════════════════════════════════════════════════
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE known_addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE geocode_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE containers ENABLE ROW LEVEL SECURITY;
ALTER TABLE routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE route_stops ENABLE ROW LEVEL SECURITY;
ALTER TABLE packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE package_scans ENABLE ROW LEVEL SECURITY;
ALTER TABLE custody_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE driver_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_queue ENABLE ROW LEVEL SECURITY;

-- ═══════════════════════════════════════════════════════════════════════
-- 3. POLICIES
-- ═══════════════════════════════════════════════════════════════════════

-- organizations: cada quien ve solo la suya.
CREATE POLICY "organizations_select_own" ON organizations FOR SELECT
  USING (id = public.current_org_id());

-- users: visibles dentro de la org (se necesita para asignar rutas, ver
-- nombres de choferes, etc.). Alta/edición: solo admin (§3).
CREATE POLICY "users_select_org" ON users FOR SELECT
  USING (org_id = public.current_org_id());
CREATE POLICY "users_admin_write" ON users FOR ALL
  USING (org_id = public.current_org_id() AND public.has_role('admin'))
  WITH CHECK (org_id = public.current_org_id() AND public.has_role('admin'));

-- user_roles: sin org_id propio (§7), se resuelve via join a users.
CREATE POLICY "user_roles_select_org" ON user_roles FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM users u WHERE u.id = user_roles.user_id AND u.org_id = public.current_org_id()
  ));
CREATE POLICY "user_roles_admin_write" ON user_roles FOR ALL
  USING (public.has_role('admin'))
  WITH CHECK (public.has_role('admin'));

-- clients: admin/dispatcher gestionan, resto de la org solo lee.
CREATE POLICY "clients_select_org" ON clients FOR SELECT
  USING (org_id = public.current_org_id());
CREATE POLICY "clients_staff_write" ON clients FOR ALL
  USING (org_id = public.current_org_id() AND (public.has_role('admin') OR public.has_role('dispatcher')))
  WITH CHECK (org_id = public.current_org_id() AND (public.has_role('admin') OR public.has_role('dispatcher')));

-- operations: admin/dispatcher toda la org; warehouse SOLO no cerradas (§7).
CREATE POLICY "operations_admin_dispatcher_all" ON operations FOR ALL
  USING (org_id = public.current_org_id() AND (public.has_role('admin') OR public.has_role('dispatcher')))
  WITH CHECK (org_id = public.current_org_id() AND (public.has_role('admin') OR public.has_role('dispatcher')));
CREATE POLICY "operations_warehouse_open_select" ON operations FOR SELECT
  USING (org_id = public.current_org_id() AND public.has_role('warehouse') AND status = 'OPEN');
CREATE POLICY "operations_warehouse_open_update" ON operations FOR UPDATE
  USING (org_id = public.current_org_id() AND public.has_role('warehouse') AND status = 'OPEN')
  WITH CHECK (org_id = public.current_org_id() AND public.has_role('warehouse'));

-- known_addresses: admin/dispatcher/warehouse resuelven y editan; todos
-- en la org pueden leer (el chofer necesita ver notas operativas, §9.5).
CREATE POLICY "known_addresses_select_org" ON known_addresses FOR SELECT
  USING (org_id = public.current_org_id());
CREATE POLICY "known_addresses_staff_write" ON known_addresses FOR ALL
  USING (org_id = public.current_org_id() AND (public.has_role('admin') OR public.has_role('dispatcher') OR public.has_role('warehouse')))
  WITH CHECK (org_id = public.current_org_id() AND (public.has_role('admin') OR public.has_role('dispatcher') OR public.has_role('warehouse')));

-- geocode_cache: sin org_id a propósito (§7, se comparte entre orgs). Solo
-- lectura/escritura para usuarios autenticados de la propia operación.
CREATE POLICY "geocode_cache_select_authenticated" ON geocode_cache FOR SELECT
  USING (auth.role() = 'authenticated');
CREATE POLICY "geocode_cache_staff_write" ON geocode_cache FOR ALL
  USING (public.has_role('admin') OR public.has_role('dispatcher') OR public.has_role('warehouse'))
  WITH CHECK (public.has_role('admin') OR public.has_role('dispatcher') OR public.has_role('warehouse'));

-- vehicles: alta solo admin (§3); el resto de la org lee.
CREATE POLICY "vehicles_select_org" ON vehicles FOR SELECT
  USING (org_id = public.current_org_id());
CREATE POLICY "vehicles_admin_write" ON vehicles FOR ALL
  USING (org_id = public.current_org_id() AND public.has_role('admin'))
  WITH CHECK (org_id = public.current_org_id() AND public.has_role('admin'));

-- containers: admin/dispatcher/warehouse gestionan; el chofer lee (escanea
-- el QR del contenedor en la toma de custodia, §9.3).
CREATE POLICY "containers_select_org" ON containers FOR SELECT
  USING (org_id = public.current_org_id());
CREATE POLICY "containers_staff_write" ON containers FOR ALL
  USING (org_id = public.current_org_id() AND (public.has_role('admin') OR public.has_role('dispatcher') OR public.has_role('warehouse')))
  WITH CHECK (org_id = public.current_org_id() AND (public.has_role('admin') OR public.has_role('dispatcher') OR public.has_role('warehouse')));

-- routes: admin/dispatcher/warehouse gestionan toda la org; el chofer solo
-- ve las rutas que tiene asignadas (criterio de aceptación de FASE 2).
CREATE POLICY "routes_staff_all" ON routes FOR ALL
  USING (org_id = public.current_org_id() AND (public.has_role('admin') OR public.has_role('dispatcher') OR public.has_role('warehouse')))
  WITH CHECK (org_id = public.current_org_id() AND (public.has_role('admin') OR public.has_role('dispatcher') OR public.has_role('warehouse')));
CREATE POLICY "routes_driver_own" ON routes FOR SELECT
  USING (public.has_role('driver') AND assigned_driver_id = auth.uid());

-- route_stops: igual que routes — staff gestiona, chofer solo lee las
-- paradas de SU ruta (nunca de otra).
CREATE POLICY "route_stops_staff_all" ON route_stops FOR ALL
  USING (
    (public.has_role('admin') OR public.has_role('dispatcher') OR public.has_role('warehouse'))
    AND EXISTS (SELECT 1 FROM routes r WHERE r.id = route_stops.route_id AND r.org_id = public.current_org_id())
  )
  WITH CHECK (
    (public.has_role('admin') OR public.has_role('dispatcher') OR public.has_role('warehouse'))
    AND EXISTS (SELECT 1 FROM routes r WHERE r.id = route_stops.route_id AND r.org_id = public.current_org_id())
  );
CREATE POLICY "route_stops_driver_own" ON route_stops FOR SELECT
  USING (
    public.has_role('driver')
    AND EXISTS (SELECT 1 FROM routes r WHERE r.id = route_stops.route_id AND r.assigned_driver_id = auth.uid())
  );

-- packages: el caso central del criterio de aceptación de FASE 2 — un
-- driver NO puede leer paquetes de una ruta que no es la suya.
CREATE POLICY "packages_staff_all" ON packages FOR ALL
  USING (org_id = public.current_org_id() AND (public.has_role('admin') OR public.has_role('dispatcher') OR public.has_role('warehouse')))
  WITH CHECK (org_id = public.current_org_id() AND (public.has_role('admin') OR public.has_role('dispatcher') OR public.has_role('warehouse')));
CREATE POLICY "packages_driver_own_route" ON packages FOR SELECT
  USING (
    public.has_role('driver')
    AND route_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM routes r WHERE r.id = packages.route_id AND r.assigned_driver_id = auth.uid())
  );

-- package_scans: solo staff de depósito/operaciones escanea (§3, el
-- driver no tiene esta acción en la matriz de permisos).
CREATE POLICY "package_scans_staff_all" ON package_scans FOR ALL
  USING (org_id = public.current_org_id() AND (public.has_role('admin') OR public.has_role('dispatcher') OR public.has_role('warehouse')))
  WITH CHECK (org_id = public.current_org_id() AND (public.has_role('admin') OR public.has_role('dispatcher') OR public.has_role('warehouse')));

-- custody_transfers: admin/dispatcher ven todo; el chofer solo su propia
-- transferencia de custodia (§9.3, "Tomar custodia de una ruta ✅ driver").
CREATE POLICY "custody_staff_all" ON custody_transfers FOR ALL
  USING (org_id = public.current_org_id() AND (public.has_role('admin') OR public.has_role('dispatcher')))
  WITH CHECK (org_id = public.current_org_id() AND (public.has_role('admin') OR public.has_role('dispatcher')));
CREATE POLICY "custody_driver_own" ON custody_transfers FOR ALL
  USING (org_id = public.current_org_id() AND public.has_role('driver') AND (to_user_id = auth.uid() OR from_user_id = auth.uid()))
  WITH CHECK (org_id = public.current_org_id() AND public.has_role('driver') AND to_user_id = auth.uid());

-- deliveries: SOLO el chofer inserta las suyas (§3, regla de oro #1 — acá
-- se refuerza a nivel RLS, la garantía fuerte es que ningún otro rol
-- tiene policy de INSERT). Staff ve todo; el chofer ve las propias.
CREATE POLICY "deliveries_select_staff" ON deliveries FOR SELECT
  USING (org_id = public.current_org_id() AND (public.has_role('admin') OR public.has_role('dispatcher') OR public.has_role('warehouse')));
CREATE POLICY "deliveries_select_own_driver" ON deliveries FOR SELECT
  USING (public.has_role('driver') AND driver_id = auth.uid());
CREATE POLICY "deliveries_insert_driver_own" ON deliveries FOR INSERT
  WITH CHECK (public.has_role('driver') AND driver_id = auth.uid());
CREATE POLICY "deliveries_admin_update" ON deliveries FOR UPDATE
  USING (org_id = public.current_org_id() AND public.has_role('admin'))
  WITH CHECK (org_id = public.current_org_id() AND public.has_role('admin'));

-- incidents: cualquier rol puede reportar (§3); resolver es solo
-- admin/dispatcher (§3, "Aprobar/rechazar entrega fallida").
CREATE POLICY "incidents_select_staff" ON incidents FOR SELECT
  USING (org_id = public.current_org_id() AND (public.has_role('admin') OR public.has_role('dispatcher') OR public.has_role('warehouse')));
CREATE POLICY "incidents_select_own_driver" ON incidents FOR SELECT
  USING (public.has_role('driver') AND driver_id = auth.uid());
CREATE POLICY "incidents_insert_org" ON incidents FOR INSERT
  WITH CHECK (org_id = public.current_org_id());
CREATE POLICY "incidents_update_admin_dispatcher" ON incidents FOR UPDATE
  USING (org_id = public.current_org_id() AND (public.has_role('admin') OR public.has_role('dispatcher')))
  WITH CHECK (org_id = public.current_org_id() AND (public.has_role('admin') OR public.has_role('dispatcher')));

-- support_tickets / ticket_messages: admin/dispatcher ven todo; el resto
-- ve y crea lo propio.
CREATE POLICY "tickets_select_staff" ON support_tickets FOR SELECT
  USING (org_id = public.current_org_id() AND (public.has_role('admin') OR public.has_role('dispatcher')));
CREATE POLICY "tickets_select_own" ON support_tickets FOR SELECT
  USING (driver_id = auth.uid());
CREATE POLICY "tickets_insert_org" ON support_tickets FOR INSERT
  WITH CHECK (org_id = public.current_org_id());
CREATE POLICY "tickets_update_staff" ON support_tickets FOR UPDATE
  USING (org_id = public.current_org_id() AND (public.has_role('admin') OR public.has_role('dispatcher')))
  WITH CHECK (org_id = public.current_org_id() AND (public.has_role('admin') OR public.has_role('dispatcher')));

CREATE POLICY "ticket_messages_select" ON ticket_messages FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM support_tickets t
    WHERE t.id = ticket_messages.ticket_id
      AND (t.org_id = public.current_org_id() OR t.driver_id = auth.uid())
  ));
CREATE POLICY "ticket_messages_insert" ON ticket_messages FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM support_tickets t
    WHERE t.id = ticket_messages.ticket_id
      AND (t.org_id = public.current_org_id() OR t.driver_id = auth.uid())
  ));

-- driver_locations: el chofer inserta y lee la suya (§10, "debe poder ver
-- su propio historial"); admin/dispatcher leen todo para el mapa en vivo.
-- Sin policy de UPDATE/DELETE para nadie: son puntos de tracking, no se
-- editan (mismo espíritu append-only que `events`, sin ser tan estricto).
CREATE POLICY "driver_locations_insert_own" ON driver_locations FOR INSERT
  WITH CHECK (public.has_role('driver') AND driver_id = auth.uid());
CREATE POLICY "driver_locations_select_staff" ON driver_locations FOR SELECT
  USING (org_id = public.current_org_id() AND (public.has_role('admin') OR public.has_role('dispatcher')));
CREATE POLICY "driver_locations_select_own" ON driver_locations FOR SELECT
  USING (driver_id = auth.uid());

-- events: SELECT según rol (§7). INSERT: nadie tiene policy — solo entra
-- por `log_event()` SECURITY DEFINER (que corre como owner y bypassea
-- RLS). UPDATE/DELETE: revocados a nivel GRANT y trigger en 0001, así que
-- ninguna policy de UPDATE/DELETE tendría efecto aunque se agregara.
CREATE POLICY "events_select_staff" ON events FOR SELECT
  USING (org_id = public.current_org_id() AND (public.has_role('admin') OR public.has_role('dispatcher')));
CREATE POLICY "events_select_own_actor" ON events FOR SELECT
  USING (actor_id = auth.uid());

-- sync_queue: sin org_id propio (§7) — se resuelve el acceso de staff via
-- join a users. Cada usuario ve y gestiona su propia cola de sync.
CREATE POLICY "sync_queue_own" ON sync_queue FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
CREATE POLICY "sync_queue_select_staff" ON sync_queue FOR SELECT
  USING (
    (public.has_role('admin') OR public.has_role('dispatcher'))
    AND EXISTS (SELECT 1 FROM users u WHERE u.id = sync_queue.user_id AND u.org_id = public.current_org_id())
  );

-- ═══════════════════════════════════════════════════════════════════════
-- 4. Reafirmar el candado de `events` por si el GRANT ALL de la sección 0
--    lo pisó (cinturón y tirantes, ver 0001) — incluyendo cada partición
--    mensual por nombre: si alguien accede a `events_2026_08` directo en
--    vez de a través de `events`, Postgres chequea el GRANT de esa
--    partición puntual, no el del padre. Por eso se revoca una por una.
-- ═══════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  partition_name text;
BEGIN
  REVOKE UPDATE, DELETE ON events FROM authenticated, anon;

  FOR partition_name IN
    SELECT child.relname
    FROM pg_inherits
    JOIN pg_class parent ON pg_inherits.inhparent = parent.oid
    JOIN pg_class child ON pg_inherits.inhrelid = child.oid
    WHERE parent.relname = 'events'
  LOOP
    EXECUTE format('REVOKE UPDATE, DELETE ON %I FROM authenticated, anon', partition_name);
  END LOOP;
END $$;
