import { requireUser, unauthorized } from "@/lib/auth";
import { getRepos } from "@/lib/data";
import { created, fail } from "@/lib/records";
import { prepareGoal } from "@/lib/savings";

/** Новая копилка: { name, target, currency, scope }. Старый ft:goals (PUT целиком) больше не пишется */
export async function POST(req: Request) {
  const ctx = await requireUser(req);
  if (!ctx) return unauthorized();
  try {
    const settings = await getRepos().settings.get(ctx);
    const g = prepareGoal(await req.json().catch(() => null), ctx.userId, settings?.currencies ?? [], crypto.randomUUID());
    if (!g) return fail(400, "Укажите название и сумму цели.");
    return created(await getRepos().goals.create(ctx, g), g);
  } catch (e) {
    console.error(e);
    return fail(500, "Не удалось создать копилку.");
  }
}
