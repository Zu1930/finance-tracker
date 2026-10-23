import { NextResponse } from "next/server";
import { requireUser, unauthorized } from "@/lib/auth";
import { getDb } from "@/lib/data";
import { familyInfo } from "@/lib/family";

export const dynamic = "force-dynamic";

/** :: СЕМЬЯ — тип бюджета, участники и действующие приглашения */
export async function GET(req: Request) {
  const ctx = await requireUser(req);
  if (!ctx) return unauthorized();
  return NextResponse.json(await familyInfo(getDb(), ctx), { headers: { "Cache-Control": "no-store" } });
}
