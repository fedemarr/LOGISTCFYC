# Prompt de continuación — alertas de entrega + métricas globales + finanzas

Este documento es un pedido de Fede (28/08/2026), armado para que lo tome la sesión de
`opencode` que sigue trabajando en paralelo sobre este mismo repo. **No fue implementado en
esta sesión** — es la especificación de lo que falta, escrita después de terminar la
confirmación de cantidad de paquetes con captura de Flex + IA (commit `702d7f0`, ver
`docs/DECISIONES.md` si hace falta ADR).

Contexto necesario antes de tocar código: leer `README.md` (estructura actual del sistema
FYM) y `docs/MODELO-DATOS.md`. **El sistema FYM NO trackea paquetes individuales** —
`driver_shifts.package_count` es un número que declara el chofer al arrancar el turno, sin
identidad propia por paquete (nombre, dirección, destinatario). Esto condiciona el diseño de
todo lo que sigue: no hay un `package_id` al que colgarle una alerta de "no entregado".

## 1. Alertas de entrega (paquete no entregado / destinatario no está)

**Pedido textual:** "que haya una sección de alerta por paquete no entregado o domicilio no
está la persona y que haya una manera de cargarle el número así la parte de control llama y
el conductor puede seguir manejando y nosotros podemos ayudarle a contactarle".

