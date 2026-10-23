import "server-only";
import {
  addEntry, casHashes, casUpdate, casWrite, getRedis, readLegacyDocs, readStore, readTrash, removeEntry, restoreEntry, writeStoreAtomic,
} from "./client.ts";
import { DEFAULT_HOUSEHOLD, type Change, type Ctx, type Done, type Repos, type StoredSubscription, type Updated } from "../types.ts";
import { planLinkError } from "../../plan.ts";
import { payLinkError, paymentOf, shiftMonth } from "../../recurring.ts";
import { K, entryKey, parseMonthKey, planItemsKey, recordKey, recurringKey } from "../../store.ts";
import type { User } from "../../users.ts";
import type { TokenRecord } from "../../quick-entry/api.ts";
import type { Expense, Goal, Income, PlanItem, RecurringPayment, Scope, Settings, UserSettings } from "../../types.ts";

/** Пользователь контекста; в Redis один бюджет — любой другой household отклоняется, а не читается как default */
function me(ctx: Ctx): string {
  if (ctx.householdId !== DEFAULT_HOUSEHOLD) throw new Error(`Redis хранит только бюджет «${DEFAULT_HOUSEHOLD}», запрошен «${ctx.householdId}»`);
  if (!memberIds.includes(ctx.userId)) throw new Error(`Пользователь «${ctx.userId}» не участник бюджета`);
  return ctx.userId;
}
// Участники единственного бюджета Redis; задаёт redisRepos. Redis остался только для переноса в Postgres
let memberIds: string[] = [];
const members = () => memberIds;
const redis = () => getRedis();

/** Ключ месяца в индексе: без него снимок и смена базы ключ не увидят. SADD идемпотентен — вызывается до записи */
const registerKey = (key: string) => redis().sadd(K.index, key);

/** Новая запись хеша: поля с таким id ещё нет */
const createIn = (key: string, doc: { id: string }) => casHashes([{ key, id: doc.id, expected: -1, op: "set", doc }]);

/**
 * Изменить запись хеша по CAS. version — какую видел клиент: при расхождении 409. Без version — до 5 попыток
 * на свежих данных (операции, которые складываются: «+ выделить» и «− вернуть» двоих не должны конфликтовать)
 */
async function updateIn<T extends { version: number }>(key: string, id: string, version: number | undefined, change: Change<T>): Promise<Updated<T>> {
  for (let i = 0; i < 5; i++) {
    const cur = await redis().hget<T>(key, id);
    if (!cur) return { ok: false, status: 404 };
    if (version !== undefined && cur.version !== version) return { ok: false, status: 409 };
    const next = change(cur);
    if (next && "error" in next) return { ok: false, ...next };
    const doc = next && { ...next, version: cur.version + 1 };
    const ok = await casHashes([doc ? { key, id, expected: cur.version, op: "set", doc } : { key, id, expected: cur.version, op: "del" }]);
    if (ok) return { ok: true, item: doc };
    if (version !== undefined) break;
  }
  return { ok: false, status: 409 };
}

/** Изменить запись хеша на свежих данных с повторами (служебные связи). null — записи нет */
async function mutateIn<T extends { version: number }>(key: string, id: string, change: (cur: T) => T): Promise<T | null> {
  for (let i = 0; i < 5; i++) {
    const cur = await redis().hget<T>(key, id);
    if (!cur) return null;
    const doc = { ...change(cur), version: cur.version + 1 };
    if (await casHashes([{ key, id, expected: cur.version, op: "set", doc }])) return doc;
  }
  throw new Error(`Не удалось записать ${key}/${id}: слишком много одновременных изменений`);
}

/** Связать трату с пунктом плана (add) или отвязать. Личный пункт — в хеше автора траты; пункта может уже не быть */
async function setPlanLink(e: Expense, add: boolean): Promise<void> {
  if (!e.planItemId) return;
  await mutateIn<PlanItem>(planItemsKey(e.scope, e.authorId, e.date.slice(0, 7)), e.planItemId, (it) => ({
    ...it,
    expenseIds: add ? [...it.expenseIds.filter((x) => x !== e.id), e.id] : it.expenseIds.filter((x) => x !== e.id),
  }));
}

