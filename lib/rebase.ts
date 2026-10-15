/**
 * Пересчёт всего учёта в новую базовую валюту. Чистые функции без Redis — их вызывают
 * и сервер (/api/rebase), и превью на клиенте, и тесты (lib/rebase.test.mjs).
 * Здесь только type-импорты: файл запускается напрямую через node --test.
 */
import type { Goal, Settings, TrackerData } from "./types";

export type LimitRounding = 0 | 1 | 10 | 100;

export type RebaseParams = {
  /** Текущая база (OLD) */
  from: string;
  /** Новая база (NEW) */
  to: string;
  /** Сколько OLD стоит 1 NEW: 1 EUR = 117.2 RSD → 117.2 */
  rate: number;
  /** Шаг округления лимитов; 0 — до копеек */
  limitRounding: LimitRounding;
};

export const round2 = (n: number) => Math.round(n * 100) / 100;

/** Лимит в новой валюте с шагом округления */
export const roundLimit = (n: number, step: LimitRounding) => (step ? Math.round(n / step) * step : round2(n));

type Entry = { amount: number; currency: string; rate: number; base: number };

/** Запись в NEW сохраняет точную сумму, остальные пересчитываются через курс */
export function rebaseEntry<T extends Entry>(e: T, p: RebaseParams): T {
  if (e.currency === p.to) return { ...e, rate: 1, base: e.amount };
  const rate = e.rate / p.rate;
  return { ...e, rate, base: round2(e.amount * rate) };
}

export function rebaseSettings(s: Settings, p: RebaseParams, at: string): Settings {
  const rates: Settings["rates"] = {};
  for (const [c, r] of Object.entries(s.rates)) {
    if (c !== p.to && c !== p.from) rates[c] = r === null ? null : r / p.rate;
  }
  rates[p.from] = 1 / p.rate;
  return {
    ...s,
    base: p.to,
    currencies: [p.to, ...s.currencies.filter((c) => c !== p.to)],
    rates,
    categories: s.categories.map((c) => ({ ...c, limit: roundLimit(c.limit / p.rate, p.limitRounding) })),
    baseHistory: [...(s.baseHistory ?? []), { from: p.from, to: p.to, rate: p.rate, at }],
  };
}

export const rebaseGoals = (goals: Goal[], p: RebaseParams): Goal[] =>
  goals.map((g) => ({
    ...g,
    target: round2(g.target / p.rate),
    ops: g.ops.map((o) => ({ ...o, amount: round2(o.amount / p.rate) })),
  }));

/** Весь учёт в новой базе. at — дата смены YYYY-MM-DD для baseHistory */
export function rebaseData(data: TrackerData, p: RebaseParams, at: string): TrackerData {
  if (!data.settings) throw new Error("Нет настроек для пересчёта");
  const months: TrackerData["months"] = {};
  for (const [k, m] of Object.entries(data.months)) months[k] = { expenses: m.expenses.map((e) => rebaseEntry(e, p)) };
  const incomes: TrackerData["incomes"] = {};
  for (const [k, m] of Object.entries(data.incomes)) incomes[k] = { items: m.items.map((i) => rebaseEntry(i, p)) };
  return {
    settings: rebaseSettings(data.settings, p, at),
    goals: rebaseGoals(data.goals, p),
    months,
    incomes,
  };
}
