import { NextResponse } from "next/server";
import { requireUser, unauthorized } from "@/lib/session";
import { getRedis, readStore } from "@/lib/redis";
import { createRecord, fail } from "@/lib/records";
import { prepareRecurring } from "@/lib/recurring";
import { K, buildView, recurringKey } from "@/lib/store";
import { partnerOf } from "@/lib/users";
import type { Settings, UserSettings } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Платежи для управления: семейные и мои, без удалённых (с endMonth) */
export async function GET(req: Request) {
  const me = await requireUser(req);
  if (!me) return unauthorized();
  const partner = partnerOf(me.id);
  const view = buildView(await readStore([me.id, partner.id]), me, partner);
  const live = <T extends { endMonth?: string }>(l: T[]) => l.filter((p) => !p.endMonth);
  return NextResponse.json({ family: live(view.recurring.family), mine: live(view.recurring.mine) }, { headers: { "Cache-Control": "no-store" } });
}

/** Новый платёж: { name, amount, currency, approx, frequency, day, month?, categoryId, scope, startMonth } */
export async function POST(req: Request) {
  const user = await requireUser(req);
  if (!user) return unauthorized();
  try {
    const [settings, mine] = await Promise.all([getRedis().get<Settings>(K.settings), getRedis().get<UserSettings>(K.userSettings(user.id))]);
    const p = prepareRecurring(
      await req.json().catch(() => null), user.id,
      { family: settings?.familyCategories ?? [], mine: mine?.personalCategories ?? [] }, settings?.currencies ?? [], crypto.randomUUID(),
    );
    if (!p) return fail(400, "Укажите название, сумму, день и категорию.");
    return await createRecord(recurringKey(p.scope, user.id), p);
  } catch (e) {
    console.error(e);
    return fail(500, "Не удалось сохранить.");
  }
}
