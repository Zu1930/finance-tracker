/** Документы хранилища: settings, goals и по одному на месяц: траты m-2026-10, поступления i-2026-10 */
export const DOC_ID = /^(settings|goals|[mi]-\d{4}-(0[1-9]|1[0-2]))$/;
export const isMonthId = (id: string) => id.startsWith("m-");
export const isIncomeId = (id: string) => id.startsWith("i-");
