/**
 * Разбор фразы голосового ввода: «кофе 350 и такси 800» → траты. Только правила, без внешних сервисов.
 * Чистые функции: работают и на клиенте (страница ввода), и на сервере (/api/quick)
 */
import type { Category } from "../types.ts";

export type QuickScope = "family" | "personal";
/** слово заметки → categoryId → сколько раз встречалось */
export type Dictionary = Record<string, Record<string, number>>;

export type ParseContext = {
  today: string; // YYYY-MM-DD
  base: string;
  currencies: string[];
  familyCategories: Category[];
  personalCategories: Category[];
  dictionary: Dictionary;
  lastScope: QuickScope;
};

export type ParsedEntry = {
  raw: string;
  amount: number | null;
  currency: string;
  date: string;
  scope: QuickScope;
  categoryId: string | null;
  categoryConfidence: "high" | "low" | "none";
  candidates: string[];
  note: string;
  errors: ("NO_AMOUNT" | "UNKNOWN_CURRENCY")[];
};

type Tok = { raw: string; w: string; used?: boolean };

export const normWord = (s: string) => s.toLowerCase().replace(/ё/g, "е");

/** Неразрывные и узкие пробелы, знаки препинания (кроме разделителей внутри чисел) → токены */
function tokenize(text: string): Tok[] {
  const s = text
    .replace(/[    ]/g, " ")
    .replace(/[—–−!?…:"«»()]/g, " ")
    .replace(/\.(?!\d)|(?<!\d)\./g, " ")
    .replace(/,(?!\d)|(?<!\d),/g, " , ")
    .replace(/([€$₽;])/g, " $1 ");
  const toks: Tok[] = s.split(/\s+/).filter(Boolean).map((raw) => ({ raw, w: normWord(raw) }));
  // Разделитель тысяч пробелом: «1 200», «12 500 000»
  for (let i = 0; i < toks.length - 1; i++) {
    if (/^\d{1,3}(?: \d{3})*$/.test(toks[i].w) && /^\d{3}$/.test(toks[i + 1].w)) {
      const raw = `${toks[i].raw} ${toks[i + 1].raw}`;
      toks.splice(i, 2, { raw, w: normWord(raw) });
      i--;
    }
  }
  return toks;
}

const SEPARATORS = new Set(["и", ",", ";", "плюс", "еще"]);

// ---------- Числа ----------
const WORDS: Record<string, number> = {
  ноль: 0, один: 1, одна: 1, одно: 1, два: 2, две: 2, три: 3, четыре: 4, пять: 5, шесть: 6, семь: 7, восемь: 8, девять: 9,
  десять: 10, одиннадцать: 11, двенадцать: 12, тринадцать: 13, четырнадцать: 14, пятнадцать: 15, шестнадцать: 16,
  семнадцать: 17, восемнадцать: 18, девятнадцать: 19, двадцать: 20, тридцать: 30, сорок: 40, пятьдесят: 50,
  шестьдесят: 60, семьдесят: 70, восемьдесят: 80, девяносто: 90, сто: 100, двести: 200, триста: 300, четыреста: 400,
  пятьсот: 500, шестьсот: 600, семьсот: 700, восемьсот: 800, девятьсот: 900, полторы: 1.5, полтора: 1.5,
};
const THOUSAND = /^(тысяча|тысячи|тысяч|тыс)$/;

/** «1 200», «1.200», «12,50», «2к», «1,5к», «2тыс» → число; null — не число */
function digitValue(w: string): number | null {
  const m = /^(\d{1,3}(?:[ .]\d{3})+|\d+(?:,\d+|\.\d{1,2})?)(к|k|тыс)?$/.exec(w);
  if (!m) return null;
  const n = /^\d{1,3}(?:[ .]\d{3})+$/.test(m[1]) ? Number(m[1].replace(/[ .]/g, "")) : Number(m[1].replace(",", "."));
  return m[2] ? n * 1000 : n;
}

const trailingZeros = (n: number) => {
  if (!Number.isInteger(n) || n === 0) return 0;
  let z = 0;
  while (n % 10 === 0) { n /= 10; z++; }
  return z;
};

type Num = { value: number; start: number; end: number };

/**
 * Числа фразы. Подряд идущие части одного числительного складываются: «сто пятьдесят», «тысяча двести»,
 * и диктовка «100 50» → 150 — только если следующее меньше разряда накопленного (350 800 — два числа)
 */
function findNumbers(toks: Tok[]): Num[] {
  const out: Num[] = [];
  let cur: { total: number; part: number; start: number; end: number; frac: boolean } | null = null;
  const close = () => {
    if (cur) out.push({ value: Math.round((cur.total + cur.part) * 100) / 100, start: cur.start, end: cur.end });
    cur = null;
  };
  toks.forEach((t, i) => {
    if (t.used) return close();
    const adjacent = cur !== null && cur.end === i - 1;
    // «тыс», «к» — только сразу после числа; «тысяча» — и в начале числа
    if (THOUSAND.test(t.w) || (adjacent && t.w === "к")) {
      if (adjacent && cur!.part > 0) {
        cur!.total += cur!.part * 1000;
        cur!.part = 0;
        cur!.end = i;
        return;
      }
      if (t.w !== "тыс" && t.w !== "к" && !adjacent) {
        close();
        cur = { total: 1000, part: 0, start: i, end: i, frac: false };
        return;
      }
      return close();
    }
    const v = Object.hasOwn(WORDS, t.w) ? WORDS[t.w] : digitValue(t.w);
    if (v === null) return close();
    const frac = !Number.isInteger(v);
    const acc = cur ? cur.total + cur.part : 0;
    if (adjacent && !cur!.frac && !frac && acc > 0 && v < 10 ** trailingZeros(acc)) {
      cur!.part += v;
      cur!.end = i;
      return;
    }
    close();
    cur = { total: 0, part: v, start: i, end: i, frac };
  });
  close();
  return out;
}

// ---------- Валюта ----------
function currencyOf(w: string): string | null {
  if (w === "евро" || w === "€" || w === "eur") return "EUR";
  if (w.startsWith("доллар") || w === "$" || w === "usd") return "USD";
  if (w.startsWith("динар") || w === "дин" || w === "rsd") return "RSD";
  if (w.startsWith("рубл") || w === "₽" || w === "rub") return "RUB";
  return null;
}

// ---------- Дата ----------
const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const utc = (day: string) => new Date(`${day}T00:00:00Z`);
const addDays = (day: string, n: number) => iso(new Date(utc(day).getTime() + n * 864e5));
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

const WEEKDAYS: Record<string, number> = {
  воскресенье: 0, понедельник: 1, вторник: 2, среда: 3, среду: 3, четверг: 4, пятница: 5, пятницу: 5, суббота: 6, субботу: 6,
};
const MONTHS_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];

/** Ближайшее не в будущем: день месяца (month — 1..12 или null — текущий/прошлый месяц) */
function pastDay(today: string, day: number, month: number | null): string | null {
  let y = Number(today.slice(0, 4));
  let m = month ?? Number(today.slice(5, 7));
  if (day < 1 || day > 31 || m < 1 || m > 12) return null;
  for (let i = 0; i < 24; i++) {
    if (day <= daysIn(y, m)) {
      const d = `${y}-${pad(m)}-${pad(day)}`;
      if (d <= today) return d;
    }
    if (month === null) { m--; if (m < 1) { m = 12; y--; } } else y--;
  }
  return null;
}

/** Находит дату, помечает её токены. Без даты — сегодня */
function takeDate(toks: Tok[], today: string): string {
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.used) continue;
    const next = toks[i + 1]?.used ? undefined : toks[i + 1]?.w;
    let date: string | null = null;
    let span = 1;
    if (t.w === "сегодня") date = today;
    else if (t.w === "вчера") date = addDays(today, -1);
    else if (t.w === "позавчера") date = addDays(today, -2);
    else if (Object.hasOwn(WEEKDAYS, t.w)) {
      const dow = utc(today).getUTCDay();
      date = addDays(today, -((dow - WEEKDAYS[t.w] + 7) % 7));
    } else if (/^\d{1,2}-?го$/.test(t.w)) date = pastDay(today, parseInt(t.w), null);
    else if (/^\d{1,2}$/.test(t.w) && next === "числа") { date = pastDay(today, Number(t.w), null); span = 2; }
    else if (/^\d{1,2}$/.test(t.w) && next && MONTHS_GEN.includes(next)) { date = pastDay(today, Number(t.w), MONTHS_GEN.indexOf(next) + 1); span = 2; }
    else if (/^\d{1,2}\.\d{1,2}$/.test(t.w)) { const [d, m] = t.w.split(".").map(Number); date = pastDay(today, d, m); }
    if (!date) continue;
    for (let k = 0; k < span; k++) toks[i + k].used = true;
    // «в пятницу», «во вторник»
    if (Object.hasOwn(WEEKDAYS, t.w) && (toks[i - 1]?.w === "в" || toks[i - 1]?.w === "во")) toks[i - 1].used = true;
    return date;
  }
  return today;
}

