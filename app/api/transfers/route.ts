import { NextResponse } from "next/server";
import { requireUser, unauthorized } from "@/lib/auth";
import { getRepos } from "@/lib/data";
import { fail } from "@/lib/records";
import { checkTransfer } from "@/lib/ledger";
import { dayOf, ledgerCtx } from "@/lib/ledger-server";
import type { LedgerMove } from "@/lib/types";

/**
 * Перевод: { id?, accountId, toAccountId, amount, toAmount?, day?, note? }. Со своего счёта на любой счёт семьи,
 * в том числе партнёра (ему видна только сумма). amount — в валюте отправителя, toAmount — получателя
 * (нет — та же сумма или по текущему курсу). Не доход и не трата: в статистику и лимиты не входит
 */
export async function POST(req: Request) {
  const ctx = await requireUser(req);
  if (!ctx) return unauthorized();
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const id = typeof b?.id === "string" && /^[\w-]{1,64}$/.test(b.id) ? b.id : crypto.randomUUID();
  if (!b || typeof b.accountId !== "string" || typeof b.toAccountId !== "string" || typeof b.amount !== "number") return fail(400, "Неверный перевод.");
  if (b.toAmount !== undefined && typeof b.toAmount !== "number") return fail(400, "Неверная сумма зачисления.");
  try {
    const { accounts, settings } = await ledgerCtx(ctx);
    const t = { accountId: b.accountId, toAccountId: b.toAccountId, amount: b.amount, toAmount: b.toAmount as number | undefined };
    const ok = checkTransfer(t, { userId: ctx.userId, accounts, base: settings?.base ?? "", rates: settings?.rates ?? {} });
    if (!ok.ok) return fail(ok.status, ok.error);
    const m: LedgerMove = {
      id, userId: ctx.userId, type: "transfer", accountId: t.accountId, toAccountId: t.toAccountId,
      amount: Math.round(t.amount * 100) / 100, toAmount: ok.toAmount, date: dayOf(b.day), note: typeof b.note === "string" ? b.note.slice(0, 140) : "", ts: Date.now(),
    };
    if (!(await getRepos().moves.add(ctx, m))) return fail(409, "Перевод с таким id уже есть.");
    return NextResponse.json({ move: m });
  } catch (e) {
    console.error(e);
    return fail(500, "Не удалось сохранить перевод.");
  }
}
