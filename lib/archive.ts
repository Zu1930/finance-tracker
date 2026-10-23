/**
 * Выход из семьи, архив, разбор семейного имущества, восстановление и очистка.
 * Выйти может любой и сразу. Остаётся один — семья распускается: archived, purge_at = +90 дней, все членства
 * former. Каждый уходит в свой solo-бюджет со СВОИМИ личными данными; семейные остаются в архиве (только чтение).
 * Остаётся больше одного — семья живёт, у ушедшего архив до даты выхода.
 */
import { and, asc, eq, inArray, isNotNull, isNull, lt, ne } from "drizzle-orm";
import * as s from "./data/postgres/schema.ts";
import { postgresRepos, type Db } from "./data/postgres/repos.ts";
import type { Ctx } from "./data/types.ts";
import { OWNED, householdNames } from "./family.ts";
import { buildView, parseMonthKey, type RawStore } from "./store.ts";
import type { TrackerData } from "./types.ts";

export const ARCHIVE_DAYS = 90;
type Fail = { ok: false; status: number; error: string };
type Membership = typeof s.memberships.$inferSelect;
type Household = typeof s.households.$inferSelect;

const now = () => new Date();
const T = (db: unknown) => db as Db;

/** Новый solo-бюджет пользователя с валютами прежнего (данные переедут следом) */
async function newSolo(tx: Db, userId: string, from: Household): Promise<string> {
  const id = crypto.randomUUID();
  await tx.insert(s.households).values({
    id, name: "Личный бюджет", kind: "solo", baseCurrency: from.baseCurrency, currencies: from.currencies, rates: from.rates,
    ratesUpdatedAt: from.ratesUpdatedAt, schemaVersion: from.schemaVersion, incomeSourcesSet: from.incomeSourcesSet,
  });
  // Источники дохода — копией: доходы уезжают вместе с автором и ссылаются на них
  const sources = await tx.select().from(s.incomeSources).where(eq(s.incomeSources.householdId, from.id));
  if (sources.length) await tx.insert(s.incomeSources).values(sources.map((x) => ({ ...x, householdId: id })));
  await tx.insert(s.memberships).values({ householdId: id, userId, role: "owner" });
  return id;
}

/**
 * Личное пользователя из бюджета from в to: траты, доходы, которые он вносил, счета, копилки, категории,
 * регулярные (с оплатами — ON UPDATE CASCADE), личные части планов, личные настройки
 */
async function moveOwn(tx: Db, from: string, to: string, userId: string) {
  await tx.update(s.userSettings).set({ householdId: to }).where(and(eq(s.userSettings.householdId, from), eq(s.userSettings.userId, userId)));
  for (const t of [...OWNED, s.monthPlans] as const) await tx.update(t).set({ householdId: to }).where(and(eq(t.householdId, from), eq(t.ownerId, userId)));
  await tx.update(s.incomes).set({ householdId: to }).where(and(eq(s.incomes.householdId, from), eq(s.incomes.authorId, userId)));
  await tx.delete(s.deletedEntries).where(and(eq(s.deletedEntries.householdId, from), eq(s.deletedEntries.ownerId, userId)));
}

async function activeOf(tx: Db, userId: string, forUpdate = false) {
  const q = tx.select({ m: s.memberships, h: s.households }).from(s.memberships).innerJoin(s.households, eq(s.households.id, s.memberships.householdId))
    .where(and(eq(s.memberships.userId, userId), eq(s.memberships.status, "active")));
  const [row] = forUpdate ? await q.for("update") : await q;
  return row ?? null;
}

const activeMembers = (tx: Db, householdId: string) =>
  tx.select().from(s.memberships).where(and(eq(s.memberships.householdId, householdId), eq(s.memberships.status, "active"))).orderBy(asc(s.memberships.joinedAt));

