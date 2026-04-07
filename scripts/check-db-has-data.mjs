#!/usr/bin/env node

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  try {
    const projectCount = await prisma.project.count();

    if (projectCount > 0) {
      console.log(`[INFO] Existing projects found: ${projectCount}`);
      return 0;
    }

    console.log("[INFO] No project data found. Seed is required.");
    return 3;
  } catch (error) {
    console.error("[ERROR] Failed to inspect database state.");
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error("[ERROR]", error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });

