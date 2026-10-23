/**
 * Схема Postgres. Каждая запись бюджета несёт household_id: репозиторий ставит его в каждый WHERE.
 * Личное — owner_id (CHECK: scope = 'personal' ⇔ owner_id IS NOT NULL).
 * Деньги — numeric(14,2); курсы — numeric без фиксированной точности: смена базы делит курс на курс,
 * и numeric(18,8) молча обрезал бы сохранённые значения. В коде — числа, округление на границе репозитория.
 */
import { sql } from "drizzle-orm";
import {
  bigint, boolean, char, check, date, foreignKey, index, integer, jsonb, numeric, pgTable, primaryKey, text, timestamp, uniqueIndex,
} from "drizzle-orm/pg-core";

const money = (name: string) => numeric(name, { precision: 14, scale: 2, mode: "number" });
const rate = (name: string) => numeric(name, { mode: "number" });
const month = (name: string) => char(name, { length: 7 });
const moment = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const day = (name: string) => date(name, { mode: "string" });
const scope = () => text("scope", { enum: ["family", "personal"] }).notNull();
const scopeCheck = (table: string, t: { scope: unknown; ownerId: unknown }) =>
  check(`${table}_scope_owner`, sql`(${t.scope} = 'personal') = (${t.ownerId} IS NOT NULL)`);
export const users = pgTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: moment("created_at").notNull().defaultNow(),
});

/** Бюджет и его общие настройки. base_currency IS NULL — трекер ещё не настроен (настроек нет) */
export const households = pgTable("households", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  baseCurrency: text("base_currency"),
  currencies: text("currencies").array().notNull().default(sql`'{}'::text[]`),
  /** валюта → курс к базе или null (курс неизвестен) */
  rates: jsonb("rates").$type<Record<string, number | null>>().notNull().default({}),
  ratesUpdatedAt: day("rates_updated_at"),
  baseHistory: jsonb("base_history").$type<{ from: string; to: string; rate: number; at: string }[]>(),
  /** false — источников не задавали, клиент берёт источники по умолчанию */
  incomeSourcesSet: boolean("income_sources_set").notNull().default(false),
  schemaVersion: integer("schema_version"),
  version: integer("version").notNull().default(0),
  createdAt: moment("created_at").notNull().defaultNow(),
});

export const memberships = pgTable(
  "memberships",
  {
    householdId: text("household_id").notNull().references(() => households.id),
    userId: text("user_id").notNull().references(() => users.id),
    role: text("role", { enum: ["owner", "member"] }).notNull(),
    joinedAt: moment("joined_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.householdId, t.userId] }), index("memberships_user").on(t.userId)],
);

/** Личные настройки участника бюджета (без личных категорий — они в categories) */
export const userSettings = pgTable(
  "user_settings",
  {
    householdId: text("household_id").notNull(),
    userId: text("user_id").notNull(),
    preferredCurrency: text("preferred_currency"),
    hideQuickEntry: boolean("hide_quick_entry").notNull().default(false),
    version: integer("version").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.householdId, t.userId] }), foreignKey({ name: "user_settings_member", columns: [t.householdId, t.userId], foreignColumns: [memberships.householdId, memberships.userId] })],
);

/** Категории семьи (owner_id NULL) и личные; порядок — sort, как в списке настроек */
export const categories = pgTable(
  "categories",
  {
    householdId: text("household_id").notNull().references(() => households.id),
    id: text("id").notNull(),
    scope: scope(),
    ownerId: text("owner_id"),
    name: text("name").notNull(),
    limit: money("limit").notNull(),
    archived: boolean("archived").notNull().default(false),
    since: month("since"),
    archivedFrom: month("archived_from"),
    /** Прежние лимиты: [{ until, limit }] по возрастанию until */
    history: jsonb("history").$type<{ until: string; limit: number }[]>(),
    sort: integer("sort").notNull(),
  },
  (t) => [
    uniqueIndex("categories_key").on(t.householdId, sql`coalesce(${t.ownerId}, '')`, t.id),
    scopeCheck("categories", t),
    foreignKey({ name: "categories_owner", columns: [t.householdId, t.ownerId], foreignColumns: [memberships.householdId, memberships.userId] }),
  ],
);

export const incomeSources = pgTable(
  "income_sources",
  {
    householdId: text("household_id").notNull().references(() => households.id),
    id: text("id").notNull(),
    name: text("name").notNull(),
    sort: integer("sort").notNull(),
  },
  (t) => [primaryKey({ columns: [t.householdId, t.id] })],
);

