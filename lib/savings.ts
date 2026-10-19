/**
 * Сбережения: итоги по счетам, сверка, динамика, распределение по копилкам. Чистые функции без Redis —
 * их вызывают route handlers, клиент и тесты (lib/savings.test.mjs). Только type-импорты и относительные .ts.
 */
import type { Account, Expense, Goal, Income, Recon, ReconView, SavingsView, Totals, User } from "./types.ts";

export type Rates = Record<string, number | null | undefined>;

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Сумма в базовой валюте по курсу; базовая = 1. null — курса нет */
export function toBase(amount: number, currency: string, base: string, rates: Rates): number | null {
  if (currency === base) return amount;
  const r = rates[currency];
  return r ? amount * r : null;
}

/** Итоги по действующим счетам: семья, каждый человек, всё. missing — валюты без курса (счета не вошли) */
export function totals(accounts: Account[], base: string, rates: Rates): Totals & { missing: string[] } {
  const t: Totals = { family: 0, byUser: {}, all: 0 };
  const missing = new Set<string>();
  for (const a of accounts) {
    if (a.archived) continue;
    const v = toBase(a.balance, a.currency, base, rates);
    if (v === null) { missing.add(a.currency); continue; }
    if (a.scope === "family") t.family += v;
    else t.byUser[a.ownerId!] = (t.byUser[a.ownerId!] ?? 0) + v;
    t.all += v;
  }
  t.family = r2(t.family);
  t.all = r2(t.all);
  for (const id in t.byUser) t.byUser[id] = r2(t.byUser[id]);
  return { ...t, missing: [...missing] };
}

/** Остатки по валютам счетов: { EUR: 5250, RSD: 256700 } */
export function byCurrency(accounts: Account[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const a of accounts) if (!a.archived) out[a.currency] = r2((out[a.currency] ?? 0) + a.balance);
  return out;
}

// ---------- Сверка ----------
export type Flow = { kind: "income" | "expense"; base: number; date: string; ts: number };

/**
 * Доходы и расходы семьи за период (prev; сейчас]. Запись в периоде, если её дата позже дня прошлой сверки
 * или в тот же день, но записана позже сверки. Будущие даты (позже сегодняшнего дня) не входят
 */
export function flowsSince(flows: Flow[], prev: { day: string; at: string }, day: string): { income: number; expense: number } {
  const prevTs = Date.parse(prev.at);
  let income = 0, expense = 0;
  for (const f of flows) {
    const after = f.date > prev.day || (f.date === prev.day && f.ts > prevTs);
    if (!after || f.date > day) continue;
    if (f.kind === "income") income += f.base;
    else expense += f.base;
  }
  return { income: r2(income), expense: r2(expense) };
}

/**
 * Снимок по ВСЕМ счетам семьи. fact — изменение остатков с прошлой сверки по ТЕКУЩЕМУ курсу: колебания курса
 * и начальные остатки новых счетов (initial) не считаются ни доходом, ни тратой. Без prev — точка отсчёта
 */
export function reconcile(
  prev: Recon | null,
  accounts: Account[],
  base: string,
  rates: Rates,
  flows: { income: number; expense: number } | null,
  meta: { id: string; at: string; day: string; by: string },
): Recon {
  const t = totals(accounts, base, rates);
  const balances = Object.fromEntries(accounts.map((a) => [a.id, a.balance]));
  const snapRates: Record<string, number> = {};
  for (const [c, r] of Object.entries(rates)) if (r) snapRates[c] = r;
  const { missing: _, ...tot } = t;
  const recon: Recon = { ...meta, balances, rates: snapRates, totals: tot, income: null, expense: null, expected: null, fact: null, gap: null };
  if (!prev || !flows) return recon;
  let fact = 0;
  for (const a of accounts) {
    const r = toBase(1, a.currency, base, rates);
    if (r === null) continue;
    fact += (a.balance - (prev.balances[a.id] ?? a.initial)) * r;
  }
  const expected = r2(flows.income - flows.expense);
  return { ...recon, income: flows.income, expense: flows.expense, expected, fact: r2(fact), gap: r2(expected - fact) };
}

