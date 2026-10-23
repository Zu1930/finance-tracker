/**
 * Семья и приглашения. Приглашение — ссылка /join/<код>, одноразовая, 7 дней; в базе только хеш кода.
 * Принятие — одна транзакция: личные данные solo-бюджета приглашённого переезжают в семью (scope personal,
 * owner — он), его solo-бюджет удаляется. Доходы и сверки solo не переезжают: доходы в семье видны всем
 */
import { and, asc, count, eq, gt, isNull } from "drizzle-orm";
import * as s from "./data/postgres/schema.ts";
import { postgresRepos, type Db } from "./data/postgres/repos.ts";
import type { Ctx } from "./data/types.ts";
import { hashCode, newInviteCode } from "./codes.ts";
import { rebaseStore } from "./rebase.ts";
import { todayStr } from "./utils.ts";

export const MAX_MEMBERS = 6;
export const INVITE_DAYS = 7;
/** Один ответ на неизвестный, использованный, отозванный и истёкший код */
export const INVALID = "Приглашение недействительно";

export type InviteView = { id: string; createdAt: string; expiresAt: string; createdBy: string };
export type FamilyView = {
  kind: "solo" | "family";
  members: { id: string; name: string; role: "owner" | "member"; joinedAt: string }[];
  invites: InviteView[];
};
type Fail = { ok: false; status: number; error: string };

const activeMembers = (db: Db, householdId: string) =>
  db.select({ n: count() }).from(s.memberships).where(and(eq(s.memberships.householdId, householdId), eq(s.memberships.status, "active"))).then((r) => r[0].n);

const liveInvite = (householdId: string) =>
  and(eq(s.householdInvites.householdId, householdId), isNull(s.householdInvites.usedAt), isNull(s.householdInvites.revokedAt), gt(s.householdInvites.expiresAt, new Date()));

/** Участники и действующие приглашения бюджета ctx */
export async function familyInfo(db: Db, ctx: Ctx): Promise<FamilyView> {
  const [h] = await db.select({ kind: s.households.kind }).from(s.households).where(eq(s.households.id, ctx.householdId));
  const members = await db.select({ id: s.users.id, name: s.users.name, role: s.memberships.role, joinedAt: s.memberships.joinedAt })
    .from(s.memberships).innerJoin(s.users, eq(s.users.id, s.memberships.userId))
    .where(and(eq(s.memberships.householdId, ctx.householdId), eq(s.memberships.status, "active"))).orderBy(asc(s.memberships.joinedAt));
  const invites = await db.select({ id: s.householdInvites.id, createdAt: s.householdInvites.createdAt, expiresAt: s.householdInvites.expiresAt, createdBy: s.users.name })
    .from(s.householdInvites).innerJoin(s.users, eq(s.users.id, s.householdInvites.createdBy))
    .where(liveInvite(ctx.householdId)).orderBy(asc(s.householdInvites.createdAt));
  return {
    kind: h.kind,
    members: members.map((m) => ({ ...m, joinedAt: m.joinedAt.toISOString() })),
    invites: invites.map((i) => ({ ...i, createdAt: i.createdAt.toISOString(), expiresAt: i.expiresAt.toISOString() })),
  };
}

/** Имена всех, кто был в бюджете (и ушедших, и удалённых — «Удалённый пользователь»): авторы записей */
export async function householdNames(db: Db, householdId: string): Promise<Record<string, string>> {
  const rows = await db.select({ id: s.users.id, name: s.users.name }).from(s.memberships).innerJoin(s.users, eq(s.users.id, s.memberships.userId))
    .where(eq(s.memberships.householdId, householdId));
  return Object.fromEntries(rows.map((r) => [r.id, r.name]));
}

