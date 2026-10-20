import { NextResponse } from "next/server";
import { requireUser, unauthorized } from "@/lib/session";
import { readTrash, restoreEntry } from "@/lib/redis";
import { parseMonthKey } from "@/lib/store";
import { setPlanLink } from "@/lib/records";
import type { Expense } from "@/lib/types";

/** «Вернуть» после удаления: { id } → запись возвращается как была, с исходным автором */
export async function POST(req: Request) {
  const user = await requireUser(req);
  if (!user) return unauthorized();
  const { id } = ((await req.json().catch(() => ({}))) ?? {}) as { id?: unknown };
  if (typeof id !== "string") return NextResponse.json({ error: "Нет id." }, { status: 400 });
  const item = await readTrash(id);
  if (!item) return NextResponse.json({ error: "Вернуть уже нельзя." }, { status: 404 });
  // Личную запись может вернуть только её автор: удалить её мог только он же
  const k = parseMonthKey(item.key);
  if (!k || (k.kind === "personal" && k.userId !== user.id)) return NextResponse.json({ error: "Нет доступа." }, { status: 403 });
  await restoreEntry(id, item);
  // Связь с пунктом плана возвращается, если пункт ещё есть
  if ((item.entry as Expense).planItemId) await setPlanLink(item.entry as Expense, true);
  return NextResponse.json({ entry: item.entry });
}
