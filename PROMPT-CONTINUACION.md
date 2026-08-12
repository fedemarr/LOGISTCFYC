# PROMPT DE CONTINUACIÓN — pegar como primer mensaje en una sesión nueva de Claude Code

> Usar este archivo cuando se acaben los tokens/contexto de la sesión anterior. Abrí Claude
> Code en la raíz de este repo (`sistemalogistica/`) y pegá este documento completo como
> primer mensaje. No hace falta pegar nada más — todo lo que necesitás ya está en el repo.

---

## 1. Quién sos y qué es esto

Sos el equipo de desarrollo completo (Software Architect, Backend, Frontend, DB, Mobile,
Security, DevOps, UX) de **FYC**, un sistema de logística de última milla para AMBA,
Argentina. La especificación completa — contexto de negocio, arquitectura, modelo de datos,
reglas de UX, las 14 fases de desarrollo — está en **`PROMPT-MAESTRO-CLAUDE-CODE.md`** (raíz
del repo). **Leelo completo antes de tocar código si no lo tenés ya en contexto.** Todo lo
que digas ahí (roles, permisos, máquina de estados, reglas de ingesta, stack) es decisión
tomada — no la reinterpretes ni la cambies sin preguntar.

Las **reglas de trabajo de `PROMPT-MAESTRO-CLAUDE-CODE.md` §0 siguen vigentes sin
excepción**: no `any`, no `console.log` en código de producción (los scripts de CLI de
`apps/web/src/lib/db/` son la excepción documentada, ver su `eslint.config.mjs`), soft
delete + event log append-only, no hardcodear secrets, no duplicar código existente, leer un
archivo completo antes de modificarlo, preguntar en vez de inventar datos de negocio o
decisiones de arquitectura no cubiertas por el documento.

## 2. Excepción explícita a la regla de "parar entre fases"

`PROMPT-MAESTRO-CLAUDE-CODE.md` §0.1 dice que hay que parar al final de cada fase a esperar
aprobación. **El dueño del proyecto (Fede) autorizó explícitamente saltarse esa pausa** para
poder avanzar rápido mientras dura el contexto de cada sesión: _"segui haciendo todo,
despues de esto segui con las siguientes fases"_. Interpretación práctica de esa
autorización:

- **Seguí de fase en fase sin pedir aprobación explícita entre medio**, pero seguí
  cumpliendo el resto del ritual de cada fase: probar de verdad (no asumir que algo
  funciona), documentar en `docs/DECISIONES.md` cada decisión no obvia, actualizar este
  mismo archivo (`PROMPT-CONTINUACION.md`) con el estado real, y hacer commit al cerrar cada
  fase con mensaje convencional.
- **Si en algún momento Fede te dice explícitamente que pares o que quiere revisar algo,
  esa instrucción pisa esta autorización** — es él ajustando el proceso en vivo, no una
  contradicción a resolver.
- Seguí preguntando (con `AskUserQuestion` o texto) ante datos de negocio faltantes,
  credenciales, o decisiones técnicas donde el documento no te da una respuesta — esa parte
  de las reglas **no** está waiveada, solo la pausa de fin de fase.
- No dejes de hacer commits chicos y frecuentes por "ir rápido" — un commit roto a mitad de
  fase 8 es mucho más caro de diagnosticar en una sesión nueva que uno bien cortado.

## 3. Estado actual del proyecto

**Último commit en `main`:** revisá `git log --oneline -10` al arrancar — este documento
puede quedar desactualizado si una sesión anterior avanzó más y no llegó a actualizarlo.
Al día de escribir esto: FASE 1 a 6 **cerradas**, y el rediseño visual del panel real
(`PROMPT-FRONTEND-V2.md` + `mockup.html`) también **aplicado** con alcance acotado (ver
ADR-039 y el detalle en §6) — todavía sin que Fede lo haya visto con sus propios ojos en el
deploy, eso es lo primero que falta.

**Repo:** `https://github.com/fedemarr/LOGISTCFYC` (rama `main`). El working tree debería
estar limpio; si no lo está, mirá qué quedó a medio hacer antes de seguir.

**Deploy:** `apps/web` está en Vercel (proyecto `fmcodes-projects/web`, usuario
`fedenez11-4576`). Deploy actual de prod:
`https://web-2842cb7py-fmcodes-projects.vercel.app` (protegido por Vercel Authentication,
solo accesible logueado con esa cuenta). El deploy se dispara solo con cada push a `main`.
**Config de Vercel:** el Root Directory quedó en la raíz del repo con comandos explícitos
en `vercel.json` (ver ADR-012).

**Env vars en Vercel — estado real (verificado `vercel env ls <env> --scope
fmcodes-projects`):**

