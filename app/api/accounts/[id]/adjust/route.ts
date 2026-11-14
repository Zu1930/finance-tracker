import { NextResponse } from "next/server";
import { requireUser, unauthorized } from "@/lib/auth";
import { getRepos } from "@/lib/data";
import { fail } from "@/lib/records";
import { dayOf } from "@/lib/ledger-server";

/**
 * «Указать фактический остаток»: { actual, day? }. Пишется корректировка adjustment = actual − баланс на day
 * (по умолчанию сегодня). Только свой счёт; разница 0 — ничего не пишется ({ move: null })
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireUser(req);
  if (!ctx) return unauthorized();
  const { id } = await params;
  const b = (await req.json().catch(() => null)) as { actual?: unknown; day?: unknown; note?: unknown } | null;
  if (typeof b?.actual !== "number" || !Number.isFinite(b.actual)) return fail(400, "Укажите остаток числом.");
  try {
    const r = await getRepos().accounts.adjust(ctx, id, b.actual, {
      id: crypto.randomUUID(), date: dayOf(b.day), ts: Date.now(), note: typeof b.note === "string" ? b.note.slice(0, 140) : "",
    });
    if (!r.ok) return fail(r.status, r.error);
    return NextResponse.json({ move: r.move, balance: r.balance });
  } catch (e) {
    console.error(e);
    return fail(500, "Не удалось сохранить.");
  }
}
