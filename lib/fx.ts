/** Курсы ExchangeRate-API приходят как «сколько C за 1 base»; в приложении — «1 C = x base» */
export function invertRates(apiRates: Record<string, number>, symbols: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of symbols) {
    const r = apiRates[s];
    // 6 значащих цифр: 1 / 0.008515 = 117.44 RSD, без хвоста 117.43981…
    if (typeof r === "number" && r > 0) out[s] = Number((1 / r).toPrecision(6));
  }
  return out;
}

/**
 * Сколько RSD стоит 1 единица каждой валюты (ExchangeRate-API, кеш 6 часов); сервис недоступен — запасная таблица.
 * Для пресетов опроса: суммы в RSD пересчитываются в валюту бюджета
 */
export async function rsdPerUnit(fallback: Record<string, number>): Promise<Record<string, number>> {
  try {
    const res = await fetch("https://open.er-api.com/v6/latest/RSD", { next: { revalidate: 6 * 60 * 60 }, signal: AbortSignal.timeout(3000) } as RequestInit);
    const json = (await res.json()) as { result?: string; rates?: Record<string, number> };
    if (!res.ok || json.result !== "success" || !json.rates) return fallback;
    return { ...fallback, ...invertRates(json.rates, Object.keys(fallback)) };
  } catch {
    return fallback;
  }
}
