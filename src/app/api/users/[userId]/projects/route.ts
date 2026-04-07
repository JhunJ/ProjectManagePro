import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { badRequest, ok, serverError, unauthorized } from "@/lib/http";
import { getSessionFromCookie, COOKIE_NAME } from "@/lib/session";

async function requireAdmin() {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  const session = await getSessionFromCookie(token);
  if (!session || session.role !== "ADMIN") return null;
  return session;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const session = await requireAdmin();
  if (!session) return unauthorized("Admin only.");
  const { userId } = await params;
  if (!userId) return badRequest("userId required.");
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, projects: { select: { id: true } } },
    });
    if (!user) return badRequest("User not found.");
    const projectIds = user.projects.map((p) => p.id);
    return ok(projectIds);
  } catch (e) {
    return serverError(e);
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const session = await requireAdmin();
  if (!session) return unauthorized("Admin only.");
  const { userId } = await params;
  if (!userId) return badRequest("userId required.");
  try {
    const body = await request.json();
    const projectIds = Array.isArray(body?.projectIds)
      ? (body.projectIds as string[]).filter((id) => typeof id === "string")
      : [];
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return badRequest("User not found.");
    const existing = await prisma.project.findMany({
      where: { id: { in: projectIds } },
      select: { id: true },
    });
    const validIds = existing.map((p) => p.id);
    await prisma.user.update({
      where: { id: userId },
      data: { projects: { set: validIds.map((id) => ({ id })) } },
    });
    return ok(validIds);
  } catch (e) {
    return serverError(e);
  }
}
