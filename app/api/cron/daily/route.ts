import { NextResponse } from "next/server";
import { getRepos } from "@/lib/data";
import { fail } from "@/lib/records";
import { sendPush } from "@/lib/push-server";
import { localDate, planReminder, weeklyReminder } from "@/lib/push";
import { safeEqual } from "@/lib/session";
import { shiftMonth } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * Ежедневно (vercel.json): в конце месяца — спланировать следующий, по воскресеньям — внести траты.
 * Vercel Cron присылает Authorization: Bearer CRON_SECRET
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !safeEqual(req.headers.get("authorization") ?? "", `Bearer ${secret}`)) return fail(401, "unauthorized");
  try {
    const today = localDate(new Date(), process.env.APP_TZ || "Europe/Belgrade");
    const sent: string[] = [];
    const next = shiftMonth(today.month, 1);
    // Записи каждого за 7 дней, включая сегодня
    const from = new Date(Date.parse(today.date) - 6 * 864e5).toISOString().slice(0, 10);
    const repos = getRepos();
    for (const h of await repos.system.households()) {
      if (!h.userIds.length) continue;
      // Снимок бюджета целиком — от имени любого участника
      const raw = await repos.store.snapshot({ householdId: h.id, userId: h.userIds[0] });

      const p = raw.plans;
      const hasPlan = !!p && (!!p.family[next] || Object.keys(p.familyItems[next] ?? {}).length > 0 ||
        Object.values(p.userItems).some((m) => Object.keys(m[next] ?? {}).length > 0));
      const plan = planReminder(today, next, hasPlan);
      if (plan) sent.push(`plan:${await sendPush(plan, h.userIds)}`);

      const counts: Record<string, number> = {};
      for (const hash of Object.values(raw.hashes)) {
        for (const e of Object.values(hash)) if (e.date >= from && e.date <= today.date) counts[e.authorId] = (counts[e.authorId] ?? 0) + 1;
      }
      for (const id of h.userIds) {
        const msg = weeklyReminder(today.weekday, counts[id] ?? 0, today.date);
        if (msg) sent.push(`weekly:${id}:${await sendPush(msg, [id])}`);
      }
    }
    return NextResponse.json({ today: today.date, sent });
  } catch (e) {
    console.error(e);
    return fail(500, "cron failed");
  }
}
