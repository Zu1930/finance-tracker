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

/** Доход всегда личный: переключатель «Доход» — только в личном бюджете (и у solo) */
export const incomeAllowed = (scope: Scope, solo: boolean) => solo || scope === "personal";
/** Доход начат не в личном бюджете («+», голос, командная строка): куда переключить форму и нужна ли подсказка */
export const incomeSwitch = (scope: Scope, solo: boolean): { scope: Scope; note: boolean } =>
  incomeAllowed(scope, solo) ? { scope, note: false } : { scope: "personal", note: true };

/** Попадает ли семейная/личная вещь в бюджет экрана */
export const inSpace = (scope: Scope, space: Space) => space === "all" || scope === space;

// ---------- Данные для метрик и графика ----------
const ZERO_PARTNER = {
  partnerPersonalTotals: {}, partnerPersonalDaily: {}, partnerPlannedDaily: {}, partnerLimits: {}, partnerRecurring: {}, partnerRecurringDaily: {},
};

/**
 * Данные одного бюджета: метрики (lib/metrics.ts) и график считают по ним как раньше по всей семье.
 * family — семейные траты обоих и доходы всех; personal — мои личные траты и мои доходы; all — всё, как было (с суммами партнёра)
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
    // Доходы личные: в семье — сумма всех участников, в личном — только мои
    incomes: d.incomes,
    ...(!fam && { incomeTotals: {}, partnerIncomeDaily: {} }),
    recurring: fam ? { family: d.recurring.family, mine: [] } : { family: [], mine: d.recurring.mine },
    plans,
  };
}

// ---------- Остаток в лимитах ----------
export type Left = { limit: number; left: number };

export type CatSpent = { cat: Category; spent: number };

/** Действующие категории бюджета в месяце (лимиты с поправками плана) и траты по ним; по плану — только превышение пункта */
export function spaceCats(d: TrackerData, scope: Scope, key: string): CatSpent[] {
  const plan = d.plans[key];
  const fam = scope === "family";
  const spent = planSpentByCat((fam ? d.familyExpenses : d.myExpenses)[key] ?? [], (fam ? plan?.items.family : plan?.items.mine) ?? []);
  const all = fam ? (d.settings?.familyCategories ?? []) : d.mySettings.personalCategories;
  return catsIn(all, key, spent, fam ? plan?.familyOverrides : plan?.myOverrides).filter((c) => !c.archived).map((cat) => ({ cat, spent: spent[cat.id] ?? 0 }));
}

/** «Можно потратить» бюджета в месяце; all — сумма семьи и моего */
export function spaceLeft(d: TrackerData, space: Space, key: string): Left {
  if (space === "all") {
    const f = spaceLeft(d, "family", key), p = spaceLeft(d, "personal", key);
    return { limit: f.limit + p.limit, left: f.left + p.left };
  }
  const rows = spaceCats(d, space, key);
  return { limit: rows.reduce((a, r) => a + r.cat.limit, 0), left: rows.reduce((a, r) => a + r.cat.limit - r.spent, 0) };
}

// ---------- Лента ----------
export type FeedRow = { kind: "expense"; e: Expense } | { kind: "income"; e: Income };

/**
 * Записи бюджета, новые сверху: family — семейные траты обоих; personal — мои личные и мои доходы; all — все траты.
 * Доходы в ◆ и ∑ — только суммой по людям (строка над лентой); у solo (бюджет — «всё») доходы — записями
 */
export function feedRows(d: Pick<TrackerData, "familyExpenses" | "myExpenses" | "incomes" | "solo">, space: Space): FeedRow[] {
  const exp = (m: Record<string, Expense[]>) => Object.values(m).flat().map((e) => ({ kind: "expense" as const, e }));
  return [
    ...(space !== "personal" ? exp(d.familyExpenses) : []),
    ...(space !== "family" ? exp(d.myExpenses) : []),
    ...(space === "personal" || d.solo ? Object.values(d.incomes).flat().map((e) => ({ kind: "income" as const, e })) : []),
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
