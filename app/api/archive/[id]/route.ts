import { NextResponse } from "next/server";
import { requireUser, unauthorized } from "@/lib/auth";
import { getDb } from "@/lib/data";
import { archiveView } from "@/lib/archive";
import { fail } from "@/lib/records";

export const dynamic = "force-dynamic";

/** Данные архива в форме /api/data — для страниц только для чтения. Нет доступа — 404, как будто архива нет */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireUser(req);
  if (!ctx) return unauthorized();
  const view = await archiveView(getDb(), ctx.userId, (await params).id);
  return view ? NextResponse.json(view, { headers: { "Cache-Control": "no-store" } }) : fail(404, "Не найдено.");
}

// Архив только для чтения: любые изменения — 403
const readonly = () => fail(403, "Архив только для чтения.");
export const POST = readonly, PUT = readonly, PATCH = readonly, DELETE = readonly;
