import { NextResponse } from "next/server";
import { requireUser, unauthorized } from "@/lib/auth";
import { betaUsers, createSignupCode, isAdmin, listSignupCodes, revokeSignupCode } from "@/lib/codes";
import { getDb } from "@/lib/data";
import { fail } from "@/lib/records";

export const dynamic = "force-dynamic";

/** Админ (ADMIN_USER_IDS) или ответ с отказом. Не админу — 404, как будто раздела нет */
async function admin(req: Request) {
  const ctx = await requireUser(req);
  if (!ctx) return { error: unauthorized() };
  if (!isAdmin(ctx.userId)) return { error: fail(404, "Не найдено.") };
  return { ctx };
}

/** Коды закрытой регистрации: список с использованием (сами коды не хранятся); пользователи и их устройства с push */
export async function GET(req: Request) {
  const a = await admin(req);
  if (a.error) return a.error;
  const [items, users] = await Promise.all([listSignupCodes(getDb()), betaUsers(getDb())]);
  return NextResponse.json({ items, users }, { headers: { "Cache-Control": "no-store" } });
}

/** Новый код: { uses: 1…100, days: 1…90 }. Код в ответе — единственный раз, когда его видно */
export async function POST(req: Request) {
  const a = await admin(req);
  if (a.error) return a.error;
  const b = (await req.json().catch(() => null)) as { uses?: unknown; days?: unknown } | null;
  const uses = Number(b?.uses), days = Number(b?.days);
  if (!Number.isInteger(uses) || uses < 1 || uses > 100 || !Number.isInteger(days) || days < 1 || days > 90) return fail(400, "Использований 1–100, срок 1–90 дней.");
  return NextResponse.json(await createSignupCode(getDb(), a.ctx.userId, uses, days));
}

/** Отозвать: ?id= */
export async function DELETE(req: Request) {
  const a = await admin(req);
  if (a.error) return a.error;
  const id = new URL(req.url).searchParams.get("id") ?? "";
  return (await revokeSignupCode(getDb(), id)) ? NextResponse.json({ ok: true }) : fail(404, "Не найдено.");
}
