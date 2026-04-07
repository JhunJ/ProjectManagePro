import { NextRequest } from "next/server";

import { badRequest, notFound, ok, serverError } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { calendarPatchSchema } from "@/lib/validations/schemas";
import { DEFAULT_WORKING_CALENDAR, normalizeTaskDates } from "@/server/schedulers/business-days";
import { buildTaskCalendarByTaskId, recalculateAndPersistSchedule } from "@/server/services/schedule-service";

interface Params {
  params: Promise<{ projectId: string }>;
}

export async function GET(_: NextRequest, context: Params) {
  try {
    const { projectId } = await context.params;
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) {
      return notFound("프로젝트를 찾을 수 없습니다.");
    }

    const calendar =
      (await prisma.workingCalendar.findUnique({ where: { projectId } })) ??
      (await prisma.workingCalendar.create({
        data: {
          projectId,
          ...DEFAULT_WORKING_CALENDAR,
        },
      }));

    return ok({
      ...calendar,
      createdAt: calendar.createdAt.toISOString(),
      updatedAt: calendar.updatedAt.toISOString(),
    });
  } catch (error) {
    return serverError(error);
  }
}

export async function PATCH(request: NextRequest, context: Params) {
  try {
    const { projectId } = await context.params;
    const body = await request.json();
    const parsed = calendarPatchSchema.safeParse(body);

    if (!parsed.success) {
      return badRequest("캘린더 수정 요청이 유효하지 않습니다.", parsed.error.flatten());
    }

    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) {
      return notFound("프로젝트를 찾을 수 없습니다.");
    }

    const existing =
      (await prisma.workingCalendar.findUnique({ where: { projectId } })) ??
      (await prisma.workingCalendar.create({
        data: {
          projectId,
          ...DEFAULT_WORKING_CALENDAR,
        },
      }));

    const nextCalendar = {
      workMon: parsed.data.workMon ?? existing.workMon,
      workTue: parsed.data.workTue ?? existing.workTue,
      workWed: parsed.data.workWed ?? existing.workWed,
      workThu: parsed.data.workThu ?? existing.workThu,
      workFri: parsed.data.workFri ?? existing.workFri,
      workSat: parsed.data.workSat ?? existing.workSat,
      workSun: parsed.data.workSun ?? existing.workSun,
    };

    if (!Object.values(nextCalendar).some(Boolean)) {
      return badRequest("최소 하루는 근무일이어야 합니다.");
    }

    const changedTaskIds: string[] = [];

    await prisma.$transaction(async (tx) => {
      await tx.workingCalendar.update({
        where: { projectId },
        data: nextCalendar,
      });

      const tasks = await tx.task.findMany({
        where: { projectId },
        orderBy: { sortOrder: "asc" },
      });
      const holidays = await tx.holiday.findMany({
        where: { projectId },
      });
      const taskCalendarByTaskId = buildTaskCalendarByTaskId({
        tasks: tasks.map((task) => ({ id: task.id, companyId: task.companyId })),
        calendar: nextCalendar,
        holidays: holidays.map((holiday) => ({
          ...holiday,
          scope: String(holiday.scope) as "PROJECT" | "COMPANY",
        })),
      });

      for (const task of tasks) {
        const taskCalendar = taskCalendarByTaskId.get(task.id) ?? nextCalendar;
        const normalized = normalizeTaskDates(
          {
            startDate: task.startDate,
            endDate: task.endDate,
            durationDays: task.durationDays,
            isMilestone: task.isMilestone,
          },
          taskCalendar,
        );

        const isChanged =
          normalized.startDate.getTime() !== task.startDate.getTime() ||
          normalized.endDate.getTime() !== task.endDate.getTime() ||
          normalized.durationDays !== task.durationDays;

        if (isChanged) {
          changedTaskIds.push(task.id);
          await tx.task.update({
            where: { id: task.id },
            data: {
              startDate: normalized.startDate,
              endDate: normalized.endDate,
              durationDays: normalized.durationDays,
            },
          });
        }
      }

      if (changedTaskIds.length > 0) {
        await recalculateAndPersistSchedule({
          projectId,
          anchorTaskIds: changedTaskIds,
          db: tx,
        });
      }
    });

    const updated = await prisma.workingCalendar.findUnique({ where: { projectId } });
    if (!updated) {
      return notFound("캘린더를 찾을 수 없습니다.");
    }

    return ok({
      ...updated,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    });
  } catch (error) {
    return serverError(error);
  }
}
