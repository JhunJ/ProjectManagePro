import { cookies } from "next/headers";
import { ok, notFound } from "@/lib/http";
import { verifyToken, COOKIE_NAME } from "@/lib/session";

export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) {
    return notFound("Not logged in.");
  }
  const session = await verifyToken(token);
  if (!session) {
    return notFound("Invalid or expired session.");
  }
  return ok(session);
}
