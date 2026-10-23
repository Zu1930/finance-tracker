import { NextResponse } from "next/server";
import { requireUser, unauthorized } from "@/lib/auth";
import { getDb } from "@/lib/data";
import { fail } from "@/lib/records";
import { CURRENCIES } from "@/lib/onboarding";
import { skipOnboarding } from "@/lib/onboarding-server";

/** «Настрою сам»: { currency? } — solo с категориями по умолчанию, дальше — карточка «Настройка» на вводе */
export async function POST(req: Request) {
  const ctx = await requireUser(req);
  if (!ctx) return unauthorized();
  const b = (await req.json().catch(() => ({}))) as { currency?: unknown } | null;
  const currency = CURRENCIES.find((c) => c === b?.currency) ?? "EUR";
  try {
    const res = await skipOnboarding(getDb(), ctx, currency);
    return res.ok ? NextResponse.json(res) : fail(res.status, res.error);
  } catch (e) {
    console.error(e);
    return fail(500, "Не удалось сохранить.");
  }
}
