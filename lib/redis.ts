import "server-only";
import { Redis } from "@upstash/redis";
import { K, parseMonthKey, type RawStore } from "./store";
import type { RawSavings } from "./savings";
import type { Account, Expense, Goal, Income, Recon, Settings, UserSettings } from "./types";

let client: Redis | null = null;

export function getRedis(): Redis {
  if (client) return client;
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    throw new Error("Не заданы KV_REST_API_URL и KV_REST_API_TOKEN (или UPSTASH_REDIS_REST_URL / _TOKEN)");
  }
  client = new Redis({ url, token });
  return client;
}

type Entry = Expense | Income;

/** Всё хранилище: семейные настройки, копилки, личные настройки обоих и хеши месяцев из индекса */
export async function readStore(userIds: string[]): Promise<RawStore> {
  const redis = getRedis();
  const head = redis.pipeline();
  head.get(K.settings);
  head.get(K.goals);
  for (const id of userIds) head.get(K.userSettings(id));
  head.smembers(K.index);
  const res = await head.exec();
  const [settings, goals, ...rest] = res as unknown[];
  const keys = ((rest.pop() as string[]) ?? []).filter((k) => parseMonthKey(k));
  const userSettings = Object.fromEntries(userIds.map((id, i) => [id, (rest[i] as UserSettings | null) ?? null]));

  const hashes: RawStore["hashes"] = {};
  if (keys.length) {
    const p = redis.pipeline();
    for (const k of keys) p.hgetall(k);
    const values = (await p.exec()) as (Record<string, Entry> | null)[];
    keys.forEach((k, i) => (hashes[k] = values[i] ?? {}));
  }
  // Отсутствующий ключ в pipeline приходит как undefined — приводим к null, как обещают типы
  return { settings: (settings as Settings | null) ?? null, goals: (goals as RawStore["goals"]) ?? null, userSettings, hashes, savings: await readSavings(userIds) };
}

/** Счета, копилки обоих и все снимки сверок */
export async function readSavings(userIds: string[]): Promise<RawSavings> {
  const p = getRedis().pipeline();
  p.hgetall(K.accounts);
  p.hgetall(K.goals2);
  for (const id of userIds) p.hgetall(K.userAccounts(id));
  for (const id of userIds) p.hgetall(K.userGoals(id));
  p.zrange(K.recons, 0, -1);
  const res = (await p.exec()) as unknown[];
  const n = userIds.length;
  const hash = <T>(v: unknown) => (v ?? {}) as Record<string, T>;
  return {
    accounts: hash<Account>(res[0]),
    goals: hash<Goal>(res[1]),
    userAccounts: Object.fromEntries(userIds.map((id, i) => [id, hash<Account>(res[2 + i])])),
    userGoals: Object.fromEntries(userIds.map((id, i) => [id, hash<Goal>(res[2 + n + i])])),
    recons: ((res[2 + 2 * n] ?? []) as (Recon | string)[]).map((r) => (typeof r === "string" ? (JSON.parse(r) as Recon) : r)),
  };
}

/**
 * CAS для полей хешей: все записи проверяются по version (поля нет — версия −1), затем пишутся или удаляются,
 * и при zadd снимок добавляется в ZSET (только если число снимков не изменилось). Всё атомарно в Lua.
 * ARGV: n, затем по 4 на запись (поле, ожидаемая версия, set|del|check, JSON), затем [score, member, ожидаемый ZCARD]
 */
const HASH_CAS_SCRIPT = `
local n = tonumber(ARGV[1])
for i = 1, n do
  local b = 1 + (i - 1) * 4
  local cur = redis.call('HGET', KEYS[i], ARGV[b + 1])
  local v = -1
  if cur then
    v = 0
    local ok, doc = pcall(cjson.decode, cur)
    if ok and type(doc) == 'table' and doc.version then v = tonumber(doc.version) end
  end
  if v ~= tonumber(ARGV[b + 2]) then return {0, i} end
end
local z = 2 + n * 4
if #KEYS > n and redis.call('ZCARD', KEYS[n + 1]) ~= tonumber(ARGV[z + 2]) then return {0, 0} end
for i = 1, n do
  local b = 1 + (i - 1) * 4
  if ARGV[b + 3] == 'set' then redis.call('HSET', KEYS[i], ARGV[b + 1], ARGV[b + 4])
  elseif ARGV[b + 3] == 'del' then redis.call('HDEL', KEYS[i], ARGV[b + 1]) end
end
if #KEYS > n then redis.call('ZADD', KEYS[n + 1], ARGV[z], ARGV[z + 1]) end
return {1, n}
`;

export type HashOp = { key: string; id: string; expected: number; op: "set" | "del" | "check"; doc?: object };

/** true — записано; false — чья-то версия изменилась (или появился новый снимок) */
export async function casHashes(ops: HashOp[], zadd?: { key: string; score: number; member: object; count: number }): Promise<boolean> {
  const keys = ops.map((o) => o.key);
  const args = [String(ops.length)];
  for (const o of ops) args.push(o.id, String(o.expected), o.op, o.doc ? JSON.stringify(o.doc) : "");
  if (zadd) {
    keys.push(zadd.key);
    args.push(String(zadd.score), JSON.stringify(zadd.member), String(zadd.count));
  }
  const [ok] = (await getRedis().eval(HASH_CAS_SCRIPT, keys, args)) as [number, number];
  return ok === 1;
}

