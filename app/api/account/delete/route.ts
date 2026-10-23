import { NextResponse } from "next/server";
import { requireUser, unauthorized } from "@/lib/auth";
import { deleteAccount } from "@/lib/account";
import { getDb } from "@/lib/data";
import { fail } from "@/lib/records";

/** Удалить аккаунт: { password, confirm: "УДАЛИТЬ" } */
export async function POST(req: Request) {
  const ctx = await requireUser(req);
  if (!ctx) return unauthorized();
  const b = (await req.json().catch(() => null)) as { password?: unknown; confirm?: unknown } | null;
  if (typeof b?.confirm !== "string" || b.confirm.trim().toUpperCase() !== "УДАЛИТЬ") return fail(400, "Введите слово УДАЛИТЬ.");
  if (typeof b.password !== "string" || !b.password) return fail(400, "Введите пароль.");
  try {
    const r = await deleteAccount(getDb(), ctx.userId, b.password);
    return r.ok ? NextResponse.json({ ok: true }) : fail(r.status, r.error);
  } catch (e) {
    console.error(e);
    return fail(500, "Не удалось удалить аккаунт.");
  }
}
