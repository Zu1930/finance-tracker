import { NextResponse } from "next/server";
import { requireUser, unauthorized } from "@/lib/auth";
import { getDb } from "@/lib/data";
import { claim, copyCategories, copyGoal, markReviewed, reviewView } from "@/lib/archive";
import { fail } from "@/lib/records";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

/** Разбор семейного имущества: счета, копилки, регулярные, категории — с тем, кто что забрал */
export async function GET(req: Request, { params }: Params) {
  const ctx = await requireUser(req);
  if (!ctx) return unauthorized();
  const v = await reviewView(getDb(), ctx.userId, (await params).id);
  return v ? NextResponse.json(v, { headers: { "Cache-Control": "no-store" } }) : fail(404, "Не найдено.");
}

/**
 * Шаг разбора: { action: "claim-account" | "claim-recurring" | "copy-goal", id } | { action: "copy-categories" | "done" }.
 * Копии создаются в моём действующем бюджете; сам архив не меняется
 */
export async function POST(req: Request, { params }: Params) {
  const ctx = await requireUser(req);
  if (!ctx) return unauthorized();
  const householdId = (await params).id;
  const b = (await req.json().catch(() => null)) as { action?: unknown; id?: unknown } | null;
  const id = typeof b?.id === "string" ? b.id : "";
  const db = getDb();
  try {
    const r =
      b?.action === "claim-account" ? await claim(db, ctx.userId, householdId, "account", id)
      : b?.action === "claim-recurring" ? await claim(db, ctx.userId, householdId, "recurring", id)
      : b?.action === "copy-goal" ? await copyGoal(db, ctx.userId, householdId, id)
      : b?.action === "copy-categories" ? await copyCategories(db, ctx.userId, householdId)
      : b?.action === "done" ? ((await markReviewed(db, ctx.userId, householdId)) ? { ok: true as const } : { ok: false as const, status: 404, error: "Не найдено." })
      : { ok: false as const, status: 400, error: "Неизвестный шаг." };
    return r.ok ? NextResponse.json(r) : fail(r.status, r.error);
  } catch (e) {
    console.error(e);
    return fail(500, "Не удалось выполнить шаг.");
  }
}