/** Новое приглашение; код возвращается один раз. Участников вместе с приглашёнными — не больше MAX_MEMBERS */
export async function createInvite(db: Db, ctx: Ctx): Promise<{ ok: true; code: string; invite: InviteView } | Fail> {
  const pending = (await db.select({ n: count() }).from(s.householdInvites).where(liveInvite(ctx.householdId)))[0].n;
  if ((await activeMembers(db, ctx.householdId)) + pending >= MAX_MEMBERS) return { ok: false, status: 409, error: `В семье может быть не больше ${MAX_MEMBERS} участников.` };
  const code = newInviteCode();
  const [row] = await db.insert(s.householdInvites).values({
    id: crypto.randomUUID(), householdId: ctx.householdId, codeHash: hashCode(code), createdBy: ctx.userId,
    expiresAt: new Date(Date.now() + INVITE_DAYS * 86_400_000),
  }).returning();
  const [me] = await db.select({ name: s.users.name }).from(s.users).where(eq(s.users.id, ctx.userId));
  return { ok: true, code, invite: { id: row.id, createdAt: row.createdAt.toISOString(), expiresAt: row.expiresAt.toISOString(), createdBy: me.name } };
}

/** Отозвать приглашение своего бюджета; чужое — как несуществующее */
export const revokeInvite = async (db: Db, ctx: Ctx, id: string) =>
  (await db.update(s.householdInvites).set({ revokedAt: new Date() })
    .where(and(eq(s.householdInvites.id, id), liveInvite(ctx.householdId))).returning({ id: s.householdInvites.id })).length > 0;

type Found = { invite: typeof s.householdInvites.$inferSelect; household: typeof s.households.$inferSelect; mine: typeof s.households.$inferSelect };

/** Приглашение и бюджеты: ошибка — одинаковый отказ или понятная причина (уже в семье, семья заполнена) */
async function check(db: Db, code: string, userId: string, forUpdate: boolean): Promise<Found | Fail> {
  const q = db.select({ invite: s.householdInvites, household: s.households }).from(s.householdInvites)
    .innerJoin(s.households, eq(s.households.id, s.householdInvites.householdId))
    .where(and(eq(s.householdInvites.codeHash, hashCode(code)), isNull(s.householdInvites.usedAt), isNull(s.householdInvites.revokedAt),
      gt(s.householdInvites.expiresAt, new Date()), eq(s.households.status, "active")));
  const [row] = forUpdate ? await q.for("update") : await q;
  if (!row) return { ok: false, status: 404, error: INVALID };
  const [mem] = await db.select({ h: s.households }).from(s.memberships).innerJoin(s.households, eq(s.households.id, s.memberships.householdId))
    .where(and(eq(s.memberships.userId, userId), eq(s.memberships.status, "active")));
  // Уже участник этой семьи — для него ссылка ничего не значит
  if (!mem || mem.h.id === row.household.id) return { ok: false, status: 404, error: INVALID };
  if (mem.h.kind === "family") return { ok: false, status: 409, error: "Вы уже в семейном бюджете. Чтобы принять приглашение, сначала выйдите из него." };
  if ((await activeMembers(db, row.household.id)) >= MAX_MEMBERS) return { ok: false, status: 409, error: `В семье уже ${MAX_MEMBERS} участников.` };
  return { ...row, mine: mem.h };
}

export type InvitePreview = { ok: true; inviter: string; members: number; base: string | null; myBase: string | null; needsRate: boolean };

/** Экран подтверждения: кто приглашает и нужен ли курс (разные базовые валюты) */
export async function previewInvite(db: Db, code: string, userId: string): Promise<InvitePreview | Fail> {
  const f = await check(db, code, userId, false);
  if ("ok" in f) return f;
  const [inviter] = await db.select({ name: s.users.name }).from(s.users).where(eq(s.users.id, f.invite.createdBy));
  const base = f.household.baseCurrency, myBase = f.mine.baseCurrency;
  return { ok: true, inviter: inviter?.name ?? "—", members: await activeMembers(db, f.household.id), base, myBase, needsRate: !!base && !!myBase && base !== myBase };
}