// ---------- Scope ----------
const PERSONAL = new Set(["себе", "личное", "лично", "мне", "личная", "личный"]);
const FAMILY = new Set(["семья", "семье", "семейное", "семейная", "общее", "общая"]);

function takeScope(toks: Tok[]): QuickScope | null {
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.used) continue;
    if (PERSONAL.has(t.w) || FAMILY.has(t.w)) {
      t.used = true;
      return PERSONAL.has(t.w) ? "personal" : "family";
    }
    if (t.w === "в" && toks[i + 1]?.w === "дом" && !toks[i + 1].used) {
      t.used = toks[i + 1].used = true;
      return "family";
    }
  }
  return null;
}

// ---------- Категория ----------
/** Одно слово с точностью до окончания: общее начало от 4 символов; короткие — только целиком */
export function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  let p = 0;
  while (p < a.length && a[p] === b[p]) p++;
  return p >= 4 && p >= Math.min(a.length, b.length) - 2;
}
const nameWords = (name: string) => normWord(name).split(/[\s_]+/).filter(Boolean);

/** Типичные слова → начало названия категории (если такая есть). По ТЗ — 1 очко; см. HINT_POINTS */
const HINTS: [string[], string[]][] = [
  [["кофе", "ресторан", "обед"], ["кафе"]],
  [["такси", "автобус", "бензин"], ["транспорт"]],
  [["лидл", "макси", "идеа", "рода", "продукты"], ["продукты"]],
  [["аптека"], ["здоровье", "прочее"]],
];
/**
 * ТЗ даёт подсказке 1 очко, но тот же ТЗ требует «кофе 350» → КАФЕ с high (а high — от 3 очков).
 * Без истории подсказка — единственный сигнал, поэтому 3: словарь с частым другим значением её уравновешивает (→ low)
 */
