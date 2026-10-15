import { NextResponse } from "next/server";
import { requireUser, unauthorized } from "@/lib/session";
import { removeEntry } from "@/lib/redis";
import { MONTH, entryKey } from "@/lib/store";

/**
 * Удаление: ?kind=expense|income&scope=family|personal&month=YYYY-MM.
 * Личная трата ищется только в хеше текущего пользователя — чужую удалить нельзя.
 * Семейные траты и доходы может удалить любой из двоих: бюджет общий
 */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser(req);
  if (!user) return unauthorized();
  const { id } = await params;
  const q = new URL(req.url).searchParams;
  const kind = q.get("kind"), scope = q.get("scope"), month = q.get("month") ?? "";
  if ((kind !== "expense" && kind !== "income") || !MONTH.test(month)) {
    return NextResponse.json({ error: "Неверные параметры." }, { status: 400 });
  }
  try {
    const entry = await removeEntry(entryKey(kind, scope === "personal" ? "personal" : "family", user.id, month), id);
    if (!entry) return NextResponse.json({ error: "Запись не найдена." }, { status: 404 });
    return NextResponse.json({ entry });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Не удалось удалить." }, { status: 500 });
  }
}
