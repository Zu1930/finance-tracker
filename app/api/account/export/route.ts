import { requireUser, unauthorized } from "@/lib/auth";
import { exportAll } from "@/lib/account";
import { getDb } from "@/lib/data";
import { entriesCsv } from "@/lib/export";

export const dynamic = "force-dynamic";

/**
 * Все мои данные: JSON — профиль, действующий бюджет и архивы (ровно то, что я вижу в приложении);
 * ?format=csv — траты и доходы действующего бюджета таблицей
 */
export async function GET(req: Request) {
  const ctx = await requireUser(req);
  if (!ctx) return unauthorized();
  const data = await exportAll(getDb(), ctx.userId);
  const csv = new URL(req.url).searchParams.get("format") === "csv";
  const day = data.exportedAt.slice(0, 10);
  return new Response(csv ? entriesCsv(data.budget) : JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": csv ? "text/csv; charset=utf-8" : "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="spendlog-${day}.${csv ? "csv" : "json"}"`,
      "Cache-Control": "no-store",
    },
  });
}
