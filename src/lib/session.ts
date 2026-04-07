import { SignJWT, jwtVerify } from "jose";

const COOKIE_NAME = "session";
const SECRET = new TextEncoder().encode(
  process.env.SESSION_SECRET ?? "projectmanagepro-session-secret"
);
const MAX_AGE = 60 * 60 * 24 * 7; // 7 days

export type SessionPayload = {
  userId: string;
  username: string;
  role: "ADMIN" | "USER";
};

export async function createToken(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(`${MAX_AGE}s`)
    .setIssuedAt()
    .sign(SECRET);
}

export async function verifyToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, SECRET);
    if (
      typeof payload.userId === "string" &&
      typeof payload.username === "string" &&
      (payload.role === "ADMIN" || payload.role === "USER")
    ) {
      return {
        userId: payload.userId,
        username: payload.username,
        role: payload.role,
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function getSessionCookieOptions(expiresAt: Date) {
  // HTTPS 사용 시 .env에 SECURE_COOKIE=true 설정. HTTP 서버에서는 false로 두어 쿠키 유지.
  const secure = process.env.SECURE_COOKIE === "true";
  return {
    httpOnly: true,
    secure,
    sameSite: "lax" as const,
    path: "/",
    maxAge: MAX_AGE,
    expires: expiresAt,
  };
}

export async function getSessionFromCookie(token: string | undefined): Promise<SessionPayload | null> {
  if (!token) return null;
  return verifyToken(token);
}

export { COOKIE_NAME };
