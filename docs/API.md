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

## 9. Panel web (FASE 4)

### Sesión del panel

El panel usa **supabase-js en el browser** (localStorage) y adjunta el JWT
como `Authorization: Bearer` a cada llamada (helper `apiFetch` en
`apps/web/src/lib/api/client.ts`). El middleware de `/api/*` valida ese JWT
igual que en mobile. La sesión es client-side a propósito (ver ADR en
`docs/DECISIONES.md`).

### `GET /api/auth/me`

Identidad del usuario logueado (lo llama el app shell al entrar).

- **Roles:** cualquier sesión válida.
- **Respuesta:** `data` = `{ user: { id, email, fullName, phone, roles },
orgName }`.

### `GET|POST /api/users`, `GET|PATCH|DELETE /api/users/:id`

CRUD de usuarios del panel. **Solo admin** (matriz §3).

- `GET` listado: `?page&pageSize&search&role`. `data.items` incluye `roles`.
- `POST` body: `{ email, password (≥8), fullName, phone?, roles[] }`. Crea
  el usuario en Supabase Auth (service role) + la fila en `users` + sus
  `user_roles`. **Requiere `SUPABASE_SERVICE_ROLE_KEY` en el entorno**
  (configurada en local; falta agregarla en Vercel para dar de alta
  usuarios en producción).
- `PATCH` body: `{ email?, fullName?, phone?, isActive?, roles? }`.
- `DELETE`: soft delete (`deleted_at` + `isActive=false`, regla global).
- `POST` y `PATCH` con rate limit `users:write:{userId}`, 60/60s.

### `GET|POST /api/vehicles`, `GET|PATCH|DELETE /api/vehicles/:id`

Flota. **Lectura:** admin/dispatcher/warehouse. **Escritura:** solo admin.

- `GET` listado: `?page&pageSize&search&status`. `data.items` incluye
  `assignedDriverName` (join con `users`).
- `POST` body: `{ plate, brand?, model?, year?, capacityPackages?, status,
assignedDriverId? }` (la patente se normaliza a mayúsculas).
- `PATCH` body: cualquiera de los campos de `POST` más
  `capacityM3?, capacityKg?, currentOdometer?, insuranceExpiry?, vtvExpiry?`.
- `DELETE`: soft delete.

### `GET|POST /api/clients`, `GET|PATCH|DELETE /api/clients/:id`

Clientes (empresas que reciben envíos). Misma matriz que vehículos.

- Body `{ name, contact? }`. `DELETE` soft delete.

### `GET|POST /api/containers`, `GET|PATCH|DELETE /api/containers/:id`

Contenedores del depósito. Misma matriz que vehículos.

- Body `{ code, type ("BAG"|"CART"|"CAGE"|"SHELF"), qrPayload? }`. `DELETE`
  soft delete.

> Los CRUD usan soft delete (regla global del proyecto) y validación Zod
> por endpoint. Los `[id]` devuelven `NOT_FOUND` si el recurso no existe o
> está soft-deleted.

## 10. Ingesta y resolución de destino (FASE 5)

Implementa la cascada de §2: identidad (código) separada de destino
(dirección), en este orden — MANIFEST → BARCODE_PAYLOAD → ADDRESS_MEMORY →
OCR (deferred) → MANUAL. Servicios en `apps/web/src/lib/services/ingestion.ts`
(cascada + escaneo), `geocoding.ts` (caché + `known_addresses`) y
`operations.ts` (cierre/reconciliación).

### `GET|POST /api/operations`

Operación del día (§9.1). **Lectura:** admin/dispatcher toda la org;
warehouse solo las `OPEN`. **Escritura:** admin/dispatcher/warehouse.

- `GET`: `?page&pageSize&status`.
- `POST` body: `{ operationDate (YYYY-MM-DD), expectedCount?, notes? }`.
  `CONFLICT` si ya existe una operación para esa fecha (única por
  `org_id, operation_date`).

### `GET /api/operations/:id`

Detalle + `packagesByStatus` (conteo agrupado por estado del paquete).

### `POST /api/operations/:id/import`

Importador de manifiesto (§2, §9.1 paso 2). **El mapeo de columnas es
responsabilidad del cliente** — este endpoint recibe filas ya normalizadas,
no CSV crudo (mantiene el backend simple; el drag&drop de columnas es UI
pura). Body: `{ clientId?, rows: [{ trackingCode, recipientName?,
recipientPhone?, address?, weightKg?, declaredValue? }] }` (máx. 2000
filas). Idempotente por `trackingCode` dentro de la operación — reimportar
el mismo archivo no duplica. Cada fila crea un paquete `PENDIENTE_RESOLUCION`
con `fromManifest: true` (necesario para el reporte de cierre).

### `POST /api/operations/:id/scan`

