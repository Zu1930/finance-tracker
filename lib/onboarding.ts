/**
 * Знакомство с приложением — общее для сервера и клиента: пресеты опроса /welcome, пересчёт примерных сумм
 * в валюту бюджета, черновик и его проверка, карточка «Настройка» (выполнение — из данных), подсказки.
 * Тесты — lib/onboarding.test.mjs
 */
import type { OnboardingState, Scope, TrackerData } from "./types.ts";
import { parseAmount } from "./utils.ts";

export const CURRENCIES = ["RSD", "EUR", "USD", "RUB"] as const;
export type WelcomeCurrency = (typeof CURRENCIES)[number];

/** Пресет категории: примерный лимит в RSD, семейная ли по умолчанию (для пары), отмечена ли сразу */
export type CatPreset = { key: string; name: string; rsd: number; family: boolean; on: boolean };
export const CAT_PRESETS: CatPreset[] = [
  { key: "food", name: "Продукты", rsd: 40000, family: true, on: true },
  { key: "cafe", name: "Кафе", rsd: 15000, family: false, on: true },
  { key: "transport", name: "Транспорт", rsd: 6000, family: true, on: true },
  { key: "home", name: "Для дома", rsd: 8000, family: true, on: true },
  { key: "health", name: "Здоровье", rsd: 8000, family: true, on: false },
  { key: "fun", name: "Развлечения", rsd: 10000, family: false, on: false },
  { key: "clothes", name: "Одежда", rsd: 10000, family: false, on: false },
  { key: "kids", name: "Дети", rsd: 15000, family: true, on: false },
  { key: "pets", name: "Питомцы", rsd: 5000, family: true, on: false },
  { key: "gifts", name: "Подарки", rsd: 6000, family: true, on: false },
  { key: "travel", name: "Путешествия", rsd: 20000, family: true, on: false },
  { key: "other", name: "Прочее", rsd: 8000, family: true, on: true },
];

/** Обязательный платёж: сумма в RSD, день, примерная ли; cats — подходящие категории по порядку, иначе «Прочее» */
export type PayPreset = { key: string; name: string; rsd: number; day: number; approx?: true; cats: string[] };
export const PAY_PRESETS: PayPreset[] = [
  { key: "rent", name: "Аренда", rsd: 82000, day: 1, cats: ["home"] },
  { key: "utilities", name: "Коммуналка", rsd: 8000, day: 10, approx: true, cats: ["home"] },
  { key: "internet", name: "Интернет", rsd: 2990, day: 5, cats: ["home"] },
  { key: "phone", name: "Телефон", rsd: 1990, day: 28, cats: ["home"] },
  { key: "subs", name: "Подписки", rsd: 1500, day: 15, cats: ["fun"] },
  { key: "gym", name: "Спортзал", rsd: 4500, day: 1, cats: ["health"] },
  { key: "loan", name: "Кредит", rsd: 20000, day: 20, cats: [] },
];

/** Счета: currency null — в валюте бюджета; «Счёт в евро» не показывается, если бюджет в евро */
export const ACCOUNT_PRESETS: { key: string; name: string; currency: string | null }[] = [
  { key: "card", name: "Карта", currency: null },
  { key: "cash", name: "Наличные", currency: null },
  { key: "eur", name: "Счёт в евро", currency: "EUR" },
  { key: "deposit", name: "Вклад", currency: null },
];
export const accountPresets = (base: string) => ACCOUNT_PRESETS.filter((a) => !(a.key === "eur" && base === "EUR"));

/** Сколько RSD стоит 1 единица валюты — запасной вариант, если сервис курсов недоступен */
export const FALLBACK_RSD_PER: Record<string, number> = { RSD: 1, EUR: 117.2, USD: 100.5, RUB: 1.25 };

/** Примерная сумма в валюте бюджета: ≥ 1000 — до сотен, ≥ 100 — до десятков, меньше — до целых */
export function roundPreset(n: number): number {
  const step = n >= 1000 ? 100 : n >= 100 ? 10 : 1;
  return Math.round(n / step) * step;
}
/** Сумма пресета (RSD) в валюте base; rsdPer — сколько RSD стоит 1 единица валюты */
export const presetIn = (rsd: number, base: string, rsdPer: Record<string, number>) =>
  roundPreset(rsd / (rsdPer[base] ?? FALLBACK_RSD_PER[base] ?? 1));

/** Курсы к base («1 C = x base») для списка валют из таблицы «RSD за единицу» */
export function ratesFor(base: string, symbols: string[], rsdPer: Record<string, number>): Record<string, number | null> {
  const per = (c: string) => rsdPer[c] ?? FALLBACK_RSD_PER[c];
  const out: Record<string, number | null> = {};
  for (const c of symbols) if (c !== base) out[c] = per(c) && per(base) ? Number((per(c) / per(base)).toPrecision(6)) : null;
  return out;
}

