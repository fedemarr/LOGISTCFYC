# PROMPT — FRONTEND v2 (MAPA REAL · TEMA CLARO Y OSCURO)

> **Adjuntá `mockup.html` junto con este documento.**
> El mockup es la **referencia visual vinculante**: layout, proporciones, jerarquía tipográfica, colores e interacciones ya están decididos ahí. Este documento explica cómo llevarlo a producción con mapa real.
> Donde este documento y el mockup difieran, manda este documento.

---

## 0. QUÉ HAY QUE HACER

Construir la interfaz completa de una plataforma de logística de última milla, **replicando el mockup adjunto**, con tres diferencias:

1. **Mapa real** (MapLibre GL JS + tiles vectoriales) en lugar del SVG dibujado a mano
2. **Tema claro y oscuro completos**, ambos de primera clase — no uno derivado del otro
3. **App del chofer con dos vistas**: Pedidos (lista) y Mapa, alternables

Sin backend. Todos los datos salen de `src/mock/`.

### Reglas

1. **Cero backend.** Nada de fetch a APIs propias, nada de base de datos, nada de auth real.
2. **El mockup es el contrato visual.** Si algo se ve distinto al mockup, está mal. Comparar lado a lado antes de dar una pantalla por terminada.
3. **Navegación completa.** Todas las pantallas conectadas, ningún botón muerto.
4. **Interacciones reales.** Mover un paquete entre rutas recalcula territorio, secuencia, km, tiempo, ocupación y gantt — igual que en el mockup.
5. **TypeScript strict.** Sin `any`. Los tipos de `src/types/` son el contrato con el backend futuro.
6. **Cero lógica en componentes.** Cálculos geográficos y de métricas van en `src/lib/`.
7. **Todos los estados**: cargando, vacío, error, sin conexión.
8. Al terminar cada fase (sección 9): **parar y mostrar**.

### Stack

```
Next.js 15 (App Router) · React 19 · TypeScript strict
Tailwind CSS · shadcn/ui · Lucide React
MapLibre GL JS · @turf/turf (casco convexo, distancias)
Zustand (estado del mock)
next-themes (tema claro/oscuro)
```

La app del chofer se prototipa como ruta web `/app`, renderizada dentro de un marco de celular en desktop y a pantalla completa en mobile.

---

## 1. CONTEXTO MÍNIMO

Empresa de reparto en el norte del Gran Buenos Aires. ~120 paquetes por día, 3 choferes, 1 depósito en San Martín.

**La noche anterior:** se escanean los paquetes, se resuelven direcciones, el sistema agrupa geográficamente, arma rutas, se imprimen etiquetas y se clasifica físicamente por ruta.
**A la mañana:** el chofer escanea el contenedor de su ruta, cuenta los bultos y sale.
**Durante el día:** Operaciones vigila y destraba problemas.

### Cuatro roles

| Rol             | Pantalla principal     | Contexto de uso                |
| --------------- | ---------------------- | ------------------------------ |
| Administrador   | Métricas               | Escritorio                     |
| **Operaciones** | Bandeja de excepciones | 8 horas de reojo               |
| **Depósito**    | Escaneo y planificador | Noche, de pie, apurado         |
| **Chofer**      | App móvil              | Sol directo, una mano, apurado |

### Dos conceptos que la UI no puede confundir jamás

|                  | Qué es                                                                    | Dónde aparece                 |
| ---------------- | ------------------------------------------------------------------------- | ----------------------------- |
| **Nº de bulto**  | Identidad física del paquete. Va impreso en la etiqueta. **Nunca cambia** | Etiqueta, pantalla del chofer |
| **Nº de parada** | Posición en la secuencia. Se recalcula                                    | Mapa, lista de paradas        |

La app le dice al chofer: **"Parada 5 de 42 → buscá el BULTO 17"**.

---

## 2. SISTEMA DE DISEÑO

### Principio rector

> **El color le pertenece a las rutas y a los estados. La interfaz es gris.**