/** Как читать расхождение: ok — |gap| ≤ 1% ожидаемого; warn — |gap| больше 5% доходов периода */
export function gapStatus(r: Pick<ReconView, "gap" | "expected" | "income">): { kind: "ok" | "expense" | "income"; warn: boolean } | null {
  if (r.gap === null || r.expected === null) return null;
  const abs = Math.abs(r.gap);
  const kind = abs <= Math.abs(r.expected) * 0.01 ? "ok" : r.gap > 0 ? "expense" : "income";
  return { kind, warn: kind !== "ok" && abs > (r.income ?? 0) * 0.05 };
}

// ---------- Динамика ----------
export type MonthPoint = { key: string; value: number | null; carried: boolean };

/**
 * Остаток на конец каждого месяца: последний снимок месяца; без снимков — значение прошлого месяца (carried).
 * Текущий месяц — текущие остатки. До первого снимка — null
 */
export function monthEndSeries(recons: Pick<ReconView, "day" | "at" | "all">[], months: string[], current: { key: string; value: number }): MonthPoint[] {
  const sorted = [...recons].sort((a, b) => a.at.localeCompare(b.at));
  let carry: number | null = null;
  // Значение на конец месяца перед первым в списке
  for (const r of sorted) if (r.day.slice(0, 7) < months[0]) carry = r.all;
  return months.map((key) => {
    if (key === current.key) return { key, value: current.value, carried: false };
    const last = sorted.filter((r) => r.day.slice(0, 7) === key).at(-1);
    if (last) { carry = last.all; return { key, value: last.all, carried: false }; }
    return { key, value: carry, carried: carry !== null };
  });
}

/** Изменение за текущий месяц: к последнему снимку до его начала; null — таких снимков нет */
export function monthChange(recons: Pick<ReconView, "day" | "at" | "all">[], curKey: string, now: number): number | null {
  const before = recons.filter((r) => r.day.slice(0, 7) < curKey).sort((a, b) => a.at.localeCompare(b.at)).at(-1);
  return before ? r2(now - before.all) : null;
}

// ---------- Копилки ----------
/** Сколько отведено под копилки в базовой валюте; missing — валюты копилок без курса */
export function allocated(goals: Goal[], base: string, rates: Rates): { total: number; missing: string[] } {
  let total = 0;
  const missing = new Set<string>();
  for (const g of goals) {
    const v = toBase(g.allocated, g.currency, base, rates);
    if (v === null) missing.add(g.currency);
    else total += v;
  }
  return { total: r2(total), missing: [...missing] };
}

/** Распределено и свободно; free может быть отрицательным */
export const allocation = (allocatedTotal: number, total: number) => ({ allocated: allocatedTotal, free: r2(total - allocatedTotal) });

/** На сколько месяцев среднего расхода хватит свободных денег; null — среднего нет */
export const runway = (free: number, avgMonthlyExpense: number | null | undefined) =>
  avgMonthlyExpense && avgMonthlyExpense > 0 ? Math.round((free / avgMonthlyExpense) * 10) / 10 : null;

/** Операция с копилкой: + выделить, − вернуть. Строка — почему нельзя */
export function applyGoalOp(g: Goal, amount: number, by: string, date: string, ts: number, id: string): Goal | string {
  if (!Number.isFinite(amount) || amount === 0) return "Введите сумму.";
  const next = r2(g.allocated + amount);
  if (next < 0) return "Нельзя вернуть больше, чем отведено.";
  return { ...g, allocated: next, ops: [...g.ops, { id, amount, date, ts, by }], version: g.version };
}

