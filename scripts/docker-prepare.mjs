#!/usr/bin/env node
/**
 * Start Docker Postgres, point .env at localhost:5433, apply schema (prisma db push).
 */
import { spawnSync } from "node:child_process";

function run(cmd, args) {
  const result = spawnSync(cmd, args, {
    stdio: "inherit",
    shell: true,
    cwd: process.cwd(),
    env: process.env,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run("docker", ["compose", "up", "-d"]);
run("node", ["scripts/setup-db-env.mjs", "--set-docker"]);
run("npx", ["prisma", "db", "push"]);
console.log("[OK] Docker DB ready. DATABASE_URL uses localhost:5433.");
