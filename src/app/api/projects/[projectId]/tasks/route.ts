import { NextRequest } from "next/server";

import { badRequest, notFound, ok, serverError } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { resolveActivityName, resolveSiteDisplayText, toStoredSiteDisplayText } from "@/lib/site-display-text";
import { taskCreateSchema } from "@/lib/validations/schemas";
import { DEFAULT_WORKING_CALENDAR } from "@/server/schedulers/business-days";
import {
  buildTaskCalendarByTaskId,
  recalculateAndPersistSchedule,
  validateTaskDates,
} from "@/server/services/schedule-service";

interface Params {
  params: Promise<{ projectId: string }>;
}

function serializeTask(task: {
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
}) {
  return {
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
  };
}

export async function GET(_: NextRequest, context: Params) {
  try {
    const { projectId } = await context.params;
    const tasks = await prisma.task.findMany({
      where: { projectId },
      orderBy: { sortOrder: "asc" },
    });

    return ok(tasks.map(serializeTask));
  } catch (error) {
    return serverError(error);
  }
}

export async function POST(request: NextRequest, context: Params) {
  try {
    const { projectId } = await context.params;
    const body = await request.json();
    const parsed = taskCreateSchema.safeParse(body);

    if (!parsed.success) {
      return badRequest("Invalid task create request.", parsed.error.flatten());
    }

    const payload = parsed.data;
    const [project, calendar, holidays] = await Promise.all([
      prisma.project.findUnique({ where: { id: projectId } }),
      prisma.workingCalendar.findUnique({ where: { projectId } }),
      prisma.holiday.findMany({ where: { projectId } }),
    ]);
    if (!project) {
      return notFound("Project not found.");
    }

    const ensuredCalendar =
      calendar ??
      (await prisma.workingCalendar.create({
        data: {
          projectId,
          ...DEFAULT_WORKING_CALENDAR,
        },
      }));

    if (payload.parentTaskId) {
      const parentTask = await prisma.task.findUnique({ where: { id: payload.parentTaskId } });
      if (!parentTask || parentTask.projectId !== projectId) {
        return badRequest("Parent task must exist in same project.");
      }
    }

    if (payload.timelineHeadTaskId) {
      const headTask = await prisma.task.findUnique({ where: { id: payload.timelineHeadTaskId } });
      if (!headTask || headTask.projectId !== projectId) {
        return badRequest("Timeline head task must exist in same project.");
      }
      if (headTask.timelineHeadTaskId) {
        return badRequest("Timeline segments must attach to a root activity row task.");
      }
    }

    if (payload.companyId) {
      const company = await prisma.company.findUnique({ where: { id: payload.companyId } });
      if (!company || company.projectId !== projectId) {
        return badRequest("Company must exist in same project.");
      }
    }

    const toNullable = (value?: string | null) => {
      const trimmed = value?.trim();
      return trimmed ? trimmed : null;
    };

    const maxSortOrder = await prisma.task.aggregate({
      where: { projectId },
      _max: { sortOrder: true },
    });

    const activityName = toNullable(payload.activityName) ?? payload.name.trim();
    const categoryMajor = toNullable(payload.categoryMajor);
    const categoryMiddle1 = toNullable(payload.categoryMiddle1) ?? toNullable(payload.categoryMiddle);
    const categoryMiddle2 = toNullable(payload.categoryMiddle2) ?? toNullable(payload.categoryMinor);
    const siteMainCategory = toNullable(payload.siteMainCategory) ?? categoryMajor;
    const siteDisplayText = toStoredSiteDisplayText({
      siteDisplayText: toNullable(payload.siteDisplayText),
      activityName,
    });

    const taskCalendar = buildTaskCalendarByTaskId({
      tasks: [{ id: "draft", companyId: payload.companyId ?? null }],
      calendar: ensuredCalendar,
      holidays: holidays.map((holiday) => ({
        scope: String(holiday.scope) as "PROJECT" | "COMPANY",
        companyId: holiday.companyId,
        startDate: holiday.startDate,
        endDate: holiday.endDate,
      })),
    }).get("draft");

    const normalized = validateTaskDates({
      startDate: new Date(payload.startDate),
      endDate: new Date(payload.endDate),
      durationDays: payload.durationDays,
      isMilestone: payload.isMilestone,
      calendar: taskCalendar ?? ensuredCalendar,
    });

    const created = await prisma.task.create({
      data: {
        projectId,
        parentTaskId: payload.parentTaskId ?? null,
        timelineHeadTaskId: payload.timelineHeadTaskId ?? null,
        name: activityName,
        activityName,
        categoryMajor,
        categoryMiddle1,
        categoryMiddle2,
        categorySmall: toNullable(payload.categorySmall),
        companyId: payload.companyId ?? null,
        siteMainCategory,
        siteDisplayText,
        categoryMiddle: categoryMiddle1,
        categoryMinor: categoryMiddle2,
        wbsCode: toNullable(payload.wbsCode),
        startDate: normalized.startDate,
        endDate: normalized.endDate,
        durationDays: payload.isMilestone ? 1 : normalized.durationDays,
        progress: payload.progress,
        assignee: toNullable(payload.assignee),
        color: payload.color,
        isMilestone: payload.isMilestone,
        notes: toNullable(payload.notes),
        sortOrder: payload.sortOrder ?? (maxSortOrder._max.sortOrder ?? -1) + 1,
      },
    });

    await recalculateAndPersistSchedule({
      projectId,
      anchorTaskIds: [created.id],
    });

    return ok(serializeTask(created), { status: 201 });
  } catch (error) {
    return serverError(error);
  }
}
