/**
 * Журнал на клиенте: мои счета с балансом, резервом и «свободно» прямо из записей в TrackerData — после записи
 * баланс меняется сразу, не дожидаясь сервера. Итоги семьи — от сервера (счета партнёра видны только суммой).
 * Чистые функции, тесты — lib/ledger-ui.test.mjs
 */
import {
  accountState, convert, defaultAccountId, entriesOf, historySeries, ledgerAccount, type AccountState, type LedgerEntry, type MonthPoint,
} from "./ledger.ts";
import type { Account, Expense, Goal, Income, TrackerData } from "./types.ts";

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Мои действующие счета: личные и (до перехода) семейные */
export function myAccounts(d: Pick<TrackerData, "savings">): Account[] {
  return [...d.savings.accounts.mine, ...d.savings.accounts.family].filter((a) => !a.archived);
}

/** Мои записи журнала: мои траты (личные и семейные), мои доходы, мои и входящие переводы */
export function myEntries(d: Pick<TrackerData, "me" | "myExpenses" | "familyExpenses" | "incomes" | "savings">): LedgerEntry[] {
  const ex = [...Object.values(d.myExpenses).flat(), ...Object.values(d.familyExpenses).flat().filter((e) => e.authorId === d.me.id)];
  return entriesOf(ex, Object.values(d.incomes).flat(), d.savings.ledger?.moves ?? []);
}

export type MyAccount = Omit<AccountState, "account"> & { account: Account; inBase: number | null };

/** Мои счета с балансом из записей. До перехода (нет initialAt) — ручной остаток */
export function myLedger(d: TrackerData, today: string): MyAccount[] {
  const st = d.settings!;
  const entries = myEntries(d);
  const allocs = d.savings.ledger?.allocs ?? [];
  return myAccounts(d).map((a) => {
    const s = accountState(ledgerAccount(a), entries, allocs, today);
    const state = a.initialAt ? s : { ...s, balance: a.balance, free: r2(a.balance - s.reserved), overdrawn: a.balance - s.reserved < 0 };
    return { ...state, account: a, inBase: convert(state.balance, a.currency, st.base, st.base, st.rates) };
  });
}

/**
 * Итог вида. personal — мои счета; family и all — все счета семьи одним числом (сервер), моя часть — живая.
 * onGoals — отложено в видимые цели (в базе по текущему курсу)
 */
export function ledgerTotals(d: TrackerData, view: "family" | "personal" | "all", mine: MyAccount[]) {
  const st = d.settings!;
  const lg = d.savings.ledger;
  const mineBase = r2(mine.reduce((t, a) => t + (a.inBase ?? 0), 0));
  const missing = [...new Set(mine.filter((a) => a.inBase === null).map((a) => a.account.currency))];
  // На сервере моя часть могла быть посчитана до последней записи: заменяем её живой
  const serverMine = r2(Object.entries(lg?.accounts ?? {}).reduce((t, [id, x]) => {
    const a = myAccounts(d).find((y) => y.id === id);
    return t + (a ? convert(x.balance, a.currency, st.base, st.base, st.rates) ?? 0 : 0);
  }, 0));
  const total = view === "personal" || d.solo ? mineBase : r2((lg?.familyTotal ?? mineBase) - serverMine + mineBase);
  const goals = visibleGoals(d, view);
  const onGoals = r2(goals.reduce((t, g) => t + (convert(goalTotal(d, g, view), g.currency, st.base, st.base, st.rates) ?? 0), 0));
  return { total, onGoals, free: r2(total - onGoals), missing: [...new Set([...missing, ...(view === "personal" ? [] : lg?.missing ?? [])])] };
}

/** Цели вида: personal — мои личные и мои части семейных; family — семейные; all — все видимые */
export function visibleGoals(d: Pick<TrackerData, "savings">, view: "family" | "personal" | "all"): Goal[] {
  const { family, mine } = d.savings.goals;
  return view === "family" ? family : [...family, ...mine];
}

/** Собрано в цели (в её валюте). В личном виде у семейной цели — только моя часть */
export function goalTotal(d: Pick<TrackerData, "savings" | "me">, g: Goal, view: "family" | "personal" | "all"): number {
  const p = d.savings.ledger?.goals[g.id];
  if (!p) return g.allocated;
  return view === "personal" && g.scope === "family" ? p.byUser[d.me.id] ?? 0 : p.total;
}

/** Моя часть цели на счёте (в валюте счёта) и её версия; 0 — части нет */
export function myPart(d: Pick<TrackerData, "savings">, goalId: string, accountId: string) {
  const x = d.savings.ledger?.allocs.find((a) => a.goalId === goalId && a.accountId === accountId);
  return { amount: x?.amount ?? 0, version: x?.version ?? 0 };
}

/** Счёт новой записи по умолчанию — последний использованный (как у Siri) */
export const lastAccountId = (d: TrackerData) => defaultAccountId(d.me.id, myAccounts(d), myEntries(d));

/** Запись без выбранного счёта (оплата регулярного, голосовой ввод) — на последний использованный */
export function withDefaultAccount<T extends Expense | Income>(d: TrackerData, e: T): T {
  if (e.accountId || !d.savings.ledger) return e;
  const id = lastAccountId(d);
  return id ? { ...e, accountId: id } : e;
}

/** Остаток на конец месяца за полгода: до перехода — снимки сверки, после — журнал, текущий — живое значение */
export function ledgerHistory(d: TrackerData, view: "family" | "personal" | "all", months: string[], current: number): MonthPoint[] {
  const lg = d.savings.ledger;
  const field = view === "personal" ? "mine" : "all";
  const ends = lg?.monthEnds ?? {};
  return historySeries(
    months, { key: months.at(-1)!, value: current }, lg?.since ?? null,
    d.savings.recons.map((r) => ({ day: r.day, at: r.at, value: r[field] })),
    (day) => ends[day.slice(0, 7)]?.[view === "personal" ? "mine" : "family"] ?? 0,
  );
}