export const recurringPayments = pgTable(
  "recurring_payments",
  {
    householdId: text("household_id").notNull().references(() => households.id),
    id: text("id").notNull(),
    name: text("name").notNull(),
    currency: text("currency").notNull(),
    approx: boolean("approx").notNull(),
    frequency: text("frequency", { enum: ["monthly", "yearly"] }).notNull(),
    day: integer("day").notNull(),
    month: integer("month"),
    categoryId: text("category_id").notNull(),
    scope: scope(),
    ownerId: text("owner_id"),
    startMonth: month("start_month").notNull(),
    endMonth: month("end_month"),
    paused: boolean("paused").notNull(),
    skips: text("skips").array().notNull().default(sql`'{}'::text[]`),
    createdBy: text("created_by").notNull(),
    version: integer("version").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.householdId, t.id] }),
    index("recurring_owner").on(t.householdId, t.ownerId),
    scopeCheck("recurring_payments", t),
    check("recurring_day", sql`${t.day} BETWEEN 1 AND 31`),
    check("recurring_month", sql`(${t.frequency} = 'yearly') = (${t.month} IS NOT NULL)`),
    foreignKey({ name: "recurring_owner_member", columns: [t.householdId, t.ownerId], foreignColumns: [memberships.householdId, memberships.userId] }),
  ],
);

/** История цены: действует последняя запись с from_month ≤ месяца */
export const recurringAmounts = pgTable(
  "recurring_amounts",
  {
    householdId: text("household_id").notNull(),
    paymentId: text("payment_id").notNull(),
    fromMonth: month("from_month").notNull(),
    amount: money("amount").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.householdId, t.paymentId, t.fromMonth] }),
    foreignKey({ name: "recurring_amounts_payment", columns: [t.householdId, t.paymentId], foreignColumns: [recurringPayments.householdId, recurringPayments.id] }).onDelete("cascade"),
  ],
);

/**
 * Траты. category_id и plan_item_id без внешних ключей: категории удаляются из настроек, а после удаления пункта
 * плана трата сохраняет его id (и «Вернуть» восстанавливает её с прежней связью) — так работает логика сейчас
 */
export const expenses = pgTable(
  "expenses",
  {
    householdId: text("household_id").notNull().references(() => households.id),
    id: text("id").notNull(),
    authorId: text("author_id").notNull(),
    scope: scope(),
    ownerId: text("owner_id"),
    categoryId: text("category_id").notNull(),
    amount: money("amount").notNull(),
    currency: text("currency").notNull(),
    rate: rate("rate").notNull(),
    base: money("base").notNull(),
    date: day("date").notNull(),
    note: text("note").notNull().default(""),
    ts: moment("ts").notNull(),
    planItemId: text("plan_item_id"),
    recurringId: text("recurring_id"),
    recurringMonth: month("recurring_month"),
  },
  (t) => [
    primaryKey({ columns: [t.householdId, t.id] }),
    index("expenses_date").on(t.householdId, t.date),
    index("expenses_owner").on(t.householdId, t.ownerId),
    // Защита от двойной оплаты регулярного платежа за месяц
    uniqueIndex("expenses_recurring_month").on(t.householdId, t.recurringId, t.recurringMonth).where(sql`${t.recurringId} IS NOT NULL`),
    scopeCheck("expenses", t),
    check("expenses_owner_is_author", sql`${t.ownerId} IS NULL OR ${t.ownerId} = ${t.authorId}`),
    check("expenses_recurring_pair", sql`(${t.recurringId} IS NULL) = (${t.recurringMonth} IS NULL)`),
    foreignKey({ name: "expenses_author", columns: [t.householdId, t.authorId], foreignColumns: [memberships.householdId, memberships.userId] }),
    foreignKey({ name: "expenses_recurring", columns: [t.householdId, t.recurringId], foreignColumns: [recurringPayments.householdId, recurringPayments.id] }),
  ],
);

export const incomes = pgTable(
  "incomes",
  {
    householdId: text("household_id").notNull().references(() => households.id),
    id: text("id").notNull(),
    authorId: text("author_id").notNull(),
    sourceId: text("source_id").notNull(),
    amount: money("amount").notNull(),
    currency: text("currency").notNull(),
    rate: rate("rate").notNull(),
    base: money("base").notNull(),
    date: day("date").notNull(),
    note: text("note").notNull().default(""),
    ts: moment("ts").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.householdId, t.id] }),
    index("incomes_date").on(t.householdId, t.date),
    foreignKey({ name: "incomes_author", columns: [t.householdId, t.authorId], foreignColumns: [memberships.householdId, memberships.userId] }),
  ],
);

export const accounts = pgTable(
  "accounts",
  {
    householdId: text("household_id").notNull().references(() => households.id),
    id: text("id").notNull(),
    name: text("name").notNull(),
    currency: text("currency").notNull(),
    scope: scope(),
    ownerId: text("owner_id"),
    balance: money("balance").notNull(),
    initial: money("initial").notNull(),
    updatedAt: moment("updated_at").notNull(),
    updatedBy: text("updated_by").notNull(),
    archived: boolean("archived").notNull().default(false),
    version: integer("version").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.householdId, t.id] }),
    index("accounts_owner").on(t.householdId, t.ownerId),
    scopeCheck("accounts", t),
    foreignKey({ name: "accounts_owner_member", columns: [t.householdId, t.ownerId], foreignColumns: [memberships.householdId, memberships.userId] }),
  ],
);

