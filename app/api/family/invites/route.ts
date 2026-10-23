import { NextResponse } from "next/server";
import { requireUser, unauthorized } from "@/lib/auth";
import { getDb } from "@/lib/data";
import { createInvite, revokeInvite } from "@/lib/family";
import { fail } from "@/lib/records";

/** Новое приглашение: код в ответе — единственный раз, когда его видно */
export async function POST(req: Request) {
  const ctx = await requireUser(req);
  if (!ctx) return unauthorized();
  const r = await createInvite(getDb(), ctx);
  return r.ok ? NextResponse.json({ code: r.code, invite: r.invite }) : fail(r.status, r.error);
}

/** Отозвать: ?id= (только приглашение своего бюджета) */
export async function DELETE(req: Request) {
  const ctx = await requireUser(req);
  if (!ctx) return unauthorized();
  const id = new URL(req.url).searchParams.get("id") ?? "";
  return (await revokeInvite(getDb(), ctx, id)) ? NextResponse.json({ ok: true }) : fail(404, "Не найдено.");
}
