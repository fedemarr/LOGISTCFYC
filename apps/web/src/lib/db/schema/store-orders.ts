import {
  doublePrecision,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { storeOrderStatusEnum } from "./enums";
import { organizations } from "./organizations";
import { driverShifts } from "./driver-shifts";
import { zones } from "./zones";

/**
 * Pedido sincronizado desde Tienda Nube (`services/orders.ts`). Excepción
 * deliberada a "FYM no trackea paquetes individuales" — ver el comentario
 * de cabecera en `@fym/shared/constants/fym.ts`.
 */
export const storeOrders = pgTable("store_orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id),
  /** Id numérico del pedido en Tienda Nube, como texto. */
  externalId: text("external_id").notNull(),
  orderNumber: text("order_number").notNull(),
  customerName: text("customer_name"),
  customerPhone: text("customer_phone"),
  customerEmail: text("customer_email"),
  shippingAddress: text("shipping_address"),
  shippingCity: text("shipping_city"),
  shippingProvince: text("shipping_province"),
  /** Geocodificado al sincronizar (nuevo pedido, `services/geocoding.ts`) —
   * null si todavía no se pudo ubicar la dirección. */
  lat: doublePrecision("lat"),
  lng: doublePrecision("lng"),
  /** Zona (geocerca) más cercana al punto geocodificado — SUGERENCIA para
   * agrupar y asignar en bloque, no obliga nada (pedido de Fede:
   * "agrupar por zona/cercanía y asignar en bloque"). */
  suggestedZoneId: uuid("suggested_zone_id").references(() => zones.id),
  status: storeOrderStatusEnum("status").notNull().default("PENDING"),
  /** `shipping_status` crudo de Tienda Nube — referencia, no maneja
   * nuestra lógica. */
  externalStatus: text("external_status"),
  /** "tiendanube" (sincronizado) o "manual" (cargado a mano desde el
   * panel, pedido de Fede: poder probar sin depender de tener Tienda
   * Nube conectada). Un pedido manual NO tiene fulfillment-order real en
   * Tienda Nube — `markOrderDelivered` no intenta avisarle. */
  source: text("source").notNull().default("tiendanube"),
  shiftId: uuid("shift_id").references(() => driverShifts.id),
  /** Payload completo del pedido tal cual lo devolvió Tienda Nube. */
  rawPayload: jsonb("raw_payload"),
  syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  /** Foto que sube el chofer al marcar el pedido entregado desde la PWA
   * (bucket privado `order-delivery-evidence`) — path interno, no URL. */
  evidencePhotoPath: text("evidence_photo_path"),
  /** A quién se le entregó (pedido de Fede: "tenés que marcar a quién se
   * lo entregás y el DNI") — junto con la foto, obligatorios al marcar
   * entregado desde la PWA del chofer. */
  recipientName: text("recipient_name"),
  recipientDni: text("recipient_dni"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const storeOrdersToSelect = {
  id: storeOrders.id,
  orgId: storeOrders.orgId,
  externalId: storeOrders.externalId,
  orderNumber: storeOrders.orderNumber,
  customerName: storeOrders.customerName,
  customerPhone: storeOrders.customerPhone,
  customerEmail: storeOrders.customerEmail,
  shippingAddress: storeOrders.shippingAddress,
  shippingCity: storeOrders.shippingCity,
  shippingProvince: storeOrders.shippingProvince,
  lat: storeOrders.lat,
  lng: storeOrders.lng,
  suggestedZoneId: storeOrders.suggestedZoneId,
  status: storeOrders.status,
  externalStatus: storeOrders.externalStatus,
  source: storeOrders.source,
  shiftId: storeOrders.shiftId,
  syncedAt: storeOrders.syncedAt,
  deliveredAt: storeOrders.deliveredAt,
  evidencePhotoPath: storeOrders.evidencePhotoPath,
  recipientName: storeOrders.recipientName,
  recipientDni: storeOrders.recipientDni,
} as const;

export type StoreOrder = typeof storeOrders.$inferSelect;
export type NewStoreOrder = typeof storeOrders.$inferInsert;
