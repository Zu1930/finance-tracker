/**
 * Словарь «слово заметки → категория» из уже загруженных трат. Не хранится: строится на лету.
 * Вход — только видимые пользователю траты (семейные обоих + свои личные), поэтому личного партнёра в нём нет
 */
import type { Expense, TrackerData } from "../types.ts";
import { normWord, type Dictionary } from "./parse.ts";

const STOP = new Set([
  "для", "это", "как", "что", "или", "его", "она", "они", "оно", "мне", "нам", "все", "всё", "еще", "уже", "так", "там",
  "тут", "под", "над", "без", "при", "про", "через", "после", "перед", "себе", "день", "раз",
]);

/** Траты, которые видит пользователь: семейные обоих и свои личные */
export const visibleExpenses = (d: Pick<TrackerData, "familyExpenses" | "myExpenses">): Expense[] =>
  [...Object.values(d.familyExpenses), ...Object.values(d.myExpenses)].flat();

/** Частота слов заметок по категориям за последние 6 месяцев */
export function buildDictionary(expenses: Expense[], today = new Date().toISOString().slice(0, 10)): Dictionary {
  const [y, m] = today.split("-").map(Number);
  const from = new Date(Date.UTC(y, m - 7, Number(today.slice(8, 10)))).toISOString().slice(0, 10);
  const dict: Dictionary = {};
  for (const e of expenses) {
    if (e.date < from || !e.note) continue;
    for (const w of new Set(normWord(e.note).split(/[^a-zа-я]+/))) {
      if (w.length <= 2 || STOP.has(w)) continue;
      const row = Object.hasOwn(dict, w) ? dict[w] : (dict[w] = {});
      row[e.catId] = (row[e.catId] ?? 0) + 1;
    }
  }
  return dict;
}
