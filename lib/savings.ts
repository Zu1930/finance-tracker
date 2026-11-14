/**
 * Сбережения: счета и цели в ответе клиенту, балансы из журнала (lib/ledger.ts), приём счетов и целей от клиента,
 * снимки сверки — только история до перехода. Чистые функции — их вызывают route handlers, клиент и тесты
 * (lib/savings.test.mjs). Только относительные .ts.
 */
import { accountBalance, convert, goalProgress, ledgerAccount, monthEnd, reserved, type GoalAlloc, type LedgerEntry } from "./ledger.ts";
import type { Account, Goal, LedgerMove, Recon, ReconView, SavingsView, User } from "./types.ts";

export type Rates = Record<string, number | null | undefined>;

const r2 = (n: number) => Math.round(n * 100) / 100;

// ---------- Цели и счета ----------
/** На сколько месяцев среднего расхода хватит свободных денег; null — среднего нет */
export const runway = (free: number, avgMonthlyExpense: number | null | undefined) =>
  avgMonthlyExpense && avgMonthlyExpense > 0 ? Math.round((free / avgMonthlyExpense) * 10) / 10 : null;

/** Удалить можно только пустую цель (до перехода — allocated, после — части на счетах проверяет роут) */
export const goalDeleteError = (g: Goal) => (g.allocated !== 0 ? "СНАЧАЛА ВЕРНИТЕ ДЕНЬГИ" : null);
/** Архивировать можно только счёт с нулевым остатком */
export const accountArchiveError = (a: Account) => (a.balance !== 0 ? "СНАЧАЛА ОБНУЛИТЕ ОСТАТОК" : null);

// ---------- Приём данных от клиента ----------
const isCode = (v: unknown): v is string => typeof v === "string" && /^[A-Z]{3,5}$/.test(v);
const name40 = (v: unknown) => (typeof v === "string" ? v.trim().slice(0, 40) : "");
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * Новый счёт из тела POST /api/accounts; ownerId и автор — из сессии. null — неверные данные.
 * Общих счетов нет: счёт всегда личный. initialAt — бюджет на журнале: остаток считается с этого дня
 */
export function prepareAccount(body: unknown, userId: string, currencies: string[], id: string, now: string, initialAt?: string): Account | null {
  const b = (body ?? {}) as Record<string, unknown>;
  const name = name40(b.name);
  const balance = b.balance === undefined ? 0 : b.balance;
  if (!name || !isCode(b.currency) || !currencies.includes(b.currency) || !finite(balance)) return null;
  return {
    id, name, currency: b.currency, scope: "personal", ownerId: userId,
    balance: r2(balance), initial: r2(balance), ...(initialAt && { initialAt }), ...(b.primary === true && { primary: true }),
    updatedAt: now, updatedBy: userId, version: 1,
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
  /** Переводы и корректировки бюджета */
  moves?: LedgerMove[];
  /** Части целей на счетах */
  allocs?: GoalAlloc[];
  /** День перехода на журнал; null — ещё не переведён */
  ledgerSince?: string | null;
};

export const allAccounts = (s: RawSavings) => [...Object.values(s.accounts), ...Object.values(s.userAccounts).flatMap((h) => Object.values(h ?? {}))];

const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name, "ru");

/** Снимок для пользователя: личное партнёра — одним числом */
export function reconView(r: Recon, me: string, partner: string): ReconView {
  return {
    at: r.at, day: r.day, all: r.totals.all, family: r.totals.family,
    mine: r.totals.byUser[me] ?? 0, partner: r.totals.byUser[partner] ?? 0,
  };
}

/**
 * Сбережения, видимые me: свои (и до перехода — семейные) счета и цели целиком; счета партнёра — только в общей сумме.
 * Остатки счетов, переведённых на журнал, считаются из записей на день today
 */
export function buildSavings(raw0: RawSavings, me: User, partner: User, base: string, rates: Rates, entries: LedgerEntry[] = [], today = new Date().toISOString().slice(0, 10)): SavingsView {
  const allocs = raw0.allocs ?? [];
  const live = (h: Record<string, Account>) => Object.fromEntries(Object.entries(h).map(([id, a]) => [id, { ...a, balance: accountBalance(a, entries, today) }]));
  const raw: RawSavings = { ...raw0, accounts: live(raw0.accounts), userAccounts: Object.fromEntries(Object.entries(raw0.userAccounts).map(([u, h]) => [u, live(h ?? {})])) };
  return {
    accounts: { family: Object.values(raw.accounts).sort(byName), mine: Object.values(raw.userAccounts[me.id] ?? {}).sort(byName) },
    goals: { family: Object.values(raw.goals).sort(byName), mine: Object.values(raw.userGoals[me.id] ?? {}).sort(byName) },
    recons: [...raw.recons].sort((a, b) => a.at.localeCompare(b.at)).map((r) => reconView(r, me.id, partner.id)),
    ledger: ledgerView(raw, allocs, me.id, base, rates, entries, today),
  };
}

