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
  /** День перехода на балансы из журнала; нет — остатки ещё ручные. Только чтение: пишет миграция и создание бюджета */
  ledgerSince?: string;
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
  /** Счёт автора, с которого списано (lib/ledger.ts); нет — запись до журнала */
  accountId?: string;
  /** Сумма в валюте счёта: amount/currency — то, сколько платили */
  accountAmount?: number;
  /** Трата «из цели»: при записи часть цели на счёте уменьшилась */
  goalId?: string;
  /** До перехода на журнал: остаётся для истории и лимитов, баланс не двигает */
  legacy?: boolean;
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
  /** Свой счёт, на который пришёл доход */
  accountId?: string;
  accountAmount?: number;
  legacy?: boolean;
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
  /** Остаток в валюте счёта: после перехода на журнал сервер считает его из записей (lib/ledger.ts) */
  balance: number;
  /** Остаток на initialAt — точка отсчёта журнала. До перехода — остаток при создании */
  initial: number;
  /** С этого дня записи двигают баланс; нет — счёт ещё не переведён на журнал и balance ручной */
  initialAt?: string;
  /** Основной счёт владельца */
  primary?: boolean;
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

/**
 * Снимок сверки (до перехода на журнал): только история для графика за 6 месяцев, новые не создаются.
 * В базе в snapshot лежат и старые поля сверки (остатки по счетам, разница) — их больше никто не читает
 */
export type Recon = {
  id: string;
  at: string; // ISO
  day: string;
  by: string;
  /** Курсы к базе на момент сверки */
  rates: Record<string, number>;
  totals: Totals;
};

/** Снимок в ответе клиенту: итоги без поштучных остатков */
export type ReconView = { at: string; day: string; all: number; family: number; mine: number; partner: number };

export type SavingsView = {
  accounts: { family: Account[]; mine: Account[] };
  goals: { family: Goal[]; mine: Goal[] };
  /** Снимки сверки до перехода на журнал — история */
  recons: ReconView[];
  /** Балансы из журнала (lib/ledger.ts); нет — сервер старый */
  ledger?: LedgerView;
};

/** Журнал в ответе клиенту: свои счета поштучно, у партнёра — только суммы */
export type LedgerView = {
  /** День перехода на журнал; null — ещё не переведён (остатки ручные) */
  since: string | null;
  /** Мои счета (и семейные до перехода): баланс, резерв под цели, свободно */
  accounts: Record<string, { balance: number; reserved: number; free: number }>;
  /** Мои части целей */
  allocs: { goalId: string; accountId: string; amount: number; version: number }[];
  /** Видимые цели (семейные и мои личные): собрано в валюте цели по текущему курсу и вклад каждого */
  goals: Record<string, { total: number; byUser: Record<string, number>; missing: string[] }>;
  /** Сумма балансов всех счетов семьи в базовой валюте — одним числом */
  familyTotal: number;
  missing: string[];
  /** Мои переводы и корректировки; входящий перевод партнёра — без его счёта */
  moves: LedgerMove[];
  /** Остаток на конец завершённых месяцев после перехода, в базовой валюте: все счета семьи и мои */
  monthEnds: Record<string, { family: number; mine: number }>;
};

/** Перевод между счетами семьи или корректировка остатка (ledger_moves). Не доход и не трата */
export type LedgerMove = {
  id: string;
  userId: string;
  type: "transfer" | "adjustment";
  accountId: string;
  /** Только у transfer */
  toAccountId?: string;
  /** transfer: > 0 в валюте счёта-отправителя; adjustment: со знаком */
  amount: number;
  /** transfer: зачислено получателю в его валюте */
  toAmount?: number;
  date: string;
  note: string;
  ts: number;
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
  /** Доходы личные: только мои записи */
  incomes: Record<MonthKey, Income[]>;
  /** Сумма base доходов каждого участника за месяц (и моих тоже) — видна всей семье, записей нет */
  incomeTotals: Record<MonthKey, Record<string, number>>;
  /** Доходы остальных участников по дням ("1".."31") — для сравнения 1–N дней; без записей */
  partnerIncomeDaily: Record<MonthKey, Record<string, number>>;
  /** Участники по порядку вступления — для строки «Доходы за месяц» */
  memberIds?: string[];
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
