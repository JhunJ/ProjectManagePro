import { Prisma, type PrismaClient } from "@prisma/client";

import { toDependencyType } from "@/lib/dependency-type";
import { prisma } from "@/lib/prisma";
import { resolveActivityName, resolveSiteDisplayText, toStoredSiteDisplayText } from "@/lib/site-display-text";
import { getProjectSchedule } from "@/server/services/schedule-service";
import type {
  DependencyCompareItem,
  DependencyType,
  ProjectSchedulePayload,
  ProjectVersionCompareResult,
  ProjectVersionDetail,
  ProjectVersionModel,
  ProjectVersionSnapshot,
  ProjectVersionType,
  TaskCompareItem,
  TaskDiffStatus,
  TaskModel,
  WorkingCalendarModel,
} from "@/types/domain";

type DbClient = PrismaClient | Prisma.TransactionClient;

const SNAPSHOT_SCHEMA_VERSION = 2;
const DAY_MS = 24 * 60 * 60 * 1000;

type SnapshotCalendar = Pick<
  WorkingCalendarModel,
  "workMon" | "workTue" | "workWed" | "workThu" | "workFri" | "workSat" | "workSun"
>;

type SnapshotDependency = ProjectVersionSnapshot["dependencies"][number];

function normalizeNullableText(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function secondaryTaskKey(
  task: Pick<
    TaskModel,
    | "activityName"
    | "name"
    | "wbsCode"
    | "categoryMajor"
    | "categoryMiddle1"
    | "categoryMiddle2"
    | "categorySmall"
    | "companyId"
  >,
) {
  return [
    normalizeNullableText(task.activityName || task.name),
    normalizeNullableText(task.wbsCode),
    normalizeNullableText(task.categoryMajor),
    normalizeNullableText(task.categoryMiddle1),
    normalizeNullableText(task.categoryMiddle2),
    normalizeNullableText(task.categorySmall),
    normalizeNullableText(task.companyId),
  ].join("|");
}

function serializeVersion(version: {
  id: string;
  projectId: string;
  versionType: ProjectVersionType;
  versionNo: number;
  title: string;
  description: string | null;
  createdBy: string;
  createdAt: Date;
  taskCount: number;
  dependencyCount: number;
}): ProjectVersionModel {
  return {
    ...version,
    createdAt: version.createdAt.toISOString(),
  };
}

function buildSnapshotFromSchedule(schedule: Awaited<ReturnType<typeof getProjectSchedule>>): ProjectVersionSnapshot {
  if (!schedule) {
    throw new Error("Project schedule not found.");
  }

  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    capturedAt: new Date().toISOString(),
    project: {
      id: schedule.project.id,
      name: schedule.project.name,
      description: schedule.project.description,
      startDate: schedule.project.startDate,
      endDate: schedule.project.endDate,
    },
    calendar: {
      workMon: schedule.calendar.workMon,
      workTue: schedule.calendar.workTue,
      workWed: schedule.calendar.workWed,
      workThu: schedule.calendar.workThu,
      workFri: schedule.calendar.workFri,
      workSat: schedule.calendar.workSat,
      workSun: schedule.calendar.workSun,
    },
    tasks: schedule.tasks.map((task) => ({
      id: task.id,
      name: resolveActivityName(task.activityName, task.name),
      activityName: resolveActivityName(task.activityName, task.name),
      categoryMajor: task.categoryMajor,
      categoryMiddle1: task.categoryMiddle1 ?? task.categoryMiddle,
      categoryMiddle2: task.categoryMiddle2 ?? task.categoryMinor,
      categorySmall: task.categorySmall,
      companyId: task.companyId,
      siteMainCategory: task.siteMainCategory ?? task.categoryMajor,
      siteDisplayText: resolveSiteDisplayText({
        siteDisplayText: task.siteDisplayText,
        activityName: task.activityName,
        name: task.name,
      }),
      categoryMiddle: task.categoryMiddle1 ?? task.categoryMiddle,
      categoryMinor: task.categoryMiddle2 ?? task.categoryMinor,
      wbsCode: task.wbsCode,
      parentTaskId: task.parentTaskId,
      timelineHeadTaskId: task.timelineHeadTaskId ?? null,
      startDate: task.startDate,
      endDate: task.endDate,
      durationDays: task.durationDays,
      progress: task.progress,
      assignee: task.assignee,
      color: task.color,
      isMilestone: task.isMilestone,
      notes: task.notes,
      sortOrder: task.sortOrder,
    })),
    dependencies: schedule.dependencies.map((dependency) => ({
      predecessorTaskId: dependency.predecessorTaskId,
      successorTaskId: dependency.successorTaskId,
      type: dependency.type,
      lagDays: dependency.lagDays,
    })),
  };
}

