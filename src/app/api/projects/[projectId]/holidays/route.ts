import { NextRequest } from "next/server";

import { badRequest, notFound, ok, serverError } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { holidayCreateSchema } from "@/lib/validations/schemas";
import { recalculateAndPersistSchedule } from "@/server/services/schedule-service";

interface Params {
  params: Promise<{ projectId: string }>;
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

export async function GET(_: NextRequest, context: Params) {
  try {
    const { projectId } = await context.params;

    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) {
      return notFound("Project not found.");
    }

    const holidays = await prisma.holiday.findMany({
      where: { projectId },
      orderBy: [{ startDate: "asc" }, { createdAt: "asc" }],
    });

    return ok(holidays.map(serializeHoliday));
  } catch (error) {
    return serverError(error);
  }
}

export async function POST(request: NextRequest, context: Params) {
  try {
    const { projectId } = await context.params;
    const body = await request.json();
    const parsed = holidayCreateSchema.safeParse(body);

    if (!parsed.success) {
      return badRequest("Invalid holiday create request.", parsed.error.flatten());
    }

    const payload = parsed.data;
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) {
      return notFound("Project not found.");
    }

    if (new Date(payload.startDate).getTime() > new Date(payload.endDate).getTime()) {
      return badRequest("startDate must be <= endDate.");
    }

    if (payload.scope === "COMPANY") {
      const company = await prisma.company.findUnique({ where: { id: payload.companyId! } });
      if (!company || company.projectId !== projectId) {
        return badRequest("companyId must belong to this project.");
      }
    }

    const holiday = await prisma.holiday.create({
      data: {
        projectId,
        scope: payload.scope,
        companyId: payload.scope === "COMPANY" ? payload.companyId ?? null : null,
        name: payload.name?.trim() ? payload.name.trim() : null,
        startDate: new Date(payload.startDate),
        endDate: new Date(payload.endDate),
      },
    });

    const tasks = await prisma.task.findMany({ where: { projectId }, select: { id: true } });
    await recalculateAndPersistSchedule({
      projectId,
      anchorTaskIds: tasks.map((task) => task.id),
    });

    return ok(serializeHoliday(holiday), { status: 201 });
  } catch (error) {
    return serverError(error);
  }
}
