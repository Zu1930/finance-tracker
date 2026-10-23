import { requireUser, unauthorized } from "@/lib/auth";
import { casResponse } from "@/lib/cas-route";
import { getRepos } from "@/lib/data";
import { isUserSettingsData } from "@/lib/store";

/** Личные настройки текущего пользователя (категории, валюта по умолчанию, скрытый голосовой ввод): { version, data } с проверкой версии */
export async function PUT(req: Request) {
  const ctx = await requireUser(req);
  if (!ctx) return unauthorized();
  const body = (await req.json().catch(() => null)) as { version?: unknown; data?: unknown } | null;
  const d = body?.data;
  const data = isUserSettingsData(d) ? { personalCategories: d.personalCategories, ...(d.preferredCurrency ? { preferredCurrency: d.preferredCurrency } : {}), ...(d.hideQuickEntry ? { hideQuickEntry: true } : {}) } : null;
  return casResponse(body?.version, data, (v, d) => getRepos().userSettings.put(ctx, v, d));
}