/** Валюта по локали браузера, если она в списке, иначе USD */
export function localeCurrency(locale: string): WelcomeCurrency {
  let lang = "", r: string | undefined;
  try {
    const l = new Intl.Locale(locale.replace("_", "-"));
    lang = l.language;
    r = l.region;
  } catch {
    return "USD";
  }
  const EURO = ["AT", "BE", "CY", "DE", "EE", "ES", "FI", "FR", "GR", "HR", "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PT", "SI", "SK", "ME"];
  if (r) return r === "RS" ? "RSD" : r === "RU" ? "RUB" : EURO.includes(r) ? "EUR" : "USD";
  const l = lang?.toLowerCase();
  if (l === "sr") return "RSD";
  if (l === "ru") return "RUB";
  return ["de", "fr", "it", "es", "nl", "fi", "el", "pt", "sk", "sl", "et", "lv", "lt", "hr"].includes(l) ? "EUR" : "USD";
}

/** Что уходит в POST /api/onboarding/complete. Пропущенный шаг — поля нет */
export type WelcomeDraft = {
  currency?: string;
  who?: "solo" | "pair";
  /** Пресет (key) или своя категория (только name); scope важен для пары */
  cats?: { key?: string; name: string; scope: Scope }[];
  /** Сумма — в валюте бюджета */
  payments?: { key: string; amount: number; day: number }[];
  /** Остаток — в валюте счёта; без остатка строка не присылается */
  accounts?: { key: string; balance: number }[];
};

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const num = (v: unknown) => typeof v === "number" && Number.isFinite(v);
const int = (v: unknown, min: number, max: number) => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;
const name40 = (v: unknown) => (typeof v === "string" ? v.trim().slice(0, 40) : "");

/** Проверка черновика: null — неверный. Повторы и неизвестные пресеты — тоже отказ, а не молчаливый пропуск */
export function parseDraft(v: unknown): WelcomeDraft | null {
  if (!isObj(v)) return null;
  const out: WelcomeDraft = {};
  if (v.currency !== undefined) {
    if (!CURRENCIES.includes(v.currency as WelcomeCurrency)) return null;
    out.currency = v.currency as string;
  }
  if (v.who !== undefined) {
    if (v.who !== "solo" && v.who !== "pair") return null;
    out.who = v.who;
  }
  if (v.cats !== undefined) {
    if (!Array.isArray(v.cats) || v.cats.length > 40) return null;
    const seen = new Set<string>();
    out.cats = [];
    for (const c of v.cats) {
      if (!isObj(c) || (c.scope !== "family" && c.scope !== "personal")) return null;
      const key = c.key === undefined ? undefined : c.key;
      if (key !== undefined && !CAT_PRESETS.some((p) => p.key === key)) return null;
      const name = key ? CAT_PRESETS.find((p) => p.key === key)!.name : name40(c.name);
      const id = (key as string | undefined) ?? `name:${name.toLowerCase()}`;
      if (!name || seen.has(id)) return null;
      seen.add(id);
      out.cats.push({ ...(key ? { key: key as string } : {}), name, scope: c.scope });
    }
  }
  if (v.payments !== undefined) {
    if (!Array.isArray(v.payments)) return null;
    const seen = new Set<string>();
    out.payments = [];
    for (const p of v.payments) {
      if (!isObj(p) || !PAY_PRESETS.some((x) => x.key === p.key) || seen.has(p.key as string)) return null;
      if (!num(p.amount) || !((p.amount as number) > 0) || (p.amount as number) > 1e9 || !int(p.day, 1, 31)) return null;
      seen.add(p.key as string);
      out.payments.push({ key: p.key as string, amount: p.amount as number, day: p.day as number });
    }
  }
  if (v.accounts !== undefined) {
    if (!Array.isArray(v.accounts)) return null;
    const seen = new Set<string>();
    out.accounts = [];
    for (const a of v.accounts) {
      if (!isObj(a) || !ACCOUNT_PRESETS.some((x) => x.key === a.key) || seen.has(a.key as string)) return null;
      if (!num(a.balance) || (a.balance as number) < 0 || (a.balance as number) > 1e12) return null;
      seen.add(a.key as string);
      out.accounts.push({ key: a.key as string, balance: a.balance as number });
    }
  }
  return out;
}

/**
 * Вести ли на /welcome: опрос не пройден. Помощь доступна всегда, настройки — если бюджет уже есть
 * (приглашённый; без бюджета страницам настроек нечего показать). Архив — только чтение, не трогаем
 */
