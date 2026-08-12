# Decisiones técnicas (ADR)

Registro de cada decisión técnica y su porqué. Formato: **Decisión → Contexto → Alternativas → Consecuencias**. Se agrega una entrada nueva por decisión relevante, nunca se edita retroactivamente el razonamiento de una entrada vieja (si una decisión cambia, se agrega una entrada nueva que referencia a la anterior).

---

## ADR-001 — Monorepo con Turborepo + pnpm workspaces

**Decisión:** un solo repo con `apps/web`, `apps/mobile` y `packages/*` compartidos.
**Contexto:** el panel web y la app móvil comparten tipos, esquemas Zod, la máquina de estados y los cálculos geográficos.
**Alternativas:** dos repos separados con un package publicado a un registro privado.
**Consecuencias:** un solo `pnpm install`, un solo CI, cero riesgo de que los tipos compartidos se desincronicen entre repos. Costo: hay que resolver la fricción de pnpm con Metro (ver ADR-004).

## ADR-002 — Next.js 15 + React 19 para el panel, no la versión "latest"

**Decisión:** pinnear `next@15.5.23` / `react@19.1.0` explícitamente, aunque `create-next-app@latest` ya ofrece Next 16.
**Contexto:** PROMPT-MAESTRO §5 fija la versión como decisión tomada; la regla §0.3 prohíbe cambiar de tecnología sin aprobación.
**Consecuencias:** hay que migrar a mano cuando se decida subir de versión, no ocurre solo. Revisar antes de sumar dependencias que asuman Next 16.

## ADR-003 — Expo SDK 57 (la interpretación de "SDK 52+")

**Decisión:** usar el SDK estable más reciente disponible al scaffoldear (57 al 2026-08-11), no fijar en SDK 52.
**Contexto:** el documento pide "SDK 52+" — un piso, no un techo. Dos años después de escrito el documento, SDK 52 está fuera de soporte upstream.
**Consecuencias:** ninguna violación de la regla de "no cambiar tecnologías": el propio documento habilita esto. Si en algún momento se necesita fijar una versión específica por compatibilidad con una librería nativa, documentarlo acá.

## ADR-004 — pnpm con `node-linker=hoisted` para que Expo/Metro no rompa

**Decisión:** `.npmrc` con `node-linker=hoisted` y `shamefully-hoist=true`.
**Contexto:** Metro (bundler de Expo) históricamente no resuelve bien el `node_modules` simlinkeado que pnpm usa por defecto en monorepos — produce errores de "module not found" difíciles de diagnosticar, típicamente descubiertos recién cuando se toca `apps/mobile` en profundidad.
**Alternativas:** dejar el linking estricto de pnpm y configurar `metro.config.js` con `resolver.disableHierarchicalLookup` + watchFolders manuales (más frágil, más mantenimiento).
**Consecuencias:** se resigna parte del aislamiento estricto de dependencias que da pnpm por defecto, a cambio de que Expo funcione sin sorpresas. Se configura desde FASE 1 para no rehacerlo en FASE 7 (mismo principio que EAS).

## ADR-005 — Tailwind CSS v4 (CSS-first), no v3

**Decisión:** `apps/web` usa Tailwind v4; los tokens de diseño de PROMPT-MAESTRO §13 viven en `packages/config/tailwind/tokens.css` (bloque `@theme`), no en un `tailwind.config.js` exportando un objeto JS.
**Contexto:** el documento no fija versión de Tailwind. `create-next-app@15` genera el template `app-tw` con v4 por defecto a esta fecha. v4 es CSS-first: no hay `tailwind.config.js` central para un preset JS compartido de la forma clásica.
**Consecuencias:** el "config compartido" de Tailwind pasa de ser un preset JS a ser un archivo CSS importado (`@import "@fyc/config/tailwind/tokens.css"`). shadcn/ui (FASE 4) soporta v4 sin problema. Si en algún momento se necesita retroceder a v3 (p. ej. por un plugin sin soporte v4), es una decisión a tomar explícitamente, no un default.

## ADR-006 — `roles.ts` vive en `packages/shared`, no en `apps/web/src/lib`

**Decisión:** la fuente única de los roles y sus labels (`ROLES`, `ROLE_LABELS`) vive en `packages/shared/src/constants/roles.ts`.
**Contexto:** PROMPT-MAESTRO §3 dice literalmente que el archivo es `src/lib/constants/roles.ts`, pero también dice que el label debe estar "en un solo lugar" y que un usuario puede tener varios roles "desde el día 1" — y tanto la app móvil como el panel necesitan mostrar esos labels (p. ej. la app del chofer puede mostrar "asignado por Operaciones").
**Consecuencias:** se resuelve la tensión priorizando "un solo lugar" sobre la ruta literal del archivo. `apps/web` importa `ROLE_LABELS` de `@fyc/shared` en vez de duplicarlo. Si el dueño del producto prefiere que viva físicamente en `apps/web/src/lib`, es un cambio de una línea de import — avisar si se prefiere así.

## ADR-007 — Packages de dominio (`state-machine`, `geo`) scaffoldeados como placeholders, no implementados

**Decisión:** en FASE 1, `packages/state-machine` y `packages/geo` solo definen contratos (tipos, firma de funciones) que lanzan error explícito ("no implementado todavía — FASE X") en vez de lógica real, salvo utilidades puras sin decisiones de negocio (`haversineDistanceMeters`).
**Contexto:** regla §0.1 — "NO CONSTRUYAS TODO DE UNA SOLA VEZ". La máquina de estados completa depende del modelo de datos (FASE 2) y la lógica de permisos (FASE 3); el clustering/secuenciación depende de tener paquetes y direcciones reales que rutear (FASE 6).
**Consecuencias:** los packages ya tienen su forma final de import (`@fyc/state-machine`, `@fyc/geo`) y tests que documentan la intención, así que las fases siguientes no tocan la estructura, solo llenan la implementación.

