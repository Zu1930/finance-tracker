/**
 * Репозитории на Postgres. Каждый запрос ограничен household_id из ctx, личное — owner_id = ctx.userId.
 * Проверка версий (CAS) — в транзакции с SELECT … FOR UPDATE; документы, которых может ещё не быть
 * (настройки участника, планы месяца), — под advisory-блокировкой по их ключу.
 * Формы объектов совпадают с Redis-реализацией: необязательные поля без значения не попадают в объект.
 */
import { and, asc, desc, eq, gt, gte, inArray, isNull, lt, lte, sql, type SQL } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as s from "./schema.ts";
import { type Change, type Ctx, type Done, type Repos, type StoredSubscription, type Updated } from "../types.ts";
import { planLinkError } from "../../plan.ts";
import { payLinkError, shiftMonth } from "../../recurring.ts";
import { K, parseMonthKey, type RawStore } from "../../store.ts";
import type { TokenRecord } from "../../quick-entry/api.ts";
import type { RawPlans } from "../../plan.ts";
import type { RawSavings } from "../../savings.ts";
import type {
  Account, Category, Expense, Goal, Income, IncomeSource, MonthPlan, MyMonthPlan, PlanItem, Recon, RecurringPayment, Scope, Settings, UserSettings,
} from "../../types.ts";

export type Db = PgDatabase<PgQueryResultHKT, typeof s>;

const r2 = (n: number) => Math.round(n * 100) / 100;
const TRASH_MS = 10 * 60 * 1000;
const APP_VERSION = "push:version";

// ---------- Фильтры ----------
type Owned = { householdId: unknown; scope: unknown; ownerId: unknown };
/** Запись бюджета ctx в разделе scope: семейная — без владельца, личная — только своя */
function own<T extends Owned>(t: T, ctx: Ctx, scope: Scope): SQL {
  const tt = t as unknown as typeof s.accounts;
  return and(
    eq(tt.householdId, ctx.householdId),
    eq(tt.scope, scope),
    scope === "personal" ? eq(tt.ownerId, ctx.userId) : isNull(tt.ownerId),
  )!;
}
const ownerOf = (ctx: Ctx, scope: Scope) => (scope === "personal" ? ctx.userId : null);
const monthRange = (col: typeof s.expenses.date | typeof s.incomes.date, month: string) => and(gte(col, `${month}-01`), lt(col, `${shiftMonth(month, 1)}-01`))!;
/** Транзакционная блокировка по ключу — для документов, строки которых может ещё не быть */
const lock = (tx: Db, key: string) => tx.execute(sql`select pg_advisory_xact_lock(hashtext(${key}))`);

// ---------- Строки ↔ объекты (строки — и для переноса из Redis: lib/data/migrate.ts) ----------
const toCategory = (r: typeof s.categories.$inferSelect): Category => ({
  id: r.id, name: r.name, limit: r.limit,
  ...(r.archived && { archived: true }), ...(r.since && { since: r.since }), ...(r.archivedFrom && { archivedFrom: r.archivedFrom }), ...(r.history && { history: r.history }),
});
export const categoryRows = (ctx: Ctx, list: Category[], ownerId: string | null) =>
  list.map((c, i) => ({
    householdId: ctx.householdId, id: c.id, scope: (ownerId ? "personal" : "family") as Scope, ownerId, name: c.name, limit: r2(c.limit),
    archived: !!c.archived, since: c.since ?? null, archivedFrom: c.archivedFrom ?? null, history: c.history ?? null, sort: i,
  }));

const toExpense = (r: typeof s.expenses.$inferSelect): Expense => ({
  id: r.id, amount: r.amount, currency: r.currency, rate: r.rate, base: r.base, catId: r.categoryId, note: r.note, date: r.date,
  ts: r.ts.getTime(), scope: r.scope, authorId: r.authorId,
  ...(r.planItemId && { planItemId: r.planItemId }), ...(r.recurringId && { recurringId: r.recurringId, recurringMonth: r.recurringMonth! }),
});
export const expenseRow = (householdId: string, e: Expense) => ({
  householdId, id: e.id, authorId: e.authorId, scope: e.scope, ownerId: e.scope === "personal" ? e.authorId : null, categoryId: e.catId,
  amount: r2(e.amount), currency: e.currency, rate: e.rate, base: r2(e.base), date: e.date, note: e.note, ts: new Date(e.ts),
  planItemId: e.planItemId ?? null, recurringId: e.recurringId ?? null, recurringMonth: e.recurringId ? e.recurringMonth ?? null : null,
});
const toIncome = (r: typeof s.incomes.$inferSelect): Income => ({
  id: r.id, amount: r.amount, currency: r.currency, rate: r.rate, base: r.base, sourceId: r.sourceId, note: r.note, date: r.date, ts: r.ts.getTime(), authorId: r.authorId,
});
export const incomeRow = (householdId: string, i: Income) => ({
  householdId, id: i.id, authorId: i.authorId, sourceId: i.sourceId, amount: r2(i.amount), currency: i.currency, rate: i.rate, base: r2(i.base),
  date: i.date, note: i.note, ts: new Date(i.ts),
});

const toAccount = (r: typeof s.accounts.$inferSelect): Account => ({
  id: r.id, name: r.name, currency: r.currency, scope: r.scope, ...(r.ownerId && { ownerId: r.ownerId }), balance: r.balance, initial: r.initial,
  updatedAt: r.updatedAt.toISOString(), updatedBy: r.updatedBy, ...(r.archived && { archived: true }), version: r.version,
});
export const accountRow = (ctx: Ctx, a: Account) => ({
  householdId: ctx.householdId, id: a.id, name: a.name, currency: a.currency, scope: a.scope, ownerId: ownerOf(ctx, a.scope),
  balance: r2(a.balance), initial: r2(a.initial), updatedAt: new Date(a.updatedAt), updatedBy: a.updatedBy, archived: !!a.archived, version: a.version,
});

