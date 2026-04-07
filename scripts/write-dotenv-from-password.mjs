#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const pass = process.env.PGPASSWORD || "1234";
const encoded = encodeURIComponent(pass);
const url = `postgresql://postgres:${encoded}@localhost:5432/projectmanagepro`;
const envPath = path.join(process.cwd(), ".env");
const body = `DATABASE_URL="${url}"\nDIRECT_URL="${url}"\n`;
fs.writeFileSync(envPath, body, "utf8");
console.log("[OK] .env updated with DATABASE_URL and DIRECT_URL");