function parseSnapshotOrThrow(
  snapshotJson: string,
  fallbackCreatedAt: Date,
  fallbackProjectId: string,
): ProjectVersionSnapshot {
  let rawValue: unknown;
  try {
    rawValue = JSON.parse(snapshotJson);
  } catch {
    throw new Error("Invalid version snapshot JSON.");
  }

  if (!rawValue || typeof rawValue !== "object" || Array.isArray(rawValue)) {
    throw new Error("Invalid version snapshot JSON.");
  }

  const raw = rawValue as Record<string, unknown>;
  const tasks = Array.isArray(raw.tasks) ? raw.tasks : [];
  const dependencies = Array.isArray(raw.dependencies) ? raw.dependencies : [];
  const project = raw.project && typeof raw.project === "object" ? (raw.project as Record<string, unknown>) : {};
  const calendar = raw.calendar && typeof raw.calendar === "object" ? (raw.calendar as Record<string, unknown>) : {};

  const parsed: ProjectVersionSnapshot = {
    schemaVersion:
      typeof raw.schemaVersion === "number" && Number.isFinite(raw.schemaVersion)
        ? raw.schemaVersion
        : SNAPSHOT_SCHEMA_VERSION,
    capturedAt:
      typeof raw.capturedAt === "string" && raw.capturedAt.length > 0
        ? raw.capturedAt
        : fallbackCreatedAt.toISOString(),
    project: {
      id: typeof project.id === "string" && project.id.length > 0 ? project.id : fallbackProjectId,
      name: typeof project.name === "string" ? project.name : "",
      description: typeof project.description === "string" ? project.description : null,
      startDate: typeof project.startDate === "string" ? project.startDate : fallbackCreatedAt.toISOString(),
      endDate: typeof project.endDate === "string" ? project.endDate : null,
    },
    calendar: {
      workMon: Boolean(calendar.workMon),
      workTue: Boolean(calendar.workTue),
      workWed: Boolean(calendar.workWed),
      workThu: Boolean(calendar.workThu),
      workFri: Boolean(calendar.workFri),
      workSat: Boolean(calendar.workSat),
      workSun: Boolean(calendar.workSun),
    },
    tasks: tasks
      .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item)))
      .map((task, index) => {
        const name = resolveActivityName(
          typeof task.activityName === "string" ? task.activityName : null,
          typeof task.name === "string" ? task.name : null,
        );
        const middle1 = typeof task.categoryMiddle1 === "string"
          ? task.categoryMiddle1
          : typeof task.categoryMiddle === "string"
            ? task.categoryMiddle
            : null;
        const middle2 = typeof task.categoryMiddle2 === "string"
          ? task.categoryMiddle2
          : typeof task.categoryMinor === "string"
            ? task.categoryMinor
            : null;

        return {
          id: typeof task.id === "string" ? task.id : `snapshot-task-${index}`,
          name,
          activityName: name,
          categoryMajor: typeof task.categoryMajor === "string" ? task.categoryMajor : null,
          categoryMiddle1: middle1,
          categoryMiddle2: middle2,
          categorySmall: typeof task.categorySmall === "string" ? task.categorySmall : null,
          companyId: typeof task.companyId === "string" ? task.companyId : null,
          siteMainCategory:
            typeof task.siteMainCategory === "string"
              ? task.siteMainCategory
              : typeof task.categoryMajor === "string"
                ? task.categoryMajor
                : null,
          siteDisplayText:
            resolveSiteDisplayText({
              siteDisplayText: typeof task.siteDisplayText === "string" ? task.siteDisplayText : null,
              activityName: name,
            }),
          categoryMiddle: middle1,
          categoryMinor: middle2,
          wbsCode: typeof task.wbsCode === "string" ? task.wbsCode : null,
          parentTaskId: typeof task.parentTaskId === "string" ? task.parentTaskId : null,
          timelineHeadTaskId: typeof task.timelineHeadTaskId === "string" ? task.timelineHeadTaskId : null,
          startDate:
            typeof task.startDate === "string"
              ? task.startDate
              : fallbackCreatedAt.toISOString(),
          endDate:
            typeof task.endDate === "string"
              ? task.endDate
              : fallbackCreatedAt.toISOString(),
          durationDays: typeof task.durationDays === "number" ? Math.max(1, Math.round(task.durationDays)) : 1,
          progress: typeof task.progress === "number" ? Math.max(0, Math.min(100, Math.round(task.progress))) : 0,
          assignee: typeof task.assignee === "string" ? task.assignee : null,
          color: typeof task.color === "string" ? task.color : "#3B82F6",
          isMilestone: Boolean(task.isMilestone),
          notes: typeof task.notes === "string" ? task.notes : null,
          sortOrder: typeof task.sortOrder === "number" ? Math.max(0, Math.round(task.sortOrder)) : index,
        };
      }),
    dependencies: dependencies
      .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item)))
      .map((dependency) => ({
        predecessorTaskId: typeof dependency.predecessorTaskId === "string" ? dependency.predecessorTaskId : "",
        successorTaskId: typeof dependency.successorTaskId === "string" ? dependency.successorTaskId : "",
        type: toDependencyType(typeof dependency.type === "string" ? dependency.type : "FS"),
        lagDays: typeof dependency.lagDays === "number" ? Math.round(dependency.lagDays) : 0,
      }))
      .filter((dependency) => dependency.predecessorTaskId.length > 0 && dependency.successorTaskId.length > 0),
  };

  return parsed;
}

