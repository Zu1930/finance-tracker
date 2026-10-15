import { NextResponse } from "next/server";
import { requireUser, unauthorized } from "@/lib/session";
import { casUpdate } from "@/lib/redis";
import { K } from "@/lib/store";
import type { Settings } from "@/lib/types";

/**
 * Слияние курсов в семейные настройки: { base, rates: { EUR: 117.44 }, ratesUpdatedAt? }.
 * Курс — «последний известный», поэтому без 409: сервер сам повторяет запись при гонке.
 * base — к какой базовой валюте курсы: если её успели сменить, курсы отбрасываются
 */
export async function PATCH(req: Request) {
  if (!(await requireUser(req))) return unauthorized();
  const body = (await req.json().catch(() => null)) as { base?: unknown; rates?: unknown; ratesUpdatedAt?: unknown } | null;
  const rates = body?.rates as Record<string, unknown> | undefined;
  if (typeof body?.base !== "string" || !rates || typeof rates !== "object") {
    return NextResponse.json({ error: "Неверные данные." }, { status: 400 });
  }
  const clean: Record<string, number> = {};
  for (const [c, r] of Object.entries(rates)) if (/^[A-Z]{3,5}$/.test(c) && typeof r === "number" && r > 0) clean[c] = r;
  const date = typeof body.ratesUpdatedAt === "string" ? body.ratesUpdatedAt : undefined;
  try {
    const next = await casUpdate<Settings>(K.settings, (cur) => {
      if (!cur || cur.base !== body.base) return null;
      const merged = { ...cur, rates: { ...cur.rates, ...clean } };
      delete merged.rates[cur.base];
      return date ? { ...merged, ratesUpdatedAt: date } : merged;
    });
    return NextResponse.json({ rates: next?.rates ?? null, ratesUpdatedAt: next?.ratesUpdatedAt ?? null, version: next?.version ?? 0 });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Не удалось сохранить курсы." }, { status: 500 });
  }
}