## ADR-008 — Bundle ID / package name de la app móvil son placeholder

**Decisión:** `app.config.ts` usa `com.fyc.mobile` como `ios.bundleIdentifier` y `android.package`.
**Contexto:** no está definido el nombre final de marca/dominio. El package name de Android es **inmutable** una vez publicado en Play Store.
**Pendiente:** confirmar el nombre real antes del primer build de EAS que se vaya a distribuir (no bloquea builds de desarrollo interno).

## ADR-009 — Sin remoto de GitHub todavía

**Decisión:** se agrega `.github/workflows/ci.yml` desde FASE 1 aunque el repo no tiene remoto configurado.
**Contexto:** PROMPT-MAESTRO §14 pide CI "en cada PR" desde FASE 1.
**Consecuencias:** el workflow no corre hasta que exista un repo en GitHub y se haga push. No bloquea el desarrollo local.

## ADR-010 — Tokens de shadcn/ui remapeados a la paleta de §13

**Decisión:** `shadcn init` genera por defecto una escala de grises en oklch (`--background`, `--primary`, etc.) desacoplada de nuestros tokens. Se remapean esas variables para que apunten a `var(--bg)`, `var(--primary)`, `var(--danger)`, etc. de `packages/config/tailwind/tokens.css`, en vez de dejar dos paletas de diseño compitiendo.
**Consecuencias:** los componentes de shadcn (`Button`, etc.) ya salen con el azul `--primary: #2563EB` y los neutros de §13 en vez del gris/negro por defecto. `card`, `popover`, `input`, `ring`, `chart-*` y `sidebar-*` no tienen equivalente directo en §13 — se derivaron de forma razonable (ver el bloque `:root` de `apps/web/src/app/globals.css`) y quedan para ajuste fino en FASE 4. No se implementó un toggle de dark mode manual (clase `.dark`) porque §13 no lo pide para el panel web — el dark/light actual sigue `prefers-color-scheme` vía `tokens.css`; si FASE 4 agrega un selector de tema, ahí se define `.dark { ... }` sobreescribiendo esas mismas variables.

## ADR-011 — `next typegen` antes de `tsc --noEmit` en `apps/web`

**Decisión:** el script `typecheck` de `apps/web` corre `next typegen && tsc --noEmit`, no `tsc --noEmit` solo.
**Contexto:** `tsconfig.json` incluye `.next/types/**/*.ts` (patrón estándar de Next.js), pero esos archivos no existen hasta que se corre `next build` o `next dev` al menos una vez. En un checkout limpio (como CI), `tsc --noEmit` solo fallaba con `TS6053: File not found`.
**Consecuencias:** `pnpm typecheck` funciona en un checkout limpio sin tener que correr un build completo primero. `next typegen` es liviano (solo genera los stubs de tipos de rutas, no compila la app).

## ADR-012 — Vercel: Root Directory `apps/web` (setting del proyecto), framework `nextjs`

**Decisión:** el proyecto de Vercel (`fmcodes-projects/web`) se configuró con Root Directory `apps/web` y framework `nextjs`, y `vercel.json` define `framework: "nextjs"`, `installCommand: pnpm install --frozen-lockfile` y `buildCommand: pnpm --filter @fyc/web build`. El setup original (Root Directory `.` + `framework: null` + `outputDirectory: apps/web/.next`) **NUNCA sirvió el app**: `.next` es el directorio de build de Next (artefactos de servidor), no un output estático servible — con `framework: null` + `outputDirectory`, Vercel lo sirve como archivos estáticos y devuelve 404 (verificado en el deploy de FASE 3: root y `/api/*` → 404 de plataforma con `X-Vercel-Error`). El build "funcionaba" pero el deploy estaba vacío de contenido útil.
**Contexto (corrección, FASE 3):** `rootDirectory` **no existe como propiedad de `vercel.json`** (el schema lo rechaza: "should NOT have additional property `rootDirectory`"), contrario a lo que intenté documentar primero — es un setting del proyecto que se setea por API (`PATCH /v9/projects/{id}` con `{ "rootDirectory": "apps/web" }`) o desde el dashboard. Con Root Directory `apps/web` + framework `nextjs`, Vercel detecta Next.js en el app, corre `pnpm install` en la raíz del monorepo (detección automática de workspace pnpm) y el Next Builder genera el output serverless correcto en `/vercel/output` (rutas API, middleware y páginas).
**Consecuencias:** `vercel.json` queda `{ "framework": "nextjs", "installCommand": "pnpm install --frozen-lockfile", "buildCommand": "pnpm --filter @fyc/web build" }` (sin `outputDirectory` ni `rootDirectory`); el Root Directory del proyecto es `apps/web`. El buildCommand corre con cwd = `apps/web` y el filter del workspace se resuelve igual.

## ADR-013 — Dónde vive el schema de base de datos, y por qué no en `packages/`

**Decisión:** Drizzle (schema + cliente + migraciones runner) vive en `apps/web/src/lib/db/`, no en un `packages/db` nuevo.
**Contexto:** `packages/shared` es consumido por `apps/mobile` también, y `pg` (el driver de Postgres) es una dependencia de Node que no funciona en React Native/Expo — meterlo en un package compartido rompería el bundling de Metro. Solo `apps/web` (el backend monolito modular, §5) habla directo con Postgres; `apps/mobile` habla con Supabase vía su SDK cliente (anon key + RLS), nunca con Drizzle.
**Consecuencias:** las migraciones SQL sí siguen la estructura del documento (`supabase/migrations/`, configurado como `out` en `drizzle.config.ts`) aunque el _schema_ TypeScript no viva en `supabase/`. Si en el futuro un segundo servicio necesita el mismo schema (p. ej. el microservicio de OR-Tools de FASE 7 opcional), se evalúa extraerlo a un package recién ahí.

