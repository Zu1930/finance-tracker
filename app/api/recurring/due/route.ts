import { NextResponse } from "next/server";
import { requireUser, unauthorized } from "@/lib/session";
import { readStore } from "@/lib/redis";
import { dueResponse } from "@/lib/metrics";
import { buildView } from "@/lib/store";
import { partnerOf } from "@/lib/users";
import { todayStr } from "@/lib/utils";

export const dynamic = "force-dynamic";

/** К оплате сейчас: просроченные и сегодняшние, в первые 7 дней — ещё неоплаченные прошлого месяца */
export async function GET(req: Request) {
  const me = await requireUser(req);
  if (!me) return unauthorized();
  const partner = partnerOf(me.id);
  const view = buildView(await readStore([me.id, partner.id]), me, partner);
  // Сегодня — у пользователя (часовой пояс сервера другой); без параметра — по серверу
  const q = new URL(req.url).searchParams.get("today") ?? "";
  return NextResponse.json(dueResponse(view, /^\d{4}-\d{2}-\d{2}$/.test(q) ? q : todayStr()), { headers: { "Cache-Control": "no-store" } });
}
