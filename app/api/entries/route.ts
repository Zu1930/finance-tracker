import { NextResponse } from "next/server";
import { requireUser, unauthorized } from "@/lib/auth";
import { getRepos } from "@/lib/data";
import { written } from "@/lib/records";
import { prepareEntry, type Kind } from "@/lib/store";
import { ledgerCtx } from "@/lib/ledger-server";
import type { Expense, Income } from "@/lib/types";

/**
 * Новая запись: { kind, entry }. Автор — из сессии, личная трата и доход — в данных автора.
 * Трата с planItemId: пункт ищется в её scope и месяце у пользователя сессии, совпадение категории
 * проверяется; трата и её id в пункте пишутся атомарно.
 * Счёт обязателен и должен быть своим (иначе 400): доход пополняет его, трата — в том числе семейная — списывает.
 * goalId у траты — «из цели»: часть цели на этом счёте уменьшается в той же транзакции
 */
export async function POST(req: Request) {
  const ctx = await requireUser(req);
  if (!ctx) return unauthorized();
  const body = (await req.json().catch(() => null)) as { kind?: unknown; entry?: unknown } | null;
  const kind = body?.kind;
  if (kind !== "expense" && kind !== "income") return NextResponse.json({ error: "Неизвестный тип записи." }, { status: 400 });
  const entry = prepareEntry(kind as Kind, body?.entry, ctx.userId);
  if (!entry) return NextResponse.json({ error: "Некорректная запись." }, { status: 400 });
  const repos = getRepos();
  try {
    const { bind } = await ledgerCtx(ctx);
    const b = bind(entry, entry.accountId ?? "", ctx.userId, entry.accountAmount);
    if (!b.ok) return NextResponse.json({ error: b.error }, { status: b.status });
    Object.assign(entry, { accountId: b.accountId, accountAmount: b.accountAmount });
    // Доход всегда личный: автор и владелец — пользователь сессии, scope от клиента не принимается
    if (kind === "income") {
      if (!(await repos.incomes.add(ctx, entry as Income))) return NextResponse.json({ error: "Нет доступа." }, { status: 403 });
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
