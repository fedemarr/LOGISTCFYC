/**
 * Smoke test EN NAVEGADOR REAL — el resto de la suite (typecheck/lint/
 * test/build) nunca ejecuta el árbol de React en un browser de verdad,
 * así que bugs de wiring (contexto de React mal montado, un cliente HTTP
 * que tira la forma de la respuesta) pasan typecheck/lint/test/build
 * sin problema y solo se ven como "Application error" en producción. Este
 * script existe porque eso pasó de verdad (Toaster montado como hermano
 * en vez de ancestro, `apiFetch` descartando `meta` — ver
 * docs/DECISIONES.md ADR-040). Usalo después de cada cambio de UI, antes
 * de dar por buena una pantalla.
 *
 * Requiere Chrome instalado (usa `playwright-core`, sin descargar
 * binarios de browser — apunta a un Chrome/Edge existente del sistema).
 *
 * Uso:
 *   pnpm smoke:browser                                    # contra localhost:3100
 *   SMOKE_BASE=https://tu-deploy.vercel.app pnpm smoke:browser
 *   SMOKE_EMAIL=... SMOKE_PASSWORD=... pnpm smoke:browser  # default: admin@fym.demo / FYM123!
 */
import { existsSync } from "node:fs";
import { chromium } from "playwright-core";

const BASE = process.env.SMOKE_BASE ?? "http://localhost:3100";
const EMAIL = process.env.SMOKE_EMAIL ?? "admin@fym.demo";
const PASSWORD = process.env.SMOKE_PASSWORD ?? "FYM123!";
const PAGES = [
  "/",
  "/choferes",
  "/zonas",
  "/alertas",
  "/metricas",
  "/monitoreo",
  "/pedidos",
  "/usuarios",
];

function findChrome() {
  const candidates = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium-browser",
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  return undefined; // deja que playwright-core intente resolver el default
}

const browser = await chromium.launch({
  executablePath: findChrome(),
  headless: true,
});
const page = await browser.newPage();

const logsByUrl = {};
let current = "";
const log = (line) => (logsByUrl[current] ??= []).push(line);

page.on("console", (msg) => {
  if (msg.type() === "error" || msg.type() === "warning") {
    log(`[console.${msg.type()}] ${msg.text()}`);
  }
});
page.on("pageerror", (err) => log(`[pageerror] ${err.message}`));
page.on("requestfailed", (req) => log(`[requestfailed] ${req.url()} — ${req.failure()?.errorText}`));
page.on("response", (res) => {
  if (res.status() >= 400) log(`[http ${res.status()}] ${res.url()}`);
});

async function visit(path) {
  current = path;
  logsByUrl[current] ??= [];
  try {
    await page.goto(BASE + path, { waitUntil: "networkidle", timeout: 30_000 });
  } catch (e) {
    log(`[goto error] ${e.message}`);
  }
  await page.waitForTimeout(1500);
}

await visit("/login");
await page.fill("#email", EMAIL);
await page.fill("#password", PASSWORD);
await page.click('button[type="submit"]');
await page.waitForTimeout(2500);

for (const path of PAGES) await visit(path);

let failed = false;
for (const [url, lines] of Object.entries(logsByUrl)) {
  const real = lines.filter((l) => !l.includes("was preloaded using link preload")); // ruido de Next, no un bug
  console.log(`\n=== ${url} ===`);
  if (real.length === 0) {
    console.log("✓ sin errores");
  } else {
    failed = true;
    console.log(real.join("\n"));
  }
}

await browser.close();
if (failed) {
  console.error("\n✗ smoke:browser encontró errores — ver arriba");
  process.exit(1);
}
console.log("\n✓ smoke:browser: todas las pantallas cargaron sin errores de consola");
