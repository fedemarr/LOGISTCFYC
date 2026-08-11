CREATE TYPE "public"."code_format" AS ENUM('QR', 'CODE_128', 'CODE_39', 'PDF417', 'DATA_MATRIX', 'EAN_13', 'OTHER', 'MANUAL');--> statement-breakpoint
CREATE TYPE "public"."container_type" AS ENUM('BAG', 'CART', 'CAGE', 'SHELF');--> statement-breakpoint
CREATE TYPE "public"."custody_method" AS ENUM('COUNT', 'FULL_SCAN');--> statement-breakpoint
CREATE TYPE "public"."custody_status" AS ENUM('OK', 'DISCREPANCY', 'RESOLVED', 'OVERRIDDEN');--> statement-breakpoint
CREATE TYPE "public"."delivery_outcome" AS ENUM('DELIVERED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."destination_confidence" AS ENUM('HIGH', 'MEDIUM', 'LOW');--> statement-breakpoint
CREATE TYPE "public"."destination_source" AS ENUM('MANIFEST', 'BARCODE_PAYLOAD', 'OCR', 'MANUAL', 'ADDRESS_MEMORY');--> statement-breakpoint
CREATE TYPE "public"."event_entity_type" AS ENUM('PACKAGE', 'ROUTE', 'DELIVERY', 'INCIDENT', 'CUSTODY', 'USER', 'VEHICLE', 'OPERATION');--> statement-breakpoint
CREATE TYPE "public"."geocode_accuracy" AS ENUM('ROOFTOP', 'INTERPOLATED', 'APPROXIMATE', 'MANUAL', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."incident_reason" AS ENUM('NO_ONE_HOME', 'NO_ANSWER', 'WRONG_ADDRESS', 'NONEXISTENT_ADDRESS', 'REFUSED', 'NO_ACCESS', 'UNSAFE_AREA', 'VEHICLE_ISSUE', 'DAMAGED', 'MISSING_BULK', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."incident_resolution" AS ENUM('RETRY_NOW', 'RESCHEDULE', 'RETURN', 'DELIVER_ANYWAY', 'CANCEL');--> statement-breakpoint
CREATE TYPE "public"."incident_status" AS ENUM('OPEN', 'ASSIGNED', 'RESOLVED', 'ESCALATED');--> statement-breakpoint
CREATE TYPE "public"."operation_status" AS ENUM('OPEN', 'CLOSED');--> statement-breakpoint
CREATE TYPE "public"."package_status" AS ENUM('PENDIENTE_RESOLUCION', 'RECIBIDO', 'GEOCODIFICADO', 'ASIGNADO', 'CARGADO', 'EN_REPARTO', 'EN_DOMICILIO', 'ENTREGADO', 'FALLA_REPORTADA', 'REPROGRAMADO', 'DEVUELTO', 'EXTRAVIADO', 'DANIADO', 'CANCELADO');--> statement-breakpoint
CREATE TYPE "public"."route_status" AS ENUM('DRAFT', 'PROPOSED', 'APPROVED', 'ASSIGNED', 'LOADING', 'LOADED', 'IN_TRANSIT', 'COMPLETED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."route_stop_status" AS ENUM('PENDING', 'ARRIVED', 'COMPLETED', 'SKIPPED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."scan_context" AS ENUM('INTAKE', 'SORTING', 'LOADING', 'DELIVERY', 'AUDIT');--> statement-breakpoint
CREATE TYPE "public"."sync_status" AS ENUM('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CONFLICT');--> statement-breakpoint
CREATE TYPE "public"."ticket_category" AS ENUM('GENERAL', 'TECHNICAL', 'PAYMENT', 'ROUTE', 'VEHICLE', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."ticket_priority" AS ENUM('LOW', 'MEDIUM', 'HIGH', 'URGENT');--> statement-breakpoint
CREATE TYPE "public"."ticket_status" AS ENUM('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('admin', 'dispatcher', 'warehouse', 'driver');--> statement-breakpoint
CREATE TYPE "public"."vehicle_status" AS ENUM('AVAILABLE', 'IN_ROUTE', 'MAINTENANCE', 'OUT_OF_SERVICE');--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"timezone" text DEFAULT 'America/Argentina/Buenos_Aires' NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "user_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_roles_user_id_role_key" UNIQUE("user_id","role")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"email" text NOT NULL,
	"full_name" text NOT NULL,
	"phone" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"contact" text,
	"pricing_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"operation_date" date NOT NULL,
	"status" "operation_status" DEFAULT 'OPEN' NOT NULL,
	"expected_count" integer DEFAULT 0 NOT NULL,
	"received_count" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "operations_org_id_operation_date_key" UNIQUE("org_id","operation_date")
);
--> statement-breakpoint
CREATE TABLE "geocode_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"query_hash" text NOT NULL,
	"provider" text NOT NULL,
	"raw_response" jsonb NOT NULL,
	"lat" double precision,
	"lng" double precision,
	"accuracy" "geocode_accuracy",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "geocode_cache_query_hash_unique" UNIQUE("query_hash")
);
--> statement-breakpoint
CREATE TABLE "known_addresses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"normalized_hash" text NOT NULL,
	"raw_text" text NOT NULL,
	"street" text,
	"number" text,
	"floor" text,
	"apartment" text,
	"locality" text,
	"municipality" text,
	"province" text,
	"postal_code" text,
	"lat" double precision,
	"lng" double precision,
	"geocode_source" text,
	"geocode_accuracy" "geocode_accuracy" DEFAULT 'MANUAL' NOT NULL,
	"operational_notes" text,
	"delivery_success_count" integer DEFAULT 0 NOT NULL,
	"delivery_fail_count" integer DEFAULT 0 NOT NULL,
	"verified_by_driver" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "known_addresses_normalized_hash_unique" UNIQUE("normalized_hash")
);
--> statement-breakpoint
CREATE TABLE "vehicles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"plate" text NOT NULL,
	"brand" text,
	"model" text,
	"year" integer,
	"capacity_packages" integer,
	"capacity_m3" double precision,
	"capacity_kg" double precision,
	"status" "vehicle_status" DEFAULT 'AVAILABLE' NOT NULL,
	"current_odometer" integer,
	"insurance_expiry" date,
	"vtv_expiry" date,
	"assigned_driver_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "vehicles_plate_unique" UNIQUE("plate")
);
--> statement-breakpoint
CREATE TABLE "containers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"code" text NOT NULL,
	"qr_payload" text,
	"type" "container_type" NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "containers_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "routes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"operation_id" uuid NOT NULL,
	"route_number" integer NOT NULL,
	"container_id" uuid,
	"status" "route_status" DEFAULT 'DRAFT' NOT NULL,
	"assigned_driver_id" uuid,
	"vehicle_id" uuid,
	"planned_distance_m" double precision,
	"planned_duration_s" integer,
	"planned_stops" integer,
	"actual_distance_m" double precision,
	"actual_duration_s" integer,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"zone_label" text,
	"color_hex" text,
	"optimization_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "packages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"client_id" uuid,
	"operation_id" uuid,
	"tracking_code" text,
	"internal_code" text NOT NULL,
	"status" "package_status" DEFAULT 'PENDIENTE_RESOLUCION' NOT NULL,
	"recipient_name" text,
	"recipient_phone" text,
	"recipient_document_hash" text,
	"address_id" uuid,
	"raw_address_text" text,
	"destination_source" "destination_source",
	"destination_confidence" "destination_confidence",
	"label_photo_url" text,
	"weight_kg" double precision,
	"dimensions" jsonb,
	"declared_value" numeric,
	"requires_photo" boolean DEFAULT false NOT NULL,
	"requires_document" boolean DEFAULT false NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"delivery_attempts" integer DEFAULT 0 NOT NULL,
	"route_id" uuid,
	"bulk_number" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "packages_internal_code_unique" UNIQUE("internal_code")
);
--> statement-breakpoint
CREATE TABLE "route_stops" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"route_id" uuid NOT NULL,
	"package_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"planned_arrival" timestamp with time zone,
	"actual_arrival" timestamp with time zone,
	"distance_from_prev_m" double precision,
	"duration_from_prev_s" integer,
	"status" "route_stop_status" DEFAULT 'PENDING' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "route_stops_route_id_package_id_key" UNIQUE("route_id","package_id")
);
--> statement-breakpoint
CREATE TABLE "package_scans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"package_id" uuid,
	"org_id" uuid NOT NULL,
	"raw_code" text NOT NULL,
	"code_format" "code_format" NOT NULL,
	"scanned_by" uuid,
	"scanned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"device_id" text,
	"lat" double precision,
	"lng" double precision,
	"scan_context" "scan_context" NOT NULL,
	"photo_url" text,
	"ocr_raw_text" text,
	"ocr_confidence" numeric
);
--> statement-breakpoint
CREATE TABLE "custody_transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"route_id" uuid NOT NULL,
	"container_id" uuid,
	"from_user_id" uuid,
	"to_user_id" uuid NOT NULL,
	"expected_count" integer NOT NULL,
	"counted_count" integer,
	"method" "custody_method" DEFAULT 'COUNT' NOT NULL,
	"status" "custody_status" DEFAULT 'OK' NOT NULL,
	"discrepancy_notes" text,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"override_reason" text,
	"lat" double precision,
	"lng" double precision,
	"transferred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"package_id" uuid NOT NULL,
	"route_id" uuid,
	"driver_id" uuid,
	"vehicle_id" uuid,
	"outcome" "delivery_outcome" NOT NULL,
	"receiver_name" text,
	"receiver_relationship" text,
	"document_last4" text,
	"document_hash" text,
	"signature_url" text,
	"photo_urls" text[] DEFAULT '{}' NOT NULL,
	"lat" double precision,
	"lng" double precision,
	"gps_accuracy_m" double precision,
	"distance_from_target_m" double precision,
	"delivered_at" timestamp with time zone NOT NULL,
	"synced_at" timestamp with time zone,
	"device_id" text,
	"idempotency_key" text NOT NULL,
	"offline_created" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deliveries_package_id_unique" UNIQUE("package_id"),
	CONSTRAINT "deliveries_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"package_id" uuid,
	"route_id" uuid,
	"driver_id" uuid,
	"reason" "incident_reason" NOT NULL,
	"description" text,
	"photo_urls" text[] DEFAULT '{}' NOT NULL,
	"lat" double precision,
	"lng" double precision,
	"status" "incident_status" DEFAULT 'OPEN' NOT NULL,
	"resolution" "incident_resolution",
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"response_time_s" integer,
	"proposed_address_text" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"ticket_number" text NOT NULL,
	"driver_id" uuid,
	"package_id" uuid,
	"route_id" uuid,
	"category" "ticket_category" DEFAULT 'GENERAL' NOT NULL,
	"subject" text NOT NULL,
	"status" "ticket_status" DEFAULT 'OPEN' NOT NULL,
	"priority" "ticket_priority" DEFAULT 'MEDIUM' NOT NULL,
	"assigned_to" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "support_tickets_ticket_number_unique" UNIQUE("ticket_number")
);
--> statement-breakpoint
CREATE TABLE "ticket_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"user_id" uuid,
	"message" text NOT NULL,
	"attachment_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- PARTICIONADA POR MES sobre recorded_at (§7/§10). Toda tabla particionada