/** Добавление поля хеша и регистрация ключа месяца в индексе — одной транзакцией */
export async function addEntry(key: string, entry: Entry): Promise<void> {
  const tx = getRedis().multi();
  tx.hset(key, { [entry.id]: entry });
  tx.sadd(K.index, key);
  await tx.exec();
}

/** Сколько живёт удалённая запись для «Вернуть» */
const TRASH_TTL_S = 10 * 60;

/** Удаление поля хеша; запись на 10 минут уходит в корзину, чтобы «Вернуть» сохранил автора. null — не найдена */
export async function removeEntry(key: string, id: string): Promise<Entry | null> {
  const redis = getRedis();
  const entry = await redis.hget<Entry>(key, id);
  if (!entry) return null;
  const tx = redis.multi();
  tx.hdel(key, id);
  tx.set(K.trash(id), { key, entry }, { ex: TRASH_TTL_S });
  await tx.exec();
  return entry;
}

/** Вернуть запись из корзины как была, с исходным автором. null — корзина пуста или истекла */
export async function readTrash(id: string): Promise<{ key: string; entry: Entry } | null> {
  return getRedis().get<{ key: string; entry: Entry }>(K.trash(id));
}
export async function restoreEntry(id: string, item: { key: string; entry: Entry }): Promise<void> {
  const tx = getRedis().multi();
  tx.hset(item.key, { [id]: item.entry });
  tx.sadd(K.index, item.key);
  tx.del(K.trash(id));
  await tx.exec();
}

/**
 * CAS: записать документ, только если его version в Redis равна expected. Документ без version считается версией 0.
 * Сравнение и запись атомарны внутри Lua-скрипта
 */
const CAS_SCRIPT = `
local cur = redis.call('GET', KEYS[1])
local v = 0
if cur then
  local ok, doc = pcall(cjson.decode, cur)
  if ok and type(doc) == 'table' and doc.version then v = tonumber(doc.version) end
end
if v ~= tonumber(ARGV[1]) then return {0, v} end
redis.call('SET', KEYS[1], ARGV[2])
return {1, v + 1}
`;

export type CasResult = { ok: true; version: number } | { ok: false; version: number };

export async function casWrite<T extends object>(key: string, expected: number, doc: T): Promise<CasResult> {
  const body = JSON.stringify({ ...doc, version: expected + 1 });
  const [ok, version] = (await getRedis().eval(CAS_SCRIPT, [key], [String(expected), body])) as [number, number];
  return ok === 1 ? { ok: true, version } : { ok: false, version };
}

/** Чтение-изменение-запись через CAS с повторами: для служебных слияний (курсы), где 409 пользователю не нужен */
export async function casUpdate<T extends { version?: number }>(
  key: string,
  update: (cur: T | null) => T | null,
  attempts = 5,
): Promise<T | null> {
  for (let i = 0; i < attempts; i++) {
    const cur = await getRedis().get<T>(key);
    const next = update(cur);
    if (!next) return cur;
    const res = await casWrite(key, cur?.version ?? 0, next);
    if (res.ok) return { ...next, version: res.version };
  }
  throw new Error(`Не удалось записать ${key}: слишком много одновременных изменений`);
}

/**
 * Записать хранилище целиком одной транзакцией MULTI/EXEC (смена базы, миграция):
 * либо применяется всё, либо ничего. Версии настроек, копилок и личных настроек растут на 1
 */
export async function writeStoreAtomic(raw: RawStore): Promise<void> {
  const tx = getRedis().multi();
  const bump = <T extends { version?: number }>(d: T) => ({ ...d, version: (d.version ?? 0) + 1 });
  if (raw.settings) tx.set(K.settings, bump(raw.settings));
  if (raw.goals) tx.set(K.goals, bump(raw.goals));
  for (const [id, u] of Object.entries(raw.userSettings)) if (u) tx.set(K.userSettings(id), bump(u));
  const keys = Object.keys(raw.hashes).filter((k) => Object.keys(raw.hashes[k]).length > 0);
  for (const k of keys) tx.hset(k, raw.hashes[k]);
  if (keys.length) tx.sadd(K.index, keys[0], ...keys.slice(1));
  // Снимки сверок переписываются целиком (смена базы); счета и копилки в своих валютах не меняются
  if (raw.savings?.recons.length) {
    const [first, ...rest] = raw.savings.recons.map((r) => ({ score: Date.parse(r.at), member: JSON.stringify(r) }));
    tx.del(K.recons);
    tx.zadd(K.recons, first, ...rest);
  }
  await tx.exec();
}

// ---------- Формат до семейного бюджета (ft:doc:*): читает только миграция ----------
const LEGACY_INDEX = "ft:docs";
export async function readLegacyDocs(): Promise<Record<string, unknown>> {
  const redis = getRedis();
  const ids = await redis.smembers(LEGACY_INDEX);
  if (ids.length === 0) return {};
  const values = await redis.mget<unknown[]>(...ids.map((id) => `ft:doc:${id}`));
  const out: Record<string, unknown> = {};
  ids.forEach((id, i) => {
    if (values[i] != null) out[id] = values[i];
  });
  return out;
}

