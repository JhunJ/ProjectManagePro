import { NextRequest } from "next/server";

import { badRequest, notFound, ok, serverError } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { holidayUpdateSchema } from "@/lib/validations/schemas";
import { recalculateAndPersistSchedule } from "@/server/services/schedule-service";

interface Params {
  params: Promise<{ holidayId: string }>;
}

function serializeHoliday(holiday: {
  id: string;
  projectId: string;
  scope: "PROJECT" | "COMPANY" | string;
  companyId: string | null;
  name: string | null;
  startDate: Date;
  endDate: Date;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    ...holiday,
    scope: String(holiday.scope) as "PROJECT" | "COMPANY",
    startDate: holiday.startDate.toISOString(),
    endDate: holiday.endDate.toISOString(),
    createdAt: holiday.createdAt.toISOString(),
    updatedAt: holiday.updatedAt.toISOString(),
  };
}

export async function PATCH(request: NextRequest, context: Params) {
  try {
    const { holidayId } = await context.params;
    const body = await request.json();
    const parsed = holidayUpdateSchema.safeParse(body);

    if (!parsed.success) {
      return badRequest("Invalid holiday update request.", parsed.error.flatten());
    }

    const existing = await prisma.holiday.findUnique({ where: { id: holidayId } });
    if (!existing) {
      return notFound("Holiday not found.");
    }

    const nextScope = parsed.data.scope ?? (String(existing.scope) as "PROJECT" | "COMPANY");
    const nextCompanyId = parsed.data.companyId ?? existing.companyId;
    const nextStartDate = new Date(parsed.data.startDate ?? existing.startDate);
    const nextEndDate = new Date(parsed.data.endDate ?? existing.endDate);

    if (nextStartDate.getTime() > nextEndDate.getTime()) {
      return badRequest("startDate must be <= endDate.");
    }

    if (nextScope === "COMPANY") {
      if (!nextCompanyId) {
        return badRequest("companyId is required for COMPANY scope.");
      }
      const company = await prisma.company.findUnique({ where: { id: nextCompanyId } });
      if (!company || company.projectId !== existing.projectId) {
        return badRequest("companyId must belong to this project.");
      }
    }

    const updated = await prisma.holiday.update({
      where: { id: holidayId },
      data: {
        scope: nextScope,
        companyId: nextScope === "COMPANY" ? nextCompanyId : null,
        name: parsed.data.name === undefined ? undefined : parsed.data.name?.trim() ? parsed.data.name.trim() : null,
        startDate: nextStartDate,
        endDate: nextEndDate,
      },
    });

    const tasks = await prisma.task.findMany({ where: { projectId: existing.projectId }, select: { id: true } });
    await recalculateAndPersistSchedule({
      projectId: existing.projectId,
      anchorTaskIds: tasks.map((task) => task.id),
    });

    return ok(serializeHoliday(updated));
  } catch (error) {
    return serverError(error);
  }
}

export async function DELETE(_: NextRequest, context: Params) {
  try {
    const { holidayId } = await context.params;

    const existing = await prisma.holiday.findUnique({ where: { id: holidayId } });
    if (!existing) {
      return notFound("Holiday not found.");
    }

    await prisma.holiday.delete({ where: { id: holidayId } });
    const tasks = await prisma.task.findMany({ where: { projectId: existing.projectId }, select: { id: true } });
    await recalculateAndPersistSchedule({
      projectId: existing.projectId,
      anchorTaskIds: tasks.map((task) => task.id),
    });

    return ok({ success: true });
  } catch (error) {
    return serverError(error);
  }
}
