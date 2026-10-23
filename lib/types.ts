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
  /** Скрыть строку голосового ввода на странице ввода */
  hideQuickEntry?: boolean;
  /** Когда присылать напоминания; нет — DEFAULT_REMINDERS (lib/push.ts) */
  reminders?: Reminders;
  version: number;
};

/** Час (0–23), день недели для «внести траты» (0 — воскресенье), за сколько дней до конца месяца — план;
 *  tz — часовой пояс устройства, с которого сохранили (IANA); нет — APP_TZ */
export type Reminders = { hour: number; weekday: number; planDays: number; tz?: string };

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
    /** Трата по пункту плана месяца: в шкалу категории не входит, кроме превышения пункта */
  planItemId?: string;
  /** Оплата регулярного платежа за recurringMonth: в шкалу категории не входит совсем */
  recurringId?: string;
  recurringMonth?: string;
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
};

// ---------- Регулярные платежи ----------
/** ft:recurring (семейные) или ft:u:<id>:recurring (личные), поле = id. Сумма — в валюте платежа */
export type RecurringPayment = {
  id: string;
  name: string;
  currency: string;
  /** Примерная сумма (коммуналка): при оплате вводится факт */
  approx: boolean;
  frequency: "monthly" | "yearly";
  /** 1–31; в коротком месяце — последний день */
  day: number;
  /** 1–12, только для yearly */
  month?: number;
  categoryId: string;
  scope: Scope;
  ownerId?: string;
  startMonth: string;
  /** Включительно; задаётся при удалении */
  endMonth?: string;
  paused: boolean;
  /** Пропущенные месяцы YYYY-MM */
  skips: string[];
  /** История цены: действует последняя запись с fromMonth ≤ месяца */
  amounts: { fromMonth: string; amount: number }[];
  createdBy: string;
  version: number;
};

// ---------- План месяца ----------
/** Семейная часть плана: ft:plan:<YYYY-MM>. Нет ключа — пустой план */
export type MonthPlan = {
  month: string;
  /** null — доход плана = среднее за 3 завершённых месяца */
  incomeOverride: number | null;
  /** familyCategoryId → лимит только на этот месяц */
  limitOverrides: Record<string, number>;
  version: number;
};
/** Личная часть плана: ft:u:<id>:plan:<YYYY-MM> */
export type MyMonthPlan = { month: string; limitOverrides: Record<string, number>; version: number };
/** Плановая покупка: ft:plan-items:<YYYY-MM> или ft:u:<id>:plan-items:<YYYY-MM>, поле = id. amount — в базовой валюте */
export type PlanItem = {
  id: string;
  month: string;
  name: string;
  amount: number;
  categoryId: string;
  scope: Scope;
  ownerId?: string;
  createdBy: string;
  expenseIds: string[];
  /** Месяц, из которого перенесена */
  movedFrom?: string;
  version: number;
};
export type PlanItemStatus = "planned" | "partial" | "done";

/** План месяца в ответе /api/data: своё и семейное целиком, партнёра — суммами */
export type PlanView = {
  month: string;
  incomeOverride: number | null;
  familyOverrides: Record<string, number>;
  myOverrides: Record<string, number>;
  items: { family: PlanItem[]; mine: PlanItem[] };
  partner: {
    plannedTotal: number;
    /** Σ max(сумма пункта, связанные траты) — для прогноза */
    plannedForecast: number;
  };
  planVersion: number;
  myPlanVersion: number;
};

export type User = { id: string; name: string };

/** Месяц YYYY-MM */
export type MonthKey = string;

/** Ответ GET /api/data: только то, что видно текущему пользователю */
/** Знакомство с приложением (lib/onboarding.ts): опрос, карточка «Настройка», подсказки */
export type OnboardingState = {
  status: "pending" | "done" | "skipped";
  completedAt: string | null;
  /** Карточка скрыта крестиком или уже показала «Готово» */
  dismissed: boolean;
  /** Пункты карточки «не нужно» */
  hidden: string[];
  hintsSeen: string[];
  pwaSeen: boolean;
  /** Токенов Siri — для пункта «Голос и Siri» */
  tokens: number;
  /** В семье не владельцем (пришёл по приглашению): короткий опрос, всё своё — личное */
  invited: boolean;
};

export type TrackerData = {
  me: User;
  onboarding?: OnboardingState;
  /** Админ закрытой беты (ADMIN_USER_IDS): в настройках раздел кодов регистрации */
  admin?: true;
  /** Бюджет одного человека: партнёра нет, весь интерфейс без семейных частей (isSolo в TrackerProvider) */
  solo?: true;
  /** Архив бывшей семьи: только чтение, данные до даты выхода (lib/archive.ts) */
  readonly?: { householdId: string; name: string; until: string; leftAt: string };
  /** Имена авторов записей, если их больше, чем я и партнёр (архив, семья из 3+) */
  names?: Record<string, string>;
  /** Бывшая семья распущена, а разбор семейного имущества не пройден */
  pendingReview?: { householdId: string; name: string };
  partner: User | null;
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
  /** Из них по пунктам плана партнёра, по дням — чтобы отделить обычные траты от плановых */
  partnerPlannedDaily: Record<MonthKey, Record<string, number>>;
  /** Планы месяцев, где есть хоть что-то запланированное */
  plans: Record<MonthKey, PlanView>;
    /** Сумма личных лимитов партнёра по месяцам (текущий −1 … +12) с его поправками на месяц */
  partnerLimits: Record<MonthKey, number>;
  /** Регулярные платежи: семейные и мои целиком */
  recurring: { family: RecurringPayment[]; mine: RecurringPayment[] };
  /** Личные регулярные партнёра — только сумма на месяц (факт оплаченных + оценка остальных), текущий −1 … +12 */
  partnerRecurring: Record<MonthKey, number>;
  /** Оплаты регулярных партнёра по дням — чтобы отделить обычные траты от регулярных */
  partnerRecurringDaily: Record<MonthKey, Record<string, number>>;
};

// ---------- Формат до семейного бюджета: читается только миграцией ----------
export type LegacyExpense = Omit<Expense, "scope" | "authorId">;
export type LegacyIncome = Omit<Income, "authorId">;
export type LegacySettings = Omit<Settings, "familyCategories" | "version" | "schemaVersion"> & { categories: Category[] };
