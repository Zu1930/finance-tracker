import { NextResponse } from "next/server";
import { requireUser, unauthorized } from "@/lib/session";
import { sendPush } from "@/lib/push-server";

/** Тестовый пуш на устройства текущего пользователя */
export async function POST(req: Request) {
  const user = await requireUser(req);
  if (!user) return unauthorized();
  const sent = await sendPush({ title: "Уведомления работают", body: "Так будут приходить напоминания", url: "/settings", tag: "test" }, [user.id]);
  return NextResponse.json({ sent });
}
