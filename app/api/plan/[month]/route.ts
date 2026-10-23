import { requireUser, unauthorized } from "@/lib/session";
import { casResponse } from "@/lib/cas-route";
import { ctxOf, getRepos } from "@/lib/data";
import { fail } from "@/lib/records";
import { isMonth, normalizeOverrides } from "@/lib/plan";

/** Семейная часть плана: { version, data: { incomeOverride, limitOverrides } } с проверкой версии */
export async function PUT(req: Request, { params }: { params: Promise<{ month: string }> }) {
  const user = await requireUser(req);
  if (!user) return unauthorized();
  const { month } = await params;
  const body = (await req.json().catch(() => null)) as { version?: unknown; data?: { incomeOverride?: unknown; limitOverrides?: unknown } } | null;
  const income = body?.data?.incomeOverride;
  if (!isMonth(month) || !(income === null || (typeof income === "number" && Number.isFinite(income) && income >= 0))) return fail(400, "Неверные данные плана.");
  try {
    const ctx = ctxOf(user);
    const limitOverrides = normalizeOverrides(body?.data?.limitOverrides ?? {}, (await getRepos().categories.list(ctx)).family, month);
    if (!limitOverrides) return fail(400, "Неверные лимиты.");
    const data = { month, incomeOverride: income === null ? null : Math.round(income * 100) / 100, limitOverrides };
    return casResponse(body?.version, data, (v, d) => getRepos().plans.putFamily(ctx, month, v, d));
  } catch (e) {
    console.error(e);
    return fail(500, "Не удалось сохранить.");
  }
}
