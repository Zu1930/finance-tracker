/**
 * План месяца: лимиты только на месяц, ожидаемый доход, плановые покупки. Чистые функции без Redis —
 * их вызывают route handlers, клиент и тесты (lib/plan.test.mjs). Только type-импорты и относительные .ts.
 */
import type { Category, Expense, MonthPlan, MyMonthPlan, PlanItem, PlanItemStatus, PlanView, Scope, TrackerData, User } from "./types.ts";
import { aliveIn, limitIn } from "./utils.ts";

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Лимит категории в месяце: поправка этого месяца ?? обычный (с историей изменений) */
export const monthLimit = (c: Category, key: string, overrides?: Record<string, number>) => overrides?.[c.id] ?? limitIn(c, key);

/** Сумма лимитов категорий, существовавших в месяце */
export const limitsSum = (cats: Category[] | undefined, key: string, overrides?: Record<string, number>) =>
  r2((cats ?? []).reduce((a, c) => (aliveIn(c, key) ? a + monthLimit(c, key, overrides) : a), 0));

/**
 * Поправки на месяц перед записью: только известные категории, неотрицательные числа; поправка, равная
 * обычному лимиту, удаляется — хранить её незачем
 */
export function normalizeOverrides(raw: unknown, cats: Category[], key: string): Record<string, number> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: Record<string, number> = {};
  for (const [id, v] of Object.entries(raw)) {
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return null;
    const c = cats.find((x) => x.id === id);
    if (c && r2(v) !== limitIn(c, key)) out[id] = r2(v);
  }
  return out;
}

// ---------- Пункты и связанные траты ----------
/** Связанные траты по пунктам: только траты, чей пункт есть среди items */
export function linkedByItem(expenses: Expense[], items: PlanItem[]): Record<string, number> {
  const ids = new Set(items.map((i) => i.id));
  const out: Record<string, number> = {};
  for (const e of expenses) if (e.planItemId && ids.has(e.planItemId)) out[e.planItemId] = r2((out[e.planItemId] ?? 0) + e.base);
  return out;
}

export const itemStatus = (item: PlanItem, linked: number): PlanItemStatus =>
  linked <= 0 ? "planned" : linked < item.amount ? "partial" : "done";

/** Остаток пункта: сколько ещё по плану */
export const itemLeft = (item: PlanItem, linked: number) => Math.max(0, r2(item.amount - linked));

/**
 * Расход категорий для шкал лимитов: траты по пунктам плана не входят, кроме превышения пункта —
 * разница сверх суммы пункта идёт в категорию, перерасход по плану должен быть виден.
 * Оплаты регулярных платежей не входят совсем — даже разница факта и оценки: она видна в строке регулярных
 */
export function planSpentByCat(expenses: Expense[], items: PlanItem[]): Record<string, number> {
  const byId = new Map(items.map((i) => [i.id, i]));
  const linked = linkedByItem(expenses, items);
  const out: Record<string, number> = {};
  const add = (cat: string, v: number) => (out[cat] = r2((out[cat] ?? 0) + v));
  for (const e of expenses) if (!e.recurringId && !(e.planItemId && byId.has(e.planItemId))) add(e.catId, e.base);
  for (const [id, sum] of Object.entries(linked)) {
    const it = byId.get(id)!;
    if (sum > it.amount) add(it.categoryId, sum - it.amount);
  }
  return out;
}

/** Плановые траты для прогноза: по каждому пункту max(сумма плана, связанные траты) */
export const plannedForecast = (items: PlanItem[], linked: Record<string, number>) =>
  r2(items.reduce((a, i) => a + Math.max(i.amount, linked[i.id] ?? 0), 0));

// ---------- Сводка плана ----------
export type PlanSummary = {
  income: number | null;
  /** Регулярные: семья, мои, партнёра (сумма с сервера) */
  recurring: { family: number; mine: number; partner: number; total: number };
  limits: { family: number; mine: number; partner: number; total: number };
  planned: { total: number; count: number; partner: number };
    /** income − регулярные − лимиты − покупки; null без дохода */
  rest: number | null;
  /** План больше дохода (при income = null — никогда) */
  short: boolean;
};

