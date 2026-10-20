import { NextResponse } from "next/server";
import { addEntry, getRedis, readStore } from "@/lib/redis";
import { buildView, entryKey, K } from "@/lib/store";
import { getUser, partnerOf } from "@/lib/users";
import { localDate } from "@/lib/push";
import { handleQuick, type QuickStore, type TokenRecord } from "@/lib/quick-entry/api";
import { visibleExpenses } from "@/lib/quick-entry/dictionary";

export const dynamic = "force-dynamic";

const store: QuickStore = {
  tokens: async (userId) => (getUser(userId) ? ((await getRedis().hgetall<Record<string, TokenRecord>>(K.tokens(userId))) ?? {}) : {}),
  touch: async (userId, id, rec) => void (await getRedis().hset(K.tokens(userId), { [id]: rec })),
  hit: async (id) => {
    const key = K.quickRate(id, Math.floor(Date.now() / 60_000));
    const [count] = (await getRedis().multi().incr(key).expire(key, 60).exec()) as [number, number];
    return count;
  },
  context: async (userId) => {
    const me = getUser(userId)!;
    const partner = partnerOf(userId);
    const view = buildView(await readStore([me.id, partner.id]), me, partner);
    return { settings: view.settings, personalCategories: view.mySettings.personalCategories, expenses: visibleExpenses(view) };
  },
  write: (userId, e) => addEntry(entryKey("expense", e.scope, userId, e.date.slice(0, 7)), e),
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
