/**
 * Вход — Better Auth (email + пароль), пользователи и сессии в Postgres приложения.
 * Пользователь Better Auth — строка нашей таблицы users, поэтому его id и есть userId в данных.
 * Регистрация: email + пароль + имя, email подтверждается письмом (до этого входа нет). REGISTRATION_MODE=invite
 * (по умолчанию) — нужен код закрытой регистрации или действующая ссылка-приглашение. Turnstile — на регистрации
 * и сбросе пароля, если задан TURNSTILE_SECRET_KEY.
 * Секрет — BETTER_AUTH_SECRET, адрес — BETTER_AUTH_URL (Better Auth читает их сам).
 */
import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { captcha } from "better-auth/plugins";
import { consumeSignupCode, findInvite, registrationMode } from "./codes.ts";
import { mails, sendMail } from "./mail.ts";
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
    emailAndPassword: {
      enabled: true,
      minPasswordLength: MIN_PASSWORD,
      requireEmailVerification: true,
      sendResetPassword: ({ user, url }) => sendMail(mails.reset(user.email, url)),
      resetPasswordTokenExpiresIn: 60 * 60,
      onPasswordReset: ({ user }) => sendMail(mails.passwordChanged(user.email)),
      revokeSessionsOnPasswordReset: true,
    },
    emailVerification: {
      sendVerificationEmail: ({ user, url }) => sendMail(mails.verify(user.email, url)),
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      expiresIn: 60 * 60 * 24,
    },
    databaseHooks: {
      user: {
        create: {
          // Здесь, а не до запроса: на занятый email Better Auth отвечает «успехом» без создания — код не тратится
          before: async (user, ctx) => {
            if (registrationMode() === "open") return;
            const body = (ctx?.body ?? {}) as { signupCode?: unknown; inviteCode?: unknown };
            const ok = typeof body.inviteCode === "string" && body.inviteCode ? !!(await findInvite(db, body.inviteCode))
              : typeof body.signupCode === "string" && body.signupCode ? await consumeSignupCode(db, body.signupCode) : false;
            // Один ответ на любой неверный код: без подсказок, существует ли он
            if (!ok) throw APIError.from("BAD_REQUEST", { code: "SIGNUP_CODE_INVALID", message: "Регистрация недоступна" });
          },
        },
      },
    },
    hooks: {
      after: createAuthMiddleware(async (ctx) => {
        const r = ctx.context.returned as { user?: { email?: string } } | undefined;
        if (ctx.path === "/change-password" && r?.user?.email) await sendMail(mails.passwordChanged(r.user.email)).catch((e) => console.error("mail", e));
      }),
    },
    plugins: process.env.TURNSTILE_SECRET_KEY
      ? [captcha({
          provider: "cloudflare-turnstile",
          secretKey: process.env.TURNSTILE_SECRET_KEY,
          endpoints: ["/sign-up/email", "/request-password-reset"],
          ...(process.env.TURNSTILE_VERIFY_URL && { siteVerifyURLOverride: process.env.TURNSTILE_VERIFY_URL }),
        })]
      : [],
    // Как прежняя cookie: год; срок продлевается при использовании, «последняя активность» сессии — с точностью до часа
    session: { expiresIn: 60 * 60 * 24 * 365, updateAge: 60 * 60 },
    // В базе, а не в памяти: у каждого экземпляра функции Vercel своя память
    rateLimit: { enabled: true, storage: "database", customRules: {
      "/sign-in/email": { window: 60, max: 5 },
      "/sign-up/email": { window: 60, max: 5 },
      "/send-verification-email": { window: 60, max: 1 },
      "/request-password-reset": { window: 60, max: 3 },
    } },
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

/** Контекст по сессии: пользователь и его действующий бюджет. null — нет сессии */
export async function sessionCtx(a: Auth, repos: Repos, headers: Headers): Promise<Ctx | null> {
  const session = await a.api.getSession({ headers });
  if (!session) return null;
  // Сессия есть только у подтверждённого email; нет бюджета — первый вход после регистрации: онбординг в solo
  return { userId: session.user.id, householdId: await repos.system.ensureHousehold(session.user.id) };
}

/** Пользователь запроса для route handlers: полная проверка сессии в базе (proxy.ts смотрит только наличие cookie) */
export const requireUser = (req: Request) => sessionCtx(getAuth(), getRepos(), req.headers);

export const unauthorized = () => Response.json({ error: "unauthorized" }, { status: 401 });

/**
 * Я и партнёр по бюджету — для представления данных (личное партнёра только суммами). В solo партнёра нет.
 * ponytail: в семье из 3+ партнёр — первый из остальных, личные суммы прочих не показываются; разбивка по всем — отдельно
 */
export async function people(ctx: Ctx): Promise<{ me: User; partner: User | null }> {
  const list = await getRepos().system.members(ctx.householdId);
  const me = list.find((u) => u.id === ctx.userId);
  if (!me) throw new Error(`Пользователь ${ctx.userId} не участник бюджета ${ctx.householdId}`);
  return { me, partner: list.find((u) => u.id !== ctx.userId) ?? null };
}
