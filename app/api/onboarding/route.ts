import { NextResponse } from "next/server";
import { people, requireUser, unauthorized } from "@/lib/auth";
import { getDb, getRepos } from "@/lib/data";
import { fail } from "@/lib/records";
import { buildView } from "@/lib/store";
import { rsdPerUnit } from "@/lib/fx";
import { FALLBACK_RSD_PER, checklist } from "@/lib/onboarding";
import { onboardingState, parsePatch, patchOnboarding } from "@/lib/onboarding-server";

export const dynamic = "force-dynamic";

/**
 * Состояние знакомства и карточка «Настройка» (выполнение — из данных бюджета). Для опроса: курсы «RSD за единицу»
 * (пресеты пересчитываются в выбранную валюту) и валюта бюджета, если он уже настроен (приглашённый — в семейный)
 */
export async function GET(req: Request) {
  const ctx = await requireUser(req);
  if (!ctx) return unauthorized();
  const { me, partner } = await people(ctx);
  const [state, raw, rsdPer] = await Promise.all([onboardingState(getDb(), ctx), getRepos().store.snapshot(ctx), rsdPerUnit(FALLBACK_RSD_PER)]);
  const view = buildView(raw, me, partner);
  return NextResponse.json(
    { ...state, base: raw.settings?.base ?? null, name: me.name, rsdPer, checklist: checklist(view, state) },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/** { dismiss: bool } — скрыть или вернуть карточку; { hide: пункт } — «не нужно»; { hint: id } — подсказка увидена; { pwa: true } */
export async function PATCH(req: Request) {
  const ctx = await requireUser(req);
  if (!ctx) return unauthorized();
  const p = parsePatch(await req.json().catch(() => null));
  if (!p) return fail(400, "Неверные данные.");
  await patchOnboarding(getDb(), ctx.userId, p);
  return NextResponse.json({ ok: true });
}
