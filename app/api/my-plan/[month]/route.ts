import { requireUser, unauthorized } from "@/lib/session";
import { casResponse } from "@/lib/cas-route";
import { ctxOf, getRepos } from "@/lib/data";
import { fail } from "@/lib/records";
import { isMonth, normalizeOverrides } from "@/lib/plan";

/** Личные поправки лимитов на месяц: { version, data: { limitOverrides } }. Только свои — ключ из сессии */
export async function PUT(req: Request, { params }: { params: Promise<{ month: string }> }) {
  const user = await requireUser(req);
  if (!user) return unauthorized();
  const { month } = await params;
  const body = (await req.json().catch(() => null)) as { version?: unknown; data?: { limitOverrides?: unknown } } | null;
  if (!isMonth(month)) return fail(400, "Неверный месяц.");
  try {
    const ctx = ctxOf(user);
    const limitOverrides = normalizeOverrides(body?.data?.limitOverrides ?? {}, (await getRepos().categories.list(ctx)).mine, month);
    if (!limitOverrides) return fail(400, "Неверные лимиты.");
    return casResponse(body?.version, { month, limitOverrides }, (v, d) => getRepos().plans.putMine(ctx, month, v, d));
  } catch (e) {
    console.error(e);
    return fail(500, "Не удалось сохранить.");
  }
}