- **Production:** las 4 vars core están (`SUPABASE_SERVICE_ROLE_KEY`,
  `DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`) —
  `SUPABASE_SERVICE_ROLE_KEY` se agregó y se verificó de punta a punta (login,
  alta de usuario, soft delete, cleanup) el 2026-08-11.
- **Preview y Development: CERO env vars.** Ni siquiera `NEXT_PUBLIC_SUPABASE_URL`. Un
  deploy de preview (una rama que no sea `main`, un PR) rompe el build entero, no solo
  `/api/users`. **Nadie las agregó todavía** — el harness de esta sesión bloqueó el intento
  (clasificador de modo automático no deja modificar config de servicios externos vía CLI).
  Pedirle a Fede que corra esto (o que apruebe el permiso y hacerlo desde la sesión):
  ```bash
  vercel env add NEXT_PUBLIC_SUPABASE_URL preview --value "<del .env>" --scope fmcodes-projects --yes
  vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY preview --value "<del .env>" --scope fmcodes-projects --yes
  vercel env add SUPABASE_SERVICE_ROLE_KEY preview --value "<del .env>" --scope fmcodes-projects --yes
  vercel env add DATABASE_URL preview --value "<del .env>" --scope fmcodes-projects --yes
  # repetir con "development" en vez de "preview" si hace falta `vercel dev` conectado a Vercel
  ```
- **Gotcha de verificación:** `vercel env pull` **enmascara los valores de vars sensibles
  como `""`**. No sirve para chequear si una var tiene el valor correcto — solo para
  chequear que existe. Para confirmar el valor real, hay que hacer un smoke test end-to-end
  (login + una llamada que la use) o mirar el dashboard.

### FASE 1 — Scaffolding ✅ (commits `a40988a`, `afbc85b`, `1fda482`)

Turborepo + pnpm workspaces. `apps/web` (Next.js 15.5.23 + React 19, TS strict, Tailwind v4,
shadcn/ui). `apps/mobile` (Expo SDK 57, Development Build con `expo-dev-client`, EAS
configurado — placeholder `com.fyc.mobile` como bundle id, confirmar el real antes de
un build de distribución). `packages/shared` (roles), `packages/state-machine` (contrato de
estados, sin implementar — es FASE 3), `packages/geo` (haversine implementado, clustering
sin implementar — es FASE 6), `packages/config` (eslint/tsconfig/tailwind compartidos).
Husky + commitlint + Prettier + lint-staged. GitHub Actions CI. `pnpm dev/typecheck/lint/
test/build` funcionan en las 6 packages.

### FASE 2 — Base de datos ✅ (commit `e2dcdea`)

Schema Drizzle completo en `apps/web/src/lib/db/schema/` (21 tablas de negocio, todos los
enums de §7). 4 migraciones SQL aplicadas contra Supabase real en
`supabase/migrations/0000-0003`: schema base, PostGIS + particionado mensual de `events` y
`driver_locations` + candado append-only de `events` (trigger + revoke, no se puede ni con
la conexión de admin), políticas RLS completas por `org_id`/rol en las 21 tablas, hardening
de la tabla interna de tracking de migraciones. Seed idempotente (`pnpm db:seed` desde
`apps/web`): 1 org, 4 usuarios reales de Supabase Auth (uno por rol, contraseña
`FYC123!`, ver `apps/web/src/lib/db/seed/index.ts`), 3 vehículos, 5 contenedores, 1
cliente, 1 operación, ~56 direcciones del GBA, 120 paquetes. Tests de integración contra la
base real (`pnpm test` desde `apps/web`) verifican que un driver no ve paquetes/rutas de
otro chofer y que nadie puede hacer UPDATE/DELETE sobre `events`. `docs/MODELO-DATOS.md`
tiene el diagrama ER y la explicación de cada regla de diseño no obvia.

**Gotchas ya resueltos — no los vuelvas a pisar (todo esto está en `docs/DECISIONES.md`,
ADR-013 a ADR-018, léelos si algo de esto te vuelve a pasar):**

1. **DNS/IPv6:** la conexión directa de Supabase (`db.<ref>.supabase.co`) es IPv6-only y
   este entorno de desarrollo no tiene salida IPv6 → falla con errores confusos de DNS
   (`getaddrinfo ENOENT`/`ENETUNREACH`). `DATABASE_URL` en `.env` ya apunta al **Session
   Pooler** (`aws-0-sa-east-1.pooler.supabase.com:5432`, usuario
   `postgres.xdhjxecrozcozcstndbr`), que es IPv4. Si alguna vez ves errores de DNS al correr
   `db:migrate`/`db:seed`/`pnpm test`, es esto — no re-investigues desde cero.