export const needsWelcome = (data: Pick<TrackerData, "onboarding" | "settings" | "readonly">, pathname: string) =>
  data.onboarding?.status === "pending" && !data.readonly && !pathname.startsWith("/help") && !(data.settings && pathname.startsWith("/settings"));

// ---------- Черновик /welcome в localStorage ----------
export type WelcomeStep = "intro" | "currency" | "who" | "family" | "cats" | "payments" | "accounts" | "done";
export const WELCOME_DRAFT_KEY = "ft:welcome-draft";
export type WelcomeLocal = {
  /** Чей черновик: на общем устройстве чужой не подхватится */
  userId: string;
  step: number;
  currency: string;
  who: "solo" | "pair";
  /** Отмеченные пресеты: key → scope */
  picked: Record<string, Scope>;
  /** Свои категории (лимит 0) */
  custom: { name: string; scope: Scope }[];
  /** Включённые платежи: key → поля суммы и дня, как введены */
  pays: Record<string, { amount: string; day: string }>;
  /** Остатки: key → поле; пустое — счёт не создаётся */
  accounts: Record<string, string>;
  /** Пропущенные шаги: в запрос не идут, сервер берёт значения по умолчанию */
  skipped: WelcomeStep[];
};
type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export function readDraft(store: Store, userId: string): WelcomeLocal | null {
  try {
    const d = JSON.parse(store.getItem(WELCOME_DRAFT_KEY) ?? "null") as WelcomeLocal | null;
    return d?.userId === userId ? d : null;
  } catch {
    return null;
  }
}
export function writeDraft(store: Store, d: WelcomeLocal | null) {
  try {
    if (d) store.setItem(WELCOME_DRAFT_KEY, JSON.stringify(d));
    else store.removeItem(WELCOME_DRAFT_KEY);
  } catch {}
}
/** Выбранные категории: для solo и приглашённого всё личное */
export function chosenCats(d: WelcomeLocal, invited: boolean): { key?: string; name: string; scope: Scope }[] {
  const pair = !invited && d.who === "pair";
  return [
    ...catPresetsFor(invited).filter((p) => d.picked[p.key]).map((p) => ({ key: p.key, name: p.name, scope: pair ? d.picked[p.key] : ("personal" as Scope) })),
    ...d.custom.map((c) => ({ name: c.name, scope: pair ? c.scope : ("personal" as Scope) })),
  ];
}
/** Тело POST /api/onboarding/complete: пропущенных шагов нет, платежи без суммы или дня и пустые счета отброшены */
export function toDraft(d: WelcomeLocal, invited: boolean, skipped = d.skipped): WelcomeDraft {
  const sk = (s: WelcomeStep) => skipped.includes(s);
  return {
    ...(!invited && { currency: d.currency, who: sk("who") ? "solo" : d.who }),
    ...(!sk("cats") && { cats: chosenCats(d, invited) }),
    ...(!sk("payments") && {
      payments: Object.entries(d.pays).flatMap(([key, p]) => {
        const amount = parseAmount(p.amount), day = Number(p.day);
        return amount && amount > 0 && Number.isInteger(day) && day >= 1 && day <= 31 ? [{ key, amount, day }] : [];
      }),
    }),
    ...(!sk("accounts") && {
      accounts: Object.entries(d.accounts).flatMap(([key, v]) => {
        const balance = v.trim() ? parseAmount(v) : null;
        return balance !== null && balance >= 0 ? [{ key, balance }] : [];
      }),
    }),
  };
}

/** Категории по умолчанию (шаг 3 пропущен): отмеченные пресеты; приглашённому — только личные */
export const defaultCats = (pair: boolean, invited: boolean): NonNullable<WelcomeDraft["cats"]> =>
  CAT_PRESETS.filter((p) => p.on && (!invited || !p.family)).map((p) => ({ key: p.key, name: p.name, scope: pair && p.family && !invited ? "family" : "personal" }));

/** Пресеты шага 3: приглашённому — только личные */
export const catPresetsFor = (invited: boolean) => (invited ? CAT_PRESETS.filter((p) => !p.family) : CAT_PRESETS);

/** Категория платежа из выбранных: первая подходящая, иначе «Прочее» (key other; создаётся, если её не выбрали) */
export const payCategory = (pay: PayPreset, chosen: string[]) => pay.cats.find((k) => chosen.includes(k)) ?? "other";

