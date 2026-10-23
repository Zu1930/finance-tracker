import { NextResponse } from "next/server";
import { requireUser, unauthorized } from "@/lib/auth";
import { getDb } from "@/lib/data";
import { fail } from "@/lib/records";
import { rsdPerUnit } from "@/lib/fx";
import { FALLBACK_RSD_PER, parseDraft } from "@/lib/onboarding";
import { completeOnboarding } from "@/lib/onboarding-server";

/** Опрос целиком (черновик /welcome): всё создаётся одной транзакцией. Уже пройден — 409. Для пары — код приглашения, один раз */
export async function POST(req: Request) {
  const ctx = await requireUser(req);
  if (!ctx) return unauthorized();
  const draft = parseDraft(await req.json().catch(() => null));
  if (!draft) return fail(400, "Неверные данные настройки.");
  try {
    const res = await completeOnboarding(getDb(), ctx, draft, await rsdPerUnit(FALLBACK_RSD_PER));
    return res.ok ? NextResponse.json(res) : fail(res.status, res.error);
  } catch (e) {
    console.error(e);
    return fail(500, "Не удалось сохранить настройку.");
  }
}
