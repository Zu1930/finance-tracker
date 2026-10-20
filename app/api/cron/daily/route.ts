import { NextResponse } from "next/server";
import { readStore } from "@/lib/redis";
import { fail } from "@/lib/records";
import { sendPush } from "@/lib/push-server";
import { localDate, planReminder, weeklyReminder } from "@/lib/push";
import { safeEqual } from "@/lib/session";
import { listUsers } from "@/lib/users";
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
    const users = listUsers();
    const raw = await readStore(users.map((u) => u.id));
    const sent: string[] = [];

    const next = shiftMonth(today.month, 1);
    const p = raw.plans;
    const hasPlan = !!p && (!!p.family[next] || Object.keys(p.familyItems[next] ?? {}).length > 0 ||
      Object.values(p.userItems).some((m) => Object.keys(m[next] ?? {}).length > 0));
    const plan = planReminder(today, next, hasPlan);
    if (plan) sent.push(`plan:${await sendPush(plan)}`);

    // Записи каждого за 7 дней, включая сегодня
    const from = new Date(Date.parse(today.date) - 6 * 864e5).toISOString().slice(0, 10);
    const counts: Record<string, number> = {};
    for (const hash of Object.values(raw.hashes)) {
      for (const e of Object.values(hash)) if (e.date >= from && e.date <= today.date) counts[e.authorId] = (counts[e.authorId] ?? 0) + 1;
    }
    for (const u of users) {
      const msg = weeklyReminder(today.weekday, counts[u.id] ?? 0, today.date);
      if (msg) sent.push(`weekly:${u.id}:${await sendPush(msg, [u.id])}`);
    }
    return NextResponse.json({ today: today.date, sent });
  } catch (e) {
    console.error(e);
    return fail(500, "cron failed");
  }
}