/** Что будет при выходе: распустится ли семья */
export async function leavePreview(db: Db, userId: string): Promise<{ ok: true; dissolves: boolean; others: string[] } | Fail> {
  const cur = await activeOf(db, userId);
  if (!cur || cur.h.kind !== "family") return { ok: false, status: 409, error: "Вы не в семейном бюджете." };
  const others = await db.select({ name: s.users.name }).from(s.memberships).innerJoin(s.users, eq(s.users.id, s.memberships.userId))
    .where(and(eq(s.memberships.householdId, cur.h.id), eq(s.memberships.status, "active"), ne(s.memberships.userId, userId)));
  return { ok: true, dissolves: others.length <= 1, others: others.map((o) => o.name) };
}

/** Выйти из семьи. Возвращает семью (для разбора) и распущена ли она */
export async function leaveFamily(db: Db, userId: string): Promise<{ ok: true; householdId: string; dissolved: boolean } | Fail> {
  return db.transaction(async (raw) => {
    const tx = T(raw);
    const cur = await activeOf(tx, userId, true);
    if (!cur || cur.h.kind !== "family") return { ok: false as const, status: 409, error: "Вы не в семейном бюджете." };
    const F = cur.h;
    const members = await activeMembers(tx, F.id);
    const others = members.filter((m) => m.userId !== userId);
    const at = now(), purgeAt = new Date(at.getTime() + ARCHIVE_DAYS * 86_400_000);
    const leave = async (u: string) => {
      // Сначала освободить действующее членство: у пользователя оно одно
      await tx.update(s.memberships).set({ status: "former", leftAt: at, readonlyUntil: purgeAt, reviewedAt: null, restoreRequestedAt: null })
        .where(and(eq(s.memberships.householdId, F.id), eq(s.memberships.userId, u)));
      await moveOwn(tx, F.id, await newSolo(tx, u, F), u);
    };
    const dissolved = others.length <= 1;
    if (dissolved) {
      await tx.update(s.households).set({ status: "archived", archivedAt: at, purgeAt }).where(eq(s.households.id, F.id));
      for (const m of members) await leave(m.userId);
      await tx.update(s.householdInvites).set({ revokedAt: at }).where(and(eq(s.householdInvites.householdId, F.id), isNull(s.householdInvites.usedAt), isNull(s.householdInvites.revokedAt)));
    } else {
      await leave(userId);
      // Ушёл владелец — владельцем становится тот, кто в семье дольше всех
      if (cur.m.role === "owner") await tx.update(s.memberships).set({ role: "owner" }).where(and(eq(s.memberships.householdId, F.id), eq(s.memberships.userId, others[0].userId)));
    }
    return { ok: true as const, householdId: F.id, dissolved };
  });
}

/** Доступ к архиву: former-членство, срок не вышел. Иначе null — архив как будто не существует */
export async function archiveAccess(db: Db, userId: string, householdId: string): Promise<{ m: Membership; h: Household } | null> {
  const [row] = await db.select({ m: s.memberships, h: s.households }).from(s.memberships).innerJoin(s.households, eq(s.households.id, s.memberships.householdId))
    .where(and(eq(s.memberships.householdId, householdId), eq(s.memberships.userId, userId), eq(s.memberships.status, "former"), isNotNull(s.memberships.readonlyUntil)));
  return row && row.m.readonlyUntil! > now() ? row : null;
}

export type ArchiveItem = {
  householdId: string; name: string; dissolved: boolean; joinedAt: string; leftAt: string; until: string;
  reviewed: boolean; restore: { requested: boolean; waiting: string[]; askedBy: string[] } | null;
};

