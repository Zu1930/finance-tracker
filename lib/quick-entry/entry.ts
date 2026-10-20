/** Разобранная трата → запись Expense и подписи. Общее для страницы ввода и /api/quick */
import type { Expense, Settings } from "../types.ts";
import type { ParsedEntry } from "./parse.ts";

const NAMES: Record<string, string> = { USD: "доллары", EUR: "евро", RSD: "динары", RUB: "рубли" };

/** Почему трату нельзя записать; null — можно (категорию проверяет вызывающий: low разрешён) */
export function entryProblem(p: ParsedEntry, st: Pick<Settings, "base" | "rates">): string | null {
  if (p.errors.includes("NO_AMOUNT")) return "Нет суммы";
  if (p.errors.includes("UNKNOWN_CURRENCY")) return `Валюта ${NAMES[p.currency] ?? p.currency} не подключена`;
  if (p.currency !== st.base && !(st.rates[p.currency]! > 0)) return `Нет курса ${p.currency}`;
  return null;
}

/** Запись по разбору; курс — последний известный из настроек. null — записать нельзя */
export function toExpense(p: ParsedEntry, st: Pick<Settings, "base" | "rates">, authorId: string, id: string, ts: number): Expense | null {
  if (entryProblem(p, st) || !p.categoryId || p.amount === null) return null;
  const rate = p.currency === st.base ? 1 : st.rates[p.currency]!;
  return {
    id, amount: p.amount, currency: p.currency, rate, base: Math.round(p.amount * rate * 100) / 100,
    catId: p.categoryId, note: p.note.slice(0, 140), date: p.date, ts, scope: p.scope, authorId,
  };
}

/** 1 трата, 2 траты, 5 трат */
export const tratyWord = (n: number) => {
  const m10 = n % 10, m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? "трата" : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? "траты" : "трат";
};