2. **`drizzle-kit generate` no puede importar paquetes del workspace** (`@fyc/
state-machine`, `@fyc/shared`) dentro de `drizzle.config.ts` o los archivos de
   schema — el import se resuelve a `undefined` en tiempo de generate (aunque funciona
   perfecto en Next.js/tsx/vitest). Por eso `enums.ts` tiene mirrors literales de
   `PACKAGE_STATUSES`/`ROLES` con un test de sincronización
   (`schema/__tests__/enums-sync.test.ts`) en vez de importar directo.
3. **`apps/web` typecheck necesita `next typegen` primero** (`.next/types/**` no existe en
   un checkout limpio) — ya está resuelto en el script `typecheck` de
   `apps/web/package.json`, no lo simplifiques a `tsc --noEmit` solo.
4. **Vitest + Tailwind v4:** hace falta `vitest.config.ts` con `css: { postcss: { plugins:
[] } }` o Vitest intenta cargar `postcss.config.mjs` del proyecto y explota. Ya está.
5. **La conexión Drizzle (`DATABASE_URL`) usa el usuario `postgres` y bypassea RLS por
   completo.** RLS protege accesos directos desde cliente (Supabase JWT), no al backend. La
   autorización real del backend es responsabilidad del middleware de FASE 3 — no asumas
   que "tiene RLS" alcanza.

### FASE 3 — Core de dominio y backend ✅ (commit `0b195b4`, fixes Vercel después)

`packages/state-machine` **completo y cerrado** (67 tests, 100% cobertura, threshold 80%):
tabla de transiciones fiel al diagrama de §4 + matriz de permisos de §3, precondiciones
(evidencia+GPS para `ENTREGADO`, foto para `FALLA_REPORTADA`, motivo para excepciones),
`validateTransition()` puro y `transition()` por inyección de dependencias.

Backend de `apps/web` completo: middleware de auth en `apps/web/src/middleware.ts` que
valida el JWT de Supabase contra el Edge runtime y setea `x-fyc-user-id`;
`requireUser`/`requireRole`; envelope de respuesta estándar `{ success, data, meta }` /
`{ success, error: { code, message } }` (`lib/api/response.ts`); `AppError` + `toAppError`
(`lib/api/errors.ts`); Zod en TODOS los inputs (`parseBody`/`parseQuery`/`parseParams`);
paginación offset (`paginationFrom`/`paginationMeta`); rate limiting con ventana fija
atómica sobre la tabla `rate_limits` (`consumeRateLimit`); logger estructurado
(`lib/api/logger.ts`); `GET /api/packages` + `POST /api/packages/:id/transition` como
patrón de referencia; `lib/services/state-machine.ts` orquesta la transición en una
`db.transaction` con lock `FOR UPDATE` y escribe el evento en la MISMA transacción.
`docs/API.md` documenta todo el patrón. Suite completa verde.

**Inferencias documentadas** (no estaban explícitas en el documento madre, ver ADR): (a)
`DANIADO` no es final — mismo abanico de resolución que `FALLA_REPORTADA`; (b) reabrir un
estado final (solo `admin`) vuelve a `GEOCODIFICADO`.

### Rebranding a FYC ✅ (commit `3c9bd4d`, desplegado y verificado)

Rename completo `lastmile → fyc`: paquetes `@fyc/*`, header interno `x-fyc-user-id`,
bundle id de la app móvil `com.fyc.mobile`, emails de seed `@fyc.demo` (contraseña
`FYC123!`; los usuarios viejos `@lastmile.demo` siguen en Supabase Auth pero ya no están
en el seed). Se preservó intencionalmente la tabla interna `_lastmile_migrations` en la DB
desplegada (renombrarla re-aplicaría migraciones). Prueba del deploy:
`https://web-2842cb7py-fmcodes-projects.vercel.app` responde 200.

### FASE 4 — Panel web: base 🚧 EN CURSO

**Ya hecho:**

- **Sesión del panel:** login en `app/(auth)/login/page.tsx` con supabase-js (browser,
  localStorage) y `Authorization: Bearer` hacia la API (client-side a propósito, ADR-021).
  `app-shell.tsx` + `sidebar.tsx` renderizan el sidebar por rol (usuarios solo admin;
  vehículos/clientes/contenedores lectura admin/dispatcher/warehouse; driver solo
  Inicio/Paquetes) y el logout. Dashboard en `app/(panel)/page.tsx` (conteos vía
  `meta.total` con `pageSize=1`).
