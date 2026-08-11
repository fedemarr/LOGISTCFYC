# PROMPT MAESTRO — SISTEMA DE LOGÍSTICA DE ÚLTIMA MILLA

> **Cómo usar este documento:** pegá este archivo completo como primer mensaje en Claude Code, o guardalo en la raíz del repo como `PROMPT-MAESTRO.md` y decile a Claude Code: _"Leé PROMPT-MAESTRO.md completo y ejecutá la FASE 1. No avances a la FASE 2 sin mi aprobación."_

---

## 0. REGLAS DE TRABAJO (LEER PRIMERO — NO NEGOCIABLES)

Sos el equipo de desarrollo completo de este proyecto: Software Architect, Backend Senior, Frontend Senior, Database Architect, Mobile Engineer, Security Engineer, DevOps y UX Engineer.

### Reglas absolutas

1. **NO CONSTRUYAS TODO DE UNA SOLA VEZ.** El desarrollo va por fases (sección 14). Al terminar cada fase: probás, documentás, hacés commit y **PARÁS a esperar aprobación explícita** antes de seguir.
2. **NO improvises arquitectura.** Todo lo definido en este documento es decisión tomada. Si algo no está definido, **preguntá antes de asumir**.
3. **NO cambies tecnologías** sin justificarlo y obtener aprobación.
4. **NO elimines funcionalidad existente.** Antes de modificar un archivo, leelo completo.
5. **NO uses `any` en TypeScript.** Strict mode activado, sin excepciones.
6. **NO hardcodees secrets.** Todo por variables de entorno, con `.env.example` actualizado.
7. **NO borres registros.** Soft delete (`deleted_at`) en todas las tablas de negocio. El event log es **inmutable, append-only**.
8. **NO uses `console.log` en producción.** Logger estructurado.
9. **NO inventes datos de negocio.** Si falta un dato para decidir, preguntá.
10. **Antes de escribir código nuevo, revisá si ya existe algo similar.** Cero duplicación.

### Al terminar cada fase, entregá

- Resumen de qué se construyó
- Cómo probarlo (comandos concretos)
- Qué quedó pendiente o asumido
- Riesgos detectados
- Commit hecho con mensaje convencional (`feat:`, `fix:`, `chore:`, `docs:`)

### Preguntá siempre que

- Un requisito de este documento sea ambiguo o contradictorio
- Necesites una credencial, API key o dato del negocio
- Detectes que una decisión de este documento es técnicamente mala (**decilo, no la ejecutes en silencio**)

---

## 1. CONTEXTO DEL NEGOCIO

Operación de última milla subcontratada en el Área Metropolitana de Buenos Aires, Argentina.

**Volumen inicial:** ~120 paquetes/día, 1-3 choferes, 1 depósito, un solo proveedor de paquetes.

**Día operativo real:**

```
DÍA -1 (tarde/noche) — DEPÓSITO
  1. Se retiran ~120 paquetes en La Tablada
  2. Se traen al depósito propio
  3. Se escanea paquete por paquete y se captura su destino
  4. El sistema geocodifica, agrupa y arma rutas
  5. Se imprime y pega una etiqueta por paquete (RUTA + Nº BULTO)
  6. Los paquetes quedan apilados por ruta

DÍA 0 (mañana) — SALIDA
  7. El chofer escanea el QR del contenedor de su ruta (toma de custodia)
  8. Cuenta los bultos; si coincide, confirma
  9. Carga y presiona INICIAR RUTA
 10. Reparte con la app; navega con Google Maps/Waze
 11. Operaciones lo monitorea y resuelve incidencias
 12. Cierre del día y reconciliación
```

**Ventaja estructural que hay que explotar:** el trabajo pesado (captura, geocoding, ruteo) ocurre la noche anterior, sin nadie esperando. Todo lo lento, caro o falible va en la ventana nocturna. **La mañana solo tiene que ser rápida y a prueba de errores.**

### El sistema resuelve tres cosas, en este orden

1. **Trazabilidad defensiva** — prueba irrefutable de qué pasó con cada paquete
2. **Productividad** — más entregas por hora, menos tiempo en depósito
3. **Control remoto** — saber qué pasa sin llamar por teléfono

---

## 2. DECISIÓN CRÍTICA: LA CAPA DE INGESTA

**El código de la etiqueta NO contiene la dirección.** Un código de barras (Code 128) guarda 20-40 caracteres: alcanza para un ID, no para un domicilio. Un QR puede guardar más, pero los operadores logísticos igual usan el código como llave contra su propia base de datos.

Por lo tanto el sistema separa **estrictamente** dos conceptos y nunca los mezcla:

| Concepto      | Qué resuelve                    | Confiabilidad                  |
| ------------- | ------------------------------- | ------------------------------ |
| **IDENTIDAD** | "este bulto es el envío X"      | Casi nunca falla               |
| **DESTINO**   | "el envío X va a tal dirección" | Toda la incertidumbre está acá |

### Arquitectura obligatoria: adaptadores de ingesta + cascada de resolución

El core del sistema **nunca sabe de dónde vino la dirección**. Recibe un objeto normalizado. Implementar una interfaz `IngestionAdapter` con estas implementaciones:

```typescript
interface IngestionAdapter {
  name: string;
  resolve(input: ScanInput): Promise<ResolutionResult>;
}

type ResolutionResult = {
  resolved: boolean;
  source: "MANIFEST" | "BARCODE_PAYLOAD" | "OCR" | "MANUAL" | "ADDRESS_MEMORY";
  confidence: "HIGH" | "MEDIUM" | "LOW";
  data: Partial<PackageDestination>;
  rawEvidence?: { photoUrl?: string; rawCode: string };
};
```

**Cascada de resolución (en este orden exacto):**

```
ESCANEO del código
   ↓
1. ¿El código coincide con un manifiesto importado?     → HIGH  → resuelto
   ↓ no
2. ¿El código trae payload parseable (JSON, delimitado)? → HIGH  → resuelto
   ↓ no
3. ¿Este mismo código ya fue resuelto antes?             → HIGH  → resuelto
   ↓ no
4. OCR sobre la foto de la etiqueta                      → MEDIUM → requiere confirmación humana
   ↓ falla o baja confianza
5. BANDEJA DE RESOLUCIÓN (formulario + foto al lado)     → HIGH  → humano lo completa
```

### Reglas inviolables de la ingesta

- **Guardar SIEMPRE el string crudo del código**, sin parsear, sin limpiar, junto al tipo de código (`QR`, `CODE_128`, `PDF417`, `DATA_MATRIX`), quién escaneó y cuándo. Tabla `package_scans`. Esto permite reprocesar históricos si después se descubre estructura en el código.
- **Guardar SIEMPRE la foto de la etiqueta**, aunque el OCR haya funcionado. Es el respaldo para reprocesar.
- **Ningún paquete queda fuera del sistema.** Si nada resuelve, entra igual con estado `PENDIENTE_RESOLUCION` y cae en la bandeja.
- **Registrar `destination_source` y `destination_confidence`** en cada paquete. Sirve para priorizar el ruteo y para medir el % de automatización mes a mes.

### Memoria de direcciones (clave para que mejore solo)

Tabla `known_addresses`: cada dirección resuelta y geocodificada se guarda normalizada. En la segunda aparición ya no se geocodifica ni se pregunta nada. Guarda también notas operativas acumuladas ("timbre no anda", "portón verde", "dejar en portería"). En 2-3 semanas cubre la mayoría de las entregas repetidas.

### Importador de manifiesto (construir aunque hoy no haya manifiesto)

Importador CSV/XLSX con mapeo de columnas configurable por el usuario en pantalla (arrastrar columna origen → campo destino). Si el proveedor manda un Excel, el tiempo de captura baja de ~40 min a ~20 min por día. **Es el camino más rentable y hay que dejarlo listo.**

---

## 3. ROLES Y PERMISOS

| Rol interno (código/BD) | Nombre en pantalla | Función                                                              |
| ----------------------- | ------------------ | -------------------------------------------------------------------- |
| `admin`                 | Administrador      | Configura todo, ve todo, ve métricas y economía                      |
| `dispatcher`            | **Operaciones** ⚙️ | Vigila rutas en vivo, aprueba incidencias, resuelve reclamos         |
| `warehouse`             | Depósito           | Escanea, resuelve direcciones, arma rutas, imprime, entrega la carga |
| `driver`                | Chofer             | Reparte                                                              |

> ⚙️ **PARÁMETRO EDITABLE:** el nombre visible del rol `dispatcher` está definido en un solo lugar (`src/lib/constants/roles.ts`). El dueño puede querer llamarlo "Control", "Supervisor" o "Base". **No hardcodear el label en ningún componente.**

**Un mismo usuario puede tener varios roles.** Hoy el dueño es `admin + dispatcher + warehouse` simultáneamente. El modelo debe soportar múltiples roles por usuario desde el día 1.

### Matriz de permisos

