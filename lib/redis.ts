import "server-only";
import { Redis } from "@upstash/redis";

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

const INDEX = "ft:docs";
const key = (id: string) => `ft:doc:${id}`;

export async function readAllDocs(): Promise<Record<string, unknown>> {
  const redis = getRedis();
  const ids = await redis.smembers(INDEX);
  if (ids.length === 0) return {};
  const values = await redis.mget<unknown[]>(...ids.map(key));
  const out: Record<string, unknown> = {};
  ids.forEach((id, i) => {
    if (values[i] != null) out[id] = values[i];
  });
  return out;
}

export async function writeDoc(id: string, body: unknown): Promise<void> {
  const p = getRedis().pipeline();
  p.set(key(id), body);
  p.sadd(INDEX, id);
  await p.exec();
}

export async function writeDocs(docs: Record<string, unknown>): Promise<void> {
  const ids = Object.keys(docs);
  if (ids.length === 0) return;
  const p = getRedis().pipeline();
  for (const id of ids) p.set(key(id), docs[id]);
  p.sadd(INDEX, ids[0], ...ids.slice(1));
  await p.exec();
}
