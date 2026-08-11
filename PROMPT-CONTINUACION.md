# PROMPT DE CONTINUACIÓN — pegar como primer mensaje en una sesión nueva de Claude Code

> Usar este archivo cuando se acaben los tokens/contexto de la sesión anterior. Abrí Claude
> Code en la raíz de este repo (`sistemalogistica/`) y pegá este documento completo como
> primer mensaje. No hace falta pegar nada más — todo lo que necesitás ya está en el repo.

---

## 1. Quién sos y qué es esto

Sos el equipo de desarrollo completo (Software Architect, Backend, Frontend, DB, Mobile,
Security, DevOps, UX) de **Lastmile**, un sistema de logística de última milla para AMBA,
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
Al día de escribir esto: `e2dcdea` — fin de FASE 2.

**Repo:** `https://github.com/fedemarr/LOGISTCFYC` (rama `main`). El working tree debería
estar limpio; si no lo está, mirá qué quedó a medio hacer antes de seguir.

**Deploy:** `apps/web` está en Vercel (proyecto `fmcodes-projects/web`) —
`https://web-fmcodes-projects.vercel.app` (protegido por Vercel Authentication, solo
accesible logueado con esa cuenta). El deploy se dispara solo con cada push a `main` (Git
integration ya conectada). Ver `docs/DECISIONES.md` ADR-012 antes de tocar la config de
Vercel — el Root Directory quedó en la raíz del repo con comandos explícitos en
`vercel.json` porque no se pudo cambiar el Root Directory a `apps/web` desde acá (es
dashboard-only). **Antes de que FASE 3 agregue Route Handlers reales, confirmar con Fede
que las funciones serverless se sirven bien en Vercel con esa config** (probarlo con un
endpoint de prueba apenas exista).

### FASE 1 — Scaffolding ✅ (commits `a40988a`, `afbc85b`, `1fda482`)

Turborepo + pnpm workspaces. `apps/web` (Next.js 15.5.23 + React 19, TS strict, Tailwind v4,
shadcn/ui). `apps/mobile` (Expo SDK 57, Development Build con `expo-dev-client`, EAS
configurado — placeholder `com.lastmile.mobile` como bundle id, confirmar el real antes de
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
`Lastmile123!`, ver `apps/web/src/lib/db/seed/index.ts`), 3 vehículos, 5 contenedores, 1
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
2. **`drizzle-kit generate` no puede importar paquetes del workspace** (`@lastmile/
state-machine`, `@lastmile/shared`) dentro de `drizzle.config.ts` o los archivos de
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

## 4. Credenciales — dónde están, qué falta

Todo lo que ya se consiguió está en `.env` (raíz, **no está en git**, no lo va a encontrar
una sesión nueva a menos que lea el archivo directo). Si `.env` no existe en el checkout
nuevo (por ejemplo porque es una máquina distinta), pedile a Fede que lo pase de nuevo — NO
lo reconstruyas con placeholders y sigas de largo.

Ya conseguido (Supabase project `xdhjxecrozcozcstndbr`, región `sa-east-1`): URL, anon key,
service role key, `DATABASE_URL` (session pooler). GitHub conectado. Vercel deployado y con
Git integration activa.

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
pnpm exec turbo run typecheck lint test build --force   # las 6 packages, debería dar todo verde

cd apps/web
pnpm db:migrate                   # idempotente, no debería aplicar nada nuevo
pnpm db:verify                    # chequeo rápido de RLS/particiones/PostGIS
pnpm test                         # tests de RLS contra Supabase real
```

Si algo de esto falla, arreglalo antes de seguir avanzando de fase — no construyas FASE 3
sobre una FASE 2 rota.

## 6. Qué sigue: FASE 3 — Core de dominio y backend

Del documento madre, §14, FASE 3:

- `packages/state-machine`: implementar `PackageStateMachine.transition()` de verdad — hoy
  es un placeholder que tira `Error` a propósito (`packages/state-machine/src/index.ts`).
  Necesita: tabla de transiciones legales/ilegales completa (diagrama de §4), validación de
  permisos por rol (matriz de §3), precondiciones (ej. `ENTREGADO` exige evidencia + GPS),
  escritura transaccional en `events` en la MISMA transacción (usar `log_event()` de la
  migración 0001, o replantear si hace falta — está `SECURITY DEFINER` así que hay que
  llamarlo con una conexión que tenga permiso de ejecutarlo). Tests unitarios de **todas**
  las transiciones legales e ilegales — el criterio de aceptación pide >80% de cobertura acá.
- Servicio de eventos: append-only, transaccional con cada transición (ver arriba).
- Auth con Supabase + middleware de roles y permisos — **esto es lo que realmente
  autoriza al backend**, no solo RLS (ver gotcha #5 arriba). Definí cómo el backend valida
  sesión/rol antes de ejecutar una acción.
- Route Handlers por módulo en `apps/web/src/app/api/`, validación Zod en TODOS los inputs.
- Manejo de errores centralizado (`AppError`), respuesta estándar
  `{ success, data, meta }` / `{ success, error: { code, message } }`.
- Paginación en todos los endpoints de lista. Rate limiting. Logger estructurado (nada de
  `console.log` fuera de los scripts de CLI ya exceptuados).
- `docs/API.md`.

**Antes de escribir código de FASE 3:** releé la matriz de permisos completa de §3 y la
máquina de estados de §4 del documento madre — no las reinterpretes de memoria.

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
