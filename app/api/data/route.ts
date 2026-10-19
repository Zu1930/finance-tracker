import { NextResponse } from "next/server";
import { requireUser, unauthorized } from "@/lib/session";
import { readStore } from "@/lib/redis";
import { buildView } from "@/lib/store";
import { migrationOwner, partnerOf } from "@/lib/users";
import { getRedis } from "@/lib/redis";
import { needsGoalsMigration } from "@/lib/migrate";

export const dynamic = "force-dynamic";

/** Данные, видимые текущему пользователю: личное партнёра — только суммами */
export async function GET(req: Request) {
  const me = await requireUser(req);
  if (!me) return unauthorized();
  try {
    const partner = partnerOf(me.id);
    const raw = await readStore([me.id, partner.id]);
    const view = buildView(raw, me, partner);
    // До переноса новых настроек нет, а старые лежат в ft:doc:settings — показать экран миграции вместо первой настройки
    if (!raw.settings && (await getRedis().exists("ft:doc:settings"))) view.migration = { pending: true, owner: migrationOwner() };
    // Старые копилки ещё не перенесены в «Сбережения»
    if (needsGoalsMigration(raw.settings, raw.goals)) view.savings.migration = { goals: raw.goals!.items.length, owner: migrationOwner() };
    return NextResponse.json(view, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Хранилище недоступно." }, { status: 500 });
  }
}
