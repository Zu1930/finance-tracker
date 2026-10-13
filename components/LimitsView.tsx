"use client";

import { useState } from "react";
import { useTracker } from "./TrackerProvider";
import { CommitInput } from "./CommitInput";
import { ExportButton, ImportButton } from "./ImportExport";
import { activeCats, curMonthKey, fmt, monthTitle, parseAmount, shiftMonth, spentByCat, uid } from "@/lib/utils";

export function LimitsView() {
  const { data, month, setMonth, setSettings, toast } = useTracker();
  const st = data.settings!;
  const cats = activeCats(st);
  const expenses = data.months[month]?.expenses ?? [];
  const spent = spentByCat(expenses);
  const totalL = cats.reduce((a, c) => a + c.limit, 0);
  const totalS = expenses.reduce((a, e) => a + e.base, 0);
  const [newCat, setNewCat] = useState("");
  const [newCur, setNewCur] = useState("");

  const patchCat = (id: string, patch: Partial<(typeof cats)[number]>) =>
    setSettings((s) => ({ ...s!, categories: s!.categories.map((c) => (c.id === id ? { ...c, ...patch } : c)) }));

  const addCat = () => {
    const name = newCat.trim();
    if (!name) return;
    setSettings((s) => ({ ...s!, categories: [...s!.categories, { id: uid(), name: name.slice(0, 40), limit: 0 }] }));
    setNewCat("");
  };

  const addCur = () => {
    const v = newCur.trim().toUpperCase();
    if (!/^[A-Z]{3,5}$/.test(v)) return toast("Введите код валюты латиницей, например RUB.");
    if (st.currencies.includes(v)) return setNewCur("");
    setSettings((s) => ({ ...s!, currencies: [...s!.currencies, v], rates: { ...s!.rates, [v]: null } }));
    setNewCur("");
  };

  return (
    <>
      <div className="mb-8 flex flex-wrap items-center gap-x-6 gap-y-4">
        <div className="flex items-center gap-3">
          <button className="grid size-9 place-items-center rounded-xl border border-line bg-paper text-lg shadow-card transition-colors hover:bg-bg" aria-label="Предыдущий месяц" onClick={() => setMonth(shiftMonth(month, -1))}>‹</button>
          <h1 className="m-0 min-w-[220px] text-center text-3xl font-bold tracking-tight">{monthTitle(month)}</h1>
          <button className="grid size-9 place-items-center rounded-xl border border-line bg-paper text-lg shadow-card transition-colors hover:bg-bg" aria-label="Следующий месяц" onClick={() => setMonth(shiftMonth(month, 1))}>›</button>
        </div>
        {month !== curMonthKey() && (
          <button className="btn-ghost" onClick={() => setMonth(curMonthKey())}>К текущему месяцу</button>
        )}
        <div className="ml-auto text-muted">Потрачено <b className="font-semibold text-ink">{fmt(totalS)}</b> из <b className="font-semibold text-ink">{fmt(totalL)} {st.base}</b></div>
      </div>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-5">
        {cats.map((c) => {
          const s = spent[c.id] ?? 0;
          const p = c.limit ? (s / c.limit) * 100 : s > 0 ? 101 : 0;
          const left = c.limit - s;
          const fill = left < 0 ? "bg-badt border-bad" : p >= 80 ? "bg-warnt border-warn" : "bg-okt border-ok";
          return (
            <article className="card" key={c.id}>
              <div className={`fill -z-10 ${fill}`} style={{ height: `${Math.min(100, p)}%` }} />
              <h3 className="pr-14 text-[17px] font-semibold">{c.name}</h3>
              <span className="absolute top-6 right-6 text-sm font-medium text-muted">{Math.round(p)}%</span>
              <div className={`mt-auto text-3xl leading-tight font-bold tracking-tight ${left < 0 ? "text-bad" : ""}`}>{left < 0 ? "−" : ""}{fmt(Math.abs(left))} <small className="text-sm font-medium tracking-normal text-muted">{st.base}</small></div>
              <div className="mt-2 text-sm text-muted">{left < 0 ? "перерасход" : "осталось"} · потрачено {fmt(s)} из {fmt(c.limit)}</div>
            </article>
          );
        })}
      </div>

      <details className="group mt-12 rounded-2xl border border-line bg-paper shadow-card">
        <summary className="flex cursor-pointer list-none items-center justify-between px-6 py-5 font-semibold [&::-webkit-details-marker]:hidden">Категории, лимиты и валюты<span className="text-muted transition-transform group-open:rotate-180">▾</span></summary>
        <div className="grid gap-10 border-t border-line px-6 pt-6 pb-7 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <div>
            <h4 className="mb-4 text-[15px] font-semibold">Месячные лимиты, {st.base}</h4>
            {cats.map((c) => (
              <div className="mb-3 grid grid-cols-[minmax(0,1fr)_130px_32px] items-center gap-3" key={c.id}>
                <CommitInput className="input w-full" aria-label="Название категории" value={c.name}
                  onCommit={(v) => { const n = v.trim(); if (!n) return false; patchCat(c.id, { name: n.slice(0, 40) }); }} />
                <CommitInput className="input w-full" aria-label="Лимит" inputMode="decimal" value={String(c.limit)}
                  onCommit={(v) => {
                    const n = parseAmount(v);
                    if (n === null || !(n >= 0)) { toast("Лимит должен быть числом."); return false; }
                    patchCat(c.id, { limit: n });
                  }} />
                <button className="x-btn" aria-label="Удалить категорию" onClick={() => {
                  patchCat(c.id, { archived: true });
                  toast(`Категория «${c.name}» удалена`, "Вернуть", () => patchCat(c.id, { archived: false }));
                }}>×</button>
              </div>
            ))}
            <div className="mt-4 flex flex-wrap gap-3">
              <input className="input min-w-0 flex-1" placeholder="Новая категория" value={newCat}
                onChange={(e) => setNewCat(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addCat()} />
              <button className="btn-ghost" onClick={addCat}>Добавить</button>
            </div>
          </div>

          <div>
            <h4 className="mb-4 text-[15px] font-semibold">Валюты для ввода</h4>
            <div className="mb-3 flex items-center gap-3"><b className="font-semibold text-ink">{st.base}</b><span className="hint">валюта лимитов</span></div>
            {st.currencies.filter((c) => c !== st.base).map((c) => (
              <div className="mb-3 flex items-center gap-3" key={c}>
                <b className="font-semibold text-ink">{c}</b>
                <span className="hint">
                  {st.rates[c] ? `последний курс ${fmt(st.rates[c]!)}` : "курс ещё не вводился"}
                </span>
                <button className="x-btn" aria-label={`Убрать валюту ${c}`} onClick={() =>
                  setSettings((s) => {
                    const rates = { ...s!.rates };
                    delete rates[c];
                    return { ...s!, currencies: s!.currencies.filter((x) => x !== c), rates };
                  })}>×</button>
              </div>
            ))}
            <div className="mt-4 flex flex-wrap gap-3">
              <input className="input min-w-0 flex-1" placeholder="Код валюты, например RUB" maxLength={5} value={newCur}
                onChange={(e) => setNewCur(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addCur()} />
              <button className="btn-ghost" onClick={addCur}>Добавить</button>
            </div>
            <p className="hint mt-4 leading-relaxed">Курс указывается при вводе траты и сохраняется вместе с ней, поэтому прошлые суммы не меняются.</p>

            <h4 className="mt-8 mb-4 text-[15px] font-semibold">Данные</h4>
            <div className="mt-4 flex flex-wrap gap-3"><ExportButton /><ImportButton /></div>
          </div>
        </div>
      </details>
    </>
  );
}
