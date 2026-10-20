import { NextResponse } from "next/server";
import { requireUser, unauthorized } from "@/lib/session";
import { addEntry, casHashes, getRedis } from "@/lib/redis";
import { fail, registerKey } from "@/lib/records";
import { planLinkError } from "@/lib/plan";
import { entryKey, planItemsKey, prepareEntry, type Kind } from "@/lib/store";
import type { Expense, PlanItem } from "@/lib/types";

/**
 * Новая запись: { kind, entry }. Автор — из сессии, ключ — по kind, scope и месяцу даты.
 * Трата с planItemId: пункт ищется в хеше её scope и месяца у пользователя сессии, совпадение категории
 * проверяется; трата и её id в пункте пишутся одним скриптом
 */
export async function POST(req: Request) {
  const user = await requireUser(req);
  if (!user) return unauthorized();
  const body = (await req.json().catch(() => null)) as { kind?: unknown; entry?: unknown } | null;
  const kind = body?.kind;
  if (kind !== "expense" && kind !== "income") return NextResponse.json({ error: "Неизвестный тип записи." }, { status: 400 });
  const entry = prepareEntry(kind as Kind, body?.entry, user.id);
  if (!entry) return NextResponse.json({ error: "Некорректная запись." }, { status: 400 });
  const month = entry.date.slice(0, 7);
  const key = entryKey(kind, "scope" in entry ? entry.scope : undefined, user.id, month);
  try {
    const e = entry as Expense;
    if (kind !== "expense" || !e.planItemId) {
      await addEntry(key, entry);
      return NextResponse.json({ entry });
    }
    // Повтор из офлайн-очереди (ответ на первую отправку потерялся): запись уже есть — второй раз не связываем
    if (await getRedis().hget(key, e.id)) return NextResponse.json({ entry });
    const itemKey = planItemsKey(e.scope, user.id, month);
    await registerKey(key);
    for (let i = 0; i < 5; i++) {
      const item = await getRedis().hget<PlanItem>(itemKey, e.planItemId);
      const err = planLinkError(item, e);
      if (err) return fail(400, err);
      const linked = { ...item!, expenseIds: [...item!.expenseIds.filter((x) => x !== e.id), e.id], version: item!.version + 1 };
      if (await casHashes([{ key, id: e.id, expected: -1, op: "set", doc: e }, { key: itemKey, id: item!.id, expected: item!.version, op: "set", doc: linked }])) {
        return NextResponse.json({ entry });
      }
    }
    return fail(409, "Покупку изменил другой пользователь, проверьте и повторите.");
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Не удалось сохранить." }, { status: 500 });
  }
}
