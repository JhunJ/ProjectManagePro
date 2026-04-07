#!/usr/bin/env node
/**
 * Start next dev with DATABASE_URL/DIRECT_URL from .env (same as production start).
 * If .env is missing, defaults to local postgres:postgres@localhost:5432 (see .env.example).
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { loadDatabaseEnvFromDotEnv } from "./load-database-env.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cwd = resolve(__dirname, "..");
const env = loadDatabaseEnvFromDotEnv(cwd);

const child = spawn("npx", ["next", "dev", "--webpack"], {
  stdio: "inherit",
  env,
  shell: true,
});
child.on("exit", (code) => process.exit(code ?? 0));
