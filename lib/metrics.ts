/**
 * Сравнительные показатели доходов и расходов. Чистые функции: на вход TrackerData и «сегодня»
 * строкой YYYY-MM-DD, чтобы тесты не зависели от часов. Все суммы — в базовой валюте (поле base).
 * Месяцы — ключи YYYY-MM. Только type-импорты: файл запускается напрямую через node --test.
 * Считается по семье: семейные траты + мои личные + личные суммы партнёра + доходы обоих.
 */
import type { TrackerData } from "./types.ts";
import { linkedByItem, plannedForecast } from "./plan.ts";
import { dueNow, occurrences, recurringTotal, type Occurrence } from "./recurring.ts";

/** Короткие названия месяцев для таблиц: СЕНТ, а не СЕН, чтобы не путать с «сен» на графике */
export const MONTHS_ABBR = ["ЯНВ", "ФЕВ", "МАР", "АПР", "МАЙ", "ИЮН", "ИЮЛ", "АВГ", "СЕНТ", "ОКТ", "НОЯ", "ДЕК"];

const pad = (n: number) => String(n).padStart(2, "0");
export const monthOf = (date: string) => date.slice(0, 7);
export const dayOf = (date: string) => Number(date.slice(8, 10));
export function shiftKey(key: string, delta: number): string {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}
export function daysInMonth(key: string): number {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}
export const abbr = (key: string) => MONTHS_ABBR[Number(key.slice(5, 7)) - 1];

const sumBase = (items: { base: number; date: string }[], untilDay?: number) =>
  items.reduce((a, x) => (untilDay === undefined || dayOf(x.date) <= untilDay ? a + x.base : a), 0);

/** Личные траты партнёра: известны только суммы по дням */
function partnerSpent(data: TrackerData, key: string, untilDay?: number): number {
  if (untilDay === undefined) return data.partnerPersonalTotals[key] ?? 0;
  const daily = data.partnerPersonalDaily[key] ?? {};
  return Object.entries(daily).reduce((a, [day, v]) => (Number(day) <= untilDay ? a + v : a), 0);
}

/** Расходы семьи за месяц; untilDay — только записи с 1-го по этот день включительно */
export const monthExpense = (data: TrackerData, key: string, untilDay?: number) =>
  sumBase(data.familyExpenses[key] ?? [], untilDay) + sumBase(data.myExpenses[key] ?? [], untilDay) + partnerSpent(data, key, untilDay);
export const monthIncome = (data: TrackerData, key: string, untilDay?: number) => sumBase(data.incomes[key] ?? [], untilDay);

const planItems = (data: TrackerData, key: string) => {
  const p = data.plans[key];
  return p ? [...p.items.family, ...p.items.mine] : [];
};
const ownExpenses = (data: TrackerData, key: string) => [...(data.familyExpenses[key] ?? []), ...(data.myExpenses[key] ?? [])];

/** Траты по пунктам плана: семейные и мои — по planItemId существующих пунктов, партнёра — суммы по дням */
export function monthPlanned(data: TrackerData, key: string, untilDay?: number): number {
  const ids = new Set(planItems(data, key).map((i) => i.id));
  const own = ownExpenses(data, key).filter((e) => e.planItemId && ids.has(e.planItemId));
  const partner = Object.entries(data.partnerPlannedDaily[key] ?? {}).reduce((a, [d, v]) => (untilDay === undefined || Number(d) <= untilDay ? a + v : a), 0);
  return sumBase(own, untilDay) + partner;
}
/** Оплаты регулярных платежей в месяце: свои и семейные по recurringId, партнёра — суммы по дням */
export function monthRecurringPaid(data: TrackerData, key: string, untilDay?: number): number {
  const own = ownExpenses(data, key).filter((e) => e.recurringId);
  const partner = Object.entries(data.partnerRecurringDaily?.[key] ?? {}).reduce((a, [d, v]) => (untilDay === undefined || Number(d) <= untilDay ? a + v : a), 0);
  return sumBase(own, untilDay) + partner;
}
/** Обычные траты — без связанных с планом и без регулярных: по ним экстраполяция и сравнения */
export const monthRegular = (data: TrackerData, key: string, untilDay?: number) =>
  monthExpense(data, key, untilDay) - monthPlanned(data, key, untilDay) - monthRecurringPaid(data, key, untilDay);

