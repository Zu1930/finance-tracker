import { NextResponse } from "next/server";
import { requireUser, unauthorized } from "@/lib/session";
import { ctxOf, getRepos } from "@/lib/data";
import { created, fail } from "@/lib/records";
import { prepareRecurring } from "@/lib/recurring";
import { buildView } from "@/lib/store";
import { partnerOf } from "@/lib/users";

export const dynamic = "force-dynamic";

/** Платежи для управления: семейные и мои, без удалённых (с endMonth) */
export async function GET(req: Request) {
  const me = await requireUser(req);
  if (!me) return unauthorized();
  const partner = partnerOf(me.id);
  const view = buildView(await getRepos().store.snapshot(ctxOf(me)), me, partner);
  const live = <T extends { endMonth?: string }>(l: T[]) => l.filter((p) => !p.endMonth);
  return NextResponse.json({ family: live(view.recurring.family), mine: live(view.recurring.mine) }, { headers: { "Cache-Control": "no-store" } });
}

/** Новый платёж: { name, amount, currency, approx, frequency, day, month?, categoryId, scope, startMonth } */
export async function POST(req: Request) {
  const user = await requireUser(req);
  if (!user) return unauthorized();
  try {
    const ctx = ctxOf(user);
    const [settings, cats] = await Promise.all([getRepos().settings.get(ctx), getRepos().categories.list(ctx)]);
    const p = prepareRecurring(await req.json().catch(() => null), user.id, cats, settings?.currencies ?? [], crypto.randomUUID());
    if (!p) return fail(400, "Укажите название, сумму, день и категорию.");
    return created(await getRepos().recurring.create(ctx, p), p);
  } catch (e) {
    console.error(e);
    return fail(500, "Не удалось сохранить.");
  }
}
