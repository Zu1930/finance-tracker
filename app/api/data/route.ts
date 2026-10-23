import { NextResponse } from "next/server";
import { people, requireUser, unauthorized } from "@/lib/auth";
import { buildView } from "@/lib/store";
import { getDb, getRepos } from "@/lib/data";
import { pendingReview } from "@/lib/archive";
import { householdNames } from "@/lib/family";
import { isAdmin } from "@/lib/codes";
import { onboardingState } from "@/lib/onboarding-server";
import { eq } from "drizzle-orm";
import * as s from "@/lib/data/postgres/schema";

export const dynamic = "force-dynamic";

/** Данные, видимые текущему пользователю: личное партнёра — только суммами */
export async function GET(req: Request) {
  const ctx = await requireUser(req);
  if (!ctx) return unauthorized();
  try {
    const { me, partner } = await people(ctx);
    const view = buildView(await getRepos().store.snapshot(ctx), me, partner);
    if (isAdmin(ctx.userId)) view.admin = true;
    // Авторы записей — и ушедшие, и удалённые участники
    view.names = await householdNames(getDb(), ctx.householdId);
    const review = await pendingReview(getDb(), ctx.userId);
    if (review) view.pendingReview = review;
    view.onboarding = await onboardingState(getDb(), ctx);
    // Семья, где второй ещё не принял приглашение: интерфейс семейный, а не solo
    const [h] = await getDb().select({ kind: s.households.kind }).from(s.households).where(eq(s.households.id, ctx.householdId));
    if (h?.kind === "family") delete view.solo;
    return NextResponse.json(view, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Хранилище недоступно." }, { status: 500 });
  }
}
