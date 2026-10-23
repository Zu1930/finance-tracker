/**
 * POST /api/quick для Siri / Быстрых команд: токены и обработчик без Redis — хранилище передаётся снаружи,
 * поэтому обработчик проверяется тестами (api.test.mjs) на хранилище в памяти
 */
import type { Category, Expense, Settings } from "../types.ts";
import { activeCats, fmt, liveCats, minus, safeEqual, uid } from "../utils.ts";
import { parsePhrase, type ParsedEntry } from "./parse.ts";
import { buildDictionary } from "./dictionary.ts";
import { entryProblem, toExpense, tratyWord } from "./entry.ts";

/** ft:u:<userId>:tokens, поле = id токена. Сам токен не хранится — только SHA-256 */
export type TokenRecord = { name: string; hash: string; createdAt: string; lastUsedAt: string | null };
export const RATE_LIMIT_PER_MIN = 30;

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
/** sl_<userId>_<32 случайных байта base64url> */
export const newToken = (userId: string) => `sl_${userId}_${b64url(crypto.getRandomValues(new Uint8Array(32)))}`;
/** Хвост — ровно 43 символа base64url, поэтому «_» в userId и в хвосте не путаются */
export const tokenUser = (token: string) => /^sl_([a-z0-9_]+)_[A-Za-z0-9_-]{43}$/i.exec(token)?.[1] ?? null;
export async function hashToken(token: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

export type QuickStore = {
  tokens: (userId: string) => Promise<Record<string, TokenRecord>>;
  touch: (userId: string, id: string, rec: TokenRecord) => Promise<void>;
  /** Запрос токеном id в текущую минуту → сколько их уже было, включая этот */
  hit: (id: string) => Promise<number>;
  /** Видимое пользователю: настройки, его личные категории, семейные траты обоих и его личные */
  context: (userId: string) => Promise<{ settings: Settings | null; personalCategories: Category[]; expenses: Expense[] }>;
  write: (userId: string, e: Expense) => Promise<void>;
};

type Reply = { status: number; body: Record<string, unknown> };
const deny = (status: number, error: string): Reply => ({ status, body: { error } });

/** Человекочитаемая причина отказа для Быстрой команды */
function problemOf(p: ParsedEntry, st: Settings): string | null {
  if (p.errors.includes("NO_AMOUNT")) return `Не понял сумму в «${p.raw}»`;
  const problem = entryProblem(p, st);
  if (problem) return problem;
  return p.categoryConfidence === "none" ? `Не понял категорию в «${p.raw}»` : null;
}

export async function handleQuick(auth: string | null, body: unknown, store: QuickStore, today: string, now = new Date()): Promise<Reply> {
  const token = /^Bearer\s+(\S+)$/.exec(auth ?? "")?.[1] ?? "";
  const userId = tokenUser(token);
  if (!userId) return deny(401, "unauthorized");
  const hash = await hashToken(token);
  const found = Object.entries(await store.tokens(userId)).find(([, r]) => safeEqual(r.hash, hash));
  if (!found) return deny(401, "unauthorized");
  const [tokenId, rec] = found;
  if ((await store.hit(tokenId)) > RATE_LIMIT_PER_MIN) return deny(429, "Слишком много запросов, подождите минуту.");
  await store.touch(userId, tokenId, { ...rec, lastUsedAt: now.toISOString() });

  const b = body as { text?: unknown; commit?: unknown } | null;
  if (typeof b?.text !== "string" || typeof b.commit !== "boolean") return deny(400, "Нужно { text: string, commit: boolean }.");
  const { settings: st, personalCategories, expenses } = await store.context(userId);
  if (!st) return { status: 200, body: { ok: false, summary: "Трекер ещё не настроен." } };

  const family = activeCats(st);
  const personal = liveCats(personalCategories);
  const entries = parsePhrase(b.text.slice(0, 500), {
    today, base: st.base, currencies: st.currencies, familyCategories: family, personalCategories: personal,
    dictionary: buildDictionary(expenses, today),
    lastScope: "family",
  });
  if (!entries.length) return { status: 200, body: { ok: false, summary: "Не расслышал трату.", entries } };
  const problems = entries.map((p) => problemOf(p, st)).filter(Boolean);
  if (problems.length) return { status: 200, body: { ok: false, summary: `${problems.join(". ")}.`, entries } };

  const cats = [...family, ...personal];
  if (!b.commit) {
    const list = entries.map((p) => `−${fmt(p.amount!)} ${p.currency} ${cats.find((c) => c.id === p.categoryId)!.name.toUpperCase()} (${p.scope === "personal" ? "личное" : "семья"})`);
    return { status: 200, body: { ok: true, summary: `${list.join(", ")}. Записать?`, entries } };
  }
  // Разобрано заново и без ошибок — пишем от имени владельца токена
  const written = entries.map((p, i) => toExpense(p, st, userId, uid(), now.getTime() + i)!);
  for (const e of written) await store.write(userId, e);
  const sum = written.reduce((s, e) => s + e.base, 0);
  return { status: 200, body: { ok: true, summary: `Записано: ${written.length} ${tratyWord(written.length)}, ${minus(sum)} ${st.base}`, entries } };
}
