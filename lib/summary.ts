/**
 * «Итоги»: сколько потрачено за месяц и как это относится к обычному, куда ушли деньги, итоги прошлого месяца,
 * траты и доходы по месяцам. Данные — уже одного бюджета (summaryData). Тесты — lib/summary.test.mjs
 */
import { completedMonths, daysInMonth, dayOf, monthExpense, monthIncome, shiftKey } from "./metrics.ts";
import { catsIn } from "./utils.ts";
import { planSpentByCat } from "./plan.ts";
import type { Category, Expense, TrackerData } from "./types.ts";

/** Сравнение с обычным: до USUAL % — «как обычно» во фразе; до SAME % — «≈ обычно» у категории; от HIGH % — предупреждение */
export const USUAL = 3, SAME = 5, HIGH = 15;
/** Сколько завершённых месяцев — «обычный уровень» */
export const HISTORY = 3;
/** Ключ строки «Обязательные» — оплаты регулярных платежей */
export const REQUIRED = "required";

export type Row = { key: string; amount: number; avg: number | null; share: number; delta: number | null };
export type Headline = { kind: "usual" | "more" | "less"; pct: number; key: string | null };
export type Summary = {
  current: boolean;
  /** Сравниваем траты с 1-го по этот день (текущий месяц) или весь месяц */
  untilDay: number | undefined;
  spent: number;
  avg: number | null;
  headline: Headline | null;
  rows: Row[];
};

/** Данные бюджета для итогов: в «всё вместе» — семья + моё, без личных трат партнёра (как «Можно потратить») */
export const summaryData = (d: TrackerData): TrackerData => ({ ...d, partnerPersonalTotals: {}, partnerPersonalDaily: {} });

const own = (d: TrackerData, key: string): Expense[] => [...(d.familyExpenses[key] ?? []), ...(d.myExpenses[key] ?? [])];
const upTo = (date: string, untilDay?: number) => untilDay === undefined || dayOf(date) <= untilDay;
/** Строка, в которую попадает трата: регулярные — одной строкой, остальные — по категории своего бюджета */
export const rowKey = (e: Expense) => (e.recurringId ? REQUIRED : `${e.scope}:${e.catId}`);

/** Траты месяца по строкам; untilDay — с 1-го по этот день */
export function byRow(d: TrackerData, key: string, untilDay?: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of own(d, key)) if (upTo(e.date, untilDay)) out[rowKey(e)] = (out[rowKey(e)] ?? 0) + e.base;
  return out;
}

/** Месяц учитывается в «обычном», только если в нём есть траты */
const hasExpenses = (d: TrackerData, key: string) => own(d, key).length > 0;

/** Месяцы для «обычного»: текущий — 3 завершённых до него, прошлый — 3 месяца до него; только с тратами */
export function historyMonths(d: TrackerData, month: string, today: string): string[] {
  const keys = month === today.slice(0, 7) ? completedMonths(today, HISTORY) : Array.from({ length: HISTORY }, (_, i) => shiftKey(month, i - HISTORY));
  return keys.filter((k) => hasExpenses(d, k));
}

const pct = (v: number, avg: number) => Math.round(((v - avg) / avg) * 100);

/** Итоги месяца: текущий — на сегодняшний день против того же дня прошлых месяцев, прошлый — целиком */
export function summary(d: TrackerData, month: string, today: string): Summary {
  const current = month === today.slice(0, 7);
  const untilDay = current ? dayOf(today) : undefined;
  const rows = byRow(d, month, untilDay);
  const spent = monthExpense(d, month, untilDay);
  const hist = historyMonths(d, month, today);
  // Короче, чем day, месяц входит целиком
  const histRows = hist.map((k) => byRow(d, k, untilDay === undefined ? undefined : Math.min(untilDay, daysInMonth(k))));
  const avgOf = (key: string) => (hist.length ? histRows.reduce((a, r) => a + (r[key] ?? 0), 0) / hist.length : null);
  const avg = hist.length ? hist.reduce((a, k) => a + monthExpense(d, k, untilDay === undefined ? undefined : Math.min(untilDay, daysInMonth(k))), 0) / hist.length : null;

  const list: Row[] = Object.entries(rows)
    .filter(([, v]) => v > 0)
    .map(([key, amount]) => {
      const a = avgOf(key);
      return { key, amount, avg: a, share: spent > 0 ? Math.round((amount / spent) * 100) : 0, delta: a ? pct(amount, a) : null };
    })
    .sort((a, b) => b.amount - a.amount);

  let headline: Headline | null = null;
  if (avg && avg > 0) {
    const p = pct(spent, avg);
    if (Math.abs(p) <= USUAL) headline = { kind: "usual", pct: p, key: null };
    else {
      // Категория с наибольшим отклонением в деньгах, в том числе ушедшая в ноль
      const all = new Set([...list.map((r) => r.key), ...histRows.flatMap((r) => Object.keys(r))]);
      const dev = [...all].map((key) => ({ key, d: (rows[key] ?? 0) - (avgOf(key) ?? 0) })).sort((a, b) => (p > 0 ? b.d - a.d : a.d - b.d));
      headline = { kind: p > 0 ? "more" : "less", pct: Math.abs(p), key: dev[0]?.key ?? null };
    }
  }
  return { current, untilDay, spent, avg, headline, rows: list };
}

/** Изменение строки к среднему: ≈ обычно, рост (warn — от HIGH %) или снижение; null — сравнивать не с чем */
export function deltaOf(r: Pick<Row, "delta">): { kind: "same" | "up" | "down"; pct: number; warn: boolean } | null {
  if (r.delta === null) return null;
  if (Math.abs(r.delta) < SAME) return { kind: "same", pct: r.delta, warn: false };
  return { kind: r.delta > 0 ? "up" : "down", pct: Math.abs(r.delta), warn: r.delta >= HIGH };
}

/** Крупнейшие отклонения от лимитов месяца: перерасход (траты сверх лимита) и экономия (недотраченный лимит) */
export function limitExtremes(d: TrackerData, month: string, groups: { scope: "family" | "personal"; cats: Category[] }[]) {
  let over: { key: string; v: number } | null = null, saved: { key: string; v: number } | null = null;
  const plan = d.plans[month];
  for (const g of groups) {
    const fam = g.scope === "family";
    const spent = planSpentByCat((fam ? d.familyExpenses : d.myExpenses)[month] ?? [], (fam ? plan?.items.family : plan?.items.mine) ?? []);
    for (const c of catsIn(g.cats, month, spent, fam ? plan?.familyOverrides : plan?.myOverrides).filter((c) => !c.archived)) {
      const diff = (spent[c.id] ?? 0) - c.limit;
      const key = `${g.scope}:${c.id}`;
      if (diff > 0 && (!over || diff > over.v)) over = { key, v: diff };
      if (diff < 0 && c.limit > 0 && (!saved || -diff > saved.v)) saved = { key, v: -diff };
    }
  }
  return { over, saved };
}

/** Итоги прошлого месяца — только в первые 7 дней месяца */
export const RECAP_DAYS = 7;
export const showRecap = (today: string) => dayOf(today) <= RECAP_DAYS;
export const recapKey = (month: string) => `ft:recap:${month}`;

export type Bar = { key: string; expense: number; income: number };
/** Траты и доход по месяцам: n месяцев, последний — текущий */
export function bars(d: TrackerData, today: string, n = 6): Bar[] {
  const cur = today.slice(0, 7);
  return Array.from({ length: n }, (_, i) => shiftKey(cur, i - n + 1)).map((key) => ({ key, expense: monthExpense(d, key), income: monthIncome(d, key) }));
}
