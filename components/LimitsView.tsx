"use client";

import { useState } from "react";
import { useTracker } from "./TrackerProvider";
import { CommitInput } from "./CommitInput";
import { ExportButton, ImportButton } from "./ImportExport";
import { AsciiBar } from "./AsciiBar";
import { BaseCurrency } from "./BaseCurrency";
import { activeCats, amountChars, curMonthKey, fmt, monthTitle, parseAmount, shiftMonth, spentByCat, termName, uid, fmtRate } from "@/lib/utils";

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
          Config<span aria-hidden="true" className="group-open:hidden">[+]</span><span aria-hidden="true" className="hidden group-open:inline">[−]</span>
        </summary>
        <div className="grid grid-cols-1 gap-x-12 gap-y-8 pt-3 pb-2 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <div>
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
          </div>

          <div>
            <h3 className="lbl">Currencies</h3>
            <div className="mt-2 flex min-h-11 items-center gap-3"><b>{st.base}</b><span className="text-muted2 uppercase">// валюта лимитов</span></div>
            {st.currencies.filter((c) => c !== st.base).map((c) => (
              <div className="flex min-h-11 items-center gap-3" key={c}>
                <b>{c}</b>
                <span className="text-muted2 uppercase">
                  // {st.rates[c] ? `курс ${fmtRate(st.rates[c]!)} ${st.base}` : "курс ещё не известен"}
                </span>
                <button className="xb ml-auto" aria-label={`Убрать валюту ${c}`} onClick={() =>
                  setSettings((s) => {
                    const rates = { ...s!.rates };
                    delete rates[c];
                    return { ...s!, currencies: s!.currencies.filter((x) => x !== c), rates };
                  })}>×</button>
              </div>
            ))}
            <div className="mt-2 flex items-end gap-4">
              <input className="tfield flex-1 uppercase" placeholder="код, например RUB" aria-label="Код валюты" maxLength={5} value={newCur}
                onChange={(e) => setNewCur(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addCur()} />
              <button className="tb" onClick={addCur}>Добавить</button>
            </div>
            <p className="mt-3 text-muted2">
              // Курсы обновляются раз в день{st.ratesUpdatedAt ? `, последнее обновление ${st.ratesUpdatedAt}` : ""}.{" "}
              <a className="underline underline-offset-4 hover:text-link-hover" href="https://www.exchangerate-api.com" target="_blank" rel="noopener noreferrer">
                Rates By Exchange Rate API
              </a>
            </p>
            <p className="mt-2 text-muted2">// Курс можно поправить при вводе траты. Он сохраняется вместе с ней, поэтому прошлые суммы не меняются.</p>

            <h3 className="lbl mt-8">Data</h3>
            <div className="mt-3 flex flex-wrap gap-2"><ExportButton /><ImportButton /></div>
          </div>

          <BaseCurrency />
        </div>
      </details>
    </>
  );
}
