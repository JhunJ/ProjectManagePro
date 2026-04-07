#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const cwd = process.cwd();
const envPath = path.resolve(cwd, ".env");

const TABLES = [
  { name: "Project", file: "projects.json", required: true },
  { name: "WorkingCalendar", file: "working-calendars.json", required: false },
  { name: "Company", file: "companies.json", required: false },
  { name: "Task", file: "tasks.json", required: true },
  { name: "Dependency", file: "dependencies.json", required: true },
  { name: "ProjectVersion", file: "versions.json", required: false },
  { name: "Holiday", file: "holidays.json", required: false },
];

function parseEnvLines(lines) {
  const map = new Map();
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    map.set(key, value);
  }
  return map;
}

function readEnvMap() {
  if (!fs.existsSync(envPath)) {
    return new Map();
  }
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  return parseEnvLines(lines);
}

function parseArgs(argv) {
  let outDir = "";
  let sourceUrl = "";
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--out-dir" && argv[i + 1]) {
      outDir = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--source-url" && argv[i + 1]) {
      sourceUrl = argv[i + 1];
      i += 1;
      continue;
    }
  }

  return {
    outDir,
    sourceUrl,
  };
}

function resolveSqlitePath(sqliteUrl) {
  if (!sqliteUrl || !sqliteUrl.startsWith("file:")) {
    throw new Error("DATABASE_URL must be a sqlite file URL (file:...) for export.");
  }

  const value = sqliteUrl.slice("file:".length).split("?")[0].split("#")[0];
  if (!value) {
    throw new Error("Invalid sqlite URL path.");
  }

  let normalized = value;
  if (normalized.startsWith("/")) {
    const windowsAbsolute = normalized.match(/^\/[A-Za-z]:\//);
    if (windowsAbsolute) {
      normalized = normalized.slice(1);
    }
  }

  if (path.isAbsolute(normalized)) {
    return path.normalize(normalized);
  }

  return path.resolve(cwd, normalized);
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function runSqliteJson(dbPath, sql) {
  const attemptWithJsonFlag = spawnSync("sqlite3", ["-json", dbPath, sql], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (attemptWithJsonFlag.error) {
    return { ok: false, stderr: attemptWithJsonFlag.error.message, stdout: "" };
  }

  if (attemptWithJsonFlag.status === 0) {
    return {
      ok: true,
      stdout: attemptWithJsonFlag.stdout ?? "",
      stderr: attemptWithJsonFlag.stderr ?? "",
    };
  }

  const attemptWithMode = spawnSync("sqlite3", [dbPath, ".mode json", sql], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (attemptWithMode.error) {
    return { ok: false, stderr: attemptWithMode.error.message, stdout: "" };
  }

  return {
    ok: attemptWithMode.status === 0,
    stdout: attemptWithMode.stdout ?? "",
    stderr: attemptWithMode.stderr ?? "",
  };
}

function parseJsonRows(stdout) {
  const trimmed = stdout.trim();
  if (!trimmed) return [];
  const parsed = JSON.parse(trimmed);
  if (!Array.isArray(parsed)) {
    throw new Error("sqlite3 output is not a JSON array.");
  }
  return parsed;
}

function exportTable(dbPath, tableName, required) {
  const sql = `SELECT * FROM "${tableName}"`;
  const result = runSqliteJson(dbPath, sql);
  if (!result.ok) {
    const noSuchTable = /no such table/i.test(result.stderr);
    if (noSuchTable && !required) {
      return [];
    }
    throw new Error(`Failed to export table ${tableName}: ${result.stderr || "unknown error"}`);
  }

  try {
    return parseJsonRows(result.stdout);
  } catch (error) {
    throw new Error(
      `Failed to parse sqlite3 output for table ${tableName}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function timestampLabel() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return [
    now.getUTCFullYear(),
    pad(now.getUTCMonth() + 1),
    pad(now.getUTCDate()),
    "-",
    pad(now.getUTCHours()),
    pad(now.getUTCMinutes()),
    pad(now.getUTCSeconds()),
    "Z",
  ].join("");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const env = readEnvMap();
  const sourceUrl = args.sourceUrl || env.get("DATABASE_URL") || "";
  const sqlitePath = resolveSqlitePath(sourceUrl);

  if (!fs.existsSync(sqlitePath)) {
    throw new Error(`sqlite file not found: ${sqlitePath}`);
  }

  const baseOutDir = args.outDir
    ? path.resolve(cwd, args.outDir)
    : path.resolve(cwd, "migration-artifacts", `sqlite-export-${timestampLabel()}`);
  ensureDir(baseOutDir);

  const backupPath = path.join(baseOutDir, "sqlite-backup.db");
  fs.copyFileSync(sqlitePath, backupPath);

  const counts = {};
  for (const table of TABLES) {
    const rows = exportTable(sqlitePath, table.name, table.required);
    fs.writeFileSync(path.join(baseOutDir, table.file), `${JSON.stringify(rows, null, 2)}\n`, "utf8");
    counts[table.name] = rows.length;
  }

  const manifest = {
    createdAt: new Date().toISOString(),
    sourceUrl,
    sqlitePath,
    backupPath,
    counts,
  };
  fs.writeFileSync(path.join(baseOutDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  console.log("[OK] SQLite export completed.");
  console.log(` - outputDir : ${baseOutDir}`);
  console.log(` - backup    : ${backupPath}`);
  for (const [table, count] of Object.entries(counts)) {
    console.log(` - ${table.padEnd(15, " ")} ${count}`);
  }
}

try {
  main();
} catch (error) {
  console.error("[ERROR]", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
