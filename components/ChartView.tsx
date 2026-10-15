"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTracker } from "./TrackerProvider";
import { useNarrow } from "./AsciiBar";
import { fmtPct, monthlySeries, savingsRate } from "@/lib/metrics";
import { MONTHS_SHORT, activeCats, curMonthKey, fmt, monthTitle, shiftMonth, spentByCat, termName } from "@/lib/utils";

/** Цвет категории — токен cat-1…cat-8 по её индексу в списке категорий */
const catColor = (i: number) => `var(--cat-${(i % 8) + 1})`;
const H = 360, L = 70, T = 24, B = 40;
/** Подписи сумм над столбцами только если столбец достаточно широк, иначе они наезжают друг на друга */
const MIN_LABEL_SLOT = 64;
/** Накопленный остаток рисуется по общей оси, если неотрицателен и не больше 1.5× её максимума */
const SHARED_AXIS_FACTOR = 1.5;

type Layer = "expense" | "income" | "cumulative";
const LAYERS: { id: Layer; label: string }[] = [
  { id: "expense", label: "Расходы" },
  { id: "income", label: "+ Доходы" },
  { id: "cumulative", label: "+ Накоплено" },
];

/** Круглая шкала от lo до hi: шаг 1/2/5 × 10^n, около 4 делений */
function niceScale(lo: number, hi: number) {
  const raw = Math.max(hi - lo, 1) / 4, pow = 10 ** Math.floor(Math.log10(raw)), n = raw / pow;
  const step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
  const min = Math.floor(lo / step) * step, max = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let v = min; v <= max + step * 1e-9; v += step) ticks.push(v);
  return { min, max, ticks };
}

