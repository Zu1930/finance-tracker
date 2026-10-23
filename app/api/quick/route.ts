import { NextResponse } from "next/server";
import { ctxOf, getRepos } from "@/lib/data";
import { buildView } from "@/lib/store";
import { getUser, partnerOf } from "@/lib/users";
import { localDate } from "@/lib/push";
import { handleQuick, type QuickStore } from "@/lib/quick-entry/api";
import { visibleExpenses } from "@/lib/quick-entry/dictionary";

export const dynamic = "force-dynamic";

const store: QuickStore = {
  tokens: (userId) => getRepos().system.tokensOf(userId),
  touch: (userId, id, rec) => getRepos().system.touchToken(userId, id, rec),
  hit: (id) => getRepos().system.hitToken(id),
  context: async (userId) => {
    const me = getUser(userId)!;
    const partner = partnerOf(userId);
    const view = buildView(await getRepos().store.snapshot(ctxOf(me)), me, partner);
    return { settings: view.settings, personalCategories: view.mySettings.personalCategories, expenses: visibleExpenses(view) };
  },
  write: (userId, e) => getRepos().expenses.add(ctxOf({ id: userId }), e),
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