const HINT_POINTS = 3;
const dictPoints = (count: number) => (count >= 5 ? 3 : count >= 2 ? 2 : 1);

type Scored = { id: string; score: number; nameWords: Set<number> };

function scoreCategories(cats: Category[], toks: Tok[], dict: Dictionary): Scored[] {
  const words = toks.map((t, i) => ({ w: t.w, i })).filter((x) => !toks[x.i].used && /^[a-zа-я]+$/.test(x.w));
  return cats.map((c) => {
    const nw = nameWords(c.name);
    const matched = new Set(words.filter((x) => nw.some((n) => sameWord(x.w, n))).map((x) => x.i));
    let score = matched.size ? 3 : 0;
    score += Math.max(0, ...words.map((x) => (Object.hasOwn(dict, x.w) && dict[x.w][c.id] ? dictPoints(dict[x.w][c.id]) : 0)));
    const hinted = HINTS.some(([hw, targets]) => {
      const target = targets.find((p) => cats.some((k) => normWord(k.name).startsWith(p)));
      return !!target && normWord(c.name).startsWith(target) && words.some((x) => hw.some((h) => sameWord(x.w, h)));
    });
    if (hinted) score += HINT_POINTS;
    return { id: c.id, score, nameWords: matched };
  });
}

/** Разбор одного куска фразы */
function parsePiece(toks: Tok[], ctx: ParseContext): ParsedEntry {
  const raw = toks.map((t) => t.raw).join(" ");
  const date = takeDate(toks, ctx.today);
  const explicitScope = takeScope(toks);

  // Сумма: помеченная валютой, иначе последняя; остальные числа остаются в заметке
  const nums = findNumbers(toks);
  const curAt = (i: number) => (toks[i] && !toks[i].used ? currencyOf(toks[i].w) : null);
  const withCur = nums.find((n) => curAt(n.end + 1) || curAt(n.start - 1));
  const num = withCur ?? nums.at(-1) ?? null;
  let currency = ctx.base;
  const curIdx = num ? (curAt(num.end + 1) ? num.end + 1 : curAt(num.start - 1) ? num.start - 1 : -1) : -1;
  const anyCur = curIdx >= 0 ? curIdx : toks.findIndex((t) => !t.used && currencyOf(t.w));
  if (anyCur >= 0) {
    currency = currencyOf(toks[anyCur].w)!;
    toks[anyCur].used = true;
  }
  if (num) for (let i = num.start; i <= num.end; i++) toks[i].used = true;

  // Категория и scope: явный scope ограничивает набор; иначе — набор, где нашлось совпадение, при обоих — lastScope
  const fam = scoreCategories(ctx.familyCategories, toks, ctx.dictionary);
  const per = scoreCategories(ctx.personalCategories, toks, ctx.dictionary);
  const best = (list: Scored[]) => Math.max(0, ...list.map((s) => s.score));
  const scope: QuickScope = explicitScope ?? (best(fam) > 0 && best(per) === 0 ? "family" : best(per) > 0 && best(fam) === 0 ? "personal" : ctx.lastScope);
  const ranked = (scope === "family" ? fam : per).filter((s) => s.score > 0).sort((a, b) => b.score - a.score);
  const [lead, second] = ranked;
  const categoryConfidence = !lead ? "none" : lead.score >= 3 && lead.score - (second?.score ?? 0) >= 2 ? "high" : "low";

  // Заметка: всё неиспользованное в исходном виде, кроме названия категории, знаков и связок по краям
  const note = toks
    .filter((t, i) => !t.used && !lead?.nameWords.has(i) && t.w !== "," && t.w !== ";")
    .map((t) => t.raw)
    .join(" ")
    .replace(/^((и|в|во|на|за|плюс|еще|ещё)\s+)+|(\s+(и|в|во|на|за))+$/gi, "");

  const errors: ParsedEntry["errors"] = [];
  if (!num || !(num.value > 0)) errors.push("NO_AMOUNT");
  if (!ctx.currencies.includes(currency)) errors.push("UNKNOWN_CURRENCY");
  return {
    raw,
    amount: num && num.value > 0 ? num.value : null,
    currency,
    date,
    scope,
    categoryId: lead?.id ?? null,
    categoryConfidence,
    candidates: categoryConfidence === "high" ? [] : ranked.slice(0, 3).map((s) => s.id),
    note,
    errors,
  };
}

