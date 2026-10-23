import { NextResponse } from "next/server";
import { people, requireUser, unauthorized } from "@/lib/auth";
import { buildView } from "@/lib/store";
import { getRepos } from "@/lib/data";

export const dynamic = "force-dynamic";

/** Данные, видимые текущему пользователю: личное партнёра — только суммами */
export async function GET(req: Request) {
  const ctx = await requireUser(req);
  if (!ctx) return unauthorized();
  try {
    const { me, partner } = await people(ctx);
    const view = buildView(await getRepos().store.snapshot(ctx), me, partner);
    return NextResponse.json(view, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Хранилище недоступно." }, { status: 500 });
  }
}
