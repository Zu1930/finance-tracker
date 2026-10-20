import { requireUser, unauthorized } from "@/lib/session";
import { getRedis } from "@/lib/redis";
import { createRecord, fail, registerKey } from "@/lib/records";
import { MAX_AHEAD, monthsAhead, preparePlanItem } from "@/lib/plan";
import { K, planItemsKey } from "@/lib/store";
import type { Settings, UserSettings } from "@/lib/types";

/** Новая покупка: { name, amount, categoryId, scope, month }. Автор и владелец — из сессии */
export async function POST(req: Request) {
  const user = await requireUser(req);
  if (!user) return unauthorized();
  try {
    const [settings, mine] = await Promise.all([getRedis().get<Settings>(K.settings), getRedis().get<UserSettings>(K.userSettings(user.id))]);
    const item = preparePlanItem(await req.json().catch(() => null), user.id, { family: settings?.familyCategories ?? [], mine: mine?.personalCategories ?? [] }, crypto.randomUUID());
    if (!item) return fail(400, "Укажите название, сумму и категорию.");
    // +1 — запас на часовой пояс: у пользователя месяц может начаться раньше, чем на сервере
    if (monthsAhead(new Date().toISOString().slice(0, 7), item.month) > MAX_AHEAD + 1) return fail(400, "Планировать можно на 12 месяцев вперёд.");
    const key = planItemsKey(item.scope, user.id, item.month);
    await registerKey(key);
    return await createRecord(key, item);
  } catch (e) {
    console.error(e);
    return fail(500, "Не удалось сохранить.");
  }
}
