import { NextResponse } from "next/server";
import { ZodError } from "zod";

function normalizeMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return "";
}

function mapKnownServerError(message: string): { status: number; message: string } | null {
  const dbUrlInvalidPattern =
    /P1013|database string is invalid|invalid domain character|Error parsing connection string|DB_ENV_INVALID|Invalid database configuration/i;

  if (dbUrlInvalidPattern.test(message)) {
    return {
      status: 500,
      message:
        "Database connection URL is invalid. Check .env DATABASE_URL/DIRECT_URL. Replace template values like <project-ref>, and URL-encode special password characters.",
    };
  }

  const dbUnreachablePattern = /Can't reach database server|P1001|timed out|ECONNREFUSED|ENOTFOUND/i;

  if (dbUnreachablePattern.test(message)) {
    return {
      status: 500,
      message:
        "Database server is unreachable. Verify Supabase host/port, network access, and that DATABASE_URL points to your real project host.",
    };
  }

  const dbTooManyConnections =
    /too many database connections|P2024|Too many database connections opened/i;
  if (dbTooManyConnections.test(message)) {
    return {
      status: 503,
      message:
        "Database connection limit reached. Please try again in a moment. If this persists, the server may need a higher DB_CONNECTION_LIMIT or fewer concurrent users.",
    };
  }

  return null;
}

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export function badRequest(message: string, details?: unknown) {
  return NextResponse.json(
    {
      error: message,
      details,
    },
    { status: 400 },
  );
}

export function notFound(message = "Resource not found.") {
  return NextResponse.json({ error: message }, { status: 404 });
}

export function unauthorized(message = "Unauthorized.") {
  return NextResponse.json({ error: message }, { status: 401 });
}

export function serverError(error: unknown) {
  if (error instanceof ZodError) {
    return badRequest("Invalid request payload.", error.flatten());
  }

  const rawMessage = normalizeMessage(error);
  const known = mapKnownServerError(rawMessage);

  if (known) {
    return NextResponse.json({ error: known.message }, { status: known.status });
  }

  if (error instanceof Error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ error: "Unexpected server error." }, { status: 500 });
}
