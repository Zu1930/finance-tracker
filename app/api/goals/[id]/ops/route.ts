import { requireUser, unauthorized } from "@/lib/session";
import { ctxOf, getRepos } from "@/lib/data";
import { fail, updated } from "@/lib/records";
import { applyGoalOp } from "@/lib/savings";

const DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/**
 * { scope, amount, date }: + выделить, − вернуть (не больше отведённого). Без версии клиента — операции
 * складываются, одновременные «выделить» у двоих не конфликтуют; сервер повторяет на свежих данных
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser(req);
  if (!user) return unauthorized();
  const { id } = await params;
  const b = (await req.json().catch(() => null)) as { scope?: unknown; amount?: unknown; date?: unknown } | null;
  if (!b || typeof b.amount !== "number" || typeof b.date !== "string" || !DAY.test(b.date)) return fail(400, "Неверные данные.");
  const opId = crypto.randomUUID();
  try {
    const r = await getRepos().goals.update(
      ctxOf(user),
      b.scope === "personal" ? "personal" : "family",
      id,
      undefined,
      (g) => {
        const next = applyGoalOp(g, b.amount as number, user.id, b.date as string, Date.now(), opId);
        return typeof next === "string" ? { status: 409, error: next } : next;
      },
    );
    return updated(r, "Не удалось сохранить: слишком много одновременных изменений.");
  } catch (e) {
    console.error(e);
    return fail(500, "Не удалось сохранить.");
  }
}
