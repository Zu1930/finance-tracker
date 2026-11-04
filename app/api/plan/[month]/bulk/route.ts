import { NextResponse } from "next/server";
import { requireUser, unauthorized } from "@/lib/auth";
import { getRepos } from "@/lib/data";
import { fail } from "@/lib/records";
import { MAX_AHEAD, isMonth, monthsAhead, prepareBulk } from "@/lib/plan";

const CONFLICT = "План изменил другой пользователь, проверьте и повторите.";

/** Мастер плана: доход, поправки лимитов, пропуски регулярных и покупки месяца — одной транзакцией с проверкой версий */
export async function PUT(req: Request, { params }: { params: Promise<{ month: string }> }) {
  const ctx = await requireUser(req);
  if (!ctx) return unauthorized();
  const { month } = await params;
  // +1 — запас на часовой пояс, как у покупок
  if (!isMonth(month) || monthsAhead(new Date().toISOString().slice(0, 7), month) > MAX_AHEAD + 1) return fail(400, "Неверный месяц.");
  try {
    const repos = getRepos();
    const b = prepareBulk(await req.json().catch(() => null), ctx.userId, await repos.categories.list(ctx), month, () => crypto.randomUUID());
    if (!b) return fail(400, "Неверные данные плана.");
    const r = await repos.plans.bulk(ctx, month, b);
    return r.ok ? NextResponse.json({ ok: true }) : fail(r.status, r.error ?? (r.status === 409 ? CONFLICT : "Не найдено."));
  } catch (e) {
    console.error(e);
    return fail(500, "Не удалось сохранить.");
  }
}
