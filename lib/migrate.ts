/**
 * Перенос данных из формата одного пользователя (ft:doc:*) в семейный. Чистая функция — тестируется без Redis.
 * Старые категории становятся семейными, траты — семейными с автором MIGRATION_OWNER, доходы — тоже на него.
 * Личные категории у обоих пустые. Старые документы не трогаются: они остаются резервной копией
 */
import { K, type RawStore } from "./store.ts";
import type { Expense, GoalsDoc, Income, LegacyExpense, LegacyIncome, LegacySettings, Settings } from "./types.ts";

/** Нужна ли миграция: есть старые настройки, а новые ещё не в семейном формате */
export const needsMigration = (current: Settings | null, legacy: Record<string, unknown>) =>
  (current?.schemaVersion ?? 0) < 2 && !!legacy.settings;

const MONTH_DOC = /^([mi])-(\d{4}-(0[1-9]|1[0-2]))$/;

export function migrateLegacy(legacy: Record<string, unknown>, ownerId: string, userIds: string[]): RawStore {
  const old = legacy.settings as LegacySettings | undefined;
  if (!old) throw new Error("Нет старых настроек для переноса");
  const { categories, ...rest } = old;
  const settings: Settings = { ...rest, familyCategories: categories ?? [], schemaVersion: 2, version: 0 };

  const hashes: RawStore["hashes"] = {};
  for (const [id, body] of Object.entries(legacy)) {
    const m = MONTH_DOC.exec(id);
    if (!m || !body || typeof body !== "object") continue;
    const month = m[2];
    if (m[1] === "m") {
      const list = ((body as { expenses?: LegacyExpense[] }).expenses ?? []).map((e): Expense => ({ ...e, scope: "family", authorId: ownerId }));
      if (list.length) hashes[K.family(month)] = Object.fromEntries(list.map((e) => [e.id, e]));
    } else {
      const list = ((body as { items?: LegacyIncome[] }).items ?? []).map((i): Income => ({ ...i, authorId: ownerId }));
      if (list.length) hashes[K.incomes(month)] = Object.fromEntries(list.map((i) => [i.id, i]));
    }
  }
  return {
    settings,
    goals: { items: (legacy.goals as { items?: [] } | undefined)?.items ?? [], version: 0 },
    userSettings: Object.fromEntries(userIds.map((id) => [id, { personalCategories: [], version: 0 }])),
    hashes,
  };
}

/** Перенос старых копилок в «Сбережения» нужен: есть старые копилки, а флага schemaVersion 3 ещё нет */
export const needsGoalsMigration = (current: Settings | null, goals: GoalsDoc | null) =>
  !!current && (current.schemaVersion ?? 0) < 3 && (goals?.items.length ?? 0) > 0;