function snapshotTaskToTaskModel(
  projectId: string,
  capturedAt: string,
  task: ProjectVersionSnapshot["tasks"][number],
): TaskModel {
  return {
    id: task.id,
    projectId,
    parentTaskId: task.parentTaskId,
    timelineHeadTaskId: task.timelineHeadTaskId ?? null,
    name: resolveActivityName(task.activityName, task.name),
    activityName: resolveActivityName(task.activityName, task.name),
    categoryMajor: task.categoryMajor,
    categoryMiddle1: task.categoryMiddle1 ?? task.categoryMiddle,
    categoryMiddle2: task.categoryMiddle2 ?? task.categoryMinor,
    categorySmall: task.categorySmall ?? null,
    companyId: task.companyId ?? null,
    siteMainCategory: task.siteMainCategory ?? task.categoryMajor ?? null,
    siteDisplayText: resolveSiteDisplayText({
      siteDisplayText: task.siteDisplayText,
      activityName: task.activityName,
      name: task.name,
    }),
    categoryMiddle: task.categoryMiddle1 ?? task.categoryMiddle,
    categoryMinor: task.categoryMiddle2 ?? task.categoryMinor,
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
    createdAt: capturedAt,
    updatedAt: capturedAt,
  };
}

function collectTaskChangedFields(before: TaskModel, after: TaskModel) {
  const fields: Array<keyof TaskModel> = [
    "name",
    "activityName",
    "categoryMajor",
    "categoryMiddle1",
    "categoryMiddle2",
    "categorySmall",
    "companyId",
    "siteMainCategory",
    "siteDisplayText",
    "wbsCode",
    "parentTaskId",
    "timelineHeadTaskId",
    "startDate",
    "endDate",
    "durationDays",
    "progress",
    "assignee",
    "color",
    "isMilestone",
    "notes",
    "sortOrder",
  ];

  return fields.filter((field) => before[field] !== after[field]).map((field) => String(field));
}

function toUtcDayTime(value: string | null) {
  if (!value) return null;
  const source = new Date(value);
  const normalized = Date.UTC(source.getUTCFullYear(), source.getUTCMonth(), source.getUTCDate());
  return normalized;
}

function getEndDelayDays(beforeEndDate: string | null, afterEndDate: string | null) {
  const before = toUtcDayTime(beforeEndDate);
  const after = toUtcDayTime(afterEndDate);
  if (before === null || after === null) {
    return null;
  }
  return Math.round((after - before) / DAY_MS);
}

