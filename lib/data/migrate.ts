/**
 * Перенос Redis → Postgres и сверка результата. Вызывают scripts/migrate-redis-to-pg.ts и scripts/verify-migration.ts,
 * проверяет lib/data/migrate.test.mjs. Redis только читается (старые ft:doc:* и ft:goals не трогаются).
 * Перенос — одна транзакция, upsert по id с сохранением версий; повторный запуск ничего не задваивает.
 */
import { createHash } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { getRedis, readStore } from "./redis/client.ts";
import { postgresRepos, accountRow, categoryRows, expenseRow, incomeRow, planItemRow, recurringRow, type Db } from "./postgres/repos.ts";
import * as s from "./postgres/schema.ts";
import { DEFAULT_HOUSEHOLD, type Ctx, type StoredSubscription } from "./types.ts";
import { K, buildView, parseMonthKey, parsePlanKey, type RawStore } from "../store.ts";
import type { TokenRecord } from "../quick-entry/api.ts";
import type { Expense, GoalsDoc, Income, User } from "../types.ts";

export type Source = {
  raw: RawStore;
  tokens: Record<string, Record<string, TokenRecord>>;
  push: Record<string, StoredSubscription>;
  appVersion: string | null;
  /** Ключи месяцев и планов, которых нет в ft:index: приложение их не видит, перенос — тоже */
  unindexed: string[];
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const PATTERNS = ["ft:m:*", "ft:i:*", "ft:u:*:m:*", "ft:plan:*", "ft:plan-items:*", "ft:u:*:plan:*", "ft:u:*:plan-items:*"];

async function scanKeys(match: string): Promise<string[]> {
  const out: string[] = [];
  let cursor = "0";
  do {
    const [next, keys] = await getRedis().scan(cursor, { match, count: 1000 });
    out.push(...keys);
    cursor = String(next);
  } while (cursor !== "0");
  return out;
}

/** Всё содержимое текущей схемы Redis. Отказ, если старые форматы ещё не перенесены в приложении */
export async function readRedisSource(users: User[]): Promise<Source> {
  const redis = getRedis();
  const ids = users.map((u) => u.id);
  const raw = await readStore(ids);
  if (!raw.settings && (await redis.exists("ft:doc:settings"))) throw new Error("В Redis данные старого формата (ft:doc:*): сначала перенос в приложении (migrate-v2).");
  const legacyGoals = raw.goals as GoalsDoc | null;
  if (raw.settings && (raw.settings.schemaVersion ?? 0) < 3 && (legacyGoals?.items.length ?? 0) > 0) {
    throw new Error("Старые копилки (ft:goals) не перенесены в «Сбережения»: сначала перенос в приложении (migrate-v3).");
  }
  const tokens = Object.fromEntries(await Promise.all(ids.map(async (id) => [id, (await redis.hgetall<Record<string, TokenRecord>>(K.tokens(id))) ?? {}] as const)));
  const push = (await redis.hgetall<Record<string, StoredSubscription>>("ft:push")) ?? {};
  const appVersion = await redis.get<string>("ft:push:version");
  const indexed = new Set(await redis.smembers(K.index));
  const unindexed = (await Promise.all(PATTERNS.map(scanKeys))).flat().filter((k) => !indexed.has(k) && (parseMonthKey(k) || parsePlanKey(k)));
  return { raw, tokens, push, appVersion: appVersion === null ? null : String(appVersion), unindexed };
}

class DryRun extends Error {}

/** Деньги в numeric(14,2): значение с бо́льшим числом знаков молча округлилось бы — такие переносить нельзя */
function moneyProblems(src: Source): string[] {
  const bad: string[] = [];
  const check = (where: string, v: number | null | undefined) => {
    if (typeof v === "number" && Math.abs(r2(v) - v) > 1e-9) bad.push(`${where}: ${v}`);
  };
  const { raw } = src;
  for (const c of [...(raw.settings?.familyCategories ?? []), ...Object.values(raw.userSettings).flatMap((u) => u?.personalCategories ?? [])]) check(`категория ${c.id}`, c.limit);
  for (const [key, hash] of Object.entries(raw.hashes)) for (const x of Object.values(hash)) { check(`${key}/${x.id} amount`, x.amount); check(`${key}/${x.id} base`, x.base); }
  const sv = raw.savings;
  for (const a of [...Object.values(sv?.accounts ?? {}), ...Object.values(sv?.userAccounts ?? {}).flatMap((h) => Object.values(h))]) { check(`счёт ${a.id}`, a.balance); check(`счёт ${a.id} initial`, a.initial); }
  for (const g of [...Object.values(sv?.goals ?? {}), ...Object.values(sv?.userGoals ?? {}).flatMap((h) => Object.values(h))]) {
    check(`копилка ${g.id}`, g.target); check(`копилка ${g.id} allocated`, g.allocated);
    for (const o of g.ops) check(`копилка ${g.id} операция ${o.id}`, o.amount);
  }
  for (const d of Object.values(raw.plans?.family ?? {})) check(`план ${d.month}`, d.incomeOverride);
  for (const it of [...Object.values(raw.plans?.familyItems ?? {}), ...Object.values(raw.plans?.userItems ?? {}).flatMap((m) => Object.values(m))].flatMap((h) => Object.values(h))) check(`пункт ${it.id}`, it.amount);
  for (const p of [...Object.values(raw.recurring?.family ?? {}), ...Object.values(raw.recurring?.byUser ?? {}).flatMap((h) => Object.values(h))]) for (const a of p.amounts) check(`платёж ${p.id} ${a.fromMonth}`, a.amount);
  return bad;
}

/** Версии всего, что пишет приложение; записи без версии (траты, доходы, сверки) — только наличие */
function versions(raw: RawStore): Map<string, number> {
  const m = new Map<string, number>();
  if (raw.settings) m.set("настройки бюджета", raw.settings.version ?? 0);
  for (const [u, us] of Object.entries(raw.userSettings)) if (us) m.set(`личные настройки ${u}`, us.version ?? 0);
  for (const [key, hash] of Object.entries(raw.hashes)) for (const id of Object.keys(hash)) m.set(`запись ${key}/${id}`, 0);
  const sv = raw.savings;
  for (const a of [...Object.values(sv?.accounts ?? {}), ...Object.values(sv?.userAccounts ?? {}).flatMap((h) => Object.values(h))]) m.set(`счёт ${a.id}`, a.version);
  for (const g of [...Object.values(sv?.goals ?? {}), ...Object.values(sv?.userGoals ?? {}).flatMap((h) => Object.values(h))]) m.set(`копилка ${g.id}`, g.version);
  for (const r of sv?.recons ?? []) m.set(`сверка ${r.id}`, 0);
  for (const [month, d] of Object.entries(raw.plans?.family ?? {})) m.set(`план ${month}`, d.version);
  for (const [u, docs] of Object.entries(raw.plans?.byUser ?? {})) for (const [month, d] of Object.entries(docs)) m.set(`план ${u} ${month}`, d.version);
  for (const it of [...Object.values(raw.plans?.familyItems ?? {}), ...Object.values(raw.plans?.userItems ?? {}).flatMap((x) => Object.values(x))].flatMap((h) => Object.values(h))) m.set(`пункт ${it.id}`, it.version);
  for (const p of [...Object.values(raw.recurring?.family ?? {}), ...Object.values(raw.recurring?.byUser ?? {}).flatMap((h) => Object.values(h))]) m.set(`платёж ${p.id}`, p.version);
  return m;
}

/**
 * Что в Postgres новее Redis: записей нет в Redis или версия выше. Непусто — приложение, похоже, уже пишет в Postgres,
 * и перенос (upsert) вернул бы эти записи к состоянию Redis
 */
export function newerInPostgres(redis: RawStore, postgres: RawStore): string[] {
  const r = versions(redis);
  return [...versions(postgres)].filter(([k, v]) => !r.has(k) || v > r.get(k)!).map(([k, v]) => (r.has(k) ? `${k}: версия ${v} > ${r.get(k)}` : `${k}: нет в Redis`));
}

export type ImportResult = { counts: Record<string, number>; skipped: string[] };

/**
 * Перенос в бюджет householdId: пользователи из USERS (первый — owner), все записи с их id и версиями.
 * dryRun — всё выполняется в транзакции (с проверкой ограничений базы) и откатывается
 */
export async function importToPostgres(db: Db, src: Source, users: User[], opts: { dryRun?: boolean; force?: boolean; householdId?: string } = {}): Promise<ImportResult> {
  const h = opts.householdId ?? DEFAULT_HOUSEHOLD;
  const problems = moneyProblems(src);
  if (problems.length) throw new Error(`Суммы с более чем 2 знаками после запятой — numeric(14,2) их изменит:\n  ${problems.slice(0, 20).join("\n  ")}`);
  // Повторный перенос после переключения перезаписал бы новые данные Postgres старыми из Redis
  const [existing] = await db.select({ id: s.memberships.userId }).from(s.memberships).where(and(eq(s.memberships.householdId, h), eq(s.memberships.userId, users[0].id)));
  if (existing && !opts.force) {
    const newer = newerInPostgres(src.raw, await postgresRepos(db).store.snapshot({ householdId: h, userId: users[0].id }));
    if (newer.length) {
      throw new Error(`В Postgres есть данные новее Redis (${newer.length}) — похоже, приложение уже работает на Postgres, и перенос их перезапишет:\n  ${newer.slice(0, 20).join("\n  ")}\nЕсли это точно нужно — --force.`);
    }
  }
  const counts: Record<string, number> = {};
  const skipped: string[] = src.unindexed.map((k) => `${k}: нет в ft:index, приложение его не показывает`);
  const add = (table: string, n = 1) => (counts[table] = (counts[table] ?? 0) + n);
  const member = new Set(users.map((u) => u.id));
  const ctx = (userId: string): Ctx => ({ householdId: h, userId });
  const { raw } = src;

  try {
    await db.transaction(async (tx) => {
      for (const u of users) await tx.insert(s.users).values({ id: u.id, name: u.name }).onConflictDoUpdate({ target: s.users.id, set: { name: u.name } });
      add("users", users.length);
      await tx.insert(s.households).values({ id: h, name: "Семья" }).onConflictDoNothing();
      for (const [i, u] of users.entries()) {
        await tx.insert(s.memberships).values({ householdId: h, userId: u.id, role: i === 0 ? "owner" : "member" }).onConflictDoNothing();
      }
      add("memberships", users.length);

      // Настройки бюджета — с их версией
      const st = raw.settings;
      if (st) {
        await tx.update(s.households).set({
          baseCurrency: st.base, currencies: st.currencies, rates: st.rates, ratesUpdatedAt: st.ratesUpdatedAt ?? null, baseHistory: st.baseHistory ?? null,
          incomeSourcesSet: !!st.incomeSources, schemaVersion: st.schemaVersion ?? null, version: st.version ?? 0,
        }).where(eq(s.households.id, h));
        await tx.delete(s.categories).where(and(eq(s.categories.householdId, h), isNull(s.categories.ownerId)));
        if (st.familyCategories.length) await tx.insert(s.categories).values(categoryRows(ctx(users[0].id), st.familyCategories, null));
        add("categories", st.familyCategories.length);
        await tx.delete(s.incomeSources).where(eq(s.incomeSources.householdId, h));
        if (st.incomeSources?.length) await tx.insert(s.incomeSources).values(st.incomeSources.map((x, sort) => ({ householdId: h, id: x.id, name: x.name, sort })));
        add("income_sources", st.incomeSources?.length ?? 0);
      }
      for (const [userId, us] of Object.entries(raw.userSettings)) {
        if (!us || !member.has(userId)) continue;
        const row = { householdId: h, userId, preferredCurrency: us.preferredCurrency ?? null, hideQuickEntry: !!us.hideQuickEntry, version: us.version ?? 0 };
        await tx.insert(s.userSettings).values(row).onConflictDoUpdate({ target: [s.userSettings.householdId, s.userSettings.userId], set: row });
        add("user_settings");
        await tx.delete(s.categories).where(and(eq(s.categories.householdId, h), eq(s.categories.ownerId, userId)));
        if (us.personalCategories.length) await tx.insert(s.categories).values(categoryRows(ctx(userId), us.personalCategories, userId));
        add("categories", us.personalCategories.length);
      }

      // Платежи раньше трат: оплаты ссылаются на них внешним ключом
      const payments = [...Object.values(raw.recurring?.family ?? {}), ...Object.entries(raw.recurring?.byUser ?? {}).filter(([u]) => member.has(u)).flatMap(([, x]) => Object.values(x))];
      for (const p of payments) {
        const row = recurringRow(ctx(p.ownerId ?? users[0].id), p);
        await tx.insert(s.recurringPayments).values(row).onConflictDoUpdate({ target: [s.recurringPayments.householdId, s.recurringPayments.id], set: row });
        await tx.delete(s.recurringAmounts).where(and(eq(s.recurringAmounts.householdId, h), eq(s.recurringAmounts.paymentId, p.id)));
        if (p.amounts.length) await tx.insert(s.recurringAmounts).values(p.amounts.map((a) => ({ householdId: h, paymentId: p.id, fromMonth: a.fromMonth, amount: r2(a.amount) })));
        add("recurring_payments");
        add("recurring_amounts", p.amounts.length);
      }

      for (const [key, hash] of Object.entries(raw.hashes)) {
        const k = parseMonthKey(key);
        if (!k) continue;
        if (k.kind === "personal" && !member.has(k.userId!)) {
          skipped.push(`${key}: пользователя ${k.userId} нет в USERS (${Object.keys(hash).length} записей)`);
          continue;
        }
        for (const x of Object.values(hash)) {
          if (k.kind === "incomes") {
            const row = incomeRow(h, x as Income);
            await tx.insert(s.incomes).values(row).onConflictDoUpdate({ target: [s.incomes.householdId, s.incomes.id], set: row });
            add("incomes");
            continue;
          }
          const e = x as Expense;
          if (k.kind === "personal" && (e.authorId !== k.userId || e.scope !== "personal")) throw new Error(`${key}/${e.id}: личная трата с автором ${e.authorId}, scope ${e.scope}`);
          if (k.kind === "family" && e.scope !== "family") throw new Error(`${key}/${e.id}: в семейном хеше трата со scope ${e.scope}`);
          if (e.date.slice(0, 7) !== k.month) throw new Error(`${key}/${e.id}: дата ${e.date} не из месяца ключа`);
          const row = expenseRow(h, e);
          await tx.insert(s.expenses).values(row).onConflictDoUpdate({ target: [s.expenses.householdId, s.expenses.id], set: row });
          add("expenses");
        }
      }

      const sv = raw.savings;
      const accounts = [...Object.values(sv?.accounts ?? {}), ...Object.entries(sv?.userAccounts ?? {}).filter(([u]) => member.has(u)).flatMap(([, x]) => Object.values(x))];
      for (const a of accounts) {
        const row = accountRow(ctx(a.ownerId ?? users[0].id), a);
        await tx.insert(s.accounts).values(row).onConflictDoUpdate({ target: [s.accounts.householdId, s.accounts.id], set: row });
        add("accounts");
      }
      const goals = [...Object.values(sv?.goals ?? {}), ...Object.entries(sv?.userGoals ?? {}).filter(([u]) => member.has(u)).flatMap(([, x]) => Object.values(x))];
      for (const g of goals) {
        const row = { householdId: h, id: g.id, name: g.name, target: r2(g.target), currency: g.currency, allocated: r2(g.allocated), scope: g.scope, ownerId: g.scope === "personal" ? g.ownerId! : null, version: g.version };
        await tx.insert(s.goals).values(row).onConflictDoUpdate({ target: [s.goals.householdId, s.goals.id], set: row });
        await tx.delete(s.goalOps).where(and(eq(s.goalOps.householdId, h), eq(s.goalOps.goalId, g.id)));
        if (g.ops.length) await tx.insert(s.goalOps).values(g.ops.map((o, pos) => ({ householdId: h, goalId: g.id, id: o.id, pos, amount: r2(o.amount), date: o.date, ts: new Date(o.ts), by: o.by })));
        add("goals");
        add("goal_ops", g.ops.length);
      }
      for (const r of sv?.recons ?? []) {
        const row = { householdId: h, id: r.id, at: new Date(r.at), day: r.day, by: r.by, snapshot: r, totalAll: r2(r.totals.all), totalFamily: r2(r.totals.family) };
        await tx.insert(s.recons).values(row).onConflictDoUpdate({ target: [s.recons.householdId, s.recons.id], set: row });
        add("recons");
      }

      const plans = raw.plans;
      const putPlan = async (month: string, ownerId: string | null, limitOverrides: Record<string, number>, incomeOverride: number | null, version: number) => {
        await tx.delete(s.monthPlans).where(and(eq(s.monthPlans.householdId, h), eq(s.monthPlans.month, month), ownerId ? eq(s.monthPlans.ownerId, ownerId) : isNull(s.monthPlans.ownerId)));
        await tx.insert(s.monthPlans).values({ householdId: h, month, ownerId, incomeOverride: incomeOverride === null ? null : r2(incomeOverride), limitOverrides, version });
        add("month_plans");
      };
      for (const [m, d] of Object.entries(plans?.family ?? {})) await putPlan(m, null, d.limitOverrides, d.incomeOverride, d.version);
      for (const [u, docs] of Object.entries(plans?.byUser ?? {})) if (member.has(u)) for (const [m, d] of Object.entries(docs)) await putPlan(m, u, d.limitOverrides, null, d.version);
      const items = [...Object.values(plans?.familyItems ?? {}), ...Object.entries(plans?.userItems ?? {}).filter(([u]) => member.has(u)).flatMap(([, x]) => Object.values(x))].flatMap((x) => Object.values(x));
      for (const it of items) {
        const row = planItemRow(ctx(it.ownerId ?? users[0].id), it);
        await tx.insert(s.planItems).values(row).onConflictDoUpdate({ target: [s.planItems.householdId, s.planItems.id], set: row });
        add("plan_items");
      }

      for (const [userId, recs] of Object.entries(src.tokens)) {
        for (const [id, t] of Object.entries(recs)) {
          const row = { id, userId, name: t.name, hash: t.hash, createdAt: new Date(t.createdAt), lastUsedAt: t.lastUsedAt ? new Date(t.lastUsedAt) : null };
          await tx.insert(s.apiTokens).values(row).onConflictDoUpdate({ target: s.apiTokens.id, set: row });
          add("api_tokens");
        }
      }
      for (const sub of Object.values(src.push)) {
        if (!member.has(sub.userId)) {
          skipped.push(`push ${sub.subscription.endpoint}: пользователя ${sub.userId} нет в USERS`);
          continue;
        }
        const row = { endpoint: sub.subscription.endpoint, userId: sub.userId, subscription: sub.subscription, createdAt: new Date(sub.at) };
        await tx.insert(s.pushSubscriptions).values(row).onConflictDoUpdate({ target: s.pushSubscriptions.endpoint, set: row });
        add("push_subscriptions");
      }
      if (src.appVersion) {
        await tx.insert(s.appMeta).values({ key: "push:version", value: src.appVersion }).onConflictDoUpdate({ target: s.appMeta.key, set: { value: src.appVersion } });
        add("app_meta");
      }
      if (opts.dryRun) throw new DryRun();
    });
  } catch (e) {
    if (!(e instanceof DryRun)) throw e;
  }
  return { counts, skipped };
}

// ---------- Сверка ----------
/** Для сравнения ответов: массивы без порядка, без пустых месяцев и нулевых сумм партнёра (клиент читает их как ?? 0) */
export function canon(x: unknown): unknown {
  if (Array.isArray(x)) return x.map(canon).sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1));
  if (!x || typeof x !== "object") return x;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(x).sort()) {
    const v = canon((x as Record<string, unknown>)[k]);
    if (v === undefined || (Array.isArray(v) && !v.length) || (v && typeof v === "object" && !Array.isArray(v) && !Object.keys(v).length)) continue;
    out[k] = v;
  }
  return out;
}
const digest = (x: unknown) => createHash("sha256").update(JSON.stringify(canon(x))).digest("hex").slice(0, 12);

