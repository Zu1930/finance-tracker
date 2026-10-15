import { requireUser, unauthorized } from "@/lib/session";
import { casResponse } from "@/lib/cas-route";
import { K, isUserSettingsData } from "@/lib/store";

/** Личные категории текущего пользователя: { version, data } с проверкой версии */
export async function PUT(req: Request) {
  const user = await requireUser(req);
  if (!user) return unauthorized();
  const body = (await req.json().catch(() => null)) as { version?: unknown; data?: unknown } | null;
  const data = isUserSettingsData(body?.data) ? { personalCategories: body!.data.personalCategories } : null;
  return casResponse(K.userSettings(user.id), body?.version, data);
}
