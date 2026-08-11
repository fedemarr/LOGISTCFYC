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
