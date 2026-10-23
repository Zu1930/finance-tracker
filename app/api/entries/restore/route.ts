import { NextResponse } from "next/server";
import { requireUser, unauthorized } from "@/lib/auth";
import { getRepos } from "@/lib/data";

/** «Вернуть» после удаления: { id } → запись возвращается как была, с исходным автором и связью с пунктом плана */
export async function POST(req: Request) {
  const ctx = await requireUser(req);
  if (!ctx) return unauthorized();
  const { id } = ((await req.json().catch(() => ({}))) ?? {}) as { id?: unknown };
  if (typeof id !== "string") return NextResponse.json({ error: "Нет id." }, { status: 400 });
  const r = await getRepos().trash.restore(ctx, id);
  if (!r.ok) return NextResponse.json({ error: r.status === 404 ? "Вернуть уже нельзя." : "Нет доступа." }, { status: r.status });
  return NextResponse.json({ entry: r.entry });
}
