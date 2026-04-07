const TEMPLATE_MARKERS = [
  /project-ref/i,
  /<project-ref>/i,
  /password@/i,
  /<password>/i,
];

function hasTemplateMarker(value: string): boolean {
  return TEMPLATE_MARKERS.some((pattern) => pattern.test(value));
}

function isPostgresUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
      return false;
    }
    if (!parsed.hostname || /[<>]/.test(parsed.hostname)) {
      return false;
    }
    return parsed.pathname.length > 1;
  } catch {
    return false;
  }
}

function isSqliteUrl(value: string): boolean {
  return value.startsWith("file:");
}

export class DatabaseEnvError extends Error {
  readonly code = "DB_ENV_INVALID";

  constructor(message: string) {
    super(message);
    this.name = "DatabaseEnvError";
  }
}

export function assertValidDatabaseEnv() {
  const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
  const directUrl = process.env.DIRECT_URL?.trim() ?? "";

  if (!databaseUrl) {
    throw new DatabaseEnvError(
      "Invalid database configuration: DATABASE_URL is empty. Run `npm run db:url:setup` and restart the dev server.",
    );
  }

  if (isSqliteUrl(databaseUrl)) {
    return;
  }

  if (!directUrl) {
    throw new DatabaseEnvError(
      "Invalid database configuration: DIRECT_URL is empty for PostgreSQL. Run `npm run db:url:setup` and restart the dev server.",
    );
  }

  if (hasTemplateMarker(databaseUrl) || hasTemplateMarker(directUrl)) {
    throw new DatabaseEnvError(
      "Invalid database configuration: template values detected in DATABASE_URL/DIRECT_URL. Replace project-ref/password or switch to local DB with `npm run db:url:local`.",
    );
  }

  if (!isPostgresUrl(databaseUrl) || !isPostgresUrl(directUrl)) {
    throw new DatabaseEnvError(
      "Invalid database configuration: DATABASE_URL or DIRECT_URL is not a valid Postgres URL. URL-encode special password characters, or use local DB via `npm run db:url:local`.",
    );
  }
}
