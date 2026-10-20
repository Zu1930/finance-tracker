import { NextResponse } from "next/server";
import { requireUser, unauthorized } from "@/lib/session";
import { fail } from "@/lib/records";
import { hasSubscription, isSubscription, removeSubscription, saveSubscription, vapid } from "@/lib/push-server";

export const dynamic = "force-dynamic";

/** Публичный VAPID-ключ для подписки; ?endpoint= — подписано ли это устройство на сервере */
export async function GET(req: Request) {
  const user = await requireUser(req);
  if (!user) return unauthorized();
  const v = vapid();
  if (!v) return fail(404, "Уведомления не настроены на сервере.");
  const endpoint = new URL(req.url).searchParams.get("endpoint");
  return NextResponse.json({ publicKey: v.publicKey, subscribed: endpoint ? await hasSubscription(user.id, endpoint) : false });
}

/** Подписать это устройство: { subscription } — пользователь из сессии */
export async function POST(req: Request) {
  const user = await requireUser(req);
  if (!user) return unauthorized();
  const body = (await req.json().catch(() => null)) as { subscription?: unknown } | null;
  if (!isSubscription(body?.subscription)) return fail(400, "Неверная подписка.");
  await saveSubscription(user.id, body.subscription);
  return NextResponse.json({ ok: true });
}

/** Отписать: { endpoint } — только свою подписку */
export async function DELETE(req: Request) {
  const user = await requireUser(req);
  if (!user) return unauthorized();
  const body = (await req.json().catch(() => null)) as { endpoint?: unknown } | null;
  if (typeof body?.endpoint !== "string") return fail(400, "Нет endpoint.");
  await removeSubscription(user.id, body.endpoint);
  return NextResponse.json({ ok: true });
}
