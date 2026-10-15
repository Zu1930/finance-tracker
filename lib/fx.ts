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
