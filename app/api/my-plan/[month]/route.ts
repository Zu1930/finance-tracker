import { requireUser, unauthorized } from "@/lib/session";
import { casResponse } from "@/lib/cas-route";
import { getRedis } from "@/lib/redis";
import { fail, registerKey } from "@/lib/records";
import { isMonth, normalizeOverrides } from "@/lib/plan";
import { K } from "@/lib/store";
import type { UserSettings } from "@/lib/types";

/** Личные поправки лимитов на месяц: { version, data: { limitOverrides } }. Только свои — ключ из сессии */
export async function PUT(req: Request, { params }: { params: Promise<{ month: string }> }) {
  const user = await requireUser(req);
  if (!user) return unauthorized();
  const { month } = await params;
  const body = (await req.json().catch(() => null)) as { version?: unknown; data?: { limitOverrides?: unknown } } | null;
  if (!isMonth(month)) return fail(400, "Неверный месяц.");
  try {
    const mine = await getRedis().get<UserSettings>(K.userSettings(user.id));
    const limitOverrides = normalizeOverrides(body?.data?.limitOverrides ?? {}, mine?.personalCategories ?? [], month);
    if (!limitOverrides) return fail(400, "Неверные лимиты.");
    const key = K.myPlan(user.id, month);
    await registerKey(key);
    return casResponse(key, body?.version, { month, limitOverrides });
  } catch (e) {
    console.error(e);
    return fail(500, "Не удалось сохранить.");
  }
}
