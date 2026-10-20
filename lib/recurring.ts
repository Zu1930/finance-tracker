/**
 * Регулярные платежи: вхождения месяца, сроки, суммы по истории цены, статус оплаты, проверки.
 * Чистые функции — их вызывают route handlers, клиент и тесты (lib/recurring.test.mjs). «Сегодня» — параметром.
 * Статус оплаты не хранится: платёж за месяц оплачен, если есть трата с его recurringId и recurringMonth.
 */
import type { Category, Expense, RecurringPayment, Scope } from "./types.ts";

export type Rates = Record<string, number | null | undefined>;
export type OccurrenceStatus = "paid" | "overdue" | "upcoming";

export type Occurrence = {
  paymentId: string;
  name: string;
  /** YYYY-MM-DD: день платежа, не позже последнего дня месяца */
  dueDate: string;
  amount: number;
  currency: string;
  approx: boolean;
  categoryId: string;
  scope: Scope;
  /** amount по текущему курсу; null — курса нет */
  estimateBase: number | null;
  status: OccurrenceStatus;
  expenseId?: string;
  paidBase?: number;
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const pad = (n: number) => String(n).padStart(2, "0");
const lastDay = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};
export const shiftMonth = (month: string, delta: number) => {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
};

/** Есть ли у платежа вхождение в месяце (без учёта пропуска — его показывают зачёркнутым) */
export function scheduledIn(p: RecurringPayment, month: string): boolean {
  if (month < p.startMonth || (p.endMonth && month > p.endMonth)) return false;
  return p.frequency === "monthly" || Number(month.slice(5, 7)) === p.month;
}
/** Вхождение входит в план: по расписанию, не на паузе и не пропущено */
export const activeIn = (p: RecurringPayment, month: string) => scheduledIn(p, month) && !p.paused && !p.skips.includes(month);

/** День платежа в месяце: 31 → 30/28/29, 29 февраля в невисокосный год → 28-е */
export const dueDate = (p: RecurringPayment, month: string) => `${month}-${pad(Math.min(p.day, lastDay(month)))}`;

/** Сумма в месяце: последняя запись истории с fromMonth ≤ месяца */
export function amountIn(p: RecurringPayment, month: string): number {
  const hit = [...p.amounts].sort((a, b) => a.fromMonth.localeCompare(b.fromMonth)).filter((a) => a.fromMonth <= month).at(-1);
  return hit?.amount ?? p.amounts[0]?.amount ?? 0;
}

const toBase = (amount: number, currency: string, base: string, rates: Rates) => {
  if (currency === base) return amount;
  const r = rates[currency];
  return r ? r2(amount * r) : null;
};

/** Оплата платежа за месяц среди трат (её дата может быть и в следующем месяце) */
export const paymentOf = (p: RecurringPayment, month: string, expenses: Expense[]) =>
  expenses.find((e) => e.recurringId === p.id && e.recurringMonth === month);

/**
 * Вхождения месяца по дате. expenses — траты, среди которых ищется оплата (семейные для семейных платежей,
 * свои личные — для своих). Пропущенные и на паузе не входят
 */
export function occurrences(payments: RecurringPayment[], month: string, expenses: Expense[], today: string, base: string, rates: Rates): Occurrence[] {
  return payments
    .filter((p) => activeIn(p, month))
    .map((p): Occurrence => {
      const amount = amountIn(p, month);
      const due = dueDate(p, month);
      const paid = paymentOf(p, month, expenses);
      return {
        paymentId: p.id, name: p.name, dueDate: due, amount, currency: p.currency, approx: p.approx,
        categoryId: p.categoryId, scope: p.scope,
        estimateBase: toBase(amount, p.currency, base, rates),
        status: paid ? "paid" : due < today ? "overdue" : "upcoming",
        ...(paid && { expenseId: paid.id, paidBase: paid.base }),
      };
    })
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.name.localeCompare(b.name, "ru"));
}

/** Итог регулярных месяца: факт оплаченных + оценка остальных (без курса — 0) */
export const recurringTotal = (occ: Occurrence[]) => r2(occ.reduce((a, o) => a + (o.paidBase ?? o.estimateBase ?? 0), 0));

/**
 * К оплате: просроченные и со сроком сегодня в текущем месяце; в первые 7 дней нового месяца — ещё неоплаченные прошлого
 */
export function dueNow(payments: RecurringPayment[], expenses: Expense[], today: string, base: string, rates: Rates): (Occurrence & { month: string })[] {
  const cur = today.slice(0, 7);
  const now = occurrences(payments, cur, expenses, today, base, rates)
    .filter((o) => o.status === "overdue" || (o.status === "upcoming" && o.dueDate === today))
    .map((o) => ({ ...o, month: cur }));
  if (Number(today.slice(8, 10)) > 7) return now;
  const prev = shiftMonth(cur, -1);
  const late = occurrences(payments, prev, expenses, today, base, rates).filter((o) => o.status !== "paid").map((o) => ({ ...o, month: prev }));
  return [...late, ...now];
}