- **API del panel:** `GET /api/auth/me` + CRUD completo de `/api/users`, `/api/vehicles`,
  `/api/clients`, `/api/containers` (list+create, y `[id]` con GET/PATCH/DELETE soft).
  Alta de usuarios via `lib/services/users.ts` (service role: crea auth + perfil + roles,
  ver ADR-024). Client HTTP: `lib/api/client.ts` (`apiFetch`, `ApiClientError`, tipos).
- **UI (Base UI 1.7, ver ADR-023):** primitivas en `apps/web/src/components/ui/` (input,
  label, textarea, select, checkbox, badge, card, skeleton, table, dialog, alert-dialog,
  dropdown-menu, toast, pagination) + `states.tsx` (Empty/Error/TableSkeleton) +
  `page-header`, `search-bar`, `row-actions`, `confirm-delete`, `role-badge`.
- **Páginas CRUD:** listas + alta + edición de usuarios, vehículos, clientes y
  contenedores (búsqueda, paginación, estados loading/empty/error, soft delete con
  AlertDialog y toast), y la lista de paquetes (status badges con colores semánticos).
  Todo bajo la route group `app/(panel)/` (el dashboard reemplazó al viejo
  `src/app/page.tsx`, que se eliminó).
- Tests de integración de `lib/services/users.ts` (alta/edición/soft delete/email duplicado
  → CONFLICT) contra Supabase real. Suite completa verde + build web en producción.

**Gotchas nuevos de FASE 4 — no los vuelvas a pisar:**

1. **Build local de `apps/web`:** requiere `$env:NODE_ENV="production"` (el `.env` raíz tiene
   `NODE_ENV=development` que rompe el prerender) **y** cargar el `.env` raíz con
   `pnpm exec dotenv -e ../../.env -- next build` desde `apps/web` (la DB real se usa al
   recolectar page data de los Route Handlers). En Vercel no pasa nada de esto. Comando que
   funciona:
   `$env:NODE_ENV="production"; pnpm exec dotenv -e ../../.env -- next build`
   (desde `apps/web`).
2. **Base UI 1.7 no tiene `Slot` ni `asChild`** (eso es de Radix/shadcn). Para polimorfismo
   se usa el prop `render` (ej. `<Button render={<Link href="..." />}>`). Un snippet de
   shadcn con `asChild`/`@base-ui/react/slot` rompe el typecheck — traducilo a `render`.
3. **`@fyc/shared` barrel:** el `export * from "./constants/roles.js"` (con `.js`) hace
   fallar a webpack de Next (no lo resuelve a `.ts`). Se cambió a extensionless
   (`./constants/roles`). No reintroduzcas `.js` en los barrels de los packages.
4. **`eq(col, null)` en Drizzle tipa mal** — usar `isNull(col)` (los `[id]` y listados de
   FASE 4 lo usan). El `deleted_at` de `users` es `PgTimestamp` con data `Date`.
5. **Stale `.next`:** al eliminar `src/app/page.tsx` el typecheck rompía con referencias
   fantasma (`Cannot find module .../app/page.js`). Se resuelve borrando `apps/web/.next`.

**Falta (no bloqueante, pendiente para cuando toque pulir el panel):**

1. Detalle de paquete + acciones de transición manual desde el panel (fuera de la cascada de
   ingesta) — no se hizo porque FASE 5 la resolvió parcialmente vía `/deposito` (scan +
   bandeja de resolución). Retomar si hace falta un detalle de paquete individual con
   historial de eventos.

FASE 4 se considera base suficiente (sesión + shell + CRUD + design system) para construir
FASE 5 encima, que es lo que se hizo. No se cerró con su propio commit final separado —
quedó incorporada al flujo normal de commits (`4a7f43d`, `045bf5d`).

### FASE 5 — Ingesta y resolución de destino ✅ (commit `a548e51`)

Cascada completa de PROMPT-MAESTRO §2 implementada y testeada de punta a punta:

- **`packages/shared`:** tipos de ingesta (`ResolutionResult`, `ScanInput`, etc.), detección
  y parseo de código de barras puro (`detectCodeFormat`, `parseBarcodePayload`, JSON o
  `key=value|key=value`), normalización + hash de dirección compartido con el seed
  (`normalizeAddressText`/`hashNormalizedAddress`, `crypto.subtle` — isomórfico
  Node/browser/RN).
- **Cascada de resolución** (`apps/web/src/lib/services/ingestion.ts`): MANIFEST →
  BARCODE_PAYLOAD → ADDRESS_MEMORY → OCR (deferred a FASE 8, no simulado — cae a MANUAL con
  la foto adjunta) → MANUAL. Detecta duplicados (mismo código escaneado dos veces en la
  misma operación, ambos intentos quedan auditados) y "wrong client" (prefijo de
  `clients.code_prefix` que no matchea).