const toGoal = (r: typeof s.goals.$inferSelect, ops: (typeof s.goalOps.$inferSelect)[]): Goal => ({
  id: r.id, name: r.name, target: r.target, currency: r.currency, allocated: r.allocated, scope: r.scope, ...(r.ownerId && { ownerId: r.ownerId }),
  ops: ops.map((o) => ({ id: o.id, amount: o.amount, date: o.date, ts: o.ts.getTime(), by: o.by })), version: r.version,
});

const toPlanItem = (r: typeof s.planItems.$inferSelect): PlanItem => ({
  id: r.id, month: r.month, name: r.name, amount: r.amount, categoryId: r.categoryId, scope: r.scope, ...(r.ownerId && { ownerId: r.ownerId }),
  createdBy: r.createdBy, expenseIds: r.expenseIds, ...(r.movedFrom && { movedFrom: r.movedFrom }), version: r.version,
});
export const planItemRow = (ctx: Ctx, it: PlanItem) => ({
  householdId: ctx.householdId, id: it.id, month: it.month, name: it.name, amount: r2(it.amount), categoryId: it.categoryId, scope: it.scope,
  ownerId: ownerOf(ctx, it.scope), createdBy: it.createdBy, expenseIds: it.expenseIds, movedFrom: it.movedFrom ?? null, version: it.version,
});

const toRecurring = (r: typeof s.recurringPayments.$inferSelect, amounts: (typeof s.recurringAmounts.$inferSelect)[]): RecurringPayment => ({
  id: r.id, name: r.name, currency: r.currency, approx: r.approx, frequency: r.frequency, day: r.day, ...(r.month !== null && { month: r.month }),
  categoryId: r.categoryId, scope: r.scope, ...(r.ownerId && { ownerId: r.ownerId }), startMonth: r.startMonth, ...(r.endMonth && { endMonth: r.endMonth }),
  paused: r.paused, skips: r.skips, amounts: amounts.map((a) => ({ fromMonth: a.fromMonth, amount: a.amount })), createdBy: r.createdBy, version: r.version,
});
export const recurringRow = (ctx: Ctx, p: RecurringPayment) => ({
  householdId: ctx.householdId, id: p.id, name: p.name, currency: p.currency, approx: p.approx, frequency: p.frequency, day: p.day,
  month: p.frequency === "yearly" ? p.month ?? null : null, categoryId: p.categoryId, scope: p.scope, ownerId: ownerOf(ctx, p.scope),
  startMonth: p.startMonth, endMonth: p.endMonth ?? null, paused: p.paused, skips: p.skips, createdBy: p.createdBy, version: p.version,
});

const toToken = (r: typeof s.apiTokens.$inferSelect): TokenRecord => ({
  name: r.name, hash: r.hash, createdAt: r.createdAt.toISOString(), lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
});
const tokensById = (rows: (typeof s.apiTokens.$inferSelect)[]) => Object.fromEntries(rows.map((r) => [r.id, toToken(r)]));

/** Изменение записи в транзакции: load читает строку с блокировкой, save и del пишут */
async function update<T extends { version: number }>(
  db: Db,
  version: number | undefined,
  change: Change<T>,
  load: (tx: Db) => Promise<T | null>,
  save: (tx: Db, doc: T) => Promise<unknown>,
  del: (tx: Db) => Promise<unknown>,
): Promise<Updated<T>> {
  return db.transaction(async (tx) => {
    const cur = await load(tx);
    if (!cur) return { ok: false, status: 404 };
    if (version !== undefined && cur.version !== version) return { ok: false, status: 409 };
    const next = change(cur);
    if (next && "error" in next) return { ok: false, ...next };
    if (!next) {
      await del(tx);
      return { ok: true, item: null };
    }
    const doc = { ...next, version: cur.version + 1 };
    await save(tx, doc);
    return { ok: true, item: doc };
  });
}

