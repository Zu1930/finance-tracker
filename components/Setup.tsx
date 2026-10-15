"use client";

import { useState } from "react";
import { useTracker } from "./TrackerProvider";
import { defaultSettings } from "@/lib/utils";

export function Setup() {
  const { setSettings } = useTracker();
  const [base, setBase] = useState("RSD");
  return (
    <section className="max-w-[60ch]">
      <h1 className="sec">Setup</h1>
      <p className="mt-4 text-muted">
        Выберите валюту, в которой будут лимиты. Траты в других валютах пересчитываются по курсу,
        который вы указываете при вводе. Категории и лимиты можно поменять потом на странице «Лимиты».
      </p>
      <div className="mt-6 flex flex-wrap items-end gap-x-4 gap-y-3">
        <label className="lbl self-center" htmlFor="baseSel">Base currency</label>
        <select id="baseSel" className="tfield cursor-pointer bg-panel" value={base} onChange={(e) => setBase(e.target.value)}>
          <option value="RSD">RSD — динар</option>
          <option value="EUR">EUR — евро</option>
          <option value="USD">USD — доллар</option>
          <option value="RUB">RUB — рубль</option>
        </select>
        <button className="tb font-bold" onClick={() => setSettings(() => defaultSettings(base))}>Создать категории</button>
      </div>
    </section>
  );
}
