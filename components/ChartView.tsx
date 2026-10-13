"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTracker } from "./TrackerProvider";
import { useNarrow } from "./AsciiBar";
import { MONTHS_SHORT, activeCats, curMonthKey, fmt, monthTitle, shiftMonth, spentByCat, termName } from "@/lib/utils";

/** Цвет категории — токен cat-1…cat-8 по её индексу в списке категорий */
const catColor = (i: number) => `var(--cat-${(i % 8) + 1})`;
const H = 360, L = 70, R = 16, T = 16, B = 40;

export function ChartView() {
  const { data, setMonth } = useTracker();
  const router = useRouter();
  const [range, setRange] = useState(6);
  // На узком экране рисуем в меньшей системе координат, чтобы график влез без горизонтального скролла
  const W = useNarrow() ? 420 : 900;
  const st = data.settings!;

  const keys: string[] = [];
  for (let i = 0, k = curMonthKey(); i < range; i++, k = shiftMonth(k, -1)) keys.unshift(k);
  const perMonth = keys.map((k) => spentByCat(data.months[k]?.expenses ?? []));
  const used = st.categories.filter((c) => !c.archived || perMonth.some((d) => d[c.id]));
  const color: Record<string, string> = {};
  st.categories.forEach((c, i) => (color[c.id] = catColor(i)));
  const totals = perMonth.map((d) => Object.values(d).reduce((a, b) => a + b, 0));
  const limitSum = activeCats(st).reduce((a, c) => a + c.limit, 0);

  const maxV = Math.max(limitSum, ...totals, 1);
  const raw = maxV / 4, pow = 10 ** Math.floor(Math.log10(raw)), n = raw / pow;
  const step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
  const top = Math.ceil(maxV / step) * step;
  const cw = W - L - R, ch = H - T - B, slot = cw / keys.length, bw = Math.min(64, slot * 0.58);
  const y = (v: number) => T + ch - (v / top) * ch;
  const ticks: number[] = [];
  for (let v = 0; v <= top + 1e-9; v += step) ticks.push(v);

  const periodTotal: Record<string, number> = {};
  perMonth.forEach((d) => { for (const id in d) periodTotal[id] = (periodTotal[id] ?? 0) + d[id]; });

  const open = (k: string) => { setMonth(k); router.push("/limits"); };

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <h1 className="sec">Monthly spending</h1>
        <div className="flex gap-2 sm:ml-auto" role="group" aria-label="Период">
          {[6, 12].map((r) => (
            <button key={r} className="tb tb-tight" aria-pressed={range === r} onClick={() => setRange(r)}>{r} мес.</button>
          ))}
        </div>
      </div>
      <div className="mt-6 overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label="Траты по месяцам с разбивкой по категориям">
          {ticks.map((v) => (
            <g key={v}>
              <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="var(--line2)" strokeDasharray="3 4" />
              <text x={L - 10} y={y(v) + 4} textAnchor="end" fontSize="12" fill="var(--muted)">{fmt(v)}</text>
            </g>
          ))}
          {keys.map((k, i) => {
            const x = L + i * slot + (slot - bw) / 2;
            let acc = 0;
            const [yy, mm] = k.slice(2).split("-");
            return (
              <g key={k} className="cursor-pointer outline-none [&:focus-visible>rect:first-child]:fill-hover [&:focus-visible>rect:first-child]:stroke-ink [&:hover>rect:first-child]:fill-hover" role="button" tabIndex={0}
                aria-label={`${monthTitle(k)}: ${fmt(totals[i])} ${st.base}`}
                onClick={() => open(k)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(k); } }}>
                <rect x={L + i * slot} y={T} width={slot} height={ch} fill="transparent" />
                {used.filter((c) => perMonth[i][c.id]).map((c) => {
                  const v = perMonth[i][c.id];
                  const y1 = y(acc + v), h = y(acc) - y1;
                  acc += v;
                  return (
                    <rect key={c.id} x={x} y={y1} width={bw} height={Math.max(h, 0.5)} fill={color[c.id]}>
                      <title>{`${c.name}: ${fmt(v)} ${st.base}`}</title>
                    </rect>
                  );
                })}
                {totals[i] > 0 && (
                  <text x={x + bw / 2} y={y(totals[i]) - 6} textAnchor="middle" fontSize="12" fontWeight="700" fill="var(--ink)">
                    {fmt(totals[i])}
                  </text>
                )}
                <text x={x + bw / 2} y={H - B + 18} textAnchor="middle" fontSize="12"
                  fill={k === curMonthKey() ? "var(--ink)" : "var(--muted)"}>
                  {MONTHS_SHORT[+mm - 1]}{mm === "01" || i === 0 ? ` ${yy.slice(2)}` : ""}
                </text>
              </g>
            );
          })}
          {limitSum > 0 && (
            <>
              <line x1={L} x2={W - R} y1={y(limitSum)} y2={y(limitSum)} stroke="var(--ink)" strokeDasharray="5 4" strokeWidth={1.5} />
              <text x={W - R} y={y(limitSum) - 6} textAnchor="end" fontSize="12" fill="var(--ink)">СУММА ЛИМИТОВ {fmt(limitSum)}</text>
            </>
          )}
        </svg>
      </div>
      <ul className="mt-6 grid grid-cols-1 gap-x-12 border-t border-dashed border-line pt-4 sm:grid-cols-2">
        {used.map((c) => (
          <li key={c.id} className="flex items-baseline gap-2 py-0.5">
            <span aria-hidden="true" style={{ color: color[c.id] }}>■</span>
            <span className="shrink-0">{termName(c.name)}</span>
            <span aria-hidden="true" className="min-w-4 flex-1 overflow-hidden whitespace-nowrap text-dim">{".".repeat(80)}</span>
            <b className="shrink-0">{fmt(periodTotal[c.id] ?? 0)}</b>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-muted2 uppercase">// Суммы в {st.base}. Нажмите на столбец, чтобы открыть лимиты этого месяца</p>
    </>
  );
}
