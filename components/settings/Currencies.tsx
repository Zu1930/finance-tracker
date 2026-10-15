"use client";

import { useState } from "react";
import { useTracker } from "../TrackerProvider";
import { fmtRate } from "@/lib/utils";

/** Валюты для ввода: список с курсами, добавление и удаление */
export function Currencies() {
  const { data, setSettings, toast } = useTracker();
  const st = data.settings!;
  const [newCur, setNewCur] = useState("");

  const addCur = () => {
    const v = newCur.trim().toUpperCase();
    if (!/^[A-Z]{3,5}$/.test(v)) return toast("Введите код валюты латиницей, например RUB.");
    if (st.currencies.includes(v)) return setNewCur("");
    setSettings((s) => ({ ...s!, currencies: [...s!.currencies, v], rates: { ...s!.rates, [v]: null } }));
    setNewCur("");
  };

  return (
    <div>
      <div className="flex min-h-11 items-center gap-3"><b>{st.base}</b><span className="text-muted2 uppercase">// валюта лимитов</span></div>
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
      <div className="mt-2 flex max-w-md items-end gap-4">
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
    </div>
  );
}
