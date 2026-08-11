import { boolean, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { containerTypeEnum } from "./enums";
import { organizations } from "./organizations";

/** Físicos y reutilizables: bolsas, carros, jaulas. */
export const containers = pgTable("containers", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id),
  code: text("code").notNull().unique(),
  qrPayload: text("qr_payload"),
  type: containerTypeEnum("type").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});
