import type { Category, Expense, Settings } from "./types";

export const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Date.now().toString(36) + Math.random().toString(36).slice(2);

const nf = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 });
export const fmt = (n: number) => nf.format(Math.round(n * 100) / 100);

const pad = (n: number) => String(n).padStart(2, "0");
export const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
export const monthKeyOf = (date: string) => "m-" + date.slice(0, 7);
export const curMonthKey = () => monthKeyOf(todayStr());

export const MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
export const MONTHS_SHORT = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
export const monthTitle = (key: string) => {
  const [y, m] = key.slice(2).split("-");
  return `${MONTHS[+m - 1]} ${y}`;
};
export const shiftMonth = (key: string, delta: number) => {
  let [y, m] = key.slice(2).split("-").map(Number);
  m += delta;
  while (m < 1) { m += 12; y--; }
  while (m > 12) { m -= 12; y++; }
  return `m-${y}-${pad(m)}`;
};

/** «1 250,50», «450+120», «500-50» → число; null — пусто; NaN — мусор */
/** Оставляет только символы, допустимые в сумме: цифры, разделители, + и − для выражений */
export const amountChars = (raw: string) => raw.replace(/[^\d.,+\-\s]/g, "");

export function parseAmount(raw: string): number | null {
  const s = raw.replace(/\s|\u00a0/g, "").replace(/,/g, ".");
  if (!s) return null;
  if (!/^[\d.]+([+-][\d.]+)*$/.test(s)) return NaN;
  let sum = 0;
  for (const p of s.match(/[+-]?[\d.]+/g) ?? []) {
    const v = Number(p);
    if (!Number.isFinite(v)) return NaN;
    sum += v;
  }
  return Math.round(sum * 100) / 100;
}

export const activeCats = (s: Settings | null): Category[] => (s?.categories ?? []).filter((c) => !c.archived);

export function spentByCat(expenses: Expense[]): Record<string, number> {
  const m: Record<string, number> = {};
  for (const e of expenses) m[e.catId] = (m[e.catId] ?? 0) + e.base;
  return m;
}

export function defaultSettings(base: string): Settings {
  const table: Record<string, Record<string, number>> = {
    RSD: { EUR: 117.2, USD: 100.5 },
    EUR: { RSD: 0.0085, USD: 0.86 },
    USD: { RSD: 0.00995, EUR: 1.16 },
  };
  const currencies = [base, ...["RSD", "EUR", "USD"].filter((c) => c !== base)];
  const rates: Settings["rates"] = {};
  for (const c of currencies) if (c !== base) rates[c] = table[base]?.[c] ?? null;
  const k = base === "RSD" ? 1 : base === "RUB" ? 0.8 : 0.0085;
  const round = base === "EUR" || base === "USD" ? 10 : 100;
  const lim = (v: number) => Math.round((v * k) / round) * round;
  const names: [string, number][] = [
    ["Продукты", 40000], ["Кафе и рестораны", 15000], ["Транспорт", 6000], ["Дом и связь", 20000],
    ["Здоровье", 8000], ["Развлечения", 10000], ["Одежда", 10000], ["Прочее", 8000],
  ];
  return { base, currencies, rates, categories: names.map(([name, l]) => ({ id: uid(), name, limit: lim(l) })) };
}
