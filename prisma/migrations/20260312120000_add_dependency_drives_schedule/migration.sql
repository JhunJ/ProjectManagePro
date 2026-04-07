-- AlterTable
ALTER TABLE "Dependency" ADD COLUMN IF NOT EXISTS "drivesSchedule" BOOLEAN NOT NULL DEFAULT true;
