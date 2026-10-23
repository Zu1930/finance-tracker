import { NextResponse } from "next/server";
import { requireUser, unauthorized } from "@/lib/session";
import { ctxOf, getRepos } from "@/lib/data";
import { fail } from "@/lib/records";
import { average, recurringPlanPart } from "@/lib/metrics";
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
    const view = buildView(await getRepos().store.snapshot(ctxOf(me)), me, partner, month);
    const today = todayStr();
    const plan = planResponse(view, month, average(view, today)?.income ?? null);
    const rec = recurringPlanPart(view, month, today);
    return NextResponse.json(
      { ...plan, recurring: rec.recurring, recurringTotal: rec.recurringTotal, partner: { ...plan.partner, recurringTotal: rec.partnerRecurringTotal } },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    console.error(e);
    return fail(500, "Хранилище недоступно.");
  }
}
