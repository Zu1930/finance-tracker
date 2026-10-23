import { NextResponse } from "next/server";
import { requireUser, unauthorized } from "@/lib/auth";
import { sendPush } from "@/lib/push-server";

/** Тестовый пуш на устройства текущего пользователя */
export async function POST(req: Request) {
  const ctx = await requireUser(req);
  if (!ctx) return unauthorized();
  const sent = await sendPush({ title: "Уведомления работают", body: "Так будут приходить напоминания", url: "/settings", tag: "test" }, [ctx.userId]);
  return NextResponse.json({ sent });
}
