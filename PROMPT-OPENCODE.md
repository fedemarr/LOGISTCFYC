# PROMPT PARA OPENCODE — correr 2-3 fases y reportar

> Pegar este documento completo como primer mensaje en OpenCode, abierto en la raíz de este
> repo (`sistemalogistica/`). Es una corrida acotada: el objetivo es que avances **2 o 3
> fases como mucho** y dejes todo en un estado revisable — no completar el proyecto entero.

## Contexto (leer en este orden, completo, antes de tocar código)

1. **`PROMPT-MAESTRO-CLAUDE-CODE.md`** (raíz) — la especificación completa del sistema:
   negocio, arquitectura, modelo de datos, roles, UX, y las 14 fases de desarrollo. Todo lo
   que dice ahí es decisión tomada, no la reinterpretes ni la cambies sin dejarlo dicho por
   escrito en `docs/DECISIONES.md`.
2. **`PROMPT-CONTINUACION.md`** (raíz) — el estado real y actualizado del proyecto: qué fases
   están cerradas, qué queda a mitad de camino ahora mismo, gotchas ya resueltos que no hay
   que volver a investigar, dónde están las credenciales. **Es la fuente de verdad del
   "dónde estamos"** — este archivo que estás leyendo (`PROMPT-OPENCODE.md`) es solo el
   disparador de la corrida, no duplica ese contenido.
3. **`docs/DECISIONES.md`** — el historial de decisiones técnicas (ADRs) con su porqué.
4. **`docs/MODELO-DATOS.md`** — diagrama y explicación del modelo de datos si vas a tocar
   algo de base de datos.

## Reglas no negociables (de `PROMPT-MAESTRO-CLAUDE-CODE.md` §0)

No `any` en TypeScript. No `console.log` en código de producción (los scripts de CLI de
`apps/web/src/lib/db/` son la excepción ya documentada). Soft delete + event log
append-only. No hardcodear secrets — todo por `.env` (que ya existe en la raíz, no está en
git, leelo directo del filesystem). No dupliques código que ya existe — revisá antes de
escribir. Leé un archivo completo antes de modificarlo. Si falta un dato de negocio o una
decisión de arquitectura no cubierta por el documento madre, **no la inventes** — dejala
explícitamente marcada como pendiente en `docs/DECISIONES.md` (esta corrida es no
interactiva, no hay nadie para preguntarle en el momento).

## Alcance de esta corrida: 2-3 fases, no más

El dueño del proyecto (Fede) ya autorizó saltarse la pausa de aprobación entre fases (está
citado en `PROMPT-CONTINUACION.md` §2) para las sesiones de Claude Code — extendé el mismo
criterio acá. Pero esta corrida específica de OpenCode tiene un límite explícito:

1. Retomá exactamente donde dice `PROMPT-CONTINUACION.md` que está el proyecto (probablemente
   terminar FASE 3, que quedó a mitad de camino).
2. Segui con la fase siguiente completa.
3. Si todavía queda margen razonable, una fase más.
4. **Ahí parás**, aunque la regla general diga "seguir sin pedir aprobación" — es un límite
   de esta corrida en particular, para poder revisar el avance real antes de seguir gastando
   contexto.

No hace falta preguntar si seguir o no al llegar al límite: simplemente cerrá la fase en
curso, dejá todo commiteado y pusheado, actualizá `PROMPT-CONTINUACION.md`, y terminá ahí tu
respuesta con un resumen de qué quedó hecho y qué sigue.

## Ritual al cerrar cada fase (no te lo saltees)

1. Correr la suite completa del monorepo (`pnpm exec turbo run typecheck lint test build`
   desde la raíz) y confirmar que da verde. Si algo falla, arreglalo antes de avanzar a la
   fase siguiente — no construyas una fase nueva sobre una rota.
2. Documentar en `docs/DECISIONES.md` cualquier decisión no obvia (ADR nuevo, numerado
   siguiendo el último que exista).
3. **Actualizar `PROMPT-CONTINUACION.md`** con el estado real: qué fase quedó cerrada (o a
   qué punto llegaste dentro de una fase en curso), en qué commit, qué gotchas nuevos
   aparecieron, qué sigue exactamente. Ese archivo es compartido entre todas las sesiones
   (Claude Code, OpenCode, la que sea) — es el que decide dónde arranca la próxima corrida,
   no lo dejes desactualizado.
4. Commit con mensaje convencional (`feat:`, `fix:`, `chore:`, `docs:`) — **el subject no
   puede empezar con una palabra en MAYÚSCULAS** (ej. "FASE"), commitlint lo rechaza como
   "upper-case". Usar minúsculas: `feat: fase 4 - ...`. Push a `main`
   (`https://github.com/fedemarr/LOGISTCFYC`).
5. Recién ahí, si todavía estás dentro del límite de 2-3 fases de esta corrida, seguir.

## Antes de escribir una sola línea

Corré esto para confirmar que el estado del repo coincide con lo que dice
`PROMPT-CONTINUACION.md` (si no coincide, alguien avanzó y no documentó — priorizá entender
qué pasó antes de seguir):

```bash
cd sistemalogistica
git log --oneline -10
git status
pnpm install
pnpm exec turbo run typecheck lint test build --force
```

Si algo de esto falla en un checkout limpio, es un problema real a resolver antes de sumar
código nuevo encima.