/** Месяцы истории: 6 последних, включая текущий */
const HISTORY_MONTHS = 6;

function ledgerView(raw: RawSavings, allocs: GoalAlloc[], me: string, base: string, rates: Rates, entries: LedgerEntry[], today: string): NonNullable<SavingsView["ledger"]> {
  const every = allAccounts(raw);
  const mine = [...Object.values(raw.accounts), ...Object.values(raw.userAccounts[me] ?? {})];
  const mineIds = new Set(mine.map((a) => a.id));
  const accounts: NonNullable<SavingsView["ledger"]>["accounts"] = {};
  for (const a of mine) {
    const res = reserved(a.id, allocs);
    accounts[a.id] = { balance: a.balance, reserved: res, free: Math.round((a.balance - res) * 100) / 100 };
  }
  let familyTotal = 0;
  const missing = new Set<string>();
  for (const a of every) {
    if (a.archived) continue;
    const v = convert(a.balance, a.currency, base, base, rates);
    if (v === null) missing.add(a.currency);
    else familyTotal += v;
  }
  const visible = [...Object.values(raw.goals), ...Object.values(raw.userGoals[me] ?? {})];
  const ledgerAccounts = every.map(ledgerAccount);
  const goals = Object.fromEntries(visible.map((g) => {
    const p = goalProgress({ id: g.id, name: g.name, scope: g.scope, ownerId: g.ownerId, target: g.target, currency: g.currency }, allocs, ledgerAccounts, base, rates);
    return [g.id, { total: p.total, byUser: p.byUser, missing: p.missing }];
  }));
  const moves = (raw.moves ?? [])
    .filter((m) => m.userId === me || (m.toAccountId && mineIds.has(m.toAccountId)))
    // Входящий перевод от партнёра: видна сумма, его счёт — нет
    // Мой перевод партнёру: вместо его счёта — «user:<id>»
    .map((m) => (m.userId === me ? (m.toAccountId && !mineIds.has(m.toAccountId) ? { ...m, toAccountId: `user:${every.find((a) => a.id === m.toAccountId)?.ownerId ?? ""}` } : m) : { ...m, accountId: "" }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.ts - b.ts);
  // Конец завершённых месяцев после перехода — из журнала, по текущему курсу
  const monthEnds: Record<string, { family: number; mine: number }> = {};
  const since = raw.ledgerSince ?? null;
  if (since) {
    const [y, m] = today.slice(0, 7).split("-").map(Number);
    for (let i = HISTORY_MONTHS - 1; i >= 1; i--) {
      const d = new Date(Date.UTC(y, m - 1 - i, 1));
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
      const end = monthEnd(key);
      if (end < since) continue;
      const sum = (list: Account[]) => list.reduce((t, a) => t + (a.archived ? 0 : convert(accountBalance(a, entries, end), a.currency, base, base, rates) ?? 0), 0);
      monthEnds[key] = { family: Math.round(sum(every) * 100) / 100, mine: Math.round(sum(mine) * 100) / 100 };
    }
  }
  return {
    since, accounts, allocs: allocs.filter((x) => mineIds.has(x.accountId)), goals,
    familyTotal: Math.round(familyTotal * 100) / 100, missing: [...missing], moves, monthEnds,
  };
}

/** Смена базы: суммы снимков делятся на rate (сколько старой базы стоит 1 новой), курсы — как в settings */
export function rebaseRecon(r: Recon, from: string, to: string, rate: number): Recon {
  const rates: Record<string, number> = {};
  for (const [c, v] of Object.entries(r.rates)) if (c !== to && c !== from) rates[c] = v / rate;
  rates[from] = 1 / rate;
  return {
    ...r,
    rates,
    totals: { family: r2(r.totals.family / rate), all: r2(r.totals.all / rate), byUser: Object.fromEntries(Object.entries(r.totals.byUser).map(([k, v]) => [k, r2(v / rate)])) },
  };
}
