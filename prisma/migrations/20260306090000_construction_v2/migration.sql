DO $$ BEGIN
  CREATE TYPE "ProjectVersionType" AS ENUM ('PLAN', 'ACTUAL');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "HolidayScope" AS ENUM ('PROJECT', 'COMPANY');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "activityName" TEXT;
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "categoryMiddle1" TEXT;
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "categoryMiddle2" TEXT;
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "categorySmall" TEXT;
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "companyId" TEXT;

UPDATE "Task"
SET
  "categoryMiddle1" = COALESCE("categoryMiddle1", "categoryMiddle"),
  "categoryMiddle2" = COALESCE("categoryMiddle2", "categoryMinor"),
  "activityName" = COALESCE(NULLIF("activityName", ''), "name");

ALTER TABLE "ProjectVersion" ADD COLUMN IF NOT EXISTS "versionType" "ProjectVersionType" NOT NULL DEFAULT 'PLAN';

DO $$ BEGIN
  DROP INDEX IF EXISTS "ProjectVersion_projectId_versionNo_key";
EXCEPTION
  WHEN undefined_object THEN null;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "ProjectVersion_projectId_versionType_versionNo_key"
ON "ProjectVersion"("projectId", "versionType", "versionNo");

CREATE TABLE IF NOT EXISTS "Company" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Holiday" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "scope" "HolidayScope" NOT NULL,
  "companyId" TEXT,
  "name" TEXT,
  "startDate" TIMESTAMP(3) NOT NULL,
  "endDate" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Holiday_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Company_projectId_name_key" ON "Company"("projectId", "name");
CREATE INDEX IF NOT EXISTS "Company_projectId_createdAt_idx" ON "Company"("projectId", "createdAt");
CREATE INDEX IF NOT EXISTS "Holiday_projectId_scope_startDate_idx" ON "Holiday"("projectId", "scope", "startDate");
CREATE INDEX IF NOT EXISTS "Holiday_companyId_startDate_idx" ON "Holiday"("companyId", "startDate");
CREATE INDEX IF NOT EXISTS "Task_projectId_companyId_idx" ON "Task"("projectId", "companyId");

DO $$ BEGIN
  ALTER TABLE "Task"
    ADD CONSTRAINT "Task_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "Company"
    ADD CONSTRAINT "Company_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "Holiday"
    ADD CONSTRAINT "Holiday_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "Holiday"
    ADD CONSTRAINT "Holiday_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
