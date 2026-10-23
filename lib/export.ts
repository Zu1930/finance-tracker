/** Экспорт в CSV (архив и «Данные»): траты и доходы, разделитель «;», UTF-8 с BOM — так его правильно открывает Excel */
import type { TrackerData } from "./types.ts";
import { incomeSources } from "./utils.ts";

const cell = (v: string | number) => {
  // Числа — с запятой, как везде в приложении (и как ждёт Excel в русской локали)
  const s = typeof v === "number" ? String(v).replace(".", ",") : v;
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function entriesCsv(d: TrackerData): string {
  const cats = new Map([...(d.settings?.familyCategories ?? []), ...d.mySettings.personalCategories].map((c) => [c.id, c.name]));
  const sources = new Map(d.settings ? incomeSources(d.settings).map((s) => [s.id, s.name]) : []);
  const names = new Map(Object.entries(d.names ?? {}));
  const name = (id: string) => names.get(id) ?? (id === d.me.id ? d.me.name : "Удалённый пользователь");
  const rows: (string | number)[][] = [["дата", "тип", "категория/источник", "сумма", "валюта", `в ${d.settings?.base ?? "базе"}`, "автор", "заметка"]];
  for (const e of [...Object.values(d.familyExpenses).flat(), ...Object.values(d.myExpenses).flat()]) {
    rows.push([e.date, e.scope === "family" ? "расход семьи" : "мой расход", cats.get(e.catId) ?? "", e.amount, e.currency, e.base, name(e.authorId), e.note]);
  }
  for (const i of Object.values(d.incomes).flat()) rows.push([i.date, "доход", sources.get(i.sourceId) ?? "", i.amount, i.currency, i.base, name(i.authorId), i.note]);
  rows.sort((a, b) => (a[0] === "дата" ? -1 : b[0] === "дата" ? 1 : String(a[0]).localeCompare(String(b[0]))));
  return "﻿" + rows.map((r) => r.map(cell).join(";")).join("\n") + "\n";
}