/** Вхождения регулярных месяца: семейные (оплаты среди семейных трат) и мои (среди моих личных) */
export function monthOccurrences(data: TrackerData, key: string, today: string): { family: Occurrence[]; mine: Occurrence[] } {
  const base = data.settings?.base ?? "", rates = data.settings?.rates ?? {};
  const rec = data.recurring ?? { family: [], mine: [] };
  return {
    family: occurrences(rec.family, key, Object.values(data.familyExpenses).flat(), today, base, rates),
    mine: occurrences(rec.mine, key, Object.values(data.myExpenses).flat(), today, base, rates),
  };
}

/** Регулярные месяца для плана и прогноза: факт оплаченных + оценка остальных, у партнёра — сумма с сервера */
export function monthRecurring(data: TrackerData, key: string, today: string): { family: number; mine: number; partner: number; total: number } {
  const occ = monthOccurrences(data, key, today);
  const family = recurringTotal(occ.family), mine = recurringTotal(occ.mine), partner = data.partnerRecurring?.[key] ?? 0;
  return { family, mine, partner, total: Math.round((family + mine + partner) * 100) / 100 };
}

/** Плановые траты месяца для прогноза: по каждому пункту max(сумма плана, связанные траты), включая партнёра */
export function monthPlannedForecast(data: TrackerData, key: string): number {
  const items = planItems(data, key);
  return plannedForecast(items, linkedByItem(ownExpenses(data, key), items)) + (data.plans[key]?.partner.plannedForecast ?? 0);
}

/** Ключи n последних полностью завершённых месяцев, от старых к новым (без текущего) */
export function completedMonths(today: string, n: number): string[] {
  const cur = monthOf(today);
  return Array.from({ length: n }, (_, i) => shiftKey(cur, i - n));
}

/** Месяц учитывается в средних, только если в нём есть хоть одна трата или поступление */
const hasRecords = (data: TrackerData, key: string) =>
  (data.familyExpenses[key]?.length ?? 0) + (data.myExpenses[key]?.length ?? 0) + (data.incomes[key]?.length ?? 0) > 0 ||
  (data.partnerPersonalTotals[key] ?? 0) > 0;

/** expense — все траты, regular — без связанных с планом */
export type Average = { income: number; expense: number; regular: number; months: number };

/** Средние доход и расход за n завершённых месяцев с записями; null — таких месяцев нет */
export function average(data: TrackerData, today: string, n = 3): Average | null {
  const keys = completedMonths(today, n).filter((k) => hasRecords(data, k));
  if (keys.length === 0) return null;
  const income = keys.reduce((a, k) => a + monthIncome(data, k), 0);
  const expense = keys.reduce((a, k) => a + monthExpense(data, k), 0);
  const regular = keys.reduce((a, k) => a + monthRegular(data, k), 0);
  return { income: income / keys.length, expense: expense / keys.length, regular: regular / keys.length, months: keys.length };
}

/** (доход − расход) / доход; null при нулевом доходе */
export const savingsRate = (income: number, expense: number) => (income > 0 ? (income - expense) / income : null);

/** Изменение в долях: 0.18 = +18%; null при нулевой базе */
export const change = (cur: number, prev: number) => (prev > 0 ? (cur - prev) / prev : null);

export type SavingsRates = { current: number | null; previous: number | null; average: number | null };

/** Норма сбережений: текущий месяц, прошлый, среднее за 3 завершённых (Σ доход − Σ расход) / Σ доход */
export function savingsRates(data: TrackerData, today: string): SavingsRates {
  const cur = monthOf(today);
  const prev = shiftKey(cur, -1);
  const avg = average(data, today);
  return {
    current: savingsRate(monthIncome(data, cur), monthExpense(data, cur)),
    previous: savingsRate(monthIncome(data, prev), monthExpense(data, prev)),
    // Отношение средних равно отношению сумм: месяцев одинаковое число в числителе и знаменателе
    average: avg ? savingsRate(avg.income, avg.expense) : null,
  };
}

export type Forecast = {
  spentSoFar: number;
  /** Все расходы на конец месяца = обычные (экстраполяция) + плановые */
  forecastExpense: number;
  /** Обычные траты, экстраполированные на месяц */
  forecastRegular: number;
    /** Плановые: по каждому пункту max(план, факт) */
  planned: number;
  /** Регулярные: факт оплаченных + оценка неоплаченных */
  recurring: number;
  expectedIncome: number;
  /** Полученного меньше среднего — доход взят по среднему за 3 месяца */
  incomeIsExpected: boolean;
  forecastBalance: number;
  /** Последний день месяца, на который прогноз */
  lastDay: number;
  /** Обычные траты: прогноз к среднему за 3 месяца; null — среднего нет */
  vsAverage: number | null;
  averageExpense: number | null;
};

