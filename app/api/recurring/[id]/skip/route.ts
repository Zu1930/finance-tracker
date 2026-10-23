import { requireUser, unauthorized } from "@/lib/session";
import { ctxOf, getRepos } from "@/lib/data";
import { fail, updated } from "@/lib/records";
import { isMonth } from "@/lib/recurring";

/** Пропустить месяц: в плане и к оплате его не будет. { scope, month } */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser(req);
  if (!user) return unauthorized();
  const { id } = await params;
  const b = (await req.json().catch(() => null)) as { scope?: unknown; month?: unknown } | null;
  if (!isMonth(b?.month)) return fail(400, "Неверный месяц.");
  const month = b.month;
  try {
    return updated(await getRepos().recurring.update(ctxOf(user), b.scope === "personal" ? "personal" : "family", id, undefined,
      (p) => ({ ...p, skips: [...p.skips.filter((m) => m !== month), month].sort() })),
      "Платёж изменил другой пользователь, проверьте и повторите.");
  } catch (e) {
    console.error(e);
    return fail(500, "Не удалось сохранить.");
  }
}
