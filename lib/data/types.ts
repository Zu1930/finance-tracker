/**
 * Репозитории хранилища. Каждый метод первым аргументом берёт ctx: пользователя сессии и его бюджет (household).
 * Изоляцию обеспечивает реализация: чужой household и чужие личные данные недоступны по построению.
 * Исключение — system: служебные методы до того, как известен пользователь (вход по токену, cron, пуши).
 */
import type { RawStore } from "../store.ts";
import type { TokenRecord } from "../quick-entry/api.ts";
import type {
  Account, Category, Expense, Goal, Income, MonthPlan, MyMonthPlan, PlanItem, Recon, RecurringPayment, Scope, Settings, UserSettings,
} from "../types.ts";

export type Ctx = { userId: string; householdId: string };
/** Единственный бюджет до регистрации; в Redis другого нет */
export const DEFAULT_HOUSEHOLD = "default";

export type Fail = { status: number; error: string };
/** Изменение записи: item — новая версия (null — удалена). Без error: 404 — нет записи, 409 — версия не совпала */
export type Updated<T> = { ok: true; item: T | null } | { ok: false; status: number; error?: string };
/** change: новая запись, null — удалить, { status, error } — отказ */
export type Change<T> = (cur: T) => T | null | Fail;
export type CasResult = { ok: boolean; version: number };
export type Done = { ok: true } | { ok: false; status: number; error?: string };

export type PushSubscriptionJSON = { endpoint: string; keys: { p256dh: string; auth: string } };
export type StoredSubscription = { userId: string; subscription: PushSubscriptionJSON; at: string };

export interface SettingsRepo {
  get(ctx: Ctx): Promise<Settings | null>;
  /** Записать, только если версия равна expected */
  put(ctx: Ctx, expected: number, data: Omit<Settings, "version">): Promise<CasResult>;
  /** Слияние на свежих данных с повторами, без 409 (курсы, флаг схемы). update вернул null — не писать */
  merge(ctx: Ctx, update: (cur: Settings | null) => Settings | null): Promise<Settings | null>;
}

/** Личные настройки пользователя сессии */
export interface UserSettingsRepo {
  get(ctx: Ctx): Promise<UserSettings | null>;
  put(ctx: Ctx, expected: number, data: Omit<UserSettings, "version">): Promise<CasResult>;
}

/** Категории живут в документах настроек и сохраняются вместе с ними; здесь — чтение для проверок */
export interface CategoriesRepo {
  list(ctx: Ctx): Promise<{ family: Category[]; mine: Category[] }>;
}

export interface ExpensesRepo {
  /** Личная — всегда в данных пользователя сессии */
  add(ctx: Ctx, e: Expense): Promise<void>;
  /** Трата по пункту плана: пункт её scope и месяца, трата и связь — атомарно. Повтор того же id — ok */
  addForPlan(ctx: Ctx, e: Expense): Promise<Done>;
  /** Оплата регулярного платежа: права, вхождение месяца, повторная оплата — 403/400/409. Повтор того же id — ok */
  addForRecurring(ctx: Ctx, e: Expense): Promise<Done>;
  /** В корзину на 10 минут; связь с пунктом плана снимается. null — не найдена */
  remove(ctx: Ctx, scope: Scope, month: string, id: string): Promise<Expense | null>;
  inMonth(ctx: Ctx, scope: Scope, month: string): Promise<Expense[]>;
}

export interface IncomesRepo {
  add(ctx: Ctx, i: Income): Promise<void>;
  remove(ctx: Ctx, month: string, id: string): Promise<Income | null>;
}

export interface TrashRepo {
  /** «Вернуть»: запись как была, с автором и связью с пунктом плана. 404 — корзина пуста, 403 — чужая личная */
  restore(ctx: Ctx, id: string): Promise<{ ok: true; entry: Expense | Income } | { ok: false; status: 403 | 404 }>;
}

export interface AccountsRepo {
  /** false — запись с таким id уже есть */
  create(ctx: Ctx, a: Account): Promise<boolean>;
  update(ctx: Ctx, scope: Scope, id: string, version: number | undefined, change: Change<Account>): Promise<Updated<Account>>;
}

export interface GoalsRepo {
  create(ctx: Ctx, g: Goal): Promise<boolean>;
  update(ctx: Ctx, scope: Scope, id: string, version: number | undefined, change: Change<Goal>): Promise<Updated<Goal>>;
}

export interface ReconsRepo {
  /**
   * Снимок сверки: версии всех seen-счетов проверяются, changed записываются, снимок добавляется, если снимков
   * всё ещё count. Атомарно; false — кто-то изменил счета или сверился раньше
   */
  add(ctx: Ctx, recon: Recon, seen: Account[], changed: Account[], count: number): Promise<boolean>;
}

