/**
 * Seed FYM (control de choferes): 1 org, 4 usuarios del panel + 2 choferes
 * (uno con QR), 3 zonas de geocerca y un turno de ejemplo cerrado para que
 * las métricas muestren datos.
 *
 * Idempotente: se puede correr varias veces (`pnpm db:seed`) sin duplicar.
 * Los choferes tienen QR generado (hash en `users.qr_token_hash`); el token
 * en CLARO se imprime para armar el QR de prueba.
 */
import { createHash, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { eq } from "drizzle-orm";
import { db } from "../index";
import { driverShifts, organizations, userRoles, users, zones } from "../schema";

const SEED_PASSWORD = "FYM123!";
const ORG_NAME = "FYM Demo";

const SEED_USERS = [
  { email: "admin@fym.demo", fullName: "Admin Demo", role: "admin" as const },
  {
    email: "operaciones@fym.demo",
    fullName: "Operaciones Demo",
    role: "dispatcher" as const,
  },
  {
    email: "deposito@fym.demo",
    fullName: "Depósito Demo",
    role: "warehouse" as const,
  },
  { email: "chofer@fym.demo", fullName: "Chofer Demo", role: "driver" as const },
];

const SEED_ZONES = [
  {
    name: "Centro",
    colorHex: "#3b82f6",
    centerLat: -34.6037,
    centerLng: -58.3816,
    radiusM: 6000,
  },
  {
    name: "Palermo / Belgrano",
    colorHex: "#22c55e",
    centerLat: -34.584,
    centerLng: -58.427,
    radiusM: 4000,
  },
  {
    name: "La Plata",
    colorHex: "#f59e0b",
    centerLat: -34.9215,
    centerLng: -57.9545,
    radiusM: 5000,
  },
];

function mustExist<T>(value: T | undefined, what: string): T {
  if (value === undefined) {
    throw new Error(`Seed: se esperaba encontrar/crear "${what}" y no está.`);
  }
  return value;
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

  const { data: list } = await supabaseAdmin.auth.admin.listUsers({ perPage: 200 });
  const existing = list?.users.find((u) => u.email === email);
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
    console.log(`✓ Usuario ${seedUser.role.padEnd(10)} ${seedUser.email}`);
  }

  // ── 3. QR del chofer ────────────────────────────────────────────────
  const choferId = mustExist(userIdByRole.driver, "usuarios chofer");
  const driverToken = randomBytes(32).toString("base64url");
  const driverHash = createHash("sha256").update(driverToken).digest("hex");
  await db.update(users).set({ qrTokenHash: driverHash }).where(eq(users.id, choferId));
  console.log(`✓ QR del Chofer Demo (token en claro — NO es un secret):
  ${driverToken}`);

  // ── 4. Zonas ────────────────────────────────────────────────────────
  for (const z of SEED_ZONES) {
    const existingZone = await db.query.zones.findFirst({
      where: eq(zones.name, z.name),
    });
    if (!existingZone) {
      await db.insert(zones).values({ orgId: org.id, isActive: true, ...z });
    }
  }

  const [centro] = await db
    .select()
    .from(zones)
    .where(eq(zones.orgId, org.id))
    .orderBy(zones.name)
    .limit(1);
  console.log(`✓ ${SEED_ZONES.length} zonas de geocerca`);

  // ── 5. Turno de ejemplo de HOY (cerrado) para métricas ──────────────
  const alreadyHasShiftToday = await db.query.driverShifts.findFirst({
    where: eq(driverShifts.driverId, choferId),
  });
  if (!alreadyHasShiftToday && centro) {
    const started = new Date();
    started.setHours(9, 0, 0, 0);
    const ended = new Date(started);
    ended.setHours(14, 30, 0, 0);

    await db.insert(driverShifts).values({
      orgId: org.id,
      driverId: choferId,
      zoneId: centro.id,
      shiftDate: started.toISOString().slice(0, 10),
      packageCount: 40,
      status: "ENDED",
      startedAt: started,
      endedAt: ended,
      undeliveredCount: 3,
      notes: "Turno de ejemplo del seed",
    });
    console.log("✓ Turno de ejemplo de hoy (40 paquetes, 3 sin repartir)");
  }

  console.log("\nSeed OK.");
  console.log(`Contraseña de todos los usuarios de seed: ${SEED_PASSWORD}`);
  console.log(`DEFAULT_ORG_ID sugerido para .env: ${org.id}`);
  console.log(
    "Entrada al panel: admin@fym.demo / FYM123! en /login. " +
      "App del chofer: escanear el QR con la URL /chofer?t=<token> impreso arriba.",
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