function createTaskCompareItem(
  key: string,
  before: TaskModel | null,
  after: TaskModel | null,
): TaskCompareItem {
  let status: TaskDiffStatus = "UNCHANGED";
  let changedFields: string[] = [];
  let scheduleDelta: TaskCompareItem["scheduleDelta"] = null;

  if (before && after) {
    changedFields = collectTaskChangedFields(before, after);
    status = changedFields.length > 0 ? "UPDATED" : "UNCHANGED";

    const hasScheduleChange =
      before.startDate !== after.startDate ||
      before.endDate !== after.endDate ||
      before.durationDays !== after.durationDays;

    scheduleDelta = hasScheduleChange
      ? {
          startDateBefore: before.startDate,
          startDateAfter: after.startDate,
          endDateBefore: before.endDate,
          endDateAfter: after.endDate,
          durationBefore: before.durationDays,
          durationAfter: after.durationDays,
          endDelayDays: getEndDelayDays(before.endDate, after.endDate),
        }
      : null;
  } else if (!before && after) {
    status = "ADDED";
  } else if (before && !after) {
    status = "REMOVED";
  }

  return {
    key,
    status,
    before,
    after,
    changedFields,
    scheduleDelta,
  };
}

function dependencyKey(dependency: {
  predecessorTaskId: string;
  successorTaskId: string;
  type: DependencyType;
}) {
  return `${dependency.predecessorTaskId}|${dependency.successorTaskId}|${dependency.type}`;
}

function createDependencyCompareItem(
  key: string,
  before: DependencyCompareItem["before"],
  after: DependencyCompareItem["after"],
): DependencyCompareItem {
  return { key, before, after };
}

function toVersionMeta(detail: ProjectVersionDetail): ProjectVersionModel {
  return {
    id: detail.id,
    projectId: detail.projectId,
    versionType: detail.versionType,
    versionNo: detail.versionNo,
    title: detail.title,
    description: detail.description,
    createdBy: detail.createdBy,
    createdAt: detail.createdAt,
    taskCount: detail.taskCount,
    dependencyCount: detail.dependencyCount,
  };
}

export async function listProjectVersions(projectId: string, db: DbClient = prisma) {
  const versions = await db.projectVersion.findMany({
    where: { projectId },
    orderBy: [{ createdAt: "desc" }],
  });

  return versions.map((version) =>
    serializeVersion({
      ...version,
      versionType: version.versionType as ProjectVersionType,
    }),
  );
}

export async function createProjectVersion(params: {
  projectId: string;
  title: string;
  description?: string | null;
  createdBy: string;
  versionType: ProjectVersionType;
  db?: DbClient;
}) {
  const { projectId, title, description, createdBy, versionType } = params;
  const db = params.db ?? prisma;
  const schedule = await getProjectSchedule(projectId, db);
  if (!schedule) {
    throw new Error("Project not found.");
  }

  const maxVersion = await db.projectVersion.aggregate({
    where: { projectId, versionType },
    _max: { versionNo: true },
  });

  const snapshot = buildSnapshotFromSchedule(schedule);
  const nextVersionNo = (maxVersion._max.versionNo ?? 0) + 1;

  const version = await db.projectVersion.create({
    data: {
      projectId,
      versionType,
      versionNo: nextVersionNo,
      title: title.trim(),
      description: description?.trim() ? description.trim() : null,
      createdBy: createdBy.trim(),
      snapshotJson: JSON.stringify(snapshot),
      taskCount: snapshot.tasks.length,
      dependencyCount: snapshot.dependencies.length,
    },
  });

  return serializeVersion({
    ...version,
    versionType: version.versionType as ProjectVersionType,
  });
}

export async function getProjectVersionDetail(
  projectId: string,
  versionId: string,
  db: DbClient = prisma,
): Promise<ProjectVersionDetail | null> {
  const version = await db.projectVersion.findFirst({
    where: {
      id: versionId,
      projectId,
    },
  });

  if (!version) {
    return null;
  }

  const snapshot = parseSnapshotOrThrow(version.snapshotJson, version.createdAt, projectId);
  return {
    ...serializeVersion({
      ...version,
      versionType: version.versionType as ProjectVersionType,
    }),
    snapshot,
  };
}