/** Есть ли в куске сумма — пробный разбор на копии токенов */
const hasAmount = (toks: Tok[], today: string) => {
  const copy = toks.map((t) => ({ ...t }));
  takeDate(copy, today);
  takeScope(copy);
  return findNumbers(copy).some((n) => n.value > 0);
};

/**
 * Фраза → траты. Делится по «и», «,», «;», «плюс», «ещё», но кусок без суммы приклеивается к следующему
 * (последний — к предыдущему): «продукты и бытовая химия 2400» — одна трата
 */
export function parsePhrase(text: string, ctx: ParseContext): ParsedEntry[] {
  const toks = tokenize(text);
  if (!toks.length) return [];
  const pieces: Tok[][] = [[]];
  for (const t of toks) {
    if (SEPARATORS.has(t.w)) pieces.push([t]);
    else pieces.at(-1)!.push(t);
  }
  const groups: Tok[][] = [];
  let pending: Tok[] = [];
  for (const p of pieces) {
    const merged = [...pending, ...p];
    if (hasAmount(merged, ctx.today)) {
      groups.push(merged);
      pending = [];
    } else pending = merged;
  }
  if (pending.length) {
    if (groups.length) groups[groups.length - 1].push(...pending);
    else groups.push(pending);
  }
  return groups
    .map((g) => g.filter((t, i) => !(i === 0 && SEPARATORS.has(t.w))))
    .filter((g) => g.length)
    .map((g) => parsePiece(g, ctx));
}
