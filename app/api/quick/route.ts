import { NextResponse } from "next/server";
import { getRepos, type Ctx } from "@/lib/data";
import { buildView } from "@/lib/store";
import { people } from "@/lib/auth";
import { localDate } from "@/lib/push";
import { handleQuick, type QuickStore } from "@/lib/quick-entry/api";
import { visibleExpenses } from "@/lib/quick-entry/dictionary";

export const dynamic = "force-dynamic";

/** Токен принадлежит пользователю; бюджет — его текущий */
async function ctxOfToken(userId: string): Promise<Ctx> {
  const householdId = await getRepos().system.householdOf(userId);
  if (!householdId) throw new Error(`Пользователь ${userId} ни в одном бюджете`);
  return { userId, householdId };
}

const store: QuickStore = {
  tokens: (userId) => getRepos().system.tokensOf(userId),
  touch: (userId, id, rec) => getRepos().system.touchToken(userId, id, rec),
  hit: (id) => getRepos().system.hitToken(id),
  context: async (userId) => {
    const ctx = await ctxOfToken(userId);
    const { me, partner } = await people(ctx);
    const view = buildView(await getRepos().store.snapshot(ctx), me, partner);
    return { settings: view.settings, personalCategories: view.mySettings.personalCategories, expenses: visibleExpenses(view) };
  },
  write: async (userId, e) => getRepos().expenses.add(await ctxOfToken(userId), e),
};

/**
 * Siri / Быстрые команды: { text, commit }. Без cookie — proxy.ts пропускает, доступ по Authorization: Bearer <токен>.
 * commit: false — только разбор и вопрос; true — разбор заново и запись, если всё понятно
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const today = localDate(new Date(), process.env.APP_TZ || "Europe/Belgrade").date;
    const { status, body: out } = await handleQuick(req.headers.get("authorization"), body, store, today);
    return NextResponse.json(out, { status, headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ ok: false, summary: "Хранилище недоступно." }, { status: 500 });
  }
}
