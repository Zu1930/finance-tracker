/**
 * Журнал операций: баланс счёта не хранится, а вычисляется из записей. Чистые функции без базы данных —
 * их вызывают route handlers, клиент, скрипт миграции и тесты (lib/ledger.test.mjs). Только type-импорты и относительные .ts.
 *
 * Суммы записей — в валюте счёта. Курс нужен только в двух местах: прогресс цели (части на счетах в разных валютах
 * приводятся к валюте цели по ТЕКУЩЕМУ курсу) и итоги видов в базовой валюте.
 */

import type { Account, Expense, Income, LedgerMove } from "./types.ts";

export type Rates = Record<string, number | null | undefined>;

const r2 = (n: number) => Math.round(n * 100) / 100;

export type LedgerAccount = {
  id: string;
  ownerId: string;
  name: string;
  currency: string;
  /** Остаток на дату перехода (или создания счёта) */
  initial: number;
  /** День, с которого считаются операции, YYYY-MM-DD */
  initialAt: string;
  /** Основной счёт владельца: на него миграция кладёт части целей, на него по умолчанию идут записи без счёта */
  primary?: boolean;
  archived?: boolean;
  version: number;
};

export type EntryType = "income" | "expense" | "transfer" | "adjustment";

/** Запись журнала в общем виде: доходы и траты приходят из своих таблиц, переводы и корректировки — из ledger_moves */
export type LedgerEntry = {
  id: string;
  userId: string;
  type: EntryType;
  accountId: string;
  /** Только для transfer */
  toAccountId?: string;
  /** В валюте счёта, > 0; у adjustment — со знаком */
  amount: number;
  /** transfer: сколько пришло на toAccountId в его валюте; нет — та же сумма (одна валюта) */
  toAmount?: number;
  /** Платили в другой валюте: исходная сумма и курс */
  origAmount?: number;
  origCurrency?: string;
  rate?: number;
  /** Только у expense; у остальных всегда personal */
  scope: "personal" | "family";
  categoryId?: string;
  sourceId?: string;
  /** Трата «из цели» */
  goalId?: string;
  day: string;
  ts: number;
  /** Запись до миграции: остаётся для истории и лимитов, в баланс не идёт */
  legacy?: boolean;
};

export type LedgerGoal = {
  id: string;
  name: string;
  scope: "personal" | "family";
  /** Для personal */
  ownerId?: string;
  target: number;
  currency: string;
};

/** Часть цели на конкретном счёте, в валюте счёта */
export type GoalAlloc = { goalId: string; accountId: string; amount: number; version: number };

// ---------- Баланс ----------

/** Как запись меняет счёт accountId (в его валюте). 0 — не касается */
export function delta(e: LedgerEntry, accountId: string): number {
  let d = 0;
  if (e.accountId === accountId) {
    if (e.type === "income") d += e.amount;
    else if (e.type === "expense" || e.type === "transfer") d -= e.amount;
    else if (e.type === "adjustment") d += e.amount;
  }
  if (e.type === "transfer" && e.toAccountId === accountId) d += e.toAmount ?? e.amount;
  return d;
}

/** Запись идёт в баланс на день today: не legacy, не раньше initialAt счёта и не позже today (позже — план) */
const counts = (e: LedgerEntry, from: string, today: string) => !e.legacy && e.day >= from && e.day <= today;

/** Баланс на конец дня today: initial + операции по счёту с day ∈ [initialAt, today] */
export function balance(account: Pick<LedgerAccount, "id" | "initial" | "initialAt">, entries: LedgerEntry[], today: string): number {
  let b = account.initial;
  if (today < account.initialAt) return r2(b);
  for (const e of entries) if (counts(e, account.initialAt, today)) b += delta(e, account.id);
  return r2(b);
}

/** Сколько зарезервировано под цели на счёте */
export function reserved(accountId: string, allocs: GoalAlloc[]): number {
  let s = 0;
  for (const a of allocs) if (a.accountId === accountId) s += a.amount;
  return r2(s);
}

/** Свободно = баланс − резерв. Меньше нуля — только после траты без отметки «из цели»: UI предупреждает */
export const free = (bal: number, res: number) => r2(bal - res);

export type AccountState = { account: LedgerAccount; balance: number; reserved: number; free: number; overdrawn: boolean };

export function accountState(account: LedgerAccount, entries: LedgerEntry[], allocs: GoalAlloc[], today: string): AccountState {
  const bal = balance(account, entries, today);
  const res = reserved(account.id, allocs);
  const f = free(bal, res);
  return { account, balance: bal, reserved: res, free: f, overdrawn: f < 0 };
}

// ---------- Резервы и цели ----------

