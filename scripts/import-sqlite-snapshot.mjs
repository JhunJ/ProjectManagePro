#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const cwd = process.cwd();

function parseArgs(argv) {
  let inputDir = "";
  let targetUrl = "";
  let force = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--input-dir" && argv[i + 1]) {
      inputDir = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--target-url" && argv[i + 1]) {
      targetUrl = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--force") {
      force = true;
    }
  }

  return {
    inputDir,
    targetUrl,
    force,
  };
}

function ensurePostgresUrl(url) {
  if (!url) {
    throw new Error("DATABASE_URL is missing.");
  }
  try {
    const protocol = new URL(url).protocol.replace(":", "").toLowerCase();
    if (protocol !== "postgres" && protocol !== "postgresql") {
      throw new Error();
    }
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL URL.");
  }
}

function readJsonArray(baseDir, filename, required = false) {
  const filePath = path.join(baseDir, filename);
  if (!fs.existsSync(filePath)) {
    if (required) {
      throw new Error(`Missing required file: ${filePath}`);
    }
    return [];
  }

  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error(`Expected JSON array in ${filePath}`);
  }
  return parsed;
}

function toNullableString(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function toRequiredString(value, fallback) {
  const text = toNullableString(value);
  return text ?? fallback;
}

function toBoolean(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "1" || normalized === "true" || normalized === "yes") return true;
    if (normalized === "0" || normalized === "false" || normalized === "no") return false;
  }
  return fallback;
}

function toInt(value, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function toDate(value, fallback = new Date()) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? fallback : value;
  }

  const parsed = new Date(value ?? fallback);
  if (Number.isNaN(parsed.getTime())) {
    return fallback;
  }
  return parsed;
}

function normalizeDependencyType(value) {
  const text = toRequiredString(value, "FS").toUpperCase();
  if (text === "FS" || text === "SS" || text === "FF" || text === "SF") {
    return text;
  }
  return "FS";
}

function normalizeVersionType(value) {
  const text = toRequiredString(value, "PLAN").toUpperCase();
  return text === "ACTUAL" ? "ACTUAL" : "PLAN";
}

function normalizeHolidayScope(value) {
  const text = toRequiredString(value, "PROJECT").toUpperCase();
  return text === "COMPANY" ? "COMPANY" : "PROJECT";
}

function normalizeColor(value) {
  const text = toRequiredString(value, "#3B82F6");
  return /^#[0-9A-Fa-f]{6}$/.test(text) ? text : "#3B82F6";
}

function normalizeProjects(rows) {
  return rows
    .map((row, index) => {
      const id = toNullableString(row.id);
      const now = new Date();
      if (!id) return null;
      return {
        id,
        name: toRequiredString(row.name, `Migrated Project ${index + 1}`),
        description: toNullableString(row.description),
        startDate: toDate(row.startDate, now),
        endDate: row.endDate === null || row.endDate === undefined ? null : toDate(row.endDate, now),
        createdAt: toDate(row.createdAt, now),
        updatedAt: toDate(row.updatedAt, now),
      };
    })
    .filter(Boolean);
}

function normalizeWorkingCalendars(rows, projectIdSet) {
  return rows
    .map((row) => {
      const id = toNullableString(row.id);
      const projectId = toNullableString(row.projectId);
      if (!id || !projectId || !projectIdSet.has(projectId)) return null;
      const now = new Date();
      return {
        id,
        projectId,
        workMon: toBoolean(row.workMon, true),
        workTue: toBoolean(row.workTue, true),
        workWed: toBoolean(row.workWed, true),
        workThu: toBoolean(row.workThu, true),
        workFri: toBoolean(row.workFri, true),
        workSat: toBoolean(row.workSat, false),
        workSun: toBoolean(row.workSun, false),
        createdAt: toDate(row.createdAt, now),
        updatedAt: toDate(row.updatedAt, now),
      };
    })
    .filter(Boolean);
}

