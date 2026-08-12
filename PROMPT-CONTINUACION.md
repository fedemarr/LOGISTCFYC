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
Al día de escribir esto: FASE 1, 2 y 3 **cerradas**, FASE 4 **en curso** (ver abajo).

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

**Falta (lo que sigue ahora mismo):**

1. `app/(panel)/paquetes` ya está como lista; si hace falta el detalle de paquete y las
   acciones de transición del panel, es alcance de la próxima sub-fase de FASE 4.
2. Cerrar: correr la suite completa, actualizar esta sección a "✅", commit + push.

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
- `NEXT_PUBLIC_MAPTILER_KEY` — FASE 6 (mapas del panel)
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

## 6. Qué sigue: FASE 4 — Panel web (resto de la base)

FASE 4 (del documento madre §14) está **en curso**: el login, el shell con sidebar por rol,
los CRUD de usuarios/vehículos/clientes/contenedores, la lista de paquetes y el design
system ya están. Lo que sigue de la base del panel:

- Detalle de paquete y acciones de transición (delivery) desde el panel si corresponde a la
  fase (ver `PROMPT-MAESTRO-CLAUDE-CODE.md` §14 FASE 4 para el alcance exacto).
- Cerrar la fase: suite completa verde, actualizar la sección 3 de este archivo, commit +
  push.

Recordá: los CRUD y sus forms ya existen y funcionan (búsqueda, paginación, estados
empty/loading/error, soft delete con confirmación). No los reescribas — extendelos.

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
