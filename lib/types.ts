/** limit — действующий лимит; history — прежние лимиты по месяц until включительно, по возрастанию until.
 *  since — месяц создания, archivedFrom — месяц удаления: в прошлых месяцах категория видна как была */
export type Category = {
  id: string;
  name: string;
  limit: number;
  archived?: boolean;
  since?: string;
  archivedFrom?: string;
  history?: { until: string; limit: number }[];
};

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
  /** 2 — данные в семейном формате (после /api/migrate-v2 или новой установки); 3 — копилки перенесены в «Сбережения» */
  schemaVersion?: number;
  /** Версия для записи с проверкой (CAS): растёт на 1 при каждом сохранении */
  version: number;
};

/** Личные настройки пользователя: ft:u:<id>:settings */
export type UserSettings = {
  personalCategories: Category[];
  /** Валюта по умолчанию для моих личных трат и доходов; нет — общая base */
  preferredCurrency?: string;
  version: number;
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

// ---------- Копилки до раздела «Сбережения» (ft:goals): читает только миграция v3 ----------
export type LegacyGoalOp = { id: string; amount: number; date: string; ts: number };
/** target и операции — в валюте копилки; нет currency — копилка в общей base */
export type LegacyGoal = { id: string; name: string; target: number; ops: LegacyGoalOp[]; currency?: string };
export type GoalsDoc = { items: LegacyGoal[]; version: number };

// ---------- Сбережения ----------
/** Счёт: ft:accounts (семейные) или ft:u:<id>:accounts (личные), поле хеша = id */
export type Account = {
  id: string;
  name: string;
  currency: string;
  scope: Scope;
  /** Только у personal */
  ownerId?: string;
  /** Остаток в валюте счёта */
  balance: number;
  /** Остаток при создании — точка отсчёта для «факта», пока счёт не попал в сверку */
  initial: number;
  updatedAt: string; // ISO
  updatedBy: string;
  archived?: boolean;
  version: number;
};

/** + выделить, − вернуть; в валюте копилки */
export type GoalOp = { id: string; amount: number; date: string; ts: number; by: string };
/** Копилка — часть общих сбережений, отведённая под цель. target и allocated — в валюте копилки */
export type Goal = {
  id: string;
  name: string;
  target: number;
  currency: string;
  allocated: number;
  scope: Scope;
  ownerId?: string;
  ops: GoalOp[];
  version: number;
};

/** Суммы в базовой валюте; счета без курса не входят */
export type Totals = { family: number; byUser: Record<string, number>; all: number };

/** Снимок сверки: ft:recons (ZSET, score = время). Полностью — только на сервере */
export type Recon = {
  id: string;
  at: string; // ISO
  /** День сверки у пользователя, YYYY-MM-DD: граница периода для трат и доходов */
  day: string;
  by: string;
  /** accountId → остаток в валюте счёта, все счета семьи */
  balances: Record<string, number>;
  /** Курсы к базе на момент сверки */
  rates: Record<string, number>;
  totals: Totals;
  /** Доходы и расходы всей семьи с прошлой сверки; null — первая сверка */
  income: number | null;
  expense: number | null;
  expected: number | null;
  fact: number | null;
  gap: number | null;
};

/** Снимок в ответе клиенту: без поштучных остатков */
export type ReconView = {
  at: string;
  day: string;
  all: number;
  family: number;
  mine: number;
  partner: number;
  income: number | null;
  expense: number | null;
  expected: number | null;
  fact: number | null;
  gap: number | null;
};

export type SavingsView = {
  accounts: { family: Account[]; mine: Account[] };
  goals: { family: Goal[]; mine: Goal[] };
  /** Личное партнёра — только суммы в базовой валюте */
  partner: { total: number; goalsAllocated: number; lastUpdatedAt: string | null };
  recons: ReconView[];
  /** Старые копилки ещё не перенесены; owner — кто запускает перенос */
  migration?: { goals: number; owner: User };
};

export type User = { id: string; name: string };

/** Месяц YYYY-MM */
export type MonthKey = string;

/** Ответ GET /api/data: только то, что видно текущему пользователю */
export type TrackerData = {
  me: User;
  partner: User;
  settings: Settings | null;
  mySettings: UserSettings;
  savings: SavingsView;
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
