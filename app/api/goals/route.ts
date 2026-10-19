import { requireUser, unauthorized } from "@/lib/session";
import { getRedis } from "@/lib/redis";
import { createRecord, fail } from "@/lib/records";
import { prepareGoal } from "@/lib/savings";
import { K, recordKey } from "@/lib/store";
import type { Settings } from "@/lib/types";

/** Новая копилка: { name, target, currency, scope }. Старый ft:goals (PUT целиком) больше не пишется */
export async function POST(req: Request) {
  const user = await requireUser(req);
  if (!user) return unauthorized();
  try {
    const settings = await getRedis().get<Settings>(K.settings);
    const g = prepareGoal(await req.json().catch(() => null), user.id, settings?.currencies ?? [], crypto.randomUUID());
    if (!g) return fail(400, "Укажите название и сумму цели.");
    return await createRecord(recordKey("goals", g.scope, user.id), g);
  } catch (e) {
    console.error(e);
    return fail(500, "Не удалось создать копилку.");
  }
}