// Таблицы с личными записями (scope + owner_id): переезжают в семью
export const OWNED = [s.categories, s.recurringPayments, s.expenses, s.accounts, s.goals, s.planItems] as const;

/**
 * Принять приглашение. rate — при разных базовых валютах: сколько моей базы стоит 1 единица базы семьи
 * (1 EUR = 117 RSD → 117), как при смене базы
 */
export async function acceptInvite(db: Db, code: string, userId: string, rate?: number): Promise<{ ok: true; householdId: string } | Fail> {
  return db.transaction(async (tx) => {
    const f = await check(tx as unknown as Db, code, userId, true);
    if ("ok" in f) return f;
    const T = f.household.id, S = f.mine.id;
    const r = postgresRepos(tx as unknown as Db);
    const sCtx = { userId, householdId: S }, tCtx = { userId, householdId: T };

    // Разные базы — данные приглашённого пересчитываются в базу семьи тем же механизмом, что смена базы
    const raw = await r.store.snapshot(sCtx);
    const tBase = f.household.baseCurrency;
    if (raw.settings && tBase && raw.settings.base !== tBase) {
      if (!(typeof rate === "number" && Number.isFinite(rate) && rate > 0)) return { ok: false as const, status: 400, error: `Укажите курс: сколько ${raw.settings.base} стоит 1 ${tBase}.` };
      await r.store.replace(sCtx, rebaseStore(raw, { from: raw.settings.base, to: tBase, rate, limitRounding: 0 }, todayStr()));
    }
    const mine = await r.settings.get(sCtx);

    // В solo всё личное; если где-то осталась запись без владельца — она станет его личной, а не семейной
    for (const t of OWNED) await tx.update(t).set({ scope: "personal", ownerId: userId }).where(and(eq(t.householdId, S), isNull(t.ownerId)));
    // Общее solo-бюджета, которому нет места в семье: план дохода, доходы, сверки, корзина, источники
    for (const t of [s.monthPlans] as const) await tx.delete(t).where(and(eq(t.householdId, S), isNull(t.ownerId)));
    for (const t of [s.incomes, s.recons, s.deletedEntries, s.incomeSources] as const) await tx.delete(t).where(eq(t.householdId, S));

    // Членство: solo — освободить (действующее может быть одно), семья — новое
    await tx.update(s.memberships).set({ status: "former", leftAt: new Date() }).where(and(eq(s.memberships.householdId, S), eq(s.memberships.userId, userId)));
    await tx.insert(s.memberships).values({ householdId: T, userId, role: "member" });
    if (f.household.kind === "solo") await tx.update(s.households).set({ kind: "family" }).where(eq(s.households.id, T));

    // Переезд: платежи тянут за собой суммы и свои оплаты (ON UPDATE CASCADE), копилки — операции
    await tx.update(s.userSettings).set({ householdId: T }).where(and(eq(s.userSettings.householdId, S), eq(s.userSettings.userId, userId)));
    for (const t of [...OWNED, s.monthPlans] as const) await tx.update(t).set({ householdId: T }).where(eq(t.householdId, S));

    // Валюты приглашённого — в список семьи (курс известен после пересчёта), настроек семьи нет — берутся его
    if (mine) {
      await r.settings.merge(tCtx, (cur) => {
        if (!cur) return { ...mine, familyCategories: [], version: 0 };
        const add = mine.currencies.filter((c) => !cur.currencies.includes(c));
        if (!add.length) return null;
        return { ...cur, currencies: [...cur.currencies, ...add], rates: { ...Object.fromEntries(add.map((c) => [c, mine.rates[c] ?? null])), ...cur.rates } };
      });
    }

    await tx.delete(s.memberships).where(eq(s.memberships.householdId, S));
    await tx.delete(s.households).where(eq(s.households.id, S));
    await tx.update(s.householdInvites).set({ usedAt: new Date(), usedBy: userId }).where(eq(s.householdInvites.id, f.invite.id));
    return { ok: true as const, householdId: T };
  });
}
