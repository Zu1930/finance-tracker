import { requireUser, unauthorized } from "@/lib/session";
import { NextResponse } from "next/server";
import { readStore, writeStoreAtomic } from "@/lib/redis";
import { rebaseStore, type LimitRounding } from "@/lib/rebase";
import { listUsers } from "@/lib/users";
import { todayStr } from "@/lib/utils";

const ROUNDINGS: LimitRounding[] = [0, 1, 10, 100];

/** Перевод учёта в другую базовую валюту: { from, to, rate, limitRounding } */
export async function POST(req: Request) {
  if (!(await requireUser(req))) return unauthorized();
  const body = (await req.json().catch(() => null)) as {
    from?: unknown;
    to?: unknown;
    rate?: unknown;
    limitRounding?: unknown;
  } | null;
  const { from, to, rate, limitRounding } = body ?? {};
  if (
    typeof from !== "string" ||
    typeof to !== "string" ||
    !/^[A-Z]{3,5}$/.test(to) ||
    to === from ||
    typeof rate !== "number" ||
    !Number.isFinite(rate) ||
    !(rate > 0) ||
    !ROUNDINGS.includes(limitRounding as LimitRounding)
  ) {
    return NextResponse.json({ error: "Неверные параметры пересчёта." }, { status: 400 });
  }

  try {
    // Пересчитываются и личные данные ОБОИХ пользователей: единственное место, где сервер пишет в чужие личные ключи
    const raw = await readStore(listUsers().map((u) => u.id));
    if (!raw.settings) return NextResponse.json({ error: "Трекер ещё не настроен." }, { status: 409 });
    // Защита от двойного пересчёта с двух устройств: база уже сменилась
    if (raw.settings.base !== from) {
      return NextResponse.json({ error: `Учёт уже ведётся в ${raw.settings.base}.` }, { status: 409 });
    }
    const next = rebaseStore(raw, { from, to, rate, limitRounding: limitRounding as LimitRounding }, todayStr());
    await writeStoreAtomic(next);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Не удалось пересчитать данные." }, { status: 500 });
  }
}