Nada decorativo tiene color. Si algo está coloreado es porque significa algo: a qué ruta pertenece, o en qué estado está. Con 120 paquetes en pantalla, esto es lo que permite que el ojo agrupe sin leer.

**La acción primaria no tiene color:** el botón principal es blanco sobre oscuro (o casi negro sobre claro). Todo el presupuesto cromático se reserva para rutas y estados.

### Tipografía

```
Archivo         → interfaz, títulos, etiquetas.     Pesos 400/500/600/700
JetBrains Mono  → TODOS los datos operativos.       Pesos 400/500/700
```

**Por qué mono para los datos:** se comparan columnas de números (km, tiempo, bultos) y se leen códigos donde confundir un `0` con una `O` es un paquete perdido. La mono da cifras tabulares alineadas y glifos distinguibles. Es una decisión operativa, no estética.

Aplicar siempre `font-variant-numeric: tabular-nums` en la mono.

**En mono:** códigos de seguimiento, números de bulto, ruta y parada, km, duraciones, horas, cantidades, patentes, coordenadas.
**En Archivo:** todo el resto.

```
display   40px / 700 / -0.03em        → métricas grandes
h1        28px / 600 / -0.02em
h2        20px / 600
h3        16px / 600
body      14px / 400 / 1.5
label     11px / 500 / 0.06em / MAYÚSCULAS
data-xl   44px / 700 / mono           → Nº de bulto en la app
data      14px / 500 / mono
```

### Tokens de color

**Ambos temas son de primera clase.** El oscuro es el default (el trabajo de depósito es nocturno), pero el claro tiene que verse igual de intencional, no como un oscuro invertido.

```css
:root,
[data-theme="dark"] {
  --bg: #0f1115;
  --surface: #171a21;
  --surface-2: #1f232c;
  --surface-3: #272c37;
  --border: #2a2f3a;
  --border-2: #373d4a;
  --text: #e8eaed;
  --muted: #8b919e;
  --muted-2: #646b79;
}
[data-theme="light"] {
  --bg: #f7f8fa;
  --surface: #ffffff;
  --surface-2: #f0f2f5;
  --surface-3: #e6e9ee;
  --border: #dfe3e8;
  --border-2: #cbd1da;
  --text: #14171c;
  --muted: #666e7d;
  --muted-2: #8891a0;
}
```

Neutros grafito frío: **ni negro puro ni blanco puro** en ningún caso.

**Estados — semántica fija en todo el producto:**

```css
--pending: #8b919e --active: #3b82f6 --success: #22c55e --warning: #f59e0b
  --danger: #ef4444;
```

**Paleta de rutas — 12 colores fijos**, asignados por índice. Son la identidad de la ruta en todo el sistema, incluida la banda de la etiqueta impresa:

```
#0EA5E9  #A855F7  #22C55E  #EAB308  #F97316  #EC4899
#14B8A6  #6366F1  #84CC16  #F43F5E  #06B6D4  #8B5CF6
```

> **Ajuste de rutas en tema claro:** varios de estos colores pierden contraste sobre fondo blanco. Definir una variante `-light` con la luminosidad bajada ~12% para el tema claro, manteniendo el mismo matiz. La ruta 001 tiene que reconocerse como "la celeste" en los dos temas.

**Regla de accesibilidad irrompible:** el color nunca viaja solo. Siempre acompañado del número de ruta o de un ícono. Hay choferes daltónicos, y el sol lava los colores en pantalla.

### El elemento distintivo: la costilla de color

Todo lo que pertenece a una ruta lleva una **barra vertical de 4px pegada a su borde izquierdo**, en el color de la ruta. Tarjeta, fila de tabla, encabezado, tarjeta de excepción, pantalla del chofer — y la **banda superior de la etiqueta física impresa**.

Es el único ornamento del producto, y no es ornamento: es lo que une lo digital con la caja de cartón. Cuando el chofer busca el bulto 17 en la camioneta, ve la misma franja violeta en la etiqueta y en el celular.