function normalizeCompanies(rows, projectIdSet) {
  return rows
    .map((row) => {
      const id = toNullableString(row.id);
      const projectId = toNullableString(row.projectId);
      if (!id || !projectId || !projectIdSet.has(projectId)) return null;
      const now = new Date();
      return {
        id,
        projectId,
        name: toRequiredString(row.name, id),
        createdAt: toDate(row.createdAt, now),
        updatedAt: toDate(row.updatedAt, now),
      };
    })
    .filter(Boolean);
}

function normalizeTasks(rows, projectIdSet, companyIdSet) {
  return rows
    .map((row, index) => {
      const id = toNullableString(row.id);
      const projectId = toNullableString(row.projectId);
      if (!id || !projectId || !projectIdSet.has(projectId)) return null;

      const now = new Date();
      const startDate = toDate(row.startDate, now);
      const endDate = toDate(row.endDate, startDate);
      const activityName = toRequiredString(row.activityName ?? row.name, `Activity ${index + 1}`);
      const middle1 = toNullableString(row.categoryMiddle1 ?? row.categoryMiddle);
      const middle2 = toNullableString(row.categoryMiddle2 ?? row.categoryMinor);
      const companyId = toNullableString(row.companyId);

      return {
        id,
        projectId,
        parentTaskId: toNullableString(row.parentTaskId),
        name: activityName,
        activityName,
        categoryMajor: toNullableString(row.categoryMajor),
        categoryMiddle1: middle1,
        categoryMiddle2: middle2,
        categorySmall: toNullableString(row.categorySmall),
        companyId: companyId && companyIdSet.has(companyId) ? companyId : null,
        categoryMiddle: middle1,
        categoryMinor: middle2,
        wbsCode: toNullableString(row.wbsCode),
        startDate,
        endDate: endDate.getTime() < startDate.getTime() ? startDate : endDate,
        durationDays: Math.max(1, toInt(row.durationDays, 1)),
        progress: Math.max(0, Math.min(100, toInt(row.progress, 0))),
        assignee: toNullableString(row.assignee),
        color: normalizeColor(row.color),
        isMilestone: toBoolean(row.isMilestone, false),
        notes: toNullableString(row.notes),
        sortOrder: Math.max(0, toInt(row.sortOrder, index)),
        createdAt: toDate(row.createdAt, now),
        updatedAt: toDate(row.updatedAt, now),
      };
    })
    .filter(Boolean);
}

function normalizeDependencies(rows, projectIdSet, taskIdSet) {
  return rows
    .map((row, index) => {
      const id = toNullableString(row.id) ?? `migrated-dependency-${index + 1}`;
      const projectId = toNullableString(row.projectId);
      const predecessorTaskId = toNullableString(row.predecessorTaskId);
      const successorTaskId = toNullableString(row.successorTaskId);
      if (!projectId || !predecessorTaskId || !successorTaskId) return null;
      if (!projectIdSet.has(projectId)) return null;
      if (!taskIdSet.has(predecessorTaskId) || !taskIdSet.has(successorTaskId)) return null;
      const now = new Date();

      return {
        id,
        projectId,
        predecessorTaskId,
        successorTaskId,
        type: normalizeDependencyType(row.type),
        lagDays: toInt(row.lagDays, 0),
        createdAt: toDate(row.createdAt, now),
      };
    })
    .filter(Boolean);
}