## ADR-014 — Los enums de Postgres son copias literales, no imports de `@fyc/state-machine`/`@fyc/shared`

**Decisión:** `apps/web/src/lib/db/schema/enums.ts` define `PACKAGE_STATUSES_MIRROR` y `ROLES_MIRROR` como arrays literales en vez de importar `PACKAGE_STATUSES`/`ROLES` de los packages compartidos.
**Contexto:** `drizzle-kit generate` bundlea `drizzle.config.ts` con su propio loader (basado en `@esbuild-kit/*`, dependencias marcadas deprecated). Ese loader no interopera bien con paquetes del workspace pnpm cuyo `exports` apunta a un archivo `.ts` fuente: la importación se resuelve a `undefined` en tiempo de `drizzle-kit generate` (con `tsx`, `vitest` o Next.js el mismo import funciona perfecto — es específico del bundler de `drizzle-kit`).
**Mitigación:** `apps/web/src/lib/db/schema/__tests__/enums-sync.test.ts` importa la fuente de verdad real y compara contra los mirrors — si alguien cambia un estado o un rol y se olvida de actualizar el mirror, el test falla en CI. No es la solución ideal (preferiría un solo lugar), pero es segura y detectable.

## ADR-015 — RLS: alcance real vs. matiz pendiente para FASE 3

**Decisión:** las políticas RLS de `0002_rls_policies.sql` implementan aislamiento por `org_id` + rol para las 21 tablas de negocio, con dos simplificaciones deliberadas respecto a la letra exacta de §7:

1. **"Rutas del chofer del día en curso"** → se implementó solo "rutas asignadas a mí" (`assigned_driver_id = auth.uid()`), sin filtrar por fecha. Motivo: la operación se crea DÍA -1 pero la ruta sale DÍA 0 (§1) — no está definido en el documento si "el día en curso" para efectos de RLS es la fecha de la operación o la fecha real del calendario, y una condición de fecha mal calibrada puede dejar a un chofer sin ver su propia ruta la mañana de reparto. Se prefirió la garantía más fuerte y siempre correcta ("nunca ve rutas de otro chofer") sobre la más precisa pero arriesgada.
2. **`support_tickets.category/status/priority`** — el documento no define los valores del enum (§20 no lo lista, pero es del mismo tipo de vacío). Se usó un set mínimo razonable (ver `enums.ts`), a confirmar con el dueño del producto.

**Pendiente explícito para FASE 3** ("Auth con Supabase + middleware de roles y permisos"): afinar el matiz de fecha, y sobre todo — **la conexión de `apps/web` a Postgres usa `DATABASE_URL` directa como usuario `postgres`**, que bypassea RLS por completo (es superusuario, no `authenticated`/`anon`/`service_role`). Esto es intencional y estándar (así corren las migraciones y correrán las Route Handlers del backend), pero significa que **RLS no protege nada si el bug está en el propio backend** — la única protección real ahí es el middleware de permisos de FASE 3. RLS sí es la protección real para accesos directos desde el cliente (p. ej. la app del chofer consultando Supabase directo con su JWT, sin pasar por el backend de Next.js). No confundir "tiene RLS" con "está protegido en todos los casos".

## ADR-016 — `events`: `service_role` conserva UPDATE/DELETE, `authenticated`/`anon` no

**Decisión:** el REVOKE de UPDATE/DELETE sobre `events` (§3, §7 — "revocar UPDATE/DELETE para todos los roles de aplicación") se aplicó explícitamente a `authenticated` y `anon`, no a `service_role` ni a `postgres`.
**Contexto:** revocarlo de `service_role`/`postgres` no es técnicamente posible de forma útil sin romper migraciones y sin impedir que el propio backend (que necesariamente corre con una conexión privilegiada) pueda operar. La garantía real de inmutabilidad para esos roles es: (a) el trigger `forbid_events_mutation` en la propia tabla, que revienta con excepción ante cualquier UPDATE/DELETE **sin importar el rol** (incluido `postgres`), y (b) la convención de código: ningún módulo de la app debe emitir un UPDATE/DELETE contra `events` — se audita en code review, no solo en la base.
**Consecuencias:** la tabla es append-only de verdad (el trigger no distingue rol), pero quien conecte directo como `postgres` con un cliente SQL fuera de la app **podría** desactivar el trigger y romper la regla — eso ya es fuera del modelo de amenazas de RLS (acceso directo a la base con la contraseña de Postgres es "las llaves del reino").

## ADR-017 — `DATABASE_URL` usa el Session Pooler, no la conexión directa