/** Прогноз на конец месяца; null в первые 3 дня — слишком мало данных */
export function forecast(data: TrackerData, today: string): Forecast | null {
  const day = dayOf(today);
  if (day <= 3) return null;
  const cur = monthOf(today);
  const lastDay = daysInMonth(cur);
  const spentSoFar = monthExpense(data, cur);
  // Экстраполируются только обычные траты: покупка по плану не повторится до конца месяца
  const forecastRegular = (monthRegular(data, cur) / day) * lastDay;
    const planned = monthPlannedForecast(data, cur);
  const recurring = monthRecurring(data, cur, today).total;
  const forecastExpense = forecastRegular + planned + recurring;
  const got = monthIncome(data, cur);
  const avg = average(data, today);
  const incomeIsExpected = avg !== null && got < avg.income;
  const expectedIncome = incomeIsExpected ? avg!.income : got;
  return {
    spentSoFar,
    forecastExpense,
        forecastRegular,
    planned,
    recurring,
    expectedIncome,
    incomeIsExpected,
    forecastBalance: expectedIncome - forecastExpense,
    lastDay,
    vsAverage: avg ? change(forecastRegular, avg.regular) : null,
    averageExpense: avg ? avg.regular : null,
  };
}

export type PeriodCompare = { prevKey: string; prevDays: number; income: number | null; expense: number | null };

/** Честное сравнение: 1–N текущего месяца против 1–N прошлого (N не больше длины прошлого месяца) */
export function periodCompare(data: TrackerData, today: string): PeriodCompare {
  const cur = monthOf(today);
  const prevKey = shiftKey(cur, -1);
  const day = dayOf(today);
  const prevDays = Math.min(day, daysInMonth(prevKey));
  return {
    prevKey,
    prevDays,
    income: change(monthIncome(data, cur, day), monthIncome(data, prevKey, prevDays)),
    // Расходы сравниваются по обычным тратам: плановая покупка не делает месяц «дороже»
    expense: change(monthRegular(data, cur, day), monthRegular(data, prevKey, prevDays)),
  };
}

export type SeriesPoint = { key: string; expense: number; income: number; balance: number; cumulative: number };

/** Ряд для графика: расход, доход, остаток и нарастающий остаток с первого месяца диапазона */
export function monthlySeries(data: TrackerData, keys: string[]): SeriesPoint[] {
  let cumulative = 0;
  return keys.map((key) => {
    const expense = monthExpense(data, key);
    const income = monthIncome(data, key);
    cumulative += income - expense;
    return { key, expense, income, balance: income - expense, cumulative };
  });
}

/** 0.63 → «63%», null → «—» */
export const fmtPct = (x: number | null) => {
  if (x === null) return "—";
  const p = Math.round(x * 100);
  return `${p < 0 ? "−" : ""}${Math.abs(p)}%`;
};
/** Изменение со знаком: 0.04 → «+4%», −0.12 → «−12%», null → «—» */
export const fmtChange = (x: number | null) => {
  if (x === null) return "—";
  const p = Math.round(x * 100);
  return `${p > 0 ? "+" : p < 0 ? "−" : ""}${Math.abs(p)}%`;
};

/** Суммы base по авторам: вклад в семейные траты или доходы */
export function byAuthor<T extends { base: number; authorId: string }>(items: T[], filter: (x: T) => boolean = () => true) {
  const out: Record<string, number> = {};
  for (const x of items) if (filter(x)) out[x.authorId] = (out[x.authorId] ?? 0) + x.base;
  return out;
}

/** Регулярные в ответе GET /api/plan: вхождения своих и семейных, у партнёра — только сумма */
export function recurringPlanPart(data: TrackerData, month: string, today: string) {
  const occ = monthOccurrences(data, month, today);
  const r = monthRecurring(data, month, today);
  return { recurring: occ, recurringTotal: r.total, partnerRecurringTotal: r.partner };
}

/** GET /api/recurring/due: к оплате сейчас — свои и семейные */
export function dueResponse(data: TrackerData, today: string) {
  const base = data.settings?.base ?? "", rates = data.settings?.rates ?? {};
  const rec = data.recurring ?? { family: [], mine: [] };
  return {
    family: dueNow(rec.family, Object.values(data.familyExpenses).flat(), today, base, rates),
    mine: dueNow(rec.mine, Object.values(data.myExpenses).flat(), today, base, rates),
  };
}
