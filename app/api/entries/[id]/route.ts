import { NextResponse } from "next/server";
import { requireUser, unauthorized } from "@/lib/session";
import { ctxOf, getRepos } from "@/lib/data";
import { MONTH } from "@/lib/store";

/**
 * Удаление: ?kind=expense|income&scope=family|personal&month=YYYY-MM.
 * Личная трата ищется только у текущего пользователя — чужую удалить нельзя.
 * Семейные траты и доходы может удалить любой из двоих: бюджет общий. Связь с пунктом плана снимается
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
    const ctx = ctxOf(user);
    const entry = kind === "income"
      ? await getRepos().incomes.remove(ctx, month, id)
      : await getRepos().expenses.remove(ctx, scope === "personal" ? "personal" : "family", month, id);
    if (!entry) return NextResponse.json({ error: "Запись не найдена." }, { status: 404 });
    return NextResponse.json({ entry });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Не удалось удалить." }, { status: 500 });
  }
}