export async function activateProjectVersion(
  projectId: string,
  versionId: string,
  db: PrismaClient = prisma,
): Promise<ProjectSchedulePayload | null> {
  const version = await getProjectVersionDetail(projectId, versionId, db);
  if (!version) {
    return null;
  }

  const snapshot = version.snapshot;
  const fallbackDate = new Date(version.createdAt);
  const parseDate = (value: string | null | undefined, fallback: Date) => {
    const parsed = new Date(value ?? "");
    if (Number.isNaN(parsed.getTime())) {
      return fallback;
    }
    return parsed;
  };

  const taskIdSet = new Set(snapshot.tasks.map((task) => task.id));

  await db.$transaction(async (tx) => {
    const companies = await tx.company.findMany({
      where: { projectId },
      select: { id: true },
    });
    const companyIdSet = new Set(companies.map((company) => company.id));

    await tx.dependency.deleteMany({ where: { projectId } });
    await tx.task.deleteMany({ where: { projectId } });

    await tx.project.update({
      where: { id: projectId },
      data: {
        name: (snapshot.project.name || "").trim() || undefined,
        description: snapshot.project.description ?? null,
        startDate: parseDate(snapshot.project.startDate, fallbackDate),
        endDate: snapshot.project.endDate ? parseDate(snapshot.project.endDate, fallbackDate) : null,
      },
    });

    await tx.workingCalendar.upsert({
      where: { projectId },
      create: {
        projectId,
        ...snapshot.calendar,
      },
      update: {
        ...snapshot.calendar,
      },
    });

    const sortedTasks = [...snapshot.tasks].sort((a, b) => a.sortOrder - b.sortOrder);
    for (const [index, task] of sortedTasks.entries()) {
      const activityName = (task.activityName || task.name || "").trim() || "Activity";
      await tx.task.create({
        data: {
          id: task.id,
          projectId,
          parentTaskId: null,
          timelineHeadTaskId: null,
          name: activityName,
          activityName,
          categoryMajor: task.categoryMajor ?? null,
          categoryMiddle1: task.categoryMiddle1 ?? task.categoryMiddle ?? null,
          categoryMiddle2: task.categoryMiddle2 ?? task.categoryMinor ?? null,
          categorySmall: task.categorySmall ?? null,
          companyId: task.companyId && companyIdSet.has(task.companyId) ? task.companyId : null,
          siteMainCategory: task.siteMainCategory ?? task.categoryMajor ?? null,
          siteDisplayText: toStoredSiteDisplayText({
            siteDisplayText: task.siteDisplayText,
            activityName,
          }),
          categoryMiddle: task.categoryMiddle1 ?? task.categoryMiddle ?? null,
          categoryMinor: task.categoryMiddle2 ?? task.categoryMinor ?? null,
          wbsCode: task.wbsCode ?? null,
          startDate: parseDate(task.startDate, fallbackDate),
          endDate: parseDate(task.endDate, fallbackDate),
          durationDays: Math.max(1, Math.round(task.durationDays || 1)),
          progress: Math.max(0, Math.min(100, Math.round(task.progress || 0))),
          assignee: task.assignee ?? null,
          color: task.color || "#3B82F6",
          isMilestone: Boolean(task.isMilestone),
          notes: task.notes ?? null,
          sortOrder: Number.isFinite(task.sortOrder) ? Math.round(task.sortOrder) : index,
        },
      });
    }

    for (const task of sortedTasks) {
      if (!task.parentTaskId || !taskIdSet.has(task.parentTaskId)) {
        continue;
      }
      await tx.task.update({
        where: { id: task.id },
        data: { parentTaskId: task.parentTaskId },
      });
    }

    for (const task of sortedTasks) {
      if (!task.timelineHeadTaskId || !taskIdSet.has(task.timelineHeadTaskId)) {
        continue;
      }
      await tx.task.update({
        where: { id: task.id },
        data: { timelineHeadTaskId: task.timelineHeadTaskId },
      });
    }

    const dependencyKeys = new Set<string>();
    for (const dependency of snapshot.dependencies) {
      if (!taskIdSet.has(dependency.predecessorTaskId) || !taskIdSet.has(dependency.successorTaskId)) {
        continue;
      }

      const type = toDependencyType(dependency.type);
      const key = `${dependency.predecessorTaskId}|${dependency.successorTaskId}|${type}`;
      if (dependencyKeys.has(key)) {
        continue;
      }
      dependencyKeys.add(key);

      await tx.dependency.create({
        data: {
          projectId,
          predecessorTaskId: dependency.predecessorTaskId,
          successorTaskId: dependency.successorTaskId,
          type,
          lagDays: Number.isFinite(dependency.lagDays) ? Math.round(dependency.lagDays) : 0,
        },
      });
    }
  });

  return getProjectSchedule(projectId, db);
}

