/**
 * Мобильная страница «Лимиты» и мастер плана: чистые расчёты поверх lib/plan.ts, без новых правил.
 * «Обязательные» (регулярные платежи) уже внутри лимитов своих категорий, поэтому «На жизнь» = лимиты − обязательные:
 * Придёт − Обязательные − На жизнь − Покупки = Отложится, ровно как rest в planSummary. Тесты — lib/plan-view.test.mjs
 */
import type { Category, PlanItem, Scope, TrackerData } from "./types.ts";
import { emptyPlan, itemStatus, limitsSum, linkedByItem, monthLimit, planIncome, planSpentByCat, planSummary } from "./plan.ts";
import { average, monthOccurrences } from "./metrics.ts";
import { occurrences, recurringTotal, scheduledIn } from "./recurring.ts";
import { spaceLeft, type Space } from "./space.ts";
import { parsePhrase, normWord, type Dictionary } from "./quick-entry/parse.ts";
import { aliveIn, limitIn, parseAmount, shiftMonth } from "./utils.ts";

const r2 = (n: number) => Math.round(n * 100) / 100;
const sum = (xs: number[]) => r2(xs.reduce((a, b) => a + b, 0));

// ---------- Текущий месяц ----------
/** Дней до конца месяца, включая сегодня */
export function daysLeft(today: string): number {
  const [y, m, d] = today.split("-").map(Number);
  return new Date(y, m, 0).getDate() - d + 1;
}

/** «На день можно»: остаток на оставшиеся дни; при перерасходе — over > 0 и perDay 0 */
export function perDay(left: number, today: string) {
  const days = daysLeft(today);
  return { days, perDay: left > 0 ? Math.floor(left / days) : 0, over: left < 0 ? r2(-left) : 0 };
}

/**
 * «Осталось на жизнь» бюджета: лимиты категорий минус обязательные платежи месяца; потрачено — без оплат обязательных.
 * left = лимиты − траты − ещё не оплаченные обязательные
 */
export function living(d: TrackerData, view: Space, month: string, today: string) {
  const { limit, left } = spaceLeft(d, view, month);
  const occ = monthOccurrences(d, month, today);
  const list = view === "family" ? occ.family : view === "personal" ? occ.mine : [...occ.family, ...occ.mine];
  const unpaid = sum(list.filter((o) => o.status !== "paid").map((o) => o.estimateBase ?? 0));
  return { limit: r2(limit - recurringTotal(list)), left: r2(left - unpaid) };
}

// ---------- Пример в столбик ----------
/** income и rest — null у личного бюджета: дохода у него нет, внизу «Всего за месяц» */
export type Equation = { income: number | null; required: number; living: number; purchases: number; rest: number | null };

/** Итог примера: отложится (rest) или, без дохода, сколько всего уйдёт */
export const equationTotal = (e: Equation) => e.rest ?? sum([e.required, e.living, e.purchases]);

/**
 * План месяца для бюджета view. Семья: доход, семейные обязательные, «на жизнь» — семейные лимиты без обязательных
 * плюс личные лимиты обоих (как общий план), покупки всех. Личное: свои лимиты и покупки, без дохода.
 * Всё вместе и solo — как общий план
 */
export function planEquation(d: TrackerData, view: Space, solo: boolean, month: string, today: string): Equation {
  const plan = d.plans[month] ?? emptyPlan(month);
  const personal = view === "personal";
  const occ = monthOccurrences(d, month, today);
  const rec = { family: recurringTotal(occ.family), mine: recurringTotal(occ.mine), partner: d.partnerRecurring?.[month] ?? 0 };
  const s = planSummary({
    income: personal ? null : planIncome(plan.incomeOverride, average(d, today)?.income ?? null),
    familyLimits: solo || personal ? 0 : limitsSum(d.settings?.familyCategories, month, plan.familyOverrides),
    myLimits: limitsSum(d.mySettings.personalCategories, month, plan.myOverrides),
    partnerLimits: solo || personal ? 0 : (d.partnerLimits[month] ?? 0),
    items: personal ? plan.items.mine : [...plan.items.family, ...plan.items.mine],
    partnerPlanned: personal ? 0 : plan.partner.plannedTotal,
  });
  const required = view === "family" && !solo ? rec.family : personal ? rec.mine : sum([rec.family, rec.mine, rec.partner]);
  return { income: s.income, required, living: r2(s.limits.total - required), purchases: s.planned.total, rest: s.rest };
}

/** Чей план: в семье — семейный документ, в личном и у solo — свой; «всё вместе» — только просмотр */
export const planScope = (view: Space, solo: boolean): Scope | null => (solo ? "personal" : view === "all" ? null : view);