- **Geocoding con caché agresivo** (`lib/services/geocoding.ts`): `known_addresses` →
  `geocode_cache` → Google Geocoding API, con degradación controlada (`accuracy: "FAILED"`,
  no excepción) si `GOOGLE_GEOCODING_API_KEY` no está seteada. `geocodeOperationPackages()`
  procesa en lote los `RECIBIDO` de una operación.
- **Cierre de operación** (`lib/services/operations.ts`): reconciliación de faltantes
  (`from_manifest=true`, nunca escaneado) y sobrantes (`from_manifest=false`, sí escaneado),
  cierra la operación (`status: CLOSED`).
- **8 endpoints REST** bajo `/api/operations/*` (list/create, detail, import CSV
  pre-mapeado, scan, bandeja de pendientes, geocodificar en lote, cerrar) +
  `/api/packages/[id]/resolve` (resolución manual). Todos siguen el patrón de FASE 3
  (`jsonOk`/`jsonError`, Zod, `requireRole`).
- **UI funcional** en `/deposito` (nav "Depósito", roles admin/dispatcher/warehouse):
  crear/ver operación del día, importar manifiesto (paste CSV), escanear, ver bandeja de
  resolución, geocodificar en lote, cerrar con reporte de reconciliación. **Sin el pulido
  visual del mockup todavía** — es la pantalla base sobre la que se aplica el rediseño de
  §6 más adelante.
- Migraciones `0005` (`clients.code_prefix`) y `0006` (`packages.from_manifest`).
- 19 tests de integración nuevos contra Supabase real + 14 tests puros (barcode/normalize).

**Gotchas nuevos de FASE 5 — no los vuelvas a pisar:**

1. **No anides `db.transaction()`.** `runPackageTransition()` (de FASE 3) abre su propia
   transacción con `SELECT ... FOR UPDATE`. Si la llamás desde adentro de otra
   `db.transaction()` sin commitear antes, dos conexiones del pool esperan el mismo lock
   entre sí → deadlock. Patrón correcto en `ingestion.ts`/`geocoding.ts`: la transacción
   externa devuelve un resultado con una flag (`needsTransition`), y `runPackageTransition()`
   se llama DESPUÉS, ya afuera. Si falla ahí, el paquete queda con los datos completos pero
   sin transicionar — estado recuperable, no corrupción.
2. **`ALTER TABLE ... DISABLE TRIGGER` es global al catálogo de Postgres, no
   session-scoped.** Con Vitest corriendo archivos de test en paralelo, la ventana de
   cleanup de un archivo (disable→delete→enable) puede pisar la aserción de otro archivo de
   que un DELETE está bloqueado — carrera real, no teórica (pasó). Usar
   `apps/web/src/lib/db/test-helpers.ts` → `purgeTestEvents(orgId)`, que usa
   `SET LOCAL session_replication_role = replica` dentro de un `db.transaction()` (scope de
   una sola transacción/conexión). Cualquier test nuevo que necesite limpiar `events` debe
   usar esta función, no repetir el patrón viejo.
3. **El Session Pooler de Supabase tiene un límite de conexiones concurrentes bajo.** Con 9+
   archivos de test de integración (cada uno con su propio `pg.Pool` por ser proceso forkeado
   de Vitest) corriendo en paralelo, se agotaban las conexiones y aparecían timeouts
   (`Test timed out in 5000ms`) en cascada. `apps/web/vitest.config.ts` tiene
   `fileParallelism: false` (archivos en serie) + `testTimeout: 20_000`. No lo revasa sin
   entender por qué está — volvería la falla intermitente.
4. **`process.env.X` puede ser `""` en vez de `undefined`** si la var está declarada vacía en
   `.env` (`GOOGLE_GEOCODING_API_KEY=`). El código de producción ya lo trata bien (`!apiKey`
   es falsy para `""`), pero si escribís un test que chequea "no está configurada", comparar
   contra `""`, no contra `toBeUndefined()`.
5. **Import CSV recibe filas ya mapeadas** (`{ trackingCode, recipientName?, ... }`), no un
   CSV crudo — el mapeo de columnas (si hace falta UI para elegir qué columna es qué) es
   responsabilidad del cliente/frontend, no del endpoint (ver ADR-031).

### FASE 6 — Ruteo ✅

Estrategia híbrida de §8 completa, de punta a punta (clustering → matriz real → secuencia →
ajuste manual → aprobar → etiquetas):

