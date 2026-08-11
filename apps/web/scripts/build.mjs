import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const envFile = resolve(root, ".env");

for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (m && !(m[1] in process.env)) {
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

process.env.NODE_ENV = "production";

const nextCli = resolve(dirname(fileURLToPath(import.meta.url)), "../node_modules/next/dist/bin/next");
const child = spawn(process.execPath, [nextCli, "build"], { stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 1));
