import { NextResponse } from "next/server";
import { requireUser, unauthorized } from "@/lib/session";
import { getRedis } from "@/lib/redis";
import { fail } from "@/lib/records";
import { K } from "@/lib/store";
import { uid } from "@/lib/utils";
import { hashToken, newToken, type TokenRecord } from "@/lib/quick-entry/api";

export const dynamic = "force-dynamic";
const MAX_TOKENS = 10;

/** Мои токены Быстрых команд — без хешей */
export async function GET(req: Request) {
  const user = await requireUser(req);
  if (!user) return unauthorized();
  const all = (await getRedis().hgetall<Record<string, TokenRecord>>(K.tokens(user.id))) ?? {};
  const items = Object.entries(all)
    .map(([id, { name, createdAt, lastUsedAt }]) => ({ id, name, createdAt, lastUsedAt }))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return NextResponse.json({ items });
}

/** Новый токен { name } → { id, token }: токен отдаётся один раз, хранится только SHA-256 */
export async function POST(req: Request) {
  const user = await requireUser(req);
  if (!user) return unauthorized();
  const body = (await req.json().catch(() => null)) as { name?: unknown } | null;
  const name = typeof body?.name === "string" ? body.name.trim().slice(0, 40) : "";
  if (!name) return fail(400, "Укажите имя устройства.");
  const key = K.tokens(user.id);
  if ((await getRedis().hlen(key)) >= MAX_TOKENS) return fail(400, `Не больше ${MAX_TOKENS} токенов — отзовите ненужные.`);
  const id = uid();
  const token = newToken(user.id);
  const rec: TokenRecord = { name, hash: await hashToken(token), createdAt: new Date().toISOString(), lastUsedAt: null };
  await getRedis().hset(key, { [id]: rec });
  return NextResponse.json({ id, token });
}

/** Отозвать ?id= — только свой */
export async function DELETE(req: Request) {
  const user = await requireUser(req);
  if (!user) return unauthorized();
  const id = new URL(req.url).searchParams.get("id") ?? "";
  return (await getRedis().hdel(K.tokens(user.id), id)) ? NextResponse.json({ ok: true }) : fail(404, "Не найдено.");
}
