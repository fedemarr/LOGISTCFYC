# Manual de operación

Cómo se despliega, actualiza, monitorea y recupera el sistema en producción.
Compañero de [`DECISIONES.md`](./DECISIONES.md) (porqué de cada decisión) y de
[`.env.example`](../.env.example) (variables por ambiente).

---

## 1. Arquitectura operativa

| Componente                     | Dónde vive       | Entorno                 |
| ------------------------------ | ---------------- | ----------------------- |
| Panel web (Next.js)            | Vercel           | producción + preview    |
| Base de datos (Postgres)       | Supabase         | producción única        |
| Storage (fotos de evidencia)   | Supabase Storage | producción única        |
| App del chofer/depósito (Expo) | EAS Build        | APK interno / AAB       |
| CI/CD                          | GitHub Actions   | `.github/workflows/`    |
| Errores en producción          | Sentry           | DSN de producción       |
| Geocoding/rutas/OCR            | Google Cloud     | keys por IP de servidor |

> Una sola instancia de Supabase para todo (ver ADR correspondiente). No hay
> ambiente de staging con base propia: los tests de integración y el smoke
> corren contra producción con fixtures que se autolimpian.

## 2. Deploy de la web (Vercel)

### Flujo normal (automático)

- `push` a `main` → Vercel compila y despliega **producción** con las variables de
  **Production** (Settings → Environment Variables).
- Cada PR/rama tiene su **preview** (staging) con la URL propia; el build solo
  arranca si las variables de **Preview** están completas.

### Puerta de calidad (CI)

- `.github/workflows/ci.yml` corre en cada PR y cada push a `main`: lint,
  typecheck, tests unitarios (incluidos los de web, que importan la capa de db
  pero no conectan). Es el check requerido antes de mergear.
- `.github/workflows/deploy.yml` reutiliza ese CI y, si existe el secret
  `VERCEL_DEPLOY_HOOK`, dispara el deploy por hook solo si el CI pasó.
  - **Importante:** si la integración git de Vercel ya está activa, el deploy
    por hook **duplicaría** el deploy. Elegir UNA vía:
    - **Vía A (recomendada):** dejar la integración git (Settings → Git →
      auto-deploy desde `main`) y borrar `deploy.yml`. Cero mantenimiento.
    - **Vía B (deploy gated por CI):** crear un Deploy Hook en Vercel
      (Settings → Deploy Hooks, rama `main`), pegar la URL en el secret
      `VERCEL_DEPLOY_HOOK` (GitHub → Settings → Secrets) y **desactivar** el
      auto-deploy por git. Mientras el secret no exista, `deploy.yml` se salta.

### Manual (fallback)

```bash
vercel --prod   # desde la raíz del repo, con `vercel login`
```

### Variables por ambiente

- **Production y Preview en Vercel:** `NEXT_PUBLIC_*`, `DATABASE_URL`,
  `SUPABASE_SERVICE_ROLE_KEY`, `GOOGLE_*_API_KEY`, `NEXT_PUBLIC_MAPTILER_KEY`,
  `CRON_SECRET`, `DEFAULT_DEPOT_*`, `DEFAULT_ORG_ID`, `OPERATIONAL_BBOX`,
  `SENTRY_*`. Lista completa y explicación en `.env.example`.
- Los defaults de negocio (distancias, SLA, retención) se editan desde el panel
  (tabla `business_config`), no en Vercel.

## 3. Migraciones de base de datos

Las migraciones viven en `supabase/migrations/` (SQL plano, el que escribe
Drizzle). Para aplicar la última al vuelo:

```bash
pnpm --filter @fym/web db:generate   # si hay cambios de schema → SQL nuevo
pnpm --filter @fym/web db:migrate    # aplica pendientes a producción
pnpm --filter @fym/web db:verify     # chequea integridad referencial
```

Regla: **nunca** editar una migración ya aplicada en producción; agregar una
nueva. Verificar en el Dashboard de Supabase que la migración figure aplicada.

## 4. Cron de mantenimiento

