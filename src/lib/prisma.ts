import "./db-env";
import { PrismaClient } from "@prisma/client";
import { assertValidDatabaseEnv } from "@/lib/env";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  prismaUrl: string | undefined;
};

const LOCAL_DEV_URL =
  "postgresql://postgres:1234@localhost:5432/projectmanagepro";

const DEFAULT_CONNECTION_LIMIT = 5;
const CONNECTION_LIMIT = Math.min(
  20,
  Math.max(1, parseInt(process.env.DB_CONNECTION_LIMIT ?? String(DEFAULT_CONNECTION_LIMIT), 10) || DEFAULT_CONNECTION_LIMIT),
);

function getDatabaseUrl(): string {
  if (process.env.NODE_ENV === "development") {
    return LOCAL_DEV_URL;
  }
  const url = process.env.DATABASE_URL?.trim();
  if (!url) throw new Error("DATABASE_URL is required in production. Set it in .env");
  return url;
}

function addConnectionLimit(url: string): string {
  try {
    const u = new URL(url);
    u.searchParams.set("connection_limit", String(CONNECTION_LIMIT));
    return u.toString();
  } catch {
    const sep = url.includes("?") ? "&" : "?";
    return `${url}${sep}connection_limit=${CONNECTION_LIMIT}`;
  }
}

function getPrismaClient() {
  const databaseUrl = getDatabaseUrl();
  process.env.DATABASE_URL = databaseUrl;
  process.env.DIRECT_URL = databaseUrl;
  assertValidDatabaseEnv();

  if (globalForPrisma.prisma && globalForPrisma.prismaUrl === databaseUrl) {
    return globalForPrisma.prisma;
  }

  const urlWithLimit = addConnectionLimit(databaseUrl);
  const client = new PrismaClient({
    datasourceUrl: urlWithLimit,
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

  globalForPrisma.prisma = client;
  globalForPrisma.prismaUrl = databaseUrl;
  return client;
}

export const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    const client = getPrismaClient() as unknown as Record<PropertyKey, unknown>;
    const value = Reflect.get(client, prop, receiver);

    if (typeof value === "function") {
      return value.bind(client);
    }

    return value;
  },
}) as PrismaClient;