**Decisión:** `DATABASE_URL` apunta a `aws-0-sa-east-1.pooler.supabase.com:5432` con usuario `postgres.<project-ref>` (Session Pooler de Supavisor), no a `db.<project-ref>.supabase.co:5432` (conexión directa).
**Contexto:** la conexión directa de Supabase es **IPv6-only**. Este entorno de desarrollo no tiene salida IPv6 (`ENETUNREACH` al intentar conectar al AAAA resuelto) — se manifestó como fallos intermitentes y confusos de DNS (`getaddrinfo ENOENT`) en `pg`, `nslookup` y `ping` por igual, mientras que HTTPS (que resuelve por A/IPv4) funcionaba sin problema. El Session Pooler de Supabase sí tiene registro A (IPv4) y se comporta como una conexión directa normal (una conexión de backend dedicada por sesión, compatible con prepared statements, DDL, `SET`, etc.) — a diferencia del Transaction Pooler (puerto 6543), que rompe prepared statements y no sirve para correr migraciones.
**Consecuencias:** si en algún momento se despliega en un entorno con salida IPv6 confirmada (muchos hosting de contenedores no la tienen por defecto), esto igual sigue funcionando — el Session Pooler no es exclusivo de entornos sin IPv6. Vale la pena chequear esto primero si alguna vez un `pnpm db:migrate`/`db:seed`/`pnpm test` empieza a tirar errores de DNS sin razón aparente.

## ADR-018 — El seed es TypeScript (`apps/web/src/lib/db/seed/`), no `supabase/seed.sql`

**Decisión:** `supabase/seed.sql` queda como puntero/documentación; el seed real corre con `pnpm db:seed` desde `apps/web`.
**Contexto:** crear los 4 usuarios de prueba (§14, FASE 2) necesita `supabase.auth.admin.createUser()` — la API de administración de Supabase Auth, no algo expresable en SQL plano. Un `.sql` no puede crear un usuario de `auth.users` con contraseña utilizable para loguearse.
**Consecuencias:** mismo patrón que ADR-013 (Drizzle vive en `apps/web`, no en `supabase/`) — `supabase/` queda para lo que es genuinamente SQL portable (migraciones), y la orquestación que necesita llamar APIs vive donde ya está el resto del backend.

## ADR-019 — La máquina de estados es la única escritora de `packages.status` (single-writer)

**Decisión:** ningún módulo escribe `packages.status` directamente. Todo cambio de estado pasa por `runPackageTransition` (el service de `apps/web`) que: valida roles → calcula la transición con el package `@fyc/state-machine` → ejecuta UPDATE de `packages` + INSERT de `events` **en la misma transacción**. Los únicos writes de status fuera de ella son el seed (estado inicial) y datos de carga masiva a futuro (FASE 9).
**Contexto:** FASE 3 definió el middleware de permisos. Para que ese middleware sea la autorización real (ADR-015: el backend bypasea RLS), cada mutación debe pasar por un punto único auditable; si cada handler pudiera hacer `UPDATE packages SET status=...`, los permisos de transición no se podrían garantizar.
**Consecuencias:** todo endpoint de mutación de status escribe a través del servicio; el dominio sigue viviendo en `packages/state-machine` (reglas + excepciones `IllegalTransitionError`/`ForbiddenTransitionError`/`PreconditionFailedError`) y `apps/web` solo lo orquesta contra la base. Los tests de integración de `state-machine.test.ts` prueban el rollback real (estado y evento se revierten juntos cuando la transición falla).

## ADR-020 — `events` es append-only también desde el backend: trigger + convención de código

**Decisión:** la inmutabilidad de `events` se garantiza con la combinación de: (a) el trigger `events_forbid_delete` sobre la tabla (revienta ante cualquier UPDATE/DELETE **sin importar el rol**, ver ADR-016) y (b) la convención de que **ningún módulo de la app emite UPDATE/DELETE contra `events`** — se audita en code review. El único `DELETE FROM events` del código vive en tests de integración, y corre con el trigger deshabilitado a propósito (`ALTER TABLE ... DISABLE TRIGGER`) para poder limpiar la base de prueba.
**Contexto:** en FASE 3 el test de integración de la máquina de estados confirmó que el trigger realmente bloquea el borrado; si el test intentara borrar eventos sin deshabilitarlo primero, fallaría.
**Consecuencias:** la limpieza de datos de prueba requiere deshabilitar el trigger en `afterAll`; hay que re-habilitarlo siempre, aunque el test falle (se hace en el mismo `finally`/`afterAll`, nunca con `try/catch` que lo deje desactivado).

## ADR-021 — Sesión del panel es client-side (supabase-js + Bearer), no SSR

**Decisión:** el panel autentica con `@supabase/supabase-js` en el browser (sesión en localStorage) y cada request del cliente adjunta `Authorization: Bearer <JWT>`. El middleware de `/api/*` valida el JWT como en mobile. NO hay cookies de sesión ni auth SSR con server components.
**Contexto:** FASE 4 necesitaba login y CRUD del panel. El middleware de `apps/web/src/middleware.ts` ya valida el JWT para toda `/api/*`; reutilizar ese camino para la sesión del panel es lo que menos superficie nueva agrega, y el modelo de roles se resuelve igual en el handler (`requireUser`/`requireRole`) leyendo `users`/`user_roles` por `x-fyc-user-id`.
**Alternativas:** cookies httpOnly + SSR auth (`@supabase/ssr`). Más trabajo de integración (rewrite de rutas, refresh de sesión en server) y duplica el mecanismo de auth con el que ya funciona mobile.
**Consecuencias:** el primer render de las páginas del panel no conoce la sesión (flash controlado por el app shell con estado `loading`); toda mutación pasa por la API (no hay writes directos desde server components). Si en una fase futura se necesita SSR real (p. ej. SEO, metadatos por rol), es una decisión nueva que referencia a esta.

## ADR-022 — Los CRUD del panel también usan soft delete (regla global)