| Acción                                       | admin | dispatcher |  warehouse   |    driver    |
| -------------------------------------------- | :---: | :--------: | :----------: | :----------: |
| Ver todo (paquetes, rutas, historial, fotos) |  ✅   |     ✅     | solo del día | solo su ruta |
| Escanear y resolver direcciones              |  ✅   |     ✅     |      ✅      |      ❌      |
| Generar / editar rutas                       |  ✅   |     ✅     |      ✅      |      ❌      |
| Imprimir etiquetas                           |  ✅   |     ✅     |      ✅      |      ❌      |
| Entregar la carga al chofer                  |  ✅   |     ✅     |      ✅      |      ❌      |
| Tomar custodia de una ruta                   |  ❌   |     ❌     |      ❌      |      ✅      |
| **Marcar ENTREGADO**                         |  ❌   |     ❌     |      ❌      |      ✅      |
| Reportar incidencia                          |  ✅   |     ✅     |      ✅      |      ✅      |
| Aprobar/rechazar entrega fallida             |  ✅   |     ✅     |      ❌      |      ❌      |
| Reprogramar / ordenar devolución             |  ✅   |     ✅     |      ❌      |      ❌      |
| Corregir dirección                           |  ✅   |     ✅     |      ✅      |   propone    |
| Mover paquetes entre rutas                   |  ✅   |     ✅     |      ✅      |      ❌      |
| Cerrar diferencia de carga                   |  ✅   |     ✅     |      ❌      |      ❌      |
| Alta de usuarios / roles / vehículos         |  ✅   |     ❌     |      ❌      |      ❌      |
| Ver métricas económicas                      |  ✅   |     ❌     |      ❌      |      ❌      |
| **Editar o borrar el event log**             |  ❌   |     ❌     |      ❌      |      ❌      |

### Las dos reglas de oro (aplican incluso al admin)

1. **Solo el chofer puede marcar ENTREGADO**, desde la app, con evidencia y con GPS capturado en el lugar. Nadie puede declarar una entrega desde el panel web. Si esto se rompe, toda la trazabilidad pierde valor probatorio.
2. **El event log es append-only.** No hay UPDATE ni DELETE. Los errores se corrigen agregando un evento de corrección que referencia al anterior (`corrects_event_id`), nunca modificando el original. A nivel base de datos: revocar UPDATE/DELETE sobre la tabla `events` para todos los roles de aplicación.

---

## 4. MÁQUINA DE ESTADOS DEL PAQUETE

```
                    ┌──────────────────────┐
                    │ PENDIENTE_RESOLUCION │ ← ingresó sin destino resuelto
                    └──────────┬───────────┘
                               │ resolver destino
                               ▼
   [ingesta] ──────────────► RECIBIDO
                               │ geocodificar
                               ▼
                          GEOCODIFICADO ◄──┐
                               │           │ reasignar
                               │ asignar   │
                               ▼           │
                           ASIGNADO ───────┘
                               │ chofer toma custodia
                               ▼
                            CARGADO
                               │ iniciar ruta
                               ▼
                          EN_REPARTO
                               │ llegada
                               ▼
                          EN_DOMICILIO
                    ┌──────────┼──────────┐
                    ▼          ▼          ▼
              ENTREGADO   FALLA_REPORTADA  (vuelve a EN_REPARTO)
                 [FINAL]        │
                                │ decide Operaciones
                    ┌───────────┼───────────┐
                    ▼           ▼           ▼
              REPROGRAMADO   DEVUELTO   ENTREGADO
                    │        [FINAL]     (excepción, requiere
                    │                     evidencia del chofer)
                    └──► GEOCODIFICADO (nuevo día)

   Estados de excepción (desde casi cualquier estado, requieren aprobación):
     EXTRAVIADO [FINAL] · DANIADO · CANCELADO [FINAL]
```

### Reglas de transición

- Toda transición se ejecuta **exclusivamente** a través de un servicio central `PackageStateMachine.transition()`. Ningún módulo puede hacer un `UPDATE packages SET status = ...` directo.
- La función valida: (a) que la transición sea legal, (b) que el actor tenga permiso, (c) que se cumplan las precondiciones (ej.: `ENTREGADO` exige evidencia + GPS).
- **Toda transición escribe un evento en `events` dentro de la misma transacción de base de datos.** Si el evento no se puede escribir, la transición se revierte.
- Estados finales (`ENTREGADO`, `DEVUELTO`, `EXTRAVIADO`, `CANCELADO`) son irreversibles: solo un `admin` puede reabrirlos y queda registrado como evento de corrección.
- Transiciones que requieren aprobación de `dispatcher` o `admin`: todo lo que sale de `FALLA_REPORTADA`, y los estados de excepción.

---

## 5. STACK TECNOLÓGICO (DECIDIDO)

### Monorepo

```
Turborepo + pnpm workspaces
```

**Por qué:** el panel web y la app móvil comparten tipos, esquemas Zod, la máquina de estados y los cálculos geográficos. Duplicar eso entre dos repos garantiza que se desincronicen.

### Web (panel administrativo)

```
Next.js 15 (App Router) + React 19
TypeScript strict
Tailwind CSS + shadcn/ui
TanStack Query (server state)
Zustand (client state, mínimo)
React Hook Form + Zod
Lucide React (iconos)
MapLibre GL JS (mapas del panel)
```

**Por qué MapLibre y no Google Maps JS:** el panel muestra mapas de forma continua durante toda la jornada. Google Maps JS cobra por carga de mapa y se dispara. MapLibre es open source y usa tiles gratuitos o baratos. **Google se usa solo donde aporta valor único: geocoding y matriz de distancias reales.**

### Backend

```
Next.js Route Handlers (monolito modular dentro del mismo proyecto)
Zod para validación de todos los inputs
Estructura feature-based, no layer-based
```

**Por qué monolito y no servicio separado:** a 120-2.000 paquetes/día no hay ningún problema de escala que justifique la complejidad operativa de dos deploys. La modularidad interna (`src/modules/*`) permite extraer un servicio después sin reescribir. **Extraer temprano es sobreingeniería.**

**Excepción prevista (FASE 7, opcional):** si el ruteo con OR-Tools resulta necesario, va como microservicio Python/FastAPI separado, porque OR-Tools no tiene equivalente serio en Node.

### Base de datos

```
PostgreSQL (Supabase)
Drizzle ORM
PostGIS habilitado
```

**Por qué Drizzle y no Prisma:** necesitamos control fino de SQL para consultas geoespaciales con PostGIS y compatibilidad limpia con Row Level Security de Supabase. Prisma pelea con ambas cosas.

**Por qué PostGIS:** las consultas de "paquetes dentro de este polígono" y "vecinos más cercanos" son el corazón del agrupamiento. Hacerlo a mano en JavaScript es lento y propenso a errores.

### Mobile

```
React Native + Expo (SDK 52+) con Development Build
expo-camera          → escaneo de códigos
expo-sqlite          → base local offline
expo-location        → GPS foreground + background
expo-file-system     → cola de fotos pendientes
expo-notifications   → push
MLKit Text Recognition (on-device) → OCR de etiquetas
```

**Development Build, NO Expo Go.** Expo Go no soporta ubicación en background ni módulos nativos de OCR. Configurar EAS Build desde la FASE 1 — descubrirlo en la FASE 10 obliga a rehacer.

**Por qué OCR on-device con ML Kit:** es gratis, funciona sin internet y es instantáneo. Google Cloud Vision queda como fallback opcional para etiquetas difíciles (marcar como configurable por variable de entorno).

### Servicios externos

| Servicio                            | Uso                            | Estrategia de costo                                                                             |
| ----------------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------- |
| Google Geocoding API                | dirección → coordenadas        | **Caché agresivo en tabla propia.** Nunca geocodificar dos veces la misma dirección normalizada |
| Google Routes API (Distance Matrix) | distancias reales por calle    | **Solo para secuenciar dentro de una ruta ya formada.** Nunca para clusterizar                  |
| Haversine (cálculo local)           | agrupamiento geográfico        | Gratis, suficiente para clusterizar                                                             |
| Google Maps / Waze                  | navegación del chofer          | Deep link. **Cero costo, cero desarrollo**                                                      |
| Supabase Auth                       | autenticación                  | —                                                                                               |
| Supabase Storage                    | fotos de evidencia y etiquetas | Comprimir a ~1200px antes de subir                                                              |

### NO usar en el MVP

- ❌ Redis / BullMQ → usar tabla de jobs en Postgres. A este volumen alcanza y sobra.
- ❌ WebSockets / tiempo real → polling cada 20-30 s. "Tiempo real" para GPS de camionetas es innecesario y quema batería y datos.
- ❌ Microservicios
- ❌ SDK de navegación propio (Google Navigation SDK es caro; Mapbox cobra por conductor)
- ❌ Integración con API de Mercado Libre (no hay contrato ni credenciales)
- ❌ Docker en desarrollo (Supabase local alcanza)

