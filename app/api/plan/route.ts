import { NextResponse } from "next/server";
import { requireUser, unauthorized } from "@/lib/session";
import { readStore } from "@/lib/redis";
import { fail } from "@/lib/records";
import { average } from "@/lib/metrics";
import { isMonth, planResponse } from "@/lib/plan";
import { buildView } from "@/lib/store";
import { partnerOf } from "@/lib/users";
import { todayStr } from "@/lib/utils";

export const dynamic = "force-dynamic";

/** План месяца для текущего пользователя: GET /api/plan?month=YYYY-MM. Личное партнёра — только суммы */
export async function GET(req: Request) {
  const me = await requireUser(req);
  if (!me) return unauthorized();
  const month = new URL(req.url).searchParams.get("month");
  if (!isMonth(month)) return fail(400, "Неверный месяц.");
  try {
    const partner = partnerOf(me.id);
    const view = buildView(await readStore([me.id, partner.id]), me, partner, month);
    return NextResponse.json(planResponse(view, month, average(view, todayStr())?.income ?? null), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error(e);
    return fail(500, "Хранилище недоступно.");
  }
}
