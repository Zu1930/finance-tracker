import type { GoalsDoc, IncomeMonthDoc, MonthDoc, Settings, TrackerData } from "./types";

/** Документы хранилища: settings, goals и по одному на месяц: траты m-2026-10, поступления i-2026-10 */
export const DOC_ID = /^(settings|goals|[mi]-\d{4}-(0[1-9]|1[0-2]))$/;
export const isMonthId = (id: string) => id.startsWith("m-");
export const isIncomeId = (id: string) => id.startsWith("i-");

/** Документы из Redis → данные приложения */
export function docsToData(docs: Record<string, unknown>): TrackerData {
  const data: TrackerData = {
    settings: (docs.settings as Settings | undefined) ?? null,
    goals: (docs.goals as GoalsDoc | undefined)?.items ?? [],
    months: {},
    incomes: {},
  };
  for (const [id, body] of Object.entries(docs)) {
    if (isMonthId(id)) data.months[id] = body as MonthDoc;
    else if (isIncomeId(id)) data.incomes[id] = body as IncomeMonthDoc;
  }
  return data;
}

/** Данные приложения → документы для записи */
export function dataToDocs(data: TrackerData): Record<string, unknown> {
  return { settings: data.settings, goals: { items: data.goals }, ...data.months, ...data.incomes };
}