export interface PlansRepo {
  putFamily(ctx: Ctx, month: string, expected: number, data: Omit<MonthPlan, "version">): Promise<CasResult>;
  putMine(ctx: Ctx, month: string, expected: number, data: Omit<MyMonthPlan, "version">): Promise<CasResult>;
}

export interface PlanItemsRepo {
  create(ctx: Ctx, item: PlanItem): Promise<boolean>;
  get(ctx: Ctx, scope: Scope, month: string, id: string): Promise<PlanItem | null>;
  update(ctx: Ctx, scope: Scope, month: string, id: string, version: number | undefined, change: Change<PlanItem>): Promise<Updated<PlanItem>>;
  /** Перенос в другой месяц: удаление cur и запись moved атомарно, если версия cur не изменилась */
  move(ctx: Ctx, cur: PlanItem, moved: PlanItem): Promise<boolean>;
}

export interface RecurringRepo {
  get(ctx: Ctx, scope: Scope, id: string): Promise<RecurringPayment | null>;
  create(ctx: Ctx, p: RecurringPayment): Promise<boolean>;
  update(ctx: Ctx, scope: Scope, id: string, version: number | undefined, change: Change<RecurringPayment>): Promise<Updated<RecurringPayment>>;
}

/** Токены Быстрых команд пользователя сессии */
export interface ApiTokensRepo {
  list(ctx: Ctx): Promise<Record<string, TokenRecord>>;
  add(ctx: Ctx, id: string, rec: TokenRecord): Promise<void>;
  remove(ctx: Ctx, id: string): Promise<boolean>;
}

/** Push-подписки устройств пользователя сессии */
export interface PushRepo {
  save(ctx: Ctx, subscription: PushSubscriptionJSON): Promise<void>;
  /** Только свою */
  remove(ctx: Ctx, endpoint: string): Promise<void>;
  has(ctx: Ctx, endpoint: string): Promise<boolean>;
}

export interface StoreRepo {
  /**
   * Всё содержимое бюджета, включая личное всех участников: только для расчётов на сервере.
   * Клиенту — только через buildView, который оставляет от личного партнёра суммы
   */
  snapshot(ctx: Ctx): Promise<RawStore>;
  /** Смена базовой валюты и перенос старого формата: всё одной транзакцией, версии растут на 1 */
  replace(ctx: Ctx, raw: RawStore): Promise<void>;
}

/** Данные до семейного формата и до «Сбережений»: читают только миграции v2 и v3 */
export interface LegacyRepo {
  docs(ctx: Ctx): Promise<Record<string, unknown>>;
  hasDocs(ctx: Ctx): Promise<boolean>;
  /** Старые копилки переносятся с теми же id; уже перенесённые не перезаписываются */
  importGoals(ctx: Ctx, goals: Goal[]): Promise<void>;
}

/** Служебное: до того, как известен пользователь, или для всех сразу */
export interface SystemRepo {
  /** Бюджеты и их участники — для cron */
  households(): Promise<{ id: string; userIds: string[] }[]>;
  /** Бюджет пользователя; null — ни в одном не состоит */
  householdOf(userId: string): Promise<string | null>;
  /** Участники бюджета в порядке вступления */
  members(householdId: string): Promise<{ id: string; name: string }[]>;
  tokensOf(userId: string): Promise<Record<string, TokenRecord>>;
  touchToken(userId: string, id: string, rec: TokenRecord): Promise<void>;
  /** Запрос токеном в текущую минуту → сколько их уже было, включая этот */
  hitToken(tokenId: string): Promise<number>;
  /** Подписки пользователей (все — без userIds) */
  subscriptions(userIds?: string[]): Promise<StoredSubscription[]>;
  dropSubscription(endpoint: string): Promise<void>;
  /** Записать версию приложения и вернуть прежнюю — атомарно, чтобы пуш об обновлении ушёл один раз */
  swapAppVersion(sha: string): Promise<string | null>;
}

export type Repos = {
  settings: SettingsRepo;
  userSettings: UserSettingsRepo;
  categories: CategoriesRepo;
  expenses: ExpensesRepo;
  incomes: IncomesRepo;
  trash: TrashRepo;
  accounts: AccountsRepo;
  goals: GoalsRepo;
  recons: ReconsRepo;
  plans: PlansRepo;
  planItems: PlanItemsRepo;
  recurring: RecurringRepo;
  apiTokens: ApiTokensRepo;
  push: PushRepo;
  store: StoreRepo;
  legacy: LegacyRepo;
  system: SystemRepo;
};
