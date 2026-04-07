import { NextRequest } from "next/server";

import { toDependencyType } from "@/lib/dependency-type";
import { badRequest, notFound, ok, serverError } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { dependencyCreateSchema } from "@/lib/validations/schemas";
import { assertNoDependencyCycle } from "@/server/schedulers/dependency-recalc";
import { recalculateAndPersistSchedule } from "@/server/services/schedule-service";

interface Params {
  params: Promise<{ projectId: string }>;
}

export async function GET(_: NextRequest, context: Params) {
  try {
    const { projectId } = await context.params;
    const dependencies = await prisma.dependency.findMany({ where: { projectId } });

    return ok(
      dependencies.map((dependency) => ({
        ...dependency,
        createdAt: dependency.createdAt.toISOString(),
      })),
    );
  } catch (error) {
    return serverError(error);
  }
}

export async function POST(request: NextRequest, context: Params) {
  try {
    const { projectId } = await context.params;
    const body = await request.json();
    const parsed = dependencyCreateSchema.safeParse(body);

    if (!parsed.success) {
      return badRequest("의존관계 생성 요청이 유효하지 않습니다.", parsed.error.flatten());
    }

    const payload = parsed.data;
    if (payload.predecessorTaskId === payload.successorTaskId) {
      return badRequest("동일 작업 간 의존관계는 생성할 수 없습니다.");
    }

    const [project, predecessor, successor, tasks, existingDependencies] = await Promise.all([
      prisma.project.findUnique({ where: { id: projectId } }),
      prisma.task.findUnique({ where: { id: payload.predecessorTaskId } }),
      prisma.task.findUnique({ where: { id: payload.successorTaskId } }),
      prisma.task.findMany({ where: { projectId } }),
      prisma.dependency.findMany({ where: { projectId } }),
    ]);

    if (!project) {
      return notFound("프로젝트를 찾을 수 없습니다.");
    }

    if (!predecessor || !successor || predecessor.projectId !== projectId || successor.projectId !== projectId) {
      return badRequest("선행/후행 작업은 같은 프로젝트에 있어야 합니다.");
    }

    const duplicate = await prisma.dependency.findFirst({
      where: {
        projectId,
        predecessorTaskId: payload.predecessorTaskId,
        successorTaskId: payload.successorTaskId,
        type: payload.type,
      },
    });
    if (duplicate) {
      return badRequest("동일한 의존관계가 이미 존재합니다.");
    }

    assertNoDependencyCycle(
      tasks.map((task) => ({
        id: task.id,
        projectId: task.projectId,
        startDate: task.startDate,
        endDate: task.endDate,
        durationDays: task.durationDays,
        isMilestone: task.isMilestone,
      })),
      [
        ...existingDependencies.map((dependency) => ({
          id: dependency.id,
          predecessorTaskId: dependency.predecessorTaskId,
          successorTaskId: dependency.successorTaskId,
          type: toDependencyType(dependency.type),
          lagDays: dependency.lagDays,
        })),
        {
          id: "new",
          predecessorTaskId: payload.predecessorTaskId,
          successorTaskId: payload.successorTaskId,
          type: payload.type,
          lagDays: payload.lagDays,
        },
      ],
    );

    const dependency = await prisma.dependency.create({
      data: {
        projectId,
        predecessorTaskId: payload.predecessorTaskId,
        successorTaskId: payload.successorTaskId,
        type: payload.type,
        lagDays: payload.lagDays,
        drivesSchedule: payload.drivesSchedule !== false,
      },
    });

    if (dependency.drivesSchedule !== false) {
      await recalculateAndPersistSchedule({
        projectId,
        anchorTaskIds: [payload.predecessorTaskId],
      });
    }

    return ok(
      {
        ...dependency,
        drivesSchedule: dependency.drivesSchedule,
        createdAt: dependency.createdAt.toISOString(),
      },
      { status: 201 },
    );
  } catch (error: unknown) {
    const isPrisma = error && typeof error === "object" && "code" in error;
    if (isPrisma && (error as { code: string }).code === "P2002") {
      return badRequest("동일한 의존관계가 이미 존재합니다.");
    }
    if (error instanceof Error && error.message.includes("Unique constraint")) {
      return badRequest("동일한 의존관계가 이미 존재합니다.");
    }
    return serverError(error);
  }
}
