#!/usr/bin/env node

import path from "node:path";
import { spawnSync } from "node:child_process";

const cwd = process.cwd();

function timestampLabel() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}-${pad(
    now.getUTCHours(),
  )}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;
}

function parseArgs(argv) {
  let outDir = "";
  let sourceUrl = "";
  let targetUrl = "";
  let force = false;
  let skipMigrate = false;

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
    if (arg === "--target-url" && argv[i + 1]) {
      targetUrl = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--force") {
      force = true;
      continue;
    }
    if (arg === "--skip-migrate") {
      skipMigrate = true;
    }
  }

  return {
    outDir,
    sourceUrl,
    targetUrl,
    force,
    skipMigrate,
  };
}

function assertProvider(url, expected, label) {
  if (!url) {
    throw new Error(`${label} is required.`);
  }
  if (expected === "sqlite" && !url.startsWith("file:")) {
    throw new Error(`${label} must be a sqlite URL (file:...).`);
  }
  if (expected === "postgres") {
    try {
      const protocol = new URL(url).protocol.replace(":", "").toLowerCase();
      if (protocol !== "postgres" && protocol !== "postgresql") {
        throw new Error();
      }
    } catch {
      throw new Error(`${label} must be a PostgreSQL URL.`);
    }
  }
}

function runCommand(command, args, envPatch = {}) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    env: {
      ...process.env,
      ...envPatch,
    },
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(" ")}`);
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const sourceUrl = args.sourceUrl || process.env.DATABASE_URL || "";
  const targetUrl = args.targetUrl || process.env.TARGET_DATABASE_URL || process.env.DIRECT_URL || "";
  const resolvedOutDir = args.outDir
    ? path.resolve(cwd, args.outDir)
    : path.resolve(cwd, "migration-artifacts", `sqlite-export-${timestampLabel()}`);

  assertProvider(sourceUrl, "sqlite", "source URL");
  assertProvider(targetUrl, "postgres", "target URL");

  console.log("=== SQLite -> PostgreSQL Migration ===");
  console.log(`source URL : ${sourceUrl}`);
  console.log(`target URL : ${targetUrl}`);
  console.log(`output dir : ${resolvedOutDir}`);

  const exportArgs = ["scripts/export-sqlite-snapshot.mjs", "--source-url", sourceUrl];
  exportArgs.push("--out-dir", resolvedOutDir);
  runCommand("node", exportArgs);

  const importArgs = ["scripts/import-sqlite-snapshot.mjs", "--input-dir", resolvedOutDir];
  importArgs.push("--target-url", targetUrl);
  if (args.force) {
    importArgs.push("--force");
  }
  runCommand("node", importArgs);

  if (!args.skipMigrate) {
    runCommand("npx", ["prisma", "migrate", "deploy"], {
      DATABASE_URL: targetUrl,
      DIRECT_URL: targetUrl,
    });
  }

  console.log("[OK] Migration path completed.");
}

try {
  main();
} catch (error) {
  console.error("[ERROR]", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
