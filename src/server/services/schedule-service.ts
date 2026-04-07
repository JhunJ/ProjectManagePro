import { Prisma, type PrismaClient } from "@prisma/client";

import { toDependencyType } from "@/lib/dependency-type";
import { prisma } from "@/lib/prisma";
import { resolveActivityName, resolveSiteDisplayText } from "@/lib/site-display-text";
import {
  DEFAULT_WORKING_CALENDAR,
  businessDaysBetween,
  normalizeTaskDates,
  type WorkingCalendarConfig,
} from "@/server/schedulers/business-days";
import {
  ScheduleCycleError,
  assertNoDependencyCycle,
  cascadeSuccessorsByDelta,
  recalculateSuccessorTasks,
  type ScheduleDependency,
  type ScheduleTask,
} from "@/server/schedulers/dependency-recalc";
import type { HolidayModel, ProjectSchedulePayload } from "@/types/domain";

type DbClient = PrismaClient | Prisma.TransactionClient;

function dayKey(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
    .toISOString()
    .slice(0, 10);
}

function expandHolidayDayKeys(holidays: Array<Pick<HolidayModel, "startDate" | "endDate"> | { startDate: Date; endDate: Date }>) {
  const dayKeys = new Set<string>();
  for (const holiday of holidays) {
    const start = new Date(holiday.startDate);
    const end = new Date(holiday.endDate);
    const startUtc = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
    const endUtc = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
    const current = new Date(startUtc.getTime());
    while (current.getTime() <= endUtc.getTime()) {
      dayKeys.add(dayKey(current));
      current.setUTCDate(current.getUTCDate() + 1);
    }
  }
  return dayKeys;
}

function mergeHolidaySets(...sets: Array<Set<string> | undefined>) {
  const merged = new Set<string>();
  for (const set of sets) {
    if (!set) continue;
    for (const value of set) {
      merged.add(value);
    }
  }
  return merged;
}

function calendarToConfig(
  calendar: {
    workMon: boolean;
    workTue: boolean;
    workWed: boolean;
    workThu: boolean;
    workFri: boolean;
    workSat: boolean;
    workSun: boolean;
  },
  holidayDayKeys?: Set<string>,
): WorkingCalendarConfig {
  return {
    workMon: calendar.workMon,
    workTue: calendar.workTue,
    workWed: calendar.workWed,
    workThu: calendar.workThu,
    workFri: calendar.workFri,
    workSat: calendar.workSat,
    workSun: calendar.workSun,
    holidayDayKeys,
  };
}

async function getOrCreateCalendar(projectId: string, db: DbClient) {
  const existing = await db.workingCalendar.findUnique({
    where: { projectId },
  });

  if (existing) {
    return existing;
  }

  return db.workingCalendar.create({
    data: {
      projectId,
      ...DEFAULT_WORKING_CALENDAR,
    },
  });
}

function taskToScheduleTask(task: {
  id: string;
  projectId: string;
  startDate: Date;
  endDate: Date;
  durationDays: number;
  isMilestone: boolean;
}): ScheduleTask {
  return {
    id: task.id,
    projectId: task.projectId,
    startDate: task.startDate,
    endDate: task.endDate,
    durationDays: task.durationDays,
    isMilestone: task.isMilestone,
  };
}

function dependencyToSchedule(dependency: {
  id: string;
  predecessorTaskId: string;
  successorTaskId: string;
  type: string;
  lagDays: number;
  drivesSchedule?: boolean | null;
}): ScheduleDependency {
  return {
    id: dependency.id,
    predecessorTaskId: dependency.predecessorTaskId,
    successorTaskId: dependency.successorTaskId,
    type: toDependencyType(String(dependency.type)),
    lagDays: dependency.lagDays,
    drivesSchedule: dependency.drivesSchedule !== false,
  };
}

function buildTaskCalendarByTaskId(params: {
  tasks: Array<{ id: string; companyId: string | null }>;
  calendar: {
    workMon: boolean;
    workTue: boolean;
    workWed: boolean;
    workThu: boolean;
    workFri: boolean;
    workSat: boolean;
    workSun: boolean;
  };
  holidays: Array<{
    scope: "PROJECT" | "COMPANY";
    companyId: string | null;
    startDate: Date;
    endDate: Date;
  }>;
}) {
  const { tasks, calendar, holidays } = params;
  const taskCalendarByTaskId = new Map<string, WorkingCalendarConfig>();

  const projectHolidayKeys = expandHolidayDayKeys(
    holidays
      .filter((holiday) => holiday.scope === "PROJECT")
      .map((holiday) => ({ startDate: holiday.startDate, endDate: holiday.endDate })),
  );

  const companyHolidayKeyByCompanyId = new Map<string, Set<string>>();
  const companyHolidays = holidays.filter((holiday) => holiday.scope === "COMPANY" && holiday.companyId);
  for (const holiday of companyHolidays) {
    if (!holiday.companyId) continue;
    const existing = companyHolidayKeyByCompanyId.get(holiday.companyId) ?? new Set<string>();
    const expanded = expandHolidayDayKeys([{ startDate: holiday.startDate, endDate: holiday.endDate }]);
    for (const key of expanded) {
      existing.add(key);
    }
    companyHolidayKeyByCompanyId.set(holiday.companyId, existing);
  }

  for (const task of tasks) {
    const mergedHolidayKeys = mergeHolidaySets(
      projectHolidayKeys,
      task.companyId ? companyHolidayKeyByCompanyId.get(task.companyId) : undefined,
    );
    taskCalendarByTaskId.set(
      task.id,
      calendarToConfig(calendar, mergedHolidayKeys.size > 0 ? mergedHolidayKeys : undefined),
    );
  }

  return taskCalendarByTaskId;
}