### Geometría y movimiento

```css
--radius-sm: 6px --radius-md: 10px --radius-lg: 14px espaciado: 4 8 12 16 24 32 48 64
  --t-fast: 120ms cubic-bezier(0.4, 0, 0.2, 1) --t-base: 200ms
  cubic-bezier(0.4, 0, 0.2, 1);
```

Sombras casi inexistentes: la jerarquía se hace con `--surface-2` y bordes de 1px, no con profundidad. Es una consola de operaciones, no una app de consumo.

**Movimiento solo funcional.** Transición de color en hover, deslizamiento al reordenar paradas, y una sola animación con carácter: al mover un paquete de ruta, su costilla transiciona del color viejo al nuevo en 200ms. Nada más. Respetar `prefers-reduced-motion`.

---

## 3. MAPA REAL — ESPECIFICACIÓN

Esta es la diferencia principal con el mockup y la parte más delicada del proyecto.

### Proveedor de tiles

**MapTiler** con MapLibre GL JS.

```
Oscuro:  https://api.maptiler.com/maps/dataviz-dark/style.json?key=KEY
Claro:   https://api.maptiler.com/maps/dataviz-light/style.json?key=KEY
```

**Por qué `dataviz` y no `streets`:** los estilos dataviz son deliberadamente desaturados y de bajo contraste, diseñados para poner datos encima. Con `streets`, los colores de las 12 rutas compiten con los de las calles, los parques y los comercios, y el mapa se vuelve ilegible. El mapa es el fondo, no el contenido.

Alternativa gratuita si no hay clave: **Carto Basemaps** (`dark-matter` y `positron`), sin registro.

```
https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json
https://basemaps.cartocdn.com/gl/positron-gl-style/style.json
```

### ⚠️ Cambio de tema: dos estilos, no un filtro

**Nunca usar `filter: invert()` ni un filtro CSS sobre el mapa.** Se ve mal siempre: el agua queda naranja, las etiquetas de calles ilegibles, los colores de las rutas alterados.

Al cambiar de tema, cargar el **estilo correspondiente** con `map.setStyle()` y **volver a agregar todas las capas de datos** después del evento `styledata`, porque `setStyle` las destruye. Guardar el estado del mapa (centro, zoom, bearing) antes del cambio y restaurarlo después, para que la vista no salte.

### Capas de datos (en este orden de apilamiento)

| #   | Capa                | Tipo MapLibre   | Contenido                                             |
| --- | ------------------- | --------------- | ----------------------------------------------------- |
| 1   | Territorios         | `fill`          | Casco convexo por ruta, opacidad 0.12                 |
| 2   | Borde de territorio | `line`          | 2px, color de la ruta, `line-join: round`             |
| 3   | Trazado de ruta     | `line`          | Punteado 5-4, secuencia depósito → paradas → depósito |
| 4   | Pines de paquete    | marcadores HTML | Pin con número de parada                              |
| 5   | Depósito            | marcador HTML   | Ícono propio, siempre visible                         |

**Territorios:** calcular con `turf.convex()` sobre los puntos de la ruta, después `turf.buffer()` de ~250 m para que el polígono envuelva los pines y no los corte. Con menos de 3 puntos, dibujar un círculo con `turf.circle()` en lugar del casco.

**Pines:** marcadores HTML personalizados, no capa `symbol`. Necesitan mostrar el número de parada en mono, cambiar de color con la ruta y responder a clic. Un pin es un `div` con la forma de gota en CSS más el número centrado.

**Agrupamiento:** con 120 paquetes en pantalla los pines se superponen. Activar cluster automático **por debajo de zoom 13**, mostrando la cantidad de paquetes agrupados en el color de la ruta. Por encima de 13, pines individuales.

### Interacciones del mapa

