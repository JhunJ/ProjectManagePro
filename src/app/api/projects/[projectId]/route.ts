import { NextRequest } from "next/server";

import { notFound, ok, serverError } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { projectUpdateSchema } from "@/lib/validations/schemas";
import { getProjectSchedule } from "@/server/services/schedule-service";

interface Params {
  params: Promise<{ projectId: string }>;
}

export async function GET(_: NextRequest, context: Params) {
  try {
    const { projectId } = await context.params;
    const schedule = await getProjectSchedule(projectId);

    if (!schedule) {
      return notFound("프로젝트를 찾을 수 없습니다.");
    }

    return ok(schedule);
  } catch (error) {
    return serverError(error);
  }
}

export async function PATCH(request: NextRequest, context: Params) {
  try {
    const { projectId } = await context.params;
    const body = await request.json();
    const parsed = projectUpdateSchema.parse(body);

    const existing = await prisma.project.findUnique({ where: { id: projectId } });
    if (!existing) {
      return notFound("프로젝트를 찾을 수 없습니다.");
    }

    const updated = await prisma.project.update({
      where: { id: projectId },
      data: {
        name: parsed.name,
        description: parsed.description,
        startDate: parsed.startDate ? new Date(parsed.startDate) : undefined,
        endDate: parsed.endDate === undefined ? undefined : parsed.endDate ? new Date(parsed.endDate) : null,
      },
    });

    return ok({
      ...updated,
      startDate: updated.startDate.toISOString(),
      endDate: updated.endDate?.toISOString() ?? null,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    });
  } catch (error) {
    return serverError(error);
  }
}

export async function DELETE(_: NextRequest, context: Params) {
  try {
    const { projectId } = await context.params;

    const existing = await prisma.project.findUnique({ where: { id: projectId } });
    if (!existing) {
      return notFound("프로젝트를 찾을 수 없습니다.");
    }

    await prisma.project.delete({ where: { id: projectId } });
    return ok({ success: true });
  } catch (error) {
    return serverError(error);
  }
}