/** Мои архивы: former-членства с действующим сроком */
export async function archives(db: Db, userId: string): Promise<ArchiveItem[]> {
  const rows = await db.select({ m: s.memberships, h: s.households }).from(s.memberships).innerJoin(s.households, eq(s.households.id, s.memberships.householdId))
    .where(and(eq(s.memberships.userId, userId), eq(s.memberships.status, "former"))).orderBy(asc(s.memberships.leftAt));
  const out: ArchiveItem[] = [];
  for (const { m, h } of rows) {
    if (!m.readonlyUntil || m.readonlyUntil <= now()) continue;
    const dissolved = h.status === "archived";
    let restore: ArchiveItem["restore"] = null;
    if (dissolved && isDissolutionMember(m, h)) {
      const parts = await participants(db, h);
      const waiting = await db.select({ name: s.users.name }).from(s.users)
        .where(inArray(s.users.id, parts.filter((p) => !p.restoreRequestedAt && p.userId !== userId).map((p) => p.userId).concat("")));
      const asked = await db.select({ name: s.users.name }).from(s.users)
        .where(inArray(s.users.id, parts.filter((p) => p.restoreRequestedAt && p.userId !== userId).map((p) => p.userId).concat("")));
      restore = { requested: !!m.restoreRequestedAt, waiting: waiting.map((w) => w.name), askedBy: asked.map((w) => w.name) };
    }
    out.push({ householdId: h.id, name: h.name, dissolved, joinedAt: m.joinedAt.toISOString(), leftAt: m.leftAt!.toISOString(), until: m.readonlyUntil.toISOString(), reviewed: !!m.reviewedAt, restore });
  }
  return out;
}

/** Не пройденный разбор (оставшийся при роспуске видит его при следующем входе) */
export async function pendingReview(db: Db, userId: string): Promise<{ householdId: string; name: string } | null> {
  const rows = await db.select({ m: s.memberships, h: s.households }).from(s.memberships).innerJoin(s.households, eq(s.households.id, s.memberships.householdId))
    .where(and(eq(s.memberships.userId, userId), eq(s.memberships.status, "former"), isNull(s.memberships.reviewedAt)));
  const row = rows.find((r) => r.m.readonlyUntil && r.m.readonlyUntil > now());
  return row ? { householdId: row.h.id, name: row.h.name } : null;
}

export async function markReviewed(db: Db, userId: string, householdId: string): Promise<boolean> {
  if (!(await archiveAccess(db, userId, householdId))) return false;
  await db.update(s.memberships).set({ reviewedAt: now() }).where(and(eq(s.memberships.householdId, householdId), eq(s.memberships.userId, userId)));
  return true;
}

/**
 * Архив для просмотра: только семейное и только до даты выхода. Личного нет ни чьего — ни записей, ни сумм.
 * У живой семьи (ушёл из 3+) счета, планы и регулярные — текущие, поэтому в архив не попадают
 */
export async function archiveRaw(db: Db, userId: string, householdId: string): Promise<{ raw: RawStore; access: { m: Membership; h: Household } } | null> {
  const access = await archiveAccess(db, userId, householdId);
  if (!access) return null;
  const full = await postgresRepos(db).system.familySnapshot(householdId);
  const cutoff = access.m.leftAt!.toISOString().slice(0, 10);
  const hashes: RawStore["hashes"] = {};
  for (const [key, hash] of Object.entries(full.hashes)) {
    const k = parseMonthKey(key);
    if (!k || (k.kind !== "family" && k.kind !== "incomes")) continue;
    hashes[key] = Object.fromEntries(Object.entries(hash).filter(([, e]) => e.date <= cutoff));
  }
  const frozen = access.h.status === "archived";
  const sv = full.savings;
  const raw: RawStore = {
    settings: full.settings, goals: null, userSettings: {}, hashes,
    savings: frozen && sv ? { accounts: sv.accounts, goals: sv.goals, userAccounts: {}, userGoals: {}, recons: sv.recons.filter((r) => r.at.slice(0, 10) <= cutoff) } : undefined,
    plans: frozen && full.plans ? { family: full.plans.family, byUser: {}, familyItems: full.plans.familyItems, userItems: {} } : undefined,
    recurring: frozen && full.recurring ? { family: full.recurring.family, byUser: {} } : undefined,
  };
  return { raw, access };
}

/** Ответ для страниц архива: как /api/data, без партнёра и личного, с пометкой «только чтение» и именами авторов */
export async function archiveView(db: Db, userId: string, householdId: string): Promise<TrackerData | null> {
  const a = await archiveRaw(db, userId, householdId);
  if (!a) return null;
  const names = await householdNames(db, householdId);
  const me = { id: userId, name: names[userId] };
  const view = buildView(a.raw, me, null, a.access.m.leftAt!.toISOString().slice(0, 7));
  delete view.solo;
  view.readonly = { householdId, name: a.access.h.name, until: a.access.m.readonlyUntil!.toISOString(), leftAt: a.access.m.leftAt!.toISOString() };
  view.names = names;
  return view;
}