- **Hover sobre una tarjeta de ruta** → esa ruta al 100%, las demás con `fill-opacity` y `line-opacity` bajadas a 0.18 mediante `setPaintProperty` (no re-render)
- **Clic en un pin** → popup con código, dirección, destinatario, número de bulto y los botones para mover el paquete a otra ruta
- **Mover un paquete** → recalcular casco, secuencia y métricas, actualizar las fuentes GeoJSON, y transicionar la costilla al color nuevo
- **Ajuste automático de encuadre**: al cargar y al seleccionar una ruta, `fitBounds` sobre los puntos con padding de 60px
- **Controles**: zoom, brújula, pantalla completa, y toggles de capa (Territorios / Trazado / Densidad)

### Rendimiento

- Las fuentes GeoJSON se actualizan con `source.setData()`, **nunca destruyendo y recreando capas**
- Los cálculos geográficos van en `src/lib/geo.ts`, memoizados
- El mapa se monta una sola vez; los cambios de datos no lo remontan

### Coordenadas reales — datos mock

**Las coordenadas del mockup son inventadas. Hay que reemplazarlas por reales**, o los clusters caen en el Río de la Plata.

Depósito: **San Martín, Buenos Aires** — `-34.5731, -58.5372`

Distribuir 120 paquetes en tres clusters coherentes, con direcciones verdaderas y coordenadas dentro de ±0,012° del centro de cada localidad:

| Ruta | Zona    | Localidades                                | Centro aproximado    |
| ---- | ------- | ------------------------------------------ | -------------------- |
| 001  | Oeste   | San Martín, Villa Ballester, Villa Adelina | `-34.5486, -58.5561` |
| 002  | Centro  | Munro, Carapachay, Florida                 | `-34.5281, -58.5233` |
| 003  | Noreste | Olivos, Vicente López, Martínez            | `-34.5089, -58.4831` |

Más **2 outliers reales**: uno en Pilar (`-34.4585, -58.9142`) y otro en Escobar (`-34.3489, -58.7934`). Son los que disparan la alerta de "paquete aislado" y le cuestan 40 minutos al chofer.

Y **3 paquetes sin dirección resuelta**, sin coordenadas, para la bandeja de resolución.

---

## 4. APP DEL CHOFER — VISTA PEDIDOS / MAPA

Cambio respecto del mockup: la app tiene **dos vistas alternables** sobre los mismos datos.

```
┌────────────────────────────┐
│ ▌ RUTA 002    ⚡ EN SERVICIO│  ← encabezado fijo
│  18 de 42 entregados       │
├────────────────────────────┤
│ ┌──────────┐┌────────────┐ │  ← selector, 48px de alto
│ │ PEDIDOS  ││    MAPA    │ │
│ └──────────┘└────────────┘ │
├────────────────────────────┤
│                            │
│   contenido de la vista    │
│                            │
└────────────────────────────┘
```

El selector es un **control segmentado de 48px de alto**, no tabs finos. Persistir la elección del chofer entre sesiones: el que prefiere lista quiere lista siempre.

### Vista PEDIDOS

Lista vertical de paradas pendientes, en orden de secuencia. Cada tarjeta:

```
┌────────────────────────────┐
│▌ 5   BULTO 17              │  ← parada en muted, bulto en mono 22px
│      Av. San Martín 1234   │  ← 17px, 600
│      Villa Ballester       │  ← 15px, muted
│      ⚠ Timbre no anda      │  ← si hay nota
│      1,2 km · 4 min      › │
└────────────────────────────┘
```

- Altura mínima de tarjeta: **88px** (área táctil holgada)
- La primera tarjeta es **la parada actual**: destacada con borde en el color de la ruta y fondo `--surface-2`
- Arrastrar para reordenar: el chofer puede cambiar el orden. **El sistema propone, el chofer dispone.** Si se le impone el orden, abandona la app y se pierde la trazabilidad
- Pestaña secundaria **COMPLETADAS** con las entregas hechas, en verde, con hora
- Tocar una tarjeta abre la pantalla de parada

### Vista MAPA