**Decisión:** `users`, `vehicles`, `clients` y `containers` no se borran físicamente: el `DELETE` de la API setea `deleted_at` (y `is_active=false` para usuarios, lo que además rompe el login). Los listados filtran `deleted_at IS NULL` siempre.
**Contexto:** la regla global "nunca borrado físico, siempre soft delete" (documentada para `events` en ADR-020) se extiende a los datos maestros del panel: un usuario/vehículo/cliente dado de baja sigue existiendo para auditoría y reportes.
**Alternativas:** borrado físico con cascada. Perdería trazabilidad y complicaría los reportes históricos de FASE 12/13.
**Consecuencias:** el listado de usuarios para el form de vehículos (`/api/users?role=driver`) excluye usuarios soft-deleted (dejan de poder ser chofer asignado); no hay UI de "reactivar" todavía (queda para FASE 4+ si el producto lo pide).

## ADR-023 — Base UI 1.7 como base del design system del panel (no shadcn/ui/Radix)

**Decisión:** las primitivas del panel (`components/ui/*`) están construidas sobre `@base-ui/react` 1.7 (pinned), con el mismo API de composición que shadcn/ui (trigger/portal/popup/title/close) pero respetando las convenciones de Base UI: `Dialog` (no `Modal`), `AlertDialog`, `Menu`, y el prop `render` para polimorfismo (no existe `asChild`/`Slot` como en Radix).
**Contexto:** ADR-005 decía "shadcn/ui (FASE 4) soporta v4 sin problema", pero al implementar FASE 4 el generador shadcn actual asume Radix y expone un `asChild` (`@radix-ui/react-slot`) que no existe en Base UI — el template generado tenía componentes rotos al typecheckear. En vez de parchear cada primitiva con un Slot propio, se fijó la decisión en Base UI nativo (mantiene el patrón de autoría que ya conocíamos de shadcn).
**Consecuencias:** no hay `asChild`; para enlazar un botón se usa `render={<Link .../>}`. Cualquier snippet de shadcn que se copie hay que traducirlo a Base UI (más simple de lo que parece: mismas partes, otros nombres). Si mañana se necesita una primitiva que Base UI no cubre, se agrega sobre la misma base en vez de mezclar bibliotecas.

## ADR-024 — Alta de usuarios requiere `SUPABASE_SERVICE_ROLE_KEY` en el entorno

**Decisión:** `POST /api/users` (y el `PATCH` de email) crean/actualizan el usuario en Supabase Auth con el service role (`apps/web/src/lib/supabase/admin.ts`). Esto requiere `SUPABASE_SERVICE_ROLE_KEY` en el runtime.
**Contexto:** el `id` del perfil en `users` ES `auth.users.id`; no existe el usuario sin crearlo primero en Auth. La key de service role bypasea RLS a propósito (mismo principio que ADR-015).
**Consecuencias:** local funciona (la key está en `.env`). **Pendiente en producción:** agregar `SUPABASE_SERVICE_ROLE_KEY` a las env vars de Vercel — hasta entonces `POST /api/users` fallará con un error claro de configuración. La key nunca se expone al browser (solo `NEXT_PUBLIC_*` llega al cliente).

## ADR-025 — `SUPABASE_SERVICE_ROLE_KEY` resuelta en Production; Preview/Development sin ninguna env var

**Decisión:** se agregó `SUPABASE_SERVICE_ROLE_KEY` a Vercel Production (resolviendo el pendiente de ADR-024), verificado de punta a punta (login real + `POST /api/users` con 201 + soft delete + cleanup) el 2026-08-11. **No** se agregaron las env vars a Preview ni Development — ese entorno no tiene ninguna var configurada, ni siquiera las públicas.
**Contexto:** `vercel env pull` **enmascara los valores de vars sensibles como `""`** — un chequeo por `pull` da falsos negativos/positivos sobre si el _valor_ es correcto, solo confirma que la _var existe_. Verificar el valor real requiere un smoke test end-to-end (login + una llamada que la use), no basta con `env ls` ni `env pull`. Separado: el harness de la sesión que dejó este ADR bloqueó el intento de agregar las vars a Preview/Development vía `vercel env add` (clasificador de modo automático — no permite modificar configuración de servicios externos por CLI sin aprobación explícita del dueño del proyecto).
**Consecuencias:** cualquier deploy de Preview (un PR, una rama que no sea `main`) va a romper el build hasta que alguien con permiso corra `vercel env add <VAR> preview --value "..." --scope fmcodes-projects --yes` para las 4 vars core (ver comandos exactos en `PROMPT-CONTINUACION.md` §3). No bloquea el trabajo en `main`/producción.

## ADR-026 — "Manifiesto" se modela como `packages` pre-creados, no una tabla aparte

**Decisión:** no existe una tabla `manifest_imports`. El adapter MANIFEST de la cascada (§2) es, en términos de datos, el mismo lookup que "¿este código de scan coincide con el `trackingCode` de un paquete que ya existe en esta operación?" — el importador CSV (`POST /api/operations/:id/import`) simplemente pre-crea filas de `packages` en `PENDIENTE_RESOLUCION`, con o sin dirección según lo que traía la columna mapeada.
**Contexto:** el modelo de datos de §7 no tiene una tabla de manifiesto separada — `packages` ya tiene `tracking_code`. Agregar una tabla intermedia solo para "recordar qué se importó" sería duplicar el mismo dato dos veces sin necesidad.
**Consecuencias:** identidad (§2) y destino quedan unificados en una sola fila desde el principio — el escaneo físico solo _completa_ un paquete que puede (o no) ya existir. Esto exigió agregar `packages.from_manifest` (ver ADR-028) para poder distinguir en el cierre "vino del manifiesto" de "apareció al escanear".

## ADR-027 — `scanPackage()` no anida `db.transaction()` dentro de `runPackageTransition()`

