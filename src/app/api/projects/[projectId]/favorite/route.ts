import { NextRequest } from "next/server";
import { cookies } from "next/headers";

import { badRequest, notFound, ok, serverError, unauthorized } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { getSessionFromCookie, COOKIE_NAME } from "@/lib/session";

interface Params {
  params: Promise<{ projectId: string }>;
}

async function ensureProjectAccess(projectId: string, userId: string, role: "ADMIN" | "USER") {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, users: { select: { id: true } } },
  });
  if (!project) return null;
  if (role === "ADMIN") return project;
  const hasAccess = project.users.some((u) => u.id === userId);
  return hasAccess ? project : null;
}

export async function PUT(request: NextRequest, context: Params) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(COOKIE_NAME)?.value;
    const session = await getSessionFromCookie(token);

    if (!session?.userId) {
      return unauthorized("로그인이 필요합니다.");
    }

    const { projectId } = await context.params;
    const body = await request.json();
    const favorite = typeof body?.favorite === "boolean" ? body.favorite : null;

    if (favorite === null) {
      return badRequest("favorite(true/false) 값이 필요합니다.");
    }

    const project = await ensureProjectAccess(projectId, session.userId, session.role);
    if (!project) {
      return notFound("프로젝트를 찾을 수 없거나 접근 권한이 없습니다.");
    }

    if (favorite) {
      await prisma.userProjectFavorite.upsert({
        where: {
          userId_projectId: { userId: session.userId, projectId },
        },
        create: { userId: session.userId, projectId },
        update: {},
      });
    } else {
      await prisma.userProjectFavorite.deleteMany({
        where: { userId: session.userId, projectId },
      });
    }

    return ok({ favorite });
  } catch (error) {
    return serverError(error);
  }
}
