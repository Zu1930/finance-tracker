import { NextResponse } from "next/server";
import { getDb, getRepos } from "@/lib/data";
import { purgeExpired } from "@/lib/archive";
import { fail } from "@/lib/records";
import { sendPush } from "@/lib/push-server";
import { DEFAULT_REMINDERS, localDate, planReminder, weeklyReminder } from "@/lib/push";
import { safeEqual, shiftMonth } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * Каждый час (.github/workflows/reminders.yml): тем, у кого сейчас выбранный час (user_settings.reminders, в поясе их устройства; нет — APP_TZ), —
 * в конце месяца спланировать следующий, в выбранный день недели — внести траты;
 * удалить распущенные семьи, у которых истёк срок архива (purge_at). Запрос несёт Authorization: Bearer CRON_SECRET
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !safeEqual(req.headers.get("authorization") ?? "", `Bearer ${secret}`)) return fail(401, "unauthorized");
  try {
    const now = new Date();
    const fallbackTz = process.env.APP_TZ || "Europe/Belgrade";
    const sent: string[] = [];
    const repos = getRepos();
    const purged = await purgeExpired(getDb());
    if (purged.length) console.log(`cron: удалены архивы (purge_at истёк): ${purged.join(", ")}`);
    for (const h of await repos.system.households()) {
      if (!h.userIds.length) continue;
      // Снимок бюджета целиком — от имени любого участника; в нём и личные настройки каждого
      const raw = await repos.store.snapshot({ householdId: h.id, userId: h.userIds[0] });
      // День и час — в поясе устройства, с которого человек сохранил расписание
      const due = h.userIds.map((id) => {
        const pref = raw.userSettings[id]?.reminders ?? DEFAULT_REMINDERS;
        return { id, pref, today: localDate(now, pref.tz || fallbackTz) };
      }).filter((u) => u.pref.hour === u.today.hour);
      if (!due.length) continue;

      const p = raw.plans;
      const hasPlan = (next: string) => !!p && (!!p.family[next] || Object.keys(p.familyItems[next] ?? {}).length > 0 ||
        Object.values(p.userItems).some((m) => Object.keys(m[next] ?? {}).length > 0));
      // Записи человека за 7 дней, включая его сегодня
      const count = (id: string, today: string) => {
        const from = new Date(Date.parse(today) - 6 * 864e5).toISOString().slice(0, 10);
        let n = 0;
        for (const hash of Object.values(raw.hashes)) for (const e of Object.values(hash)) if (e.authorId === id && e.date >= from && e.date <= today) n++;
        return n;
      };
      for (const { id, pref, today } of due) {
        const next = shiftMonth(today.month, 1);
        const plan = planReminder(today, next, hasPlan(next), pref.planDays);
        if (plan) sent.push(`plan:${id}:${await sendPush(plan, [id])}`);
        const msg = weeklyReminder(today.weekday, count(id, today.date), today.date, pref.weekday);
        if (msg) sent.push(`weekly:${id}:${await sendPush(msg, [id])}`);
      }
    }
    return NextResponse.json({ at: now.toISOString(), sent, purged: purged.length });
  } catch (e) {
    console.error(e);
    return fail(500, "cron failed");
  }
}
