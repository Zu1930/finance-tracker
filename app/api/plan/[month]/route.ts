import { requireUser, unauthorized } from "@/lib/session";
import { casResponse } from "@/lib/cas-route";
import { getRedis } from "@/lib/redis";
import { fail, registerKey } from "@/lib/records";
import { isMonth, normalizeOverrides } from "@/lib/plan";
import { K } from "@/lib/store";
import type { Settings } from "@/lib/types";

/** Семейная часть плана: { version, data: { incomeOverride, limitOverrides } } с проверкой версии */
export async function PUT(req: Request, { params }: { params: Promise<{ month: string }> }) {
  if (!(await requireUser(req))) return unauthorized();
  const { month } = await params;
  const body = (await req.json().catch(() => null)) as { version?: unknown; data?: { incomeOverride?: unknown; limitOverrides?: unknown } } | null;
  const income = body?.data?.incomeOverride;
  if (!isMonth(month) || !(income === null || (typeof income === "number" && Number.isFinite(income) && income >= 0))) return fail(400, "Неверные данные плана.");
  try {
    const settings = await getRedis().get<Settings>(K.settings);
    const limitOverrides = normalizeOverrides(body?.data?.limitOverrides ?? {}, settings?.familyCategories ?? [], month);
    if (!limitOverrides) return fail(400, "Неверные лимиты.");
    await registerKey(K.plan(month));
    return casResponse(K.plan(month), body?.version, { month, incomeOverride: income === null ? null : Math.round(income * 100) / 100, limitOverrides });
  } catch (e) {
    console.error(e);
    return fail(500, "Не удалось сохранить.");
  }
}