**Decisión:** `scanPackage` escribe paquete+scan en su propia transacción; la transición de estado (que abre su propia `db.transaction()` en `state-machine.ts`, con `SELECT ... FOR UPDATE`) se ejecuta DESPUÉS, fuera de esa transacción.
**Contexto:** Drizzle con `node-postgres` no soporta anidar `db.transaction()` dentro de otro `db.transaction()` reutilizando la misma conexión si se llama a través del objeto `db` global — cada llamada a `db.transaction()` toma una conexión nueva del pool. Anidarlas así hubiera causado que la transacción interna (`SELECT ... FOR UPDATE` sobre `packages.id`) esperara el lock de fila que la transacción externa todavía tiene abierto en una conexión distinta → **deadlock/timeout garantizado** en cualquier escaneo que resuelva la dirección.
**Consecuencias:** si el paso de transición falla después de haber guardado la dirección (poco probable, pero posible), el paquete queda con los datos completos pero todavía en `PENDIENTE_RESOLUCION` — no es una corrupción, es un estado recuperable (se puede reintentar el escaneo, que ahora sí encuentra el manifiesto con dirección y transiciona). Documentado también como comentario largo en `ingestion.ts`.

## ADR-028 — Dos columnas nuevas: `clients.code_prefix` y `packages.from_manifest`

**Decisión:** migraciones `0005` y `0006` agregan `clients.code_prefix` (texto, opcional) y `packages.from_manifest` (boolean, default `false`).
**Contexto:** §9.1 pide dos comportamientos que no eran computables con el schema de FASE 2: "detectar por prefijo del código" (paquete de otro cliente) necesita saber qué prefijo usa cada cliente; "reporte de faltantes/sobrantes" al cerrar necesita saber si un paquete vino del manifiesto importado o apareció al escanear sin estar declarado — sin un campo explícito, esto no se puede reconstruir de forma confiable después del hecho (ver alternativas descartadas más abajo).
**Alternativas descartadas:** inferir "vino del manifiesto" comparando `packages.created_at` contra el primer `package_scans.scanned_at` (con tolerancia de unos segundos) — funciona la mayoría de las veces pero es frágil (un import lento o un reloj desincronizado lo rompe) y no es más simple que una columna.
**Consecuencias:** ninguna migración de datos necesaria (`DEFAULT false` es correcto para todo lo que ya existía, que no vino de un manifiesto importado por este mecanismo).

## ADR-029 — OCR de etiqueta: interfaz lista, implementación deferred a FASE 8

**Decisión:** `resolveDestination()` reconoce el caso "hay foto pero no hay payload parseable" y lo deja caer a MANUAL en vez de simular un resultado de OCR falso.
**Contexto:** el OCR real (§5: ML Kit on-device en `apps/mobile`, con Google Vision como fallback opcional) necesita una app con cámara — no existe todavía (FASE 8). Implementar un "OCR" en el backend web ahora mismo no tendría de dónde sacar la foto de forma realista (no hay flujo de captura), así que hubiera sido simular una funcionalidad que en los hechos no puede correr.
**Consecuencias:** hoy, si un escaneo trae `photoUrl` pero el código no es parseable, va directo a la bandeja de resolución con la foto ya adjunta para que un humano la mire — funcionalmente correcto (§2: "si nada resuelve, entra igual"), solo que el paso automático de OCR todavía no está. Cuando FASE 8 exista, se agrega el llamado real acá sin tocar el resto de la cascada.

## ADR-030 — Geocoding en lote: síncrono, degrada a FAILED sin la API key

**Decisión:** `POST /api/operations/:id/geocode` procesa todos los paquetes `RECIBIDO` de la operación en el mismo request-response (sin cola de jobs). Sin `GOOGLE_GEOCODING_API_KEY` configurada (no lo está todavía, ver `.env`), cada geocoding no cacheado devuelve `accuracy: FAILED, source: not_configured` en vez de tirar una excepción.
**Contexto:** §17 marca "sobreingeniería que retrasa la salida a producción" como riesgo — a 120 paquetes/día un loop síncrono con caché agresivo (§5) resuelve esto sin necesitar una cola. §16 pide explícitamente que un fallo de geocoding no rompa el flujo, solo saque al paquete del ruteo.
**Consecuencias:** hasta que se consiga la API key, `pnpm test`/uso real de este endpoint deja todo en `FAILED` — es el comportamiento esperado y testeado (`geocoding.test.ts`), no un bug. El día que haya volumen que lo justifique (§17), pasar esto a un job en la tabla de jobs de Postgres (sin Redis, §5) es un cambio acotado a `geocodeOperationPackages()`.

## ADR-031 — El mapeo de columnas del CSV es 100% cliente; el backend recibe filas ya normalizadas

**Decisión:** `POST /api/operations/:id/import` espera `{ rows: [{ trackingCode, ... }] }` — no un archivo CSV ni texto crudo.
**Contexto:** §2 pide "mapeo de columnas configurable por el usuario en pantalla (arrastrar columna origen → campo destino)" — es una interacción de UI, no de negocio. Parsear CSV/XLSX y dejar que el usuario arrastre columnas es responsabilidad natural del cliente (browser); el backend no necesita saber que el origen fue un Excel.
**Consecuencias:** el backend queda desacoplado del formato de archivo — funciona igual si el mapeo lo hace un uploader de CSV, uno de XLSX, o alguien pegando texto a mano (que es lo que hace la UI mínima de FASE 5, ver ADR-032). La UI de mapeo visual "arrastrar columna" en sí (XLSX con `sheetjs` o similar, drag&drop) queda pendiente para el rediseño de FASE 5-UI/PROMPT-FRONTEND-V2 — hoy `/deposito` importa pegando líneas `código,destinatario,teléfono,dirección` a mano, funcional pero no es la interacción final.

