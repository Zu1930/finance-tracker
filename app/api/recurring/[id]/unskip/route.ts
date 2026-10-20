import { requireUser, unauthorized } from "@/lib/session";
import { fail, updateRecord } from "@/lib/records";
import { isMonth } from "@/lib/recurring";
import { recurringKey } from "@/lib/store";
import type { RecurringPayment } from "@/lib/types";

/** Вернуть пропущенный месяц. { scope, month } */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser(req);
  if (!user) return unauthorized();
  const { id } = await params;
  const b = (await req.json().catch(() => null)) as { scope?: unknown; month?: unknown } | null;
  if (!isMonth(b?.month)) return fail(400, "Неверный месяц.");
  const month = b.month;
  try {
    return await updateRecord<RecurringPayment>(recurringKey(b.scope === "personal" ? "personal" : "family", user.id), id, undefined,
      (p) => ({ ...p, skips: p.skips.filter((m) => m !== month) }),
      "Платёж изменил другой пользователь, проверьте и повторите.");
  } catch (e) {
    console.error(e);
    return fail(500, "Не удалось сохранить.");
  }
}