/**
 * Новая часть цели на счёте (PUT /goals/:id/alloc). Строка — почему нельзя: только со своего счёта,
 * не больше free + текущей части
 */
export function checkAlloc(o: { next: number; current: number; free: number; accountOwnerId: string; userId: string }): string | null {
  if (!Number.isFinite(o.next) || o.next < 0) return "Неверная сумма.";
  if (o.accountOwnerId !== o.userId) return "Резервировать можно только со своего счёта.";
  const max = r2(o.free + o.current);
  if (r2(o.next) > max) return `Свободно только ${max}.`;
  return null;
}

/** Трата из цели: часть на счёте уменьшается на сумму траты, но не ниже 0 */
export const allocAfterSpend = (part: number, spent: number) => r2(Math.max(0, part - spent));

/** Корректировка: разница между фактом и балансом. null — совпадает, записывать нечего */
export function adjustmentAmount(actual: number, bal: number): number | null {
  const d = r2(actual - bal);
  return d === 0 ? null : d;
}

/** Сумма из одной валюты в другую через базу по текущим курсам (база = 1). null — курса нет */
export function convert(amount: number, from: string, to: string, base: string, rates: Rates): number | null {
  if (from === to) return amount;
  const rf = from === base ? 1 : rates[from];
  const rt = to === base ? 1 : rates[to];
  return rf && rt ? (amount * rf) / rt : null;
}

export type GoalProgress = {
  goal: LedgerGoal;
  /** Σ частей в валюте цели по текущему курсу */
  total: number;
  /** userId → вклад в валюте цели */
  byUser: Record<string, number>;
  /** Валюты счетов без курса: их части не вошли */
  missing: string[];
};

/** Прогресс цели: Σ частей, приведённых к валюте цели по текущему курсу. Единственное место итога по текущему курсу */
export function goalProgress(goal: LedgerGoal, allocs: GoalAlloc[], accounts: LedgerAccount[], base: string, rates: Rates): GoalProgress {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const byUser: Record<string, number> = {};
  const missing = new Set<string>();
  let total = 0;
  for (const p of allocs) {
    if (p.goalId !== goal.id || !p.amount) continue;
    const acc = byId.get(p.accountId);
    if (!acc) continue;
    const v = convert(p.amount, acc.currency, goal.currency, base, rates);
    if (v === null) { missing.add(acc.currency); continue; }
    total += v;
    byUser[acc.ownerId] = (byUser[acc.ownerId] ?? 0) + v;
  }
  for (const k in byUser) byUser[k] = r2(byUser[k]);
  return { goal, total: r2(total), byUser, missing: [...missing] };
}

// ---------- Статистика ----------

/** Доход или трата. Переводы и корректировки не входят ни в статистику, ни в лимиты */
export const isFlow = (e: LedgerEntry) => e.type === "income" || e.type === "expense";

// ---------- Итоги видов ----------

export type LedgerInput = {
  me: string;
  accounts: LedgerAccount[];
  entries: LedgerEntry[];
  goals: LedgerGoal[];
  allocs: GoalAlloc[];
  base: string;
  rates: Rates;
  today: string;
};

/** Сумма балансов в базовой валюте; missing — валюты без курса (их счета не вошли) */
function sumInBase(states: AccountState[], base: string, rates: Rates) {
  let total = 0;
  const missing = new Set<string>();
  for (const s of states) {
    const v = convert(s.balance, s.account.currency, base, base, rates);
    if (v === null) missing.add(s.account.currency);
    else total += v;
  }
  return { total: r2(total), missing: [...missing] };
}

export type MineView = {
  kind: "mine";
  accounts: AccountState[];
  total: number;
  missing: string[];
  /** Мои личные цели целиком */
  goals: GoalProgress[];
  /** Мои части в семейных целях: goalId → вклад в валюте цели */
  familyParts: { goal: LedgerGoal; mine: number }[];
};

export type FamilyExpense = Omit<LedgerEntry, "accountId" | "toAccountId" | "toAmount"> & { accountId?: string };

export type FamilyView = {
  kind: "family";
  /** Сумма балансов всех счетов семьи — одним числом, без детализации */
  total: number;
  missing: string[];
  /** Семейные траты обоих; у трат партнёра нет accountId — его счета не раскрываются */
  expenses: FamilyExpense[];
  /** Семейные цели целиком, с вкладом каждого */
  goals: GoalProgress[];
};

const live = (accounts: LedgerAccount[]) => accounts.filter((a) => !a.archived);

