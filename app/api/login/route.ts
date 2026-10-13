import { NextResponse } from "next/server";
import { SESSION_COOKIE, safeEqual, sessionToken } from "@/lib/auth";

export async function POST(req: Request) {
  const expected = await sessionToken();
  if (!expected) {
    return NextResponse.json(
      { error: "На сервере не заданы APP_PASSWORD и SESSION_SECRET." },
      { status: 500 },
    );
  }
  const { password } = (await req.json().catch(() => ({}))) as { password?: unknown };
  if (typeof password !== "string" || !safeEqual(password, process.env.APP_PASSWORD!)) {
    await new Promise((r) => setTimeout(r, 600)); // притормозить перебор
    return NextResponse.json({ error: "Неверный пароль." }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, expected, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return res;
}
