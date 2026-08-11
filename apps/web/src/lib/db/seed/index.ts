/**
 * Seed de FASE 2 (§14): 1 org, 4 usuarios (uno por rol), 3 vehículos,
 * 5 contenedores, 120 paquetes de prueba con direcciones reales del GBA.
 *
 * Idempotente: se puede correr varias veces (`pnpm db:seed`) sin duplicar
 * — busca por email/nombre/plate/código antes de insertar.
 */
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { eq } from "drizzle-orm";
import { db } from "../index";
import {
  clients,
  containers,
  knownAddresses,
  operations,
  organizations,
  packages,
  users,
  userRoles,
  vehicles,
} from "../schema";
import { GBA_LOCALITIES, GBA_STREET_NAMES } from "./gba-addresses";
import { syntheticRecipientName } from "./names";

const SEED_PASSWORD = "Lastmile123!";
const ORG_NAME = "Lastmile Demo";

const SEED_USERS = [
  { email: "admin@lastmile.demo", fullName: "Admin Demo", role: "admin" as const },
  {
    email: "operaciones@lastmile.demo",
    fullName: "Operaciones Demo",
    role: "dispatcher" as const,
  },
  {
    email: "deposito@lastmile.demo",
    fullName: "Depósito Demo",
    role: "warehouse" as const,
  },
  { email: "chofer@lastmile.demo", fullName: "Chofer Demo", role: "driver" as const },
];

function mustExist<T>(value: T | undefined, what: string): T {
  if (value === undefined) {
    throw new Error(`Seed: se esperaba encontrar/crear "${what}" y no está.`);
  }
  return value;
}

function normalizeHash(rawText: string): string {
  const normalized = rawText
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // saca acentos
    .replace(/\s+/g, " ")
    .trim();
  return createHash("sha256").update(normalized).digest("hex");
}

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      "Faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en .env",
    );
  }
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** Crea el usuario en Supabase Auth (o reusa el existente por email). */
async function upsertAuthUser(
  supabaseAdmin: ReturnType<typeof getSupabaseAdmin>,
  email: string,
  password: string,
): Promise<string> {
  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (!error && data.user) {
    return data.user.id;
  }

  // Ya existe: buscarlo. supabase-js v2 no tiene getUserByEmail directo,
  // así que se pagina listUsers (alcanza de sobra para 4 usuarios de seed).
  const { data: list, error: listError } = await supabaseAdmin.auth.admin.listUsers({
    perPage: 200,
  });
  if (listError) throw listError;
  const existing = list.users.find((u) => u.email === email);
  if (!existing) {
    throw new Error(
      `No se pudo crear ni encontrar el usuario ${email}: ${error?.message}`,
    );
  }
  return existing.id;
}