/** Удалить можно только пустую копилку */
export const goalDeleteError = (g: Goal) => (g.allocated !== 0 ? "СНАЧАЛА ВЕРНИТЕ ДЕНЬГИ" : null);
/** Архивировать можно только счёт с нулевым остатком */
export const accountArchiveError = (a: Account) => (a.balance !== 0 ? "СНАЧАЛА ОБНУЛИТЕ ОСТАТОК" : null);

// ---------- Приём данных от клиента ----------
const isCode = (v: unknown): v is string => typeof v === "string" && /^[A-Z]{3,5}$/.test(v);
const name40 = (v: unknown) => (typeof v === "string" ? v.trim().slice(0, 40) : "");
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Новый счёт из тела POST /api/accounts; ownerId и автор — из сессии. null — неверные данные */
export function prepareAccount(body: unknown, userId: string, currencies: string[], id: string, now: string): Account | null {
  const b = (body ?? {}) as Record<string, unknown>;
  const name = name40(b.name);
  const balance = b.balance === undefined ? 0 : b.balance;
  if (!name || !isCode(b.currency) || !currencies.includes(b.currency) || !finite(balance)) return null;
  const scope = b.scope === "personal" ? "personal" : "family";
  return {
    id, name, currency: b.currency, scope, ...(scope === "personal" && { ownerId: userId }),
    balance: r2(balance), initial: r2(balance), updatedAt: now, updatedBy: userId, version: 1,
  };
}

/** Новая копилка из тела POST /api/goals */
export function prepareGoal(body: unknown, userId: string, currencies: string[], id: string): Goal | null {
  const b = (body ?? {}) as Record<string, unknown>;
  const name = name40(b.name);
  if (!name || !finite(b.target) || !(b.target > 0) || !isCode(b.currency) || !currencies.includes(b.currency)) return null;
  const scope = b.scope === "personal" ? "personal" : "family";
  return { id, name, target: r2(b.target), currency: b.currency, allocated: 0, scope, ...(scope === "personal" && { ownerId: userId }), ops: [], version: 1 };
}

// ---------- Хранилище сбережений и сборка ответа ----------
/** Хеши сбережений как в Redis: поле = id */
export type RawSavings = {
  accounts: Record<string, Account>;
  userAccounts: Record<string, Record<string, Account>>;
  goals: Record<string, Goal>;
  userGoals: Record<string, Record<string, Goal>>;
  recons: Recon[];
};

export const allAccounts = (s: RawSavings) => [...Object.values(s.accounts), ...Object.values(s.userAccounts).flatMap((h) => Object.values(h ?? {}))];

const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name, "ru");

/** Снимок для пользователя: личное партнёра — одним числом */
export function reconView(r: Recon, me: string, partner: string): ReconView {
  return {
    at: r.at, day: r.day, all: r.totals.all, family: r.totals.family,
    mine: r.totals.byUser[me] ?? 0, partner: r.totals.byUser[partner] ?? 0,
    income: r.income, expense: r.expense, expected: r.expected, fact: r.fact, gap: r.gap,
  };
}

/** Сбережения, видимые me: свои и семейные счета и копилки целиком, у партнёра — только суммы */
export function buildSavings(raw: RawSavings, me: User, partner: User, base: string, rates: Rates): SavingsView {
  const partnerAccounts = Object.values(raw.userAccounts[partner.id] ?? {}).filter((a) => !a.archived);
  const partnerGoals = Object.values(raw.userGoals[partner.id] ?? {});
  const last = partnerAccounts.map((a) => a.updatedAt).sort().at(-1) ?? null;
  return {
    accounts: { family: Object.values(raw.accounts).sort(byName), mine: Object.values(raw.userAccounts[me.id] ?? {}).sort(byName) },
    goals: { family: Object.values(raw.goals).sort(byName), mine: Object.values(raw.userGoals[me.id] ?? {}).sort(byName) },
    partner: {
      total: totals(partnerAccounts, base, rates).all,
      goalsAllocated: allocated(partnerGoals, base, rates).total,
      lastUpdatedAt: last,
    },
    recons: [...raw.recons].sort((a, b) => a.at.localeCompare(b.at)).map((r) => reconView(r, me.id, partner.id)),
  };
}