- Mapa MapLibre centrado en la posición del chofer, con `fitBounds` a las paradas restantes
- **Solo la ruta propia.** El chofer no ve las rutas de los demás
- Pines numerados por secuencia; la parada actual con anillo pulsante en el color de la ruta
- Ubicación del chofer con el punto azul estándar y cono de orientación
- **Hoja inferior arrastrable** con la parada actual: colapsada muestra bulto y dirección; expandida muestra la tarjeta completa con acciones
- Botón flotante de recentrado
- **Tema del mapa siempre oscuro en la app del chofer**, independientemente del tema del sistema: se usa a pleno sol y el contraste alto gana. (Evaluable, pero es el default correcto.)

### Navegación externa

Botón **IR** → abre la app de navegación del celular. **Enviar coordenadas, nunca texto**, porque Google puede reinterpretar la dirección y mandar al chofer a otro partido. La geocodificación ya la validó un humano la noche anterior.

```
Google Maps  google.navigation:q=<lat>,<lng>&mode=d
Waze         waze://?ll=<lat>,<lng>&navigate=yes
Fallback     https://www.google.com/maps/dir/?api=1&destination=<lat>,<lng>
```

Primera vez: preguntar cuál prefiere y recordarlo. Cambiable desde Ajustes.

> **No construir navegación turn-by-turn propia.** El SDK de navegación de Google es un producto empresarial caro y el de Mapbox cobra por conductor activo. El chofer ya sabe usar Google Maps y ya tiene su preferencia. Tu app es dueña de las paradas, el estado y la evidencia; Google Maps es dueño del manejo.

### Restricciones duras de la app

El contexto es **sol directo, una mano, apurado, a veces con guantes**:

- Áreas táctiles mínimo **56×56px**. Botón primario de **64px** de alto
- Tipografía base **18px**. Nunca menos
- **Nº de bulto a 44px en mono**: es lo más grande de la pantalla de parada
- Máximo **2 acciones primarias** por pantalla
- Cero menús anidados
- Dark mode obligatorio, contraste alto
- **La pantalla de parada se tiene que entender en menos de 2 segundos**
- Banner persistente arriba si hay acciones sin sincronizar

---

## 5. PANTALLAS

### Panel web

```
/login
/operaciones                 ← BANDEJA DE EXCEPCIONES (principal del rol)
/operaciones/mapa            ← mapa en vivo, pestaña secundaria
/operaciones/incidencias/[id]
/deposito                    ← operación del día
/deposito/escanear
/deposito/resolver           ← bandeja de direcciones sin resolver
/deposito/rutear             ← PLANIFICADOR (pantalla más importante)
/deposito/etiquetas          ← vista previa de impresión
/rutas · /rutas/[id]
/paquetes · /paquetes/[id]   ← línea de tiempo
/soporte · /flota · /metricas · /config
```

### App del chofer

```
/app/login
/app/onboarding              ← 5 pantallas
/app/inicio                  ← toggle EN SERVICIO
/app/custodia                ← escanear contenedor + contar bultos
/app/ruta                    ← PEDIDOS | MAPA
/app/parada/[id]             ← pantalla más importante
/app/entregar/[id]           ← 3 toques
/app/problema/[id]
/app/completadas · /app/soporte · /app/ajustes
```

---

## 6. LAS CUATRO PANTALLAS QUE IMPORTAN

Están todas resueltas en el mockup. Replicar exactamente, con las diferencias marcadas.

### 6.1 `/deposito/rutear` — El planificador

Igual al mockup, con **mapa real**. Comportamiento obligatorio:

- Hover sobre tarjeta de ruta → resalta esa ruta, atenúa las demás a 0.18
- Clic en pin → popup con datos y botones para mover de ruta
- Mover un paquete → **recalcula en vivo** casco, secuencia, km, tiempo, ocupación y gantt; la costilla cambia de color en 200ms
- Barra de ocupación: verde bajo 85%, ámbar 85-100%, rojo arriba de 100%
- **"Sin asignar" siempre visible**, aunque esté en cero. Si tiene contenido, va en `--danger` y tiene que incomodar
- **APROBAR deshabilitado** mientras haya paquetes sin resolver o alertas sin reconocer, con tooltip explicando por qué
- Alerta automática de desbalance si una ruta supera al promedio en más de 15%
- Gantt de carga estimada abajo, colapsable