---

## 6. ESTRUCTURA DEL PROYECTO

```
fyc/
├── apps/
│   ├── web/                          # Next.js — panel administrativo
│   │   └── src/
│   │       ├── app/
│   │       │   ├── (auth)/login/
│   │       │   ├── (dashboard)/
│   │       │   │   ├── operaciones/          # bandeja de excepciones (dispatcher)
│   │       │   │   ├── deposito/             # escaneo, resolución, ruteo, impresión
│   │       │   │   ├── rutas/
│   │       │   │   ├── paquetes/
│   │       │   │   ├── incidencias/
│   │       │   │   ├── soporte/
│   │       │   │   ├── flota/
│   │       │   │   ├── metricas/
│   │       │   │   └── config/
│   │       │   └── api/
│   │       ├── components/
│   │       │   ├── ui/                       # shadcn
│   │       │   ├── maps/
│   │       │   └── [feature]/
│   │       ├── modules/                      # lógica de negocio por feature
│   │       │   ├── ingestion/
│   │       │   ├── geocoding/
│   │       │   ├── routing/
│   │       │   ├── loading/
│   │       │   ├── delivery/
│   │       │   ├── incidents/
│   │       │   └── metrics/
│   │       ├── lib/
│   │       └── hooks/
│   │
│   └── mobile/                       # Expo — app del chofer y del depósito
│       └── src/
│           ├── screens/
│           │   ├── auth/
│           │   ├── onboarding/
│           │   ├── warehouse/                # escaneo + OCR (rol warehouse)
│           │   ├── custody/                  # toma de custodia + conteo
│           │   ├── route/                    # lista de paradas, mapa
│           │   ├── delivery/                 # entrega + evidencia
│           │   ├── incident/
│           │   └── support/
│           ├── db/                           # SQLite local
│           ├── sync/                         # outbox, cola, reintentos
│           ├── location/                     # tracking GPS
│           └── components/
│
├── packages/
│   ├── shared/                       # tipos, Zod schemas, constantes
│   ├── state-machine/                # máquina de estados (usada por web Y mobile)
│   ├── geo/                          # haversine, clustering, normalización
│   └── config/                       # eslint, tsconfig, tailwind compartidos
│
├── supabase/
│   ├── migrations/
│   └── seed.sql
│
├── docs/
│   ├── ARQUITECTURA.md
│   ├── MODELO-DATOS.md
│   ├── API.md
│   ├── OPERACION.md                  # manual del proceso real
│   └── DECISIONES.md                 # ADR: cada decisión técnica y su porqué
│
├── .env.example
├── turbo.json
└── README.md
```

---

## 7. MODELO DE DATOS

### Convenciones obligatorias

- `snake_case` en base de datos, `camelCase` en TypeScript
- Toda tabla: `id UUID PK DEFAULT gen_random_uuid()`, `created_at`, `updated_at`
- Soft delete con `deleted_at` en tablas de negocio (**excepto `events`**, que no se borra jamás)
- **`org_id UUID NOT NULL` en TODAS las tablas de negocio desde el día 1.** Hoy hay una sola organización. Agregarlo después cuesta una migración dolorosa; agregarlo ahora cuesta una columna.
- Enums de Postgres para estados, nunca strings libres
- Índice en toda foreign key y en toda columna de búsqueda

### Tablas

**Organización y usuarios**

```
organizations          id, name, timezone, settings jsonb
users                  id (= auth.users.id), org_id, email, full_name, phone,
                       is_active, deleted_at
user_roles             id, user_id, role (enum: admin|dispatcher|warehouse|driver)
                       UNIQUE(user_id, role)
```

**Clientes y operaciones**

```
clients                id, org_id, name, contact, pricing_config jsonb, is_active
                       -- proveedores de paquetes (hoy: uno)

operations             id, org_id, operation_date, status (enum), expected_count,
                       received_count, notes, created_by
                       UNIQUE(org_id, operation_date)
```

**Direcciones**

```
known_addresses        id, org_id, normalized_hash (UNIQUE), raw_text,
                       street, number, floor, apartment, locality, municipality,
                       province, postal_code,
                       lat, lng, geom geography(Point,4326),
                       geocode_source, geocode_accuracy (enum: ROOFTOP|INTERPOLATED|
                       APPROXIMATE|MANUAL|FAILED),
                       operational_notes text,      -- "timbre no anda"
                       delivery_success_count, delivery_fail_count,
                       verified_by_driver boolean
                       ÍNDICE GIST sobre geom

geocode_cache          id, query_hash UNIQUE, provider, raw_response jsonb,
                       lat, lng, accuracy, created_at
```

> El caché es una tabla separada del catálogo de direcciones a propósito: guarda la respuesta cruda del proveedor para poder reprocesar sin volver a pagar.

**Paquetes**

```
packages               id, org_id, client_id, operation_id,
                       tracking_code,               -- código del proveedor
                       internal_code UNIQUE,        -- código propio para etiqueta/QR
                       status (enum: máquina de estados),
                       recipient_name, recipient_phone, recipient_document_hash,
                       address_id → known_addresses,
                       raw_address_text,            -- lo que se leyó, sin normalizar
                       destination_source (enum: MANIFEST|BARCODE_PAYLOAD|OCR|
                                                 MANUAL|ADDRESS_MEMORY),
                       destination_confidence (enum: HIGH|MEDIUM|LOW),
                       label_photo_url,
                       weight_kg, dimensions jsonb, declared_value,
                       requires_photo boolean, requires_document boolean,
                       priority int, delivery_attempts int,
                       route_id, bulk_number,       -- Nº de bulto (va en la etiqueta)
                       deleted_at
                       ÍNDICES: (org_id, status), (operation_id), (route_id),
                                (tracking_code), (internal_code)

package_scans          id, package_id NULLABLE, org_id,
                       raw_code text NOT NULL,      -- ← CRUDO, SIN PARSEAR, JAMÁS
                       code_format (enum: QR|CODE_128|CODE_39|PDF417|DATA_MATRIX|
                                          EAN_13|OTHER|MANUAL),
                       scanned_by, scanned_at, device_id,
                       lat, lng,
                       scan_context (enum: INTAKE|SORTING|LOADING|DELIVERY|AUDIT),
                       photo_url, ocr_raw_text, ocr_confidence numeric
                       ÍNDICE: (raw_code), (package_id)
```

**Rutas y contenedores**

```
containers             id, org_id, code UNIQUE, qr_payload, type (enum: BAG|CART|
                       CAGE|SHELF), is_active
                       -- físicos y reutilizables: bolsas, carros, jaulas

routes                 id, org_id, operation_id, route_number, container_id,
                       status (enum: DRAFT|PROPOSED|APPROVED|ASSIGNED|LOADING|
                                     LOADED|IN_TRANSIT|COMPLETED|CANCELLED),
                       assigned_driver_id, vehicle_id,
                       planned_distance_m, planned_duration_s, planned_stops,
                       actual_distance_m, actual_duration_s,
                       started_at, completed_at,
                       zone_label, color_hex,       -- para la etiqueta impresa
                       optimization_metadata jsonb

route_stops            id, route_id, package_id,
                       sequence int,                -- ← RECALCULABLE
                       planned_arrival, actual_arrival,
                       distance_from_prev_m, duration_from_prev_s,
                       status (enum: PENDING|ARRIVED|COMPLETED|SKIPPED|FAILED)
                       UNIQUE(route_id, package_id)
```

> **REGLA DE DISEÑO CRÍTICA — separar bulto de parada:**
> `packages.bulk_number` es la **identidad física** del paquete dentro de la ruta. Se imprime en la etiqueta y **NUNCA cambia**.
> `route_stops.sequence` es la **posición en la secuencia de entrega**. Se recalcula las veces que haga falta.
> La app le dice al chofer: _"Parada 5 de 42 → buscá el BULTO 17"_.
> Si se imprimiera el número de parada, cualquier reoptimización dejaría todas las etiquetas mintiendo, y el chofer dejaría de confiar en la app. **Esto no es negociable.**

**Carga y custodia**

```
custody_transfers      id, org_id, route_id, container_id,
                       from_user_id, to_user_id,
                       expected_count, counted_count,
                       method (enum: COUNT|FULL_SCAN),
                       status (enum: OK|DISCREPANCY|RESOLVED|OVERRIDDEN),
                       discrepancy_notes,
                       resolved_by, resolved_at, override_reason,
                       lat, lng, transferred_at
```

**Entregas y evidencia**

```
deliveries             id, org_id, package_id UNIQUE, route_id, driver_id,
                       vehicle_id,
                       outcome (enum: DELIVERED|FAILED),
                       receiver_name, receiver_relationship,
                       document_last4, document_hash,   -- NUNCA el DNI completo
                       signature_url, photo_urls text[],
                       lat, lng, gps_accuracy_m,
                       distance_from_target_m,          -- ← control anti-fraude
                       delivered_at, synced_at,
                       device_id, idempotency_key UNIQUE NOT NULL,
                       offline_created boolean
```