// ---------- Разбор ----------
export type ReviewView = {
  householdId: string; name: string; dissolved: boolean;
  accounts: { id: string; name: string; currency: string; balance: number; claimedBy: string | null; mine: boolean }[];
  goals: { id: string; name: string; currency: string; target: number; allocated: number }[];
  recurring: { id: string; name: string; currency: string; amount: number; claimedBy: string | null; mine: boolean }[];
  categories: string[];
};

export async function reviewView(db: Db, userId: string, householdId: string): Promise<ReviewView | null> {
  const a = await archiveRaw(db, userId, householdId);
  if (!a) return null;
  const full = await postgresRepos(db).system.familySnapshot(householdId);
  const claims = await db.select({ c: s.claims, name: s.users.name }).from(s.claims).leftJoin(s.users, eq(s.users.id, s.claims.claimedBy))
    .where(eq(s.claims.householdId, householdId));
  const claim = (entity: string, id: string) => claims.find((x) => x.c.entity === entity && x.c.entityId === id);
  const who = (entity: string, id: string) => {
    const c = claim(entity, id);
    return c ? { claimedBy: c.name ?? "Удалённый пользователь", mine: c.c.claimedBy === userId } : { claimedBy: null, mine: false };
  };
  return {
    householdId, name: a.access.h.name, dissolved: a.access.h.status === "archived",
    accounts: Object.values(full.savings?.accounts ?? {}).filter((x) => !x.archived).map((x) => ({ id: x.id, name: x.name, currency: x.currency, balance: x.balance, ...who("account", x.id) })),
    goals: Object.values(full.savings?.goals ?? {}).map((g) => ({ id: g.id, name: g.name, currency: g.currency, target: g.target, allocated: g.allocated })),
    recurring: Object.values(full.recurring?.family ?? {}).filter((p) => !p.endMonth).map((p) => ({ id: p.id, name: p.name, currency: p.currency, amount: p.amounts.at(-1)?.amount ?? 0, ...who("recurring", p.id) })),
    categories: (full.settings?.familyCategories ?? []).filter((c) => !c.archived).map((c) => c.name),
  };
}

type Done = { ok: true } | Fail;
const taken = (name: string | null): Fail => ({ ok: false, status: 409, error: `Уже забрал(а) ${name ?? "другой участник"}.` });

/** Забрать семейный счёт или платёж к себе: копия в моём бюджете, в claims — кто забрал (один на запись) */
export async function claim(db: Db, userId: string, householdId: string, entity: "account" | "recurring", id: string): Promise<Done> {
  return db.transaction(async (raw) => {
    const tx = T(raw);
    if (!(await archiveAccess(tx, userId, householdId))) return { ok: false as const, status: 404, error: "Не найдено." };
    const full = await postgresRepos(tx).system.familySnapshot(householdId);
    const src = entity === "account" ? full.savings?.accounts[id] : full.recurring?.family[id];
    if (!src) return { ok: false as const, status: 404, error: "Не найдено." };
    const got = await tx.insert(s.claims).values({ householdId, entity, entityId: id, claimedBy: userId }).onConflictDoNothing().returning();
    if (!got.length) {
      const [c] = await tx.select({ name: s.users.name }).from(s.claims).leftJoin(s.users, eq(s.users.id, s.claims.claimedBy))
        .where(and(eq(s.claims.householdId, householdId), eq(s.claims.entity, entity), eq(s.claims.entityId, id)));
      return taken(c?.name ?? null);
    }
    const mine = await activeOf(tx, userId);
    const ctx: Ctx = { userId, householdId: mine!.h.id };
    const r = postgresRepos(tx);
    const copyId = crypto.randomUUID();
    if (entity === "account") {
      const a = full.savings!.accounts[id];
      await r.accounts.create(ctx, { ...a, id: copyId, scope: "personal", ownerId: userId, initial: a.balance, updatedAt: now().toISOString(), updatedBy: userId, version: 1 });
    } else {
      const p = full.recurring!.family[id];
      await r.recurring.create(ctx, { ...p, id: copyId, scope: "personal", ownerId: userId, createdBy: userId, version: 1 });
    }
    await tx.update(s.claims).set({ copyId, copyVersion: 1 }).where(and(eq(s.claims.householdId, householdId), eq(s.claims.entity, entity), eq(s.claims.entityId, id)));
    return { ok: true as const };
  });
}

