import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";
import { isAdmin } from "@/lib/codes";
import { isSection } from "@/lib/settings-meta";

// /api/auth/* — Better Auth (вход, выход, сессии; без сессии отвечает сам), /api/cron/* проверяет CRON_SECRET,
// /api/quick — токен Быстрой команды (Bearer)
const PUBLIC = new Set(["/login", "/signup", "/check-email", "/forgot-password", "/reset-password", "/privacy", "/api/cron/daily", "/api/quick"]);

// Настоящий 404, а не «мягкий»: страница настроек уже отдаёт ответ, когда доходит до notFound()
const notFound = (req: NextRequest) => NextResponse.rewrite(new URL("/_not-found", req.url), { status: 404 });

/** /settings/<раздел>: неизвестный — 404, beta — только админам, старый /settings/siri — на /settings/input/siri */
async function settingsRoute(req: NextRequest): Promise<NextResponse> {
  const [section, sub, ...rest] = req.nextUrl.pathname.split("/").slice(2);
  if (section === "siri" && !sub) return NextResponse.redirect(new URL("/settings/input/siri", req.url));
  if (!isSection(section) || rest.length || (sub && !(section === "input" && sub === "siri"))) return notFound(req);
  if (section === "beta") {
    const res = await fetch(new URL("/api/auth/get-session", req.url), { headers: { cookie: req.headers.get("cookie") ?? "" } }).catch(() => null);
    const session = (await res?.json().catch(() => null)) as { user?: { id: string } } | null;
    if (!session?.user || !isAdmin(session.user.id)) return notFound(req);
  }
  return NextResponse.next();
}

/** Быстрая проверка: есть ли cookie сессии. Подпись и срок проверяют route handlers (requireUser) */
export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (getSessionCookie(req) && pathname.startsWith("/settings/")) return settingsRoute(req);
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
