import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";
import { users } from "./users";

/**
 * Conexión de la org con su tienda de Tienda Nube (1:1). El token viene
 * de una "aplicación a medida" — se genera directo desde el admin de
 * Tienda Nube, sin necesitar registrarse como Partner. Sensible: solo se
 * usa server-side (`services/tiendanube.ts`), nunca se manda al cliente.
 */
export const tiendanubeConnections = pgTable("tiendanube_connections", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .unique()
    .references(() => organizations.id),
  storeId: text("store_id").notNull(),
  accessToken: text("access_token").notNull(),
  shopName: text("shop_name"),
  connectedBy: uuid("connected_by").references(() => users.id),
  connectedAt: timestamp("connected_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Select sin `accessToken` — para cualquier respuesta que toque el
 * cliente (el status de conexión, por ejemplo). Usar SIEMPRE este select
 * fuera de `services/tiendanube.ts`. */
export const tiendanubeConnectionPublicSelect = {
  id: tiendanubeConnections.id,
  orgId: tiendanubeConnections.orgId,
  storeId: tiendanubeConnections.storeId,
  shopName: tiendanubeConnections.shopName,
  connectedAt: tiendanubeConnections.connectedAt,
} as const;

export type TiendanubeConnection = typeof tiendanubeConnections.$inferSelect;
export type NewTiendanubeConnection = typeof tiendanubeConnections.$inferInsert;