/** Такая же копилка у себя: та же цель, allocated = 0 */
export async function copyGoal(db: Db, userId: string, householdId: string, id: string): Promise<Done> {
  const a = await archiveRaw(db, userId, householdId);
  const g = a && (await postgresRepos(db).system.familySnapshot(householdId)).savings?.goals[id];
  if (!g) return { ok: false, status: 404, error: "Не найдено." };
  const mine = await activeOf(db, userId);
  await postgresRepos(db).goals.create({ userId, householdId: mine!.h.id }, { id: crypto.randomUUID(), name: g.name, target: g.target, currency: g.currency, allocated: 0, scope: "personal", ownerId: userId, ops: [], version: 1 });
  return { ok: true };
}

/** Все семейные категории — в мои личные, без дублей по имени; id сохраняются (на них ссылаются забранные платежи) */
export async function copyCategories(db: Db, userId: string, householdId: string): Promise<{ ok: true; added: number } | Fail> {
  const a = await archiveRaw(db, userId, householdId);
  if (!a) return { ok: false, status: 404, error: "Не найдено." };
  const family = (a.raw.settings?.familyCategories ?? []).filter((c) => !c.archived);
  const r = postgresRepos(db);
  const mine = await activeOf(db, userId);
  const ctx = { userId, householdId: mine!.h.id };
  for (let i = 0; i < 5; i++) {
    const cur = (await r.userSettings.get(ctx)) ?? { personalCategories: [], version: 0 };
    const names = new Set(cur.personalCategories.map((c) => c.name.trim().toLowerCase()));
    const ids = new Set(cur.personalCategories.map((c) => c.id));
    const add = family.filter((c) => !names.has(c.name.trim().toLowerCase())).map(({ history: _, since: __, ...c }) => (ids.has(c.id) ? { ...c, id: crypto.randomUUID() } : c));
    if (!add.length) return { ok: true, added: 0 };
    const { version, ...data } = cur;
    if ((await r.userSettings.put(ctx, version, { ...data, personalCategories: [...cur.personalCategories, ...add] })).ok) return { ok: true, added: add.length };
  }
  return { ok: false, status: 409, error: "Категории изменились, повторите." };
}

// ---------- Восстановление ----------
/** Участник роспуска: вышел в момент роспуска (left_at = archived_at), а не раньше из живой семьи */
const isDissolutionMember = (m: Membership, h: Household) => !!h.archivedAt && m.leftAt?.getTime() === h.archivedAt.getTime();
const participants = async (db: Db, h: Household) =>
  (await db.select().from(s.memberships).where(and(eq(s.memberships.householdId, h.id), eq(s.memberships.status, "former")))).filter((m) => isDissolutionMember(m, h));

export type RestoreResult = { ok: true; restored: false; waiting: number } | { ok: true; restored: true; kept: { userId: string; names: string[] }[] } | Fail;

/**
 * Запрос на восстановление распущенной семьи. Когда попросили все участники роспуска (до purge_at) — восстановление:
 * личное из solo-бюджетов возвращается, solo удаляются; копии «забрать к себе», не менявшиеся после копирования,
 * удаляются, изменённые остаются личными. Если кто-то уже в другой семье — недоступно
 */
