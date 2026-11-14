import { NextResponse } from "next/server";
import { requireUser, unauthorized } from "@/lib/auth";
import { getRepos } from "@/lib/data";
import { fail } from "@/lib/records";

/** Удалить свой перевод или корректировку */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireUser(req);
  if (!ctx) return unauthorized();
  const { id } = await params;
  try {
    const m = await getRepos().moves.remove(ctx, id);
    return m ? NextResponse.json({ move: m }) : fail(404, "Перевод не найден.");
  } catch (e) {
    console.error(e);
    return fail(500, "Не удалось удалить.");
  }
}
