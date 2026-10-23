import { requireUser, unauthorized } from "@/lib/auth";
import { getDb } from "@/lib/data";
import { archiveView } from "@/lib/archive";
import { fail } from "@/lib/records";
import { entriesCsv } from "@/lib/export";

export const dynamic = "force-dynamic";

/** Экспорт архива: ?format=json (то, что видно в архиве) или csv (траты и доходы) */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireUser(req);
  if (!ctx) return unauthorized();
  const view = await archiveView(getDb(), ctx.userId, (await params).id);
  if (!view) return fail(404, "Не найдено.");
  const csv = new URL(req.url).searchParams.get("format") === "csv";
  const day = view.readonly!.leftAt.slice(0, 10);
  return new Response(csv ? entriesCsv(view) : JSON.stringify(view, null, 2), {
    headers: {
      "Content-Type": csv ? "text/csv; charset=utf-8" : "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="archive-${day}.${csv ? "csv" : "json"}"`,
      "Cache-Control": "no-store",
    },
  });
}
