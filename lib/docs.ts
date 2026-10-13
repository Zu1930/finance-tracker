/** Документы хранилища: settings, goals и по одному на месяц: m-2026-10 */
export const DOC_ID = /^(settings|goals|m-\d{4}-(0[1-9]|1[0-2]))$/;
export const isMonthId = (id: string) => id.startsWith("m-");
