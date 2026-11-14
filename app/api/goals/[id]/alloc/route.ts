import { NextResponse } from "next/server";
import { requireUser, unauthorized } from "@/lib/auth";
import { getRepos } from "@/lib/data";
import { fail, isVersion } from "@/lib/records";
import { dayOf } from "@/lib/ledger-server";

/**
 * Часть цели на своём счёте: { accountId, amount, version?, day? }. amount — новая часть в валюте счёта
 * («отложить» — больше прежней, «вернуть» — меньше). Не больше свободного на счёте + текущая часть, иначе 409;
 * чужой счёт — 403. version — версия части, как её видел клиент (0 — части не было), иначе 409
 */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireUser(req);
  if (!ctx) return unauthorized();
  const { id } = await params;
  const b = (await req.json().catch(() => null)) as { accountId?: unknown; amount?: unknown; version?: unknown; day?: unknown } | null;
  if (!b || typeof b.accountId !== "string" || typeof b.amount !== "number" || (b.version !== undefined && !isVersion(b.version))) return fail(400, "Неверные данные.");
  try {
    const r = await getRepos().allocs.set(ctx, id, b.accountId, b.amount, b.version as number | undefined, dayOf(b.day));
    return r.ok ? NextResponse.json({ alloc: r.alloc }) : fail(r.status, r.error);
  } catch (e) {
    console.error(e);
    return fail(500, "Не удалось сохранить.");
  }
}
