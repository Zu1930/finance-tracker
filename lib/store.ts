/**
 * Семейное хранилище без Redis: ключи, сборка ответа GET /api/data с учётом приватности, подготовка записей.
 * Чистые функции — их вызывают route handlers и тесты (lib/store.test.mjs).
 */
import type { Expense, GoalsDoc, Income, MonthKey, Scope, Settings, TrackerData, User, UserSettings } from "./types.ts";
import { buildSavings, type RawSavings } from "./savings.ts";

// ---------- Ключи Redis ----------
export const K = {
  settings: "ft:settings",
  /** Старые копилки (JSON) — после миграции v3 остаются как резервная копия */
  goals: "ft:goals",
  accounts: "ft:accounts",
  userAccounts: (userId: string) => `ft:u:${userId}:accounts`,
  goals2: "ft:goals2",
  userGoals: (userId: string) => `ft:u:${userId}:goals`,
  recons: "ft:recons",
  index: "ft:index",
  family: (m: MonthKey) => `ft:m:${m}`,
  incomes: (m: MonthKey) => `ft:i:${m}`,
  userSettings: (userId: string) => `ft:u:${userId}:settings`,
  personal: (userId: string, m: MonthKey) => `ft:u:${userId}:m:${m}`,
  /** Удалённая запись на время «Вернуть» в тосте */
  trash: (id: string) => `ft:trash:${id}`,
};

/** Хеш счетов или копилок: личные — только в хеше пользователя из сессии, чужие недоступны по построению */
export const recordKey = (kind: "accounts" | "goals", scope: Scope, userId: string) =>
  kind === "accounts"
    ? scope === "personal" ? K.userAccounts(userId) : K.accounts
    : scope === "personal" ? K.userGoals(userId) : K.goals2;

export const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export type Kind = "expense" | "income";

/** Ключ хеша месяца: доходы и семейные траты общие, личные — только в хеше автора */
export function entryKey(kind: Kind, scope: Scope | undefined, userId: string, month: MonthKey): string {
  if (kind === "income") return K.incomes(month);
  return scope === "personal" ? K.personal(userId, month) : K.family(month);
}

/** Разбор ключа месяца из индекса: что это за хеш и чей */
export function parseMonthKey(key: string): { kind: "family" | "incomes" | "personal"; month: MonthKey; userId?: string } | null {
  let m = /^ft:m:(\d{4}-\d{2})$/.exec(key);
  if (m) return { kind: "family", month: m[1] };
  m = /^ft:i:(\d{4}-\d{2})$/.exec(key);
  if (m) return { kind: "incomes", month: m[1] };
  m = /^ft:u:([^:]+):m:(\d{4}-\d{2})$/.exec(key);
  if (m) return { kind: "personal", month: m[2], userId: m[1] };
  return null;
}

// ---------- Подготовка записи от клиента ----------
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : NaN);
const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");

/**
 * Проверка и нормализация записи из тела POST /api/entries.
 * authorId всегда из сессии — значение от клиента игнорируется. null — запись некорректна
 */
export function prepareEntry(kind: Kind, body: unknown, authorId: string): Expense | Income | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const id = str(b.id, 64);
  const date = str(b.date, 10);
  const amount = num(b.amount), rate = num(b.rate), base = num(b.base), ts = num(b.ts);
  const currency = str(b.currency, 5);
  if (!/^[\w-]{1,64}$/.test(id) || !DATE.test(date) || !/^[A-Z]{3,5}$/.test(currency)) return null;
  if (!(amount > 0) || !(rate > 0) || !(base >= 0) || !(ts > 0)) return null;
  const common = { id, amount, currency, rate, base, note: str(b.note, 140), date, ts, authorId };
  if (kind === "income") {
    const sourceId = str(b.sourceId, 64);
    return sourceId ? { ...common, sourceId } : null;
  }
  const catId = str(b.catId, 64);
  const scope: Scope = b.scope === "personal" ? "personal" : "family";
  return catId ? { ...common, catId, scope } : null;
}