**Incidencias y soporte**

```
incidents              id, org_id, package_id, route_id, driver_id,
                       reason (enum: NO_ONE_HOME|NO_ANSWER|WRONG_ADDRESS|
                               NONEXISTENT_ADDRESS|REFUSED|NO_ACCESS|
                               UNSAFE_AREA|VEHICLE_ISSUE|DAMAGED|MISSING_BULK|OTHER),
                       description, photo_urls text[], lat, lng,
                       status (enum: OPEN|ASSIGNED|RESOLVED|ESCALATED),
                       resolution (enum: RETRY_NOW|RESCHEDULE|RETURN|
                                   DELIVER_ANYWAY|CANCEL),
                       resolved_by, resolved_at, response_time_s,
                       proposed_address_text              -- corrección del chofer

support_tickets        id, org_id, ticket_number, driver_id, package_id, route_id,
                       category (enum), subject, status, priority,
                       assigned_to, created_at, closed_at

ticket_messages        id, ticket_id, user_id, message, attachment_url, created_at
```

**Flota**

```
vehicles               id, org_id, plate UNIQUE, brand, model, year,
                       capacity_packages, capacity_m3, capacity_kg,
                       status (enum: AVAILABLE|IN_ROUTE|MAINTENANCE|OUT_OF_SERVICE),
                       current_odometer, insurance_expiry, vtv_expiry,
                       assigned_driver_id
```

**GPS**

```
driver_locations       id, org_id, driver_id, route_id,
                       lat, lng, accuracy_m, speed_mps, heading,
                       battery_level, is_moving,
                       recorded_at,        -- ← hora del dispositivo
                       received_at         -- ← hora del servidor
                       PARTICIONADA POR MES
                       ÍNDICE: (driver_id, recorded_at DESC)
                       RETENCIÓN: 90 días, después se agrega y se purga
```

> `recorded_at` y `received_at` separados es indispensable: con sincronización offline, los puntos llegan minutos u horas después de haberse generado. Confundirlos rompe la reconstrucción del recorrido.

**Auditoría (el corazón del sistema)**

```
events                 id, org_id,
                       entity_type (enum: PACKAGE|ROUTE|DELIVERY|INCIDENT|
                                    CUSTODY|USER|VEHICLE|OPERATION),
                       entity_id,
                       event_type varchar,
                       actor_id, actor_role,
                       previous_state, new_state,
                       lat, lng,
                       metadata jsonb,
                       corrects_event_id → events.id NULLABLE,
                       occurred_at,        -- cuándo pasó de verdad
                       recorded_at         -- cuándo lo recibió el servidor
                       -- SIN updated_at, SIN deleted_at: APPEND ONLY
                       ÍNDICES: (entity_type, entity_id, occurred_at),
                                (org_id, occurred_at DESC)
                       PARTICIONADA POR MES

                       ⚠️ REVOCAR UPDATE Y DELETE a nivel Postgres para
                       todos los roles de aplicación
```

**Sincronización offline**

```
sync_queue             id, device_id, user_id, idempotency_key UNIQUE,
                       operation_type, payload jsonb,
                       status (enum: PENDING|PROCESSING|COMPLETED|FAILED|CONFLICT),
                       attempts int, last_error, client_timestamp, processed_at
```

### Row Level Security (Supabase)

RLS activado en **todas** las tablas. Políticas:

- Aislamiento por `org_id` en todo (preparado para multi-tenant futuro)
- `driver` accede solo a paquetes de rutas asignadas a él y del día en curso
- `warehouse` accede solo a operaciones no cerradas
- `dispatcher` y `admin` acceden a toda la organización
- `events`: SELECT según rol, **INSERT vía función SECURITY DEFINER únicamente**, UPDATE y DELETE revocados para todos
- Las políticas se prueban con tests automatizados, no "a ojo"

---

## 8. AGRUPAMIENTO Y RUTEO

### Principio rector

> Con 40 paradas en un radio de 6 km, un chofer con dos meses de zona le empata o le gana al algoritmo, porque sabe dónde no hay nadie a las 10 de la mañana.
> **El sistema PROPONE. El humano DISPONE. El chofer puede reordenar con el dedo.**
> Si el orden se impone, el chofer abandona la app y se pierde la trazabilidad, que es lo que realmente importaba.

### Estrategia híbrida en 3 etapas

**ETAPA 1 — Clustering geográfico (local, gratis, instantáneo)**

No usar K-Means puro: genera clusters desbalanceados y no respeta capacidad.

```
1. Filtrar paquetes con geocoding confiable (excluir accuracy = APPROXIMATE o FAILED
   → esos van a bandeja de revisión manual)
2. Separar por macro-zona (Norte / Sur) si están operativamente separadas
3. Aplicar CAPACITATED K-MEANS con distancia haversine:
   - k = cantidad de choferes disponibles
   - restricción dura: ningún cluster supera la capacidad del vehículo
   - restricción blanda: balancear cantidad (±15% entre rutas)
   - inicialización K-Means++ para estabilidad
4. Refinamiento: mover puntos de frontera al cluster vecino si mejora
   el balance sin empeorar la compacidad
5. Detectar OUTLIERS con DBSCAN: puntos aislados a >5 km del cluster más cercano
   → marcarlos y avisar al operador. Un solo paquete lejos puede costar 40 minutos
     y muchas veces conviene reprogramarlo, no rutearlo
```

Costo: cero. Tiempo: menos de 1 segundo para 120 puntos.

**ETAPA 2 — Secuenciación dentro de cada ruta (acá sí se paga)**

```
1. Obtener matriz de distancias/tiempos REALES por calle (Google Routes API)
   → solo dentro del cluster: 40 puntos = 1.600 celdas, no 120×120 = 14.400
   → CACHEAR agresivamente: los pares de direcciones se repiten mucho entre días
2. Construir secuencia inicial con NEAREST NEIGHBOR desde el depósito
3. Mejorar con 2-OPT hasta convergencia o límite de tiempo (5 s máximo)
4. Aplicar restricciones duras:
   - prioridades y franjas horarias si existen
   - calles de mano única y giros prohibidos (los resuelve la API de rutas)
5. Devolver: secuencia, distancia total, duración estimada, ETA por parada
```

**ETAPA 3 — Ajuste humano (obligatorio, no opcional)**

Interfaz de ruteo con:

- Mapa con clusters en colores y trazado de la ruta
- Arrastrar un paquete de una ruta a otra → **recalcula en vivo** distancia, tiempo y balance
- Dividir ruta / fusionar rutas
- Fijar un paquete a una ruta específica (bloqueo manual)
- Panel comparativo lado a lado: paquetes, km, tiempo estimado, balance
- Alertas: _"Ruta 3 tiene 42 paquetes y 78 km — 35% más que el promedio"_
- Botón APROBAR → recién ahí se congelan los números de bulto y se habilita imprimir

### Los tres conceptos de distancia (no confundir nunca)

| Concepto                      | Cómo se calcula      | Para qué se usa                      | Costo  |
| ----------------------------- | -------------------- | ------------------------------------ | ------ |
| **Distancia geográfica**      | Haversine, local     | Clustering, detección de outliers    | Gratis |
| **Distancia real por calles** | Routes API           | Secuenciación, métricas, costeo      | Pago   |
| **Tiempo estimado de viaje**  | Routes API + tráfico | ETA, planificación, balance de rutas | Pago   |

Nunca clusterizar con distancia real (n² llamadas = costo explosivo). Nunca secuenciar con haversine (ignora ríos, autopistas, manos únicas — en el GBA eso da rutas absurdas).

### Escalera de evolución

- **MVP:** capacitated k-means + nearest neighbor + 2-opt en TypeScript
- **V2:** OR-Tools como microservicio Python/FastAPI cuando aparezcan ventanas horarias, multi-depósito o >500 paquetes/día
- **V3:** aprendizaje de tiempos reales de servicio por dirección y por chofer, para que las estimaciones dejen de ser teóricas

---

## 9. FLUJOS OPERATIVOS

### 9.1 Recepción y captura (DÍA -1, depósito)

```
1. Crear operación del día → fecha, cantidad esperada, cliente
2. [Opcional] Importar manifiesto CSV/XLSX con mapeo de columnas
3. Escaneo en loop (app móvil, rol warehouse):
   a. Escanear código → guardar CRUDO siempre
   b. Cascada de resolución (sección 2)
   c. Si resolvió con confianza HIGH → confirmación de un toque
   d. Si resolvió con MEDIUM (OCR) → mostrar foto + campos editables → confirmar
   e. Si no resolvió → a la bandeja, seguir escaneando (NO bloquear el flujo)
4. Resolver la bandeja pendiente (pantalla dedicada: foto | formulario)
5. Geocodificar en lote (job en background, con barra de progreso)
6. Revisar direcciones con geocoding dudoso en mapa
```

