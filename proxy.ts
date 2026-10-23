import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

// /api/auth/* — Better Auth (вход, выход, сессии; без сессии отвечает сам), /api/cron/* проверяет CRON_SECRET,
// /api/quick — токен Быстрой команды (Bearer)
const PUBLIC = new Set(["/login", "/api/cron/daily", "/api/quick"]);

/** Быстрая проверка: есть ли cookie сессии. Подпись и срок проверяют route handlers (requireUser) */
export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.has(pathname) || pathname.startsWith("/api/auth/") || getSessionCookie(req)) return NextResponse.next();
  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.redirect(new URL("/login", req.url));
}

export const config = {
  // Иконки и манифест браузер запрашивает без сессии (манифест — даже без cookie): они должны отдаваться всем
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|icon-.*\\.png|apple-icon.png|manifest.webmanifest|sw.js|robots.txt).*)"],
};