function normalizeVersions(rows, projectIdSet) {
  const usedByKey = new Map();
  const nextByKey = new Map();

  const claimVersionNo = (projectId, versionType, sourceValue) => {
    const key = `${projectId}|${versionType}`;
    const used = usedByKey.get(key) ?? new Set();
    const currentNext = nextByKey.get(key) ?? 0;
    let candidate = toInt(sourceValue, 0);
    if (candidate <= 0) candidate = currentNext + 1;
    while (used.has(candidate)) {
      candidate += 1;
    }
    used.add(candidate);
    usedByKey.set(key, used);
    nextByKey.set(key, Math.max(currentNext, candidate));
    return candidate;
  };

  return rows
    .map((row, index) => {
      const id = toNullableString(row.id) ?? `migrated-version-${index + 1}`;
      const projectId = toNullableString(row.projectId);
      if (!projectId || !projectIdSet.has(projectId)) return null;

      const versionType = normalizeVersionType(row.versionType);
      const versionNo = claimVersionNo(projectId, versionType, row.versionNo);
      const now = new Date();

      return {
        id,
        projectId,
        versionType,
        versionNo,
        title: toRequiredString(row.title, `${versionType} v${versionNo}`),
        description: toNullableString(row.description),
        createdBy: toRequiredString(row.createdBy, "migration"),
        createdAt: toDate(row.createdAt, now),
        snapshotJson: typeof row.snapshotJson === "string" && row.snapshotJson.trim() ? row.snapshotJson : "{}",
        taskCount: Math.max(0, toInt(row.taskCount, 0)),
        dependencyCount: Math.max(0, toInt(row.dependencyCount, 0)),
      };
    })
    .filter(Boolean);
}

