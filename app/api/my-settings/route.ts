import { requireUser, unauthorized } from "@/lib/session";
import { casResponse } from "@/lib/cas-route";
import { K, isUserSettingsData } from "@/lib/store";

/** Личные настройки текущего пользователя (категории, валюта по умолчанию): { version, data } с проверкой версии */
export async function PUT(req: Request) {
  const user = await requireUser(req);
  if (!user) return unauthorized();
  const body = (await req.json().catch(() => null)) as { version?: unknown; data?: unknown } | null;
  const d = body?.data;
  const data = isUserSettingsData(d) ? { personalCategories: d.personalCategories, ...(d.preferredCurrency ? { preferredCurrency: d.preferredCurrency } : {}) } : null;
  return casResponse(K.userSettings(user.id), body?.version, data);
}
