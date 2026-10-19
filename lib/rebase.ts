/**
 * Пересчёт всего учёта в новую базовую валюту. Чистые функции без Redis — их вызывают
 * и сервер (/api/rebase), и превью на клиенте, и тесты (lib/rebase.test.mjs).
 * Здесь только type-импорты: файл запускается напрямую через node --test.
 */
import type { Category, LegacyGoal, Settings, TrackerData, UserSettings } from "./types.ts";
import { rebaseRecon } from "./savings.ts";
import type { RawStore } from "./store.ts";

export type LimitRounding = 0 | 1 | 10 | 100;

export type RebaseParams = {
  /** Текущая база (OLD) */
  from: string;
  /** Новая база (NEW) */
  to: string;
  /** Сколько OLD стоит 1 NEW: 1 EUR = 117.2 RSD → 117.2 */
  rate: number;
  /** Шаг округления лимитов; 0 — до копеек */
  limitRounding: LimitRounding;
};

export const round2 = (n: number) => Math.round(n * 100) / 100;

/** Лимит в новой валюте с шагом округления */
export const roundLimit = (n: number, step: LimitRounding) => (step ? Math.round(n / step) * step : round2(n));

type Entry = { amount: number; currency: string; rate: number; base: number };

/** Запись в NEW сохраняет точную сумму, остальные пересчитываются через курс */
export function rebaseEntry<T extends Entry>(e: T, p: RebaseParams): T {
  if (e.currency === p.to) return { ...e, rate: 1, base: e.amount };
  const rate = e.rate / p.rate;
  return { ...e, rate, base: round2(e.amount * rate) };
}

const rebaseCategories = (cats: Category[], p: RebaseParams) =>
  cats.map((c) => {
    const limit = (n: number) => roundLimit(n / p.rate, p.limitRounding);
    return { ...c, limit: limit(c.limit), ...(c.history && { history: c.history.map((h) => ({ ...h, limit: limit(h.limit) })) }) };
  });

/** Личные лимиты пересчитываются с тем же шагом округления, что и семейные */
export const rebaseUserSettings = (u: UserSettings, p: RebaseParams): UserSettings => ({
  ...u,
  personalCategories: rebaseCategories(u.personalCategories, p),
});

export function rebaseSettings(s: Settings, p: RebaseParams, at: string): Settings {
  const rates: Settings["rates"] = {};
  for (const [c, r] of Object.entries(s.rates)) {
    if (c !== p.to && c !== p.from) rates[c] = r === null ? null : r / p.rate;
  }
  rates[p.from] = 1 / p.rate;
  return {
    ...s,
    base: p.to,
    currencies: [p.to, ...s.currencies.filter((c) => c !== p.to)],
    rates,
    familyCategories: rebaseCategories(s.familyCategories, p),
    baseHistory: [...(s.baseHistory ?? []), { from: p.from, to: p.to, rate: p.rate, at }],
  };
}

/**
 * Старые копилки (до переноса в «Сбережения») ведутся в своей валюте и не пересчитываются. У копилок без валюты
 * она была общей base — фиксируем её явно (from), чтобы перенос не принял их за новую базу
 */
export const rebaseGoals = (goals: LegacyGoal[], p: RebaseParams): LegacyGoal[] => goals.map((g) => (g.currency ? g : { ...g, currency: p.from }));

/**
 * Всё хранилище в новой базе: семейное и личные данные ОБОИХ пользователей (сервер, /api/rebase).
 * Версии не трогает — их поднимает запись
 */
export function rebaseStore(raw: RawStore, p: RebaseParams, at: string): RawStore {
  if (!raw.settings) throw new Error("Нет настроек для пересчёта");
  const hashes: RawStore["hashes"] = {};
  for (const [key, hash] of Object.entries(raw.hashes)) {
    hashes[key] = Object.fromEntries(Object.entries(hash).map(([id, e]) => [id, rebaseEntry(e, p)]));
  }
  const userSettings: RawStore["userSettings"] = {};
  for (const [id, u] of Object.entries(raw.userSettings)) userSettings[id] = u && rebaseUserSettings(u, p);
  return {
    settings: rebaseSettings(raw.settings, p, at),
    goals: raw.goals && { ...raw.goals, items: rebaseGoals(raw.goals.items, p) },
    userSettings,
    hashes,
    // Копилки и счета в своих валютах не меняются; суммы снимков сверок — в новую базу
    savings: raw.savings && { ...raw.savings, recons: raw.savings.recons.map((r) => rebaseRecon(r, p.from, p.to, p.rate)) },
  };
}

const mapMonths = <T extends { amount: number; currency: string; rate: number; base: number }>(
  m: Record<string, T[]>,
  p: RebaseParams,
) => Object.fromEntries(Object.entries(m).map(([k, list]) => [k, list.map((e) => rebaseEntry(e, p))]));

/**
 * Превью на клиенте — то, что видно текущему пользователю. Личные суммы партнёра делятся на курс:
 * его записи в новой валюте сервер сохранит точными, поэтому здесь возможна разница в копейках
 */
export function rebaseData(data: TrackerData, p: RebaseParams, at: string): TrackerData {
  if (!data.settings) throw new Error("Нет настроек для пересчёта");
  const div = (v: number) => round2(v / p.rate);
  return {
    ...data,
    settings: rebaseSettings(data.settings, p, at),
    mySettings: rebaseUserSettings(data.mySettings, p),
    familyExpenses: mapMonths(data.familyExpenses, p),
    myExpenses: mapMonths(data.myExpenses, p),
    incomes: mapMonths(data.incomes, p),
    partnerPersonalTotals: Object.fromEntries(Object.entries(data.partnerPersonalTotals).map(([k, v]) => [k, div(v)])),
    partnerPersonalDaily: Object.fromEntries(
      Object.entries(data.partnerPersonalDaily).map(([k, d]) => [k, Object.fromEntries(Object.entries(d).map(([day, v]) => [day, div(v)]))]),
    ),
  };
}