/** Ежегодные платежи с вхождением не в этом месяце — для строки под списком */
export function yearlyElsewhere(payments: RecurringPayment[], month: string): RecurringPayment[] {
  return payments.filter((p) => p.frequency === "yearly" && !p.paused && !p.endMonth && Number(month.slice(5, 7)) !== p.month);
}

// ---------- Проверки ----------
/**
 * Можно ли записать трату как оплату платежа за recurringMonth. payment ищется в хеше scope траты у пользователя
 * сессии — чужой личный приходит как null. paid — уже есть оплата этого месяца
 */
export function payLinkError(
  payment: RecurringPayment | null,
  e: Pick<Expense, "catId" | "scope" | "recurringMonth" | "planItemId">,
  paid: boolean,
): { status: number; error: string } | null {
  if (!payment) return { status: 403, error: "Платёж не найден." };
  if (e.planItemId) return { status: 400, error: "Трата не может быть и по плану, и регулярной." };
  if (!e.recurringMonth || payment.scope !== e.scope || payment.categoryId !== e.catId) return { status: 400, error: "Трата не совпадает с платежом." };
  if (!activeIn(payment, e.recurringMonth)) return { status: 400, error: "В этом месяце платежа нет." };
  if (paid) return { status: 409, error: "Этот месяц уже оплачен." };
  return null;
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
export const isMonth = (v: unknown): v is string => typeof v === "string" && MONTH.test(v);
const isCode = (v: unknown): v is string => typeof v === "string" && /^[A-Z]{3,5}$/.test(v);
const intIn = (v: unknown, lo: number, hi: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi;

/** Новый платёж из тела POST /api/recurring; категория — действующая своего scope, валюта — из списка семьи */
export function prepareRecurring(
  body: unknown,
  userId: string,
  cats: { family: Category[]; mine: Category[] },
  currencies: string[],
  id: string,
): RecurringPayment | null {
  const b = (body ?? {}) as Record<string, unknown>;
  const name = typeof b.name === "string" ? b.name.trim().slice(0, 40) : "";
  const scope: Scope = b.scope === "personal" ? "personal" : "family";
  const frequency = b.frequency === "yearly" ? "yearly" : "monthly";
  const amount = b.amount;
  if (!name || typeof amount !== "number" || !Number.isFinite(amount) || !(amount > 0)) return null;
  if (!isCode(b.currency) || !currencies.includes(b.currency) || !intIn(b.day, 1, 31) || !isMonth(b.startMonth)) return null;
  if (frequency === "yearly" && !intIn(b.month, 1, 12)) return null;
  if (!(scope === "personal" ? cats.mine : cats.family).some((c) => c.id === b.categoryId && !c.archived)) return null;
  return {
    id, name, currency: b.currency, approx: b.approx === true, frequency, day: b.day,
    ...(frequency === "yearly" && { month: b.month as number }),
    categoryId: b.categoryId as string, scope, ...(scope === "personal" && { ownerId: userId }),
    startMonth: b.startMonth, paused: false, skips: [],
    amounts: [{ fromMonth: b.startMonth, amount: r2(amount) }], createdBy: userId, version: 1,
  };
}

/** Новая цена с fromMonth: история не переписывается, запись с тем же месяцем заменяется */
export const withAmount = (p: RecurringPayment, amount: number, fromMonth: string): RecurringPayment => ({
  ...p,
  amounts: [...p.amounts.filter((a) => a.fromMonth !== fromMonth), { fromMonth, amount: r2(amount) }].sort((a, b) => a.fromMonth.localeCompare(b.fromMonth)),
});

/** Ближайший месяц без оплаты, начиная с текущего — по умолчанию для смены цены */
export function nextUnpaidMonth(p: RecurringPayment, today: string, expenses: Expense[]): string {
  let m = today.slice(0, 7);
  for (let i = 0; i < 24; i++, m = shiftMonth(m, 1)) if (!activeIn(p, m) || !paymentOf(p, m, expenses)) return m;
  return m;
}

/** «Удаление»: платёж заканчивается текущим месяцем, если он уже оплачен (или его в месяце нет), иначе прошлым */
export function endMonthOnDelete(p: RecurringPayment, today: string, expenses: Expense[]): string {
  const cur = today.slice(0, 7);
  return activeIn(p, cur) && !paymentOf(p, cur, expenses) ? shiftMonth(cur, -1) : cur;
}

/** Похожий неоплаченный платёж для ручной траты: та же категория, сумма в пределах ±10% */
export function matchPayment(occ: (Occurrence & { month: string })[], catId: string, base: number): (Occurrence & { month: string }) | undefined {
  return occ.find((o) => o.status !== "paid" && o.categoryId === catId && o.estimateBase !== null && Math.abs(base - o.estimateBase) <= o.estimateBase * 0.1);
}
