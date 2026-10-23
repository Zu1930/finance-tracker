import { requireUser, unauthorized } from "@/lib/auth";
import { exportAll } from "@/lib/account";
import { getDb } from "@/lib/data";

export const dynamic = "force-dynamic";

/** Все мои данные в JSON: профиль, действующий бюджет и архивы — ровно то, что я вижу в приложении */
export async function GET(req: Request) {
  const ctx = await requireUser(req);
  if (!ctx) return unauthorized();
  const data = await exportAll(getDb(), ctx.userId);
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="spendlog-${data.exportedAt.slice(0, 10)}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
