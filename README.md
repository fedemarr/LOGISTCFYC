# FYC — Sistema de logística de última milla

Panel administrativo (web) + app del chofer/depósito (mobile) para una operación de
última milla en el Área Metropolitana de Buenos Aires. Ver
[`PROMPT-MAESTRO-CLAUDE-CODE.md`](./PROMPT-MAESTRO-CLAUDE-CODE.md) para el contexto de
negocio y arquitectura completos, y [`docs/DECISIONES.md`](./docs/DECISIONES.md) para el
porqué de cada decisión técnica.

> **Estado actual: FASE 1 (scaffolding).** Sin base de datos, sin backend, sin
> pantallas funcionales todavía. Ver `PROMPT-MAESTRO-CLAUDE-CODE.md` §14 para el resto
> de las fases.

## Estructura

```
apps/
  web/      Next.js 15 — panel administrativo
  mobile/   Expo (Development Build) — app del chofer y del depósito
packages/
  shared/         tipos, Zod schemas, constantes (ej. roles)
  state-machine/  máquina de estados del paquete (contrato en FASE 1, impl. en FASE 3)
  geo/            haversine, clustering, secuenciación (contrato en FASE 1, impl. en FASE 6)
  config/         eslint, tsconfig y tokens de Tailwind compartidos
supabase/
  migrations/     migraciones SQL (FASE 2)
docs/
  DECISIONES.md   ADRs — por qué de cada decisión técnica
```

## Requisitos

- Node.js ≥ 20 (probado con Node 24)
- pnpm ≥ 9 (`corepack enable` o `npm i -g pnpm`)
- Para `apps/mobile`: [EAS CLI](https://docs.expo.dev/eas/) (`pnpm dlx eas-cli`) y una
  cuenta de Expo si vas a generar un Development Build

## Setup

```bash
pnpm install
cp .env.example .env   # completar credenciales reales, nunca commitear .env
```

## Desarrollo

```bash
pnpm dev           # levanta apps/web (Next.js) y apps/mobile (Expo) en paralelo
pnpm --filter @fyc/web dev      # solo el panel web
pnpm --filter @fyc/mobile dev   # solo la app móvil (requiere Development Build,
                                      # no funciona con la app de Expo Go)
```

## Calidad

```bash
pnpm lint        # ESLint en todos los packages/apps
pnpm typecheck   # tsc --noEmit en todos los packages/apps
pnpm test        # tests unitarios (vitest) donde existan
pnpm format      # Prettier sobre todo el repo
```

Los commits siguen [Conventional Commits](https://www.conventionalcommits.org/)
(`feat:`, `fix:`, `chore:`, `docs:`, ...) y se validan con commitlint vía Husky. Antes
de cada commit, `lint-staged` corre Prettier sobre los archivos modificados.

## App móvil — Development Build

La app usa módulos nativos (cámara, ubicación en background, SQLite) que **no
funcionan en Expo Go**. Hay que generar un Development Build:

```bash
cd apps/mobile
pnpm dlx eas-cli login          # una vez, con la cuenta de Expo del proyecto
pnpm dlx eas-cli init           # vincula el proyecto y completa `extra.eas.projectId`
pnpm dlx eas-cli build --profile development --platform android
```

## CI

`.github/workflows/ci.yml` corre lint + typecheck + test en cada PR y en push a
`main`. Requiere que el repo tenga un remoto en GitHub (no configurado todavía).

## Decisiones pendientes de negocio

Ver PROMPT-MAESTRO-CLAUDE-CODE.md §20 — nombre del rol `dispatcher`, tipo de
impresora, ubicación del depósito, capacidad de vehículos, tarifas, etc. No se
inventan: se preguntan antes de la fase que los necesita.