export function postgresRepos(db: Db): Repos {
  // ---------- Чтение ----------
  async function readSettings(tx: Db, ctx: Ctx, forUpdate = false): Promise<{ settings: Settings | null; version: number } | null> {
    const q = tx.select().from(s.households).where(eq(s.households.id, ctx.householdId));
    const [h] = forUpdate ? await q.for("update") : await q;
    if (!h) return null;
    if (!h.baseCurrency) return { settings: null, version: h.version };
    const [cats, sources] = await Promise.all([
      tx.select().from(s.categories).where(and(eq(s.categories.householdId, ctx.householdId), isNull(s.categories.ownerId))).orderBy(asc(s.categories.sort)),
      h.incomeSourcesSet ? tx.select().from(s.incomeSources).where(eq(s.incomeSources.householdId, ctx.householdId)).orderBy(asc(s.incomeSources.sort)) : [],
    ]);
    const settings: Settings = {
      base: h.baseCurrency, currencies: h.currencies, rates: h.rates, familyCategories: cats.map(toCategory),
      ...(h.incomeSourcesSet && { incomeSources: sources.map((x): IncomeSource => ({ id: x.id, name: x.name })) }),
      ...(h.ratesUpdatedAt && { ratesUpdatedAt: h.ratesUpdatedAt }), ...(h.baseHistory && { baseHistory: h.baseHistory }),
      ...(h.schemaVersion !== null && { schemaVersion: h.schemaVersion }), version: h.version,
    };
    return { settings, version: h.version };
  }

  async function readUserSettings(tx: Db, householdId: string, userId: string): Promise<UserSettings | null> {
    const [row] = await tx.select().from(s.userSettings).where(and(eq(s.userSettings.householdId, householdId), eq(s.userSettings.userId, userId)));
    if (!row) return null;
    const cats = await tx.select().from(s.categories)
      .where(and(eq(s.categories.householdId, householdId), eq(s.categories.ownerId, userId))).orderBy(asc(s.categories.sort));
    return {
      personalCategories: cats.map(toCategory), ...(row.preferredCurrency && { preferredCurrency: row.preferredCurrency }),
      ...(row.hideQuickEntry && { hideQuickEntry: true }), version: row.version,
    };
  }

  /** Действующие участники: личное ушедших не читается и не пишется */
  async function members(tx: Db, householdId: string): Promise<string[]> {
    const rows = await tx.select({ userId: s.memberships.userId }).from(s.memberships)
      .where(and(eq(s.memberships.householdId, householdId), eq(s.memberships.status, "active"))).orderBy(asc(s.memberships.joinedAt), asc(s.memberships.userId));
    return rows.map((r) => r.userId);
  }

  const goalsWithOps = async (tx: Db, rows: (typeof s.goals.$inferSelect)[], householdId: string) => {
    if (!rows.length) return [];
    const ops = await tx.select().from(s.goalOps)
      .where(and(eq(s.goalOps.householdId, householdId), inArray(s.goalOps.goalId, rows.map((g) => g.id)))).orderBy(asc(s.goalOps.pos));
    return rows.map((g) => toGoal(g, ops.filter((o) => o.goalId === g.id)));
  };
  const paymentsWithAmounts = async (tx: Db, rows: (typeof s.recurringPayments.$inferSelect)[], householdId: string) => {
    if (!rows.length) return [];
    const amounts = await tx.select().from(s.recurringAmounts)
      .where(and(eq(s.recurringAmounts.householdId, householdId), inArray(s.recurringAmounts.paymentId, rows.map((p) => p.id))))
      .orderBy(asc(s.recurringAmounts.fromMonth));
    return rows.map((p) => toRecurring(p, amounts.filter((a) => a.paymentId === p.id)));
  };

  async function loadGoal(tx: Db, ctx: Ctx, scope: Scope, id: string): Promise<Goal | null> {
    const [g] = await tx.select().from(s.goals).where(and(own(s.goals, ctx, scope), eq(s.goals.id, id))).for("update");
    return g ? (await goalsWithOps(tx, [g], ctx.householdId))[0] : null;
  }
  async function loadPayment(tx: Db, ctx: Ctx, scope: Scope, id: string, forUpdate: boolean): Promise<RecurringPayment | null> {
    const q = tx.select().from(s.recurringPayments).where(and(own(s.recurringPayments, ctx, scope), eq(s.recurringPayments.id, id)));
    const [p] = forUpdate ? await q.for("update") : await q;
    return p ? (await paymentsWithAmounts(tx, [p], ctx.householdId))[0] : null;
  }

  // ---------- Запись ----------
  async function writeGoal(tx: Db, ctx: Ctx, g: Goal) {
    const row = { householdId: ctx.householdId, id: g.id, name: g.name, target: r2(g.target), currency: g.currency, allocated: r2(g.allocated), scope: g.scope, ownerId: ownerOf(ctx, g.scope), version: g.version };
    await tx.update(s.goals).set(row).where(and(own(s.goals, ctx, g.scope), eq(s.goals.id, g.id)));
    await tx.delete(s.goalOps).where(and(eq(s.goalOps.householdId, ctx.householdId), eq(s.goalOps.goalId, g.id)));
    if (g.ops.length) {
      await tx.insert(s.goalOps).values(g.ops.map((o, pos) => ({ householdId: ctx.householdId, goalId: g.id, id: o.id, pos, amount: r2(o.amount), date: o.date, ts: new Date(o.ts), by: o.by })));
    }
  }
  async function writeAmounts(tx: Db, ctx: Ctx, p: RecurringPayment) {
    await tx.delete(s.recurringAmounts).where(and(eq(s.recurringAmounts.householdId, ctx.householdId), eq(s.recurringAmounts.paymentId, p.id)));
    if (p.amounts.length) {
      await tx.insert(s.recurringAmounts).values(p.amounts.map((a) => ({ householdId: ctx.householdId, paymentId: p.id, fromMonth: a.fromMonth, amount: r2(a.amount) })));
    }
  }

  /** Трата с таким id: своя (тот же раздел и владелец) — повтор; чужая — id занят */
  async function existing(tx: Db, ctx: Ctx, e: Expense): Promise<"mine" | "taken" | null> {
    const [row] = await tx.select({ scope: s.expenses.scope, ownerId: s.expenses.ownerId }).from(s.expenses)
      .where(and(eq(s.expenses.householdId, ctx.householdId), eq(s.expenses.id, e.id)));
    if (!row) return null;
    return row.scope === e.scope && row.ownerId === ownerOf(ctx, e.scope) ? "mine" : "taken";
  }

  /**
   * Запись траты как в Redis (HSET — повтор перезаписывает). Строка с тем же id в чужом разделе не трогается:
   * в Redis это были бы разные хеши, здесь — отказ
   */
  async function putExpense(tx: Db, ctx: Ctx, e: Expense) {
    if (e.scope === "personal" && e.authorId !== ctx.userId) throw new Error("Личная трата пишется только от имени автора");
    const row = expenseRow(ctx.householdId, e);
    const done = await tx.insert(s.expenses).values(row)
      .onConflictDoUpdate({
        target: [s.expenses.householdId, s.expenses.id],
        set: { ...row },
        setWhere: and(eq(s.expenses.scope, row.scope), row.ownerId ? eq(s.expenses.ownerId, row.ownerId) : isNull(s.expenses.ownerId)),
      })
      .returning({ id: s.expenses.id });
    if (!done.length) throw new Error(`Трата ${e.id} уже есть в другом разделе`);
  }
  async function putIncome(tx: Db, ctx: Ctx, i: Income) {
    const row = incomeRow(ctx.householdId, i);
    await tx.insert(s.incomes).values(row).onConflictDoUpdate({ target: [s.incomes.householdId, s.incomes.id], set: { ...row } });
  }

  /** Связать трату с пунктом плана или отвязать; пункт ищется в разделе и месяце траты у её автора */
  async function setPlanLink(tx: Db, householdId: string, e: Expense, add: boolean) {
    if (!e.planItemId) return;
    const ids = add ? sql`array_append(array_remove(${s.planItems.expenseIds}, ${e.id}), ${e.id})` : sql`array_remove(${s.planItems.expenseIds}, ${e.id})`;
    await tx.update(s.planItems)
      .set({ expenseIds: ids, version: sql`${s.planItems.version} + 1` })
      .where(and(
        own(s.planItems, { householdId, userId: e.authorId }, e.scope),
        eq(s.planItems.id, e.planItemId), eq(s.planItems.month, e.date.slice(0, 7)),
      ));
  }

  async function trash(tx: Db, ctx: Ctx, kind: "expense" | "income", entry: Expense | Income, ownerId: string | null) {
    await tx.delete(s.deletedEntries).where(lt(s.deletedEntries.expiresAt, new Date()));
    const row = { householdId: ctx.householdId, id: entry.id, kind, ownerId, entry, expiresAt: new Date(Date.now() + TRASH_MS) };
    await tx.insert(s.deletedEntries).values(row).onConflictDoUpdate({ target: [s.deletedEntries.householdId, s.deletedEntries.id], set: row });
  }

  /** Документ версии expected: настройки бюджета */
  async function putSettings(tx: Db, ctx: Ctx, data: Omit<Settings, "version">, version: number) {
    await tx.update(s.households).set({
      baseCurrency: data.base, currencies: data.currencies, rates: data.rates, ratesUpdatedAt: data.ratesUpdatedAt ?? null,
      baseHistory: data.baseHistory ?? null, incomeSourcesSet: !!data.incomeSources, schemaVersion: data.schemaVersion ?? null, version,
    }).where(eq(s.households.id, ctx.householdId));
    await tx.delete(s.categories).where(and(eq(s.categories.householdId, ctx.householdId), isNull(s.categories.ownerId)));
    if (data.familyCategories.length) await tx.insert(s.categories).values(categoryRows(ctx, data.familyCategories, null));
    await tx.delete(s.incomeSources).where(eq(s.incomeSources.householdId, ctx.householdId));
    if (data.incomeSources?.length) {
      await tx.insert(s.incomeSources).values(data.incomeSources.map((x, sort) => ({ householdId: ctx.householdId, id: x.id, name: x.name, sort })));
    }
  }
  async function putUserSettings(tx: Db, ctx: Ctx, data: Omit<UserSettings, "version">, version: number) {
    const row = { householdId: ctx.householdId, userId: ctx.userId, preferredCurrency: data.preferredCurrency ?? null, hideQuickEntry: !!data.hideQuickEntry, version };
    await tx.insert(s.userSettings).values(row).onConflictDoUpdate({ target: [s.userSettings.householdId, s.userSettings.userId], set: row });
    await tx.delete(s.categories).where(and(eq(s.categories.householdId, ctx.householdId), eq(s.categories.ownerId, ctx.userId)));
    if (data.personalCategories.length) await tx.insert(s.categories).values(categoryRows(ctx, data.personalCategories, ctx.userId));
  }
  /** План месяца: семейный (ownerId null) или личный */
  async function putPlan(tx: Db, ctx: Ctx, month: string, ownerId: string | null, data: { limitOverrides: Record<string, number>; incomeOverride?: number | null }, version: number) {
    const where = and(eq(s.monthPlans.householdId, ctx.householdId), eq(s.monthPlans.month, month), ownerId ? eq(s.monthPlans.ownerId, ownerId) : isNull(s.monthPlans.ownerId));
    const row = { householdId: ctx.householdId, month, ownerId, incomeOverride: ownerId ? null : data.incomeOverride ?? null, limitOverrides: data.limitOverrides, version };
    const done = await tx.update(s.monthPlans).set(row).where(where).returning({ v: s.monthPlans.version });
    if (!done.length) await tx.insert(s.monthPlans).values(row);
  }
  async function planVersion(tx: Db, ctx: Ctx, month: string, ownerId: string | null): Promise<number> {
    const [row] = await tx.select({ v: s.monthPlans.version }).from(s.monthPlans)
      .where(and(eq(s.monthPlans.householdId, ctx.householdId), eq(s.monthPlans.month, month), ownerId ? eq(s.monthPlans.ownerId, ownerId) : isNull(s.monthPlans.ownerId)));
    return row?.v ?? 0;
  }

  /** Хранилище бюджета в форме RawStore (ключи Redis — так его понимает buildView) */
  async function readRaw(tx: Db, ctx: Ctx, userIds: string[]): Promise<RawStore> {
    const h = ctx.householdId;
    const [settings, userSettings, expenses, incomes, accounts, goals, recons, plans, items, payments] = await Promise.all([
      readSettings(tx, ctx),
      Promise.all(userIds.map((u) => readUserSettings(tx, h, u))),
      tx.select().from(s.expenses).where(eq(s.expenses.householdId, h)),
      tx.select().from(s.incomes).where(eq(s.incomes.householdId, h)),
      tx.select().from(s.accounts).where(eq(s.accounts.householdId, h)),
      tx.select().from(s.goals).where(eq(s.goals.householdId, h)).then((rows) => goalsWithOps(tx, rows, h)),
      tx.select().from(s.recons).where(eq(s.recons.householdId, h)).orderBy(asc(s.recons.at), asc(s.recons.id)),
      tx.select().from(s.monthPlans).where(eq(s.monthPlans.householdId, h)),
      tx.select().from(s.planItems).where(eq(s.planItems.householdId, h)),
      tx.select().from(s.recurringPayments).where(eq(s.recurringPayments.householdId, h)).then((rows) => paymentsWithAmounts(tx, rows, h)),
    ]);
    // Хеши месяцев под ключами Redis: так их понимает buildView
    const hashes: RawStore["hashes"] = {};
    const put = (key: string, x: Expense | Income) => ((hashes[key] ??= {})[x.id] = x);
    for (const r of expenses) put(r.ownerId ? K.personal(r.ownerId, r.date.slice(0, 7)) : K.family(r.date.slice(0, 7)), toExpense(r));
    for (const r of incomes) put(K.incomes(r.date.slice(0, 7)), toIncome(r));

    const byUser = <T>(f: () => T) => Object.fromEntries(userIds.map((u) => [u, f()])) as Record<string, T>;
    const savings: RawSavings = { accounts: {}, goals: {}, userAccounts: byUser(() => ({})), userGoals: byUser(() => ({})), recons: recons.map((r) => r.snapshot as Recon) };
    for (const r of accounts) (r.ownerId ? (savings.userAccounts[r.ownerId] ??= {}) : savings.accounts)[r.id] = toAccount(r);
    for (const g of goals) (g.ownerId ? (savings.userGoals[g.ownerId] ??= {}) : savings.goals)[g.id] = g;

    const raw: RawPlans = { family: {}, byUser: {}, familyItems: {}, userItems: {} };
    for (const p of plans) {
      if (!p.ownerId) raw.family[p.month] = { month: p.month, incomeOverride: p.incomeOverride, limitOverrides: p.limitOverrides, version: p.version } satisfies MonthPlan;
      else (raw.byUser[p.ownerId] ??= {})[p.month] = { month: p.month, limitOverrides: p.limitOverrides, version: p.version } satisfies MyMonthPlan;
    }
    for (const r of items) {
      const it = toPlanItem(r);
      if (!r.ownerId) (raw.familyItems[r.month] ??= {})[r.id] = it;
      else ((raw.userItems[r.ownerId] ??= {})[r.month] ??= {})[r.id] = it;
    }
    const recurring = { family: {} as Record<string, RecurringPayment>, byUser: byUser(() => ({}) as Record<string, RecurringPayment>) };
    for (const p of payments) (p.ownerId ? (recurring.byUser[p.ownerId] ??= {}) : recurring.family)[p.id] = p;

    return {
      settings: settings?.settings ?? null,
      goals: null,
      userSettings: Object.fromEntries(userIds.map((u, i) => [u, userSettings[i]])),
      hashes,
      savings,
      plans: raw,
      recurring,
    } satisfies RawStore;
  }

  const repos: Repos = {
    settings: {
      get: async (ctx) => (await readSettings(db, ctx))?.settings ?? null,
      put: (ctx, expected, data) =>
        db.transaction(async (tx) => {
          const cur = await readSettings(tx, ctx, true);
          if (!cur) throw new Error(`Нет бюджета ${ctx.householdId}`);
          if (cur.version !== expected) return { ok: false, version: cur.version };
          await putSettings(tx, ctx, data, expected + 1);
          return { ok: true, version: expected + 1 };
        }),
      async merge(ctx, change) {
        for (let i = 0; i < 5; i++) {
          const cur = await repos.settings.get(ctx);
          const next = change(cur);
          if (!next) return cur;
          const res = await repos.settings.put(ctx, cur?.version ?? 0, next);
          if (res.ok) return { ...next, version: res.version };
        }
        throw new Error("Не удалось записать настройки: слишком много одновременных изменений");
      },
    },

    userSettings: {
      get: (ctx) => readUserSettings(db, ctx.householdId, ctx.userId),
      put: (ctx, expected, data) =>
        db.transaction(async (tx) => {
          await lock(tx, `user-settings:${ctx.householdId}:${ctx.userId}`);
          const cur = (await readUserSettings(tx, ctx.householdId, ctx.userId))?.version ?? 0;
          if (cur !== expected) return { ok: false, version: cur };
          await putUserSettings(tx, ctx, data, expected + 1);
          return { ok: true, version: expected + 1 };
        }),
    },

    categories: {
      async list(ctx) {
        const rows = await db.select().from(s.categories)
          .where(and(eq(s.categories.householdId, ctx.householdId), sql`(${s.categories.ownerId} IS NULL OR ${s.categories.ownerId} = ${ctx.userId})`))
          .orderBy(asc(s.categories.sort));
        return { family: rows.filter((r) => !r.ownerId).map(toCategory), mine: rows.filter((r) => r.ownerId).map(toCategory) };
      },
    },

    expenses: {
      add: (ctx, e) => db.transaction((tx) => putExpense(tx, ctx, e)),

      addForPlan: (ctx, e) =>
        db.transaction(async (tx): Promise<Done> => {
          // Повтор из офлайн-очереди: запись уже есть — второй раз не связываем
          const ex = await existing(tx, ctx, e);
          if (ex === "mine") return { ok: true };
          if (ex === "taken") return { ok: false, status: 409, error: "Запись с таким id уже есть." };
          const [row] = await tx.select().from(s.planItems)
            .where(and(own(s.planItems, ctx, e.scope), eq(s.planItems.id, e.planItemId!), eq(s.planItems.month, e.date.slice(0, 7)))).for("update");
          const item = row ? toPlanItem(row) : null;
          const err = planLinkError(item, e);
          if (err) return { ok: false, status: 400, error: err };
          await putExpense(tx, ctx, e);
          await setPlanLink(tx, ctx.householdId, e, true);
          return { ok: true };
        }),

      addForRecurring: (ctx, e) =>
        db.transaction(async (tx): Promise<Done> => {
          const ex = await existing(tx, ctx, e);
          if (ex === "mine") return { ok: true };
          if (ex === "taken") return { ok: false, status: 409, error: "Запись с таким id уже есть." };
          // Блокировка платежа: из двух одновременных оплат одного месяца вторая увидит первую
          const p = await loadPayment(tx, ctx, e.scope, e.recurringId!, true);
          const [paid] = p
            ? await tx.select({ id: s.expenses.id }).from(s.expenses)
              .where(and(eq(s.expenses.householdId, ctx.householdId), eq(s.expenses.recurringId, p.id), eq(s.expenses.recurringMonth, e.recurringMonth!)))
            : [];
          const err = payLinkError(p, e, !!paid);
          if (err) return { ok: false, ...err };
          await putExpense(tx, ctx, e);
          await tx.update(s.recurringPayments).set({ version: p!.version + 1 })
            .where(and(own(s.recurringPayments, ctx, e.scope), eq(s.recurringPayments.id, p!.id)));
          return { ok: true };
        }),

      remove: (ctx, scope, month, id) =>
        db.transaction(async (tx) => {
          const [row] = await tx.delete(s.expenses)
            .where(and(own(s.expenses, ctx, scope), eq(s.expenses.id, id), monthRange(s.expenses.date, month)))
            .returning();
          if (!row) return null;
          const e = toExpense(row);
          await trash(tx, ctx, "expense", e, row.ownerId);
          await setPlanLink(tx, ctx.householdId, e, false);
          return e;
        }),

      inMonth: async (ctx, scope, month) =>
        (await db.select().from(s.expenses).where(and(own(s.expenses, ctx, scope), monthRange(s.expenses.date, month)))).map(toExpense),
    },

    incomes: {
      add: (ctx, i) => db.transaction((tx) => putIncome(tx, ctx, i)),
      remove: (ctx, month, id) =>
        db.transaction(async (tx) => {
          const [row] = await tx.delete(s.incomes)
            .where(and(eq(s.incomes.householdId, ctx.householdId), eq(s.incomes.id, id), monthRange(s.incomes.date, month))).returning();
          if (!row) return null;
          const i = toIncome(row);
          await trash(tx, ctx, "income", i, null);
          return i;
        }),
    },

    trash: {
      restore: (ctx, id) =>
        db.transaction(async (tx) => {
          const [row] = await tx.select().from(s.deletedEntries)
            .where(and(eq(s.deletedEntries.householdId, ctx.householdId), eq(s.deletedEntries.id, id), gt(s.deletedEntries.expiresAt, new Date()))).for("update");
          if (!row) return { ok: false, status: 404 as const };
          // Личную запись может вернуть только её автор: удалить её мог только он же
          if (row.ownerId && row.ownerId !== ctx.userId) return { ok: false, status: 403 as const };
          if (row.kind === "income") await putIncome(tx, ctx, row.entry as Income);
          else {
            const e = row.entry as Expense;
            await putExpense(tx, { householdId: ctx.householdId, userId: e.authorId }, e);
            await setPlanLink(tx, ctx.householdId, e, true);
          }
          await tx.delete(s.deletedEntries).where(and(eq(s.deletedEntries.householdId, ctx.householdId), eq(s.deletedEntries.id, id)));
          return { ok: true, entry: row.entry as Expense | Income };
        }),
    },

    accounts: {
      create: async (ctx, a) => (await db.insert(s.accounts).values(accountRow(ctx, a)).onConflictDoNothing().returning({ id: s.accounts.id })).length > 0,
      update: (ctx, scope, id, version, change) => {
        const where = and(own(s.accounts, ctx, scope), eq(s.accounts.id, id));
        return update<Account>(db, version, change,
          async (tx) => { const [r] = await tx.select().from(s.accounts).where(where).for("update"); return r ? toAccount(r) : null; },
          (tx, a) => tx.update(s.accounts).set(accountRow(ctx, a)).where(where),
          (tx) => tx.delete(s.accounts).where(where));
      },
    },

    goals: {
      create: (ctx, g) =>
        db.transaction(async (tx) => {
          const row = { householdId: ctx.householdId, id: g.id, name: g.name, target: r2(g.target), currency: g.currency, allocated: r2(g.allocated), scope: g.scope, ownerId: ownerOf(ctx, g.scope), version: g.version };
          if (!(await tx.insert(s.goals).values(row).onConflictDoNothing().returning({ id: s.goals.id })).length) return false;
          await writeGoal(tx, ctx, g);
          return true;
        }),
      update: (ctx, scope, id, version, change) =>
        update<Goal>(db, version, change, (tx) => loadGoal(tx, ctx, scope, id), (tx, g) => writeGoal(tx, ctx, g),
          (tx) => tx.delete(s.goals).where(and(own(s.goals, ctx, scope), eq(s.goals.id, id)))),
    },

    recons: {
      add: (ctx, recon, seen, changed, count) =>
        db.transaction(async (tx) => {
          // Блокировка бюджета упорядочивает сверки: снимок добавляется, только если их всё ещё count
          await tx.select({ id: s.households.id }).from(s.households).where(eq(s.households.id, ctx.householdId)).for("update");
          const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(s.recons).where(eq(s.recons.householdId, ctx.householdId));
          if (n !== count) return false;
          const ids = seen.map((a) => a.id);
          const cur = ids.length
            ? await tx.select({ id: s.accounts.id, version: s.accounts.version }).from(s.accounts)
              .where(and(eq(s.accounts.householdId, ctx.householdId), inArray(s.accounts.id, ids))).for("update")
            : [];
          const versions = new Map(cur.map((a) => [a.id, a.version]));
          if (seen.some((a) => versions.get(a.id) !== a.version)) return false;
          for (const a of changed) {
            // Сверка меняет только семейные и свои личные счета
            const done = await tx.update(s.accounts).set(accountRow(ctx, a))
              .where(and(own(s.accounts, ctx, a.scope), eq(s.accounts.id, a.id), eq(s.accounts.version, a.version - 1))).returning({ id: s.accounts.id });
            if (!done.length) throw new Error(`Счёт ${a.id} нельзя изменить сверкой`);
          }
          await tx.insert(s.recons).values({
            householdId: ctx.householdId, id: recon.id, at: new Date(recon.at), day: recon.day, by: recon.by, snapshot: recon,
            totalAll: r2(recon.totals.all), totalFamily: r2(recon.totals.family),
          });
          return true;
        }),
    },

    plans: {
      putFamily: (ctx, month, expected, data) =>
        db.transaction(async (tx) => {
          await lock(tx, `plan:${ctx.householdId}:${month}`);
          const cur = await planVersion(tx, ctx, month, null);
          if (cur !== expected) return { ok: false, version: cur };
          await putPlan(tx, ctx, month, null, data, expected + 1);
          return { ok: true, version: expected + 1 };
        }),
      putMine: (ctx, month, expected, data) =>
        db.transaction(async (tx) => {
          await lock(tx, `plan:${ctx.householdId}:${month}:${ctx.userId}`);
          const cur = await planVersion(tx, ctx, month, ctx.userId);
          if (cur !== expected) return { ok: false, version: cur };
          await putPlan(tx, ctx, month, ctx.userId, data, expected + 1);
          return { ok: true, version: expected + 1 };
        }),
    },

    planItems: {
      create: async (ctx, item) => (await db.insert(s.planItems).values(planItemRow(ctx, item)).onConflictDoNothing().returning({ id: s.planItems.id })).length > 0,
      async get(ctx, scope, month, id) {
        const [r] = await db.select().from(s.planItems).where(and(own(s.planItems, ctx, scope), eq(s.planItems.id, id), eq(s.planItems.month, month)));
        return r ? toPlanItem(r) : null;
      },
      update: (ctx, scope, month, id, version, change) => {
        const where = and(own(s.planItems, ctx, scope), eq(s.planItems.id, id), eq(s.planItems.month, month));
        return update<PlanItem>(db, version, change,
          async (tx) => { const [r] = await tx.select().from(s.planItems).where(where).for("update"); return r ? toPlanItem(r) : null; },
          (tx, it) => tx.update(s.planItems).set(planItemRow(ctx, it)).where(where),
          (tx) => tx.delete(s.planItems).where(where));
      },
      move: async (ctx, cur, moved) =>
        (await db.update(s.planItems).set(planItemRow(ctx, moved))
          .where(and(own(s.planItems, ctx, cur.scope), eq(s.planItems.id, cur.id), eq(s.planItems.month, cur.month), eq(s.planItems.version, cur.version)))
          .returning({ id: s.planItems.id })).length > 0,
    },

    recurring: {
      get: (ctx, scope, id) => loadPayment(db, ctx, scope, id, false),
      create: (ctx, p) =>
        db.transaction(async (tx) => {
          if (!(await tx.insert(s.recurringPayments).values(recurringRow(ctx, p)).onConflictDoNothing().returning({ id: s.recurringPayments.id })).length) return false;
          await writeAmounts(tx, ctx, p);
          return true;
        }),
      update: (ctx, scope, id, version, change) => {
        const where = and(own(s.recurringPayments, ctx, scope), eq(s.recurringPayments.id, id));
        return update<RecurringPayment>(db, version, change, (tx) => loadPayment(tx, ctx, scope, id, true),
          async (tx, p) => { await tx.update(s.recurringPayments).set(recurringRow(ctx, p)).where(where); await writeAmounts(tx, ctx, p); },
          (tx) => tx.delete(s.recurringPayments).where(where));
      },
    },

    apiTokens: {
      list: async (ctx) => tokensById(await db.select().from(s.apiTokens).where(eq(s.apiTokens.userId, ctx.userId))),
      add: async (ctx, id, rec) =>
        void (await db.insert(s.apiTokens).values({
          id, userId: ctx.userId, name: rec.name, hash: rec.hash, createdAt: new Date(rec.createdAt), lastUsedAt: rec.lastUsedAt ? new Date(rec.lastUsedAt) : null,
        })),
      remove: async (ctx, id) =>
        (await db.delete(s.apiTokens).where(and(eq(s.apiTokens.id, id), eq(s.apiTokens.userId, ctx.userId))).returning({ id: s.apiTokens.id })).length > 0,
    },

    push: {
      async save(ctx, subscription) {
        const row = { endpoint: subscription.endpoint, userId: ctx.userId, subscription, createdAt: new Date() };
        await db.insert(s.pushSubscriptions).values(row).onConflictDoUpdate({ target: s.pushSubscriptions.endpoint, set: row });
      },
      remove: async (ctx, endpoint) =>
        void (await db.delete(s.pushSubscriptions).where(and(eq(s.pushSubscriptions.endpoint, endpoint), eq(s.pushSubscriptions.userId, ctx.userId)))),
      has: async (ctx, endpoint) =>
        (await db.select({ e: s.pushSubscriptions.endpoint }).from(s.pushSubscriptions)
          .where(and(eq(s.pushSubscriptions.endpoint, endpoint), eq(s.pushSubscriptions.userId, ctx.userId)))).length > 0,
    },

    store: {
      snapshot: (ctx) =>
        db.transaction(async (tx) => {
          const userIds = await members(tx, ctx.householdId);
          if (!userIds.includes(ctx.userId)) throw new Error(`Пользователь «${ctx.userId}» не участник бюджета «${ctx.householdId}»`);
          return readRaw(tx, ctx, userIds);
        }),

      /** Смена базы и перенос старого формата: всё одной транзакцией; версии документов растут на 1, как в Redis */
      replace: (ctx, raw) =>
        db.transaction(async (tx) => {
          const h = ctx.householdId;
          const userIds = await members(tx, h);
          if (!userIds.includes(ctx.userId)) throw new Error(`Пользователь «${ctx.userId}» не участник бюджета «${h}»`);
          const bump = (v?: number) => (v ?? 0) + 1;
          if (raw.settings) {
            const { version, ...data } = raw.settings;
            await putSettings(tx, ctx, data, bump(version));
          }
          for (const [u, us] of Object.entries(raw.userSettings)) {
            if (!us || !userIds.includes(u)) continue;
            const { version, ...data } = us;
            await putUserSettings(tx, { householdId: h, userId: u }, data, bump(version));
          }
          for (const [key, hash] of Object.entries(raw.hashes)) {
            const k = parseMonthKey(key);
            if (!k) continue;
            for (const x of Object.values(hash)) {
              if (k.kind === "incomes") await putIncome(tx, ctx, x as Income);
              else await putExpense(tx, { householdId: h, userId: (x as Expense).authorId }, x as Expense);
            }
          }
          if (raw.plans) {
            const p = raw.plans;
            for (const [m, d] of Object.entries(p.family)) await putPlan(tx, ctx, m, null, d, bump(d.version));
            for (const [u, docs] of Object.entries(p.byUser)) for (const [m, d] of Object.entries(docs)) await putPlan(tx, ctx, m, u, d, bump(d.version));
            const items = [...Object.values(p.familyItems), ...Object.values(p.userItems).flatMap((months) => Object.values(months))].flatMap((x) => Object.values(x));
            for (const it of items) {
              const row = planItemRow({ householdId: h, userId: it.ownerId ?? ctx.userId }, { ...it, version: bump(it.version) });
              await tx.insert(s.planItems).values(row).onConflictDoUpdate({ target: [s.planItems.householdId, s.planItems.id], set: row });
            }
          }
          // Снимки сверок переписываются целиком; счета и копилки в своих валютах не меняются
          if (raw.savings?.recons.length) {
            await tx.delete(s.recons).where(eq(s.recons.householdId, h));
            await tx.insert(s.recons).values(raw.savings.recons.map((r) => ({
              householdId: h, id: r.id, at: new Date(r.at), day: r.day, by: r.by, snapshot: r, totalAll: r2(r.totals.all), totalFamily: r2(r.totals.family),
            })));
          }
        }),
    },

    legacy: {
      // Старые форматы остались в Redis и переносятся до переезда; в Postgres их нет
      docs: async () => ({}),
      hasDocs: async () => false,
      importGoals: (ctx, goals) =>
        db.transaction(async (tx) => {
          for (const g of goals) {
            const row = { householdId: ctx.householdId, id: g.id, name: g.name, target: r2(g.target), currency: g.currency, allocated: r2(g.allocated), scope: g.scope, ownerId: ownerOf(ctx, g.scope), version: g.version };
            if ((await tx.insert(s.goals).values(row).onConflictDoNothing().returning({ id: s.goals.id })).length) await writeGoal(tx, ctx, g);
          }
        }),
    },

    system: {
      async households() {
        const rows = await db.select({ id: s.memberships.householdId, userId: s.memberships.userId }).from(s.memberships)
          .innerJoin(s.households, eq(s.households.id, s.memberships.householdId))
          .where(and(eq(s.memberships.status, "active"), eq(s.households.status, "active")))
          .orderBy(asc(s.memberships.householdId), asc(s.memberships.joinedAt), asc(s.memberships.userId));
        const out = new Map<string, string[]>();
        for (const r of rows) out.set(r.id, [...(out.get(r.id) ?? []), r.userId]);
        return [...out].map(([id, userIds]) => ({ id, userIds }));
      },
      async householdOf(userId) {
        // Действующее членство одно (уникальный индекс memberships_one_active); архивы — отдельно
        const [row] = await db.select({ id: s.memberships.householdId }).from(s.memberships)
          .where(and(eq(s.memberships.userId, userId), eq(s.memberships.status, "active")));
        return row?.id ?? null;
      },
      async ensureHousehold(userId) {
        const cur = await repos.system.householdOf(userId);
        if (cur) return cur;
        const id = crypto.randomUUID();
        try {
          await db.transaction(async (tx) => {
            await tx.insert(s.households).values({ id, name: "Личный бюджет", kind: "solo" });
            await tx.insert(s.memberships).values({ householdId: id, userId, role: "owner" });
          });
          return id;
        } catch (e) {
          // Параллельный запрос успел создать свой: уникальный индекс memberships_one_active — берём его
          const other = await repos.system.householdOf(userId);
          if (other) return other;
          throw e;
        }
      },
      // Архив: без проверки членства — её делает lib/archive.ts (former-членство, срок, дата выхода)
      familySnapshot: (householdId) => db.transaction((tx) => readRaw(tx, { userId: "", householdId }, [])),
      members: (householdId) =>
        db.select({ id: s.users.id, name: s.users.name }).from(s.memberships).innerJoin(s.users, eq(s.users.id, s.memberships.userId))
          .where(and(eq(s.memberships.householdId, householdId), eq(s.memberships.status, "active"))).orderBy(asc(s.memberships.joinedAt), asc(s.memberships.userId)),
      tokensOf: async (userId) => tokensById(await db.select().from(s.apiTokens).where(eq(s.apiTokens.userId, userId))),
      touchToken: async (userId, id, rec) =>
        void (await db.update(s.apiTokens).set({ lastUsedAt: rec.lastUsedAt ? new Date(rec.lastUsedAt) : null })
          .where(and(eq(s.apiTokens.id, id), eq(s.apiTokens.userId, userId)))),
      async hitToken(tokenId) {
        const minute = Math.floor(Date.now() / 60_000);
        const [row] = await db.insert(s.quickRate).values({ tokenId, minute, count: 1 })
          .onConflictDoUpdate({ target: [s.quickRate.tokenId, s.quickRate.minute], set: { count: sql`${s.quickRate.count} + 1` } })
          .returning({ count: s.quickRate.count });
        await db.delete(s.quickRate).where(and(eq(s.quickRate.tokenId, tokenId), lte(s.quickRate.minute, minute - 2)));
        return row.count;
      },
      async subscriptions(userIds) {
        const rows = await db.select().from(s.pushSubscriptions).where(userIds ? inArray(s.pushSubscriptions.userId, userIds.length ? userIds : [""]) : undefined);
        return rows.map((r): StoredSubscription => ({ userId: r.userId, subscription: r.subscription as StoredSubscription["subscription"], at: r.createdAt.toISOString() }));
      },
      dropSubscription: async (endpoint) => void (await db.delete(s.pushSubscriptions).where(eq(s.pushSubscriptions.endpoint, endpoint))),
      swapAppVersion: (sha) =>
        db.transaction(async (tx) => {
          await lock(tx, APP_VERSION);
          const [cur] = await tx.select().from(s.appMeta).where(eq(s.appMeta.key, APP_VERSION));
          await tx.insert(s.appMeta).values({ key: APP_VERSION, value: sha }).onConflictDoUpdate({ target: s.appMeta.key, set: { value: sha } });
          return cur?.value ?? null;
        }),
    },
  };
  return repos;
}