Escaneo en loop (§9.1 paso 3) — corre la cascada completa. Body:
`{ rawCode, codeFormat?, clientId?, deviceId?, photoUrl?, lat?, lng? }`.
Respuesta: `{ packageId, internalCode, trackingCode, status, resolution:
{ resolved, source, confidence }, duplicate, duplicateInfo?, wrongClient }`.

- `duplicate: true` — mismo código ya escaneado en esta operación; se
  audita igual (nunca se pierde un intento de escaneo) pero no crea/toca
  el paquete de nuevo.
- `wrongClient: true` — el prefijo del código no coincide con
  `clients.codePrefix` del cliente indicado (§9.1, "paquete de otro
  cliente"). No bloquea, solo informa — el operador aparta el bulto.
- Si `resolution.resolved` y el paquete estaba `PENDIENTE_RESOLUCION`,
  transiciona a `RECIBIDO` (vía `runPackageTransition`, evento incluido).

### `GET /api/operations/:id/pending`

Bandeja de resolución (§2, §9.1 paso 4): paquetes que la cascada no pudo
resolver. Ningún paquete queda fuera del sistema — están acá.

### `POST /api/packages/:id/resolve`

Resolución manual (§2, escalón MANUAL de la cascada). Body:
`{ rawAddressText, recipientName?, recipientPhone? }`. Marca
`destinationSource: MANUAL, destinationConfidence: HIGH` y transiciona
`PENDIENTE_RESOLUCION → RECIBIDO`.

### `POST /api/operations/:id/geocode`

Geocodifica en lote los paquetes `RECIBIDO` de la operación (§9.1 paso 5).
Síncrono (a 120 paquetes/día alcanza, ver ADR-030). Cascada de costo:
`known_addresses` (gratis) → `geocode_cache` (gratis) → Google Geocoding API
(paga, solo si `GOOGLE_GEOCODING_API_KEY` está configurada — todavía no lo
está, ver `.env`). Sin la key, todo cae a `FAILED` de forma controlada (no
rompe nada, §16). Devuelve `{ processed, geocoded, failed }`.

### `POST /api/operations/:id/close`

Cierre de la recepción (§9.1 paso final). **admin/dispatcher.** Marca la
operación `CLOSED` y devuelve el reporte de reconciliación:
`{ operation, reconciliation: { expected, received, missing[], surplus[] } }`.

- **Faltantes:** paquetes con `fromManifest: true` que nunca se escanearon
  (`package_scans` sin fila para ellos).
- **Sobrantes:** paquetes escaneados que NO vinieron en el manifiesto
  (`fromManifest: false` pero sí tienen scan) — códigos que aparecieron de
  la nada.

> Esto es el cierre de la _recepción_ (comparar manifiesto vs. escaneado),
> distinto del "cierre del día" de §9.9 (reconciliación de entregas —
> CARGADOS = ENTREGADOS + FALLIDOS + DEVUELTOS + EN_DEPÓSITO), que es
> FASE 12 y necesita datos de `deliveries`/`incidents` que todavía no existen.

## 11. Ruteo (FASE 6)

Estrategia híbrida de §8: clustering geográfico capacitado + DBSCAN de
outliers (`@fyc/geo`, gratis, local) → secuenciación con matriz de
distancias reales (`lib/services/routing.ts`, cacheada, Google Routes API)
→ ajuste humano (`lib/services/route-planning.ts`) → aprobar (congela
`bulk_number`) → etiquetas (`lib/services/labels.ts`). El algoritmo
PROPONE, el dispatcher DISPONE — nada se aprueba solo.

### `GET|POST /api/operations/:id/routes`

**admin/dispatcher/warehouse** (GET también permite `driver`, solo ve lo
asignado a su propia ruta vía `GET /api/routes/:id`).

- `GET`: lista las rutas de la operación con conteo de paradas
  (`{ items: [...ruta, stopCount] }`).
- `POST`: corre el pipeline completo (§8 etapas 1-2) sobre los paquetes
  `GEOCODIFICADO` de la operación y crea rutas `DRAFT` + `route_stops`.
  Necesita al menos un vehículo `AVAILABLE` con chofer asignado — si no
  hay, `VALIDATION_ERROR`. Si ya existen rutas para la operación,
  `CONFLICT` (ajustá o borrá las `DRAFT` existentes antes de generar de
  nuevo — evita duplicar paquetes en dos propuestas a la vez). Devuelve
  `{ routes: [{ routeId, routeNumber, packageCount, plannedDistanceM,
plannedDurationS }], outlierPackageIds, unassignedForLackOfCapacity }`.

### `GET /api/routes/:id`

Detalle de una ruta con sus paradas en orden (`route_stops.sequence`, no
`bulk_number` — ver la distinción crítica en §7). Un `driver` con un solo
rol solo puede ver la ruta que tiene asignada (`FORBIDDEN` si no es la
suya). Devuelve `{ ...ruta, driverName, stops: [{ stopId, sequence,
status, distanceFromPrevM, durationFromPrevS, packageId, internalCode,
trackingCode, bulkNumber, recipientName, rawAddressText, lat, lng }] }`.

### `POST /api/routes/:id/reassign`

Ajuste manual (§8 etapa 3: "arrastrar un paquete de una ruta a otra").
**admin/dispatcher/warehouse.** `:id` es la ruta DESTINO. Body:
`{ packageId }`. Ambas rutas (origen y destino) tienen que estar
`DRAFT`/`PROPOSED` — `CONFLICT` si alguna ya está `APPROVED` (el bulto ya
tiene número congelado, moverlo rompería la identidad física del §7).
Re-secuencia ambas rutas completas con la matriz real tras el movimiento
("recalcula en vivo", ver ADR-036).

### `POST /api/routes/:id/approve`

**admin/dispatcher** (más restrictivo que la transición de estado en sí,
ver ADR-038). Congela `bulk_number` (1..n según la secuencia final de
`route_stops`) y transiciona cada paquete `GEOCODIFICADO → ASIGNADO`. A
partir de acá el número de bulto de la etiqueta impresa nunca cambia
(§7). `CONFLICT` si la ruta ya no está `DRAFT`/`PROPOSED`. Devuelve
`{ routeId, status: "APPROVED", packageCount }`.

### `GET /api/routes/:id/labels?format=thermal|a4`

PDF listo para imprimir (§9.2) — responde el binario directo
(`Content-Type: application/pdf`), no el envelope JSON estándar. Solo
funciona sobre una ruta `APPROVED` (`VALIDATION_ERROR` si no —
`bulk_number` todavía no está congelado). El QR es siempre
`packages.internal_code`, nunca `tracking_code` (§9.2). `format=thermal`
(default): una etiqueta de 100×150mm por página. `format=a4`: grilla 2×2
por hoja A4.

### Nota sobre el depósito

Todo el pipeline necesita saber dónde arranca la ruta. Se resuelve con
`organizations.settings.depot = {lat, lng}` o, si no está cargado, las env
vars `DEFAULT_DEPOT_LAT`/`DEFAULT_DEPOT_LNG` — si ninguna está
configurada, `POST /api/operations/:id/routes` falla con
`VALIDATION_ERROR` en vez de rutear desde una coordenada inventada (ver
ADR-033). Sin `GOOGLE_ROUTES_API_KEY` (todavía no está, ver `.env`), la
matriz de distancias degrada a una estimación (`estimated: true` en la
respuesta interna) en vez de fallar — mismo criterio que geocoding
(ADR-030, ADR-035).

## 12. App móvil — base y sync offline (FASE 7)

Consumidos por `apps/mobile` (ver `docs/DECISIONES.md` ADR-041 para las
decisiones de alcance). Mismo envelope y auth que el resto de la API
(Bearer token de Supabase).

### `POST /api/sync`

Motor de sincronización offline-first (§12 del documento madre). Body:
`{ deviceId, actions: [{ idempotencyKey, operationType, payload, clientTimestamp }] }`
(máx. 50 acciones por lote). `idempotencyKey` es un UUID generado en el
dispositivo al encolar la acción localmente — reenviar el mismo lote
(reintento tras reconectar) es siempre seguro, el servidor dedupe por esa
clave contra `sync_queue` antes de aplicar ningún efecto.

`operationType` — únicamente `"GPS_PING"` por ahora (`SYNC_OPERATION_TYPES`
en `@fyc/shared`; agregar uno nuevo es sumarlo ahí + un `case` en
`lib/services/sync.ts`). Payload de `GPS_PING`:
`{ lat, lng, accuracyM?, speedMps?, heading?, batteryLevel?, isMoving?, routeId? }`.

Respuesta: `{ results: [{ idempotencyKey, status, error? }] }`, un
resultado por acción del lote (una falla no aborta las demás):

- `COMPLETED` — se aplicó ahora.
- `DUPLICATE` — ya se había aplicado antes (mismo `idempotencyKey`); el
  cliente puede borrarla de su outbox local igual, el efecto ya está.
- `FAILED` — el payload no pasó la validación de ese `operationType`;
  queda en `sync_queue` con `status: FAILED` y `last_error` para
  diagnóstico. El cliente no la borra de su outbox — reintenta con
  backoff (§12: 5s, 15s, 1m, 5m, 15m, 1h).

### `GET /api/driver/route/current`

**driver.** La ruta activa del chofer autenticado con todas sus paradas —
"descarga completa de la ruta a local" (§14 FASE 7). Devuelve
`{ route: {...} | null, stops: [...] }`; `route: null` si no tiene
ninguna ruta en estado `APPROVED`/`ASSIGNED`/`LOADING`/`LOADED`/
`IN_TRANSIT` (ver ADR-041 punto 3 sobre por qué incluye `APPROVED`). Cada
parada trae dirección, contacto, coordenadas, `bulkNumber` (ya congelado
si la ruta está aprobada) y `operationalNotes` (ej. "timbre no anda",
§9.5) — todo lo que la app necesita para operar el resto del día sin
pedir nada más por red.