### 6.2 `/operaciones` — La bandeja de excepciones

Nadie mira un mapa ocho horas. **La pantalla principal no es un mapa**: es una lista de lo que está mal ahora, ordenada por urgencia. El mapa es pestaña secundaria.

- Tres grupos: **Urgente · Atención · Seguimiento**
- Contador que corre en cada tarjeta urgente. SLA de 10 min; a los 8 la tarjeta pulsa en `--danger`
- Cada tarjeta lleva la costilla de su ruta
- Acciones directas en la tarjeta: Llamar · Reintentar hoy · Reprogramar · Devolver
- **Estado vacío bien resuelto:** cuando no hay nada mal, decirlo con claridad y mostrar el avance general. Es el estado normal y tiene que dar tranquilidad, no parecer un error

### 6.3 `/app/parada/[id]` — La pantalla del chofer

Igual al mockup. **BULTO 17 a 44px en mono es lo más grande de la pantalla.** Es lo que el chofer necesita para encontrar la caja.

Flujo de entrega en **3 toques**: `ENTREGAR` → nombre de quien recibe (con el destinatario esperado sugerido de un toque) → foto → `CONFIRMAR`. Se capturan solos: GPS, hora, distancia al objetivo, chofer, vehículo, ruta.

Flujo de problema: motivo → foto → reportado. **El chofer sigue con la parada siguiente**, no queda trabado esperando la decisión de Operaciones.

### 6.4 `/paquetes/[id]` — La línea de tiempo

La prueba de todo. Legible por alguien que nunca vio el sistema, porque es lo que se le muestra a un cliente cuando reclama.

Hora en mono, acción en Archivo, actor a la derecha, metadatos en segunda línea muted. Ícono de GPS cuando hay ubicación. Fotos como miniaturas que abren a tamaño completo.

---

## 7. COMPONENTES

```
RouteSpine          barra vertical de color, 4px — el elemento distintivo
RouteBadge          punto de color + número en mono
StatusPill          estado con color e ícono (nunca color solo)
MetricStat          número grande en mono + label en mayúsculas
CapacityBar         ocupación del vehículo con color semántico
RouteCard           tarjeta del panel del planificador
ExceptionCard       tarjeta de la bandeja, con contador que corre
PackageTimeline     línea de tiempo de eventos
StopCard            parada en la lista del chofer
BigActionButton     botón de 64px
ScanFeedback        overlay de escaneo: OK / duplicado / error
MapCanvas           MapLibre con territorios, pines y trazado
MapPin              marcador HTML con número de parada
RouteTimeline       gantt de carga estimada
LabelPreview        vista previa de la etiqueta imprimible
BottomSheet         hoja arrastrable de la vista mapa del chofer
SegmentedControl    selector Pedidos / Mapa, 48px
OfflineBanner       barra persistente de pendientes
EmptyState          vacío con acción sugerida
```

---

## 8. DATOS MOCK Y ESTADOS

En `src/mock/`, tipados en `src/types/` (futuro contrato con el backend).

- 1 organización, 1 cliente proveedor
- 5 usuarios: admin, operaciones, depósito, 3 choferes
- 3 vehículos con capacidad
- **120 paquetes con direcciones reales del norte del GBA** y coordenadas verdaderas (sección 3)
- 3 rutas generadas con secuencia y estimaciones
- 3 paquetes sin resolver · 2 outliers reales
- 1 ruta en curso con 18 de 42 entregas hechas
- 2 incidencias abiertas y 3 resueltas
- Eventos completos de 5 paquetes, uno con el recorrido entero hasta entregado

### Estados obligatorios en cada vista

