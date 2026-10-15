import { requireUser, unauthorized } from "@/lib/session";
import { casResponse } from "@/lib/cas-route";
import { K, isSettingsData } from "@/lib/store";

/** Семейные настройки целиком: { version, data } с проверкой версии */
export async function PUT(req: Request) {
  if (!(await requireUser(req))) return unauthorized();
  const body = (await req.json().catch(() => null)) as { version?: unknown; data?: unknown } | null;
  const data = isSettingsData(body?.data) ? { ...body!.data, schemaVersion: 2 } : null;
  return casResponse(K.settings, body?.version, data);
}
