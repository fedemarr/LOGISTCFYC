# API — Panel de Operaciones (apps/web)

Contrato HTTP del backend monolito modular (PROMPT-MAESTRO §5: "Next.js
Route Handlers dentro del mismo proyecto"). Este documento describe el
**patrón** que todo endpoint nuevo debe seguir (respuesta estándar,
validación, autorización, paginación, rate limiting) y los endpoints que
existen hasta acá. FASE 3.

---

## 1. Forma de la respuesta (envelope estándar)

Toda respuesta es JSON con uno de estos dos shapes, sin excepción:

**Éxito**

```json
{
  "success": true,
  "data": { ... },                 // el recurso o `{ items: [...] }` en listas
  "meta": { "page": 1, "pageSize": 20, "total": 120, "pages": 6 }
}
```

**Error**

```json
{
  "success": false,
  "error": { "code": "NOT_FOUND", "message": "paquete no existe" }
}
```

`error.details` aparece solo cuando hay información extra útil (p. ej. el
detalle aplanado de un error de validación de Zod). Implementación:
`apps/web/src/lib/api/response.ts`.

### Códigos de error y HTTP status

| Código                 | HTTP | Cuándo                                                          |
| ---------------------- | ---- | --------------------------------------------------------------- |
| `VALIDATION_ERROR`     | 400  | Input inválido (Zod). `details` trae el detalle                 |
| `UNAUTHORIZED`         | 401  | Sin sesión o sesión inválida/expirada                           |
| `FORBIDDEN`            | 403  | Sesión válida pero sin el rol necesario (matriz de §3)          |
| `FORBIDDEN_TRANSITION` | 403  | La transición existe pero el rol del actor no la puede ejecutar |
| `NOT_FOUND`            | 404  | Recurso inexistente                                             |
| `CONFLICT`             | 409  | Estado/condición no permite la operación (transición ilegal)    |
| `PRECONDITION_FAILED`  | 422  | Falta una precondición (evidencia, GPS, foto, motivo)           |
| `RATE_LIMITED`         | 429  | Excediste el límite de la ventana                               |
| `INTERNAL_ERROR`       | 500  | Error inesperado — nunca filtra detalles internos               |

El mapeo de excepciones de dominio a `AppError` vive en
`apps/web/src/lib/api/errors.ts` (`toAppError`).

## 2. Autenticación y autorización

### Identidad (middleware)

Todos los endpoints `/api/*` pasan por `apps/web/src/middleware.ts`, que
corre en el Edge runtime y valida la sesión ANTES de llegar al handler:

- Envía el JWT de Supabase en el header `Authorization: Bearer <token>`.
- El middleware lo verifica contra Supabase Auth (`auth.getUser`).
- Si es válido, setea el header interno `x-fyc-user-id` y deja pasar;
  si no, responde `401 UNAUTHORIZED` con el envelope estándar, sin ejecutar
  el handler.
- El middleware **siempre sobreescribe** cualquier `x-fyc-user-id` que
  mande el cliente (no se puede impostar una identidad ajena).

### Autorización por rol (handler)

El middleware NO conoce roles (Edge no tiene acceso a Postgres). El handler
los resuelve contra la base:

- `requireUser(request)` → devuelve `{ userId, orgId, email, roles }`; tira
  `401` si no hay header o el usuario no existe/no está activo.
- `requireRole(request, ["admin", "dispatcher"])` → `requireUser` + check de
  que tenga al menos UNO de los roles; tira `403` si no.

> ⚠️ ADR-015: la conexión del backend (`DATABASE_URL`) bypasea RLS. **Esta
> es la autorización real.** RLS solo protege accesos directos del cliente.

## 3. Validación de inputs (Zod)

Todos los inputs pasan por Zod (PROMPT-MAESTRO §14: "Zod para validación de
todos los inputs"). Helpers en `apps/web/src/lib/api/http.ts`:

- `parseBody(schema, request)` — valida el body JSON.
- `parseQuery(schema, url)` — valida la query string.
- `parseParams(schema, params)` — valida los segmentos dinámicos (Next 15
  los entrega como `Promise`, se resuelve acá).

Cada uno lanza `VALIDATION_ERROR` con el `flatten()` de Zod si falla.

## 4. Paginación

Endpoints de lista usan paginación offset: `?page=1&pageSize=20` (defaults
`page=1`, `pageSize=20`, máximo `pageSize=100`). La respuesta incluye
`meta: { page, pageSize, total, pages }`. Helper: `paginationFrom()` +
`paginationMeta()`.

## 5. Rate limiting

Sin Redis (PROMPT-MAESTRO §5) — ventana fija atómica sobre la tabla
`rate_limits` (migración `0004_rate_limits.sql`):

- `consumeRateLimit(key, { limit, windowSeconds })` — un solo UPSERT
  atómico que cuenta la ventana; cuando está llena, lanza `RATE_LIMITED`.
- Las claves se arman por usuario y acción (p. ej.
  `transition:{userId}`). La limpieza de ventanas viejas va en el job de
  mantenimiento de FASE 12/13.
- Implementación: `apps/web/src/lib/api/rate-limit.ts`.

## 6. El patrón de un Route Handler (copiar y pegar esto)

```ts
import { PACKAGE_STATUSES } from "@fyc/state-machine";
import { z } from "zod";
import {
  consumeRateLimit, jsonError, jsonOk, parseBody, parseParams,
  requireUser, toAppError,
} from "@/lib/api";
import { runPackageTransition } from "@/lib/services/state-machine";

const bodySchema = z.object({
  toStatus: z.enum([...PACKAGE_STATUSES]),
  metadata: z.record(z.unknown()).optional(),
});

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);                 // 1. identidad
    const { id } = await parseParams(z.object({ id: z.string().uuid() }), ctx.params);
    const body = await parseBody(bodySchema, request);       // 2. validación
    await consumeRateLimit(`mi-accion:${user.userId}`, { limit: 120, windowSeconds: 60 }); // 3. rate limit
    const result = await runPackageTransition({ ... });      // 4. lógica
    return jsonOk(result, undefined, { status: 201 });       // 5. respuesta
  } catch (err) {
    return jsonError(toAppError(err));                        // 6. error normalizado
  }
}
```

Reglas:

- Nunca responder fuera del envelope estándar.
- El rol de mutaciones lo valida la máquina de estados en el servicio (las
  excepciones del dominio se mapean en `toAppError`), no un check manual.
- `requireRole` se usa cuando el rol define el _scope de lectura_ (p. ej.
  listados); para mutaciones alcanza `requireUser`.

## 7. Endpoints existentes (FASE 3)

### `GET /api/packages`

Listado de paquetes con paginación y filtros.

**Query params:** `page`, `pageSize`, `status` (enum `package_status`),
`search` (por `internal_code` o `tracking_code`, substring), `operationId`
(UUID).

**Scope por rol** (matriz de permisos §3):

- `admin`/`dispatcher` → toda la organización.
- `warehouse` → solo la operación del día en curso.
- `driver` → solo paquetes de sus rutas asignadas.

**Respuesta:** `data.items` = proyección de paquetes. Nunca expone
`recipient_document_hash` ni `recipient_phone`.

### `POST /api/packages/:id/transition`

Ejecuta una transición de la máquina de estados (único punto de escritura
de `packages.status`, §4).

**Body:** `{ toStatus, metadata? }`. `metadata` es un objeto libre cuyas
claves interpretan las precondiciones: `receiverName` + `gps: { lat, lng }`
para `ENTREGADO`, `reason` + `photoUrl` para `FALLA_REPORTADA`, etc. (ver
`packages/state-machine/src/preconditions.ts`).

**Rate limit:** `transition:{userId}`, 120/60s.

**Respuesta:** `data` = `{ packageId, fromStatus, toStatus, eventId }`
(201). Los errores de la máquina de estados llegan como
`ILLEGAL_TRANSITION` (409), `FORBIDDEN_TRANSITION` (403),
`PRECONDITION_FAILED` (422).

## 8. Logging

`apps/web/src/lib/api/logger.ts` — logger estructurado mínimo: una línea
JSON por evento a stdout (Vercel lo captura), respeta `LOG_LEVEL`, soporta
`logger.child({...})` para bindings de contexto. Nada de `console.log` en
código de producción (ver `apps/web/eslint.config.mjs`).
