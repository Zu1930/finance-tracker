"use client";

import { useState } from "react";
import { useTracker } from "./TrackerProvider";
import { AsciiBar } from "./AsciiBar";
import { Hint } from "./onboarding/Hint";
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
  // Ни одного счёта ни у кого — пустое состояние: вместо нулей приглашение завести первый счёт
  const empty = mineAccounts.every((a) => a.archived) && !sv.partner.lastUpdatedAt;
  const [openFirst, setOpenFirst] = useState(false);

  return (
    <>
      <section>
        <h1 className="sec">Всего</h1>
        {empty ? (
          <>
            <p className="mt-3 text-lg font-bold uppercase">Счетов пока нет</p>
            <p className="mt-1 text-muted uppercase">Добавьте счета и сделайте первую сверку — от неё пойдёт отсчёт.</p>
            <button className="tb mt-4 h-12 w-full font-bold sm:w-auto sm:px-6" onClick={() => setOpenFirst(true)}>+ Первый счёт</button>
          </>
        ) : (
        <>
        <p className="mt-2 flex flex-wrap items-baseline gap-x-4">
          <b className="text-[36px] leading-tight sm:text-[44px]">{fmt(Math.round(all))} {st.base}</b>
          {change !== null && <span className={`uppercase ${change < 0 ? "text-bad" : "text-muted"}`}>{signed(Math.round(change))} за месяц</span>}
        </p>
        {t.missing.length > 0 && <p className="text-warn uppercase">!! Нет курса: {t.missing.join(", ")} — эти счета не входят в итог</p>}
        <dl className="mt-3 grid grid-cols-1 gap-x-6 uppercase sm:grid-cols-[12ch_minmax(0,1fr)] sm:gap-y-1">
          {data.partner && (
            <>
              <dt className="text-muted max-sm:mt-2">Чьи</dt>
              <dd>Семья {fmt(Math.round(t.family))} · Моё {fmt(Math.round(mine))} · {data.partner.name} {fmt(Math.round(partner))}</dd>
            </>
          )}
          <dt className="text-muted max-sm:mt-2">Валюты</dt>
          <dd>
            {currencies.length ? currencies.map(([c, v]) => `${c} ${fmt(v)}`).join(" · ") : "—"}
            {data.partner && <span className="text-muted"> · {data.partner.name} ≈ {fmt(Math.round(partner))} {st.base}</span>}
          </dd>
          <dt className="text-muted max-sm:mt-2">Запас</dt>
          <dd>
            {months === null ? "—" : <><b className={months < 1 ? "text-warn" : ""}>{fmt(months)} мес расходов</b><span className="text-muted"> // свободными</span></>}
          </dd>
        </dl>
        </>
        )}
      </section>

      <Hint id="savings" className="mt-6" />
      <Accounts openFamily={openFirst} />
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
            // Мобильный: месяц | шкала 14 символов | сумма; изменение к прошлому месяцу только на десктопе
            <li key={p.key} className={`grid grid-cols-[5ch_auto_minmax(0,1fr)] items-baseline gap-x-3 sm:grid-cols-[6ch_auto_16ch_10ch] sm:gap-x-4 ${p.carried ? "text-muted" : ""}`}>
              <span className={p.carried ? "" : "text-muted"}>{abbr(p.key)}</span>
              <AsciiBar value={p.value ?? 0} max={max} bare narrowWidth={14} label={`${abbr(p.key)}: остаток`} />
              <b className={`text-right whitespace-nowrap ${p.carried ? "font-normal" : ""}`}>{p.value === null ? "—" : `${p.carried ? "~" : ""}${fmt(Math.round(p.value))} ${base}`}</b>
              <span className="text-right text-muted max-sm:hidden">{diff === null || p.carried ? "" : signed(Math.round(diff))}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
