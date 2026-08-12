-- FASE 6 (§8): caché de la matriz de distancias/tiempos reales por calle
-- (Google Routes API). Mismo criterio que geocode_cache (migración base):
-- sin org_id, compartida entre organizaciones, clave = hash del par de
-- coordenadas redondeadas. "Cachear agresivamente: los pares de direcciones
-- se repiten mucho entre días" (§8, etapa 2).
create table if not exists public.route_matrix_cache (
  id uuid primary key default gen_random_uuid(),
  pair_hash text not null unique,
  origin_lat double precision not null,
  origin_lng double precision not null,
  dest_lat double precision not null,
  dest_lng double precision not null,
  distance_m double precision,
  duration_s integer,
  provider text not null,
  created_at timestamptz not null default now()
);

create index if not exists route_matrix_cache_pair_hash_idx
  on public.route_matrix_cache (pair_hash);

alter table public.route_matrix_cache enable row level security;

-- Mismo criterio que geocode_cache (0002_rls_policies.sql): sin org_id a
-- propósito, se comparte entre orgs. Lectura para cualquier autenticado,
-- escritura para el staff que corre el ruteo.
create policy "route_matrix_cache_select_authenticated" on public.route_matrix_cache
  for select using (auth.role() = 'authenticated');
create policy "route_matrix_cache_staff_write" on public.route_matrix_cache
  for all
  using (public.has_role('admin') or public.has_role('dispatcher') or public.has_role('warehouse'))
  with check (public.has_role('admin') or public.has_role('dispatcher') or public.has_role('warehouse'));
