import { requireUser, unauthorized } from "@/lib/session";
import { getRedis } from "@/lib/redis";
import { createRecord, fail } from "@/lib/records";
import { prepareAccount } from "@/lib/savings";
import { K, recordKey } from "@/lib/store";
import type { Settings } from "@/lib/types";

/** Новый счёт: { name, currency, scope, balance }. ownerId и автор — из сессии, валюта — из списка валют семьи */
export async function POST(req: Request) {
  const user = await requireUser(req);
  if (!user) return unauthorized();
  try {
    const settings = await getRedis().get<Settings>(K.settings);
    const a = prepareAccount(await req.json().catch(() => null), user.id, settings?.currencies ?? [], crypto.randomUUID(), new Date().toISOString());
    if (!a) return fail(400, "Неверные данные счёта.");
    return await createRecord(recordKey("accounts", a.scope, user.id), a);
  } catch (e) {
    console.error(e);
    return fail(500, "Не удалось создать счёт.");
  }
}