export function mineView(d: LedgerInput): MineView {
  const mine = live(d.accounts).filter((a) => a.ownerId === d.me);
  const states = mine.map((a) => accountState(a, d.entries, d.allocs, d.today));
  const sum = sumInBase(states, d.base, d.rates);
  const goals = d.goals.filter((g) => g.scope === "personal" && g.ownerId === d.me).map((g) => goalProgress(g, d.allocs, d.accounts, d.base, d.rates));
  const familyParts = d.goals.filter((g) => g.scope === "family").map((g) => ({ goal: g, mine: goalProgress(g, d.allocs, d.accounts, d.base, d.rates).byUser[d.me] ?? 0 }));
  return { kind: "mine", accounts: states, total: sum.total, missing: sum.missing, goals, familyParts };
}

/**
 * Семейный вид. Счета партнёра участвуют только в общей сумме; его личные траты, доходы, переводы и
 * поштучные балансы сюда не попадают
 */
export function familyView(d: LedgerInput): FamilyView {
  const states = live(d.accounts).map((a) => accountState(a, d.entries, d.allocs, d.today));
  const sum = sumInBase(states, d.base, d.rates);
  const expenses = d.entries
    .filter((e) => e.type === "expense" && e.scope === "family" && e.day <= d.today)
    .map(({ accountId, toAccountId: _t, toAmount: _a, ...e }): FamilyExpense => (e.userId === d.me ? { ...e, accountId } : e));
  const goals = d.goals.filter((g) => g.scope === "family").map((g) => goalProgress(g, d.allocs, d.accounts, d.base, d.rates));
  return { kind: "family", total: sum.total, missing: sum.missing, expenses, goals };
}

// ---------- История за 6 месяцев ----------

export type MonthPoint = { key: string; value: number | null; carried: boolean };

