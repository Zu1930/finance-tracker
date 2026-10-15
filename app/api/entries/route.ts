import { NextResponse } from "next/server";
import { requireUser, unauthorized } from "@/lib/session";
import { addEntry } from "@/lib/redis";
import { entryKey, prepareEntry, type Kind } from "@/lib/store";

/** Новая запись: { kind, entry }. Автор — из сессии, ключ — по kind, scope и месяцу даты */
export async function POST(req: Request) {
  const user = await requireUser(req);
  if (!user) return unauthorized();
  const body = (await req.json().catch(() => null)) as { kind?: unknown; entry?: unknown } | null;
  const kind = body?.kind;
  if (kind !== "expense" && kind !== "income") return NextResponse.json({ error: "Неизвестный тип записи." }, { status: 400 });
  const entry = prepareEntry(kind as Kind, body?.entry, user.id);
  if (!entry) return NextResponse.json({ error: "Некорректная запись." }, { status: 400 });
  try {
    await addEntry(entryKey(kind, "scope" in entry ? entry.scope : undefined, user.id, entry.date.slice(0, 7)), entry);
    return NextResponse.json({ entry });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Не удалось сохранить." }, { status: 500 });
  }
}