/** Показатели одного хранилища: одинаковые ключи для Redis и Postgres */
export function metrics(src: Pick<Source, "raw" | "tokens" | "push">, users: User[]): Map<string, string | number> {
  const m = new Map<string, string | number>();
  const inc = (k: string, v = 1) => m.set(k, r2(((m.get(k) as number) ?? 0) + v));
  const { raw } = src;
  const member = new Set(users.map((u) => u.id));
  for (const [key, hash] of Object.entries(raw.hashes)) {
    const k = parseMonthKey(key);
    if (!k || (k.kind === "personal" && !member.has(k.userId!))) continue;
    for (const x of Object.values(hash)) {
      if (k.kind === "incomes") {
        inc("записей: доходы");
        inc(`Σ base доходы ${k.month} автор ${x.authorId}`, x.base);
        continue;
      }
      const e = x as Expense;
      inc("записей: траты");
      inc(`Σ base траты ${k.month} ${e.scope} ${e.authorId}`, e.base);
      if (e.recurringId) inc(`оплачено регулярных за ${e.recurringMonth}`);
    }
  }
  const sv = raw.savings;
  const accounts = [...Object.values(sv?.accounts ?? {}), ...Object.entries(sv?.userAccounts ?? {}).filter(([u]) => member.has(u)).flatMap(([, x]) => Object.values(x))];
  inc("записей: счета", accounts.length);
  for (const a of accounts) m.set(`остаток счёта ${a.id}`, a.balance);
  const goals = [...Object.values(sv?.goals ?? {}), ...Object.entries(sv?.userGoals ?? {}).filter(([u]) => member.has(u)).flatMap(([, x]) => Object.values(x))];
  inc("записей: копилки", goals.length);
  inc("записей: операции копилок", goals.reduce((a, g) => a + g.ops.length, 0));
  for (const g of goals) m.set(`allocated копилки ${g.id}`, g.allocated);
  inc("записей: сверки", sv?.recons.length ?? 0);
  const p = raw.plans;
  inc("записей: планы месяцев", Object.keys(p?.family ?? {}).length + Object.entries(p?.byUser ?? {}).filter(([u]) => member.has(u)).reduce((a, [, d]) => a + Object.keys(d).length, 0));
  inc("записей: пункты плана", [...Object.values(p?.familyItems ?? {}), ...Object.entries(p?.userItems ?? {}).filter(([u]) => member.has(u)).flatMap(([, x]) => Object.values(x))].reduce((a, h) => a + Object.keys(h).length, 0));
  const payments = [...Object.values(raw.recurring?.family ?? {}), ...Object.entries(raw.recurring?.byUser ?? {}).filter(([u]) => member.has(u)).flatMap(([, x]) => Object.values(x))];
  inc("записей: регулярные платежи", payments.length);
  inc("записей: история цен", payments.reduce((a, x) => a + x.amounts.length, 0));
  inc("записей: категории", (raw.settings?.familyCategories.length ?? 0) + users.reduce((a, u) => a + (raw.userSettings[u.id]?.personalCategories.length ?? 0), 0));
  inc("записей: токены", Object.values(src.tokens).reduce((a, t) => a + Object.keys(t).length, 0));
  inc("записей: push-подписки", Object.values(src.push).filter((x) => member.has(x.userId)).length);
  m.set("настройки бюджета", digest(raw.settings));
  // Главная проверка: ответ /api/data каждому из пользователей совпадает целиком
  const month = new Date().toISOString().slice(0, 7);
  for (const me of users) {
    const partner = users.find((u) => u.id !== me.id) ?? me;
    const view = buildView(raw, me, partner, month);
    for (const [k, v] of Object.entries(view.partnerPersonalTotals)) if (v === 0) delete view.partnerPersonalTotals[k];
    m.set(`ответ /api/data для ${me.id}`, digest(view));
  }
  return m;
}

/** То же из Postgres: снимок бюджета, токены и подписки участников */
export async function readPostgresSource(db: Db, users: User[], householdId = DEFAULT_HOUSEHOLD): Promise<Pick<Source, "raw" | "tokens" | "push">> {
  const repos = postgresRepos(db);
  const raw = await repos.store.snapshot({ householdId, userId: users[0].id });
  const tokens = Object.fromEntries(await Promise.all(users.map(async (u) => [u.id, await repos.system.tokensOf(u.id)] as const)));
  const push = Object.fromEntries((await repos.system.subscriptions(users.map((u) => u.id))).map((x) => [x.subscription.endpoint, x]));
  return { raw, tokens, push };
}

export type Row = { metric: string; redis: string | number | undefined; postgres: string | number | undefined; ok: boolean };
export function compare(a: Map<string, string | number>, b: Map<string, string | number>): Row[] {
  const keys = [...new Set([...a.keys(), ...b.keys()])];
  return keys.map((metric) => ({ metric, redis: a.get(metric), postgres: b.get(metric), ok: a.get(metric) === b.get(metric) }));
}