/** Доход плана: вписанный вручную ?? среднее за 3 завершённых месяца ?? null */
export const planIncome = (override: number | null | undefined, average: number | null | undefined) => override ?? average ?? null;

export function planSummary(p: {
  income: number | null;
  familyLimits: number;
  myLimits: number;
  partnerLimits: number;
    items: PlanItem[];
  partnerPlanned: number;
  recurring?: { family: number; mine: number; partner: number };
}): PlanSummary {
  const rec = p.recurring ?? { family: 0, mine: 0, partner: 0 };
  const recurringTotal = r2(rec.family + rec.mine + rec.partner);
  const limitsTotal = r2(p.familyLimits + p.myLimits + p.partnerLimits);
  const plannedTotal = r2(p.items.reduce((a, i) => a + i.amount, 0) + p.partnerPlanned);
    const rest = p.income === null ? null : r2(p.income - recurringTotal - limitsTotal - plannedTotal);
  return {
    income: p.income,
    recurring: { ...rec, total: recurringTotal },
    limits: { family: p.familyLimits, mine: p.myLimits, partner: p.partnerLimits, total: limitsTotal },
    planned: { total: plannedTotal, count: p.items.length, partner: p.partnerPlanned },
    rest,
    short: rest !== null && rest < 0,
  };
}

// ---------- Приём данных от клиента ----------
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
export const isMonth = (v: unknown): v is string => typeof v === "string" && MONTH.test(v);

/** Месяцы, доступные для плана: не дальше 12 месяцев вперёд от текущего */
export function monthsAhead(from: string, to: string): number {
  const [y1, m1] = from.split("-").map(Number), [y2, m2] = to.split("-").map(Number);
  return (y2 - y1) * 12 + (m2 - m1);
}
export const MAX_AHEAD = 12;

/** Новый пункт из тела POST /api/plan-items; категория — действующая категория своего scope */
export function preparePlanItem(body: unknown, userId: string, cats: { family: Category[]; mine: Category[] }, id: string): PlanItem | null {
  const b = (body ?? {}) as Record<string, unknown>;
  const name = typeof b.name === "string" ? b.name.trim().slice(0, 40) : "";
  const scope: Scope = b.scope === "personal" ? "personal" : "family";
  const amount = b.amount;
  if (!name || !isMonth(b.month) || typeof amount !== "number" || !Number.isFinite(amount) || !(amount > 0)) return null;
  if (!(scope === "personal" ? cats.mine : cats.family).some((c) => c.id === b.categoryId && !c.archived)) return null;
  return {
    id, month: b.month, name, amount: r2(amount), categoryId: b.categoryId as string, scope,
    ...(scope === "personal" && { ownerId: userId }), createdBy: userId, expenseIds: [], version: 1,
  };
}

/**
 * Можно ли связать трату с пунктом. item ищется в хеше scope траты, месяца её даты и пользователя из сессии,
 * поэтому чужой личный пункт и пункт другого месяца сюда приходят как null
 */
export function planLinkError(item: PlanItem | null, e: Pick<Expense, "catId" | "scope" | "date">): string | null {
  if (!item) return "Пункт плана не найден.";
  if (item.scope !== e.scope || item.month !== e.date.slice(0, 7)) return "Пункт плана из другого месяца или раздела.";
  if (item.categoryId !== e.catId) return "Пункт плана из другой категории.";
  return null;
}

/** Перенести в другой месяц можно только пункт без связанных трат */
export const planMoveError = (item: PlanItem) => (item.expenseIds.length ? "По пункту уже есть траты — перенести нельзя." : null);

// ---------- Сборка ответа ----------
/** Документы и хеши плана как в Redis, по месяцам */
export type RawPlans = {
  family: Record<string, MonthPlan>;
  byUser: Record<string, Record<string, MyMonthPlan>>;
  familyItems: Record<string, Record<string, PlanItem>>;
  userItems: Record<string, Record<string, Record<string, PlanItem>>>;
};
export const EMPTY_PLANS: RawPlans = { family: {}, byUser: {}, familyItems: {}, userItems: {} };

const byName = (a: PlanItem, b: PlanItem) => a.name.localeCompare(b.name, "ru");

