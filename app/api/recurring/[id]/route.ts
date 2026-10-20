import { requireUser, unauthorized } from "@/lib/session";
import { getRedis } from "@/lib/redis";
import { fail, isVersion, updateRecord } from "@/lib/records";
import { endMonthOnDelete, isMonth, withAmount } from "@/lib/recurring";
import { K, entryKey, recurringKey } from "@/lib/store";
import type { Expense, RecurringPayment, Settings, UserSettings } from "@/lib/types";
import { todayStr } from "@/lib/utils";

const CONFLICT = "Платёж изменил другой пользователь, проверьте и повторите.";
const DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const intIn = (v: unknown, lo: number, hi: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi;

/**
 * { scope, version, name?, categoryId?, day?, month?, approx?, paused?, amount?, fromMonth? }. Новая сумма —
 * запись в истории с fromMonth, прошлые месяцы не меняются. Семейные правят оба, личные — только владелец
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser(req);
  if (!user) return unauthorized();
  const { id } = await params;
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b || !isVersion(b.version)) return fail(400, "Неверные данные.");
  const scope = b.scope === "personal" ? "personal" : "family";
  const name = typeof b.name === "string" ? b.name.trim().slice(0, 40) : undefined;
  const amount = b.amount;
  if (
    name === "" ||
    (b.day !== undefined && !intIn(b.day, 1, 31)) ||
    (b.month !== undefined && !intIn(b.month, 1, 12)) ||
    (b.approx !== undefined && typeof b.approx !== "boolean") ||
    (b.paused !== undefined && typeof b.paused !== "boolean") ||
    (amount !== undefined && !(typeof amount === "number" && Number.isFinite(amount) && amount > 0 && isMonth(b.fromMonth)))
  ) return fail(400, "Неверные данные.");
  try {
    if (b.categoryId !== undefined) {
      const cats = scope === "personal"
        ? (await getRedis().get<UserSettings>(K.userSettings(user.id)))?.personalCategories
        : (await getRedis().get<Settings>(K.settings))?.familyCategories;
      if (!cats?.some((c) => c.id === b.categoryId && !c.archived)) return fail(400, "Нет такой категории.");
    }
    return await updateRecord<RecurringPayment>(recurringKey(scope, user.id), id, b.version, (p) => {
      let next: RecurringPayment = {
        ...p,
        ...(name && { name }),
        ...(typeof b.categoryId === "string" && { categoryId: b.categoryId }),
        ...(typeof b.day === "number" && { day: b.day }),
        ...(typeof b.month === "number" && p.frequency === "yearly" && { month: b.month }),
        ...(typeof b.approx === "boolean" && { approx: b.approx }),
        ...(typeof b.paused === "boolean" && { paused: b.paused }),
      };
      if (typeof amount === "number") next = withAmount(next, amount, b.fromMonth as string);
      return next;
    }, CONFLICT);
  } catch (e) {
    console.error(e);
    return fail(500, "Не удалось сохранить.");
  }
}

/**
 * «Удаление»: платёж заканчивается текущим месяцем (или прошлым, если текущий ещё не оплачен) и пропадает
 * из управления. Связи прошлых трат сохраняются. ?scope=&today=YYYY-MM-DD
 */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser(req);
  if (!user) return unauthorized();
  const { id } = await params;
  const q = new URL(req.url).searchParams;
  const scope = q.get("scope") === "personal" ? "personal" : "family";
  const today = DAY.test(q.get("today") ?? "") ? q.get("today")! : todayStr();
  try {
    const expenses = Object.values((await getRedis().hgetall<Record<string, Expense>>(entryKey("expense", scope, user.id, today.slice(0, 7)))) ?? {});
    return await updateRecord<RecurringPayment>(recurringKey(scope, user.id), id, undefined, (p) => ({ ...p, endMonth: endMonthOnDelete(p, today, expenses) }), CONFLICT);
  } catch (e) {
    console.error(e);
    return fail(500, "Не удалось удалить.");
  }
}
