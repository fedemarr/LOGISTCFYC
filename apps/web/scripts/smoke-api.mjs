import { randomUUID } from "node:crypto";
import pg from "pg";

const { Client } = pg;

const BASE = process.env.SMOKE_BASE ?? "http://localhost:3100";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const DATABASE_URL = process.env.DATABASE_URL;

if (!SUPABASE_URL || !ANON_KEY || !DATABASE_URL) {
  console.error("faltan env vars");
  process.exit(1);
}

const admin = await supabaseLogin("admin@fym.demo", "FYM123!");
const driver = await supabaseLogin("chofer@fym.demo", "FYM123!");

console.log("✓ admin token:", admin.slice(0, 12) + "...");
console.log("✓ driver token:", driver.slice(0, 12) + "...");

const noAuth = await api("/api/packages");
console.log("sin token →", noAuth.status, JSON.stringify(noAuth.error));
assert(noAuth.status === 401 && noAuth.error?.code === "UNAUTHORIZED", "401 esperado");

const badAuth = await api("/api/packages", "token-invalido");
console.log("token inválido →", badAuth.status, JSON.stringify(badAuth.error));
assert(badAuth.status === 401 && badAuth.error?.code === "UNAUTHORIZED", "401 esperado");

const sql = new Client({ connectionString: DATABASE_URL });
await sql.connect();

const smokeCode = `SMOKE-${randomUUID().slice(0, 8)}`;
const org = (await sql.query("select id from organizations limit 1")).rows[0];
const inserted = await sql.query(
  `insert into packages (internal_code, status, org_id, recipient_name, recipient_phone)
   values ($1, 'GEOCODIFICADO', $2, 'Smoke Test', 'hash')
   returning id`,
  [smokeCode, org.id],
);
const packageId = inserted.rows[0].id;
console.log("✓ paquete GEOCODIFICADO creado para el smoke:", smokeCode);

const adminList = await api(`/api/packages?search=${encodeURIComponent(smokeCode)}`, admin);
console.log("admin GET /api/packages?search=SMOKE →", adminList.status, "items:", adminList.data?.items?.length, "meta:", JSON.stringify(adminList.meta));
assert(adminList.status === 200 && Array.isArray(adminList.data?.items), "200 + items esperado");
assert(adminList.data.items.some((p) => p.id === packageId), "el paquete debe aparecer para admin");

const driverList = await api("/api/packages", driver);
console.log("driver GET /api/packages →", driverList.status, "items:", driverList.data?.items?.length);
assert(driverList.status === 200, "200 esperado");

const t1 = await api(`/api/packages/${packageId}/transition`, admin, {
  toStatus: "ASIGNADO",
});
console.log("admin GEO→ASIG →", t1.status, JSON.stringify(t1.data ?? t1.error));
assert(t1.status === 201 && t1.data?.toStatus === "ASIGNADO", "201 ASIGNADO esperado");

const t2 = await api(`/api/packages/${packageId}/transition`, admin, {
  toStatus: "CARGADO",
});
console.log("admin ASIG→CARGADO →", t2.status, JSON.stringify(t2.error));
assert(t2.status === 403 && t2.error?.code === "FORBIDDEN_TRANSITION", "403 esperado (admin no toma custodia)");

const t3 = await api(`/api/packages/${packageId}/transition`, driver, {
  toStatus: "CARGADO",
});
console.log("driver ASIG→CARGADO →", t3.status, JSON.stringify(t3.data ?? t3.error));
assert(t3.status === 201 && t3.data?.toStatus === "CARGADO", "201 CARGADO esperado");

const t4 = await api(`/api/packages/${packageId}/transition`, driver, {
  toStatus: "EN_REPARTO",
});
console.log("driver CARGADO→EN_REPARTO →", t4.status, JSON.stringify(t4.data ?? t4.error));
assert(t4.status === 201 && t4.data?.toStatus === "EN_REPARTO", "201 EN_REPARTO esperado");

const t5 = await api(`/api/packages/${packageId}/transition`, driver, {
  toStatus: "EN_DOMICILIO",
});
console.log("driver EN_REPARTO→EN_DOMICILIO →", t5.status, JSON.stringify(t5.data ?? t5.error));
assert(t5.status === 201 && t5.data?.toStatus === "EN_DOMICILIO", "201 EN_DOMICILIO esperado");

const t6 = await api(`/api/packages/${packageId}/transition`, driver, {
  toStatus: "ENTREGADO",
});
console.log("driver EN_DOMICILIO→ENTREGADO (sin evidencia) →", t6.status, JSON.stringify(t6.error));
assert(t6.status === 422 && t6.error?.code === "PRECONDITION_FAILED", "422 esperado");

const t7 = await api(`/api/packages/${packageId}/transition`, driver, {
  toStatus: "ENTREGADO",
  metadata: {
    receiverName: "Smoke Test",
    gps: { lat: -34.6, lng: -58.4 },
  },
});
console.log("driver EN_DOMICILIO→ENTREGADO (con evidencia) →", t7.status, JSON.stringify(t7.data ?? t7.error));
assert(t7.status === 201 && t7.data?.toStatus === "ENTREGADO", "201 ENTREGADO esperado");

console.log("\n✓✓ SMOKE TEST OK — todos los asserts pasaron");

if (process.env.SMOKE_CLEANUP === "1") {
  await sql.query("alter table events disable trigger events_forbid_delete");
  await sql.query("delete from events where entity_id = $1", [packageId]);
  await sql.query("delete from packages where id = $1", [packageId]);
  await sql.query("alter table events enable trigger events_forbid_delete");
  console.log("✓ limpieza ok (eventos y paquete del smoke borrados)");
}
await sql.end();

function assert(cond, msg) {
  if (!cond) {
    console.error("✗ ASSERT FALLADO:", msg);
    process.exit(1);
  }
}

async function supabaseLogin(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      apikey: ANON_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`login ${email} falló: ${JSON.stringify(body)}`);
  return body.access_token;
}

async function api(path, token, body) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers["Content-Type"] = "application/json";
  const res = await fetch(`${BASE}${path}`, {
    method: body ? "POST" : "GET",
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let json;
  try {
    json = await res.json();
  } catch {
    json = { raw: await res.text() };
  }
  return { status: res.status, ...json };
}
