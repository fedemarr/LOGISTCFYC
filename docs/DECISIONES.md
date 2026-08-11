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
**Consecuencias:** el "config compartido" de Tailwind pasa de ser un preset JS a ser un archivo CSS importado (`@import "@lastmile/config/tailwind/tokens.css"`). shadcn/ui (FASE 4) soporta v4 sin problema. Si en algún momento se necesita retroceder a v3 (p. ej. por un plugin sin soporte v4), es una decisión a tomar explícitamente, no un default.

## ADR-006 — `roles.ts` vive en `packages/shared`, no en `apps/web/src/lib`

**Decisión:** la fuente única de los roles y sus labels (`ROLES`, `ROLE_LABELS`) vive en `packages/shared/src/constants/roles.ts`.
**Contexto:** PROMPT-MAESTRO §3 dice literalmente que el archivo es `src/lib/constants/roles.ts`, pero también dice que el label debe estar "en un solo lugar" y que un usuario puede tener varios roles "desde el día 1" — y tanto la app móvil como el panel necesitan mostrar esos labels (p. ej. la app del chofer puede mostrar "asignado por Operaciones").
**Consecuencias:** se resuelve la tensión priorizando "un solo lugar" sobre la ruta literal del archivo. `apps/web` importa `ROLE_LABELS` de `@lastmile/shared` en vez de duplicarlo. Si el dueño del producto prefiere que viva físicamente en `apps/web/src/lib`, es un cambio de una línea de import — avisar si se prefiere así.

## ADR-007 — Packages de dominio (`state-machine`, `geo`) scaffoldeados como placeholders, no implementados

**Decisión:** en FASE 1, `packages/state-machine` y `packages/geo` solo definen contratos (tipos, firma de funciones) que lanzan error explícito ("no implementado todavía — FASE X") en vez de lógica real, salvo utilidades puras sin decisiones de negocio (`haversineDistanceMeters`).
**Contexto:** regla §0.1 — "NO CONSTRUYAS TODO DE UNA SOLA VEZ". La máquina de estados completa depende del modelo de datos (FASE 2) y la lógica de permisos (FASE 3); el clustering/secuenciación depende de tener paquetes y direcciones reales que rutear (FASE 6).
**Consecuencias:** los packages ya tienen su forma final de import (`@lastmile/state-machine`, `@lastmile/geo`) y tests que documentan la intención, así que las fases siguientes no tocan la estructura, solo llenan la implementación.

## ADR-008 — Bundle ID / package name de la app móvil son placeholder

**Decisión:** `app.config.ts` usa `com.lastmile.mobile` como `ios.bundleIdentifier` y `android.package`.
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

## ADR-012 — Vercel: Root Directory queda en la raíz del repo, no en `apps/web`

**Decisión:** el proyecto de Vercel (`fmcodes-projects/web`) se linkeó con Root Directory `.` (la raíz del monorepo) y `vercel.json` define `installCommand: pnpm install --frozen-lockfile`, `buildCommand: pnpm --filter @lastmile/web build`, `outputDirectory: apps/web/.next` y `framework: null`.
**Contexto:** el patrón "recomendado" por Vercel para monorepos es fijar Root Directory en `apps/web` desde el dashboard (checkbox "Include files outside of the Root Directory" para que igual vea `packages/*`). Ese ajuste es **dashboard-only**, no existe flag de CLI ni de `vercel.json` para setearlo, y este entorno no tiene acceso interactivo al dashboard ni un token de API extraíble de forma segura para hacerlo vía API. Con Root Directory en la raíz, la detección automática de framework de Vercel busca `"next"` en el `package.json` de la raíz (que no lo tiene, es el root del workspace) y falla con `No Next.js version detected` — por eso `framework: null` explícito, para que no dependa de esa detección y confíe en los comandos explícitos.
**Consecuencias:** el deploy funciona (`next build` corre igual, genera `.next` completo) pero Vercel no aplica el preset "Next.js" — funciona bien para páginas estáticas/SSG como las de FASE 1. **Antes de FASE 3** (Route Handlers / API), hay que confirmar que las funciones serverless se sirven correctamente con esta config, o mover Root Directory a `apps/web` a mano desde el dashboard (Settings → General → Root Directory) — un ajuste de un minuto que no pude hacer yo mismo.
**Pendiente:** el dueño del proyecto debería entrar a `vercel.com/fmcodes-projects/web/settings` y confirmar/ajustar esto antes de que haya API routes reales.

## ADR-013 — Dónde vive el schema de base de datos, y por qué no en `packages/`

**Decisión:** Drizzle (schema + cliente + migraciones runner) vive en `apps/web/src/lib/db/`, no en un `packages/db` nuevo.
**Contexto:** `packages/shared` es consumido por `apps/mobile` también, y `pg` (el driver de Postgres) es una dependencia de Node que no funciona en React Native/Expo — meterlo en un package compartido rompería el bundling de Metro. Solo `apps/web` (el backend monolito modular, §5) habla directo con Postgres; `apps/mobile` habla con Supabase vía su SDK cliente (anon key + RLS), nunca con Drizzle.
**Consecuencias:** las migraciones SQL sí siguen la estructura del documento (`supabase/migrations/`, configurado como `out` en `drizzle.config.ts`) aunque el _schema_ TypeScript no viva en `supabase/`. Si en el futuro un segundo servicio necesita el mismo schema (p. ej. el microservicio de OR-Tools de FASE 7 opcional), se evalúa extraerlo a un package recién ahí.

## ADR-014 — Los enums de Postgres son copias literales, no imports de `@lastmile/state-machine`/`@lastmile/shared`

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