## ADR-032 — Tests de integración: `session_replication_role` en vez de `DISABLE TRIGGER`, y archivos en serie

**Decisión:** el helper `purgeTestEvents()` (`apps/web/src/lib/db/test-helpers.ts`) usa `SET LOCAL session_replication_role = replica` dentro de una transacción para poder borrar los `events` de test, reemplazando el patrón anterior de `ALTER TABLE events DISABLE/ENABLE TRIGGER`. Además, `vitest.config.ts` corre los archivos de test en serie (`fileParallelism: false`) con `testTimeout: 20000`.
**Contexto:** dos problemas reales encontrados al sumar más suites de integración en FASE 5 (antes solo había 4-5 archivos, ahora 9):

1. `ALTER TABLE ... DISABLE TRIGGER` es un cambio **global** al catálogo de Postgres (afecta a todas las conexiones, no solo a la que lo ejecuta). Con varios archivos de test corriendo en paralelo (workers/forks distintos) contra la misma base, la ventana en la que un archivo tiene el trigger deshabilitado para su propio cleanup podía coincidir con el momento en que OTRO archivo verificaba "nadie puede hacer DELETE sobre events" — falso negativo intermitente, no relacionado con el código de esa fase.
2. El Session Pooler de Supabase tiene un límite de conexiones concurrentes chico (ver ADR-017). Con 9 archivos abriendo cada uno su propio pool de `pg` en paralelo, se agotaban las conexiones disponibles y las queries quedaban esperando hasta el timeout — no eran tests flaky, era contención real de un recurso compartido y finito.
   **Consecuencias:** `session_replication_role` es una GUC de **sesión**, y `LOCAL` la limita a la transacción actual en la conexión que Drizzle reserva para ella — ninguna otra conexión la ve nunca, cero carrera posible. Correr los archivos en serie es más lento (~30-40s el total en vez de ~10s) pero determinístico; con el volumen de tests que hay hoy es un costo aceptable. Si la suite crece mucho más, la alternativa es un pool de Postgres más grande (plan pago de Supabase) en vez de paralelizar de nuevo.

## ADR-033 — Ubicación del depósito: `organizations.settings.depot` con fallback a `DEFAULT_DEPOT_LAT`/`DEFAULT_DEPOT_LNG`, sin default inventado

**Decisión:** `resolveDepotLocation(orgId)` (`lib/services/route-planning.ts`) busca primero `organizations.settings.depot = {lat, lng}`; si no está, cae a las env vars `DEFAULT_DEPOT_LAT`/`DEFAULT_DEPOT_LNG`; si ninguna está configurada, tira `VALIDATION_ERROR` explícito en vez de asumir una coordenada.
**Contexto:** §7 no modela una columna dedicada para la ubicación del depósito, y es un dato de negocio real (dónde arranca físicamente cada ruta, §9.2) que el documento madre no fija — no está en la lista de §20 pero es de la misma naturaleza ("no inventar datos de negocio", regla de §0). `.env` ya tenía `DEFAULT_DEPOT_LAT`/`DEFAULT_DEPOT_LNG` declaradas (vacías) desde una sesión anterior, señal de que ya se había anticipado el problema sin resolverlo.
**Consecuencias:** `generateRouteProposal()`/`resequenceRoute()` fallan alto y claro ("configurá esto antes de generar rutas") en vez de rutear silenciosamente desde una coordenada inventada que rompería la propuesta sin que nadie note por qué. Falta cargar el valor real: pedírselo a Fede (dirección exacta del depósito, §20) y setearlo en `organizations.settings` o `.env` antes de usar `/ruteo` en serio — los tests de integración lo setean vía `process.env` para no bloquear el desarrollo mientras tanto.

## ADR-034 — Clustering: capacidades heterogéneas por vehículo, outliers minPts=1, un solo pase de refinamiento de frontera

**Decisión:** `clusterPackages()` (`@fyc/geo`) recibe `capacities: number[]` (una por vehículo, no una capacidad uniforme) y hace la asignación capacitada procesando los puntos del más "decidido" (menor distancia a su mejor centroide) al más disputado. Los outliers (§8: "aislados a >5 km") se detectan con DBSCAN simplificado a `minPts=1` — un punto es outlier si NINGÚN otro punto del conjunto completo está a `outlierDistanceM` (default 5000) o menos. El refinamiento de frontera post-convergencia es una sola pasada (no iterativo hasta punto fijo).
**Contexto:** §8 pide "restricción dura: ningún cluster supera la capacidad del vehículo" y "restricción blanda: balancear ±15%" — los vehículos reales tienen capacidades distintas (`vehicles.capacity_packages`), así que un solo número no alcanza. `minPts=1` es a propósito más permisivo que un DBSCAN clásico (`minPts` típicamente 3-5): con `minPts>1`, dos direcciones vecinas y solas (sin nada más cerca) quedarían marcadas outlier aunque se puedan rutear juntas sin problema — el objetivo de §8 es detectar puntos verdaderamente aislados, no pares.
**Consecuencias:** el balance ±15% de §8 es un objetivo, no una restricción dura verificada por código — con capacidades ya heterogéneas por vehículo, forzar además un balance porcentual estricto podía generar clusters vacíos o inviables en escenarios de prueba con pocos vehículos. La pasada única de refinamiento (en vez de iterar a punto fijo) acota el tiempo de ejecución y es suficiente para el volumen de §17 (~120 paquetes/día); si hace falta más compacidad, es una mejora futura acotada a esa función, con tests (`packages/geo/src/__tests__/index.test.ts`) que ya cubren el caso de capacidad forzada chica.

