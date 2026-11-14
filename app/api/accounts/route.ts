import { requireUser, unauthorized } from "@/lib/auth";
import { getRepos } from "@/lib/data";
import { created, fail } from "@/lib/records";
import { prepareAccount } from "@/lib/savings";
import { dayOf } from "@/lib/ledger-server";

/**
 * Новый счёт: { name, currency, balance, primary? }. Счёт всегда личный: ownerId и автор — из сессии, валюта — из
 * списка валют семьи. Бюджет на журнале — balance становится точкой отсчёта на сегодня (initialAt)
 */
export async function POST(req: Request) {
  const ctx = await requireUser(req);
  if (!ctx) return unauthorized();
  try {
    const settings = await getRepos().settings.get(ctx);
    const body = await req.json().catch(() => null);
    const a = prepareAccount(body, ctx.userId, settings?.currencies ?? [], crypto.randomUUID(), new Date().toISOString(),
      settings?.ledgerSince ? dayOf((body as { day?: unknown } | null)?.day) : undefined);
    if (!a) return fail(400, "Неверные данные счёта.");
    return created(await getRepos().accounts.create(ctx, a), a);
  } catch (e) {
    console.error(e);
    return fail(500, "Не удалось создать счёт.");
  }
}
