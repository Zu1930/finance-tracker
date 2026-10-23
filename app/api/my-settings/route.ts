import { requireUser, unauthorized } from "@/lib/session";
import { casResponse } from "@/lib/cas-route";
import { ctxOf, getRepos } from "@/lib/data";
import { isUserSettingsData } from "@/lib/store";

/** Личные настройки текущего пользователя (категории, валюта по умолчанию, скрытый голосовой ввод): { version, data } с проверкой версии */
export async function PUT(req: Request) {
  const user = await requireUser(req);
  if (!user) return unauthorized();
  const body = (await req.json().catch(() => null)) as { version?: unknown; data?: unknown } | null;
  const d = body?.data;
  const data = isUserSettingsData(d) ? { personalCategories: d.personalCategories, ...(d.preferredCurrency ? { preferredCurrency: d.preferredCurrency } : {}), ...(d.hideQuickEntry ? { hideQuickEntry: true } : {}) } : null;
  return casResponse(body?.version, data, (v, d) => getRepos().userSettings.put(ctxOf(user), v, d));
}
