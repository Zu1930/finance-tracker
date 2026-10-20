/**
 * Офлайн-ввод: записи без связи ждут в очереди (localStorage) и отправляются при появлении сети.
 * Без связи можно только добавлять — удаление, настройки, план и сверка ждут сети, поэтому конфликтов версий нет.
 * Чистые функции — их вызывают TrackerProvider и тесты (lib/offline.test.mjs).
 */
import type { Expense, Income, TrackerData } from "./types.ts";

export type Kind = "expense" | "income";
export type Entry = Expense | Income;
export type Queued = { kind: Kind; entry: Entry };

export const queueKey = (userId: string) => `ft:queue:${userId}`;
/** Кеш service worker (public/sw.js): при выходе удаляется вместе с очередью */
export const SW_CACHE = "ft-v1";

/** В какую группу ответа GET /api/data попадает запись */
const bucketOf = (kind: Kind, e: Entry): "incomes" | "familyExpenses" | "myExpenses" =>
  kind === "income" ? "incomes" : (e as Expense).scope === "personal" ? "myExpenses" : "familyExpenses";

/** Добавить (заменив по id) или убрать запись в данных */
export function withEntry(d: TrackerData, kind: Kind, e: Entry, add: boolean): TrackerData {
  const bucket = bucketOf(kind, e);
  const m = e.date.slice(0, 7);
  const list = (d[bucket][m] ?? []) as Entry[];
  // Замена — на том же месте: повторное применение очереди не переставляет записи
  const next = !add ? list.filter((x) => x.id !== e.id) : list.some((x) => x.id === e.id) ? list.map((x) => (x.id === e.id ? e : x)) : [...list, e];
  return { ...d, [bucket]: { ...d[bucket], [m]: next } };
}

/** Данные с сервера (или из кеша) + записи, ещё не отправленные из очереди */
export const applyQueue = (d: TrackerData, q: Queued[]) => q.reduce((acc, x) => withEntry(acc, x.kind, x.entry, true), d);

export function readQueue(userId: string): Queued[] {
  try {
    const raw = localStorage.getItem(queueKey(userId));
    return raw ? (JSON.parse(raw) as Queued[]) : [];
  } catch {
    return [];
  }
}
export function writeQueue(userId: string, q: Queued[]): void {
  try {
    if (q.length) localStorage.setItem(queueKey(userId), JSON.stringify(q));
    else localStorage.removeItem(queueKey(userId));
  } catch {}
}
