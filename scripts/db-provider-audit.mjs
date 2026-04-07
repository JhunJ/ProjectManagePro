#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const cwd = process.cwd();
const envPath = path.resolve(cwd, ".env");
const schemaPath = path.resolve(cwd, "prisma", "schema.prisma");

function parseArgs(argv) {
  const flags = new Set(argv.filter((arg) => arg.startsWith("--")));
  return {
    json: flags.has("--json"),
  };
}

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

function detectProviderFromUrl(url) {
  if (!url) return null;
  if (url.startsWith("file:")) return "sqlite";

  try {
    const parsed = new URL(url);
    const protocol = parsed.protocol.replace(":", "").toLowerCase();
    if (protocol === "postgres" || protocol === "postgresql") return "postgresql";
    if (protocol === "mysql") return "mysql";
    if (protocol === "sqlserver") return "sqlserver";
    if (protocol === "mongodb") return "mongodb";
    if (protocol === "cockroachdb") return "cockroachdb";
    return protocol || null;
  } catch {
    return "unknown";
  }
}

function readSchemaProvider() {
  if (!fs.existsSync(schemaPath)) {
    throw new Error(`Schema file not found: ${schemaPath}`);
  }

  const content = fs.readFileSync(schemaPath, "utf8");
  const datasourceMatch = content.match(/datasource\s+\w+\s*\{[\s\S]*?\}/m);
  if (!datasourceMatch) {
    throw new Error("No datasource block found in prisma/schema.prisma.");
  }

  const providerMatch = datasourceMatch[0].match(/provider\s*=\s*"([^"]+)"/m);
  if (!providerMatch) {
    throw new Error("No datasource provider found in prisma/schema.prisma.");
  }

  return providerMatch[1].toLowerCase();
}

function readEnvMap() {
  if (!fs.existsSync(envPath)) {
    return new Map();
  }
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  return parseEnvLines(lines);
}

function runAudit() {
  const schemaProvider = readSchemaProvider();
  const env = readEnvMap();
  const databaseUrl = env.get("DATABASE_URL") ?? "";
  const directUrl = env.get("DIRECT_URL") ?? "";

  const databaseProvider = detectProviderFromUrl(databaseUrl);
  const directProvider = detectProviderFromUrl(directUrl);

  const problems = [];
  if (!databaseUrl) {
    problems.push("DATABASE_URL is missing.");
  }
  if (!directUrl) {
    problems.push("DIRECT_URL is missing.");
  }
  if (!databaseProvider) {
    problems.push("DATABASE_URL provider could not be detected.");
  }
  if (!directProvider) {
    problems.push("DIRECT_URL provider could not be detected.");
  }
  if (databaseProvider && databaseProvider !== schemaProvider) {
    problems.push(`DATABASE_URL provider mismatch (schema=${schemaProvider}, env=${databaseProvider}).`);
  }
  if (directProvider && directProvider !== schemaProvider) {
    problems.push(`DIRECT_URL provider mismatch (schema=${schemaProvider}, env=${directProvider}).`);
  }

  return {
    ok: problems.length === 0,
    schemaProvider,
    databaseProvider,
    directProvider,
    databaseUrl,
    directUrl,
    problems,
  };
}

function printAudit(result, asJson) {
  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log("=== DB Provider Audit ===");
  console.log(`schema provider : ${result.schemaProvider}`);
  console.log(`DATABASE_URL    : ${result.databaseProvider ?? "unknown"} (${result.databaseUrl || "missing"})`);
  console.log(`DIRECT_URL      : ${result.directProvider ?? "unknown"} (${result.directUrl || "missing"})`);

  if (result.ok) {
    console.log("[OK] Provider configuration is consistent.");
    return;
  }

  console.log("[INVALID] Provider configuration issues:");
  for (const problem of result.problems) {
    console.log(` - ${problem}`);
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = runAudit();
  printAudit(result, args.json);
  process.exitCode = result.ok ? 0 : 1;
}

try {
  main();
} catch (error) {
  console.error("[ERROR]", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
