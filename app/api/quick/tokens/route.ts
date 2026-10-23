import { NextResponse } from "next/server";
import { requireUser, unauthorized } from "@/lib/auth";
import { getRepos } from "@/lib/data";
import { fail } from "@/lib/records";
import { uid } from "@/lib/utils";
import { hashToken, newToken, type TokenRecord } from "@/lib/quick-entry/api";

export const dynamic = "force-dynamic";
const MAX_TOKENS = 10;

/** Мои токены Быстрых команд — без хешей */
export async function GET(req: Request) {
  const ctx = await requireUser(req);
  if (!ctx) return unauthorized();
  const all = await getRepos().apiTokens.list(ctx);
  const items = Object.entries(all)
    .map(([id, { name, createdAt, lastUsedAt }]) => ({ id, name, createdAt, lastUsedAt }))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return NextResponse.json({ items });
}

/** Новый токен { name } → { id, token }: токен отдаётся один раз, хранится только SHA-256 */
export async function POST(req: Request) {
  const ctx = await requireUser(req);
  if (!ctx) return unauthorized();
  const body = (await req.json().catch(() => null)) as { name?: unknown } | null;
  const name = typeof body?.name === "string" ? body.name.trim().slice(0, 40) : "";
  if (!name) return fail(400, "Укажите имя устройства.");
  if (Object.keys(await getRepos().apiTokens.list(ctx)).length >= MAX_TOKENS) return fail(400, `Не больше ${MAX_TOKENS} токенов — отзовите ненужные.`);
  const id = uid();
  const token = newToken(ctx.userId);
  const rec: TokenRecord = { name, hash: await hashToken(token), createdAt: new Date().toISOString(), lastUsedAt: null };
  await getRepos().apiTokens.add(ctx, id, rec);
  return NextResponse.json({ id, token });
}

/** Отозвать ?id= — только свой */
export async function DELETE(req: Request) {
  const ctx = await requireUser(req);
  if (!ctx) return unauthorized();
  const id = new URL(req.url).searchParams.get("id") ?? "";
  return (await getRepos().apiTokens.remove(ctx, id)) ? NextResponse.json({ ok: true }) : fail(404, "Не найдено.");
}