/** План месяца уже создавался: документ бюджета записан хоть раз (мастер всегда его пишет) */
export function hasPlan(d: TrackerData, view: Space, solo: boolean, month: string): boolean {
  const p = d.plans[month];
  if (!p) return false;
  if (solo || view === "family") return p.planVersion > 0 || p.items.family.length > 0;
  if (view === "personal") return p.myPlanVersion > 0 || p.items.mine.length > 0;
  return p.planVersion > 0 || p.myPlanVersion > 0;
}

// ---------- Мастер ----------
export type WizardPayment = { id: string; name: string; amount: number; categoryId: string; skipped: boolean };
export type WizardInput = {
  month: string;
  scope: Scope;
  /** Шаг «Сколько придёт»: семья и solo */
  withIncome: boolean;
  incomeOverride: number | null;
  average: number | null;
  /** Категории scope, действующие в месяце */
  cats: Category[];
  /** Поправки лимитов месяца из документа scope */
  overrides: Record<string, number>;
  /** Семейные поправки — у solo доход живёт в семейном документе, лимиты в своём */
  familyOverrides: Record<string, number>;
  payments: WizardPayment[];
  items: PlanItem[];
  /** Покупки прошлого месяца без трат — подсказка «перенести» */
  carry: PlanItem[];
  /** Сколько ушло в прошлом месяце по категориям — без обязательных и покупок по плану */
  prevSpent: Record<string, number>;
  /** Не меняется в мастере, но входит в итог: в семье — личные лимиты и покупки обоих */
  others: { limits: number; purchases: number };
  planVersion: number;
  myPlanVersion: number;
};

export type Buy = { key: string; name: string; amount: number; categoryId: string; id?: string; from?: string };
export type Draft = {
  income: string;
  /** Отмечен ли платёж (снятая отметка — пропуск месяца) */
  on: Record<string, boolean>;
  buys: Buy[];
  /** «На жизнь» по категориям — только изменённые в шаге 4 */
  living: Record<string, number>;
};

export function wizardInput(d: TrackerData, scope: Scope, solo: boolean, month: string, today: string): WizardInput {
  const plan = d.plans[month] ?? emptyPlan(month);
  const fam = scope === "family";
  const st = d.settings;
  const cats = (fam ? (st?.familyCategories ?? []) : d.mySettings.personalCategories).filter((c) => aliveIn(c, month));
  const ids = new Set(cats.map((c) => c.id));
  // Пропущенные тоже показываются — без отметки; оценка — как у вхождений месяца
  const all = (fam ? d.recurring.family : d.recurring.mine).filter((p) => !p.paused && scheduledIn(p, month) && ids.has(p.categoryId));
  const skipped = new Set(all.filter((p) => p.skips.includes(month)).map((p) => p.id));
  const occ = occurrences(all.map((p) => ({ ...p, skips: p.skips.filter((m) => m !== month) })), month, [], today, st?.base ?? "", st?.rates ?? {});
  const prev = shiftMonth(month, -1);
  const prevPlan = d.plans[prev] ?? emptyPlan(prev);
  const prevItems = fam ? prevPlan.items.family : prevPlan.items.mine;
  const prevExp = ((fam ? d.familyExpenses : d.myExpenses)[prev] ?? []).filter((e) => !e.recurringId);
  const linked = linkedByItem(prevExp, prevItems);
  const withIncome = fam || solo;
  return {
    month, scope, withIncome,
    incomeOverride: withIncome ? plan.incomeOverride : null,
    average: withIncome ? (average(d, today)?.income ?? null) : null,
    cats,
    overrides: fam ? plan.familyOverrides : plan.myOverrides,
    familyOverrides: plan.familyOverrides,
    payments: occ.map((o) => ({ id: o.paymentId, name: o.name, amount: o.estimateBase ?? 0, categoryId: o.categoryId, skipped: skipped.has(o.paymentId) })),
    items: fam ? plan.items.family : plan.items.mine,
    carry: prevItems.filter((i) => itemStatus(i, linked[i.id] ?? 0) === "planned"),
    prevSpent: planSpentByCat(prevExp, prevItems),
    others: fam && !solo
      ? { limits: r2(limitsSum(d.mySettings.personalCategories, month, plan.myOverrides) + (d.partnerLimits[month] ?? 0)), purchases: sum([...plan.items.mine.map((i) => i.amount), plan.partner.plannedTotal]) }
      : { limits: 0, purchases: 0 },
    planVersion: plan.planVersion,
    myPlanVersion: plan.myPlanVersion,
  };
}

export function initDraft(w: WizardInput): Draft {
  const income = w.incomeOverride ?? (w.average === null ? null : Math.round(w.average));
  return {
    income: income === null ? "" : String(income),
    on: Object.fromEntries(w.payments.map((p) => [p.id, !p.skipped])),
    buys: w.items.map((i) => ({ key: i.id, name: i.name, amount: i.amount, categoryId: i.categoryId, id: i.id })),
    living: {},
  };
}

/** Что-то изменено — закрытие спрашивает «Выйти без сохранения?» */
export const isDirty = (w: WizardInput, d: Draft) => JSON.stringify(d) !== JSON.stringify(initDraft(w));