**Casos borde obligatorios:**

| Caso                                   | Comportamiento                                                              |
| -------------------------------------- | --------------------------------------------------------------------------- |
| Código no existe en el manifiesto      | Ingresa igual, marcado como `NO_MANIFEST`, alerta al operador               |
| Código escaneado dos veces             | Feedback inmediato: _"Ya escaneado hace 4 min por Juan"_. No duplica        |
| Paquete de otro cliente                | Detectar por prefijo del código; marcar `WRONG_CLIENT`, apartar físicamente |
| Falta información                      | Ingresa a bandeja; nunca se pierde                                          |
| Manifiesto dice 120, se escanearon 117 | Al cerrar: reporte de faltantes con códigos, reclamable al proveedor        |
| Se escanearon 122                      | Reporte de sobrantes; decidir si se reparten o se devuelven                 |

### 9.2 Ruteo e impresión (DÍA -1)

```
1. Ejecutar agrupamiento → rutas propuestas
2. Operador ajusta en la interfaz de mapa
3. APROBAR RUTAS → se congelan los números de bulto
4. Imprimir etiquetas
5. Clasificar físicamente: pila / bolsa por ruta
```

**Formato de etiqueta (impresora térmica 100×150mm o A4 autoadhesiva):**

```
┌────────────────────────────────┐
│  RUTA 002  ·  BULTO 17         │  ← tamaño máximo, legible a 2 m
│  ══════════════════════════    │  ← banda de color de la ruta
│                                │
│  Av. San Martín 1234           │  ← grande, legible a 1 m
│  Piso 3 Depto B                │
│  Villa Ballester               │  ← mediano
│                                │
│  Juan Pérez                    │
│  [QR interno]     #ML-4471829  │  ← chico
└────────────────────────────────┘
```

**El QR debe ser INTERNO (`packages.internal_code`), no el del proveedor.** Así el sistema controla qué significa cada código y no depende de formatos ajenos.

### 9.3 Toma de custodia (DÍA 0, mañana)

```
1. Chofer abre la app → ve su ruta asignada
2. Escanea el QR del CONTENEDOR → se abre el acta de custodia
3. Pantalla: "RUTA 002 — Esperados: 42 bultos"
4. Chofer cuenta y tipea la cantidad

   Si coincide → CONFIRMAR → custodia transferida (95% de los días)

   Si NO coincide → ESCANEO INDIVIDUAL OBLIGATORIO de esa ruta
                 → el sistema indica exactamente qué bulto falta o sobra
                 → notificación a Operaciones
                 → la ruta NO puede iniciar hasta resolver
                 → un dispatcher puede forzar el inicio, pero queda registrado
                   con motivo obligatorio (override_reason)
```

**Chequeo cruzado en ruta (mecanismo clave):**
El conteo detecta faltantes, pero **NO detecta el error más común: un bulto de la ruta 2 que quedó en la bolsa de la ruta 3.** Da 42 y 42, todo "correcto", y a la tarde hay dos entregas fallidas.

Solución: cuando el chofer no encuentra un bulto durante el reparto, marca **"BULTO NO ENCONTRADO"** y el sistema lo busca automáticamente en las demás rutas activas y notifica a ambos choferes y a Operaciones.

> **Por qué NO se escanean los 42 todas las mañanas:** son 8-10 minutos por chofer por día para atrapar un error que ocurre una vez por semana. El chequeo cruzado en ruta es más barato y más efectivo.

### 9.4 Inicio de ruta

Validaciones bloqueantes antes de habilitar INICIAR RUTA:

- Custodia transferida y sin diferencias abiertas
- Vehículo asignado y en estado `AVAILABLE`
- Permisos de ubicación concedidos (incluyendo _background_)
- GPS encendido y con precisión < 50 m
- **Optimización de batería desactivada para la app** (en Android es la causa #1 de pérdida de tracking)
- Datos de la ruta descargados completos a SQLite local
- Batería > 20% (advertencia, no bloqueo)

### 9.5 Entrega

```
PANTALLA DE PARADA
  "Parada 5 de 42"
  "BUSCÁ EL BULTO 17"          ← lo más grande de la pantalla
  Juan Pérez
  Av. San Martín 1234, Piso 3 B
  Villa Ballester
  ⚠️ "Timbre no anda — llamar"  ← nota operativa de known_addresses

  [ IR CON GOOGLE MAPS ]  [ LLAMAR ]
  [ ENTREGAR ]  [ PROBLEMA ]
```

**Navegación: deep link, NO navegación propia.**
Enviar **coordenadas, no texto**, porque Google puede reinterpretar la dirección y mandar al chofer a otro partido. La geocodificación ya fue validada por un humano la noche anterior.

```
google.navigation:q=<lat>,<lng>&mode=d
waze://?ll=<lat>,<lng>&navigate=yes
```

**Flujo de entrega (máximo 3 toques):**

```
1. ENTREGAR
2. Nombre de quien recibe (con sugerencias del destinatario esperado)
3. Foto  → CONFIRMAR
```

Se capturan automáticamente, sin intervención: GPS, precisión, timestamp, `distance_from_target_m`, chofer, vehículo, ruta, dispositivo.

**Control anti-fraude:** si `distance_from_target_m > 150 m`, se pide confirmación explícita y se marca el evento para revisión. No bloquea (puede ser un error de geocoding), pero queda registrado.

### 9.6 Política de evidencia

| Elemento            | Política                                                                                                                                                                        | Justificación                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| GPS + timestamp     | **Siempre, automático**                                                                                                                                                         | Costo cero, valor probatorio alto                                                    |
| Nombre del receptor | **Obligatorio**                                                                                                                                                                 | Un campo, alto valor                                                                 |
| Foto                | **Obligatoria si**: nadie firma, se deja en portería, valor declarado alto, es reintento, hubo incidencia previa en esa dirección, o el cliente lo exige. **Opcional el resto** | Opción D del análisis: por regla, no por defecto ciego                               |
| Firma               | **No en el MVP**                                                                                                                                                                | Fricción alta, valor probatorio bajo (un garabato en pantalla no identifica a nadie) |
| Documento           | **Solo si el cliente lo exige.** Guardar `document_last4` + hash. **NUNCA foto del documento, NUNCA el número completo**                                                        | Ver sección 11                                                                       |

### 9.7 Incidencias con aprobación

**El chofer NO puede cerrar un paquete como fallido por su cuenta.**

```
CHOFER: [PROBLEMA] → selecciona motivo → foto (obligatoria) → comentario
   → paquete pasa a FALLA_REPORTADA
   → notificación push a Operaciones + fila en la bandeja de excepciones
   → el chofer PUEDE SEGUIR con la parada siguiente (no queda trabado)

OPERACIONES ve:
   🚨 Paquete #92837 · Ruta 002 · Federico
      Motivo: Cliente no responde
      Foto · Ubicación · Hace 3 min
      [LLAMAR AL CLIENTE] [REINTENTAR HOY] [REPROGRAMAR]
      [DEVOLVER A DEPÓSITO] [ENTREGAR IGUAL]

   → la decisión se sincroniza a la app del chofer
   → si es REINTENTAR HOY, la parada se reinserta en la secuencia
```

**SLA interno:** si nadie responde en 10 minutos, la incidencia escala y se resuelve por default con `RETURN` (devolver a depósito). Nunca queda un chofer esperando indefinidamente.

### 9.8 Dirección incorrecta

```
Chofer reporta → foto + GPS actual + comentario + dirección correcta si la encuentra
   → se guarda como propuesta, NO se sobrescribe nada
   → Operaciones aprueba
   → recién ahí se actualiza known_addresses
   → LA DIRECCIÓN ORIGINAL NUNCA SE PIERDE (queda en packages.raw_address_text
     y en el event log)
   → la corrección se aplica a futuras entregas a esa misma dirección
```

### 9.9 Cierre del día

Ecuación de reconciliación obligatoria:

```
CARGADOS = ENTREGADOS + FALLIDOS + DEVUELTOS + EN_DEPÓSITO
```

Si no cierra, la operación no se puede cerrar y se genera una alerta. Los paquetes devueltos se escanean al reingresar al depósito.

---

## 10. GPS Y TRACKING

### Configuración

| Situación                    | Frecuencia        | Precisión                                       |
| ---------------------------- | ----------------- | ----------------------------------------------- |
| Ruta activa, en movimiento   | cada 30 s o 100 m | Balanced                                        |
| Ruta activa, detenido >5 min | cada 2 min        | Balanced                                        |
| Cerca de una parada (<200 m) | cada 15 s         | High                                            |
| Momento de la entrega        | puntual           | Best (bloqueante hasta <30 m o 15 s de timeout) |
| Fuera de ruta                | **APAGADO**       | —                                               |

**El tracking se enciende con INICIAR RUTA y se apaga con FINALIZAR RUTA. Nunca fuera del horario de trabajo.** Esto no es solo privacidad: es lo que hace que el permiso sea defendible ante Google Play y ante el trabajador.

### Manejo offline

- Los puntos se acumulan en SQLite local con `recorded_at` del dispositivo
- Se envían en lotes de 50, comprimidos
- Reintentos con backoff exponencial
- El panel muestra siempre: **"Última ubicación conocida hace X minutos"** — nunca una posición vieja disfrazada de actual

### Panel: alerta de silencio

Si un chofer no reporta durante más de 15 minutos con ruta activa → alerta en la bandeja de excepciones. Puede ser sin señal, batería muerta, o un problema real.

### Retención y privacidad

- Puntos crudos: 90 días. Después se agregan a resumen diario (km, tiempo en movimiento, tiempo detenido) y se purgan.
- El chofer debe poder ver **su propio historial** desde la app.
- Aviso explícito en la app: qué se rastrea, cuándo, y por qué.
- Base legal: ejecución del contrato laboral, limitado a jornada y a vehículo de trabajo.

---

## 11. DATOS PERSONALES Y DOCUMENTO DEL RECEPTOR

> ⚠️ **Advertencia:** esto no es asesoramiento legal. Antes de producción, validar con un abogado especializado en protección de datos (Ley 25.326 y normativa de la AAIP).

### Recomendación técnica

Pedir el DNI en cada entrega genera fricción, produce rechazos legítimos del receptor (nadie está obligado a mostrarle el documento a un repartidor) y convierte al negocio en responsable de una base de datos sensible. **La relación costo/beneficio es mala.**

**Política recomendada:**

| Dato                      | Tratamiento                                                                                                                          |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Nombre del receptor       | Se guarda en claro. Es evidencia suficiente en la enorme mayoría de los casos                                                        |
| Documento                 | **Solo si el cliente lo exige por contrato.** Se guardan últimos 4 dígitos + hash con salt. El número completo **nunca** se persiste |
| Foto del documento        | **NUNCA.** Desproporcionado para el fin, y es el punto que más fácilmente genera un problema legal                                   |
| Teléfono del destinatario | Solo el equipo operativo; se purga a los 90 días del cierre                                                                          |
| Fotos de evidencia        | Retención 180 días; después se borran automáticamente por job                                                                        |
| Ubicación del chofer      | Retención 90 días                                                                                                                    |

### Medidas técnicas obligatorias

- Cifrado en tránsito (HTTPS) y en reposo (Supabase lo provee)
- Buckets de Storage **privados**, acceso solo por URLs firmadas de corta duración
- Acceso a datos sensibles restringido por RLS y por rol
- **Todo acceso a datos personales queda registrado en el event log**
- Job automático de purga por política de retención
- Endpoint de exportación y borrado de datos de un titular (derecho de acceso y supresión)
- Política de privacidad publicada, requisito de Google Play

---

## 12. OFFLINE-FIRST (LA APP DEL CHOFER)

**Premisa:** el chofer va a perder señal. Si una entrega registrada se pierde, el sistema es peor que el papel.

### Debe funcionar sin internet

| Función                                          | Offline                                 |
| ------------------------------------------------ | --------------------------------------- |
| Ver ruta, paradas, direcciones, teléfonos, notas | ✅ completo                             |
| Ver el mapa de la ruta                           | ✅ (tiles precargados al iniciar)       |
| Marcar llegada                                   | ✅                                      |
| Registrar entrega con evidencia                  | ✅                                      |
| Sacar foto                                       | ✅ (queda en cola)                      |
| Reportar incidencia                              | ✅                                      |
| Registrar GPS                                    | ✅                                      |
| Escanear códigos                                 | ✅                                      |
| **Recibir la decisión de Operaciones**           | ❌ requiere conexión (avisar al chofer) |
| **Ver ubicación de otros choferes**              | ❌                                      |

### Patrón obligatorio: Outbox con idempotencia

```
1. Toda acción se escribe PRIMERO en SQLite local con un idempotency_key
   generado en el dispositivo (UUID v4)
2. La UI responde inmediatamente (optimistic update)
3. Un worker de sincronización intenta enviar en background
4. El servidor deduplica por idempotency_key — reenviar es SIEMPRE seguro
5. Reintentos con backoff exponencial: 5s, 15s, 1m, 5m, 15m, 1h
6. Las fotos van en cola aparte (más pesadas), comprimidas a ~1200px
7. Badge visible permanente: "3 acciones pendientes de sincronizar"
8. NUNCA se borra nada local hasta confirmación explícita del servidor
```

### Resolución de conflictos

- Entrega registrada offline vs. paquete reasignado en el servidor → **gana la entrega del chofer** (él estuvo físicamente ahí), se genera alerta para Operaciones
- Dos dispositivos reportan el mismo paquete → gana el más antiguo por `client_timestamp`, el segundo queda como `CONFLICT` para revisión manual
- Nunca descartar datos silenciosamente: todo conflicto es visible y auditable

---

## 13. UX/UI

### Sistema de diseño

```css
/* Tipografía */
Inter (variable) — via next/font y expo-font

/* Neutros sofisticados — nunca negro puro ni blanco puro */
--bg:            #FAFAF9
--surface:       #FFFFFF
--border:        #E7E5E4
--text:          #1C1917
--text-muted:    #78716C

/* Dark mode (app del chofer: obligatorio) */
--bg-dark:       #0C0A09
--surface-dark:  #1C1917

/* Acento */
--primary:       #2563EB

/* Estados — semántica fija en todo el producto */
--pending:       #78716C   gris
--in-progress:   #2563EB   azul
--success:       #16A34A   verde
--warning:       #EA580C   naranja
--danger:        #DC2626   rojo
--info:          #7C3AED   violeta

/* Escala de espaciado: 8px */
4 · 8 · 16 · 24 · 32 · 48 · 64

/* Radios */
--radius-sm: 6px · --radius-md: 12px · --radius-lg: 16px

/* Transiciones */
--transition-fast: 150ms cubic-bezier(0.4, 0, 0.2, 1)
--transition-base: 250ms cubic-bezier(0.4, 0, 0.2, 1)
```

**Regla de accesibilidad:** el color nunca es el único portador de información. Siempre acompañado de ícono o texto (hay choferes daltónicos).

### App del chofer — restricciones de diseño duras

El contexto de uso es: **sol directo, una sola mano, apurado, a veces con guantes, pantalla sucia.**

- Touch targets **mínimo 56×56 px** (el estándar de 44 no alcanza acá)
- Tipografía base mínima **18 px**; datos críticos (Nº de bulto, dirección) a **28 px o más**
- **Máximo 2 acciones primarias por pantalla**
- Cero menús anidados; navegación plana
- Feedback háptico en toda confirmación importante
- Contraste alto obligatorio; probar la UI a máximo brillo bajo sol
- **La pantalla de parada debe leerse en menos de 2 segundos**

### Panel de Operaciones — bandeja de excepciones

Nadie mira un mapa 8 horas. La pantalla principal del `dispatcher` **no es un mapa**: es una lista priorizada de lo que está mal ahora.

```
🔴 URGENTE
   Federico · Paquete #92837 · "Cliente no responde" · hace 4 min
   [LLAMAR] [REINTENTAR] [REPROGRAMAR] [DEVOLVER]

🟠 ATENCIÓN
   Lucas · sin señal GPS hace 22 min
   Martín · detenido 12 min en la parada 18

🟡 SEGUIMIENTO
   Ruta 003 · 40 min de atraso respecto de lo estimado
```

El mapa es una pestaña secundaria. **El valor está en que el sistema diga dónde mirar**, porque un humano no puede vigilar 3 rutas y 120 paquetes con los ojos.

### Estados obligatorios en toda vista

Loading (skeletons, no spinners) · Empty (con acción sugerida) · Error (con reintento) · Offline (banner persistente) · Success (feedback inmediato).

### Onboarding de la app (5 pantallas, salteable, re-accesible desde Ayuda)

1. Bienvenida y para qué sirve la app
2. Cómo tomar la carga (escanear contenedor + contar)
3. Cómo hacer una entrega (los 3 toques)
4. Qué hacer si hay un problema (botón PROBLEMA)
5. Permisos: ubicación, cámara, batería — **explicando el porqué de cada uno antes de pedirlo**

---

## 14. FASES DE DESARROLLO

> **Al terminar cada fase: probar → documentar → commit → PARAR y esperar aprobación.**

### FASE 1 — Scaffolding y arquitectura

- Turborepo + pnpm workspaces
- `apps/web` (Next.js 15, TS strict, Tailwind, shadcn/ui)
- `apps/mobile` (Expo + Development Build + **EAS configurado desde ahora**)
- `packages/shared`, `packages/state-machine`, `packages/geo`, `packages/config`
- ESLint + Prettier + Husky + commitlint
- GitHub Actions: lint + typecheck + test en cada PR
- `.env.example` completo y `README.md` con setup reproducible
- `docs/DECISIONES.md` inicial

**Criterio de aceptación:** `pnpm dev` levanta web y mobile; `pnpm typecheck` y `pnpm lint` pasan sin errores.

### FASE 2 — Base de datos

- Migraciones Drizzle con **todas** las tablas de la sección 7
- Todos los enums, índices y constraints
- PostGIS habilitado; índice GIST sobre `known_addresses.geom`
- Particionado mensual de `events` y `driver_locations`
- **RLS activo en todas las tablas** con las políticas de la sección 7
- Trigger/función que impide UPDATE y DELETE sobre `events`
- Seed con datos realistas: 1 org, 4 usuarios (uno por rol), 3 vehículos, 5 contenedores, 120 paquetes de prueba con direcciones reales del GBA
- `docs/MODELO-DATOS.md` con diagrama

**Criterio de aceptación:** tests automatizados que verifican que un `driver` no puede leer paquetes de otra ruta, y que nadie puede hacer UPDATE sobre `events`.

### FASE 3 — Core de dominio y backend

- `packages/state-machine`: máquina de estados completa, con tests unitarios de **todas** las transiciones legales e ilegales
- Servicio de eventos (append-only, transaccional con cada transición)
- Auth con Supabase + middleware de roles y permisos
- Route Handlers por módulo, con validación Zod en **todos** los inputs
- Manejo de errores centralizado con `AppError`
- Respuesta estándar: `{ success, data, meta }` / `{ success, error: { code, message } }`
- Paginación en todos los endpoints de lista
- Rate limiting
- Logger estructurado
- `docs/API.md`

**Criterio de aceptación:** cobertura de tests > 80% en la máquina de estados; ningún endpoint sin validación.

### FASE 4 — Panel web: base

- Layout, sidebar por rol, navegación
- Login y gestión de sesión
- CRUD de usuarios, vehículos, clientes, contenedores
- Design system aplicado (tokens de la sección 13)
- Estados de loading/empty/error en todas las vistas
- Responsive

### FASE 5 — Ingesta y resolución de destino

- Interfaz `IngestionAdapter` + los 5 adaptadores de la cascada
- Importador CSV/XLSX con mapeo visual de columnas
- Parser de códigos con detección de formato y **guardado del string crudo**
- Pantalla de **bandeja de resolución** (foto de la etiqueta | formulario)
- Servicio de geocoding con caché y normalización de direcciones argentinas
- `known_addresses` con matching por hash normalizado
- Detección de duplicados y de paquetes de otro cliente
- Vista de revisión de geocoding dudoso sobre mapa
- Cierre de operación con reporte de faltantes y sobrantes

**Criterio de aceptación:** importar un CSV de 120 filas, geocodificar con caché funcionando (segunda corrida = 0 llamadas a la API), y resolver manualmente los casos fallidos.

### FASE 6 — Ruteo

- `packages/geo`: haversine, capacitated k-means, DBSCAN para outliers
- Secuenciación: nearest neighbor + 2-opt
- Integración con Routes API para la matriz, **con caché**
- Interfaz de ruteo: mapa MapLibre, drag & drop entre rutas, dividir, fusionar, fijar
- Recálculo en vivo de km, tiempo y balance
- Alertas de desbalance y de outliers
- Aprobación de rutas → congela `bulk_number`
- Generación e impresión de etiquetas (formato sección 9.2), en PDF listo para térmica y para A4

**Criterio de aceptación:** con los 120 paquetes de seed, generar 3 rutas balanceadas (±15%), ajustarlas manualmente e imprimir las etiquetas.

### FASE 7 — App mobile: base y offline

- Navegación, autenticación, onboarding
- SQLite local con esquema espejo
- **Motor de sincronización con outbox e idempotencia** (sección 12)
- Indicadores de estado de conexión y de cola pendiente
- Descarga completa de la ruta a local
- Design system mobile, dark mode

**Criterio de aceptación:** poner el dispositivo en modo avión, registrar 5 acciones, restaurar conexión y verificar que las 5 llegan exactamente una vez.

### FASE 8 — Escaneo móvil y OCR

- Cámara con escaneo de códigos multiformato
- Captura de foto de etiqueta con guía de encuadre, flash automático y **rechazo de fotos borrosas**
- OCR on-device con ML Kit + parser de direcciones argentinas
- Pantalla de confirmación: foto a un lado, campos editables al otro
- Modo depósito (rol `warehouse`): escaneo en loop de alta velocidad
- Feedback sonoro y háptico diferenciado: OK / duplicado / error

**Criterio de aceptación:** escanear 20 etiquetas reales y medir el porcentaje de campos correctos del OCR. Documentar el resultado.

### FASE 9 — Custodia y carga

- Escaneo del contenedor → acta de custodia
- Conteo rápido y flujo de escaneo individual ante diferencia
- Identificación exacta de bulto faltante o sobrante
- Bloqueo de inicio de ruta con diferencia abierta
- Override de `dispatcher` con motivo obligatorio
- Notificaciones a Operaciones
- Checklist de validaciones de inicio de ruta (sección 9.4)

### FASE 10 — Entrega y evidencia

- Lista de paradas con reordenamiento manual por el chofer
- Pantalla de parada (diseño sección 9.5)
- Deep links a Google Maps y Waze con coordenadas
- Flujo de entrega en 3 toques
- Captura de evidencia según política (sección 9.6)
- Cálculo y registro de `distance_from_target_m`
- Compresión y cola de subida de fotos
- Flujo de entrega fallida con aprobación
- Reporte y corrección de direcciones

### FASE 11 — GPS y monitoreo

- Tracking foreground y background con las frecuencias de la sección 10
- Batching, compresión y sincronización diferida
- Detección de movimiento para ahorrar batería
- Mapa en vivo en el panel (polling 20-30 s)
- **Bandeja de excepciones del dispatcher** (pantalla principal de Operaciones)
- Alertas: silencio GPS, detención prolongada, atraso de ruta
- Historial de recorrido por ruta

### FASE 12 — Incidencias, soporte y métricas

- Flujo completo de incidencias con aprobación y SLA de 10 min
- Módulo de tickets con hilo de mensajes
- Push notifications (Expo Notifications)
- Timeline completo de cada paquete leído desde `events`
- Dashboard operativo: paquetes por estado, progreso de rutas, choferes activos
- Métricas: entregas/día, por chofer, tasa de éxito, paquetes/hora, km, tiempo por entrega, incidencias, reintentos
- Métricas económicas (solo `admin`): costo por entrega, margen por ruta, rentabilidad por cliente
- Cierre de día con reconciliación
- Exportación a CSV/Excel

### FASE 13 — Testing, seguridad y hardening

- Tests unitarios: máquina de estados, geo, sincronización
- Tests de integración de los endpoints críticos
- Tests E2E (Playwright) del flujo completo: recepción → ruteo → carga → entrega → cierre
- Tests de políticas RLS
- Auditoría OWASP: inyección, XSS, IDOR, exposición de datos
- Rate limiting y validación de tamaño de payloads
- Sentry en web y mobile
- Jobs de purga por política de retención
- Backups automáticos verificados (**probar una restauración real, no confiar en que existe**)

### FASE 14 — Deploy y Play Store

- Web en Vercel (staging + producción)
- Supabase producción con backups configurados
- GitHub Actions con deploy automático desde `main`
- Variables de entorno documentadas por ambiente
- EAS Build para Android (APK interno + AAB para Play)
- **Google Play:**
  - Política de privacidad publicada
  - Data Safety form completo y honesto
  - **Prominent disclosure de ubicación en background dentro de la app**, antes de pedir el permiso
  - Video demostrativo del uso de ubicación en background (**Google lo exige y es la causa #1 de rechazo**)
  - Testing interno → cerrado → producción
- Manual de operación en `docs/OPERACION.md`

> ⚠️ **Nota estratégica:** para 1-3 choferes propios, Play Store **no es necesario**. Distribuir el APK directamente o usar el canal de pruebas internas. La publicación pública es V2 y no debe bloquear la operación.

---

## 15. ALCANCE POR VERSIÓN

### MVP (fases 1-10) — lo mínimo para operar de verdad

Ingesta con OCR + CSV · geocoding con caché · agrupamiento asistido · secuenciación · etiquetas · custodia con conteo · app del chofer offline · entrega con evidencia · incidencias con aprobación · event log · panel básico.

### V1 (fases 11-14)

GPS en vivo · bandeja de excepciones · tickets · métricas operativas · flota · testing completo · deploy.

### V2

Onboarding avanzado · reprogramaciones automáticas · métricas económicas · Play Store · multi-cliente real · OR-Tools si el volumen lo justifica.

### V3 / Futuro

Ventanas horarias · multi-depósito · portal del cliente · notificaciones al destinatario · SaaS multi-tenant · facturación.

### Explícitamente FUERA de alcance

❌ Navegación turn-by-turn propia · ❌ integración con API de Mercado Libre · ❌ foto de documento · ❌ notificaciones al destinatario final (esa relación es del proveedor y podría estar prohibida por contrato) · ❌ microservicios · ❌ WebSockets · ❌ app nativa Kotlin.

---

## 16. CASOS DE ERROR — COMPORTAMIENTO ESPERADO

| Caso                                       | Comportamiento del sistema                                                                                               |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| Paquete duplicado                          | Feedback inmediato con quién y cuándo lo escaneó. No duplica                                                             |
| Código inexistente                         | Ingresa como `NO_MANIFEST`, entra a bandeja                                                                              |
| Geocoding falla                            | Marca `FAILED`, va a revisión manual sobre mapa. **No entra al ruteo**                                                   |
| Coordenadas fuera del área operativa       | Rechazo automático con alerta (típico error de geocoding)                                                                |
| API de mapas caída                         | Fallback a haversine para clusterizar; secuencia por orden geográfico; **avisar que la ruta es subóptima**               |
| GPS apagado durante la ruta                | Alerta al chofer y a Operaciones; se sigue permitiendo entregar pero se marca la evidencia como degradada                |
| Sin internet                               | Todo local. Badge de pendientes. Sincroniza al volver                                                                    |
| Batería baja (<15%)                        | Alerta al chofer, reduce frecuencia de GPS, prioriza la cola de sincronización                                           |
| Teléfono se apaga                          | Al reabrir, restaura estado desde SQLite. **Nada se pierde**                                                             |
| Chofer cambia de vehículo                  | Registro de cambio de vehículo con motivo; queda en el event log                                                         |
| Chofer abandona la ruta                    | `dispatcher` puede reasignar paquetes no entregados a otra ruta; se recalcula secuencia; nueva transferencia de custodia |
| Vehículo roto                              | Incidencia de flota; vehículo a `MAINTENANCE`; reasignación de ruta                                                      |
| Paquete perdido                            | Estado `EXTRAVIADO` con aprobación de `admin`; reporte con toda la trazabilidad                                          |
| Paquete dañado                             | Foto obligatoria; decisión de Operaciones: entregar igual o devolver                                                     |
| Dos dispositivos escanean el mismo paquete | Gana el más antiguo por `client_timestamp`; el segundo se marca `CONFLICT`                                               |
| Bulto en la ruta equivocada                | Chequeo cruzado automático entre rutas activas; notificación a ambos choferes                                            |
| Ruta mal generada                          | Ajuste manual siempre disponible; el chofer puede reordenar                                                              |
| Entrega registrada a >150 m del objetivo   | Confirmación explícita + marca de revisión                                                                               |

---

## 17. ANÁLISIS DE RIESGOS

| Riesgo                                                          | Nivel       | Mitigación                                                                                                                             |
| --------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Dependencia de un solo proveedor de paquetes                    | **CRÍTICO** | Riesgo de negocio, no técnico. No invertir 6 meses de desarrollo antes de 3 meses de operación estable                                 |
| Pérdida de eventos de entrega por conectividad                  | **CRÍTICO** | Outbox con idempotencia; nada se borra local hasta confirmación del servidor                                                           |
| No poder capturar el destino de forma eficiente                 | **CRÍTICO** | Cascada de 5 adaptadores; el humano siempre es el último recurso; conseguir manifiesto                                                 |
| Rechazo de los choferes a usar la app                           | **ALTO**    | Causa #1 de muerte de estos sistemas. Máximo 3 toques por entrega; nunca imponer el orden; probar con usuarios reales desde la FASE 10 |
| Datos personales sin base legal clara                           | **ALTO**    | Minimización, cifrado, retención acotada, validación legal antes de producción                                                         |
| Costos de APIs de mapas se disparan                             | **ALTO**    | Haversine para clusterizar; Routes API solo para secuenciar; caché agresivo; alertas de presupuesto; MapLibre en el panel              |
| Rechazo de Google Play por ubicación en background              | **ALTO**    | Prominent disclosure + video + política de privacidad desde la FASE 1. No bloquea la operación (APK directo)                           |
| Geocoding impreciso en el GBA (calles homónimas entre partidos) | **MEDIO**   | Normalización con partido obligatorio; validación de bounding box; corrección manual; memoria de direcciones                           |
| Batería del celular en jornadas de 8 h                          | **MEDIO**   | Frecuencia adaptativa; detección de movimiento; requerir cargador vehicular                                                            |
| Sobreingeniería que retrasa la salida a producción              | **MEDIO**   | Fases con aprobación; el MVP no incluye Redis, WebSockets ni microservicios                                                            |
| Concentración de permisos en `dispatcher`                       | **MEDIO**   | No puede marcar entregado; todo queda firmado en el event log; reportes de aprobaciones por usuario                                    |

---

## 18. VARIABLES DE ENTORNO

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=          # solo servidor, NUNCA al cliente
DATABASE_URL=

# Google
GOOGLE_GEOCODING_API_KEY=           # restringida por IP de servidor
GOOGLE_ROUTES_API_KEY=              # restringida por IP de servidor
GOOGLE_VISION_API_KEY=              # opcional, fallback de OCR

# Mapas
NEXT_PUBLIC_MAPTILER_KEY=           # tiles para MapLibre

# App
NEXT_PUBLIC_APP_URL=
NODE_ENV=
LOG_LEVEL=

# Operación
DEFAULT_DEPOT_LAT=
DEFAULT_DEPOT_LNG=
DEFAULT_ORG_ID=
OPERATIONAL_BBOX=                   # bounding box válido del área de reparto

# Configuración de negocio (con defaults, editables desde el panel)
MAX_DELIVERY_DISTANCE_M=150
INCIDENT_SLA_SECONDS=600
GPS_SILENCE_ALERT_MINUTES=15
ROUTE_BALANCE_TOLERANCE=0.15

# Retención (días)
RETENTION_GPS_DAYS=90
RETENTION_PHOTOS_DAYS=180
RETENTION_PHONE_DAYS=90

# Mobile (EAS)
EXPO_PUBLIC_API_URL=
EXPO_PUBLIC_SUPABASE_URL=
EXPO_PUBLIC_SUPABASE_ANON_KEY=

# Monitoreo
SENTRY_DSN=
SENTRY_AUTH_TOKEN=
```

---

## 19. CRITERIOS DE ACEPTACIÓN GLOBALES

El sistema está listo para operar cuando:

1. ✅ Se pueden ingresar 120 paquetes en menos de 45 minutos con OCR (sin manifiesto)
2. ✅ El geocoding resuelve >90% automáticamente y el resto se corrige en pantalla
3. ✅ Se generan 3 rutas balanceadas (±15%) en menos de 30 segundos
4. ✅ Se imprimen 120 etiquetas con ruta y número de bulto
5. ✅ Un chofer toma custodia en menos de 3 minutos
6. ✅ Una entrega completa se registra en **3 toques y menos de 20 segundos**
7. ✅ La app funciona **completamente** sin internet durante 4 horas y sincroniza sin pérdidas ni duplicados
8. ✅ Una incidencia llega a Operaciones en menos de 5 segundos con conexión
9. ✅ Cada paquete tiene un timeline completo y verificable de extremo a extremo
10. ✅ Nadie puede marcar ENTREGADO desde el panel web
11. ✅ Nadie puede modificar el event log, ni el `admin`
12. ✅ La ecuación de cierre balancea: cargados = entregados + fallidos + devueltos + en depósito
13. ✅ Un `driver` no puede acceder a datos de otra ruta (verificado por test de RLS)
14. ✅ `pnpm typecheck`, `pnpm lint` y `pnpm test` pasan sin errores ni warnings

---

## 20. DECISIONES PENDIENTES (PREGUNTAR ANTES DE ASUMIR)

Estas cosas **no están definidas** y no deben inventarse:

1. **Nombre visible del rol `dispatcher`** — default: "Operaciones". Cambiable en `src/lib/constants/roles.ts`
2. **Escenario real de ingesta** — a confirmar con etiquetas reales. El sistema soporta los 4; hay que medir cuál predomina
3. **Tipo de impresora** — térmica de rollo (100×150mm) o A4 autoadhesiva. Genera ambos formatos hasta confirmar
4. **Ubicación exacta del depósito** — coordenadas de salida y regreso de las rutas
5. **Capacidad real de los vehículos** en cantidad de paquetes
6. **Tarifa por paquete y estructura de costos** — necesario para el módulo de métricas económicas
7. **Si existen envíos con cobro contra reembolso o con franja horaria** — cambia el modelo de datos
8. **Si el proveedor exige usar su propia app** para confirmar entregas — impacta fuerte en la adopción

---

## COMANDO INICIAL

> Leé este documento completo. Antes de escribir código, respondeme:
> **(a)** un resumen de lo que entendiste,
> **(b)** cualquier contradicción o problema técnico que detectes en estas especificaciones,
> **(c)** qué necesitás de mí para arrancar.
>
> Después ejecutá **únicamente la FASE 1** y **PARÁ**.
