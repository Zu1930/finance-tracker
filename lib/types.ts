export type Category = { id: string; name: string; limit: number; archived?: boolean };

export type Settings = {
  base: string;
  currencies: string[];
  /** Последний введённый курс: 1 единица валюты = rate базовой валюты */
  rates: Record<string, number | null>;
  categories: Category[];
  /** Источники поступлений. Нет поля — используются DEFAULT_INCOME_SOURCES */
  incomeSources?: IncomeSource[];
};

export type Expense = {
  id: string;
  amount: number;
  currency: string;
  rate: number;
  /** Сумма в базовой валюте по курсу на момент записи */
  base: number;
  catId: string;
  note: string;
  date: string; // YYYY-MM-DD
  ts: number;
};

export type MonthDoc = { expenses: Expense[] };

export type Income = {
  id: string;
  amount: number; // в валюте поступления
  currency: string;
  rate: number; // 1 единица currency = rate базовой валюты, на момент записи
  base: number; // amount * rate, округлено до копеек
  sourceId: string;
  note: string;
  date: string; // YYYY-MM-DD
  ts: number;
};
export type IncomeMonthDoc = { items: Income[] };
export type IncomeSource = { id: string; name: string };

export type GoalOp = { id: string; amount: number; date: string; ts: number };
export type Goal = { id: string; name: string; target: number; ops: GoalOp[] };
export type GoalsDoc = { items: Goal[] };

export type TrackerData = {
  settings: Settings | null;
  goals: Goal[];
  months: Record<string, MonthDoc>;
  /** Поступления по месяцам: i-2026-10 */
  incomes: Record<string, IncomeMonthDoc>;
};
