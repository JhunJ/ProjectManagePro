import { NextRequest } from "next/server";

import { toDependencyType } from "@/lib/dependency-type";
import { badRequest, notFound, ok, serverError } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { dependencyUpdateSchema } from "@/lib/validations/schemas";
import { assertNoDependencyCycle } from "@/server/schedulers/dependency-recalc";
import { recalculateAndPersistSchedule } from "@/server/services/schedule-service";

interface Params {
  params: Promise<{ dependencyId: string }>;
}

export async function PATCH(request: NextRequest, context: Params) {
  try {
    const { dependencyId } = await context.params;
    const body = await request.json();
    const parsed = dependencyUpdateSchema.safeParse(body);

    if (!parsed.success) {
      return badRequest("의존관계 수정 요청이 유효하지 않습니다.", parsed.error.flatten());
    }

    const existing = await prisma.dependency.findUnique({ where: { id: dependencyId } });
    if (!existing) {
      return notFound("의존관계를 찾을 수 없습니다.");
    }

    const nextPredecessorTaskId = parsed.data.predecessorTaskId ?? existing.predecessorTaskId;
    const nextSuccessorTaskId = parsed.data.successorTaskId ?? existing.successorTaskId;

    if (nextPredecessorTaskId === nextSuccessorTaskId) {
      return badRequest("동일 작업을 선행/후행으로 지정할 수 없습니다.");
    }

    const [predecessor, successor, tasks, dependencies] = await Promise.all([
      prisma.task.findUnique({ where: { id: nextPredecessorTaskId } }),
      prisma.task.findUnique({ where: { id: nextSuccessorTaskId } }),
      prisma.task.findMany({ where: { projectId: existing.projectId } }),
      prisma.dependency.findMany({ where: { projectId: existing.projectId } }),
    ]);

    if (!predecessor || !successor || predecessor.projectId !== existing.projectId || successor.projectId !== existing.projectId) {
      return badRequest("선행/후행 작업은 같은 프로젝트에 있어야 합니다.");
    }

    const mergedDependencies = dependencies.map((dependency) => {
      if (dependency.id !== dependencyId) {
        return {
          id: dependency.id,
          predecessorTaskId: dependency.predecessorTaskId,
          successorTaskId: dependency.successorTaskId,
          type: toDependencyType(dependency.type),
          lagDays: dependency.lagDays,
        };
      }

      return {
        id: dependency.id,
        predecessorTaskId: nextPredecessorTaskId,
        successorTaskId: nextSuccessorTaskId,
        type: parsed.data.type ?? toDependencyType(dependency.type),
        lagDays: parsed.data.lagDays ?? dependency.lagDays,
      };
    });

    assertNoDependencyCycle(
      tasks.map((task) => ({
        id: task.id,
        projectId: task.projectId,
        startDate: task.startDate,
        endDate: task.endDate,
        durationDays: task.durationDays,
        isMilestone: task.isMilestone,
      })),
      mergedDependencies,
    );

    const updated = await prisma.dependency.update({
      where: { id: dependencyId },
      data: {
        ...(parsed.data.predecessorTaskId !== undefined && { predecessorTaskId: parsed.data.predecessorTaskId }),
        ...(parsed.data.successorTaskId !== undefined && { successorTaskId: parsed.data.successorTaskId }),
        ...(parsed.data.type !== undefined && { type: parsed.data.type }),
        ...(parsed.data.lagDays !== undefined && { lagDays: parsed.data.lagDays }),
        ...(parsed.data.drivesSchedule !== undefined && { drivesSchedule: parsed.data.drivesSchedule }),
      },
    });

    if (updated.drivesSchedule !== false) {
      await recalculateAndPersistSchedule({
        projectId: existing.projectId,
        anchorTaskIds: [nextPredecessorTaskId],
      });
    }

    return ok({
      ...updated,
      drivesSchedule: updated.drivesSchedule,
      createdAt: updated.createdAt.toISOString(),
    });
  } catch (error) {
    return serverError(error);
  }
}

export async function DELETE(_: NextRequest, context: Params) {
  try {
    const { dependencyId } = await context.params;

    const existing = await prisma.dependency.findUnique({ where: { id: dependencyId } });
    if (!existing) {
      return notFound("의존관계를 찾을 수 없습니다.");
    }

    await prisma.dependency.delete({ where: { id: dependencyId } });

    await recalculateAndPersistSchedule({
      projectId: existing.projectId,
      anchorTaskIds: [existing.predecessorTaskId],
    });

    return ok({ success: true });
  } catch (error) {
    return serverError(error);
  }
}