- **`packages/geo`** (antes solo tenía haversine): `clusterPackages()` — capacitated
  k-means++ con `capacities: number[]` (una por vehículo, heterogéneas) + detección de
  outliers estilo DBSCAN (`minPts=1`, aislado = sin otro punto a ≤5km) + una pasada de
  refinamiento de frontera. `sequenceRoute()` — nearest neighbor desde el depósito + 2-opt
  acotado por presupuesto de tiempo (default 5s, §8). Ambas funciones puras, sin tocar la
  base, con `randomFn`/`distanceFn` inyectables para tests determinísticos.
- **Matriz de distancias reales** (`apps/web/src/lib/services/routing.ts`): cascada de
  caché igual que geocoding — tabla nueva `route_matrix_cache` (migración `0007`, sin
  `org_id`, mismo criterio que `geocode_cache`) → Google Routes API (`computeRouteMatrix`,
  necesita `GOOGLE_ROUTES_API_KEY`, todavía no conseguida) → estimación degradada
  (haversine × 1.3, nunca excepción).
- **Generación de propuesta** (`lib/services/route-planning.ts`): `generateRouteProposal()`
  arma clusters con los `GEOCODIFICADO` de la operación + vehículos `AVAILABLE` con chofer
  asignado, pide la matriz por cluster, secuencia, y escribe `routes` (`DRAFT`) +
  `route_stops`. `resolveDepotLocation()` — `organizations.settings.depot` con fallback a
  `DEFAULT_DEPOT_LAT`/`DEFAULT_DEPOT_LNG`, sin inventar coordenadas si falta (ver ADR-033,
  todavía sin cargar el valor real).
