#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const cwd = process.cwd();
const baseDir = path.resolve(cwd, ".local-postgres");
const dataDir = path.join(baseDir, "data");
const logFile = path.join(baseDir, "server.log");
const passwordFile = path.join(baseDir, "pw.txt");

const port = process.env.LOCAL_PG_PORT || "55432";
const dbName = process.env.LOCAL_PG_DB || "projectmanagepro";
const dbUser = process.env.LOCAL_PG_USER || "postgres";
const dbPassword = process.env.LOCAL_PG_PASSWORD || "pglocal123";
const binDir = process.env.LOCAL_PG_BIN || "C:\\Program Files\\PostgreSQL\\18\\bin";

function exePath(name) {
  return path.join(binDir, `${name}.exe`);
}

function run(name, args, options = {}) {
  const result = spawnSync(exePath(name), args, {
    stdio: "inherit",
    cwd,
    env: {
      ...process.env,
      ...options.env,
    },
  });

  if (result.error) {
    throw result.error;
  }
  return result.status ?? 1;
}

function init() {
  fs.mkdirSync(baseDir, { recursive: true });

  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const hasBaseFiles = fs.existsSync(path.join(dataDir, "PG_VERSION"));
  if (!hasBaseFiles) {
    fs.writeFileSync(passwordFile, dbPassword, "utf8");
    const status = run("initdb", [
      "-D",
      dataDir,
      "-U",
      dbUser,
      "-A",
      "scram-sha-256",
      `--pwfile=${passwordFile}`,
    ]);
    fs.writeFileSync(passwordFile, "", "utf8");
    if (status !== 0) {
      throw new Error("initdb failed.");
    }
  }
}

function start() {
  if (!fs.existsSync(path.join(dataDir, "PG_VERSION"))) {
    throw new Error("Local postgres is not initialized. Run: npm run db:local:init");
  }

  fs.mkdirSync(baseDir, { recursive: true });
  const status = run("pg_ctl", ["-D", dataDir, "-l", logFile, "-o", `-p ${port}`, "start"]);
  if (status !== 0) {
    throw new Error("Failed to start local postgres.");
  }
}

function stop() {
  const status = run("pg_ctl", ["-D", dataDir, "stop", "-m", "fast"]);
  if (status !== 0) {
    throw new Error("Failed to stop local postgres.");
  }
}

function status() {
  const statusCode = run("pg_ctl", ["-D", dataDir, "status"]);
  process.exitCode = statusCode;
}

function ensureDatabase() {
  const status = run(
    "createdb",
    ["-h", "localhost", "-p", port, "-U", dbUser, dbName],
    { env: { PGPASSWORD: dbPassword } },
  );

  if (status !== 0) {
    console.log(`[INFO] createdb exited with status ${status}. Database may already exist.`);
  }
}

function usage() {
  console.log("Usage:");
  console.log("  node scripts/local-postgres.mjs init");
  console.log("  node scripts/local-postgres.mjs start");
  console.log("  node scripts/local-postgres.mjs stop");
  console.log("  node scripts/local-postgres.mjs status");
}

function main() {
  const cmd = process.argv[2];
  if (!cmd || cmd === "--help" || cmd === "-h") {
    usage();
    return;
  }

  if (cmd === "init") {
    init();
    start();
    ensureDatabase();
    console.log(`[OK] Local postgres initialized at ${dataDir}`);
    console.log(`[OK] Listening on localhost:${port}, database=${dbName}`);
    return;
  }

  if (cmd === "start") {
    start();
    console.log(`[OK] Local postgres started on localhost:${port}`);
    return;
  }

  if (cmd === "stop") {
    stop();
    console.log("[OK] Local postgres stopped.");
    return;
  }

  if (cmd === "status") {
    status();
    return;
  }

  usage();
  process.exitCode = 1;
}

try {
  main();
} catch (error) {
  console.error("[ERROR]", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