function normalizeHolidays(rows, projectIdSet, companyIdSet) {
  return rows
    .map((row, index) => {
      const id = toNullableString(row.id) ?? `migrated-holiday-${index + 1}`;
      const projectId = toNullableString(row.projectId);
      if (!projectId || !projectIdSet.has(projectId)) return null;

      const now = new Date();
      const scope = normalizeHolidayScope(row.scope);
      const companyId = toNullableString(row.companyId);
      const hasCompany = companyId && companyIdSet.has(companyId);
      const resolvedScope = scope === "COMPANY" && hasCompany ? "COMPANY" : "PROJECT";

      const startDate = toDate(row.startDate, now);
      const endDate = toDate(row.endDate, startDate);

      return {
        id,
        projectId,
        scope: resolvedScope,
        companyId: resolvedScope === "COMPANY" ? companyId : null,
        name: toNullableString(row.name),
        startDate,
        endDate: endDate.getTime() < startDate.getTime() ? startDate : endDate,
        createdAt: toDate(row.createdAt, now),
        updatedAt: toDate(row.updatedAt, now),
      };
    })
    .filter(Boolean);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.inputDir) {
    throw new Error("Usage: node scripts/import-sqlite-snapshot.mjs --input-dir <path> [--target-url <postgres-url>] [--force]");
  }

  if (args.targetUrl) {
    process.env.DATABASE_URL = args.targetUrl;
    process.env.DIRECT_URL = args.targetUrl;
  }
  ensurePostgresUrl(process.env.DATABASE_URL ?? "");

  const inputDir = path.resolve(cwd, args.inputDir);
  if (!fs.existsSync(inputDir)) {
    throw new Error(`Input directory not found: ${inputDir}`);
  }

  const projectsRaw = readJsonArray(inputDir, "projects.json", true);
  const calendarsRaw = readJsonArray(inputDir, "working-calendars.json", false);
  const companiesRaw = readJsonArray(inputDir, "companies.json", false);
  const tasksRaw = readJsonArray(inputDir, "tasks.json", true);
  const dependenciesRaw = readJsonArray(inputDir, "dependencies.json", true);
  const versionsRaw = readJsonArray(inputDir, "versions.json", false);
  const holidaysRaw = readJsonArray(inputDir, "holidays.json", false);

  const projects = normalizeProjects(projectsRaw);
  const projectIdSet = new Set(projects.map((item) => item.id));
  const calendars = normalizeWorkingCalendars(calendarsRaw, projectIdSet);
  const companies = normalizeCompanies(companiesRaw, projectIdSet);
  const companyIdSet = new Set(companies.map((item) => item.id));
  const tasks = normalizeTasks(tasksRaw, projectIdSet, companyIdSet);
  const taskIdSet = new Set(tasks.map((item) => item.id));
  const dependencies = normalizeDependencies(dependenciesRaw, projectIdSet, taskIdSet);
  const versions = normalizeVersions(versionsRaw, projectIdSet);
  const holidays = normalizeHolidays(holidaysRaw, projectIdSet, companyIdSet);

  const prisma = new PrismaClient();

  try {
    if (!args.force) {
      const existingProjects = await prisma.project.count();
      if (existingProjects > 0) {
        throw new Error(
          `Target database already has ${existingProjects} project(s). Use --force if you intentionally want to merge.`,
        );
      }
    }

    await prisma.$transaction(async (tx) => {
      for (const project of projects) {
        await tx.project.upsert({
          where: { id: project.id },
          update: {
            name: project.name,
            description: project.description,
            startDate: project.startDate,
            endDate: project.endDate,
            createdAt: project.createdAt,
            updatedAt: project.updatedAt,
          },
          create: project,
        });
      }

      for (const calendar of calendars) {
        await tx.workingCalendar.upsert({
          where: { projectId: calendar.projectId },
          update: {
            workMon: calendar.workMon,
            workTue: calendar.workTue,
            workWed: calendar.workWed,
            workThu: calendar.workThu,
            workFri: calendar.workFri,
            workSat: calendar.workSat,
            workSun: calendar.workSun,
            createdAt: calendar.createdAt,
            updatedAt: calendar.updatedAt,
          },
          create: calendar,
        });
      }

      for (const company of companies) {
        await tx.company.upsert({
          where: { id: company.id },
          update: {
            name: company.name,
            projectId: company.projectId,
            createdAt: company.createdAt,
            updatedAt: company.updatedAt,
          },
          create: company,
        });
      }

      for (const task of tasks) {
        await tx.task.upsert({
          where: { id: task.id },
          update: {
            projectId: task.projectId,
            parentTaskId: null,
            name: task.name,
            activityName: task.activityName,
            categoryMajor: task.categoryMajor,
            categoryMiddle1: task.categoryMiddle1,
            categoryMiddle2: task.categoryMiddle2,
            categorySmall: task.categorySmall,
            companyId: task.companyId,
            categoryMiddle: task.categoryMiddle,
            categoryMinor: task.categoryMinor,
            wbsCode: task.wbsCode,
            startDate: task.startDate,
            endDate: task.endDate,
            durationDays: task.durationDays,
            progress: task.progress,
            assignee: task.assignee,
            color: task.color,
            isMilestone: task.isMilestone,
            notes: task.notes,
            sortOrder: task.sortOrder,
            createdAt: task.createdAt,
            updatedAt: task.updatedAt,
          },
          create: {
            ...task,
            parentTaskId: null,
          },
        });
      }

      for (const task of tasks) {
        if (!task.parentTaskId || !taskIdSet.has(task.parentTaskId)) continue;
        await tx.task.update({
          where: { id: task.id },
          data: {
            parentTaskId: task.parentTaskId,
          },
        });
      }

      for (const dependency of dependencies) {
        await tx.dependency.upsert({
          where: { id: dependency.id },
          update: dependency,
          create: dependency,
        });
      }

      for (const version of versions) {
        await tx.projectVersion.upsert({
          where: { id: version.id },
          update: version,
          create: version,
        });
      }

      for (const holiday of holidays) {
        await tx.holiday.upsert({
          where: { id: holiday.id },
          update: holiday,
          create: holiday,
        });
      }
    });

    console.log("[OK] SQLite snapshot import completed.");
    console.log(` - projects     : ${projects.length}`);
    console.log(` - calendars    : ${calendars.length}`);
    console.log(` - companies    : ${companies.length}`);
    console.log(` - tasks        : ${tasks.length}`);
    console.log(` - dependencies : ${dependencies.length}`);
    console.log(` - versions     : ${versions.length}`);
    console.log(` - holidays     : ${holidays.length}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("[ERROR]", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
