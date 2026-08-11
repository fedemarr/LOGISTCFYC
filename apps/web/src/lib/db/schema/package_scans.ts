import {
  doublePrecision,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { codeFormatEnum, scanContextEnum } from "./enums";
import { organizations } from "./organizations";
import { packages } from "./packages";
import { users } from "./users";

/**
 * Auditoría de la ingesta (§2): `rawCode` se guarda SIEMPRE crudo, sin
 * parsear, sin limpiar. Es lo que permite reprocesar históricos si más
 * adelante se descubre estructura en el código de un proveedor.
 */
export const packageScans = pgTable(
  "package_scans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    packageId: uuid("package_id").references(() => packages.id),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id),
    rawCode: text("raw_code").notNull(),
    codeFormat: codeFormatEnum("code_format").notNull(),
    scannedBy: uuid("scanned_by").references(() => users.id),
    scannedAt: timestamp("scanned_at", { withTimezone: true }).notNull().defaultNow(),
    deviceId: text("device_id"),
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    scanContext: scanContextEnum("scan_context").notNull(),
    photoUrl: text("photo_url"),
    ocrRawText: text("ocr_raw_text"),
    ocrConfidence: numeric("ocr_confidence"),
  },
  (table) => [
    index("package_scans_raw_code_idx").on(table.rawCode),
    index("package_scans_package_id_idx").on(table.packageId),
  ],
);
