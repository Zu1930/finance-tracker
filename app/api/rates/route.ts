import { requireUser, unauthorized } from "@/lib/session";
import { NextResponse } from "next/server";
import { invertRates } from "@/lib/fx";

const CODE = /^[A-Z]{3,5}$/;
/** ExchangeRate-API обновляет курсы раз в сутки; кешируем ответ на 6 часов */
const REVALIDATE_S = 6 * 60 * 60;

/** Курсы на сегодня: GET /api/rates?base=RSD&symbols=EUR,USD → { rates: { EUR: 117.44 }, updated: "2026-10-15" } */
export async function GET(req: Request) {
  if (!(await requireUser(req))) return unauthorized();
  const params = new URL(req.url).searchParams;
  const base = params.get("base") ?? "";
  const symbols = (params.get("symbols") ?? "").split(",").filter(Boolean);
  if (!CODE.test(base) || symbols.length === 0 || !symbols.every((s) => CODE.test(s))) {
    return NextResponse.json({ error: "Неверные коды валют." }, { status: 400 });
  }
  try {
    const res = await fetch(`https://open.er-api.com/v6/latest/${base}`, { next: { revalidate: REVALIDATE_S } });
    const json = (await res.json()) as { result?: string; rates?: Record<string, number>; time_last_update_unix?: number };
    if (!res.ok || json.result !== "success" || !json.rates) throw new Error(`ExchangeRate-API: ${res.status} ${json.result}`);
    return NextResponse.json({
      rates: invertRates(json.rates, symbols),
      updated: new Date((json.time_last_update_unix ?? Date.now() / 1000) * 1000).toISOString().slice(0, 10),
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Сервис курсов недоступен." }, { status: 502 });
  }
}
