import { NextResponse } from "next/server";
import { requireUser, unauthorized } from "@/lib/auth";
import { getDb } from "@/lib/data";
import { acceptInvite, previewInvite } from "@/lib/family";
import { fail } from "@/lib/records";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ code: string }> };

/** Экран подтверждения: кто приглашает, нужна ли ставка курса */
export async function GET(req: Request, { params }: Params) {
  const ctx = await requireUser(req);
  if (!ctx) return unauthorized();
  const r = await previewInvite(getDb(), (await params).code, ctx.userId);
  return r.ok ? NextResponse.json(r, { headers: { "Cache-Control": "no-store" } }) : fail(r.status, r.error);
}

/** Принять: { rate? } — при разных базовых валютах */
export async function POST(req: Request, { params }: Params) {
  const ctx = await requireUser(req);
  if (!ctx) return unauthorized();
  const b = (await req.json().catch(() => null)) as { rate?: unknown } | null;
  try {
    const r = await acceptInvite(getDb(), (await params).code, ctx.userId, typeof b?.rate === "number" ? b.rate : undefined);
    return r.ok ? NextResponse.json({ ok: true }) : fail(r.status, r.error);
  } catch (e) {
    console.error(e);
    return fail(500, "Не удалось принять приглашение.");
  }
}
