/**
 * Вход — Better Auth (email + пароль), пользователи и сессии в Postgres приложения.
 * Пользователь Better Auth — строка нашей таблицы users, поэтому его id и есть userId в данных.
 * Регистрации нет: пользователей создаёт scripts/migrate-users-to-auth.ts.
 * Секрет — BETTER_AUTH_SECRET, адрес — BETTER_AUTH_URL (Better Auth читает их сам).
 */
import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { getDb, getRepos } from "./data/index.ts";
import * as s from "./data/postgres/schema.ts";
import type { Db } from "./data/postgres/repos.ts";
import type { Ctx, Repos } from "./data/types.ts";
import type { User } from "./users.ts";

export const MIN_PASSWORD = 10;

// Preview-деплой Vercel открывается по адресу деплоя и ветки — их Vercel передаёт сам
const previewHosts = [process.env.VERCEL_URL, process.env.VERCEL_BRANCH_URL].filter((h): h is string => !!h);

export function createAuth(db: Db) {
  return betterAuth({
    baseURL: process.env.VERCEL_ENV === "preview" && previewHosts.length ? { allowedHosts: previewHosts, protocol: "https" } : process.env.BETTER_AUTH_URL,
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: { user: s.users, session: s.authSessions, account: s.authAccounts, verification: s.authVerifications, rateLimit: s.authRateLimits },
    }),
    emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: MIN_PASSWORD },
    // Как прежняя cookie: год; срок продлевается при использовании, «последняя активность» сессии — с точностью до часа
    session: { expiresIn: 60 * 60 * 24 * 365, updateAge: 60 * 60 },
    // В базе, а не в памяти: у каждого экземпляра функции Vercel своя память
    rateLimit: { enabled: true, storage: "database", customRules: { "/sign-in/email": { window: 60, max: 5 } } },
    advanced: {
      useSecureCookies: process.env.NODE_ENV === "production",
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax" },
    },
    telemetry: { enabled: false },
  });
}

export type Auth = ReturnType<typeof createAuth>;

let auth: Auth | null = null;
export const getAuth = (): Auth => (auth ??= createAuth(getDb()));

/** Контекст по сессии: пользователь и его бюджет. null — нет сессии или пользователь ни в одном бюджете */
export async function sessionCtx(a: Auth, repos: Repos, headers: Headers): Promise<Ctx | null> {
  const session = await a.api.getSession({ headers });
  if (!session) return null;
  const householdId = await repos.system.householdOf(session.user.id);
  return householdId ? { userId: session.user.id, householdId } : null;
}

/** Пользователь запроса для route handlers: полная проверка сессии в базе (proxy.ts смотрит только наличие cookie) */
export const requireUser = (req: Request) => sessionCtx(getAuth(), getRepos(), req.headers);

export const unauthorized = () => Response.json({ error: "unauthorized" }, { status: 401 });

/** Я и партнёр по бюджету — для представления данных (личное партнёра только суммами) */
export async function people(ctx: Ctx): Promise<{ me: User; partner: User }> {
  const list = await getRepos().system.members(ctx.householdId);
  const me = list.find((u) => u.id === ctx.userId);
  const partner = list.find((u) => u.id !== ctx.userId);
  if (!me || !partner) throw new Error(`Бюджет ${ctx.householdId}: нужны двое участников, сейчас ${list.length}`);
  return { me, partner };
}
