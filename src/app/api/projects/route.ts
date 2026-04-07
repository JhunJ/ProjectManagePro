import { NextRequest } from "next/server";
import { cookies } from "next/headers";

import { badRequest, ok, serverError } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { getSessionFromCookie, COOKIE_NAME } from "@/lib/session";
import { projectCreateSchema } from "@/lib/validations/schemas";
import { DEFAULT_WORKING_CALENDAR } from "@/server/schedulers/business-days";

export async function GET() {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(COOKIE_NAME)?.value;
    const session = await getSessionFromCookie(token);

    const where =
      session?.role === "ADMIN"
        ? undefined
        : session?.role === "USER"
          ? { users: { some: { id: session.userId } } }
          : { id: "never" };

    const [projects, favorites] = await Promise.all([
      prisma.project.findMany({
        where,
        orderBy: { updatedAt: "desc" },
      }),
      session?.userId
        ? prisma.userProjectFavorite.findMany({
            where: { userId: session.userId },
            select: { projectId: true },
          })
        : Promise.resolve([]),
    ]);

    const favoriteProjectIds = new Set(favorites.map((f) => f.projectId));
    const withFavorite = projects.map((project) => ({
      ...project,
      isFavorite: favoriteProjectIds.has(project.id),
    }));
    const sorted = withFavorite.sort((a, b) => {
      if (a.isFavorite !== b.isFavorite) return a.isFavorite ? -1 : 1;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });

    return ok(
      sorted.map((project) => ({
        id: project.id,
        name: project.name,
        description: project.description,
        startDate: project.startDate.toISOString(),
        endDate: project.endDate?.toISOString() ?? null,
        createdAt: project.createdAt.toISOString(),
        updatedAt: project.updatedAt.toISOString(),
        isFavorite: project.isFavorite,
      })),
    );
  } catch (error) {
    return serverError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(COOKIE_NAME)?.value;
    const session = await getSessionFromCookie(token);

    const body = await request.json();
    const parsed = projectCreateSchema.safeParse(body);

    if (!parsed.success) {
      return badRequest("프로젝트 생성 요청이 올바르지 않습니다.", parsed.error.flatten());
    }

    const { name, description, startDate, endDate } = parsed.data;

    const result = await prisma.$transaction(async (tx) => {
      const project = await tx.project.create({
        data: {
          name,
          description: description ?? null,
          startDate: new Date(startDate),
          endDate: endDate ? new Date(endDate) : null,
          // 생성한 사용자를 프로젝트 담당자에 포함시켜 본인이 만든 프로젝트를 목록에서 볼 수 있게 함
          ...(session?.userId && { users: { connect: [{ id: session.userId }] } }),
        },
      });

      await tx.workingCalendar.create({
        data: {
          projectId: project.id,
          ...DEFAULT_WORKING_CALENDAR,
        },
      });

      return project;
    });

    return ok(
      {
        ...result,
        startDate: result.startDate.toISOString(),
        endDate: result.endDate?.toISOString() ?? null,
        createdAt: result.createdAt.toISOString(),
        updatedAt: result.updatedAt.toISOString(),
      },
      { status: 201 },
    );
  } catch (error) {
    return serverError(error);
  }
}
