import { requireUser, unauthorized } from "@/lib/auth";
import { getRepos } from "@/lib/data";
import { created, fail } from "@/lib/records";
import { MAX_AHEAD, monthsAhead, preparePlanItem } from "@/lib/plan";

/** Новая покупка: { name, amount, categoryId, scope, month }. Автор и владелец — из сессии */
export async function POST(req: Request) {
  const ctx = await requireUser(req);
  if (!ctx) return unauthorized();
  try {
    const item = preparePlanItem(await req.json().catch(() => null), ctx.userId, await getRepos().categories.list(ctx), crypto.randomUUID());
    if (!item) return fail(400, "Укажите название, сумму и категорию.");
    // +1 — запас на часовой пояс: у пользователя месяц может начаться раньше, чем на сервере
    if (monthsAhead(new Date().toISOString().slice(0, 7), item.month) > MAX_AHEAD + 1) return fail(400, "Планировать можно на 12 месяцев вперёд.");
    return created(await getRepos().planItems.create(ctx, item), item);
  } catch (e) {
    console.error(e);
    return fail(500, "Не удалось сохранить.");
  }
}
