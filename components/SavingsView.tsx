"use client";

import { useState } from "react";
import { useTracker } from "./TrackerProvider";
import { AsciiBar } from "./AsciiBar";
import { downloadJson } from "./ImportExport";
import { Accounts } from "./savings/Accounts";
import { Goals } from "./savings/Goals";
import { abbr, average } from "@/lib/metrics";
import { allocated, allocation, byCurrency, monthChange, monthEndSeries, runway, totals } from "@/lib/savings";
import { curMonthKey, fmt, shiftMonth, signed, todayStr } from "@/lib/utils";

const MONTHS = 6;

export function SavingsView() {
  const { data } = useTracker();
  const st = data.settings!;
  const sv = data.savings;
  const mineAccounts = [...sv.accounts.family, ...sv.accounts.mine];
  // Итог одинаков у обоих: семейные + мои по курсу + сумма партнёра, которую сервер посчитал по тем же курсам
  const t = totals(mineAccounts, st.base, st.rates);
  const partner = sv.partner.total;
  const all = t.all + partner;
  const mine = t.byUser[data.me.id] ?? 0;
  const goalsAlloc = allocated([...sv.goals.family, ...sv.goals.mine], st.base, st.rates);
  const { allocated: alloc, free } = allocation(goalsAlloc.total + sv.partner.goalsAllocated, all);
  const months = runway(free, average(data, todayStr())?.expense);
  const change = monthChange(sv.recons, curMonthKey(), all);
  const currencies = Object.entries(byCurrency(mineAccounts)).sort(([a], [b]) => (a === st.base ? -1 : b === st.base ? 1 : a.localeCompare(b)));
  const empty = mineAccounts.every((a) => a.archived) && !sv.partner.lastUpdatedAt;

  return (
    <>
      {sv.migration && <MigrationBanner />}
      <section>
        <h1 className="sec">Всего</h1>
        <p className="mt-2 flex flex-wrap items-baseline gap-x-4">
          <b className="text-[44px] leading-tight">{fmt(Math.round(all))} {st.base}</b>
          {change !== null && <span className={`uppercase ${change < 0 ? "text-bad" : "text-muted"}`}>{signed(Math.round(change))} за месяц</span>}
        </p>
        {t.missing.length > 0 && <p className="text-warn uppercase">!! Нет курса: {t.missing.join(", ")} — эти счета не входят в итог</p>}
        <dl className="mt-3 grid grid-cols-1 gap-x-6 uppercase sm:grid-cols-[12ch_minmax(0,1fr)] sm:gap-y-1">
          <dt className="text-muted max-sm:mt-2">Чьи</dt>
          <dd>Семья {fmt(Math.round(t.family))} · Моё {fmt(Math.round(mine))} · {data.partner.name} {fmt(Math.round(partner))}</dd>
          <dt className="text-muted max-sm:mt-2">Валюты</dt>
          <dd>
            {currencies.length ? currencies.map(([c, v]) => `${c} ${fmt(v)}`).join(" · ") : "—"}
            <span className="text-muted"> · {data.partner.name} ≈ {fmt(Math.round(partner))} {st.base}</span>
          </dd>
          <dt className="text-muted max-sm:mt-2">Запас</dt>
          <dd>
            {months === null ? "—" : <><b className={months < 1 ? "text-warn" : ""}>{fmt(months)} мес расходов</b><span className="text-muted"> // свободными</span></>}
          </dd>
        </dl>
      </section>

      <Accounts />
      <Goals allocated={alloc} free={free} missing={goalsAlloc.missing} empty={empty} />
      <Dynamics current={all} />
    </>
  );
}

/** Остаток на конец месяца за полгода; перенесённые без сверки — серым с «~» */
function Dynamics({ current }: { current: number }) {
  const { data } = useTracker();
  const base = data.settings!.base;
  const cur = curMonthKey();
  const keys = Array.from({ length: MONTHS }, (_, i) => shiftMonth(cur, i - MONTHS + 1));
  const series = monthEndSeries(data.savings.recons, keys, { key: cur, value: current });
  const max = Math.max(0, ...series.map((p) => p.value ?? 0));

  return (
    <section className="mt-8 border-t border-dashed border-line pt-5">
      <h2 className="sec">Динамика // на конец месяца</h2>
      <ul className="mt-3 space-y-1 uppercase">
        {series.map((p, i) => {
          const prev = series[i - 1]?.value;
          const diff = p.value !== null && prev !== null && prev !== undefined ? p.value - prev : null;
          return (
            // На мобильном шкала уходит отдельной строкой под месяцем и суммой
            <li key={p.key} className={`grid grid-cols-[6ch_minmax(0,1fr)_auto] items-baseline gap-x-4 max-sm:pb-1 sm:grid-cols-[6ch_auto_16ch_10ch] ${p.carried ? "text-muted" : ""}`}>
              <span className={p.carried ? "" : "text-muted"}>{abbr(p.key)}</span>
              <div className="col-span-full max-sm:order-last sm:col-span-1">
                <AsciiBar value={p.value ?? 0} max={max} bare label={`${abbr(p.key)}: остаток`} />
              </div>
              <b className={`text-right ${p.carried ? "font-normal" : ""}`}>{p.value === null ? "—" : `${p.carried ? "~" : ""}${fmt(Math.round(p.value))} ${base}`}</b>
              <span className="text-right text-muted">{diff === null || p.carried ? "" : signed(Math.round(diff))}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Старые копилки ещё в ft:goals: перенос запускает MIGRATION_OWNER, сначала скачивается копия */
function MigrationBanner() {
  const { data, api, toast } = useTracker();
  const m = data.savings.migration!;
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    const backup = await fetch("/api/migrate-v3").then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (!backup) {
      setBusy(false);
      return toast("Не удалось скачать копию — перенос не запущен.");
    }
    downloadJson(backup, `goals-backup-${todayStr()}.json`);
    const res = await api<{ goals: number }>("/api/migrate-v3", "POST");
    setBusy(false);
    if (res) toast(`Перенесено копилок: ${res.goals}`);
  };
  return (
    <section className="mb-8 border border-dashed border-line2 px-3 py-3 uppercase">
      <p>&gt; Старых копилок: {m.goals}. Они станут семейными, суммы и валюты сохранятся</p>
      {m.owner.id === data.me.id ? (
        <button className="tb mt-3" disabled={busy} onClick={() => void run()}>Перенести копилки</button>
      ) : (
        <p className="mt-1 text-muted">// Перенос запускает {m.owner.name}</p>
      )}
    </section>
  );
}
