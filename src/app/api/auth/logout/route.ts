import { ok } from "@/lib/http";
import { COOKIE_NAME } from "@/lib/session";

export async function POST() {
  const secure = process.env.SECURE_COOKIE === "true";
  const res = ok({});
  res.cookies.set(COOKIE_NAME, "", {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return res;
}