function serializePayload(data: {
  project: {
    id: string;
    name: string;
    description: string | null;
    startDate: Date;
    endDate: Date | null;
    createdAt: Date;
    updatedAt: Date;
  };
  tasks: Array<{
    id: string;
    projectId: string;
    parentTaskId: string | null;
    timelineHeadTaskId: string | null;
    name: string;
    activityName: string | null;
    categoryMajor: string | null;
    categoryMiddle1: string | null;
    categoryMiddle2: string | null;
    categorySmall: string | null;
    companyId: string | null;
    siteMainCategory: string | null;
    siteDisplayText: string | null;
    categoryMiddle: string | null;
    categoryMinor: string | null;
    wbsCode: string | null;
    startDate: Date;
    endDate: Date;
    durationDays: number;
    progress: number;
    assignee: string | null;
    color: string;
    isMilestone: boolean;
    notes: string | null;
    sortOrder: number;
    createdAt: Date;
    updatedAt: Date;
  }>;
  dependencies: Array<{
    id: string;
    projectId: string;
    predecessorTaskId: string;
    successorTaskId: string;
    type: string;
    lagDays: number;
    drivesSchedule?: boolean | null;
    createdAt: Date;
  }>;
  calendar: {
    id: string;
    projectId: string;
    workMon: boolean;
    workTue: boolean;
    workWed: boolean;
    workThu: boolean;
    workFri: boolean;
    workSat: boolean;
    workSun: boolean;
    createdAt: Date;
    updatedAt: Date;
  };
  companies: Array<{
    id: string;
    projectId: string;
    name: string;
    createdAt: Date;
    updatedAt: Date;
  }>;
  holidays: Array<{
    id: string;
    projectId: string;
    scope: "PROJECT" | "COMPANY";
    companyId: string | null;
    name: string | null;
    startDate: Date;
    endDate: Date;
    createdAt: Date;
    updatedAt: Date;
  }>;
}): ProjectSchedulePayload {
  return {
    project: {
      ...data.project,
      startDate: data.project.startDate.toISOString(),
      endDate: data.project.endDate?.toISOString() ?? null,
      createdAt: data.project.createdAt.toISOString(),
      updatedAt: data.project.updatedAt.toISOString(),
    },
    tasks: data.tasks.map((task) => ({
      ...task,
      name: resolveActivityName(task.activityName, task.name),
      activityName: resolveActivityName(task.activityName, task.name),
      categoryMiddle1: task.categoryMiddle1 ?? task.categoryMiddle,
      categoryMiddle2: task.categoryMiddle2 ?? task.categoryMinor,
      categoryMiddle: task.categoryMiddle1 ?? task.categoryMiddle,
      categoryMinor: task.categoryMiddle2 ?? task.categoryMinor,
      siteMainCategory: task.siteMainCategory ?? task.categoryMajor,
      siteDisplayText: resolveSiteDisplayText({
        siteDisplayText: task.siteDisplayText,
        activityName: task.activityName,
        name: task.name,
      }),
      startDate: task.startDate.toISOString(),
      endDate: task.endDate.toISOString(),
      createdAt: task.createdAt.toISOString(),
      updatedAt: task.updatedAt.toISOString(),
    })),
    dependencies: data.dependencies.map((dependency) => ({
      ...dependency,
      type: toDependencyType(String(dependency.type)),
      drivesSchedule: dependency.drivesSchedule ?? undefined,
      createdAt: dependency.createdAt.toISOString(),
    })),
    calendar: {
      ...data.calendar,
      createdAt: data.calendar.createdAt.toISOString(),
      updatedAt: data.calendar.updatedAt.toISOString(),
    },
    companies: data.companies.map((company) => ({
      ...company,
      createdAt: company.createdAt.toISOString(),
      updatedAt: company.updatedAt.toISOString(),
    })),
    holidays: data.holidays.map((holiday) => ({
      ...holiday,
      startDate: holiday.startDate.toISOString(),
      endDate: holiday.endDate.toISOString(),
      createdAt: holiday.createdAt.toISOString(),
      updatedAt: holiday.updatedAt.toISOString(),
    })),
  };
}

