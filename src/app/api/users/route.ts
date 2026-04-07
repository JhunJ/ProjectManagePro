import { NextRequest } from "next/server";
import * as bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { badRequest, ok, serverError, unauthorized } from "@/lib/http";
import { getSessionFromCookie, COOKIE_NAME } from "@/lib/session";

async function requireAdmin() {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  const session = await getSessionFromCookie(token);
  if (!session || session.role !== "ADMIN") {
    return null;
  }
  return session;
}

export async function GET() {
  const session = await requireAdmin();
  if (!session) return unauthorized("Admin only.");
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        username: true,
        role: true,
        createdAt: true,
        projects: { select: { id: true } },
      },
      orderBy: { createdAt: "asc" },
    });
    const list = users.map((u) => ({
      id: u.id,
      username: u.username,
      role: u.role,
      createdAt: u.createdAt,
      projectIds: u.projects.map((p) => p.id),
    }));
    return ok(list);
  } catch (e) {
    return serverError(e);
  }
}

export async function POST(request: NextRequest) {
  const session = await requireAdmin();
  if (!session) return unauthorized("Admin only.");
  try {
    const body = await request.json();
    const username = typeof body?.username === "string" ? body.username.trim() : "";
    const password = typeof body?.password === "string" ? body.password : "";

    if (!username || !password) {
      return badRequest("아이디와 비밀번호를 입력하세요.");
    }
    if (password.length < 4) {
      return badRequest("비밀번호는 4자 이상이어야 합니다.");
    }

    const existing = await prisma.user.findUnique({ where: { username } });
    if (existing) {
      return badRequest("이미 존재하는 아이디입니다.");
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: { username, passwordHash, role: "USER" },
      select: { id: true, username: true, role: true, createdAt: true },
    });
    return ok(user);
  } catch (e) {
    return serverError(e);
  }
}
