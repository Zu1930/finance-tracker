"use client";

import { useState } from "react";
import { useTracker } from "./TrackerProvider";
import { defaultSettings, fmt } from "@/lib/utils";

/** Первая настройка бюджета: валюта лимитов и стартовые категории. В solo категории — личные, в семье — семейные */
export function Setup() {
  const { setSettings, setMySettings, isSolo } = useTracker();
  const [base, setBase] = useState("RSD");
  const draft = defaultSettings(base);
  const [off, setOff] = useState<Set<string>>(new Set());
  const cats = draft.familyCategories.filter((c) => !off.has(c.name));
  const toggle = (name: string) => setOff((s) => (s.has(name) ? new Set([...s].filter((x) => x !== name)) : new Set([...s, name])));

  const create = () => {
    if (!isSolo) return setSettings(() => ({ ...draft, familyCategories: cats }));
    setSettings(() => ({ ...draft, familyCategories: [] }));
    setMySettings((s) => ({ ...s, personalCategories: cats }));
  };

  return (
    <section className="max-w-[60ch]">
      <h1 className="sec">Настройка</h1>
      <p className="mt-4 text-muted">
        Выберите валюту, в которой будут лимиты. Траты в других валютах пересчитываются по курсу,
        который вы указываете при вводе. Категории и лимиты можно поменять потом на странице «Лимиты».
      </p>
      <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-3">
        <label className="lbl" htmlFor="baseSel">Валюта лимитов</label>
        <select id="baseSel" className="tfield cursor-pointer bg-panel" value={base} onChange={(e) => setBase(e.target.value)}>
          <option value="RSD">RSD — динар</option>
          <option value="EUR">EUR — евро</option>
          <option value="USD">USD — доллар</option>
          <option value="RUB">RUB — рубль</option>
        </select>
      </div>
      <h2 className="lbl mt-6">Стартовые категории</h2>
      <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Стартовые категории">
        {draft.familyCategories.map((c) => (
          <button key={c.name} className="tb tb-tight uppercase" aria-pressed={!off.has(c.name)} onClick={() => toggle(c.name)}>
            {c.name} {fmt(c.limit)}
          </button>
        ))}
      </div>
      <p className="mt-2 text-muted2 uppercase">// Лимиты в {base} в месяц. Можно начать и без категорий</p>
      <button className="tb mt-6 h-12 w-full font-bold sm:h-auto sm:w-auto sm:px-6" onClick={create}>
        Начать{cats.length ? ` · ${cats.length} категорий` : ""}
      </button>
    </section>
  );
}
