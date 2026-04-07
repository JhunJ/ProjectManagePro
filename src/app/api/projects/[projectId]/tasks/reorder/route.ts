import { NextRequest } from "next/server";

import { badRequest, ok, serverError } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { taskReorderSchema } from "@/lib/validations/schemas";
import { recalculateAndPersistSchedule } from "@/server/services/schedule-service";

interface Params {
  params: Promise<{ projectId: string }>;
}

export async function POST(request: NextRequest, context: Params) {
  try {
    const { projectId } = await context.params;
    const body = await request.json();
    const parsed = taskReorderSchema.safeParse(body);

    if (!parsed.success) {
      return badRequest("재정렬 요청이 유효하지 않습니다.", parsed.error.flatten());
    }

    const ids = parsed.data.items.map((item) => item.id);
    const existing = await prisma.task.findMany({
      where: {
        id: { in: ids },
        projectId,
      },
      select: { id: true },
    });

    if (existing.length !== ids.length) {
      return badRequest("일부 작업이 프로젝트에 존재하지 않습니다.");
    }

    await prisma.$transaction(async (tx) => {
      for (const item of parsed.data.items) {
        if (item.parentTaskId) {
          const parent = await tx.task.findUnique({ where: { id: item.parentTaskId } });
          if (!parent || parent.projectId !== projectId) {
            throw new Error("부모 작업이 같은 프로젝트에 존재해야 합니다.");
          }
        }

        await tx.task.update({
          where: { id: item.id },
          data: {
            sortOrder: item.sortOrder,
            parentTaskId: item.parentTaskId,
          },
        });
      }

      await recalculateAndPersistSchedule({
        projectId,
        anchorTaskIds: ids,
        db: tx,
      });
    });

    const tasks = await prisma.task.findMany({
      where: { projectId },
      orderBy: { sortOrder: "asc" },
    });

    return ok(
      tasks.map((task) => ({
        ...task,
        startDate: task.startDate.toISOString(),
        endDate: task.endDate.toISOString(),
        createdAt: task.createdAt.toISOString(),
        updatedAt: task.updatedAt.toISOString(),
      })),
    );
  } catch (error) {
    return serverError(error);
  }
}