export function ChartView() {
  const { data, setMonth } = useTracker();
  const router = useRouter();
  const [range, setRange] = useState(6);
  const [on, setOn] = useState<Record<Layer, boolean>>({ expense: true, income: true, cumulative: false });
  // На узком экране рисуем в меньшей системе координат, чтобы график влез без горизонтального скролла
  const narrow = useNarrow();
  const W = narrow ? 420 : 900;
  const st = data.settings!;

  const keys: string[] = [];
  for (let i = 0, k = curMonthKey(); i < range; i++, k = shiftMonth(k, -1)) keys.unshift(k);
  const perMonth = keys.map((k) => spentByCat(data.months[k]?.expenses ?? []));
  const series = monthlySeries(data, keys.map((k) => k.slice(2)));
  const used = st.categories.filter((c) => !c.archived || perMonth.some((d) => d[c.id]));
  const color: Record<string, string> = {};
  st.categories.forEach((c, i) => (color[c.id] = catColor(i)));
  const limitSum = activeCats(st).reduce((a, c) => a + c.limit, 0);

  // Левая ось: расходы, лимиты и доходы включённых слоёв
  const leftMax = Math.max(
    1,
    ...(on.expense ? [limitSum, ...series.map((p) => p.expense)] : []),
    ...(on.income ? series.map((p) => p.income) : []),
  );
  const cums = series.map((p) => p.cumulative);
  const cMin = Math.min(0, ...cums), cMax = Math.max(0, ...cums);
  const shared = cMin >= 0 && cMax <= leftMax * SHARED_AXIS_FACTOR;
  const rightAxis = on.cumulative && !shared;
  const left = niceScale(0, on.cumulative && shared ? Math.max(leftMax, cMax) : leftMax);
  const right = niceScale(cMin, cMax);

  // Правое поле под самую длинную подпись правой оси (≈7.2 единицы на символ при 12px)
  const R = rightAxis ? 14 + Math.max(...right.ticks.map((v) => fmt(v).length)) * 7.2 : 16;
  const cw = W - L - R, ch = H - T - B, slot = cw / keys.length, bw = Math.min(64, slot * 0.58);
  const labels = slot >= MIN_LABEL_SLOT;
  const y = (v: number) => T + ch - (v / left.max) * ch;
  const yR = (v: number) => T + ch - ((v - right.min) / (right.max - right.min)) * ch;
  const yCum = rightAxis ? yR : y;

  const periodTotal: Record<string, number> = {};
  perMonth.forEach((d) => { for (const id in d) periodTotal[id] = (periodTotal[id] ?? 0) + d[id]; });
  const sumIncome = series.reduce((a, p) => a + p.income, 0);
  const sumExpense = series.reduce((a, p) => a + p.expense, 0);
  const sumBalance = sumIncome - sumExpense;

  const open = (k: string) => { setMonth(k); router.push("/limits"); };
  const cx = (i: number) => L + i * slot + slot / 2;

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <h1 className="sec">Monthly spending</h1>
        <div className="flex flex-wrap gap-2 sm:ml-auto">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Слои графика">
            {LAYERS.map((l) => (
              <button key={l.id} className="tb" aria-pressed={on[l.id]} onClick={() => setOn((s) => ({ ...s, [l.id]: !s[l.id] }))}>
                {l.label}
              </button>
            ))}
          </div>
          <div className="flex gap-2" role="group" aria-label="Период">
            {[6, 12].map((r) => (
              <button key={r} className="tb tb-tight" aria-pressed={range === r} onClick={() => setRange(r)}>{r} мес.</button>
            ))}
          </div>
        </div>
      </div>
      <div className="mt-6 overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label="Расходы, доходы и накопленный остаток по месяцам">
          {left.ticks.map((v) => (
            <g key={v}>
              <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="var(--line2)" strokeDasharray="3 4" />
              <text x={L - 10} y={y(v) + 4} textAnchor="end" fontSize="12" fill="var(--muted)">{fmt(v)}</text>
            </g>
          ))}
          {rightAxis && right.ticks.map((v) => (
            <g key={v}>
              <line x1={W - R} x2={W - R + 4} y1={yR(v)} y2={yR(v)} stroke="var(--muted)" />
              <text x={W - R + 8} y={yR(v) + 4} fontSize="12" fill="var(--muted)">{fmt(v)}</text>
            </g>
          ))}
          {rightAxis && <line x1={W - R} x2={W - R} y1={T} y2={T + ch} stroke="var(--line2)" />}

          {keys.map((k, i) => {
            const p = series[i];
            const x = L + i * slot + (slot - bw) / 2;
            let acc = 0;
            const [yy, mm] = k.slice(2).split("-");
            // Подписи расхода и дохода рядом — меньшая уходит под свою отметку, чтобы не наложиться
            const yE = y(p.expense), yI = y(p.income);
            const clash = on.expense && on.income && p.expense > 0 && p.income > 0 && Math.abs(yE - yI) < 16;
            const expenseLabelY = clash && p.expense < p.income ? yE + 14 : yE - 6;
            const incomeLabelY = clash && p.income <= p.expense ? yI + 16 : yI - 7;
            return (
              <g key={k} className="cursor-pointer outline-none [&:focus-visible>rect:first-child]:fill-hover [&:focus-visible>rect:first-child]:stroke-ink [&:hover>rect:first-child]:fill-hover" role="button" tabIndex={0}
                aria-label={`${monthTitle(k)}: расход ${fmt(p.expense)}, доход ${fmt(p.income)} ${st.base}`}
                onClick={() => open(k)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(k); } }}>
                <rect x={L + i * slot} y={T} width={slot} height={ch} fill="transparent" />
                {on.expense && used.filter((c) => perMonth[i][c.id]).map((c) => {
                  const v = perMonth[i][c.id];
                  const y1 = y(acc + v), h = y(acc) - y1;
                  acc += v;
                  return (
                    <rect key={c.id} x={x} y={y1} width={bw} height={Math.max(h, 0.5)} fill={color[c.id]}>
                      <title>{`${c.name}: ${fmt(v)} ${st.base}`}</title>
                    </rect>
                  );
                })}
                {on.expense && labels && p.expense > 0 && (
                  <text x={x + bw / 2} y={expenseLabelY} textAnchor="middle" fontSize="12" fontWeight="700" fill="var(--ink)">
                    {fmt(p.expense)}
                  </text>
                )}
                {on.income && p.income > 0 && (
                  <>
                    <line x1={x - 4} x2={x + bw + 4} y1={yI} y2={yI} stroke="var(--ink)" strokeWidth={2}>
                      <title>{`Доход: ${fmt(p.income)} ${st.base}`}</title>
                    </line>
                    {labels && (
                      <text x={x + bw / 2} y={incomeLabelY} textAnchor="middle" fontSize="12" fill="var(--ink)">
                        +{fmt(p.income)}
                      </text>
                    )}
                  </>
                )}
                <text x={x + bw / 2} y={H - B + 18} textAnchor="middle" fontSize="12"
                  fill={k === curMonthKey() ? "var(--ink)" : "var(--muted)"}>
                  {MONTHS_SHORT[+mm - 1]}{mm === "01" || i === 0 ? ` ${yy.slice(2)}` : ""}
                </text>
              </g>
            );
          })}

          {on.expense && limitSum > 0 && (
            <>
              <line x1={L} x2={W - R} y1={y(limitSum)} y2={y(limitSum)} stroke="var(--ink)" strokeDasharray="5 4" strokeWidth={1.5} />
              <text x={W - R} y={y(limitSum) - 6} textAnchor="end" fontSize="12" fill="var(--ink)">СУММА ЛИМИТОВ {fmt(limitSum)}</text>
            </>
          )}

          {on.cumulative && (
            <g aria-hidden="true">
              {rightAxis && cMin < 0 && (
                <line x1={L} x2={W - R} y1={yR(0)} y2={yR(0)} stroke="var(--muted)" strokeWidth={0.75} />
              )}
              <polyline points={series.map((p, i) => `${cx(i)},${yCum(p.cumulative)}`).join(" ")}
                fill="none" stroke="var(--muted)" strokeWidth={1.5} strokeDasharray="6 4" />
              {series.map((p, i) => (
                <circle key={p.key} cx={cx(i)} cy={yCum(p.cumulative)} r={3} fill="var(--panel)" stroke="var(--muted)" strokeWidth={1.5}>
                  <title>{`Накоплено к концу ${monthTitle(keys[i])}: ${fmt(p.cumulative)} ${st.base}`}</title>
                </circle>
              ))}
            </g>
          )}
        </svg>
      </div>

      <p className="mt-6 border-t border-dashed border-line pt-4 uppercase">
        <span className="text-muted">Доход</span> {fmt(sumIncome)}
        <span className="text-muted"> // Расход</span> {fmt(sumExpense)}
        <span className="text-muted"> // Остаток</span>{" "}
        <span className={sumBalance < 0 ? "text-bad" : ""}>{sumBalance < 0 ? "−" : "+"}{fmt(Math.abs(sumBalance))}</span>
        <span className="text-muted"> // Норма</span> {fmtPct(savingsRate(sumIncome, sumExpense))}
      </p>
      <ul className="mt-3 grid grid-cols-1 gap-x-12 sm:grid-cols-2">
        {used.map((c) => (
          <li key={c.id} className="flex items-baseline gap-2 py-0.5">
            <span aria-hidden="true" style={{ color: color[c.id] }}>■</span>
            <span className="shrink-0">{termName(c.name)}</span>
            <span aria-hidden="true" className="min-w-4 flex-1 overflow-hidden whitespace-nowrap text-dim">{".".repeat(80)}</span>
            <b className="shrink-0">{fmt(periodTotal[c.id] ?? 0)}</b>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-muted2 uppercase">
        // Суммы в {st.base}. Черта — доход месяца{on.cumulative ? (rightAxis ? ", пунктир — накопленный остаток (шкала справа)" : ", пунктир — накопленный остаток") : ""}. Нажмите на столбец, чтобы открыть лимиты этого месяца
      </p>
    </>
  );
}
