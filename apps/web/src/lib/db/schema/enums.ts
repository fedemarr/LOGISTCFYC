import { pgEnum } from "drizzle-orm/pg-core";

/**
 * ⚠️ Copias literales de `ROLES` (@fym/shared) y los arrays FYM
 * (@fym/shared/constants/fym.ts) — la fuente de verdad real es
 * `@fym/shared`, NO este archivo.
 *
 * No se importan directamente porque el bundler de `drizzle-kit` (esbuild
 * vía `@esbuild-kit/*`) no interopera bien con paquetes del workspace
 * pnpm cuyo `exports` apunta a TypeScript fuente. Se mantiene espejado
 * por consistencia con ADR-014.
 */
const ROLES_MIRROR = ["admin", "dispatcher", "warehouse", "driver"] as const;

const SHIFT_STATUS_MIRROR = ["PENDING", "ACTIVE", "ENDED"] as const;

const ZONE_ALERT_TYPE_MIRROR = ["LEFT_ZONE"] as const;

const ZONE_ALERT_STATUS_MIRROR = ["OPEN", "RESOLVED"] as const;

const DELIVERY_ALERT_REASON_MIRROR = ["NOT_HOME", "REFUSED", "OTHER"] as const;

const DELIVERY_ALERT_STATUS_MIRROR = ["OPEN", "CONTACTED", "RESOLVED"] as const;

const STORE_ORDER_STATUS_MIRROR = [
  "PENDING",
  "ASSIGNED",
  "DELIVERED",
  "FAILED",
  "CANCELLED",
] as const;

export const userRoleEnum = pgEnum("user_role", ROLES_MIRROR);

export const shiftStatusEnum = pgEnum("shift_status", SHIFT_STATUS_MIRROR);

export const zoneAlertTypeEnum = pgEnum("zone_alert_type", ZONE_ALERT_TYPE_MIRROR);

export const zoneAlertStatusEnum = pgEnum("zone_alert_status", ZONE_ALERT_STATUS_MIRROR);

export const deliveryAlertReasonEnum = pgEnum(
  "delivery_alert_reason",
  DELIVERY_ALERT_REASON_MIRROR,
);

export const deliveryAlertStatusEnum = pgEnum(
  "delivery_alert_status",
  DELIVERY_ALERT_STATUS_MIRROR,
);

export const storeOrderStatusEnum = pgEnum(
  "store_order_status",
  STORE_ORDER_STATUS_MIRROR,
);

export const eventEntityTypeEnum = pgEnum("event_entity_type", [
  "SHIFT",
  "ZONE",
  "ALERT",
  "USER",
  "ORDER",
]);