`/api/cron/maintenance` corre tareas diarias: limpieza de GPS antiguos,
expiración de fotos y teléfonos, recálculo de KPIs (FASE 13). Se dispara por el
cron de Vercel (vía `vercel.json`). El header `Authorization: Bearer $CRON_SECRET`
debe estar configurado y `CRON_SECRET` igual en producción. Para correrlo a mano:

```bash
curl -H "Authorization: Bearer <CRON_SECRET>" https://<url-prod>/api/cron/maintenance
```

## 5. Backups y recuperación

Supabase gratis: backups diarios (PITR solo en planes de pago).

### Restore (probado en FASE 13)

1. Dashboard de Supabase → Backups → elegir fecha → _Restore_ (restaura a una
   base temporal para no pisar producción).
2. Verificar los datos en la base temporal.
3. Si se necesita en producción: exportar esa base temporal y cargarla con
   `psql`/`pg_dump` (pedir acceso y hacerlo fuera de horario).

> Procedimiento completo de verificación de backup+restore en la nota de cierre
> de FASE 13. Hacer un drill de restore al menos cada 6 meses.

## 6. App móvil (EAS Build)

Perfiles en `apps/mobile/eas.json`:

- **`development`:** Development Build para desarrollo local.
- **`preview`:** APK interno para distribución directa (choferes/operación).
  Las URLs de API y Supabase ya vienen embebidas.
- **`production`:** AAB para Google Play (requiere vars de Expo para el entorno
  real; configurarlas antes de usarlo).

```bash
pnpm dlx eas-cli login
pnpm dlx eas-cli build -p android --profile preview   # APK interno
pnpm dlx eas-cli build -p android --profile production # AAB Play (V2)
```

Estrategia (nota del maestro): para 1-3 choferes propios **no hace falta Play
Store**; distribuir el APK o usar el canal de pruebas internas. La publicación
pública es V2 y no debe bloquear la operación. Si se publica, completar el Data
Safety form, publicar la política de privacidad, mostrar el prominent
disclosure de ubicación en background antes de pedir el permiso, y preparar el
video de uso de ubicación en background (causa #1 de rechazo).

## 7. Monitoreo y logs

- **Vercel:** Function Logs (últimas ejecuciones) y métricas de uso.
- **Sentry:** errores de servidor y cliente con `SENTRY_DSN` de producción.
- **Supabase:** Dashboard → Logs (SQL, auth, edge). Para SQL de rendimiento,
  correr `EXPLAIN` sobre las queries calientes del panel.
- **Nivel de log:** `LOG_LEVEL` (info por defecto; debug solo para diagnóstico).

## 8. Troubleshooting

| Síntoma                         | Causa probable                                  | Fix                                                                           |
| ------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------- |
| Deploy de Vercel falla en build | Falta una env var de Production                 | Completar en Settings → Env Vars y redeploy                                   |
| `DATABASE_URL` no conecta       | Se usó la conexión directa (IPv6-only)          | Usar Session Pooler (`aws-0-<region>.pooler.supabase.com`), ADR-017           |
| CI cuelga en `pnpm test`        | Web corre tests de integración que necesitan DB | Ya se partió: CI corre `test:ci` + `test:unit`; la integración se corre local |
| Smoke API falla                 | Cambio rompió un endpoint                       | Correr `pnpm --filter @fym/web smoke:api` y revisar Sentry                    |
| Cron maintenance no corre       | `CRON_SECRET` distinto entre Vercel y el check  | Sincronizar el secret; ver §4                                                 |
| APK no actualiza URL            | Env de Expo embebida en el build                | Rebuildear con `eas build` (el APK ya instalado no se actualiza solo)         |

## 9. Checklist de release

1. `pnpm lint` y `pnpm typecheck` verdes.
2. `pnpm test:ci` + `pnpm --filter @fym/web test:unit` verdes.
3. Smoke de los endpoints tocados (`pnpm --filter @fym/web smoke:api`) y smoke
   de browser sobre el preview de Vercel.
4. Migraciones nuevas aplicadas y verificadas (`db:verify`).
5. Push a `main` → verificar en Vercel que el deploy de producción quedó OK.
6. Si tocó la app: `eas build` del perfil correspondiente y distribución.
