import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, readSession } from "@/lib/session";

// /api/cron/* проверяет CRON_SECRET сам: у Vercel Cron нет сессии; /api/quick — токен Быстрой команды (Bearer)
const PUBLIC = new Set(["/login", "/api/login", "/api/users", "/api/cron/daily", "/api/quick"]);

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.has(pathname)) return NextResponse.next();

  const value = req.cookies.get(SESSION_COOKIE)?.value ?? "";
  if (value && (await readSession(value))) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.redirect(new URL("/login", req.url));
}

export const config = {
  // Иконки и манифест браузер запрашивает без сессии (манифест — даже без cookie): они должны отдаваться всем
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|icon-.*\\.png|apple-icon.png|manifest.webmanifest|sw.js|robots.txt).*)"],
};
