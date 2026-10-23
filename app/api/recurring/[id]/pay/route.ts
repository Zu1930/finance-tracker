import { requireUser, unauthorized } from "@/lib/auth";
import { getRepos } from "@/lib/data";
import { fail, written } from "@/lib/records";
import { activeIn, amountIn, isMonth } from "@/lib/recurring";
import type { Expense } from "@/lib/types";
import { todayStr } from "@/lib/utils";

const DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/**
 * Отметить оплату: { scope, month, amount?, today? }. Для примерного платежа amount обязателен, для точного —
 * сумма платежа. Трата: категория и scope из платежа, автор из сессии, дата — сегодня, курс — текущий
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireUser(req);
  if (!ctx) return unauthorized();
  const { id } = await params;
  const b = (await req.json().catch(() => null)) as { scope?: unknown; month?: unknown; amount?: unknown; today?: unknown } | null;
  if (!isMonth(b?.month)) return fail(400, "Неверный месяц.");
  const scope = b.scope === "personal" ? "personal" : "family";
  try {
    const [p, settings] = await Promise.all([getRepos().recurring.get(ctx, scope, id), getRepos().settings.get(ctx)]);
    if (!p) return fail(403, "Платёж не найден.");
    if (!activeIn(p, b.month)) return fail(400, "В этом месяце платежа нет.");
    const amount = p.approx ? b.amount : (b.amount ?? amountIn(p, b.month));
    if (typeof amount !== "number" || !Number.isFinite(amount) || !(amount > 0)) return fail(400, p.approx ? "Введите сумму оплаты." : "Неверная сумма.");
    const rate = p.currency === settings?.base ? 1 : settings?.rates[p.currency];
    if (!rate) return fail(400, `Нет курса ${p.currency}.`);
    const date = typeof b.today === "string" && DAY.test(b.today) ? b.today : todayStr();
    const e: Expense = {
      id: crypto.randomUUID(), amount, currency: p.currency, rate, base: Math.round(amount * rate * 100) / 100,
      catId: p.categoryId, note: p.name, date, ts: Date.now(), scope, authorId: ctx.userId, recurringId: p.id, recurringMonth: b.month,
    };
    return written(await getRepos().expenses.addForRecurring(ctx, e), e, "Платёж изменил другой пользователь, проверьте и повторите.");
  } catch (e) {
    console.error(e);
    return fail(500, "Не удалось сохранить.");
  }
}
