export type Category = { id: string; name: string; limit: number; archived?: boolean };

/** Семейная трата — общие лимиты, видят оба; личная — свои категории, видит только автор */
export type Scope = "family" | "personal";

/** Семейные настройки: ft:settings */
export type Settings = {
  base: string;
  currencies: string[];
  /** Последний известный курс: 1 единица валюты = rate базовой валюты */
  rates: Record<string, number | null>;
  familyCategories: Category[];
  /** Источники поступлений. Нет поля — используются DEFAULT_INCOME_SOURCES */
  incomeSources?: IncomeSource[];
  /** Дата последнего автообновления rates из ExchangeRate-API, YYYY-MM-DD */
  ratesUpdatedAt?: string;
  /** Смены базовой валюты: rate — сколько from стоило 1 to на момент смены */
  baseHistory?: { from: string; to: string; rate: number; at: string }[];
  /** 2 — данные в семейном формате (после /api/migrate-v2 или новой установки) */
  schemaVersion?: number;
  /** Версия для записи с проверкой (CAS): растёт на 1 при каждом сохранении */
  version: number;
};

/** Личные настройки пользователя: ft:u:<id>:settings */
export type UserSettings = { personalCategories: Category[]; version: number };

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
  scope: Scope;
  /** Выставляет сервер из сессии */
  authorId: string;
};

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
  /** Выставляет сервер из сессии */
  authorId: string;
};
export type IncomeSource = { id: string; name: string };

export type GoalOp = { id: string; amount: number; date: string; ts: number };
export type Goal = { id: string; name: string; target: number; ops: GoalOp[] };
/** ft:goals — общие копилки, запись с проверкой версии */
export type GoalsDoc = { items: Goal[]; version: number };

export type User = { id: string; name: string };

/** Месяц YYYY-MM */
export type MonthKey = string;

/** Ответ GET /api/data: только то, что видно текущему пользователю */
export type TrackerData = {
  me: User;
  partner: User;
  settings: Settings | null;
  mySettings: UserSettings;
  goals: Goal[];
  goalsVersion: number;
  familyExpenses: Record<MonthKey, Expense[]>;
  myExpenses: Record<MonthKey, Expense[]>;
  incomes: Record<MonthKey, Income[]>;
  /** Личные траты партнёра — ТОЛЬКО суммы base за месяц */
  partnerPersonalTotals: Record<MonthKey, number>;
  /** То же по дням месяца ("1".."31") — для честного сравнения периодов; без записей и категорий */
  partnerPersonalDaily: Record<MonthKey, Record<string, number>>;
  /** Есть данные старого формата, ещё не перенесённые в семейный; owner — кто запускает перенос */
  migration?: { pending: true; owner: User };
};

// ---------- Формат до семейного бюджета: читается только миграцией ----------
export type LegacyExpense = Omit<Expense, "scope" | "authorId">;
export type LegacyIncome = Omit<Income, "authorId">;
export type LegacySettings = Omit<Settings, "familyCategories" | "version" | "schemaVersion"> & { categories: Category[] };
