import { NextRequest } from "next/server";

import { badRequest, notFound, ok, serverError } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { isSiteDisplayTextManual, resolveActivityName, resolveSiteDisplayText, toStoredSiteDisplayText } from "@/lib/site-display-text";
import { taskUpdateSchema } from "@/lib/validations/schemas";
import { DEFAULT_WORKING_CALENDAR } from "@/server/schedulers/business-days";
import {
  buildTaskCalendarByTaskId,
  recalculateAndPersistSchedule,
  validateTaskDates,
} from "@/server/services/schedule-service";

interface Params {
  params: Promise<{ taskId: string }>;
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

export async function PATCH(request: NextRequest, context: Params) {
  try {
    const { taskId } = await context.params;
    const body = await request.json();
    const parsed = taskUpdateSchema.safeParse(body);

    if (!parsed.success) {
      return badRequest("Invalid task update request.", parsed.error.flatten());
    }

    const existing = await prisma.task.findUnique({ where: { id: taskId } });
    if (!existing) {
      return notFound("Task not found.");
    }

    const payload = parsed.data;

    if (payload.parentTaskId === taskId) {
      return badRequest("Task cannot be its own parent.");
    }

    if (payload.parentTaskId) {
      const parentTask = await prisma.task.findUnique({ where: { id: payload.parentTaskId } });
      if (!parentTask || parentTask.projectId !== existing.projectId) {
        return badRequest("Parent task must exist in same project.");
      }
    }

    if (payload.timelineHeadTaskId !== undefined && payload.timelineHeadTaskId !== null) {
      if (payload.timelineHeadTaskId === taskId) {
        return badRequest("Task cannot be its own timeline head.");
      }
      const headTask = await prisma.task.findUnique({ where: { id: payload.timelineHeadTaskId } });
      if (!headTask || headTask.projectId !== existing.projectId) {
        return badRequest("Timeline head task must exist in same project.");
      }
      if (headTask.timelineHeadTaskId) {
        return badRequest("Timeline segments must attach to a root activity row task.");
      }
    }

    const nextCompanyId = payload.companyId ?? existing.companyId;
    if (nextCompanyId) {
      const company = await prisma.company.findUnique({ where: { id: nextCompanyId } });
      if (!company || company.projectId !== existing.projectId) {
        return badRequest("Company must exist in same project.");
      }
    }

    const [calendar, holidays] = await Promise.all([
      prisma.workingCalendar.findUnique({ where: { projectId: existing.projectId } }),
      prisma.holiday.findMany({ where: { projectId: existing.projectId } }),
    ]);
    const ensuredCalendar =
      calendar ??
      (await prisma.workingCalendar.create({
        data: {
          projectId: existing.projectId,
          ...DEFAULT_WORKING_CALENDAR,
        },
      }));

    const isMilestone = payload.isMilestone ?? existing.isMilestone;
    const startDate = new Date(payload.startDate ?? existing.startDate);
    const endDate = new Date(payload.endDate ?? existing.endDate);

    const taskCalendar = buildTaskCalendarByTaskId({
      tasks: [{ id: existing.id, companyId: nextCompanyId }],
      calendar: ensuredCalendar,
      holidays: holidays.map((holiday) => ({
        scope: String(holiday.scope) as "PROJECT" | "COMPANY",
        companyId: holiday.companyId,
        startDate: holiday.startDate,
        endDate: holiday.endDate,
      })),
    }).get(existing.id);

    const toNullablePatch = (value?: string | null) => {
      if (value === undefined) return undefined;
      const trimmed = value?.trim();
      return trimmed ? trimmed : null;
    };

    const nextActivityName = toNullablePatch(payload.activityName) ?? toNullablePatch(payload.name) ?? existing.name;
    const nextCategoryMajor =
      payload.categoryMajor === undefined ? existing.categoryMajor : toNullablePatch(payload.categoryMajor);
    const nextMiddle1 = toNullablePatch(payload.categoryMiddle1) ?? toNullablePatch(payload.categoryMiddle) ?? existing.categoryMiddle1 ?? existing.categoryMiddle;
    const nextMiddle2 = toNullablePatch(payload.categoryMiddle2) ?? toNullablePatch(payload.categoryMinor) ?? existing.categoryMiddle2 ?? existing.categoryMinor;
    const nextSiteMainCategory =
      payload.siteMainCategory === undefined
        ? existing.siteMainCategory ?? nextCategoryMajor
        : toNullablePatch(payload.siteMainCategory) ?? nextCategoryMajor;
    const nextSiteDisplayText =
      payload.siteDisplayText === undefined
        ? isSiteDisplayTextManual({
            siteDisplayText: existing.siteDisplayText,
            activityName: existing.activityName,
            name: existing.name,
          })
          ? toNullablePatch(existing.siteDisplayText)
          : null
        : toStoredSiteDisplayText({
            siteDisplayText: toNullablePatch(payload.siteDisplayText),
            activityName: nextActivityName,
          });

    const normalized = validateTaskDates({
      startDate,
      endDate,
      durationDays: payload.durationDays ?? existing.durationDays,
      isMilestone,
      calendar: taskCalendar ?? ensuredCalendar,
    });

    const updateData: Parameters<typeof prisma.task.update>[0]["data"] = {
      parentTaskId: payload.parentTaskId,
      timelineHeadTaskId: payload.timelineHeadTaskId,
      name: nextActivityName,
      activityName: nextActivityName,
      categoryMajor: nextCategoryMajor,
      categoryMiddle1: nextMiddle1,
      categoryMiddle2: nextMiddle2,
      categorySmall: toNullablePatch(payload.categorySmall),
      companyId: payload.companyId,
      siteMainCategory: nextSiteMainCategory,
      siteDisplayText: nextSiteDisplayText,
      categoryMiddle: nextMiddle1,
      categoryMinor: nextMiddle2,
      wbsCode: toNullablePatch(payload.wbsCode),
      startDate: normalized.startDate,
      endDate: normalized.endDate,
      durationDays: isMilestone ? 1 : normalized.durationDays,
      assignee: toNullablePatch(payload.assignee),
      color: payload.color ?? existing.color,
      isMilestone,
      notes: toNullablePatch(payload.notes),
      sortOrder: payload.sortOrder,
    };
    if (payload.progress !== undefined) {
      updateData.progress = Math.max(0, Math.min(100, payload.progress));
    }

    const updated = await prisma.task.update({
      where: { id: taskId },
      data: updateData,
    });

    const recalculateSuccessors = payload.recalculateSuccessors !== false;
    const forceAll = payload.forceAllDependencies === true;
    if (recalculateSuccessors) {
      const moveDeltaMs =
        forceAll && existing.endDate && updated.endDate
          ? updated.endDate.getTime() - existing.endDate.getTime()
          : undefined;
      await recalculateAndPersistSchedule({
        projectId: existing.projectId,
        anchorTaskIds: [taskId],
        forceAllDependencies: forceAll,
        moveDeltaMs,
      });
    }

    return ok(serializeTask(updated));
  } catch (error) {
    return serverError(error);
  }
}

export async function DELETE(_: NextRequest, context: Params) {
  try {
    const { taskId } = await context.params;

    const existing = await prisma.task.findUnique({ where: { id: taskId } });
    if (!existing) {
      return notFound("Task not found.");
    }

    await prisma.task.delete({ where: { id: taskId } });

    await recalculateAndPersistSchedule({
      projectId: existing.projectId,
      anchorTaskIds: [],
    });

    return ok({ success: true });
  } catch (error) {
    return serverError(error);
  }
}
