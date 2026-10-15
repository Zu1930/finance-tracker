"use client";

import { useState } from "react";
import Link from "next/link";
import { useTracker } from "./TrackerProvider";
import { CommitInput } from "./CommitInput";
import { AsciiBar } from "./AsciiBar";
import { activeCats, amountChars, curMonthKey, fmt, monthTitle, parseAmount, shiftMonth, spentByCat, termName, uid } from "@/lib/utils";

export function LimitsView() {
  const { data, month, setMonth, setSettings, toast } = useTracker();
  const st = data.settings!;
  const cats = activeCats(st);
  const expenses = data.months[month]?.expenses ?? [];
  const spent = spentByCat(expenses);
  const totalL = cats.reduce((a, c) => a + c.limit, 0);
  const totalS = expenses.reduce((a, e) => a + e.base, 0);
  const [newCat, setNewCat] = useState("");

  const patchCat = (id: string, patch: Partial<(typeof cats)[number]>) =>
    setSettings((s) => ({ ...s!, categories: s!.categories.map((c) => (c.id === id ? { ...c, ...patch } : c)) }));

  const addCat = () => {
    const name = newCat.trim();
    if (!name) return;
    setSettings((s) => ({ ...s!, categories: [...s!.categories, { id: uid(), name: name.slice(0, 40), limit: 0 }] }));
    setNewCat("");
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex items-center gap-3">
          <button className="tb" aria-label="Предыдущий месяц" onClick={() => setMonth(shiftMonth(month, -1))}>&lt;</button>
          <h1 className="min-w-[16ch] text-center text-lg font-bold uppercase">{monthTitle(month)}</h1>
          <button className="tb" aria-label="Следующий месяц" onClick={() => setMonth(shiftMonth(month, 1))}>&gt;</button>
        </div>
        {month !== curMonthKey() && (
          <button className="tb" onClick={() => setMonth(curMonthKey())}>Текущий месяц</button>
        )}
        <p className="text-muted uppercase sm:ml-auto">
          Потрачено <b className="text-ink">{fmt(totalS)}</b> из <b className="text-ink">{fmt(totalL)} {st.base}</b>
        </p>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-x-12 sm:grid-cols-2">
        {cats.map((c) => {
          const s = spent[c.id] ?? 0;
          const left = c.limit - s;
          return (
            <section key={c.id} className="border-t border-dashed border-line py-5">
              <h2 className="sec">{termName(c.name)}</h2>
              <div className="mt-3"><AsciiBar value={s} max={c.limit} label={c.name} /></div>
              <p className={`mt-2 uppercase ${left < 0 ? "text-bad" : "text-muted"}`}>
                {left < 0 ? `Перерасход ${fmt(-left)} ${st.base}` : `Осталось ${fmt(left)} из ${fmt(c.limit)} ${st.base}`}
              </p>
            </section>
          );
        })}
      </div>

      <details className="group mt-4 border-t border-dashed border-line">
        <summary className="sec flex min-h-11 cursor-pointer list-none items-center gap-2 py-3 [&::-webkit-details-marker]:hidden">
          Категории и лимиты<span aria-hidden="true" className="group-open:hidden">[+]</span><span aria-hidden="true" className="hidden group-open:inline">[−]</span>
        </summary>
        <div className="max-w-3xl pt-3 pb-2">
          <h3 className="lbl">Limits, {st.base}</h3>
          {cats.map((c) => (
            <div className="mt-2 grid grid-cols-[minmax(0,1fr)_12ch_auto] items-end gap-4" key={c.id}>
              <CommitInput className="tfield w-full" aria-label="Название категории" value={c.name}
                onCommit={(v) => { const n = v.trim(); if (!n) return false; patchCat(c.id, { name: n.slice(0, 40) }); }} />
              <CommitInput className="tfield w-full text-right" aria-label={`Лимит, ${c.name}`} inputMode="decimal" sanitize={amountChars} value={String(c.limit)}
                onCommit={(v) => {
                  const n = parseAmount(v);
                  if (n === null || !(n >= 0)) { toast("Лимит должен быть числом."); return false; }
                  patchCat(c.id, { limit: n });
                }} />
              <button className="xb" aria-label={`Удалить категорию ${c.name}`} onClick={() => {
                patchCat(c.id, { archived: true });
                toast(`Категория ${termName(c.name)} удалена`, "Вернуть", () => patchCat(c.id, { archived: false }));
              }}>×</button>
            </div>
          ))}
          <div className="mt-4 flex items-end gap-4">
            <input className="tfield flex-1" placeholder="новая категория" aria-label="Новая категория" value={newCat}
              onChange={(e) => setNewCat(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addCat()} />
            <button className="tb" onClick={addCat}>Добавить</button>
          </div>
          <p className="mt-6 text-muted uppercase">
            Валюты, основная валюта и данные →{" "}
            <Link href="/settings" className="tb">Настройки</Link>
          </p>
        </div>
      </details>
    </>
  );
}