Interpretación (no tracka paquetes individuales, así que esto NO es "marcar el paquete N como
no entregado" — es un log de incidentes del turno, más simple):

- El chofer, durante un turno `ACTIVE`, puede reportar un incidente de entrega desde la PWA
  (`/chofer`) sin cortar lo que está haciendo: un botón tipo "Reportar problema de entrega"
  (separado del "Reportar avance" que ya existe) que abre un form corto:
  - Motivo: `NOT_HOME` (no está el destinatario) | `REFUSED` (rechazó el paquete) | `OTHER`
    (con nota libre).
  - Teléfono de contacto (el del destinatario, si el chofer lo tiene — ej. viene escrito en
    el paquete o se lo pasaron por Flex) — **este es el campo clave del pedido**: control
    llama a ese número en vez de que el chofer tenga que parar a llamar él.
  - Nota opcional.
- Esto NO bloquea nada ni pide confirmación — es fire-and-forget desde el chofer, para no
  interrumpirlo ("el conductor puede seguir manejando").
- El admin/dispatcher ve estos incidentes en una pantalla nueva (o una sección de `/alertas`,
  que ya existe para `zone_alerts` — evaluar si conviene unificar la vista o separarla; el
  dato de fondo es distinto, ver abajo) con: chofer, hora, motivo, teléfono, nota, y un botón
  para marcarlo "contactado"/"resuelto" (mismo patrón OPEN/RESOLVED que `zone_alerts`).

**Modelo de datos sugerido** (no reusar `zone_alerts` — esa tabla exige `zone_id` y
`distance_outside_m`, pensada específicamente para geocerca; esto es un incidente de entrega,
otro dato de fondo):

```sql
CREATE TYPE delivery_alert_reason AS ENUM ('NOT_HOME', 'REFUSED', 'OTHER');
CREATE TYPE delivery_alert_status AS ENUM ('OPEN', 'CONTACTED', 'RESOLVED');

CREATE TABLE delivery_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  shift_id uuid NOT NULL REFERENCES driver_shifts(id),
  driver_id uuid NOT NULL REFERENCES users(id),
  reason delivery_alert_reason NOT NULL,
  contact_phone text,
  note text,
  status delivery_alert_status NOT NULL DEFAULT 'OPEN',
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
```

RLS: mismo patrón que `zone_alerts`/`driver_shifts` — staff (admin/dispatcher/warehouse) ve
todo de la org, el chofer ve/crea las suyas. API: `POST /api/chofer/delivery-alerts` (crear,
desde la PWA), `GET /api/delivery-alerts` + `PATCH /api/delivery-alerts/:id` (panel, marcar
contactado/resuelto).

**Antes de implementar**, confirmar con Fede (no está en su pedido original, es ambigüedad
real):

- ¿El teléfono es del **destinatario** (para que control lo llame directo) o es el celular
  del **chofer** el que aparece para que control lo llame a ÉL? El texto ("cargarle el
  número así la parte de control llama") sugiere destinatario, pero conviene confirmarlo
  antes de armar el form.
- ¿Hace falta poder tipear el número a mano, o alcanza con que ya esté en algún lado (Flex)
  y el chofer lo copie? Si no hay integración con Flex, es carga manual — asumido arriba.

## 2. Métricas globales (no solo "hoy")

**Pedido textual:** "quiero q haya una [sección] tipo global de cuanto performance tiempo de
entrega y etc, es todo estadística".

`/metricas` hoy (`dailyMetrics()` en `apps/web/src/lib/services/metrics.ts`) es SOLO para una
fecha puntual, por chofer. Esto pide agregado histórico, con filtro de rango de fechas:

- Total de paquetes entregados en el período (suma de `driver_shifts` cerrados,
  `package_count - undelivered_count`, usando `undeliveredCount` como fuente de verdad para
  turnos `ENDED` — mismo criterio que ya se aplicó en `dailyMetrics` para el pago, ver el
  commit `702d7f0`).
- Tiempo de entrega / duración de turno: promedio, y quizás distribución (¿cuánto tarda un
  chofer típico en un turno?) — ya se calcula `hoursWorkedHours` por turno, esto es agregarlo
  en el tiempo.
- Performance por chofer: comparar entre choferes (ranking simple: quién entrega más rápido,
  quién tiene menos `undeliveredCount` proporcional, quién genera más alertas de geocerca o
  de entrega).
- Evolución en el tiempo (por semana/mes) — un gráfico simple alcanza, no hace falta nada
  sofisticado.

Sugerencia de alcance mínimo: nueva función `rangeMetrics(orgId, from, to)` (o extender
`dailyMetrics` para aceptar un rango) + una pantalla nueva (o una pestaña dentro de
`/metricas`) con selector de fecha y las mismas columnas que hoy pero agregadas, más 2-3
tarjetas de resumen (total entregado, promedio de horas por turno, % de turnos sin
incidentes). No hace falta una librería de gráficos nueva si no hay una ya en el proyecto —
confirmar qué usa `/monitoreo` (Leaflet) y si hay algo para charts antes de sumar una
dependencia.

## 3. Módulo de Finanzas (futuro — NO implementar todavía, solo dejar diseñado)

**Pedido textual:** "quiero q mas adelante ya hagamos la parte de finanzas para empezar a
liquidar por chofer, aprox dependiendo distancia pero se le paga 3000 el paquete y para
ayudarme a hacer liquidación y etc sería un módulo de finanzas".

Esto es explícitamente **para más adelante** — Fede lo pidió como visión, no como tarea
inmediata. Dejarlo diseñado acá para cuando se retome:

- **Tarifa base:** $3000 (ARS, asumido — confirmar) por paquete entregado.
- **Ajuste por distancia:** "aprox dependiendo distancia" — Fede mismo lo dice como
  aproximado, **no hay fórmula todavía**. Antes de codear un cálculo, es necesario
  preguntarle: ¿la distancia es la de la zona (radio, ya existe en `zones.radius_m`) o la
  distancia real recorrida por el chofer (habría que calcularla de los GPS pings en
  `driver_locations`, que ya se guardan pero no se agregan en ningún lado todavía)? ¿Es un
  monto fijo extra por zona/distancia, o un multiplicador sobre los $3000 base?
- **Alcance esperado de "liquidar por chofer":**
  - Elegir un rango de fechas (ej. quincena, mes).
  - Por chofer: turnos cerrados en ese rango, paquetes entregados (mismo criterio que
    métricas — `undeliveredCount` de turnos `ENDED`), monto a pagar (tarifa base × entregados
    ± ajuste por distancia si se define la fórmula).
  - Exportar o imprimir la liquidación (PDF o al menos una tabla imprimible) para pagarle al
    chofer con un comprobante.
  - Posiblemente: marcar una liquidación como "pagada" (con fecha), para no volver a
    contarla en la próxima corrida.
- **Modelo de datos sugerido** (borrador, revisar con Fede antes de crear tablas):

```sql
CREATE TABLE payment_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  base_rate_per_package numeric NOT NULL DEFAULT 3000,
  -- TODO: campos de ajuste por distancia, una vez que Fede defina la fórmula
  effective_from date NOT NULL DEFAULT CURRENT_DATE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE driver_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  driver_id uuid NOT NULL REFERENCES users(id),
  period_start date NOT NULL,
  period_end date NOT NULL,
  package_count integer NOT NULL,
  amount numeric NOT NULL,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

No arrancar esto sin antes resolver la fórmula de distancia con Fede — es el único punto
realmente bloqueante del módulo, todo lo demás (UI de liquidación, exportar, marcar pagado)
es directo una vez que el cálculo del monto está claro.

## Orden sugerido

1. Alertas de entrega (§1) — acotado, no depende de nada más, valor inmediato.
2. Métricas globales (§2) — también acotado, reusa datos que ya existen.
3. Finanzas (§3) — **preguntarle a Fede la fórmula de distancia antes de tocar código**, después
   es la que más tiempo lleva (nueva sección completa del panel).

Seguir el mismo ritual del resto de la sesión: `typecheck` + `lint` + `test` + `build` en
verde, `pnpm smoke:browser` si se toca UI (ver README.md — atrapó bugs reales que el resto de
la suite no ve, como el URL firmado roto de `signFlexScreenshotUrl` en el commit `702d7f0`),
commit descriptivo, push a `main`, deploy.