// ---------- Сборка ответа GET /api/data ----------
/** Всё, что лежит в Redis: настройки, копилки, личные настройки и хеши месяцев по ключам */
export type RawStore = {
  settings: Settings | null;
  goals: GoalsDoc | null;
  userSettings: Record<string, UserSettings | null>;
  /** ключ хеша → { id записи → запись } */
  hashes: Record<string, Record<string, Expense | Income>>;
  /** Нет — сбережения пусты (тесты и старые вызовы) */
  savings?: RawSavings;
};

export const EMPTY_SAVINGS: RawSavings = { accounts: {}, userAccounts: {}, goals: {}, userGoals: {}, recons: [] };

const byDate = <T extends { date: string; ts: number }>(a: T, b: T) => a.date.localeCompare(b.date) || a.ts - b.ts;
const EMPTY_USER: UserSettings = { personalCategories: [], version: 0 };

/**
 * Данные для пользователя me. Личные записи и категории партнёра не попадают в ответ ни в каком виде:
 * от них остаются только суммы за месяц и по дням
 */
export function buildView(raw: RawStore, me: User, partner: User): TrackerData {
  const view: TrackerData = {
    me,
    partner,
    settings: raw.settings,
    mySettings: raw.userSettings[me.id] ?? EMPTY_USER,
    savings: buildSavings(raw.savings ?? EMPTY_SAVINGS, me, partner, raw.settings?.base ?? "", raw.settings?.rates ?? {}),
    familyExpenses: {},
    myExpenses: {},
    incomes: {},
    partnerPersonalTotals: {},
    partnerPersonalDaily: {},
  };
  for (const [key, hash] of Object.entries(raw.hashes)) {
    const k = parseMonthKey(key);
    if (!k) continue;
    const items = Object.values(hash ?? {});
    if (k.kind === "family") view.familyExpenses[k.month] = (items as Expense[]).sort(byDate);
    else if (k.kind === "incomes") view.incomes[k.month] = (items as Income[]).sort(byDate);
    else if (k.userId === me.id) view.myExpenses[k.month] = (items as Expense[]).sort(byDate);
    else if (k.userId === partner.id) {
      let total = 0;
      const daily: Record<string, number> = {};
      for (const e of items as Expense[]) {
        total += e.base;
        const day = String(Number(e.date.slice(8, 10)));
        daily[day] = (daily[day] ?? 0) + e.base;
      }
      view.partnerPersonalTotals[k.month] = Math.round(total * 100) / 100;
      view.partnerPersonalDaily[k.month] = daily;
    }
  }
  return view;
}

// ---------- Проверка документов, которые клиент пишет целиком ----------
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isMonth = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}$/.test(v);
const optMonth = (v: unknown) => v === undefined || isMonth(v);
const isCategories = (v: unknown) =>
  Array.isArray(v) &&
  v.every(
    (c) =>
      isObj(c) && typeof c.id === "string" && typeof c.name === "string" && typeof c.limit === "number" &&
      optMonth(c.since) && optMonth(c.archivedFrom) &&
      (c.history === undefined ||
        (Array.isArray(c.history) && c.history.every((h) => isObj(h) && isMonth(h.until) && typeof h.limit === "number"))),
  );

export const isSettingsData = (v: unknown): v is Omit<Settings, "version"> =>
  isObj(v) && typeof v.base === "string" && Array.isArray(v.currencies) && isObj(v.rates) && isCategories(v.familyCategories);
const isCode = (v: unknown) => typeof v === "string" && /^[A-Z]{3,5}$/.test(v);
export const isUserSettingsData = (v: unknown): v is Omit<UserSettings, "version"> =>
  isObj(v) && isCategories(v.personalCategories) && (v.preferredCurrency === undefined || isCode(v.preferredCurrency));

/** Ответ API на конфликт версий: клиент перечитывает данные и просит проверить и повторить */
export const CONFLICT_MESSAGE = "Настройки изменил другой пользователь, проверьте и повторите.";