/** Все доходы и траты семьи (включая личные обоих) из хешей месяцев */
export function flowsOf(hashes: Record<string, Record<string, Expense | Income>>): Flow[] {
  const out: Flow[] = [];
  for (const [key, hash] of Object.entries(hashes)) {
    const kind = key.startsWith("ft:i:") ? "income" : "expense";
    for (const e of Object.values(hash ?? {})) out.push({ kind, base: e.base, date: e.date, ts: e.ts });
  }
  return out;
}

export type ReconcileInput = { balances: Record<string, number>; versions: Record<string, number>; day: string };

/**
 * Сверка от пользователя me: проверка прав и новые состояния. Принимаются только семейные и свои личные
 * счета; остальные сохраняют прежний остаток. Ответ — изменённые счета и снимок по всем счетам семьи
 */
export function applyReconcile(
  raw: RawSavings,
  me: string,
  input: ReconcileInput,
  base: string,
  rates: Rates,
  flows: Flow[],
  meta: { id: string; at: string },
): { status: number; error: string } | { changed: Account[]; recon: Recon } {
  const allowed = { ...raw.accounts, ...(raw.userAccounts[me] ?? {}) };
  const changed: Account[] = [];
  for (const [id, balance] of Object.entries(input.balances)) {
    const a = allowed[id];
    if (!a) return { status: 403, error: "Чужой счёт." };
    if (a.archived) return { status: 400, error: `Счёт ${a.name} в архиве.` };
    if (!finite(balance)) return { status: 400, error: "Неверный остаток." };
    if (input.versions[id] !== a.version) return { status: 409, error: `Счёт ${a.name} изменил другой пользователь, проверьте и повторите.` };
    changed.push({ ...a, balance: r2(balance), updatedAt: meta.at, updatedBy: me, version: a.version + 1 });
  }
  const byId = new Map(allAccounts(raw).map((a) => [a.id, a]));
  for (const a of changed) byId.set(a.id, a);
  const prev = [...raw.recons].sort((a, b) => a.at.localeCompare(b.at)).at(-1) ?? null;
  const recon = reconcile(prev, [...byId.values()], base, rates, prev ? flowsSince(flows, prev, input.day) : null, { ...meta, day: input.day, by: me });
  return { changed, recon };
}

/** Смена базы: суммы снимков делятся на rate (сколько старой базы стоит 1 новой), курсы — как в settings */
export function rebaseRecon(r: Recon, from: string, to: string, rate: number): Recon {
  const d = (v: number | null) => (v === null ? null : r2(v / rate));
  const rates: Record<string, number> = {};
  for (const [c, v] of Object.entries(r.rates)) if (c !== to && c !== from) rates[c] = v / rate;
  rates[from] = 1 / rate;
  return {
    ...r,
    rates,
    totals: { family: r2(r.totals.family / rate), all: r2(r.totals.all / rate), byUser: Object.fromEntries(Object.entries(r.totals.byUser).map(([k, v]) => [k, r2(v / rate)])) },
    income: d(r.income), expense: d(r.expense), expected: d(r.expected), fact: d(r.fact), gap: d(r.gap),
  };
}

/** Перенос старых копилок: семейные, валюта сохраняется (без неё — текущая база), allocated = сумма операций */
export function migrateGoals(items: { id: string; name: string; target: number; currency?: string; ops: { id: string; amount: number; date: string; ts: number }[] }[], base: string, ownerId: string): Goal[] {
  return items.map((g) => ({
    id: g.id, name: g.name, target: g.target, currency: g.currency ?? base,
    allocated: r2(g.ops.reduce((a, o) => a + o.amount, 0)), scope: "family",
    ops: g.ops.map((o) => ({ ...o, by: ownerId })), version: 1,
  }));
}
