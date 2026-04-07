/**
 * Set DATABASE_URL before any Prisma import so the client sees it.
 * Must be imported first in prisma.ts. In dev we always override so Turbopack cannot leave it empty.
 */
if (typeof process !== "undefined" && process.env.NODE_ENV === "development") {
  const url = "postgresql://postgres:1234@localhost:5432/projectmanagepro";
  process.env.DATABASE_URL = url;
  process.env.DIRECT_URL = url;
}
