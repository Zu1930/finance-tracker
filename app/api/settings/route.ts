import { requireUser, unauthorized } from "@/lib/auth";
import { casResponse } from "@/lib/cas-route";
import { getRepos } from "@/lib/data";
import { isSettingsData } from "@/lib/store";

/** Семейные настройки целиком: { version, data } с проверкой версии */
export async function PUT(req: Request) {
  const ctx = await requireUser(req);
  if (!ctx) return unauthorized();
  const body = (await req.json().catch(() => null)) as { version?: unknown; data?: unknown } | null;
  // Не ниже 2 (семейный формат); 3 — копилки перенесены, клиент присылает его обратно вместе с настройками
  const data = isSettingsData(body?.data) ? { ...body!.data, schemaVersion: body!.data.schemaVersion === 3 ? 3 : 2 } : null;
  return casResponse(body?.version, data, (v, d) => getRepos().settings.put(ctx, v, d));
}
