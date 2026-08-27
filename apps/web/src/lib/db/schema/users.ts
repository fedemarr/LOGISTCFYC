import { boolean, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { userRoleEnum } from "./enums";
import { organizations } from "./organizations";

/**
 * `id` = `auth.users.id` (Supabase Auth). Esta tabla NO crea usuarios de
 * auth, solo guarda el perfil/negocio de un usuario que ya existe en
 * `auth.users` — la FK hacia `auth.users` se agrega a mano en la migración
 * (Drizzle no modela el schema `auth` de Supabase).
 */
export const users = pgTable("users", {
  id: uuid("id").primaryKey(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id),
  email: text("email").notNull(),
  fullName: text("full_name").notNull(),
  phone: text("phone"),
  /**
   * Hash SHA-256 del token del QR de identificación del chofer (FYM). El
   * QR autentica SOLO (sin login) — el token nunca se guarda en claro, solo
   * su hash. `null` = al chofer aún no se le generó QR.
   */
  qrTokenHash: text("qr_token_hash"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

/** Un usuario puede tener varios roles simultáneos desde el día 1 (§3). */
export const userRoles = pgTable(
  "user_roles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: userRoleEnum("role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique("user_roles_user_id_role_key").on(table.userId, table.role)],
);
