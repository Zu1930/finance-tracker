import { requireUser, unauthorized } from "@/lib/session";
import { casResponse } from "@/lib/cas-route";
import { K, isGoals } from "@/lib/store";

/** Общие копилки: { version, data: Goal[] } с проверкой версии, чтобы одновременные операции не терялись */
export async function PUT(req: Request) {
  if (!(await requireUser(req))) return unauthorized();
  const body = (await req.json().catch(() => null)) as { version?: unknown; data?: unknown } | null;
  return casResponse(K.goals, body?.version, isGoals(body?.data) ? { items: body!.data } : null);
}
