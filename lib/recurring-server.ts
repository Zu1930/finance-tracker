import "server-only";
import { NextResponse } from "next/server";
import { casHashes, getRedis } from "./redis";
import { fail, registerKey } from "./records";
import { payLinkError, paymentOf, shiftMonth } from "./recurring";
import { entryKey, recurringKey } from "./store";
import type { Expense, RecurringPayment } from "./types";

/**
 * Записать трату как оплату регулярного платежа. Платёж ищется в хеше scope траты у пользователя сессии
 * (чужой личный — 403). Уже оплаченный месяц — 409. Трата пишется вместе с новой версией платежа одним
 * скриптом: из двух одновременных оплат одного месяца пройдёт одна, вторая увидит оплату и получит 409
 */
export async function recordRecurringPayment(userId: string, e: Expense): Promise<Response> {
  const pKey = recurringKey(e.scope, userId);
  const key = entryKey("expense", e.scope, userId, e.date.slice(0, 7));
  // Повтор из офлайн-очереди: трата уже записана
  if (await getRedis().hget(key, e.id)) return NextResponse.json({ entry: e });
  await registerKey(key);
  for (let i = 0; i < 5; i++) {
    const p = await getRedis().hget<RecurringPayment>(pKey, e.recurringId!);
    // Оплата месяца может лежать в хеше этого месяца или следующего (оплатили в начале нового)
    const months = [...new Set([e.recurringMonth!, shiftMonth(e.recurringMonth!, 1), e.date.slice(0, 7)])];
    const hashes = await Promise.all(months.map((m) => getRedis().hgetall<Record<string, Expense>>(entryKey("expense", e.scope, userId, m))));
    const paid = !!p && !!paymentOf(p, e.recurringMonth!, hashes.flatMap((h) => Object.values(h ?? {})));
    const err = payLinkError(p, e, paid);
    if (err) return fail(err.status, err.error);
    const ok = await casHashes([
      { key, id: e.id, expected: -1, op: "set", doc: e },
      { key: pKey, id: p!.id, expected: p!.version, op: "set", doc: { ...p!, version: p!.version + 1 } },
    ]);
    if (ok) return NextResponse.json({ entry: e });
  }
  return fail(409, "Платёж изменил другой пользователь, проверьте и повторите.");
}
