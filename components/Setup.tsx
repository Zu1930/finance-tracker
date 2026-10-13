"use client";

import { useState } from "react";
import { useTracker } from "./TrackerProvider";
import { defaultSettings } from "@/lib/utils";
import { ImportButton } from "./ImportExport";

export function Setup() {
  const { setSettings } = useTracker();
  const [base, setBase] = useState("RSD");
  return (
    <section className="panel max-w-[560px]">
      <h1 className="mb-2 text-[26px] font-bold tracking-tight">Настроим трекер</h1>
      <p className="mb-5 text-muted">
        Выберите валюту, в которой будут лимиты. Траты в других валютах пересчитываются по курсу,
        который вы указываете при вводе. Категории и лимиты можно поменять потом на странице «Лимиты».
      </p>
      <label className="mb-2 block text-sm text-muted" htmlFor="baseSel">Валюта лимитов</label>
      <div className="flex flex-wrap gap-3">
        <select id="baseSel" className="input" value={base} onChange={(e) => setBase(e.target.value)}>
          <option value="RSD">RSD — динар</option>
          <option value="EUR">EUR — евро</option>
          <option value="USD">USD — доллар</option>
          <option value="RUB">RUB — рубль</option>
        </select>
        <button className="btn" onClick={() => setSettings(() => defaultSettings(base))}>Создать категории</button>
      </div>
      <p className="hint mt-6 mb-2">Уже вели трекер в Claude? Загрузите экспорт оттуда:</p>
      <ImportButton />
    </section>
  );
}
