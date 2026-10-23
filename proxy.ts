import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

// /api/auth/* — Better Auth (вход, выход, сессии; без сессии отвечает сам), /api/cron/* проверяет CRON_SECRET,
// /api/quick — токен Быстрой команды (Bearer)
const PUBLIC = new Set(["/login", "/signup", "/check-email", "/forgot-password", "/reset-password", "/privacy", "/api/cron/daily", "/api/quick"]);

/** Быстрая проверка: есть ли cookie сессии. Подпись и срок проверяют route handlers (requireUser) */
export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.has(pathname) || pathname.startsWith("/api/auth/") || getSessionCookie(req)) return NextResponse.next();
  // Приглашение без входа — на вход с возвратом: там же ссылка на регистрацию по этому приглашению
  if (pathname.startsWith("/join/")) return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(pathname)}`, req.url));
  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.redirect(new URL("/login", req.url));
}

export const config = {
  // Иконки и манифест браузер запрашивает без сессии (манифест — даже без cookie): они должны отдаваться всем
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|icon-.*\\.png|apple-icon.png|manifest.webmanifest|sw.js|robots.txt).*)"],
};
