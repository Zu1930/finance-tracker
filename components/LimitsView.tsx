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
      <div className="limits-head">
        <div className="month">
          <button aria-label="Предыдущий месяц" onClick={() => setMonth(shiftMonth(month, -1))}>‹</button>
          <h1>{monthTitle(month)}</h1>
          <button aria-label="Следующий месяц" onClick={() => setMonth(shiftMonth(month, 1))}>›</button>
        </div>
        {month !== curMonthKey() && (
          <button className="btn ghost" onClick={() => setMonth(curMonthKey())}>К текущему месяцу</button>
        )}
        <div className="total">Потрачено <b>{fmt(totalS)}</b> из <b>{fmt(totalL)} {st.base}</b></div>
      </div>

      <div className="grid">
        {cats.map((c) => {
          const s = spent[c.id] ?? 0;
          const p = c.limit ? (s / c.limit) * 100 : s > 0 ? 101 : 0;
          const left = c.limit - s;
          const cls = left < 0 ? "over" : p >= 80 ? "warn" : "";
          return (
            <article className={`card ${cls}`} key={c.id}>
              <div className="fill" style={{ height: `${Math.min(100, p)}%` }} />
              <h3>{c.name}</h3>
              <span className="pct">{Math.round(p)}%</span>
              <div className="left">{left < 0 ? "−" : ""}{fmt(Math.abs(left))} <small>{st.base}</small></div>
              <div className="of">{left < 0 ? "перерасход" : "осталось"} · потрачено {fmt(s)} из {fmt(c.limit)}</div>
            </article>
          );
        })}
      </div>

      <details className="settings">
        <summary>Категории, лимиты и валюты</summary>
        <div className="settings-body">
          <div>
            <h4>Месячные лимиты, {st.base}</h4>
            {cats.map((c) => (
              <div className="srow" key={c.id}>
                <CommitInput className="input" aria-label="Название категории" value={c.name}
                  onCommit={(v) => { const n = v.trim(); if (!n) return false; patchCat(c.id, { name: n.slice(0, 40) }); }} />
                <CommitInput className="input" aria-label="Лимит" inputMode="decimal" value={String(c.limit)}
                  onCommit={(v) => {
                    const n = parseAmount(v);
                    if (n === null || !(n >= 0)) { toast("Лимит должен быть числом."); return false; }
                    patchCat(c.id, { limit: n });
                  }} />
                <button className="x" aria-label="Удалить категорию" onClick={() => {
                  patchCat(c.id, { archived: true });
                  toast(`Категория «${c.name}» удалена`, "Вернуть", () => patchCat(c.id, { archived: false }));
                }}>×</button>
              </div>
            ))}
            <div className="add">
              <input className="input" placeholder="Новая категория" value={newCat}
                onChange={(e) => setNewCat(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addCat()} />
              <button className="btn ghost" onClick={addCat}>Добавить</button>
            </div>
          </div>

          <div>
            <h4>Валюты для ввода</h4>
            <div className="rrow"><b>{st.base}</b><span className="hint" style={{ margin: 0 }}>валюта лимитов</span></div>
            {st.currencies.filter((c) => c !== st.base).map((c) => (
              <div className="rrow" key={c}>
                <b>{c}</b>
                <span className="hint" style={{ margin: 0 }}>
                  {st.rates[c] ? `последний курс ${fmt(st.rates[c]!)}` : "курс ещё не вводился"}
                </span>
                <button className="x" aria-label={`Убрать валюту ${c}`} onClick={() =>
                  setSettings((s) => {
                    const rates = { ...s!.rates };
                    delete rates[c];
                    return { ...s!, currencies: s!.currencies.filter((x) => x !== c), rates };
                  })}>×</button>
              </div>
            ))}
            <div className="add">
              <input className="input" placeholder="Код валюты, например RUB" maxLength={5} value={newCur}
                onChange={(e) => setNewCur(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addCur()} />
              <button className="btn ghost" onClick={addCur}>Добавить</button>
            </div>
            <p className="hint">Курс указывается при вводе траты и сохраняется вместе с ней, поэтому прошлые суммы не меняются.</p>

            <h4 style={{ marginTop: 24 }}>Данные</h4>
            <div className="add"><ExportButton /><ImportButton /></div>
          </div>
        </div>
      </details>
    </>
  );
}
