import { NextResponse } from "next/server";
import { people, requireUser, unauthorized } from "@/lib/auth";
import { getRepos } from "@/lib/data";
import { dueResponse } from "@/lib/metrics";
import { buildView } from "@/lib/store";
import { todayStr } from "@/lib/utils";

export const dynamic = "force-dynamic";

/** К оплате сейчас: просроченные и сегодняшние, в первые 7 дней — ещё неоплаченные прошлого месяца */
export async function GET(req: Request) {
  const ctx = await requireUser(req);
  if (!ctx) return unauthorized();
  const { me, partner } = await people(ctx);
  const view = buildView(await getRepos().store.snapshot(ctx), me, partner);
  // Сегодня — у пользователя (часовой пояс сервера другой); без параметра — по серверу
  const q = new URL(req.url).searchParams.get("today") ?? "";
  return NextResponse.json(dueResponse(view, /^\d{4}-\d{2}-\d{2}$/.test(q) ? q : todayStr()), { headers: { "Cache-Control": "no-store" } });
}