## ADR-035 — `route_matrix_cache`: mismo patrón que `geocode_cache`, degrada a estimación con factor de calles

**Decisión:** tabla nueva `route_matrix_cache` (migración `0007`), sin `org_id` (se comparte entre orgs, igual que `geocode_cache`), clave = hash SHA-256 del par de coordenadas redondeadas a 5 decimales (~1m). Sin `GOOGLE_ROUTES_API_KEY` configurada (no lo está, ver `.env`), `getDistanceMatrix()` devuelve `estimated: true` con `distanciaHaversine × 1.3` (factor empírico calle-real/línea-recta para AMBA) y una duración asumida a 25 km/h — nunca tira excepción ni escribe caché con datos inventados.
**Contexto:** §8 etapa 2 pide "matriz de distancias/tiempos REALES por calle (Google Routes API) (...) cacheada agresivamente". Mismo problema que ADR-030 (geocoding): la API paga no está configurada todavía, y el sistema tiene que poder desarrollarse/probarse igual.
**Consecuencias:** mientras no haya `GOOGLE_ROUTES_API_KEY`, toda la secuenciación (`sequenceRoute` alimentado por esta matriz) usa la estimación degradada — funcionalmente correcta para probar el flujo end-to-end (clustering → secuencia → rutas → aprobar → etiquetas, ver `route-planning.test.ts`), pero las distancias/tiempos reales de producción van a ser distintos hasta que se cargue la key. El caché solo se escribe con resultados reales de Google (nunca con estimaciones), así que no hay riesgo de "cachear una mentira" que sobreviva a cuando se configure la key.

## ADR-036 — Reasignar un paquete re-secuencia la ruta completa (no un ajuste incremental)

**Decisión:** `reassignPackageRoute()` mueve el paquete y llama a `resequenceRoute()` sobre AMBAS rutas afectadas — que borra todos los `route_stops` de esa ruta y los vuelve a generar corriendo `sequenceRoute()` de nuevo sobre el conjunto completo de paquetes de la ruta (pidiendo la matriz real de nuevo, ya cacheada en su mayoría por ADR-035).
**Contexto:** §8 etapa 3 pide "arrastrar un paquete de una ruta a otra → recalcula en vivo distancia, tiempo y balance". La alternativa (insertar el paquete en la posición óptima local sin re-secuenciar todo) es más barata pero puede dejar una secuencia sub-óptima acumulando ajustes; a la escala de §17 (~40 paradas por ruta) re-secuenciar completo es instantáneo y siempre da el mejor resultado con el estado actual.
**Consecuencias:** cada reasignación paga un round-trip de matriz de distancias (mayormente cacheado) por cada una de las dos rutas — aceptable para ajustes manuales ocasionales del dispatcher, no para un loop de arrastrar-muchos-paquetes-rápido; si el patrón de uso real resulta ser eso, vale la pena un ajuste incremental más barato como mejora futura, acotada a `resequenceRoute()`.

## ADR-037 — Etiquetas: `pdf-lib` + `qrcode`, sin fuentes de marca todavía

**Decisión:** `lib/services/labels.ts` genera el PDF con `pdf-lib` (sin dependencias nativas, corre bien en el runtime de Vercel) y el QR interno con el paquete `qrcode`. Fuentes: las estándar de PDF (Helvetica/Helvetica-Bold/Courier), no Archivo/JetBrains Mono del design system. Layout: térmica = una página de 100×150mm por bulto; A4 = grilla 2×2 (el documento madre no especifica el layout exacto de A4, solo el tamaño de hoja "A4 autoadhesiva").
**Contexto:** §9.2 fija el contenido y tamaño de la térmica con precisión pero no el layout de A4 ("autoadhesiva" implica una grilla de etiquetas recortables, sin especificar cuántas por hoja). El QR debe ser SIEMPRE `packages.internal_code` (§9.2: "así el sistema controla qué significa cada código"), nunca `tracking_code`.
**Consecuencias:** el PDF es funcionalmente correcto y pasa el criterio de aceptación de §14 FASE 6 ("imprimir las etiquetas"), pero visualmente no usa el design system del panel todavía — no hace falta: es un documento impreso, no una pantalla, y no está en el alcance de PROMPT-FRONTEND-V2 (que es sobre el panel web). Si en algún momento se quiere una fuente de marca en la etiqueta impresa, es agregar el embed de la fuente TTF a `pdf-lib` en `labels.ts`, cambio acotado.

## ADR-038 — Aprobar una ruta requiere admin/dispatcher, aunque la transición de estado permite `warehouse`

**Decisión:** `POST /api/routes/:id/approve` exige rol `admin` o `dispatcher` (`requireRole`), más restrictivo que la transición `GEOCODIFICADO → ASIGNADO` de `@fyc/state-machine`, que declara `STAFF` (incluye `warehouse`).
**Contexto:** el botón "Aprobar" de §8 etapa 3 congela `bulk_number` y habilita imprimir — una decisión operativa/de supervisión, no una tarea de depósito. Mismo criterio ya aplicado a `closeOperation` en FASE 5 (admin/dispatcher, no warehouse) — se mantiene la consistencia entre "cerrar algo que ya no se puede deshacer fácil" en todo el sistema.
**Consecuencias:** la máquina de estados en sí sigue permitiendo que un `warehouse` haga la transición si se la invoca por otro camino (es una capacidad general del estado, no específica de esta ruta HTTP) — la restricción vive en el endpoint, no en el dominio. Si en algún momento se decide que warehouse también puede aprobar rutas, es cambiar un array en un solo archivo.
