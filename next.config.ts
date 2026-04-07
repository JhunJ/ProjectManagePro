import type { NextConfig } from "next";
import { loadEnvConfig } from "@next/env";

// Ensure .env is loaded before server runs (fixes Turbopack dev "Database (not available)")
loadEnvConfig(process.cwd());

// Force local DB URL at process start so Prisma/engine never see empty env (log evidence: our code had URL but engine still showed "(not available)")
if (process.env.NODE_ENV === "development") {
  process.env.DATABASE_URL =
    "postgresql://postgres:1234@localhost:5432/projectmanagepro";
  process.env.DIRECT_URL = process.env.DATABASE_URL;
}

const nextConfig: NextConfig = {
  /* config options here */
};

export default nextConfig;

