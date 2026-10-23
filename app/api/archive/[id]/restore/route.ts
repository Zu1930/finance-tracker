import { NextResponse } from "next/server";
import { requireUser, unauthorized } from "@/lib/auth";
import { getDb } from "@/lib/data";
import { requestRestore } from "@/lib/archive";
import { fail } from "@/lib/records";

/** Попросить восстановить распущенную семью; восстановление — когда попросили все участники роспуска */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireUser(req);
  if (!ctx) return unauthorized();
  try {
    const r = await requestRestore(getDb(), ctx.userId, (await params).id);
    return r.ok ? NextResponse.json(r) : fail(r.status, r.error);
  } catch (e) {
    console.error(e);
    return fail(500, "Не удалось восстановить бюджет.");
  }
}
