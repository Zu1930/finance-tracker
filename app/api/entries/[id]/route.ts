import { NextResponse } from "next/server";
import { requireUser, unauthorized } from "@/lib/auth";
import { getRepos } from "@/lib/data";
import { MONTH, prepareEntry } from "@/lib/store";
import type { Expense, Income } from "@/lib/types";

/**
 * Удаление: ?kind=expense|income&scope=family|personal&month=YYYY-MM.
 * Личная трата ищется только у текущего пользователя — чужую удалить нельзя.
 * Семейные траты и доходы может удалить любой из двоих: бюджет общий. Связь с пунктом плана снимается
 */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireUser(req);
  if (!ctx) return unauthorized();
  const { id } = await params;
  const q = new URL(req.url).searchParams;
  const kind = q.get("kind"), scope = q.get("scope"), month = q.get("month") ?? "";
  if ((kind !== "expense" && kind !== "income") || !MONTH.test(month)) {
    return NextResponse.json({ error: "Неверные параметры." }, { status: 400 });
  }
  try {
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

/**
 * Правка на месте: { kind, scope, month, seen, entry }. seen — запись, как её видел клиент: изменилась — 409.
 * Права — как на удаление (личная ищется только у текущего пользователя); перенести между семьёй и личным может
 * только автор. Смена категории или бюджета отвязывает трату от пункта плана и регулярного платежа
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireUser(req);
  if (!ctx) return unauthorized();
  const { id } = await params;
  const b = (await req.json().catch(() => null)) as { kind?: unknown; scope?: unknown; month?: unknown; seen?: unknown; entry?: unknown } | null;
  const kind = b?.kind, month = typeof b?.month === "string" ? b.month : "";
  if ((kind !== "expense" && kind !== "income") || !MONTH.test(month)) return NextResponse.json({ error: "Неверные параметры." }, { status: 400 });
  const seen = prepareEntry(kind, b?.seen, "") as Expense | Income | null;
  const next = prepareEntry(kind, { ...(b?.entry as object), id }, ctx.userId) as Expense | Income | null;
  if (!seen || !next || seen.id !== id) return NextResponse.json({ error: "Некорректная запись." }, { status: 400 });
  try {
    const r = kind === "income"
      ? await getRepos().incomes.update(ctx, month, seen as Income, next as Income)
      : await getRepos().expenses.update(ctx, b?.scope === "personal" ? "personal" : "family", month, seen as Expense, next as Expense);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    return NextResponse.json({ entry: r.entry });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Не удалось сохранить." }, { status: 500 });
  }
}
