import { NextResponse } from "next/server";
import { requireUser, unauthorized } from "@/lib/auth";
import { getDb } from "@/lib/data";
import { archives } from "@/lib/archive";

export const dynamic = "force-dynamic";

/** :: АРХИВ — бывшие семьи с действующим сроком доступа */
export async function GET(req: Request) {
  const ctx = await requireUser(req);
  if (!ctx) return unauthorized();
  return NextResponse.json({ items: await archives(getDb(), ctx.userId) }, { headers: { "Cache-Control": "no-store" } });
}