const expenseKey = (ctx: Ctx, scope: Scope, month: string) => entryKey("expense", scope, me(ctx), month);
const SUBS = "ft:push";
const APP_VERSION = "ft:push:version";

export function redisRepos(users: User[]): Repos {
  memberIds = users.map((u) => u.id);
  return {
    settings: {
      get: async (ctx) => (me(ctx), redis().get<Settings>(K.settings)),
      put: async (ctx, expected, data) => (me(ctx), casWrite(K.settings, expected, data)),
      merge: async (ctx, update) => (me(ctx), casUpdate<Settings>(K.settings, update)),
    },

    userSettings: {
      get: (ctx) => redis().get<UserSettings>(K.userSettings(me(ctx))),
      put: (ctx, expected, data) => casWrite(K.userSettings(me(ctx)), expected, data),
    },

    categories: {
      async list(ctx) {
        const [settings, mine] = await Promise.all([redis().get<Settings>(K.settings), redis().get<UserSettings>(K.userSettings(me(ctx)))]);
        return { family: settings?.familyCategories ?? [], mine: mine?.personalCategories ?? [] };
      },
    },

    expenses: {
      add: (ctx, e) => addEntry(expenseKey(ctx, e.scope, e.date.slice(0, 7)), e),

      async addForPlan(ctx, e): Promise<Done> {
        const month = e.date.slice(0, 7);
        const key = expenseKey(ctx, e.scope, month);
        // Повтор из офлайн-очереди (ответ на первую отправку потерялся): запись уже есть — второй раз не связываем
        if (await redis().hget(key, e.id)) return { ok: true };
        const itemKey = planItemsKey(e.scope, me(ctx), month);
        await registerKey(key);
        for (let i = 0; i < 5; i++) {
          const item = await redis().hget<PlanItem>(itemKey, e.planItemId!);
          const err = planLinkError(item, e);
          if (err) return { ok: false, status: 400, error: err };
          const linked = { ...item!, expenseIds: [...item!.expenseIds.filter((x) => x !== e.id), e.id], version: item!.version + 1 };
          if (await casHashes([{ key, id: e.id, expected: -1, op: "set", doc: e }, { key: itemKey, id: item!.id, expected: item!.version, op: "set", doc: linked }])) {
            return { ok: true };
          }
        }
        return { ok: false, status: 409 };
      },

      /**
       * Платёж ищется в хеше scope траты у пользователя сессии (чужой личный — 403). Трата пишется вместе с новой
       * версией платежа одним скриптом: из двух одновременных оплат одного месяца пройдёт одна, вторая получит 409
       */
      async addForRecurring(ctx, e): Promise<Done> {
        const pKey = recurringKey(e.scope, me(ctx));
        const key = expenseKey(ctx, e.scope, e.date.slice(0, 7));
        if (await redis().hget(key, e.id)) return { ok: true };
        await registerKey(key);
        for (let i = 0; i < 5; i++) {
          const p = await redis().hget<RecurringPayment>(pKey, e.recurringId!);
          // Оплата месяца может лежать в хеше этого месяца или следующего (оплатили в начале нового)
          const months = [...new Set([e.recurringMonth!, shiftMonth(e.recurringMonth!, 1), e.date.slice(0, 7)])];
          const hashes = await Promise.all(months.map((m) => redis().hgetall<Record<string, Expense>>(expenseKey(ctx, e.scope, m))));
          const paid = !!p && !!paymentOf(p, e.recurringMonth!, hashes.flatMap((h) => Object.values(h ?? {})));
          const err = payLinkError(p, e, paid);
          if (err) return { ok: false, ...err };
          const ok = await casHashes([
            { key, id: e.id, expected: -1, op: "set", doc: e },
            { key: pKey, id: p!.id, expected: p!.version, op: "set", doc: { ...p!, version: p!.version + 1 } },
          ]);
          if (ok) return { ok: true };
        }
        return { ok: false, status: 409 };
      },

      async remove(ctx, scope, month, id) {
        const e = (await removeEntry(expenseKey(ctx, scope, month), id)) as Expense | null;
        if (e?.planItemId) await setPlanLink(e, false);
        return e;
      },

      inMonth: async (ctx, scope, month) => Object.values((await redis().hgetall<Record<string, Expense>>(expenseKey(ctx, scope, month))) ?? {}),
    },

    incomes: {
      add: async (ctx, i) => (me(ctx), addEntry(K.incomes(i.date.slice(0, 7)), i)),
      remove: async (ctx, month, id) => (me(ctx), (await removeEntry(K.incomes(month), id)) as Income | null),
    },

    trash: {
      async restore(ctx, id) {
        const userId = me(ctx);
        const item = await readTrash(id);
        if (!item) return { ok: false, status: 404 };
        // Личную запись может вернуть только её автор: удалить её мог только он же
        const k = parseMonthKey(item.key);
        if (!k || (k.kind === "personal" && k.userId !== userId)) return { ok: false, status: 403 };
        await restoreEntry(id, item);
        // Связь с пунктом плана возвращается, если пункт ещё есть
        if ((item.entry as Expense).planItemId) await setPlanLink(item.entry as Expense, true);
        return { ok: true, entry: item.entry };
      },
    },

    accounts: {
      create: (ctx, a) => createIn(recordKey("accounts", a.scope, me(ctx)), a),
      update: (ctx, scope, id, version, change) => updateIn(recordKey("accounts", scope, me(ctx)), id, version, change),
    },

    goals: {
      create: (ctx, g) => createIn(recordKey("goals", g.scope, me(ctx)), g),
      update: (ctx, scope, id, version, change) => updateIn(recordKey("goals", scope, me(ctx)), id, version, change),
    },

    recons: {
      async add(ctx, recon, seen, changed, count) {
        const userId = me(ctx);
        // Сверка меняет только семейные и свои личные счета
        if (changed.some((a) => a.scope === "personal" && a.ownerId !== userId)) throw new Error("Сверка не может менять чужой личный счёт");
        const next = new Map(changed.map((a) => [a.id, a]));
        // Версии всех счетов проверяются, изменённые записываются: снимок не должен смешать старые и новые остатки
        const ops = seen.map((a) => {
          const doc = next.get(a.id);
          const key = recordKey("accounts", a.scope, doc ? userId : a.ownerId ?? userId);
          return doc ? { key, id: a.id, expected: a.version, op: "set" as const, doc } : { key, id: a.id, expected: a.version, op: "check" as const };
        });
        return casHashes(ops, { key: K.recons, score: Date.parse(recon.at), member: recon, count });
      },
    },

    plans: {
      async putFamily(ctx, month, expected, data) {
        me(ctx);
        await registerKey(K.plan(month));
        return casWrite(K.plan(month), expected, data);
      },
      async putMine(ctx, month, expected, data) {
        const key = K.myPlan(me(ctx), month);
        await registerKey(key);
        return casWrite(key, expected, data);
      },
    },

    planItems: {
      async create(ctx, item) {
        const key = planItemsKey(item.scope, me(ctx), item.month);
        await registerKey(key);
        return createIn(key, item);
      },
      get: (ctx, scope, month, id) => redis().hget<PlanItem>(planItemsKey(scope, me(ctx), month), id),
      update: (ctx, scope, month, id, version, change) => updateIn(planItemsKey(scope, me(ctx), month), id, version, change),
      async move(ctx, cur, moved) {
        const userId = me(ctx);
        const from = planItemsKey(cur.scope, userId, cur.month);
        const to = planItemsKey(moved.scope, userId, moved.month);
        await registerKey(to);
        return casHashes([{ key: from, id: cur.id, expected: cur.version, op: "del" }, { key: to, id: moved.id, expected: -1, op: "set", doc: moved }]);
      },
    },

    recurring: {
      get: (ctx, scope, id) => redis().hget<RecurringPayment>(recurringKey(scope, me(ctx)), id),
      create: (ctx, p) => createIn(recurringKey(p.scope, me(ctx)), p),
      update: (ctx, scope, id, version, change) => updateIn(recurringKey(scope, me(ctx)), id, version, change),
    },

    apiTokens: {
      list: async (ctx) => (await redis().hgetall<Record<string, TokenRecord>>(K.tokens(me(ctx)))) ?? {},
      add: async (ctx, id, rec) => void (await redis().hset(K.tokens(me(ctx)), { [id]: rec })),
      remove: async (ctx, id) => (await redis().hdel(K.tokens(me(ctx)), id)) > 0,
    },

    push: {
      save: async (ctx, subscription) =>
        void (await redis().hset(SUBS, { [subscription.endpoint]: { userId: me(ctx), subscription, at: new Date().toISOString() } satisfies StoredSubscription })),
      async remove(ctx, endpoint) {
        const s = await redis().hget<StoredSubscription>(SUBS, endpoint);
        if (s?.userId === me(ctx)) await redis().hdel(SUBS, endpoint);
      },
      has: async (ctx, endpoint) => (await redis().hget<StoredSubscription>(SUBS, endpoint))?.userId === me(ctx),
    },

    store: {
      snapshot: async (ctx) => (me(ctx), readStore(members())),
      replace: async (ctx, raw) => (me(ctx), writeStoreAtomic(raw)),
    },

    legacy: {
      docs: async (ctx) => (me(ctx), readLegacyDocs()),
      hasDocs: async (ctx) => (me(ctx), (await redis().exists("ft:doc:settings")) > 0),
      async importGoals(ctx, goals: Goal[]) {
        me(ctx);
        // HSETNX — повтор ничего не задвоит и не перезапишет
        const tx = redis().multi();
        for (const goal of goals) tx.hsetnx(K.goals2, goal.id, goal);
        await tx.exec();
      },
    },

    system: {
      households: async () => [{ id: DEFAULT_HOUSEHOLD, userIds: members() }],
      familySnapshot: async () => {
        throw new Error("Архивов в Redis нет");
      },
      householdOf: async (userId) => (members().includes(userId) ? DEFAULT_HOUSEHOLD : null),
      async ensureHousehold(userId) {
        if (members().includes(userId)) return DEFAULT_HOUSEHOLD;
        throw new Error("Redis хранит только бюджет default");
      },
      members: async (householdId) => (householdId === DEFAULT_HOUSEHOLD ? users : []),
      tokensOf: async (userId) => (members().includes(userId) ? ((await redis().hgetall<Record<string, TokenRecord>>(K.tokens(userId))) ?? {}) : {}),
      touchToken: async (userId, id, rec) => void (await redis().hset(K.tokens(userId), { [id]: rec })),
      async hitToken(tokenId) {
        const key = K.quickRate(tokenId, Math.floor(Date.now() / 60_000));
        const [count] = (await redis().multi().incr(key).expire(key, 60).exec()) as [number, number];
        return count;
      },
      async subscriptions(userIds) {
        const all = Object.values((await redis().hgetall<Record<string, StoredSubscription>>(SUBS)) ?? {});
        return all.filter((s) => !userIds || userIds.includes(s.userId));
      },
      dropSubscription: async (endpoint) => void (await redis().hdel(SUBS, endpoint)),
      // SET … GET атомарно меняет версию и возвращает прежнюю — из нескольких инстансов пуш уйдёт один раз
      swapAppVersion: (sha) => redis().set<string>(APP_VERSION, sha, { get: true }),
    },
  };
}