- **Ajuste humano** (§8 etapa 3): `reassignPackageRoute()` mueve un paquete entre rutas
  `DRAFT`/`PROPOSED` y re-secuencia ambas completas con la matriz real ("recalcula en
  vivo"). `approveRoute()` congela `bulk_number` (1..n) y transiciona cada paquete
  `GEOCODIFICADO → ASIGNADO` — **admin/dispatcher únicamente**, no warehouse (más
  restrictivo que la transición de estado en sí, ver ADR-038).
- **Etiquetas** (`lib/services/labels.ts`, formato exacto de §9.2): PDF con `pdf-lib` +
  QR con `qrcode` (siempre `internal_code`, nunca `tracking_code`). Térmica 100×150mm
  (una página por bulto) y A4 (grilla 2×2). Solo imprime rutas `APPROVED`.
- **8 endpoints REST** bajo `/api/operations/:id/routes` (list/generate),
  `/api/routes/:id` (detalle, con restricción para que un driver solo vea la suya),
  `/api/routes/:id/reassign`, `/api/routes/:id/approve`, `/api/routes/:id/labels` (devuelve
  el PDF binario directo, no el envelope JSON).
- **UI funcional** en `/ruteo` (nav "Ruteo"): genera la propuesta, muestra cada ruta en una
  card con sus paradas, permite mover un bulto a otra ruta con un select (no drag&drop
  todavía), aprobar, e imprimir. **Sin el pulido visual ni el mapa MapLibre del mockup** —
  es la base funcional sobre la que se aplica el rediseño de §6.
- 22 tests de integración nuevos contra Supabase real (`route-planning.test.ts`,
  `routing.test.ts`, `labels.test.ts`) + 12 tests puros de `@fyc/geo`.

**Gotchas nuevos de FASE 6 — no los vuelvas a pisar:**

1. **No hay coordenada de depósito real cargada todavía.** `resolveDepotLocation()` tira
   `VALIDATION_ERROR` si no está `organizations.settings.depot` ni
   `DEFAULT_DEPOT_LAT`/`DEFAULT_DEPOT_LNG` en `.env` (ambas declaradas pero vacías). Los
   tests la setean vía `process.env` en el `beforeAll`. Antes de usar `/ruteo` con datos
   reales, pedile a Fede la ubicación exacta del depósito y cargala.
2. **`vehicles.assigned_driver_id` es obligatorio para que un vehículo cuente como
   disponible para rutear** (`fetchAvailableVehicles()` filtra los que no lo tienen) —
   además de `status: AVAILABLE`. Un vehículo sin chofer asignado no genera un cluster
   aunque esté disponible.
3. **`GOOGLE_ROUTES_API_KEY` no está configurada** (igual que `GOOGLE_GEOCODING_API_KEY` en
   FASE 5) — todo el ruteo funciona con la estimación degradada (haversine × 1.3) hasta que
   se cargue. No es un bug si las distancias no coinciden con Google Maps todavía.
4. **Mismo patrón "no anidar `db.transaction()`"** que FASE 5 (ADR-027) aplica en
   `approveRoute()`: el freeze de `bulk_number` + cambio de estado de la ruta van en una
   transacción; `runPackageTransition()` (que abre la suya) se llama después, afuera.
5. **`reassignPackageRoute()` borra y recrea TODOS los `route_stops` de las dos rutas
   afectadas** en cada movimiento (no un ajuste incremental, ver ADR-036) — barato al
   volumen de §17 (~40 paradas/ruta) pero no pensado para un loop de mover-muchos-rápido.

## 4. Credenciales — dónde están, qué falta

Todo lo que ya se consiguió está en `.env` (raíz, **no está en git**, no lo va a encontrar
una sesión nueva a menos que lea el archivo directo). Si `.env` no existe en el checkout
nuevo (por ejemplo porque es una máquina distinta), pedile a Fede que lo pase de nuevo — NO
lo reconstruyas con placeholders y sigas de largo.

Ya conseguido (Supabase project `xdhjxecrozcozcstndbr`, región `sa-east-1`): URL, anon key,
service role key, `DATABASE_URL` (session pooler). GitHub conectado. Vercel deployado y con
Git integration activa. Las 4 vars core ya están en Vercel **Production** (ver detalle en
§3) — **faltan en Preview y Development**, todavía sin resolver.

**Todavía NO conseguido** (vas a necesitarlo en las fases que siguen — pedíselo a Fede
cuando llegues ahí, no antes):

- `GOOGLE_GEOCODING_API_KEY` / `GOOGLE_ROUTES_API_KEY` / `GOOGLE_VISION_API_KEY` — FASE 5/6
- `NEXT_PUBLIC_MAPTILER_KEY` — opcional. El mapa de `/ruteo` usa tiles gratuitos de Carto
  (`dark-matter`/`positron`) que no la necesitan; solo hace falta si en algún momento se
  quiere el estilo `dataviz` de MapTiler que pide el documento originalmente.
- Cuenta de Expo/EAS para builds de distribución — FASE 7 en adelante
- `SENTRY_DSN` — FASE 13
- Datos de negocio de la sección 20 del documento madre (nombre del rol dispatcher, tipo de
  impresora, ubicación del depósito, capacidad de vehículos, tarifas, etc.)

## 5. Cómo verificar que todo sigue vivo antes de seguir

```bash
cd sistemalogistica
git log --oneline -5              # confirmá en qué commit estás parado
git status                        # debería estar limpio

pnpm install
pnpm exec turbo run typecheck lint test --force   # las 6 packages, debería dar todo verde

cd apps/web
pnpm db:migrate                   # idempotente, no debería aplicar nada nuevo
pnpm db:verify                    # chequeo rápido de RLS/particiones/PostGIS
pnpm test                         # tests de RLS contra Supabase real

# Build de web en local (ver gotcha de NODE_ENV en la sección 3):
$env:NODE_ENV="production"; pnpm exec dotenv -e ../../.env -- next build
```

Si algo de esto falla, arreglalo antes de seguir avanzando de fase — no construyas FASE 3
sobre una FASE 2 rota.

### Rediseño visual (PROMPT-FRONTEND-V2) ✅ — alcance acotado, ver ADR-039

FASE 1 a 6 cerradas, y encima el rediseño visual que Fede pidió explícitamente
("quiero que se vea de esa manera", señalando `PROMPT-FRONTEND-V2.md` + `mockup.html`) ya
está aplicado **sobre el panel real** (eligió expresamente "Reemplazar el diseño del panel
real" cuando se le preguntó — no es un mock aparte).

**Lo que se hizo:**

- **Tokens** (`packages/config/tailwind/tokens.css`, reescrito completo): dark-first
  (`:root`/`[data-theme="dark"]` = paleta oscura, `[data-theme="light"]` la overridea),
  hex exactos del documento (`--bg:#0F1115`/`#F7F8FA`, `--surface`/`-2`/`-3`,
  `--border`/`-2`, `--text`, `--muted`/`-2`). Paleta de 12 colores de ruta
  (`--route-1..12`) + variantes `-light` (luminosidad −12%) para el tema claro.
- **Fuentes**: Archivo (`--font-sans`) + JetBrains Mono (`--font-mono`) vía
  `next/font/google` en `layout.tsx`. Clase `.font-data` (en `globals.css`, capa
  `@layer utilities`) = mono + `tabular-nums` — usala en TODO dato operativo nuevo
  (códigos, bultos, km, horas), no la clase genérica `font-mono` de Tailwind.
- **Tema**: `next-themes` con `attribute="data-theme"` (NO `"class"` — los tokens usan
  `[data-theme]`, no `.dark`), `defaultTheme="dark"`. `ThemeProvider` en
  `components/theme-provider.tsx`, toggle en `components/theme-toggle.tsx` (montado en el
  topbar mobile y en el footer del sidebar desktop de `app-shell.tsx`).
- **Costilla**: clase utilitaria `.spine` (`globals.css`) — barra de 4px, `position:
absolute; left:0`, color inyectado por `style`. Aplicada en `RouteCard` de `/ruteo`.
- **`/ruteo` rediseñado**: layout de dos columnas (tarjetas 320px | mapa), `RouteCard` con
  costilla + número de ruta en mono + avatar de chofer + stats en mono + barra de
  ocupación (verde <85%/ámbar 85-100%/rojo >100%, necesita `vehicles.capacity_packages` —
  el endpoint `GET /api/operations/:id/routes` ahora también devuelve `driverName`,
  `vehiclePlate`, `capacityPackages` y `depot`). **Mapa real** en
  `app/(panel)/ruteo/route-map.tsx` — MapLibre GL JS + tiles gratuitos de Carto
  (`dark-matter`/`positron`, no hace falta `NEXT_PUBLIC_MAPTILER_KEY`), pines coloreados
  por ruta, trazado punteado, resalte al pasar el mouse por la tarjeta
  (`setPaintProperty`, sin re-render), `fitBounds` automático, cambio de estilo completo
  (no filtro CSS) al cambiar de tema. Sin territorios (turf) ni clustering por zoom — ver
  ADR-039.
- `ROUTE_COLORS` en `lib/services/route-planning.ts` ahora es un espejo literal de
  `--route-1..12` (antes eran colores provisorios).
- **Bug real encontrado y arreglado**: el shim de shadcn en `globals.css` tenía
  `--primary: var(--primary);` (y lo mismo con `--muted`/`--border`) — dos reglas `:root`
  con el mismo nombre de custom property, ciclo de auto-referencia, valor inválido. Bordes
  y accent color podían estar rotos desde antes de esta sesión sin que ningún test lo
  detectara. Reescrito para mapear `@theme inline` directo a los nombres reales de
  `tokens.css`, sin `:root` intermedio.

**Lo que NO se hizo (a propósito, ver ADR-039):**

- `/operaciones` (bandeja de excepciones) y la app del chofer (`/app/*`) del documento —
  dependen de datos que el backend real todavía no tiene (incidencias con SLA es FASE
  11/12; la app del chofer es `apps/mobile`, Expo nativo, FASE 7-10 — un prototipo web
  paralelo hubiera duplicado ese trabajo).
- Pixel a pixel en cada CRUD individual — ya heredan los tokens compartidos desde FASE 4,
  se tocó puntualmente `.font-data` donde hay datos operativos.
- **Verificación visual real (ojos humanos comparando con el mockup)** — no hay
  herramienta de captura de pantalla en este entorno. Se verificó con `typecheck`/`lint`/
  `test`/`build` en verde y un smoke test manual (`next start` + `curl`: HTML 200, ambos
  bloques de tokens presentes en el CSS compilado, script de `next-themes` inyectando
  `data-theme`) — pero **Fede todavía no lo vio con sus propios ojos**. Es el primer paso
  pendiente real de todo este trabajo.

**No hay más fases de backend pendientes en la cola actual.** Lo que sigue, en orden de
probabilidad:

1. Que Fede revise el resultado visual en el deploy y pida ajustes puntuales.
2. Profundizar el mapa de `/ruteo` (territorios con turf, clustering) si hace falta.
3. Seguir con FASE 7+ del documento madre (`apps/mobile`, app del chofer) si Fede lo pide.

## 7. Ritual al cerrar cada fase (no te lo saltees aunque no pares a pedir aprobación)

1. Correr la suite completa (`typecheck`, `lint`, `test`, `build`) y confirmar que da verde.
2. Actualizar `docs/DECISIONES.md` con cualquier decisión no obvia que hayas tomado (ADR
   nuevo, numerado siguiendo el último que exista).
3. **Actualizar la sección 3 de este mismo archivo (`PROMPT-CONTINUACION.md`)** con el
   estado real: qué fase quedó cerrada, en qué commit, qué gotchas nuevos aparecieron, qué
   sigue. Es el archivo que va a leer la próxima sesión — si no lo actualizás, se pierde el
   contexto y se repite trabajo o se rompen cosas por desconocimiento.
4. Commit con mensaje convencional (`feat:`, `fix:`, `chore:`, `docs:` — el subject no puede
   empezar con una palabra en MAYÚSCULAS, commitlint lo rechaza como "upper-case", ver el
   commit de FASE 2 como ejemplo de cómo evitarlo) y push a `main`.
5. Recién ahí seguir con la fase siguiente.
