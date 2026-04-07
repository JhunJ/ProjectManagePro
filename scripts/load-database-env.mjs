/**
 * Load DATABASE_URL / DIRECT_URL from .env (same rules as run-start-with-env.mjs).
 * @param {string} cwd
 * @param {{ defaultUrl?: string, fillDefaults?: boolean }} [opts]
 * @returns {Record<string, string>}
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

export function loadDatabaseEnvFromDotEnv(cwd, opts = {}) {
  const fillDefaults = opts.fillDefaults !== false;
  // Default matches .env.example (native Postgres on 5432). For Docker use `npm run db:url:docker` (port 5433).
  const defaultUrl =
    opts.defaultUrl ?? "postgresql://postgres:postgres@localhost:5432/projectmanagepro";

  const env = { ...process.env };
  const envPath = resolve(cwd, ".env");

  if (existsSync(envPath)) {
    const content = readFileSync(envPath, "utf8");
    for (const line of content.split(/\r?\n/)) {
      const m = line.match(
        /^\s*(DATABASE_URL|DIRECT_URL)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^#\s]+))/,
      );
      const value = m?.[2] ?? m?.[3] ?? m?.[4];
      if (m && value !== undefined) {
        env[m[1]] = value.trim();
      }
    }
  }

  if (fillDefaults && !env.DATABASE_URL?.trim()) {
    env.DATABASE_URL = defaultUrl;
  }
  if (env.DATABASE_URL?.trim() && !env.DIRECT_URL?.trim()) {
    env.DIRECT_URL = env.DATABASE_URL;
  }

  return env;
}