- **Cargando** — skeletons con la forma real del contenido. Nunca spinners
- **Vacío** — con acción sugerida. Un vacío es una invitación a hacer algo
- **Error** — qué pasó y cómo arreglarlo, en la voz del sistema. Sin disculpas, sin vaguedad
- **Sin conexión** (app) — banner persistente con cantidad de pendientes

Interruptor global en `/config` para forzar cada estado y revisarlos todos.

---

## 9. FASES

**F1 — Base.** Proyecto, tokens, fuentes, tema claro/oscuro con `next-themes`, layout, sidebar por rol, login mock, tipos y datos mock completos con coordenadas reales.

**F2 — Componentes.** Toda la librería de la sección 7 en una página de catálogo `/config/componentes`, con todos los estados y variantes visibles **en ambos temas**.

**F3 — Mapa.** `MapCanvas` aislado: MapLibre, ambos estilos, cambio de tema sin perder capas, territorios con turf, pines HTML, agrupamiento, popups, `fitBounds`. _Probarlo solo antes de integrarlo._

**F4 — El planificador.** `/deposito/rutear` completo con el mapa de F3, mover paquetes, recálculo en vivo, gantt. _Es la pantalla más cara: revisarla antes de seguir._

**F5 — Operaciones.** Bandeja de excepciones, contadores, detalle de incidencia, mapa en vivo simulado.

**F6 — App del chofer.** Marco de celular, inicio, custodia, selector Pedidos/Mapa, lista con reordenamiento, vista mapa con hoja inferior, pantalla de parada, entrega en 3 toques, problema, deep links de navegación.

**F7 — Resto del panel.** Escaneo, resolución, etiquetas, paquetes, línea de tiempo, rutas, flota, soporte, métricas.

**F8 — Pulido.** Todos los estados, responsive, foco de teclado visible, `prefers-reduced-motion`, revisión de contraste en ambos temas.

Después de cada fase: **parar y mostrar**.

---

## 10. CRITERIOS DE ACEPTACIÓN

1. ✅ El resultado es indistinguible del mockup en layout, tipografía y jerarquía
2. ✅ El mapa es real, con tiles vectoriales y calles verdaderas del norte del GBA
3. ✅ Cambiar de tema alterna estilos de mapa distintos, **sin filtros CSS**, sin perder capas ni saltar la vista
4. ✅ Ambos temas se ven intencionales; ninguno parece el otro invertido
5. ✅ Los 3 clusters caen sobre las localidades correctas y los outliers en Pilar y Escobar
6. ✅ Mover un paquete entre rutas recalcula territorio, secuencia, km, tiempo, ocupación y gantt
7. ✅ La costilla de color es consistente en panel, mapa, app y vista previa de etiqueta
8. ✅ El número de bulto y el de parada nunca se confunden en ninguna pantalla
9. ✅ La app del chofer alterna Pedidos y Mapa manteniendo el estado, y recuerda la preferencia
10. ✅ El botón IR abre navegación externa con coordenadas, nunca con texto
11. ✅ La pantalla de parada se entiende en menos de 2 segundos a un brazo de distancia
12. ✅ Ninguna área táctil de la app mide menos de 56px
13. ✅ La bandeja de excepciones tiene un estado vacío que transmite tranquilidad
14. ✅ Ningún color transmite información sin ícono o texto que lo acompañe
15. ✅ Todo dato numérico o código está en mono con cifras tabulares
16. ✅ Contraste AA verificado en ambos temas
17. ✅ `pnpm typecheck` y `pnpm lint` sin errores. Cero `any`

---

## COMANDO INICIAL

> Leé este documento y abrí `mockup.html` adjunto. Antes de escribir código, mostrame:
> **(a)** el sistema de tokens con las variantes de ruta para tema claro,
> **(b)** cómo vas a resolver el cambio de estilo del mapa sin perder las capas de datos,
> **(c)** qué dudas tenés.
>
> Después ejecutá **solo la FASE 1** y **pará**.