/**
 * Планы для me: семейное и своё целиком, у партнёра — суммы пунктов и сумма личных лимитов по месяцам.
 * partnerExpenses — личные траты партнёра по месяцам (для связанных сумм), наружу не уходят
 */
export function buildPlans(
  raw: RawPlans,
  me: User,
  partner: User,
  partnerCats: Category[],
  partnerExpenses: Record<string, Expense[]>,
  limitMonths: string[],
): { plans: Record<string, PlanView>; partnerLimits: Record<string, number> } {
  const months = new Set([
    ...Object.keys(raw.family),
    ...Object.keys(raw.familyItems),
    ...Object.keys(raw.byUser[me.id] ?? {}),
    ...Object.keys(raw.userItems[me.id] ?? {}),
    ...Object.keys(raw.userItems[partner.id] ?? {}),
  ]);
  const plans: Record<string, PlanView> = {};
  for (const m of months) {
    const fam = raw.family[m], mine = raw.byUser[me.id]?.[m];
    const pItems = Object.values(raw.userItems[partner.id]?.[m] ?? {});
    plans[m] = {
      month: m,
      incomeOverride: fam?.incomeOverride ?? null,
      familyOverrides: fam?.limitOverrides ?? {},
      myOverrides: mine?.limitOverrides ?? {},
      items: {
        family: Object.values(raw.familyItems[m] ?? {}).sort(byName),
        mine: Object.values(raw.userItems[me.id]?.[m] ?? {}).sort(byName),
      },
      partner: {
        plannedTotal: r2(pItems.reduce((a, i) => a + i.amount, 0)),
        plannedForecast: plannedForecast(pItems, linkedByItem(partnerExpenses[m] ?? [], pItems)),
      },
      planVersion: fam?.version ?? 0,
      myPlanVersion: mine?.version ?? 0,
    };
  }
  const partnerLimits: Record<string, number> = {};
  for (const m of limitMonths) partnerLimits[m] = limitsSum(partnerCats, m, raw.byUser[partner.id]?.[m]?.limitOverrides);
  return { plans, partnerLimits };
}

/** Траты партнёра по пунктам его плана, по дням месяца: только суммы */
export function plannedDaily(expenses: Expense[], items: PlanItem[]): Record<string, number> {
  const ids = new Set(items.map((i) => i.id));
  const out: Record<string, number> = {};
  for (const e of expenses) {
    if (!(e.planItemId && ids.has(e.planItemId))) continue;
    const day = String(Number(e.date.slice(8, 10)));
    out[day] = r2((out[day] ?? 0) + e.base);
  }
  return out;
}

/** Пустой план месяца — когда ключей нет */
export const emptyPlan = (month: string): PlanView => ({
  month, incomeOverride: null, familyOverrides: {}, myOverrides: {}, items: { family: [], mine: [] },
  partner: { plannedTotal: 0, plannedForecast: 0 }, planVersion: 0, myPlanVersion: 0,
});

/** Ответ GET /api/plan?month: план месяца для me. Строится из того же buildView — приватность та же */
export function planResponse(view: TrackerData, month: string, averageIncome: number | null) {
  const p = view.plans[month] ?? emptyPlan(month);
  const limits = (cats: Category[], ov: Record<string, number>) =>
    cats.filter((c) => aliveIn(c, month)).map((c) => ({ categoryId: c.id, base: limitIn(c, month), override: ov[c.id] ?? null }));
  const withStatus = (items: PlanItem[], expenses: Expense[]) => {
    const linked = linkedByItem(expenses, items);
    return items.map((i) => ({ ...i, linkedTotal: linked[i.id] ?? 0, status: itemStatus(i, linked[i.id] ?? 0) }));
  };
  return {
    month,
    income: { override: p.incomeOverride, average: averageIncome },
    limits: { family: limits(view.settings?.familyCategories ?? [], p.familyOverrides), mine: limits(view.mySettings.personalCategories, p.myOverrides) },
    partner: { limitsTotal: view.partnerLimits[month] ?? 0, plannedTotal: p.partner.plannedTotal },
    items: { family: withStatus(p.items.family, view.familyExpenses[month] ?? []), mine: withStatus(p.items.mine, view.myExpenses[month] ?? []) },
    planVersion: p.planVersion,
    myPlanVersion: p.myPlanVersion,
  };
}
