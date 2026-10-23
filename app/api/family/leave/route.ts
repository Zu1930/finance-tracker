import { NextResponse } from "next/server";
import { requireUser, unauthorized } from "@/lib/auth";
import { getDb } from "@/lib/data";
import { leaveFamily, leavePreview } from "@/lib/archive";
import { fail } from "@/lib/records";

export const dynamic = "force-dynamic";

/** Что будет при выходе: распустится ли семья */
export async function GET(req: Request) {
  const ctx = await requireUser(req);
  if (!ctx) return unauthorized();
  const r = await leavePreview(getDb(), ctx.userId);
  return r.ok ? NextResponse.json(r) : fail(r.status, r.error);
}

/** Выйти: { confirm: "ВЫЙТИ" } — слово вместо window.confirm */
export async function POST(req: Request) {
  const ctx = await requireUser(req);
  if (!ctx) return unauthorized();
  const b = (await req.json().catch(() => null)) as { confirm?: unknown } | null;
  if (typeof b?.confirm !== "string" || b.confirm.trim().toUpperCase() !== "ВЫЙТИ") return fail(400, "Введите слово ВЫЙТИ.");
  try {
    const r = await leaveFamily(getDb(), ctx.userId);
    return r.ok ? NextResponse.json(r) : fail(r.status, r.error);
  } catch (e) {
    console.error(e);
    return fail(500, "Не удалось выйти из семьи.");
  }
}
