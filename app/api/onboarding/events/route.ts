import { requireUser, unauthorized } from "@/lib/auth";
import { getDb } from "@/lib/data";
import { fail } from "@/lib/records";
import { isEvent, logEvent } from "@/lib/onboarding-server";

/** Шаг опроса { step, action } — для анализа беты. Клиент не ждёт ответа; ошибка записи не мешает опросу */
export async function POST(req: Request) {
  const ctx = await requireUser(req);
  if (!ctx) return unauthorized();
  const e = await req.json().catch(() => null);
  if (!isEvent(e)) return fail(400, "Неверное событие.");
  await logEvent(getDb(), ctx.userId, e).catch((err) => console.error("onboarding event", err));
  return new Response(null, { status: 204 });
}
