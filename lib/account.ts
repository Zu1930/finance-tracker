/**
 * Аккаунт: экспорт всех своих данных и удаление.
 * Удаление: из семьи — выход по правилам распуска; solo-бюджет и всё личное — удаляются; вход, сессии, токены,
 * подписки — удаляются. Строка users остаётся обезличенной («Удалённый пользователь», без email): на неё ссылаются
 * его записи в семейных бюджетах и архивах — там автор показывается как удалённый пользователь
 */
import { and, eq, isNull } from "drizzle-orm";
import { verifyPassword } from "better-auth/crypto";
import * as s from "./data/postgres/schema.ts";
import { postgresRepos, type Db } from "./data/postgres/repos.ts";
import { archives, archiveView, leaveFamily } from "./archive.ts";
import { householdNames } from "./family.ts";
import { buildView } from "./store.ts";
import { mails, sendMail } from "./mail.ts";

export const DELETED_NAME = "Удалённый пользователь";

/** Всё, что пользователь видит сам: профиль, действующий бюджет (как в приложении), архивы */
export async function exportAll(db: Db, userId: string) {
  const r = postgresRepos(db);
  const [u] = await db.select({ id: s.users.id, name: s.users.name, email: s.users.email, createdAt: s.users.createdAt }).from(s.users).where(eq(s.users.id, userId));
  const householdId = await r.system.ensureHousehold(userId);
  const list = await r.system.members(householdId);
  const view = buildView(await r.store.snapshot({ userId, householdId }), list.find((m) => m.id === userId)!, list.find((m) => m.id !== userId) ?? null);
  view.names = await householdNames(db, householdId);
  const arch = [];
  for (const a of await archives(db, userId)) arch.push({ ...a, data: await archiveView(db, userId, a.householdId) });
  return { exportedAt: new Date().toISOString(), profile: { ...u, createdAt: u.createdAt.toISOString() }, budget: view, archives: arch };
}

export async function deleteAccount(db: Db, userId: string, password: string): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const [acc] = await db.select({ password: s.authAccounts.password }).from(s.authAccounts)
    .where(and(eq(s.authAccounts.userId, userId), eq(s.authAccounts.providerId, "credential")));
  if (!acc?.password || !(await verifyPassword({ hash: acc.password, password }))) return { ok: false, status: 400, error: "Неверный пароль." };
  const [u] = await db.select({ email: s.users.email }).from(s.users).where(eq(s.users.id, userId));

  // В семье — сначала выход по правилам (распуск пары, архив); после него действующий бюджет — свой solo
  const cur = await db.select({ kind: s.households.kind }).from(s.memberships).innerJoin(s.households, eq(s.households.id, s.memberships.householdId))
    .where(and(eq(s.memberships.userId, userId), eq(s.memberships.status, "active")));
  if (cur[0]?.kind === "family") {
    const left = await leaveFamily(db, userId);
    if (!left.ok) return left;
  }
  await db.transaction(async (tx) => {
    const solos = await tx.select({ id: s.memberships.householdId }).from(s.memberships).innerJoin(s.households, eq(s.households.id, s.memberships.householdId))
      .where(and(eq(s.memberships.userId, userId), eq(s.memberships.status, "active"), eq(s.households.kind, "solo")));
    for (const { id } of solos) {
      // Личные настройки ссылаются на членство без каскада — первыми; остальное уходит каскадом от households
      await tx.delete(s.userSettings).where(eq(s.userSettings.householdId, id));
      await tx.delete(s.households).where(eq(s.households.id, id));
    }
    for (const t of [s.authSessions, s.authAccounts, s.apiTokens, s.pushSubscriptions, s.userOnboarding, s.onboardingEvents] as const) await tx.delete(t).where(eq(t.userId, userId));
    if (u?.email) await tx.delete(s.authVerifications).where(eq(s.authVerifications.identifier, u.email));
    await tx.update(s.householdInvites).set({ revokedAt: new Date() }).where(and(eq(s.householdInvites.createdBy, userId), isNull(s.householdInvites.usedAt), isNull(s.householdInvites.revokedAt)));
    await tx.update(s.users).set({ name: DELETED_NAME, email: null, emailVerified: false, image: null, updatedAt: new Date() }).where(eq(s.users.id, userId));
  });
  if (u?.email) await sendMail(mails.accountDeleted(u.email)).catch((e) => console.error("mail", e));
  return { ok: true };
}
