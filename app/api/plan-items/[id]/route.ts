import { NextResponse } from "next/server";
import { requireUser, unauthorized } from "@/lib/session";
import { casHashes, getRedis } from "@/lib/redis";
import { fail, isVersion, registerKey, updateRecord } from "@/lib/records";
import { MAX_AHEAD, isMonth, monthsAhead, planMoveError } from "@/lib/plan";
import { K, planItemsKey } from "@/lib/store";
import type { PlanItem, Settings, UserSettings } from "@/lib/types";

const CONFLICT = "Покупку изменил другой пользователь, проверьте и повторите.";

/**
 * { scope, month, version, name?, amount?, categoryId?, toMonth? }. Семейные пункты правят оба, личные — только
 * владелец (ключ из сессии). toMonth — перенос: удаление из хеша месяца и запись в новый одним скриптом
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser(req);
  if (!user) return unauthorized();
  const { id } = await params;
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b || !isMonth(b.month) || !isVersion(b.version)) return fail(400, "Неверные данные.");
  const scope = b.scope === "personal" ? "personal" : "family";
  const key = planItemsKey(scope, user.id, b.month);
  const name = typeof b.name === "string" ? b.name.trim().slice(0, 40) : undefined;
  const amount = b.amount;
  if (name === "" || (amount !== undefined && !(typeof amount === "number" && Number.isFinite(amount) && amount > 0))) return fail(400, "Неверные данные.");
  try {
    if (b.toMonth !== undefined && b.toMonth !== b.month) {
      if (!isMonth(b.toMonth) || monthsAhead(new Date().toISOString().slice(0, 7), b.toMonth) > MAX_AHEAD + 1) return fail(400, "Неверный месяц.");
      const cur = await getRedis().hget<PlanItem>(key, id);
      if (!cur) return fail(404, "Не найдено.");
      if (cur.version !== b.version) return fail(409, CONFLICT);
      const err = planMoveError(cur);
      if (err) return fail(409, err);
      const to = planItemsKey(scope, user.id, b.toMonth);
      const moved: PlanItem = { ...cur, month: b.toMonth, movedFrom: cur.movedFrom ?? b.month, version: cur.version + 1 };
      await registerKey(to);
      const ok = await casHashes([{ key, id, expected: cur.version, op: "del" }, { key: to, id, expected: -1, op: "set", doc: moved }]);
      return ok ? NextResponse.json({ item: moved }) : fail(409, CONFLICT);
    }
    let catOk = true;
    if (b.categoryId !== undefined) {
      const cats = scope === "personal"
        ? (await getRedis().get<UserSettings>(K.userSettings(user.id)))?.personalCategories
        : (await getRedis().get<Settings>(K.settings))?.familyCategories;
      catOk = !!cats?.some((c) => c.id === b.categoryId && !c.archived);
    }
    if (!catOk) return fail(400, "Нет такой категории.");
    return await updateRecord<PlanItem>(key, id, b.version, (it) => {
      // Связанные траты записаны в старую категорию: сменить её — потерять связь
      if (b.categoryId !== undefined && b.categoryId !== it.categoryId && it.expenseIds.length) return { status: 409, error: "По пункту уже есть траты — категорию не сменить." };
      return {
        ...it,
        ...(name && { name }),
        ...(typeof amount === "number" && { amount: Math.round(amount * 100) / 100 }),
        ...(typeof b.categoryId === "string" && { categoryId: b.categoryId }),
      };
    }, CONFLICT);
  } catch (e) {
    console.error(e);
    return fail(500, "Не удалось сохранить.");
  }
}

/** Удаление ?scope=&month=. Связанные траты остаются и становятся обычными */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser(req);
  if (!user) return unauthorized();
  const { id } = await params;
  const q = new URL(req.url).searchParams;
  const month = q.get("month");
  if (!isMonth(month)) return fail(400, "Неверный месяц.");
  try {
    return await updateRecord<PlanItem>(planItemsKey(q.get("scope") === "personal" ? "personal" : "family", user.id, month), id, undefined, () => null, CONFLICT);
  } catch (e) {
    console.error(e);
    return fail(500, "Не удалось удалить.");
  }
}