async function main(): Promise<void> {
  const supabaseAdmin = getSupabaseAdmin();

  // ── 1. Organización ─────────────────────────────────────────────────
  const existingOrg = await db.query.organizations.findFirst({
    where: eq(organizations.name, ORG_NAME),
  });
  const org = mustExist(
    existingOrg ??
      (await db.insert(organizations).values({ name: ORG_NAME }).returning())[0],
    "organization",
  );
  console.log(`✓ Organización: ${org.name} (${org.id})`);

  // ── 2. Usuarios + roles ──────────────────────────────────────────────
  const userIdByRole: Record<string, string> = {};
  for (const seedUser of SEED_USERS) {
    const authUserId = await upsertAuthUser(supabaseAdmin, seedUser.email, SEED_PASSWORD);

    await db
      .insert(users)
      .values({
        id: authUserId,
        orgId: org.id,
        email: seedUser.email,
        fullName: seedUser.fullName,
      })
      .onConflictDoUpdate({
        target: users.id,
        set: { orgId: org.id, email: seedUser.email, fullName: seedUser.fullName },
      });

    await db
      .insert(userRoles)
      .values({ userId: authUserId, role: seedUser.role })
      .onConflictDoNothing();

    userIdByRole[seedUser.role] = authUserId;
    console.log(
      `✓ Usuario ${seedUser.role.padEnd(10)} ${seedUser.email} (${authUserId})`,
    );
  }

  // ── 3. Vehículos ─────────────────────────────────────────────────────
  const vehicleData = [
    { plate: "AF123BC", brand: "Renault", model: "Kangoo", capacityPackages: 60 },
    { plate: "AG456DE", brand: "Fiat", model: "Fiorino", capacityPackages: 45 },
    { plate: "AH789FG", brand: "Peugeot", model: "Partner", capacityPackages: 55 },
  ];
  for (const v of vehicleData) {
    await db
      .insert(vehicles)
      .values({
        orgId: org.id,
        plate: v.plate,
        brand: v.brand,
        model: v.model,
        capacityPackages: v.capacityPackages,
        assignedDriverId: userIdByRole.driver,
      })
      .onConflictDoNothing({ target: vehicles.plate });
  }
  console.log(`✓ ${vehicleData.length} vehículos`);

  // ── 4. Contenedores ──────────────────────────────────────────────────
  const containerTypes = ["BAG", "BAG", "CART", "CAGE", "SHELF"] as const;
  for (const [i, type] of containerTypes.entries()) {
    await db
      .insert(containers)
      .values({
        orgId: org.id,
        code: `CONT-${String(i + 1).padStart(3, "0")}`,
        type,
      })
      .onConflictDoNothing({ target: containers.code });
  }
  console.log("✓ 5 contenedores");

  // ── 5. Cliente (proveedor de paquetes) ──────────────────────────────
  const existingClient = await db.query.clients.findFirst({
    where: eq(clients.name, "Proveedor Demo"),
  });
  const client = mustExist(
    existingClient ??
      (
        await db
          .insert(clients)
          .values({
            orgId: org.id,
            name: "Proveedor Demo",
            contact: "operaciones@proveedor-demo.com",
          })
          .returning()
      )[0],
    "client",
  );
  console.log(`✓ Cliente: ${client.name} (${client.id})`);

  // ── 6. Operación del día ────────────────────────────────────────────
  const today = new Date().toISOString().slice(0, 10);
  const existingOperation = await db.query.operations.findFirst({
    where: eq(operations.operationDate, today),
  });
  const operation = mustExist(
    existingOperation ??
      (
        await db
          .insert(operations)
          .values({
            orgId: org.id,
            operationDate: today,
            status: "OPEN",
            expectedCount: 120,
            createdBy: userIdByRole.admin,
          })
          .returning()
      )[0],
    "operation",
  );
  console.log(`✓ Operación ${operation.operationDate} (${operation.id})`);

  // ── 7. Direcciones conocidas (GBA real, ver gba-addresses.ts) ───────
  const addressIds: string[] = [];
  let addressSeed = 0;
  for (const locality of GBA_LOCALITIES) {
    // 2 direcciones por localidad → ~56 direcciones distintas para 120 paquetes
    for (let i = 0; i < 2; i++) {
      const street = mustExist(
        GBA_STREET_NAMES[addressSeed % GBA_STREET_NAMES.length],
        "street",
      );
      const number = 100 + ((addressSeed * 137) % 8000);
      const rawText = `${street} ${number}, ${locality.locality}, ${locality.municipality}, Buenos Aires`;
      const hash = normalizeHash(rawText);

      const existing = await db.query.knownAddresses.findFirst({
        where: eq(knownAddresses.normalizedHash, hash),
      });

      const address =
        existing ??
        (
          await db
            .insert(knownAddresses)
            .values({
              orgId: org.id,
              normalizedHash: hash,
              rawText,
              street,
              number: String(number),
              locality: locality.locality,
              municipality: locality.municipality,
              province: locality.province,
              lat: locality.lat,
              lng: locality.lng,
              geocodeSource: "seed-fase-2",
              geocodeAccuracy: "APPROXIMATE",
            })
            .onConflictDoNothing({ target: knownAddresses.normalizedHash })
            .returning()
        )[0];

      // onConflictDoNothing puede devolver [] si ya existía en esta misma
      // corrida (carrera con el findFirst de arriba) — releer si hace falta.
      const resolved =
        address ??
        (await db.query.knownAddresses.findFirst({
          where: eq(knownAddresses.normalizedHash, hash),
        }));
      if (resolved) addressIds.push(resolved.id);

      addressSeed++;
    }
  }
  console.log(`✓ ${addressIds.length} direcciones del GBA`);

  // ── 8. 120 paquetes de prueba ────────────────────────────────────────
  const PACKAGE_COUNT = 120;
  let inserted = 0;
  for (let i = 1; i <= PACKAGE_COUNT; i++) {
    const address = mustExist(addressIds[i % addressIds.length], "address");
    const internalCode = `ML-SEED-${String(i).padStart(4, "0")}`;

    const alreadyExists = await db.query.packages.findFirst({
      where: eq(packages.internalCode, internalCode),
    });
    if (alreadyExists) continue;

    await db.insert(packages).values({
      orgId: org.id,
      clientId: client.id,
      operationId: operation.id,
      trackingCode: `PROV-${String(i).padStart(5, "0")}`,
      internalCode,
      status: "GEOCODIFICADO",
      recipientName: syntheticRecipientName(i),
      recipientPhone: `11${String(40000000 + i * 137).slice(0, 8)}`,
      addressId: address,
      rawAddressText: "(ver known_addresses)",
      destinationSource: "MANIFEST",
      destinationConfidence: "HIGH",
      weightKg: Math.round((0.5 + (i % 15)) * 10) / 10,
      requiresPhoto: i % 5 === 0,
      requiresDocument: i % 20 === 0,
      priority: i % 10 === 0 ? 1 : 0,
    });
    inserted++;
  }
  console.log(
    `✓ ${inserted} paquetes nuevos insertados (${PACKAGE_COUNT - inserted} ya existían)`,
  );

  console.log("\nSeed OK.");
  console.log(`Contraseña de todos los usuarios de seed: ${SEED_PASSWORD}`);
  console.log(`DEFAULT_ORG_ID sugerido para .env: ${org.id}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
