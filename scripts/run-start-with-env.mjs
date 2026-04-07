#!/usr/bin/env node
/**
 * Start next start (production) with DATABASE_URL/DIRECT_URL from .env.
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { loadDatabaseEnvFromDotEnv } from "./load-database-env.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cwd = resolve(__dirname, "..");
const env = loadDatabaseEnvFromDotEnv(cwd, { fillDefaults: false });

if (!env.DATABASE_URL?.trim()) {
  console.error("[ERROR] DATABASE_URL not set. Create .env or run Start-Server.bat / db:url:setup.");
  process.exit(1);
}

const child = spawn("npx", ["next", "start"], {
  stdio: "inherit",
  env,
  shell: true,
});
child.on("exit", (code) => process.exit(code ?? 0));
