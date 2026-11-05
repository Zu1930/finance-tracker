/**
 * «Деньги»: давность обновления остатков, вердикт проверки, запись разницы «неучтено», остаток по месяцам
 * для бюджета. Чистые функции, тесты — lib/money.test.mjs. Сам расчёт сверки — lib/savings.ts
 */
import { gapStatus, monthEndSeries, type MonthPoint } from "./savings.ts";
import type { Category, Expense, Income, IncomeSource, ReconView, Scope } from "./types.ts";

/** Карточка «Остатки не обновлялись» — когда последнему обновлению больше стольких дней */
export const STALE_DAYS = 14;

/** Дней с последнего обновления остатков; null — ещё не обновляли */
export function daysSince(lastDay: string | undefined, today: string): number | null {
  if (!lastDay) return null;
  return Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${lastDay}T00:00:00Z`)) / 864e5);
}
export const isStale = (days: number | null) => days === null || days > STALE_DAYS;

export type Verdict =
  /** Первое обновление — точка отсчёта, сравнивать не с чем */
  | { kind: "first" }
  | { kind: "ok"; gap: number }
  /** На счетах меньше, чем должно быть: gap > 0 — вероятно, не записаны траты */
  | { kind: "missing"; gap: number }
  /** Денег больше: не записан доход или возврат */
  | { kind: "extra"; gap: number };

/** Вердикт по снимку; порог «сходится» — как у gapStatus (1 % ожидаемого) */
export function verdict(r: Pick<ReconView, "gap" | "expected" | "income">): Verdict {
  const s = gapStatus(r);
  if (!s || r.gap === null) return { kind: "first" };
  return { kind: s.kind === "ok" ? "ok" : s.kind === "expense" ? "missing" : "extra", gap: r.gap };
}

const OTHER = "прочее";
/** «Прочее» по имени — выбрано заранее; нет — пользователь выбирает сам */
export const otherId = (items: (Category | IncomeSource)[]) => items.find((c) => c.name.trim().toLowerCase() === OTHER)?.id ?? null;

export const unrecordedNote = (ddmm: string) => `неучтено, обновление остатков ${ddmm}`;

/**
 * Запись разницы: gap > 0 — трата бюджета scope в выбранной категории, gap < 0 — доход из выбранного источника.
 * Сумма — |gap| в базовой валюте. null — нечего или некуда записать
 */
export function unrecordedEntry(
  gap: number,
  o: { scope: Scope; to: string | null; base: string; today: string; ddmm: string; id: string; ts: number },
): { kind: "expense"; entry: Expense } | { kind: "income"; entry: Income } | null {
  const amount = Math.round(Math.abs(gap) * 100) / 100;
  const common = { id: o.id, amount, currency: o.base, rate: 1, base: amount, note: unrecordedNote(o.ddmm), date: o.today, ts: o.ts, authorId: "" };
  if (!amount || !o.to) return null;
  return gap > 0 ? { kind: "expense", entry: { ...common, catId: o.to, scope: o.scope } } : { kind: "income", entry: { ...common, sourceId: o.to } };
}

/** Остаток бюджета на конец месяца: семья — семейные счета, личное — мои, всё — всё вместе */
export function moneySeries(recons: ReconView[], view: "family" | "personal" | "all", months: string[], current: number): MonthPoint[] {
  const field = view === "family" ? "family" : view === "personal" ? "mine" : "all";
  return monthEndSeries(recons.map((r) => ({ day: r.day, at: r.at, all: r[field] })), months, { key: months.at(-1)!, value: current });
}