export async function getProjectSchedule(projectId: string, db: DbClient = prisma) {
  const project = await db.project.findUnique({
    where: { id: projectId },
  });

  if (!project) {
    return null;
  }

  const [calendar, tasks, dependencies, companies, holidays] = await Promise.all([
    getOrCreateCalendar(projectId, db),
    db.task.findMany({
      where: { projectId },
      orderBy: { sortOrder: "asc" },
    }),
    db.dependency.findMany({
      where: { projectId },
    }),
    db.company.findMany({
      where: { projectId },
      orderBy: { name: "asc" },
    }),
    db.holiday.findMany({
      where: { projectId },
      orderBy: [{ startDate: "asc" }, { createdAt: "asc" }],
    }),
  ]);

  return serializePayload({
    project,
    tasks,
    dependencies,
    calendar,
    companies,
    holidays: holidays.map((holiday) => ({
      ...holiday,
      scope: holiday.scope as "PROJECT" | "COMPANY",
    })),
  });
}

export async function recalculateAndPersistSchedule(params: {
  projectId: string;
  anchorTaskIds: string[];
  /** true면 연결된 구속 모두 반영(후행 연동 토글 켰을 때) */
  forceAllDependencies?: boolean;
  /** 이동한 작업의 종료일 변경량(ms). 있으면 후행을 델타만큼 일괄 이동(캐스케이드) */
  moveDeltaMs?: number;
  db?: DbClient;
}) {
  const { projectId, anchorTaskIds, forceAllDependencies, moveDeltaMs } = params;
  const db = params.db ?? prisma;

  const [calendar, tasks, dependencies, holidays] = await Promise.all([
    getOrCreateCalendar(projectId, db),
    db.task.findMany({ where: { projectId } }),
    db.dependency.findMany({ where: { projectId } }),
    db.holiday.findMany({ where: { projectId } }),
  ]);

  const scheduleTasks = tasks.map(taskToScheduleTask);
  const scheduleDependencies = dependencies.map((dependency) =>
    dependencyToSchedule({ ...dependency, type: String(dependency.type) }),
  );

  assertNoDependencyCycle(scheduleTasks, scheduleDependencies);

  const baseCalendarConfig = calendarToConfig(calendar);
  const taskCalendarByTaskId = buildTaskCalendarByTaskId({
    tasks: tasks.map((task) => ({ id: task.id, companyId: task.companyId })),
    calendar,
    holidays: holidays.map((holiday) => ({
      ...holiday,
      scope: holiday.scope as "PROJECT" | "COMPANY",
    })),
  });

  const useCascadeByDelta =
    forceAllDependencies === true && moveDeltaMs !== undefined && moveDeltaMs !== 0;
  const changedTasks = useCascadeByDelta
    ? cascadeSuccessorsByDelta({
        tasks: scheduleTasks,
        dependencies: scheduleDependencies,
        anchorTaskIds,
        deltaMs: moveDeltaMs,
      })
    : recalculateSuccessorTasks({
        tasks: scheduleTasks,
        dependencies: scheduleDependencies,
        calendar: baseCalendarConfig,
        calendarByTaskId: taskCalendarByTaskId,
        anchorTaskIds,
        forceAllDependencies,
      });

  for (const task of changedTasks) {
    const taskCalendar = taskCalendarByTaskId.get(task.id) ?? baseCalendarConfig;
    const normalized = normalizeTaskDates(
      {
        startDate: task.startDate,
        endDate: task.endDate,
        durationDays: task.durationDays,
        isMilestone: task.isMilestone,
      },
      taskCalendar,
    );

    await db.task.update({
      where: { id: task.id },
      data: {
        startDate: normalized.startDate,
        endDate: normalized.endDate,
        durationDays: normalized.durationDays,
      },
    });
  }

  const allTasks = await db.task.findMany({ where: { projectId } });
  const projectEndDate = allTasks.reduce<Date | null>((current, task) => {
    if (!current || task.endDate.getTime() > current.getTime()) {
      return task.endDate;
    }
    return current;
  }, null);

  const projectStartDate = allTasks.reduce<Date | null>((current, task) => {
    if (!current || task.startDate.getTime() < current.getTime()) {
      return task.startDate;
    }
    return current;
  }, null);

  if (projectStartDate) {
    await db.project.update({
      where: { id: projectId },
      data: {
        startDate: projectStartDate,
        endDate: projectEndDate,
      },
    });
  }

  return changedTasks;
}

export function validateTaskDates(params: {
  startDate: Date;
  endDate: Date;
  durationDays?: number;
  isMilestone?: boolean;
  calendar: WorkingCalendarConfig;
}) {
  const normalized = normalizeTaskDates(
    {
      startDate: params.startDate,
      endDate: params.endDate,
      durationDays: params.durationDays,
      isMilestone: params.isMilestone,
    },
    params.calendar,
  );

  if (params.isMilestone && normalized.startDate.getTime() !== normalized.endDate.getTime()) {
    throw new Error("Milestone must have same start and end date.");
  }

  return {
    ...normalized,
    durationDays: Math.max(1, businessDaysBetween(normalized.startDate, normalized.endDate, params.calendar)),
  };
}

export { ScheduleCycleError, buildTaskCalendarByTaskId, calendarToConfig };
