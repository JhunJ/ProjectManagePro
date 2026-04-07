import { NextRequest } from "next/server";
import * as bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { badRequest, ok, serverError } from "@/lib/http";
import { createToken, getSessionCookieOptions, COOKIE_NAME } from "@/lib/session";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const username = typeof body?.username === "string" ? body.username.trim() : "";
    const password = typeof body?.password === "string" ? body.password : "";

    if (!username || !password) {
      return badRequest("아이디와 비밀번호를 입력하세요.");
    }

    const user = await prisma.user.findUnique({ where: { username } });
    if (!user) {
      return badRequest("아이디 또는 비밀번호가 올바르지 않습니다.");
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return badRequest("아이디 또는 비밀번호가 올바르지 않습니다.");
    }

    const token = await createToken({
      userId: user.id,
      username: user.username,
      role: user.role,
    });

    const expiresAt = new Date(Date.now() + 60 * 60 * 24 * 7 * 1000);
    const res = ok({ username: user.username, role: user.role });
    res.cookies.set(COOKIE_NAME, token, getSessionCookieOptions(expiresAt));
    return res;
  } catch (e) {
    return serverError(e);
  }
}
