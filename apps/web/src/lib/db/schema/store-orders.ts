import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { storeOrderStatusEnum } from "./enums";
import { organizations } from "./organizations";
import { driverShifts } from "./driver-shifts";

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
  status: storeOrderStatusEnum("status").notNull().default("PENDING"),
  /** `shipping_status` crudo de Tienda Nube — referencia, no maneja
   * nuestra lógica. */
  externalStatus: text("external_status"),
  shiftId: uuid("shift_id").references(() => driverShifts.id),
  /** Payload completo del pedido tal cual lo devolvió Tienda Nube. */
  rawPayload: jsonb("raw_payload"),
  syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
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
  status: storeOrders.status,
  externalStatus: storeOrders.externalStatus,
  shiftId: storeOrders.shiftId,
  syncedAt: storeOrders.syncedAt,
  deliveredAt: storeOrders.deliveredAt,
} as const;

export type StoreOrder = typeof storeOrders.$inferSelect;
export type NewStoreOrder = typeof storeOrders.$inferInsert;