// ---------- Карточка «Настройка» ----------
export const CHECKLIST = [
  { id: "categories", title: "Категории и лимиты", action: "Поправить", href: "/limits#categories" },
  { id: "recurring", title: "Обязательные платежи", action: "Добавить", href: "/limits#recurring" },
  { id: "expense", title: "Первая трата", action: "Записать", href: "/?focus=amount" },
  { id: "savings", title: "Счета и первая сверка", action: "Настроить", href: "/savings" },
  { id: "pwa", title: "Приложение на телефоне", action: "Как", href: "/help/install" },
  { id: "voice", title: "Голос и Siri", action: "Включить", href: "/settings/input" },
] as const;
export type ChecklistId = (typeof CHECKLIST)[number]["id"];
export type ChecklistItem = { id: ChecklistId; done: boolean; hidden: boolean };

/** Выполнение пунктов — из данных бюджета, а не галочками */
export function checklist(data: TrackerData, ob: Pick<OnboardingState, "hidden" | "pwaSeen" | "tokens">): ChecklistItem[] {
  const cats = [...(data.solo ? [] : (data.settings?.familyCategories ?? [])), ...data.mySettings.personalCategories].filter((c) => !c.archived);
  const live = [...data.recurring.family, ...data.recurring.mine].filter((p) => !p.endMonth);
  const mine = (m: Record<string, { authorId: string }[]>) => Object.values(m).some((l) => l.some((e) => e.authorId === data.me.id));
  const done: Record<ChecklistId, boolean> = {
    categories: cats.length >= 3 && cats.reduce((a, c) => a + c.limit, 0) > 0,
    recurring: live.length >= 1,
    expense: mine(data.myExpenses) || mine(data.familyExpenses),
    savings: data.savings.accounts.family.length + data.savings.accounts.mine.length > 0 && data.savings.recons.length > 0,
    pwa: ob.pwaSeen,
    voice: !data.mySettings.hideQuickEntry || ob.tokens > 0,
  };
  return CHECKLIST.map(({ id }) => ({ id, done: done[id], hidden: ob.hidden.includes(id) }));
}
/** Сколько из 6 готово: «не нужно» засчитывается */
export const checklistDone = (items: ChecklistItem[]) => items.filter((i) => i.done || i.hidden).length;

/** Изменения PATCH /api/onboarding (проверяет lib/onboarding-server.ts parsePatch) */
export type OnboardingPatch = { dismiss?: boolean; hide?: ChecklistId; hint?: HintId; pwa?: true };
/** То же локально, до ответа сервера */
export const applyPatch = (o: OnboardingState, p: OnboardingPatch): OnboardingState => ({
  ...o,
  ...(p.dismiss !== undefined && { dismissed: p.dismiss }),
  ...(p.hide && !o.hidden.includes(p.hide) && { hidden: [...o.hidden, p.hide] }),
  ...(p.hint && !o.hintsSeen.includes(p.hint) && { hintsSeen: [...o.hintsSeen, p.hint] }),
  ...(p.pwa && { pwaSeen: true }),
});

// ---------- Подсказки по месту ----------
export const HINTS = {
  entry: { text: "Суммы можно складывать: 450+120. Начните с «+», чтобы записать доход.", href: "/help/entry" },
  limits: { text: "Оплаченные обязательные платежи входят в шкалу своей категории — заложите их в лимит.", href: "/help/limits" },
  plan: { text: "Это план: доход − лимиты − покупки. Добавьте крупную покупку, чтобы она не испортила лимиты.", href: "/help/plan" },
  recurring: { text: "В день оплаты платёж появится на вводе. Нажмите «Оплачено» — трата запишется сама.", href: "/help/recurring" },
  savings: { text: "Обновляйте остатки раз в одну-две недели. Разница с записанным — это забытые траты.", href: "/help/savings" },
  family: { text: "Семейные траты видят оба, личные — только вы. Переключатель рядом с суммой.", href: "/help/family" },
  voice: { text: "Скажите «кофе триста пятьдесят и такси восемьсот» — запись после подтверждения.", href: "/help/voice" },
} as const;
export type HintId = keyof typeof HINTS;
export const isHintId = (v: unknown): v is HintId => typeof v === "string" && Object.hasOwn(HINTS, v);
/** Первые 10 секунд после опроса подсказок нет */
export const HINT_QUIET_MS = 10_000;

/**
 * Какая подсказка видна: первая из запрошенных на экране, которой нет в hintsSeen. family — только в семье.
 * Не больше одной одновременно
 */
export function visibleHint(wanted: HintId[], ob: Pick<OnboardingState, "hintsSeen" | "completedAt">, solo: boolean, now: number): HintId | null {
  if (ob.completedAt && now - Date.parse(ob.completedAt) < HINT_QUIET_MS) return null;
  return wanted.find((id) => !ob.hintsSeen.includes(id) && !(id === "family" && solo)) ?? null;
}
