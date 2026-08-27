# FYM — Sistema de control de choferes

Panel administrativo (web) + PWA para el chofer, para monitorear turnos de reparto por
zona (geocerca circular) en el Área Metropolitana de Buenos Aires: el chofer arranca el
turno desde un QR de identificación, reporta avances cada 2-3 h y dispara una alerta si
sale de su zona asignada. Reemplaza al sistema de reparto FYC anterior (paquetes/rutas/
custodia), archivado en la rama `archive/fyc-delivery-system`.

## Estructura

```
apps/
  web/      Next.js 15 — panel administrativo + PWA del chofer (`/chofer`, sin login,
            autentica con el token del QR)
packages/
  shared/   tipos, Zod schemas, constantes (roles, límites de FYM)
  geo/      haversine — distancia del chofer al centro de su zona (geocerca)
  config/   eslint, tsconfig y tokens de Tailwind compartidos
supabase/
  migrations/   migraciones SQL, aplicadas a mano con `pnpm db:migrate` (no usa el
                migrator de Drizzle — ver el comentario en `apps/web/src/lib/db/migrate.ts`)
docs/
  DECISIONES.md   ADRs — por qué de cada decisión técnica
```

## Requisitos

- Node.js ≥ 20 (probado con Node 24)
- pnpm ≥ 9 (`corepack enable` o `npm i -g pnpm`)
- Una base Postgres de Supabase (self-host o cloud) con PostGIS habilitado

## Setup

```bash
pnpm install
cp .env.example .env   # completar credenciales reales, nunca commitear .env

cd apps/web
pnpm db:migrate   # aplica supabase/migrations/*.sql contra DATABASE_URL
pnpm db:seed      # 1 org, 4 usuarios de panel + 2 choferes (uno con QR), 3 zonas
```

El seed imprime el token en claro del QR de prueba y las credenciales
(`admin@fym.demo` / `FYM123!` — misma contraseña para los 4 roles, ver
`apps/web/src/lib/db/seed/index.ts`).

## Desarrollo

```bash
pnpm dev                       # levanta apps/web (Next.js)
pnpm --filter @fym/web dev     # lo mismo, explícito
```

La PWA del chofer vive en `/chofer` del mismo deploy — no es una app aparte ni necesita
build nativo/EAS. Se accede escaneando el QR (`/chofer?t=<token>`), que guarda el token
en `localStorage` del teléfono.

## Calidad

```bash
pnpm lint        # ESLint en todos los packages/apps
pnpm typecheck   # tsc --noEmit en todos los packages/apps
pnpm test        # tests unitarios (vitest) donde existan
pnpm format      # Prettier sobre todo el repo

cd apps/web
pnpm test          # todos los tests de apps/web, incluidos los de integración
                   # contra Supabase real (RLS, rate limiting)
pnpm test:unit     # solo los que no necesitan DB (lo que corre en CI)
pnpm smoke:api     # smoke test de la API (requiere el server corriendo)
pnpm smoke:browser     # smoke test en Chrome real — ver el comentario del script,
                        # atrapó bugs reales que typecheck/lint/test/build no ven
```

Los commits siguen [Conventional Commits](https://www.conventionalcommits.org/)
(`feat:`, `fix:`, `chore:`, `docs:`, ...) y se validan con commitlint vía Husky. Antes
de cada commit, `lint-staged` corre Prettier sobre los archivos modificados.

## CI

`.github/workflows/ci.yml` corre lint + typecheck + test en cada PR y en push a `main`.

## Sistema anterior (FYC, archivado)

El sistema de reparto completo (paquetes, rutas, custodia, app móvil nativa del chofer)
quedó archivado en la rama `archive/fyc-delivery-system` — no se borró, por si hace
falta retomarlo o mirar cómo se resolvió algo ahí.
