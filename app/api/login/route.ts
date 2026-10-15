import { NextResponse } from "next/server";
import { SESSION_COOKIE, envCredentials, safeEqual, signSession } from "@/lib/session";

/** Вход: { userId, password } → cookie сессии этого пользователя */
export async function POST(req: Request) {
  const { userId, password } = (await req.json().catch(() => ({}))) as { userId?: unknown; password?: unknown };
  const creds = typeof userId === "string" ? envCredentials(userId) : null;
  if (!creds || typeof password !== "string" || !safeEqual(password, creds.password)) {
    await new Promise((r) => setTimeout(r, 600)); // притормозить перебор
    return NextResponse.json({ error: "Неверный пароль." }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, await signSession(userId as string, creds), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return res;
}
