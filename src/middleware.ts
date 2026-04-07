import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";

const COOKIE_NAME = "session";
const SECRET = new TextEncoder().encode(
  process.env.SESSION_SECRET ?? "projectmanagepro-session-secret"
);

async function verifySession(token: string): Promise<boolean> {
  try {
    const { payload } = await jwtVerify(token, SECRET);
    return (
      typeof payload.userId === "string" &&
      typeof payload.username === "string" &&
      (payload.role === "ADMIN" || payload.role === "USER")
    );
  } catch {
    return false;
  }
}

const NO_STORE = "private, no-store, no-cache, must-revalidate";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api/auth/login") ||
    pathname === "/login" ||
    pathname.includes(".")
  ) {
    const res = NextResponse.next();
    if (pathname === "/login") {
      res.headers.set("Cache-Control", NO_STORE);
    }
    return res;
  }

  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("from", pathname);
    const res = NextResponse.redirect(loginUrl);
    res.headers.set("Cache-Control", NO_STORE);
    return res;
  }

  const valid = await verifySession(token);
  if (!valid) {
    if (pathname.startsWith("/api/")) {
      const res = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      res.cookies.delete(COOKIE_NAME);
      return res;
    }
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("from", pathname);
    const res = NextResponse.redirect(loginUrl);
    res.cookies.delete(COOKIE_NAME);
    res.headers.set("Cache-Control", NO_STORE);
    return res;
  }

  const res = NextResponse.next();
  res.headers.set("Cache-Control", NO_STORE);
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