export async function getScheduleFromVersion(
  projectId: string,
  versionId: string,
  db: DbClient = prisma,
): Promise<ProjectSchedulePayload | null> {
  const version = await getProjectVersionDetail(projectId, versionId, db);
  if (!version) {
    return null;
  }

  const snapshot = version.snapshot;
  const capturedAt = snapshot.capturedAt;

  const projectFromDb = await db.project.findUnique({
    where: { id: projectId },
    select: { id: true, createdAt: true, updatedAt: true },
  });
  if (!projectFromDb) {
    return null;
  }

  const [companies, holidays, calendarRow] = await Promise.all([
    db.company.findMany({
      where: { projectId },
      orderBy: { name: "asc" },
    }),
    db.holiday.findMany({
      where: { projectId },
      orderBy: [{ startDate: "asc" }, { createdAt: "asc" }],
    }),
    db.workingCalendar.findUnique({
      where: { projectId },
    }),
  ]);

  const tasks: TaskModel[] = snapshot.tasks.map((task) =>
    snapshotTaskToTaskModel(projectId, capturedAt, task),
  );

  const dependencies: Array<{
    id: string;
    projectId: string;
    predecessorTaskId: string;
    successorTaskId: string;
    type: DependencyType;
    lagDays: number;
    createdAt: string;
  }> = snapshot.dependencies.map((dep, index) => ({
    id: `version-${versionId}-dep-${index}`,
    projectId,
    predecessorTaskId: dep.predecessorTaskId,
    successorTaskId: dep.successorTaskId,
    type: toDependencyType(dep.type),
    lagDays: Number.isFinite(dep.lagDays) ? Math.round(dep.lagDays) : 0,
    createdAt: capturedAt,
  }));

  const calendar: WorkingCalendarModel = calendarRow
    ? {
        ...calendarRow,
        createdAt: calendarRow.createdAt.toISOString(),
        updatedAt: calendarRow.updatedAt.toISOString(),
      }
    : {
        id: `version-${versionId}-cal`,
        projectId,
        workMon: snapshot.calendar.workMon ?? true,
        workTue: snapshot.calendar.workTue ?? true,
        workWed: snapshot.calendar.workWed ?? true,
        workThu: snapshot.calendar.workThu ?? true,
        workFri: snapshot.calendar.workFri ?? true,
        workSat: snapshot.calendar.workSat ?? false,
        workSun: snapshot.calendar.workSun ?? false,
        createdAt: capturedAt,
        updatedAt: capturedAt,
      };

  return {
    project: {
      id: projectFromDb.id,
      name: (snapshot.project.name || "").trim() || "Project",
      description: snapshot.project.description ?? null,
      startDate: snapshot.project.startDate,
      endDate: snapshot.project.endDate ?? null,
      createdAt: projectFromDb.createdAt.toISOString(),
      updatedAt: projectFromDb.updatedAt.toISOString(),
    },
    tasks,
    dependencies,
    calendar,
    companies: companies.map((c) => ({
      ...c,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
    })),
    holidays: holidays.map((h) => ({
      ...h,
      scope: h.scope as "PROJECT" | "COMPANY",
      startDate: h.startDate.toISOString(),
      endDate: h.endDate.toISOString(),
      createdAt: h.createdAt.toISOString(),
      updatedAt: h.updatedAt.toISOString(),
    })),
  };
}

export async function syncProjectVersionSnapshot(
  projectId: string,
  versionId: string,
  db: DbClient = prisma,
): Promise<ProjectVersionModel | null> {
  const existing = await db.projectVersion.findFirst({
    where: {
      id: versionId,
      projectId,
    },
  });

  if (!existing) {
    return null;
  }

  const schedule = await getProjectSchedule(projectId, db);
  if (!schedule) {
    throw new Error("Project not found.");
  }

  const snapshot = buildSnapshotFromSchedule(schedule);
  const updated = await db.projectVersion.update({
    where: { id: versionId },
    data: {
      snapshotJson: JSON.stringify(snapshot),
      taskCount: snapshot.tasks.length,
      dependencyCount: snapshot.dependencies.length,
    },
  });

  return serializeVersion({
    ...updated,
    versionType: updated.versionType as ProjectVersionType,
  });
}

