import { NextResponse } from "next/server";
import { requireUser, unauthorized } from "@/lib/session";
import { ctxOf, getRepos } from "@/lib/data";
import { written } from "@/lib/records";
import { prepareEntry, type Kind } from "@/lib/store";
import type { Expense, Income } from "@/lib/types";

/**
 * Новая запись: { kind, entry }. Автор — из сессии, личная трата — в данных автора.
 * Трата с planItemId: пункт ищется в её scope и месяце у пользователя сессии, совпадение категории
 * проверяется; трата и её id в пункте пишутся атомарно
 */
export async function POST(req: Request) {
  const user = await requireUser(req);
  if (!user) return unauthorized();
  const body = (await req.json().catch(() => null)) as { kind?: unknown; entry?: unknown } | null;
  const kind = body?.kind;
  if (kind !== "expense" && kind !== "income") return NextResponse.json({ error: "Неизвестный тип записи." }, { status: 400 });
  const entry = prepareEntry(kind as Kind, body?.entry, user.id);
  if (!entry) return NextResponse.json({ error: "Некорректная запись." }, { status: 400 });
  const ctx = ctxOf(user);
  const repos = getRepos();
  try {
    if (kind === "income") {
      await repos.incomes.add(ctx, entry as Income);
      return NextResponse.json({ entry });
    }
    const e = entry as Expense;
    // Оплата регулярного платежа: права, категория, вхождение месяца и повторная оплата проверяются отдельно
    if (e.recurringId) return written(await repos.expenses.addForRecurring(ctx, e), e, "Платёж изменил другой пользователь, проверьте и повторите.");
    if (e.planItemId) return written(await repos.expenses.addForPlan(ctx, e), e, "Покупку изменил другой пользователь, проверьте и повторите.");
    await repos.expenses.add(ctx, e);
    return NextResponse.json({ entry });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Не удалось сохранить." }, { status: 500 });
  }
}
