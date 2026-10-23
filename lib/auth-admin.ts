/**
 * Пользователи Better Auth без API: перенос с паролей из окружения и сброс пароля (scripts/*).
 * Хеш — штатный hashPassword Better Auth, тот же, что проверяет вход
 */
import { randomBytes } from "node:crypto";
import { and, eq, ne } from "drizzle-orm";
import { hashPassword } from "better-auth/crypto";
import * as s from "./data/postgres/schema.ts";
import type { Db } from "./data/postgres/repos.ts";

export type AuthUser = { id: string; email: string; password: string };
export type AuthUserResult = { id: string; email: string; emailChanged: boolean; password: "задан" | "уже был" };

/** MIGRATE_USERS="vlad:a@x.com,masha:b@x.com" + PASSWORD_VLAD, PASSWORD_MASHA */
export function parseMigrateUsers(raw: string | undefined, env: Record<string, string | undefined>): AuthUser[] {
  const list = (raw ?? "").split(",").map((p) => p.trim()).filter(Boolean).map((pair) => {
    const i = pair.indexOf(":");
    const id = pair.slice(0, i).trim(), email = pair.slice(i + 1).trim().toLowerCase();
    if (i <= 0 || !/^\S+@\S+\.\S+$/.test(email)) throw new Error(`MIGRATE_USERS: «${pair}» — нужно id:email`);
    const password = env[`PASSWORD_${id.toUpperCase()}`];
    if (!password) throw new Error(`Не задан PASSWORD_${id.toUpperCase()}`);
    return { id, email, password };
  });
  if (!list.length) throw new Error('Не задан MIGRATE_USERS, пример: MIGRATE_USERS="vlad:vlad@example.com,masha:masha@example.com"');
  return list;
}

class DryRun extends Error {}

/**
 * Пользователь уже есть в users (перенос данных) — ему ставится email (подтверждён) и пароль.
 * Повторный запуск пароль не трогает: вход с паролем уже есть, его могли сменить в приложении
 */
export async function importAuthUsers(db: Db, list: AuthUser[], opts: { dryRun?: boolean } = {}): Promise<AuthUserResult[]> {
  const out: AuthUserResult[] = [];
  try {
    await db.transaction(async (tx) => {
      for (const u of list) {
        const [row] = await tx.select().from(s.users).where(eq(s.users.id, u.id));
        if (!row) throw new Error(`Пользователя ${u.id} нет в users — сначала перенос данных`);
        const [taken] = await tx.select({ id: s.users.id }).from(s.users).where(and(eq(s.users.email, u.email), ne(s.users.id, u.id)));
        if (taken) throw new Error(`${u.email} уже у пользователя ${taken.id}`);
        const emailChanged = row.email !== u.email || !row.emailVerified;
        if (emailChanged) await tx.update(s.users).set({ email: u.email, emailVerified: true, updatedAt: new Date() }).where(eq(s.users.id, u.id));
        const [acc] = await tx.select({ id: s.authAccounts.id }).from(s.authAccounts)
          .where(and(eq(s.authAccounts.userId, u.id), eq(s.authAccounts.providerId, "credential")));
        if (!acc) {
          await tx.insert(s.authAccounts).values({ id: `credential-${u.id}`, accountId: u.id, providerId: "credential", userId: u.id, password: await hashPassword(u.password) });
        }
        out.push({ id: u.id, email: u.email, emailChanged, password: acc ? "уже был" : "задан" });
      }
      if (opts.dryRun) throw new DryRun();
    });
  } catch (e) {
    if (!(e instanceof DryRun)) throw e;
  }
  return out;
}

/** Временный пароль вместо забытого; все сессии пользователя завершаются */
export async function resetPassword(db: Db, email: string): Promise<{ userId: string; password: string; sessions: number }> {
  const password = randomBytes(12).toString("base64url");
  return db.transaction(async (tx) => {
    const [user] = await tx.select({ id: s.users.id }).from(s.users).where(eq(s.users.email, email.trim().toLowerCase()));
    if (!user) throw new Error(`Нет пользователя с email ${email}`);
    const hash = await hashPassword(password);
    const updated = await tx.update(s.authAccounts).set({ password: hash, updatedAt: new Date() })
      .where(and(eq(s.authAccounts.userId, user.id), eq(s.authAccounts.providerId, "credential"))).returning({ id: s.authAccounts.id });
    if (!updated.length) throw new Error(`У ${email} нет входа по паролю — сначала migrate-users-to-auth`);
    const ended = await tx.delete(s.authSessions).where(eq(s.authSessions.userId, user.id)).returning({ id: s.authSessions.id });
    return { userId: user.id, password, sessions: ended.length };
  });
}