export async function updateProjectVersionMeta(params: {
  projectId: string;
  versionId: string;
  title?: string;
  description?: string | null;
  createdBy?: string;
  db?: DbClient;
}): Promise<ProjectVersionModel | null> {
  const { projectId, versionId, title, description, createdBy } = params;
  const db = params.db ?? prisma;

  const existing = await db.projectVersion.findFirst({
    where: {
      id: versionId,
      projectId,
    },
  });

  if (!existing) {
    return null;
  }

  const updated = await db.projectVersion.update({
    where: { id: versionId },
    data: {
      title: title === undefined ? undefined : title.trim(),
      description: description === undefined ? undefined : description?.trim() ? description.trim() : null,
      createdBy: createdBy === undefined ? undefined : createdBy.trim(),
    },
  });

  return serializeVersion({
    ...updated,
    versionType: updated.versionType as ProjectVersionType,
  });
}

export async function compareProjectVersions(
  projectId: string,
  planVersionId: string,
  actualVersionId: string,
  db: DbClient = prisma,
): Promise<ProjectVersionCompareResult> {
  const [planVersion, actualVersion] = await Promise.all([
    getProjectVersionDetail(projectId, planVersionId, db),
    getProjectVersionDetail(projectId, actualVersionId, db),
  ]);

  if (!planVersion) {
    throw new Error("Plan version not found.");
  }
  if (!actualVersion) {
    throw new Error("Actual version not found.");
  }
  if (planVersion.versionType !== "PLAN") {
    throw new Error("planVersionId must reference PLAN version.");
  }
  if (actualVersion.versionType !== "ACTUAL") {
    throw new Error("actualVersionId must reference ACTUAL version.");
  }

  const beforeTasks = planVersion.snapshot.tasks.map((task) =>
    snapshotTaskToTaskModel(projectId, planVersion.snapshot.capturedAt, task),
  );
  const afterTasks = actualVersion.snapshot.tasks.map((task) =>
    snapshotTaskToTaskModel(projectId, actualVersion.snapshot.capturedAt, task),
  );

  const beforeById = new Map(beforeTasks.map((task) => [task.id, task]));
  const matchedBeforeIds = new Set<string>();
  const matchedAfterIds = new Set<string>();
  const compareItems: TaskCompareItem[] = [];

  for (const afterTask of afterTasks) {
    const beforeTask = beforeById.get(afterTask.id);
    if (!beforeTask) continue;
    matchedBeforeIds.add(beforeTask.id);
    matchedAfterIds.add(afterTask.id);
    compareItems.push(createTaskCompareItem(afterTask.id, beforeTask, afterTask));
  }

  const unmatchedBefore = beforeTasks.filter((task) => !matchedBeforeIds.has(task.id));
  const unmatchedAfter = afterTasks.filter((task) => !matchedAfterIds.has(task.id));

  const beforeBySecondary = new Map<string, TaskModel[]>();
  for (const task of unmatchedBefore) {
    const key = secondaryTaskKey(task);
    const list = beforeBySecondary.get(key) ?? [];
    list.push(task);
    beforeBySecondary.set(key, list);
  }

  const afterBySecondary = new Map<string, TaskModel[]>();
  for (const task of unmatchedAfter) {
    const key = secondaryTaskKey(task);
    const list = afterBySecondary.get(key) ?? [];
    list.push(task);
    afterBySecondary.set(key, list);
  }

  const secondPassMatchedBefore = new Set<string>();
  const secondPassMatchedAfter = new Set<string>();

  for (const [key, beforeList] of beforeBySecondary.entries()) {
    const afterList = afterBySecondary.get(key) ?? [];
    if (beforeList.length === 1 && afterList.length === 1) {
      const beforeTask = beforeList[0];
      const afterTask = afterList[0];
      secondPassMatchedBefore.add(beforeTask.id);
      secondPassMatchedAfter.add(afterTask.id);
      compareItems.push(createTaskCompareItem(afterTask.id, beforeTask, afterTask));
    }
  }

  for (const task of unmatchedAfter) {
    if (secondPassMatchedAfter.has(task.id)) continue;
    compareItems.push(createTaskCompareItem(task.id, null, task));
  }

  for (const task of unmatchedBefore) {
    if (secondPassMatchedBefore.has(task.id)) continue;
    compareItems.push(createTaskCompareItem(`removed:${task.id}`, task, null));
  }

  compareItems.sort((a, b) => {
    const leftSort = a.after?.sortOrder ?? a.before?.sortOrder ?? Number.MAX_SAFE_INTEGER;
    const rightSort = b.after?.sortOrder ?? b.before?.sortOrder ?? Number.MAX_SAFE_INTEGER;
    return leftSort - rightSort;
  });

  const beforeDependencies: SnapshotDependency[] = planVersion.snapshot.dependencies.map((dependency) => ({
    predecessorTaskId: dependency.predecessorTaskId,
    successorTaskId: dependency.successorTaskId,
    type: toDependencyType(dependency.type),
    lagDays: dependency.lagDays,
  }));
  const afterDependencies: SnapshotDependency[] = actualVersion.snapshot.dependencies.map((dependency) => ({
    predecessorTaskId: dependency.predecessorTaskId,
    successorTaskId: dependency.successorTaskId,
    type: toDependencyType(dependency.type),
    lagDays: dependency.lagDays,
  }));

  const beforeDepByKey = new Map(beforeDependencies.map((dependency) => [dependencyKey(dependency), dependency]));
  const afterDepByKey = new Map(afterDependencies.map((dependency) => [dependencyKey(dependency), dependency]));

  const dependencyAdded: DependencyCompareItem[] = [];
  const dependencyRemoved: DependencyCompareItem[] = [];
  const dependencyChanged: DependencyCompareItem[] = [];

  for (const [key, afterDependency] of afterDepByKey.entries()) {
    const beforeDependency = beforeDepByKey.get(key);
    if (!beforeDependency) {
      dependencyAdded.push(createDependencyCompareItem(key, null, afterDependency));
      continue;
    }

    if (beforeDependency.lagDays !== afterDependency.lagDays) {
      dependencyChanged.push(createDependencyCompareItem(key, beforeDependency, afterDependency));
    }
  }

  for (const [key, beforeDependency] of beforeDepByKey.entries()) {
    if (afterDepByKey.has(key)) continue;
    dependencyRemoved.push(createDependencyCompareItem(key, beforeDependency, null));
  }

  const beforeCalendar: SnapshotCalendar = {
    workMon: planVersion.snapshot.calendar.workMon,
    workTue: planVersion.snapshot.calendar.workTue,
    workWed: planVersion.snapshot.calendar.workWed,
    workThu: planVersion.snapshot.calendar.workThu,
    workFri: planVersion.snapshot.calendar.workFri,
    workSat: planVersion.snapshot.calendar.workSat,
    workSun: planVersion.snapshot.calendar.workSun,
  };
  const afterCalendar: SnapshotCalendar = {
    workMon: actualVersion.snapshot.calendar.workMon,
    workTue: actualVersion.snapshot.calendar.workTue,
    workWed: actualVersion.snapshot.calendar.workWed,
    workThu: actualVersion.snapshot.calendar.workThu,
    workFri: actualVersion.snapshot.calendar.workFri,
    workSat: actualVersion.snapshot.calendar.workSat,
    workSun: actualVersion.snapshot.calendar.workSun,
  };

  const calendarFields: Array<keyof SnapshotCalendar> = [
    "workMon",
    "workTue",
    "workWed",
    "workThu",
    "workFri",
    "workSat",
    "workSun",
  ];
  const calendarChangedFields = calendarFields.filter((field) => beforeCalendar[field] !== afterCalendar[field]);
  const planMeta = toVersionMeta(planVersion);
  const actualMeta = toVersionMeta(actualVersion);

  return {
    comparison: {
      planVersion: planMeta,
      actualVersion: actualMeta,
    },
    summary: {
      added: compareItems.filter((item) => item.status === "ADDED").length,
      removed: compareItems.filter((item) => item.status === "REMOVED").length,
      updated: compareItems.filter((item) => item.status === "UPDATED").length,
      unchanged: compareItems.filter((item) => item.status === "UNCHANGED").length,
      dependencyAdded: dependencyAdded.length,
      dependencyRemoved: dependencyRemoved.length,
      dependencyChanged: dependencyChanged.length,
      calendarChanged: calendarChangedFields.length > 0,
    },
    tasks: compareItems,
    dependenciesDiff: {
      added: dependencyAdded,
      removed: dependencyRemoved,
      changed: dependencyChanged,
    },
    calendarDiff: {
      changedFields: calendarChangedFields,
      before: beforeCalendar,
      after: afterCalendar,
    },
  };
}