export async function requestRestore(db: Db, userId: string, householdId: string): Promise<RestoreResult> {
  return db.transaction(async (raw) => {
    const tx = T(raw);
    const [h] = await tx.select().from(s.households).where(eq(s.households.id, householdId)).for("update");
    const access = h && (await archiveAccess(tx, userId, householdId));
    if (!h || !access || h.status !== "archived" || !isDissolutionMember(access.m, h)) return { ok: false as const, status: 404, error: "Не найдено." };
    if (!h.purgeAt || h.purgeAt <= now()) return { ok: false as const, status: 409, error: "Срок архива истёк." };
    const parts = await participants(tx, h);
    const solos: Record<string, Household> = {};
    for (const p of parts) {
      const cur = await activeOf(tx, p.userId);
      if (!cur || cur.h.kind === "family") return { ok: false as const, status: 409, error: "Восстановление недоступно: кто-то из участников уже в другой семье." };
      if (cur.h.baseCurrency && h.baseCurrency && cur.h.baseCurrency !== h.baseCurrency) {
        return { ok: false as const, status: 409, error: `Восстановление недоступно: валюта лимитов у кого-то из участников уже не ${h.baseCurrency}.` };
      }
      solos[p.userId] = cur.h;
    }
    await tx.update(s.memberships).set({ restoreRequestedAt: now() }).where(and(eq(s.memberships.householdId, householdId), eq(s.memberships.userId, userId)));
    const waiting = parts.filter((p) => p.userId !== userId && !p.restoreRequestedAt).length;
    if (waiting) return { ok: true as const, restored: false as const, waiting };

    const kept: { userId: string; names: string[] }[] = [];
    const claims = await tx.select().from(s.claims).where(eq(s.claims.householdId, householdId));
    for (const p of parts) {
      const S = solos[p.userId].id;
      const names: string[] = [];
      // Копии «забрать к себе»: не менялись — удаляются, менялись — остаются личными
      for (const c of claims.filter((c) => c.claimedBy === p.userId && c.copyId)) {
        const t = c.entity === "account" ? s.accounts : s.recurringPayments;
        const [copy] = await tx.select({ version: t.version, name: t.name }).from(t).where(and(eq(t.householdId, S), eq(t.id, c.copyId!)));
        if (!copy) continue;
        const paid = c.entity === "recurring" && (await tx.select({ id: s.expenses.id }).from(s.expenses).where(and(eq(s.expenses.householdId, S), eq(s.expenses.recurringId, c.copyId!))).limit(1)).length > 0;
        if (copy.version === c.copyVersion && !paid) await tx.delete(t).where(and(eq(t.householdId, S), eq(t.id, c.copyId!)));
        else names.push(copy.name);
      }
      kept.push({ userId: p.userId, names });
      // В solo всё личное; общее solo-бюджета (план дохода, сверки, корзина, источники) в семью не возвращается
      for (const t of OWNED) await tx.update(t).set({ scope: "personal", ownerId: p.userId }).where(and(eq(t.householdId, S), isNull(t.ownerId)));
      await tx.delete(s.monthPlans).where(and(eq(s.monthPlans.householdId, S), isNull(s.monthPlans.ownerId)));
      for (const t of [s.recons, s.deletedEntries, s.incomeSources] as const) await tx.delete(t).where(eq(t.householdId, S));
      await tx.update(s.memberships).set({ status: "former" }).where(and(eq(s.memberships.householdId, S), eq(s.memberships.userId, p.userId)));
      await tx.update(s.memberships).set({ status: "active", leftAt: null, readonlyUntil: null, reviewedAt: null, restoreRequestedAt: null })
        .where(and(eq(s.memberships.householdId, householdId), eq(s.memberships.userId, p.userId)));
      await moveOwn(tx, S, householdId, p.userId);
      await tx.delete(s.memberships).where(eq(s.memberships.householdId, S));
      await tx.delete(s.households).where(eq(s.households.id, S));
    }
    await tx.delete(s.claims).where(eq(s.claims.householdId, householdId));
    await tx.update(s.households).set({ status: "active", archivedAt: null, purgeAt: null }).where(eq(s.households.id, householdId));
    return { ok: true as const, restored: true as const, kept };
  });
}

// ---------- Очистка ----------
/** Удалить распущенные семьи с истёкшим purge_at — всё каскадом (ON DELETE CASCADE от households) */
export async function purgeExpired(db: Db, at = now()): Promise<string[]> {
  const rows = await db.delete(s.households).where(and(eq(s.households.status, "archived"), lt(s.households.purgeAt, at))).returning({ id: s.households.id });
  return rows.map((r) => r.id);
}
