import { requireUser, unauthorized } from "@/lib/session";
import { ctxOf, getRepos } from "@/lib/data";
import { created, fail } from "@/lib/records";
import { prepareAccount } from "@/lib/savings";

/** Новый счёт: { name, currency, scope, balance }. ownerId и автор — из сессии, валюта — из списка валют семьи */
export async function POST(req: Request) {
  const user = await requireUser(req);
  if (!user) return unauthorized();
  try {
    const ctx = ctxOf(user);
    const settings = await getRepos().settings.get(ctx);
    const a = prepareAccount(await req.json().catch(() => null), user.id, settings?.currencies ?? [], crypto.randomUUID(), new Date().toISOString());
    if (!a) return fail(400, "Неверные данные счёта.");
    return created(await getRepos().accounts.create(ctx, a), a);
  } catch (e) {
    console.error(e);
    return fail(500, "Не удалось создать счёт.");
  }
}