const recIn = (w: WizardInput, catId: string, on: (p: WizardPayment) => boolean) => sum(w.payments.filter((p) => p.categoryId === catId && on(p)).map((p) => p.amount));

/** «На жизнь» категории: изменённое в шаге 4 или лимит месяца без её обязательных */
export const livingOf = (w: WizardInput, d: Draft, c: Category) => d.living[c.id] ?? r2(monthLimit(c, w.month, w.overrides) - recIn(w, c.id, (p) => !p.skipped));

/** Лимит категории после мастера: «на жизнь» + отмеченные обязательные. Снятая отметка уменьшает лимит, а не добавляет на жизнь */
export const finalLimit = (w: WizardInput, d: Draft, c: Category) => r2(livingOf(w, d, c) + recIn(w, c.id, (p) => d.on[p.id]));

export function draftIncome(w: WizardInput, d: Draft): number | null {
  if (!w.withIncome) return null;
  const n = parseAmount(d.income);
  return n === null || Number.isNaN(n) || n < 0 ? null : n;
}

export function draftEquation(w: WizardInput, d: Draft): Equation {
  const income = draftIncome(w, d);
  const required = sum(w.payments.filter((p) => d.on[p.id]).map((p) => p.amount));
  const liv = r2(sum(w.cats.map((c) => livingOf(w, d, c))) + w.others.limits);
  const purchases = r2(sum(d.buys.map((b) => b.amount)) + w.others.purchases);
  return { income, required, living: liv, purchases, rest: w.withIncome ? r2((income ?? 0) - required - liv - purchases) : null };
}

/** Тело PUT /api/plan/:month/bulk. Лимиты — только поправки месяца, обычные лимиты категорий не меняются */
export function bulkBody(w: WizardInput, d: Draft) {
  const ids = new Set(w.cats.map((c) => c.id));
  const overrides: Record<string, number> = Object.fromEntries(Object.entries(w.overrides).filter(([id]) => !ids.has(id)));
  for (const c of w.cats) {
    const v = finalLimit(w, d, c);
    if (v !== limitIn(c, w.month)) overrides[c.id] = Math.max(0, v);
  }
  const n = draftIncome(w, d);
  // Доход не трогали и он равен среднему — остаётся «по среднему»
  const incomeOverride = w.incomeOverride === null && w.average !== null && n === Math.round(w.average) ? null : n;
  const kept = new Set(d.buys.map((b) => b.id).filter(Boolean));
  return {
    scope: w.scope,
    ...(w.withIncome && { family: { version: w.planVersion, incomeOverride, limitOverrides: w.scope === "family" ? overrides : w.familyOverrides } }),
    ...(w.scope === "personal" && { mine: { version: w.myPlanVersion, limitOverrides: overrides } }),
    skips: w.payments.filter((p) => d.on[p.id] === p.skipped).map((p) => ({ id: p.id, skip: !p.skipped })),
    add: d.buys.filter((b) => !b.id && !b.from).map((b) => ({ name: b.name, amount: b.amount, categoryId: b.categoryId })),
    remove: w.items.filter((i) => !kept.has(i.id)).map((i) => i.id),
    move: d.buys.filter((b) => b.id && b.from).map((b) => ({ id: b.id!, from: b.from! })),
  };
}

/** Шаг кнопок − / + на шаге «на жизнь» */
export const livingStep = (base: string) => (base === "EUR" || base === "USD" ? 10 : 1000);

/** Категория покупки по названию — словарём голосового ввода; неуверенно — «Прочее» (или последняя категория) */
export function buyCategory(name: string, cats: Category[], scope: Scope, dictionary: Dictionary, today: string): string {
  const [p] = parsePhrase(`${name} 1`, {
    today, base: "", currencies: [], dictionary, defaultScope: scope,
    familyCategories: scope === "family" ? cats : [], personalCategories: scope === "personal" ? cats : [],
  });
  if (p?.categoryConfidence === "high" && p.scope === scope && p.categoryId) return p.categoryId;
  return (cats.find((c) => normWord(c.name).startsWith("проч")) ?? cats.at(-1))?.id ?? "";
}

/** Быстрые варианты шага покупок: перенести покупки прошлого месяца и сезонная, если их ещё нет. Не больше двух */
export function buyChips(w: WizardInput, d: Draft, seasonal: string | null): ({ kind: "carry"; item: PlanItem } | { kind: "name"; name: string })[] {
  const has = (name: string) => d.buys.some((b) => normWord(b.name) === normWord(name));
  const carry = w.carry.filter((i) => !d.buys.some((b) => b.id === i.id) && !has(i.name)).map((item) => ({ kind: "carry" as const, item }));
  const season = seasonal && !has(seasonal) ? [{ kind: "name" as const, name: seasonal }] : [];
  return [...carry, ...season].slice(0, 2);
}
