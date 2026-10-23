import type { Category, Expense, IncomeSource, Settings } from "./types";

export const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Date.now().toString(36) + Math.random().toString(36).slice(2);

const nf = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 });
/** До копеек; всё, что округляется в ноль, — ровно 0, без «-0» */
const cents = (n: number) => {
  const r = Math.round(n * 100) / 100;
  return r === 0 ? 0 : r;
};
export const fmt = (n: number) => nf.format(cents(n));
/** +1 250 / −300; ноль — «0» без знака */
export const signed = (n: number) => {
  const r = cents(n);
  return r === 0 ? "0" : `${r < 0 ? "−" : "+"}${fmt(Math.abs(r))}`;
};
/** Расход со знаком: −1 250; ноль — «0» без знака */
export const minus = (n: number) => (cents(n) === 0 ? "0" : `−${fmt(Math.abs(n))}`);
/** Курс: значимые цифры вместо копеек, чтобы 1 RSD = 0,00853 EUR не превращался в 0,01 */
const rf = new Intl.NumberFormat("ru-RU", { maximumSignificantDigits: 6 });
export const fmtRate = (n: number) => rf.format(n);

const pad = (n: number) => String(n).padStart(2, "0");
export const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
/** Месяц YYYY-MM — ключ во всех данных */
export const monthKeyOf = (date: string) => date.slice(0, 7);
export const curMonthKey = () => monthKeyOf(todayStr());
/** Локальный день YYYY-MM-DD из ISO-времени */
export const localDay = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
/** 2026-10-01 → 01.10 */
export const ddmm = (day: string) => `${day.slice(8, 10)}.${day.slice(5, 7)}`;

export const MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
export const MONTHS_SHORT = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
/** «в октябре» */
export const MONTHS_IN = ["январе", "феврале", "марте", "апреле", "мае", "июне", "июле", "августе", "сентябре", "октябре", "ноябре", "декабре"];
export const monthName = (key: string) => MONTHS[Number(key.slice(5, 7)) - 1];
export const monthTitle = (key: string) => {
  const [y, m] = key.split("-");
  return `${MONTHS[+m - 1]} ${y}`;
};
export const shiftMonth = (key: string, delta: number) => {
  let [y, m] = key.split("-").map(Number);
  m += delta;
  while (m < 1) { m += 12; y--; }
  while (m > 12) { m -= 12; y++; }
  return `${y}-${pad(m)}`;
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

/** «Кафе и рестораны» → «КАФЕ_И_РЕСТОРАНЫ». Только для отображения */
export const termName = (name: string) => name.trim().toUpperCase().replace(/\s+/g, "_");

export const DEFAULT_INCOME_SOURCES: IncomeSource[] = [
  { id: "salary", name: "Зарплата" },
  { id: "freelance", name: "Фриланс" },
  { id: "gift", name: "Подарок" },
  { id: "refund", name: "Возврат" },
  { id: "other", name: "Прочее" },
];
export const incomeSources = (s: Settings | null): IncomeSource[] => s?.incomeSources ?? DEFAULT_INCOME_SOURCES;

/** Действующие (не удалённые) категории из списка */
export const liveCats = (cats: Category[] | undefined): Category[] => (cats ?? []).filter((c) => !c.archived);
/** Семейные категории */
export const activeCats = (s: Settings | null): Category[] => liveCats(s?.familyCategories);

/** Лимит категории в месяце key: первый из прежних, действовавший до key включительно, иначе текущий */
export const limitIn = (c: Category, key: string) => c.history?.find((h) => key <= h.until)?.limit ?? c.limit;
/** Категория существовала в месяце key. У старых удалённых без archivedFrom месяц удаления неизвестен */
export const aliveIn = (c: Category, key: string) =>
  (!c.since || c.since <= key) && (c.archivedFrom ? key < c.archivedFrom : !c.archived);
/**
 * Категории месяца с его лимитами: существовавшие тогда и старые удалённые, по которым в нём были траты.
 * overrides — поправки плана на этот месяц
 */
export const catsIn = (cats: Category[] | undefined, key: string, spent: Record<string, number>, overrides?: Record<string, number>): Category[] =>
  (cats ?? [])
    .filter((c) => aliveIn(c, key) || (!c.archivedFrom && c.archived && spent[c.id]))
    .map((c) => ({ ...c, limit: overrides?.[c.id] ?? limitIn(c, key) }));
/** Новый лимит действует с месяца from; прежний запоминается для месяцев до него */
export function setLimit(c: Category, limit: number, from: string): Category {
  if (limit === c.limit) return c;
  const until = shiftMonth(from, -1);
  const last = c.history?.at(-1);
  // Прежний уже записан (вторая правка за месяц) или до from категории не было
  if ((last && last.until >= until) || (c.since && c.since > until)) return { ...c, limit };
  return { ...c, limit, history: [...(c.history ?? []), { until, limit: c.limit }] };
}

/** Недавно использованные категории первыми; неиспользованные — в исходном порядке после них */
export function byRecentUse(cats: Category[], months: Record<string, Expense[]>): Category[] {
  const last: Record<string, number> = {};
  for (const list of Object.values(months)) for (const e of list) last[e.catId] = Math.max(last[e.catId] ?? 0, e.ts);
  return [...cats].sort((a, b) => (last[b.id] ?? 0) - (last[a.id] ?? 0));
}

export function spentByCat(expenses: Expense[]): Record<string, number> {
  const m: Record<string, number> = {};
  for (const e of expenses) m[e.catId] = (m[e.catId] ?? 0) + e.base;
  return m;
}

/** Первая настройка: семейные категории с лимитами по умолчанию */
export function defaultSettings(base: string): Omit<Settings, "version"> {
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
  return { base, currencies, rates, familyCategories: names.map(([name, l]) => ({ id: uid(), name, limit: lim(l) })), schemaVersion: 2 };
}

/** Сравнение секретов за постоянное время (токены, CRON_SECRET) */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