-- por rango debe incluir la columna de partición en su PK, por eso la PK
-- es compuesta (id, recorded_at) en vez de solo (id).
CREATE TABLE "driver_locations" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"driver_id" uuid NOT NULL,
	"route_id" uuid,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"accuracy_m" double precision,
	"speed_mps" double precision,
	"heading" double precision,
	"battery_level" double precision,
	"is_moving" boolean,
	"recorded_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	PRIMARY KEY ("id", "recorded_at")
) PARTITION BY RANGE ("recorded_at");
--> statement-breakpoint
-- PARTICIONADA POR MES sobre occurred_at (§7). APPEND-ONLY: sin UPDATE ni
-- DELETE (se revoca más abajo). `corrects_event_id` NO lleva FK — ver
-- comentario en apps/web/src/lib/db/schema/events.ts y ADR-014.
CREATE TABLE "events" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"entity_type" "event_entity_type" NOT NULL,
	"entity_id" uuid NOT NULL,
	"event_type" varchar(100) NOT NULL,
	"actor_id" uuid,
	"actor_role" varchar(50),
	"previous_state" varchar(100),
	"new_state" varchar(100),
	"lat" double precision,
	"lng" double precision,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"corrects_event_id" uuid,
	"occurred_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	PRIMARY KEY ("id", "occurred_at")
) PARTITION BY RANGE ("occurred_at");
--> statement-breakpoint
CREATE TABLE "sync_queue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_id" text NOT NULL,
	"user_id" uuid,
	"idempotency_key" text NOT NULL,
	"operation_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "sync_status" DEFAULT 'PENDING' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"client_timestamp" timestamp with time zone NOT NULL,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sync_queue_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operations" ADD CONSTRAINT "operations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operations" ADD CONSTRAINT "operations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "known_addresses" ADD CONSTRAINT "known_addresses_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_assigned_driver_id_users_id_fk" FOREIGN KEY ("assigned_driver_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "containers" ADD CONSTRAINT "containers_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routes" ADD CONSTRAINT "routes_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routes" ADD CONSTRAINT "routes_operation_id_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."operations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routes" ADD CONSTRAINT "routes_container_id_containers_id_fk" FOREIGN KEY ("container_id") REFERENCES "public"."containers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routes" ADD CONSTRAINT "routes_assigned_driver_id_users_id_fk" FOREIGN KEY ("assigned_driver_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routes" ADD CONSTRAINT "routes_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packages" ADD CONSTRAINT "packages_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packages" ADD CONSTRAINT "packages_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packages" ADD CONSTRAINT "packages_operation_id_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."operations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packages" ADD CONSTRAINT "packages_address_id_known_addresses_id_fk" FOREIGN KEY ("address_id") REFERENCES "public"."known_addresses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packages" ADD CONSTRAINT "packages_route_id_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."routes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_stops" ADD CONSTRAINT "route_stops_route_id_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."routes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_stops" ADD CONSTRAINT "route_stops_package_id_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."packages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_scans" ADD CONSTRAINT "package_scans_package_id_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."packages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_scans" ADD CONSTRAINT "package_scans_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_scans" ADD CONSTRAINT "package_scans_scanned_by_users_id_fk" FOREIGN KEY ("scanned_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custody_transfers" ADD CONSTRAINT "custody_transfers_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custody_transfers" ADD CONSTRAINT "custody_transfers_route_id_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."routes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custody_transfers" ADD CONSTRAINT "custody_transfers_container_id_containers_id_fk" FOREIGN KEY ("container_id") REFERENCES "public"."containers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custody_transfers" ADD CONSTRAINT "custody_transfers_from_user_id_users_id_fk" FOREIGN KEY ("from_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custody_transfers" ADD CONSTRAINT "custody_transfers_to_user_id_users_id_fk" FOREIGN KEY ("to_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custody_transfers" ADD CONSTRAINT "custody_transfers_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_package_id_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."packages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_route_id_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."routes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_driver_id_users_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_package_id_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."packages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_route_id_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."routes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_driver_id_users_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_driver_id_users_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_package_id_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."packages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_route_id_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."routes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_ticket_id_support_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."support_tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_locations" ADD CONSTRAINT "driver_locations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_locations" ADD CONSTRAINT "driver_locations_driver_id_users_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_locations" ADD CONSTRAINT "driver_locations_route_id_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."routes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_queue" ADD CONSTRAINT "sync_queue_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "packages_org_id_status_idx" ON "packages" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "packages_operation_id_idx" ON "packages" USING btree ("operation_id");--> statement-breakpoint
CREATE INDEX "packages_route_id_idx" ON "packages" USING btree ("route_id");--> statement-breakpoint
CREATE INDEX "packages_tracking_code_idx" ON "packages" USING btree ("tracking_code");--> statement-breakpoint
CREATE INDEX "route_stops_route_id_idx" ON "route_stops" USING btree ("route_id");--> statement-breakpoint
CREATE INDEX "route_stops_package_id_idx" ON "route_stops" USING btree ("package_id");--> statement-breakpoint
CREATE INDEX "package_scans_raw_code_idx" ON "package_scans" USING btree ("raw_code");--> statement-breakpoint
CREATE INDEX "package_scans_package_id_idx" ON "package_scans" USING btree ("package_id");