/** Последний день месяца YYYY-MM */
export function monthEnd(key: string): string {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${key}-${String(d).padStart(2, "0")}`;
}

/**
 * Остаток на конец каждого месяца. Месяцы, закончившиеся после перехода (migrationDay), — из журнала (valueAt
 * на последний день месяца). Месяцы до перехода — из старых снимков: последний снимок месяца, без снимков —
 * значение прошлого месяца (carried). Текущий месяц — живое значение
 */
export function historySeries(
  months: string[],
  current: { key: string; value: number },
  migrationDay: string | null,
  snapshots: { day: string; at: string; value: number }[],
  valueAt: (day: string) => number,
): MonthPoint[] {
  const sorted = [...snapshots].sort((a, b) => a.at.localeCompare(b.at));
  let carry: number | null = null;
  for (const s of sorted) if (s.day.slice(0, 7) < months[0]) carry = s.value;
  return months.map((key) => {
    if (key === current.key) return { key, value: current.value, carried: false };
    if (migrationDay && monthEnd(key) >= migrationDay) {
      const v = valueAt(monthEnd(key));
      carry = v;
      return { key, value: v, carried: false };
    }
    const last = sorted.filter((s) => s.day.slice(0, 7) === key).at(-1);
    if (last) { carry = last.value; return { key, value: last.value, carried: false }; }
    return { key, value: carry, carried: carry !== null };
  });
}

// ---------- Записи хранилища → журнал ----------

/** Траты, доходы и переводы/корректировки в общем виде. Записи без счёта (до журнала) — legacy */
export function entriesOf(expenses: Expense[], incomes: Income[], moves: LedgerMove[]): LedgerEntry[] {
  const out: LedgerEntry[] = [];
  for (const e of expenses) {
    if (!e.accountId) continue;
    out.push({
      id: e.id, userId: e.authorId, type: "expense", accountId: e.accountId, amount: e.accountAmount ?? e.amount,
      origAmount: e.amount, origCurrency: e.currency, rate: e.rate, scope: e.scope, categoryId: e.catId,
      ...(e.goalId && { goalId: e.goalId }), day: e.date, ts: e.ts, ...(e.legacy && { legacy: true }),
    });
  }
  for (const i of incomes) {
    if (!i.accountId) continue;
    out.push({
      id: i.id, userId: i.authorId, type: "income", accountId: i.accountId, amount: i.accountAmount ?? i.amount,
      origAmount: i.amount, origCurrency: i.currency, rate: i.rate, scope: "personal", sourceId: i.sourceId, day: i.date, ts: i.ts,
      ...(i.legacy && { legacy: true }),
    });
  }
  for (const m of moves) {
    out.push({
      id: m.id, userId: m.userId, type: m.type, accountId: m.accountId, amount: m.amount, scope: "personal", day: m.date, ts: m.ts,
      ...(m.toAccountId && { toAccountId: m.toAccountId, toAmount: m.toAmount ?? m.amount }),
    });
  }
  return out;
}

/** Счёт хранилища для расчётов. Семейный счёт до миграции — без владельца ("") */
export const ledgerAccount = (a: Account): LedgerAccount => ({
  id: a.id, ownerId: a.ownerId ?? "", name: a.name, currency: a.currency, initial: a.initial, initialAt: a.initialAt ?? "",
  ...(a.primary && { primary: true }), ...(a.archived && { archived: true }), version: a.version,
});

/** Остаток счёта: из журнала, а до перехода (нет initialAt) — ручной balance */
export const accountBalance = (a: Account, entries: LedgerEntry[], today: string) =>
  a.initialAt ? balance(ledgerAccount(a), entries, today) : a.balance;

/**
 * Счёт по умолчанию для записи без явного выбора (Siri): последний использованный автором, иначе основной,
 * иначе первый по имени. Только свои действующие счета; null — счетов нет
 */
export function defaultAccountId(userId: string, accounts: Account[], entries: LedgerEntry[]): string | null {
  const mine = accounts.filter((a) => a.ownerId === userId && !a.archived);
  if (!mine.length) return null;
  const ids = new Set(mine.map((a) => a.id));
  const last = entries.filter((e) => e.userId === userId && ids.has(e.accountId)).sort((a, b) => b.ts - a.ts)[0];
  if (last) return last.accountId;
  return (mine.find((a) => a.primary) ?? [...mine].sort((a, b) => a.name.localeCompare(b.name, "ru"))[0]).id;
}

export type Bound = { ok: true; accountId: string; accountAmount: number } | { ok: false; status: number; error: string };

/**
 * Привязка дохода или траты к счёту: счёт обязателен, свой и действующий. Сумма в валюте счёта — от клиента
 * (accountAmount) или по курсу записи и текущему курсу валюты счёта. Нет курса и суммы от клиента — 400
 */
export function bindAccount(
  e: { amount: number; currency: string; base: number },
  accountId: string | undefined,
  accountAmount: number | undefined,
  o: { userId: string; accounts: Account[]; base: string; rates: Rates },
): Bound {
  if (!accountId) return { ok: false, status: 400, error: "Выберите счёт." };
  const a = o.accounts.find((x) => x.id === accountId);
  if (!a || a.ownerId !== o.userId) return { ok: false, status: 400, error: "Записать можно только на свой счёт." };
  if (a.archived) return { ok: false, status: 400, error: `Счёт ${a.name} в архиве.` };
  if (a.currency === e.currency) return { ok: true, accountId, accountAmount: r2(e.amount) };
  if (accountAmount !== undefined) {
    if (!(Number.isFinite(accountAmount) && accountAmount > 0)) return { ok: false, status: 400, error: "Неверная сумма в валюте счёта." };
    return { ok: true, accountId, accountAmount: r2(accountAmount) };
  }
  const v = convert(e.base, o.base, a.currency, o.base, o.rates);
  if (v === null || !(v > 0)) return { ok: false, status: 400, error: `Нет курса ${a.currency}: укажите сумму в валюте счёта.` };
  return { ok: true, accountId, accountAmount: r2(v) };
}

/** Перевод: со своего счёта на любой действующий счёт семьи; сумма получателя — от клиента или по текущему курсу */
export function checkTransfer(
  t: { accountId: string; toAccountId: string; amount: number; toAmount?: number },
  o: { userId: string; accounts: Account[]; base: string; rates: Rates },
): { ok: true; toAmount: number } | { ok: false; status: number; error: string } {
  const from = o.accounts.find((a) => a.id === t.accountId);
  const to = o.accounts.find((a) => a.id === t.toAccountId);
  if (!from || !to) return { ok: false, status: 400, error: "Счёт не найден." };
  if (from.ownerId !== o.userId) return { ok: false, status: 403, error: "Переводить можно только со своего счёта." };
  if (!to.ownerId) return { ok: false, status: 400, error: "Счёт без владельца: сначала переведите семью на журнал." };
  if (from.id === to.id) return { ok: false, status: 400, error: "Счета совпадают." };
  if (from.archived || to.archived) return { ok: false, status: 400, error: "Счёт в архиве." };
  if (!(Number.isFinite(t.amount) && t.amount > 0)) return { ok: false, status: 400, error: "Неверная сумма." };
  if (from.currency === to.currency) return { ok: true, toAmount: r2(t.amount) };
  if (t.toAmount !== undefined) {
    return Number.isFinite(t.toAmount) && t.toAmount > 0 ? { ok: true, toAmount: r2(t.toAmount) } : { ok: false, status: 400, error: "Неверная сумма зачисления." };
  }
  const v = convert(t.amount, from.currency, to.currency, o.base, o.rates);
  return v && v > 0 ? { ok: true, toAmount: r2(v) } : { ok: false, status: 400, error: `Нет курса: укажите, сколько придёт в ${to.currency}.` };
}
