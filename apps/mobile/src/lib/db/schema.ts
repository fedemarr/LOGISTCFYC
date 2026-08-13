/**
 * Esquema SQLite local — espejo mínimo de lo que el chofer necesita para
 * operar offline (§12): la ruta descargada, sus paradas, y el outbox de
 * acciones pendientes de sincronizar. Nunca se borra nada del outbox
 * hasta confirmación explícita del servidor (§12, regla 8).
 */
export const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS local_route (
  id TEXT PRIMARY KEY,
  route_number INTEGER NOT NULL,
  status TEXT NOT NULL,
  planned_distance_m REAL,
  planned_duration_s INTEGER,
  planned_stops INTEGER,
  color_hex TEXT,
  downloaded_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS local_stop (
  id TEXT PRIMARY KEY,
  route_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  status TEXT NOT NULL,
  package_id TEXT NOT NULL,
  internal_code TEXT NOT NULL,
  tracking_code TEXT,
  bulk_number INTEGER,
  recipient_name TEXT,
  recipient_phone TEXT,
  raw_address_text TEXT,
  lat REAL,
  lng REAL,
  operational_notes TEXT,
  requires_photo INTEGER NOT NULL DEFAULT 0,
  requires_document INTEGER NOT NULL DEFAULT 0,
  priority INTEGER NOT NULL DEFAULT 0,
  arrived_sent INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_local_stop_route ON local_stop(route_id);

CREATE TABLE IF NOT EXISTS local_media (
  id TEXT PRIMARY KEY,
  local_uri TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  storage_path TEXT,
  route_id TEXT NOT NULL,
  stop_id TEXT NOT NULL,
  delivery_key TEXT,
  mime_type TEXT NOT NULL,
  created_at TEXT NOT NULL,
  uploaded_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_local_media_status ON local_media(status);

CREATE TABLE IF NOT EXISTS outbox (
  idempotency_key TEXT PRIMARY KEY,
  operation_type TEXT NOT NULL,
  payload TEXT NOT NULL,
  client_timestamp TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  next_attempt_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_outbox_status ON outbox(status, next_attempt_at);
`;

export const DB_NAME = "fyc-driver.db";

export interface LocalRouteRow {
  id: string;
  route_number: number;
  status: string;
  planned_distance_m: number | null;
  planned_duration_s: number | null;
  planned_stops: number | null;
  color_hex: string | null;
  downloaded_at: string;
}

export interface LocalStopRow {
  id: string;
  route_id: string;
  sequence: number;
  status: string;
  package_id: string;
  internal_code: string;
  tracking_code: string | null;
  bulk_number: number | null;
  recipient_name: string | null;
  recipient_phone: string | null;
  raw_address_text: string | null;
  lat: number | null;
  lng: number | null;
  operational_notes: string | null;
  requires_photo: number;
  requires_document: number;
  priority: number;
  arrived_sent: number;
}

export interface OutboxRow {
  idempotency_key: string;
  operation_type: string;
  payload: string;
  client_timestamp: string;
  status: "pending" | "failed";
  attempts: number;
  last_error: string | null;
  next_attempt_at: string;
  created_at: string;
}

export interface LocalMediaRow {
  id: string;
  local_uri: string;
  status: "pending" | "uploaded" | "failed";
  storage_path: string | null;
  route_id: string;
  stop_id: string;
  delivery_key: string | null;
  mime_type: string;
  created_at: string;
  uploaded_at: string | null;
}
