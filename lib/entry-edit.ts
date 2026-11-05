/**
 * Правка записи на месте (PATCH /api/entries/:id): сравнение с тем, что видел клиент (CAS по содержимому — у записей
 * нет версии), права на перенос между бюджетами и отвязка от плана и регулярного. Тесты — lib/entry-edit.test.mjs
 */
import type { Expense, Income } from "./types.ts";

const SAME = ["amount", "currency", "base", "date", "note"] as const;

/** Запись не менялась с тех пор, как её видел клиент */
export function sameEntry(cur: Expense | Income, seen: Expense | Income): boolean {
  if (SAME.some((k) => cur[k] !== seen[k])) return false;
  if ("catId" in cur) return cur.catId === (seen as Expense).catId && cur.scope === (seen as Expense).scope;
  return cur.sourceId === (seen as Income).sourceId;
}

/** Что отвяжется при правке: смена категории или бюджета снимает план и регулярный, смена месяца — пункт плана */
export function unlinks(cur: Expense, next: Pick<Expense, "catId" | "scope" | "date">): { plan: boolean; recurring: boolean } {
  const moved = next.catId !== cur.catId || next.scope !== cur.scope;
  return {
    plan: !!cur.planItemId && (moved || next.date.slice(0, 7) !== cur.date.slice(0, 7)),
    recurring: !!cur.recurringId && moved,
  };
}

export type EditResult<T> = { ok: true; entry: T } | { ok: false; status: number; error: string };

/** Новая трата: id, автор и время записи — прежние; перенести между бюджетами может только автор */
export function editExpense(cur: Expense, next: Expense, userId: string): EditResult<Expense> {
  if (next.scope !== cur.scope && cur.authorId !== userId) return { ok: false, status: 403, error: "Перенести чужую трату нельзя." };
  const u = unlinks(cur, next);
  const { planItemId: _p, recurringId: _r, recurringMonth: _m, ...rest } = next;
  return {
    ok: true,
    entry: {
      ...rest, id: cur.id, ts: cur.ts, authorId: cur.authorId,
      ...(cur.planItemId && !u.plan && { planItemId: cur.planItemId }),
      ...(cur.recurringId && !u.recurring && { recurringId: cur.recurringId, recurringMonth: cur.recurringMonth }),
    },
  };
}

export const editIncome = (cur: Income, next: Income): { ok: true; entry: Income } => ({ ok: true, entry: { ...next, id: cur.id, ts: cur.ts, authorId: cur.authorId } });

export const EDIT_CONFLICT = "Запись изменил другой пользователь, проверьте и повторите.";