export const goals = pgTable(
  "goals",
  {
    householdId: text("household_id").notNull().references(() => households.id),
    id: text("id").notNull(),
    name: text("name").notNull(),
    target: money("target").notNull(),
    currency: text("currency").notNull(),
    allocated: money("allocated").notNull(),
    scope: scope(),
    ownerId: text("owner_id"),
    version: integer("version").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.householdId, t.id] }),
    index("goals_owner").on(t.householdId, t.ownerId),
    scopeCheck("goals", t),
    foreignKey({ name: "goals_owner_member", columns: [t.householdId, t.ownerId], foreignColumns: [memberships.householdId, memberships.userId] }),
  ],
);

/** Операции копилки в порядке pos: + выделить, − вернуть */
export const goalOps = pgTable(
  "goal_ops",
  {
    householdId: text("household_id").notNull(),
    goalId: text("goal_id").notNull(),
    id: text("id").notNull(),
    pos: integer("pos").notNull(),
    amount: money("amount").notNull(),
    date: day("date").notNull(),
    ts: moment("ts").notNull(),
    by: text("by").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.householdId, t.goalId, t.id] }),
    foreignKey({ name: "goal_ops_goal", columns: [t.householdId, t.goalId], foreignColumns: [goals.householdId, goals.id] }).onDelete("cascade"),
  ],
);

/** Снимок сверки целиком (с поштучными остатками — только сервер) и итоги колонками для запросов */
export const recons = pgTable(
  "recons",
  {
    householdId: text("household_id").notNull().references(() => households.id),
    id: text("id").notNull(),
    at: moment("at").notNull(),
    day: day("day").notNull(),
    by: text("by").notNull(),
    snapshot: jsonb("snapshot").notNull(),
    totalAll: money("total_all").notNull(),
    totalFamily: money("total_family").notNull(),
  },
  (t) => [primaryKey({ columns: [t.householdId, t.id] }), index("recons_at").on(t.householdId, t.at)],
);

/** План месяца: семейная часть (owner_id NULL, с income_override) и личные части участников */
export const monthPlans = pgTable(
  "month_plans",
  {
    householdId: text("household_id").notNull().references(() => households.id),
    month: month("month").notNull(),
    ownerId: text("owner_id"),
    incomeOverride: money("income_override"),
    limitOverrides: jsonb("limit_overrides").$type<Record<string, number>>().notNull().default({}),
    version: integer("version").notNull(),
  },
  (t) => [
    uniqueIndex("month_plans_key").on(t.householdId, t.month, sql`coalesce(${t.ownerId}, '')`),
    check("month_plans_income_family", sql`${t.ownerId} IS NULL OR ${t.incomeOverride} IS NULL`),
    foreignKey({ name: "month_plans_owner", columns: [t.householdId, t.ownerId], foreignColumns: [memberships.householdId, memberships.userId] }),
  ],
);

export const planItems = pgTable(
  "plan_items",
  {
    householdId: text("household_id").notNull().references(() => households.id),
    id: text("id").notNull(),
    month: month("month").notNull(),
    name: text("name").notNull(),
    amount: money("amount").notNull(),
    categoryId: text("category_id").notNull(),
    scope: scope(),
    ownerId: text("owner_id"),
    createdBy: text("created_by").notNull(),
    /** Связанные траты — как в Redis: пишутся вместе с тратой в одной транзакции */
    expenseIds: text("expense_ids").array().notNull().default(sql`'{}'::text[]`),
    movedFrom: month("moved_from"),
    version: integer("version").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.householdId, t.id] }),
    index("plan_items_month").on(t.householdId, t.month),
    scopeCheck("plan_items", t),
    foreignKey({ name: "plan_items_owner", columns: [t.householdId, t.ownerId], foreignColumns: [memberships.householdId, memberships.userId] }),
  ],
);

/** Токены Быстрых команд: хранится только SHA-256 */
export const apiTokens = pgTable(
  "api_tokens",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    name: text("name").notNull(),
    hash: text("hash").notNull(),
    createdAt: moment("created_at").notNull(),
    lastUsedAt: moment("last_used_at"),
  },
  (t) => [index("api_tokens_user").on(t.userId)],
);

/** Счётчик запросов токена за минуту; старые минуты удаляются при записи */
export const quickRate = pgTable(
  "quick_rate",
  {
    tokenId: text("token_id").notNull(),
    minute: bigint("minute", { mode: "number" }).notNull(),
    count: integer("count").notNull(),
  },
  (t) => [primaryKey({ columns: [t.tokenId, t.minute] })],
);

export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    endpoint: text("endpoint").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    subscription: jsonb("subscription").notNull(),
    createdAt: moment("created_at").notNull(),
  },
  (t) => [index("push_subscriptions_user").on(t.userId)],
);

/** Удалённые записи на 10 минут для «Вернуть»: запись целиком, как была */
export const deletedEntries = pgTable(
  "deleted_entries",
  {
    householdId: text("household_id").notNull().references(() => households.id),
    id: text("id").notNull(),
    kind: text("kind", { enum: ["expense", "income"] }).notNull(),
    ownerId: text("owner_id"),
    entry: jsonb("entry").notNull(),
    expiresAt: moment("expires_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.householdId, t.id] })],
);

/** Служебные значения: версия приложения для пуша об обновлении */
export const appMeta = pgTable("app_meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});
