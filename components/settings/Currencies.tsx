"use client";

import { useState } from "react";
import { useTracker } from "../TrackerProvider";
import { fmtRate } from "@/lib/utils";
import { SettingsRow } from "./Kit";

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
      <SettingsRow end={<span className="text-xs text-muted uppercase">Основная</span>}>
        <b>{st.base}</b>
      </SettingsRow>
      {st.currencies.filter((c) => c !== st.base).map((c) => (
        <SettingsRow key={c} end={
          <button className="xb" aria-label={`Убрать валюту ${c}`} onClick={() =>
            setSettings((s) => {
              const rates = { ...s!.rates };
              delete rates[c];
              return { ...s!, currencies: s!.currencies.filter((x) => x !== c), rates };
            })}>×</button>
        }>
          <b>{c}</b>{" "}
          <span className="text-muted">{st.rates[c] ? `${fmtRate(st.rates[c]!)} ${st.base}` : "курс ещё не известен"}</span>
        </SettingsRow>
      ))}
      <div className="mt-3 flex max-w-md items-end gap-4">
        <input className="tfield flex-1 uppercase" placeholder="код, например RUB" aria-label="Код валюты" maxLength={5} value={newCur}
          onChange={(e) => setNewCur(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addCur()} />
        <button className="tb uppercase" onClick={addCur}>Добавить</button>
      </div>
      <p className="mt-3 text-xs text-muted2">
        Курсы обновляются раз в день ·{" "}
        <a className="underline underline-offset-4 hover:text-link-hover" href="https://www.exchangerate-api.com" target="_blank" rel="noopener noreferrer">ExchangeRate-API</a>.
        При вводе траты курс можно поправить.
      </p>
    </div>
  );
}
