import { NextResponse } from "next/server";
import { requireUser, unauthorized } from "@/lib/session";
import { casUpdate, getRedis } from "@/lib/redis";
import { needsGoalsMigration } from "@/lib/migrate";
import { migrateGoals } from "@/lib/savings";
import { K } from "@/lib/store";
import { migrationOwner } from "@/lib/users";
import type { GoalsDoc, Settings } from "@/lib/types";

/** Только MIGRATION_OWNER и только пока старые копилки не перенесены */
async function guard(req: Request) {
  const user = await requireUser(req);
  if (!user) return { error: unauthorized() };
  if (user.id !== migrationOwner().id) return { error: NextResponse.json({ error: "Перенос запускает другой пользователь." }, { status: 403 }) };
  const redis = getRedis();
  const [settings, goals] = await Promise.all([redis.get<Settings>(K.settings), redis.get<GoalsDoc>(K.goals)]);
  if (!settings || !needsGoalsMigration(settings, goals)) {
    return { error: NextResponse.json({ error: "Переносить нечего: копилки уже в «Сбережениях»." }, { status: 409 }) };
  }
  return { settings, goals: goals! };
}

/** Резервная копия старых копилок перед переносом */
export async function GET(req: Request) {
  const g = await guard(req);
  if (g.error) return g.error;
  return NextResponse.json({ version: 1, goals: g.goals });
}

/**
 * Перенос: каждая старая копилка становится семейной с тем же id (HSETNX — повтор ничего не задвоит и не перезапишет),
 * затем флаг schemaVersion 3. Старый ft:goals остаётся резервной копией
 */
export async function POST(req: Request) {
  const g = await guard(req);
  if (g.error) return g.error;
  try {
    const goals = migrateGoals(g.goals.items, g.settings.base, migrationOwner().id);
    const tx = getRedis().multi();
    for (const goal of goals) tx.hsetnx(K.goals2, goal.id, goal);
    await tx.exec();
    await casUpdate<Settings>(K.settings, (s) => (s ? { ...s, schemaVersion: 3 } : null));
    return NextResponse.json({ ok: true, goals: goals.length });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Не удалось перенести копилки." }, { status: 500 });
  }
}
