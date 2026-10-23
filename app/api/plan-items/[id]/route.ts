import { NextResponse } from "next/server";
import { requireUser, unauthorized } from "@/lib/auth";
import { getRepos } from "@/lib/data";
import { fail, isVersion, updated } from "@/lib/records";
import { MAX_AHEAD, isMonth, monthsAhead, planMoveError } from "@/lib/plan";
import type { PlanItem } from "@/lib/types";

const CONFLICT = "Покупку изменил другой пользователь, проверьте и повторите.";

/**
 * { scope, month, version, name?, amount?, categoryId?, toMonth? }. Семейные пункты правят оба, личные — только
 * владелец (из сессии). toMonth — перенос: удаление из месяца и запись в новый атомарно
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireUser(req);
  if (!ctx) return unauthorized();
  const { id } = await params;
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b || !isMonth(b.month) || !isVersion(b.version)) return fail(400, "Неверные данные.");
  const scope = b.scope === "personal" ? "personal" : "family";
  const repos = getRepos();
  const name = typeof b.name === "string" ? b.name.trim().slice(0, 40) : undefined;
  const amount = b.amount;
  if (name === "" || (amount !== undefined && !(typeof amount === "number" && Number.isFinite(amount) && amount > 0))) return fail(400, "Неверные данные.");
  try {
    if (b.toMonth !== undefined && b.toMonth !== b.month) {
      if (!isMonth(b.toMonth) || monthsAhead(new Date().toISOString().slice(0, 7), b.toMonth) > MAX_AHEAD + 1) return fail(400, "Неверный месяц.");
      const cur = await repos.planItems.get(ctx, scope, b.month, id);
      if (!cur) return fail(404, "Не найдено.");
      if (cur.version !== b.version) return fail(409, CONFLICT);
      const err = planMoveError(cur);
      if (err) return fail(409, err);
      const moved: PlanItem = { ...cur, month: b.toMonth, movedFrom: cur.movedFrom ?? b.month, version: cur.version + 1 };
      return (await repos.planItems.move(ctx, cur, moved)) ? NextResponse.json({ item: moved }) : fail(409, CONFLICT);
    }
    let catOk = true;
    if (b.categoryId !== undefined) {
      const cats = await repos.categories.list(ctx);
      catOk = (scope === "personal" ? cats.mine : cats.family).some((c) => c.id === b.categoryId && !c.archived);
    }
    if (!catOk) return fail(400, "Нет такой категории.");
    return updated(await repos.planItems.update(ctx, scope, b.month, id, b.version, (it) => {
      // Связанные траты записаны в старую категорию: сменить её — потерять связь
      if (b.categoryId !== undefined && b.categoryId !== it.categoryId && it.expenseIds.length) return { status: 409, error: "По пункту уже есть траты — категорию не сменить." };
      return {
        ...it,
        ...(name && { name }),
        ...(typeof amount === "number" && { amount: Math.round(amount * 100) / 100 }),
        ...(typeof b.categoryId === "string" && { categoryId: b.categoryId }),
      };
    }), CONFLICT);
  } catch (e) {
    console.error(e);
    return fail(500, "Не удалось сохранить.");
  }
}

/** Удаление ?scope=&month=. Связанные траты остаются и становятся обычными */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireUser(req);
  if (!ctx) return unauthorized();
  const { id } = await params;
  const q = new URL(req.url).searchParams;
  const month = q.get("month");
  if (!isMonth(month)) return fail(400, "Неверный месяц.");
  try {
    return updated(await getRepos().planItems.update(ctx, q.get("scope") === "personal" ? "personal" : "family", month, id, undefined, () => null), CONFLICT);
  } catch (e) {
    console.error(e);
    return fail(500, "Не удалось удалить.");
  }
}
