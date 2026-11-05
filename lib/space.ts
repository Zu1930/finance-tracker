/**
 * Бюджет экрана: семья, моё личное или всё вместе (только просмотр). Выбирается один раз для всего приложения,
 * а не у каждой записи. Чистые функции выборки по уже загруженным данным — их вызывают страницы и тесты (lib/space.test.mjs)
 */
import type { Account, Category, Expense, Goal, Income, PlanItem, RecurringPayment, Scope, TrackerData } from "./types.ts";
import { catsIn, ddmm } from "./utils.ts";
import { planSpentByCat } from "./plan.ts";

export type Space = Scope | "all";
export const SPACE_IDS: Space[] = ["family", "personal", "all"];

/** Символы и названия бюджетов — одни на всё приложение */
export const SPACE: Record<Space, { glyph: string; name: string }> = {
  family: { glyph: "◆", name: "СЕМЬЯ" },
  personal: { glyph: "◇", name: "ЛИЧНОЕ" },
  all: { glyph: "∑", name: "ВСЁ ВМЕСТЕ" },
};
export const glyph = (s: Space) => SPACE[s].glyph;
export const READ_ONLY_NOTE = "∑ Только просмотр. Чтобы записать, выберите ◆ или ◇";

/** localStorage: отдельно для каждого пользователя */
export const spaceKey = (userId: string) => `ft:space:${userId}`;
const isSpace = (v: unknown): v is Space => v === "family" || v === "personal" || v === "all";

type Store = Pick<Storage, "getItem" | "setItem">;
export function readSpace(userId: string, store?: Store): Space {
  try {
    const v = (store ?? localStorage).getItem(spaceKey(userId));
    return isSpace(v) ? v : "family";
  } catch {
    return "family";
  }
}
export function writeSpace(userId: string, s: Space, store?: Store): void {
  try {
    (store ?? localStorage).setItem(spaceKey(userId), s);
  } catch {}
}

/** Попадает ли семейная/личная вещь в бюджет экрана */
export const inSpace = (scope: Scope, space: Space) => space === "all" || scope === space;

// ---------- Данные для метрик и графика ----------
const ZERO_PARTNER = {
  partnerPersonalTotals: {}, partnerPersonalDaily: {}, partnerPlannedDaily: {}, partnerLimits: {}, partnerRecurring: {}, partnerRecurringDaily: {},
};

/**
 * Данные одного бюджета: метрики (lib/metrics.ts) и график считают по ним как раньше по всей семье.
 * family — семейные траты обоих и доходы; personal — только мои личные; all — всё, как было (с суммами партнёра)
 */
export function spaceData(d: TrackerData, space: Space): TrackerData {
  if (space === "all") return d;
  const fam = space === "family";
  const plans = Object.fromEntries(
    Object.entries(d.plans).map(([k, p]) => [k, {
      ...p,
      items: fam ? { family: p.items.family, mine: [] } : { family: [], mine: p.items.mine },
      partner: { plannedTotal: 0, plannedForecast: 0 },
    }]),
  );
  return {
    ...d,
    ...ZERO_PARTNER,
    familyExpenses: fam ? d.familyExpenses : {},
    myExpenses: fam ? {} : d.myExpenses,
    incomes: fam ? d.incomes : {},
    recurring: fam ? { family: d.recurring.family, mine: [] } : { family: [], mine: d.recurring.mine },
    plans,
  };
}

// ---------- Остаток в лимитах ----------
export type Left = { limit: number; left: number };

/** Лимиты месяца с поправками плана; траты по плану не входят, кроме превышения пункта */
function leftOf(all: Category[], list: Expense[], items: PlanItem[], key: string, ov?: Record<string, number>): Left {
  const spent = planSpentByCat(list, items);
  const cats = catsIn(all, key, spent, ov).filter((c) => !c.archived);
  const limit = cats.reduce((a, c) => a + c.limit, 0);
  return { limit, left: cats.reduce((a, c) => a + c.limit - (spent[c.id] ?? 0), 0) };
}

/** «Можно потратить» бюджета в месяце; all — сумма семьи и моего */
export function spaceLeft(d: TrackerData, space: Space, key: string): Left {
  const plan = d.plans[key];
  if (space === "family")
    return leftOf(d.settings?.familyCategories ?? [], d.familyExpenses[key] ?? [], plan?.items.family ?? [], key, plan?.familyOverrides);
  if (space === "personal")
    return leftOf(d.mySettings.personalCategories, d.myExpenses[key] ?? [], plan?.items.mine ?? [], key, plan?.myOverrides);
  const f = spaceLeft(d, "family", key), p = spaceLeft(d, "personal", key);
  return { limit: f.limit + p.limit, left: f.left + p.left };
}

// ---------- Лента ----------
export type FeedRow = { kind: "expense"; e: Expense } | { kind: "income"; e: Income };

/** Записи бюджета, новые сверху: family — семейные обоих и доходы; personal — мои личные; all — всё */
export function feedRows(d: Pick<TrackerData, "familyExpenses" | "myExpenses" | "incomes">, space: Space): FeedRow[] {
  const exp = (m: Record<string, Expense[]>) => Object.values(m).flat().map((e) => ({ kind: "expense" as const, e }));
  return [
    ...(space !== "personal" ? exp(d.familyExpenses) : []),
    ...(space !== "family" ? exp(d.myExpenses) : []),
    ...(space !== "personal" ? Object.values(d.incomes).flat().map((e) => ({ kind: "income" as const, e })) : []),
  ].sort((a, b) => b.e.date.localeCompare(a.e.date) || b.e.ts - a.e.ts);
}

const isoDay = (t: Date) => `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
/** СЕГОДНЯ, ВЧЕРА или 02.11 */
export function dayTitle(day: string, today: string): string {
  if (day === today) return "СЕГОДНЯ";
  const y = new Date(`${today}T12:00:00`);
  y.setDate(y.getDate() - 1);
  return day === isoDay(y) ? "ВЧЕРА" : ddmm(day);
}

export type FeedDay = { day: string; title: string; spent: number; rows: FeedRow[] };
/** Группы по дням; spent — сумма трат дня в базовой валюте (доходы не входят) */
export function groupByDay(rows: FeedRow[], today: string): FeedDay[] {
  const out: FeedDay[] = [];
  for (const r of rows) {
    let g = out.at(-1);
    if (g?.day !== r.e.date) out.push((g = { day: r.e.date, title: dayTitle(r.e.date, today), spent: 0, rows: [] }));
    g.rows.push(r);
    if (r.kind === "expense") g.spent = Math.round((g.spent + r.e.base) * 100) / 100;
  }
  return out;
}

// ---------- Сбережения, регулярные, план ----------
/** Группы бюджета: только выбранная; в all — обе */
export const spaceGroups = (space: Space): Scope[] => (space === "all" ? ["family", "personal"] : [space]);

export function spaceSavings(sv: TrackerData["savings"], space: Space): { accounts: Record<Scope, Account[]>; goals: Record<Scope, Goal[]> } {
  const pick = <T,>(fam: T[], mine: T[]) => ({ family: space === "personal" ? [] : fam, personal: space === "family" ? [] : mine });
  return { accounts: pick(sv.accounts.family, sv.accounts.mine), goals: pick(sv.goals.family, sv.goals.mine) };
}

export const spaceRecurring = (list: RecurringPayment[], space: Space) => list.filter((p) => inSpace(p.scope, space));
export const spaceItems = (list: PlanItem[], space: Space) => list.filter((i) => inSpace(i.scope, space));
