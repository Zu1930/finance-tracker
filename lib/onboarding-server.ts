/**
 * Знакомство с приложением на сервере: состояние пользователя, опрос целиком одной транзакцией, «Настрою сам»,
 * отметки карточки и подсказок, события шагов для анализа беты. Чистые правила — lib/onboarding.ts
 */
import { and, count, eq, sql } from "drizzle-orm";
import * as s from "./data/postgres/schema.ts";
import { postgresRepos, type Db } from "./data/postgres/repos.ts";
import type { Ctx } from "./data/types.ts";
import type { Category, OnboardingState, Scope } from "./types.ts";
import { createInvite } from "./family.ts";
import { prepareRecurring } from "./recurring.ts";
import { applyReconcile, flowsOf, prepareAccount } from "./savings.ts";
import { curMonthKey, defaultSettings, shiftMonth, todayStr, uid } from "./utils.ts";
import {
  CAT_PRESETS, PAY_PRESETS, accountPresets, defaultCats, isHintId, payCategory, presetIn, ratesFor,
  type ChecklistId, type HintId, type OnboardingPatch, type WelcomeDraft, CHECKLIST,
} from "./onboarding.ts";

type Fail = { ok: false; status: number; error: string };
/** Отказ изнутри транзакции: всё созданное откатывается */
class Abort extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Новый пользователь: опрос впереди. Вызывается при создании пользователя Better Auth */
export const startOnboarding = (db: Db, userId: string) =>
  db.insert(s.userOnboarding).values({ userId, status: "pending" }).onConflictDoNothing();

/** Строки нет (пользователь из скриптов) — считается пройденным, как у всех, кто был до знакомства */
const ensureRow = (db: Db, userId: string) =>
  db.insert(s.userOnboarding).values({ userId, status: "done", checklistDismissedAt: new Date() }).onConflictDoNothing();

/** Пришёл по приглашению: в семье не владельцем */
async function isInvited(db: Db, ctx: Ctx) {
  const [m] = await db.select({ role: s.memberships.role, kind: s.households.kind }).from(s.memberships)
    .innerJoin(s.households, eq(s.households.id, s.memberships.householdId))
    .where(and(eq(s.memberships.householdId, ctx.householdId), eq(s.memberships.userId, ctx.userId), eq(s.memberships.status, "active")));
  return m?.kind === "family" && m.role === "member";
}

export async function onboardingState(db: Db, ctx: Ctx): Promise<OnboardingState> {
  const [[row], [tokens], invited] = await Promise.all([
    db.select().from(s.userOnboarding).where(eq(s.userOnboarding.userId, ctx.userId)),
    db.select({ n: count() }).from(s.apiTokens).where(eq(s.apiTokens.userId, ctx.userId)),
    isInvited(db, ctx),
  ]);
  return {
    status: row?.status ?? "done",
    completedAt: row?.completedAt?.toISOString() ?? null,
    dismissed: row ? !!row.checklistDismissedAt : true,
    hidden: row?.checklistHiddenItems ?? [],
    hintsSeen: row?.hintsSeen ?? [],
    pwaSeen: !!row?.pwaSeenAt,
    tokens: tokens.n,
    invited,
  };
}

/** Опрос только у pending; строка блокируется до конца транзакции — два параллельных complete не пройдут оба */
async function lockPending(tx: Db, userId: string) {
  const [row] = await tx.select({ status: s.userOnboarding.status }).from(s.userOnboarding).where(eq(s.userOnboarding.userId, userId)).for("update");
  if (row?.status !== "pending") throw new Abort(409, "Настройка уже пройдена.");
}

/**
 * Опрос целиком: категории, обязательные платежи, счета и первая сверка, для пары — семья и приглашение.
 * rsdPer — сколько RSD стоит 1 единица валюты (текущие курсы, иначе запасные): пресеты в RSD пересчитываются
 * в валюту бюджета. Ошибка на любом шаге откатывает всё
 */
export async function completeOnboarding(db: Db, ctx: Ctx, draft: WelcomeDraft, rsdPer: Record<string, number>, today = todayStr()):
  Promise<{ ok: true; inviteCode: string | null; inviteUntil: string | null } | Fail> {
  try {
    return await db.transaction(async (tx) => {
      const t = tx as unknown as Db;
      await lockPending(t, ctx.userId);
      const r = postgresRepos(t);
      const invited = await isInvited(t, ctx);
      const pair = !invited && draft.who === "pair";
      const current = await r.settings.get(ctx);
      if (!invited && current) throw new Abort(409, "Бюджет уже настроен.");
      const base = invited ? current!.base : (draft.currency ?? "");
      if (!base) throw new Abort(400, "Выберите валюту.");

      // Категории: пресеты с лимитом в валюте бюджета, свои — с нулевым; пропущенный шаг — по умолчанию
      const chosen = draft.cats ?? defaultCats(pair, invited);
      const scopeOf = (sc: Scope): Scope => (pair ? sc : "personal");
      const cats = chosen.map((c) => {
        const p = c.key ? CAT_PRESETS.find((x) => x.key === c.key) : undefined;
        if (invited && p?.family) throw new Abort(400, "Семейные категории настраивает владелец бюджета.");
        return { key: c.key, scope: scopeOf(c.scope), cat: { id: uid(), name: c.name, limit: p ? presetIn(p.rsd, base, rsdPer) : 0 } as Category };
      });
      const payments = draft.payments ?? [];
      const keys = cats.flatMap((c) => (c.key ? [c.key] : []));
      if (payments.some((p) => payCategory(PAY_PRESETS.find((x) => x.key === p.key)!, keys) === "other") && !keys.includes("other")) {
        // Платежу некуда — «Прочее»; её лимит — сумма платежей (ниже)
        cats.push({ key: "other", scope: scopeOf("family"), cat: { id: uid(), name: "Прочее", limit: 0 } });
      }
      // Оплаченные регулярные входят в траты категории: их сумма закладывается в её лимит
      for (const p of payments) {
        const c = cats.find((x) => x.key === payCategory(PAY_PRESETS.find((y) => y.key === p.key)!, keys))!;
        c.cat.limit = Math.round((c.cat.limit + p.amount) * 100) / 100;
      }
      const family = cats.filter((c) => c.scope === "family").map((c) => c.cat);
      const personal = cats.filter((c) => c.scope === "personal").map((c) => c.cat);

      // Валюты: как у прежней настройки, плюс евро, если есть счёт в евро; курсы — текущие
      const needEur = (draft.accounts ?? []).some((a) => a.key === "eur") && base !== "EUR";
      if (invited) {
        if (needEur && !current!.currencies.includes("EUR")) {
          await r.settings.merge(ctx, (cur) => cur && { ...cur, currencies: [...cur.currencies, "EUR"], rates: { ...cur.rates, EUR: ratesFor(base, ["EUR"], rsdPer).EUR } });
        }
      } else {
        const d = defaultSettings(base);
        const currencies = [...new Set([...d.currencies, ...(needEur ? ["EUR"] : [])])];
        const res = await r.settings.put(ctx, 0, { ...d, currencies, rates: ratesFor(base, currencies, rsdPer), ratesUpdatedAt: today, familyCategories: family, schemaVersion: 3 });
        if (!res.ok) throw new Abort(409, "Бюджет уже настроен.");
        if (pair) await t.update(s.households).set({ kind: "family", name: "Семейный бюджет" }).where(eq(s.households.id, ctx.householdId));
      }
      const mine = (await r.userSettings.get(ctx)) ?? { personalCategories: [], version: 0 };
      if (personal.length) {
        const { version, ...rest } = mine;
        if (!(await r.userSettings.put(ctx, version, { ...rest, personalCategories: [...rest.personalCategories, ...personal] })).ok) throw new Abort(409, "Настройки изменились, повторите.");
      }

      // Обязательные: категория — подходящая из выбранных, scope — её; день уже прошёл — с следующего месяца
      const list = await r.categories.list(ctx);
      const settings = (await r.settings.get(ctx))!;
      const idOf = (key: string) => cats.find((c) => c.key === key)!;
      const month = curMonthKey();
      for (const p of payments) {
        const preset = PAY_PRESETS.find((x) => x.key === p.key)!;
        const c = idOf(payCategory(preset, keys));
        const startMonth = p.day >= Number(today.slice(8, 10)) ? month : shiftMonth(month, 1);
        const rec = prepareRecurring({ name: preset.name, amount: p.amount, currency: base, approx: !!preset.approx, frequency: "monthly", day: p.day, categoryId: c.cat.id, scope: c.scope, startMonth },
          ctx.userId, list, settings.currencies, uid());
        if (!rec || !(await r.recurring.create(ctx, rec))) throw new Abort(400, `Не удалось добавить платёж «${preset.name}».`);
      }

      // Счета — личные; пустые строки не приходят. Первая сверка — точка отсчёта, если сверок в бюджете ещё нет
      const now = new Date().toISOString();
      const created = [];
      for (const a of draft.accounts ?? []) {
        const preset = accountPresets(base).find((x) => x.key === a.key);
        if (!preset) throw new Abort(400, "Неверный счёт.");
        const acc = prepareAccount({ name: preset.name, currency: preset.currency ?? base, scope: "personal", balance: a.balance }, ctx.userId, settings.currencies, uid(), now);
        if (!acc || !(await r.accounts.create(ctx, acc))) throw new Abort(400, `Не удалось создать счёт «${preset.name}».`);
        created.push(acc);
      }
      if (created.length) {
        const raw = await r.store.snapshot(ctx);
        if (raw.savings && raw.savings.recons.length === 0) {
          const seen = [...Object.values(raw.savings.accounts), ...Object.values(raw.savings.userAccounts).flatMap((h) => Object.values(h))];
          const res = applyReconcile(raw.savings, ctx.userId, { balances: Object.fromEntries(created.map((a) => [a.id, a.balance])), versions: Object.fromEntries(seen.map((a) => [a.id, a.version])), day: today },
            raw.settings!.base, raw.settings!.rates, flowsOf(raw.hashes), { id: uid(), at: now });
          if ("error" in res) throw new Abort(res.status, res.error);
          if (!(await r.recons.add(ctx, res.recon, seen, res.changed, 0))) throw new Abort(409, "Не удалось сохранить сверку, повторите.");
        }
      }

      const invite = pair ? await createInvite(t, ctx) : null;
      if (invite && !invite.ok) throw new Abort(invite.status, invite.error);
      await t.update(s.userOnboarding).set({ status: "done", completedAt: new Date(), version: sql`${s.userOnboarding.version} + 1` }).where(eq(s.userOnboarding.userId, ctx.userId));
      return { ok: true as const, inviteCode: invite?.ok ? invite.code : null, inviteUntil: invite?.ok ? invite.invite.expiresAt : null };
    });
  } catch (e) {
    if (e instanceof Abort) return { ok: false, status: e.status, error: e.message };
    throw e;
  }
}

/** «Настрою сам»: solo с прежними значениями по умолчанию (как первая настройка), если бюджет ещё не настроен */
export async function skipOnboarding(db: Db, ctx: Ctx, currency: string): Promise<{ ok: true } | Fail> {
  try {
    return await db.transaction(async (tx) => {
      const t = tx as unknown as Db;
      await lockPending(t, ctx.userId);
      const r = postgresRepos(t);
      if (!(await r.settings.get(ctx))) {
        const d = defaultSettings(currency);
        if (!(await r.settings.put(ctx, 0, { ...d, familyCategories: [], schemaVersion: 3 })).ok) throw new Abort(409, "Бюджет уже настроен.");
        const { version, ...mine } = (await r.userSettings.get(ctx)) ?? { personalCategories: [], version: 0 };
        await r.userSettings.put(ctx, version, { ...mine, personalCategories: [...mine.personalCategories, ...d.familyCategories] });
      }
      await t.update(s.userOnboarding).set({ status: "skipped", completedAt: new Date(), version: sql`${s.userOnboarding.version} + 1` }).where(eq(s.userOnboarding.userId, ctx.userId));
      return { ok: true as const };
    });
  } catch (e) {
    if (e instanceof Abort) return { ok: false, status: e.status, error: e.message };
    throw e;
  }
}


/** Проверка тела PATCH: null — неверное */
export function parsePatch(v: unknown): OnboardingPatch | null {
  if (!v || typeof v !== "object") return null;
  const b = v as Record<string, unknown>;
  const out: OnboardingPatch = {};
  if (b.dismiss !== undefined) { if (typeof b.dismiss !== "boolean") return null; out.dismiss = b.dismiss; }
  if (b.hide !== undefined) { if (!CHECKLIST.some((c) => c.id === b.hide)) return null; out.hide = b.hide as ChecklistId; }
  if (b.hint !== undefined) { if (!isHintId(b.hint)) return null; out.hint = b.hint as HintId; }
  if (b.pwa !== undefined) { if (b.pwa !== true) return null; out.pwa = true; }
  return Object.keys(out).length ? out : null;
}

/** Добавить в массив без повторов — атомарно в SQL, без чтения */
const addTo = (col: typeof s.userOnboarding.hintsSeen | typeof s.userOnboarding.checklistHiddenItems, v: string) =>
  sql`case when ${v} = any(${col}) then ${col} else array_append(${col}, ${v}::text) end`;

/** Скрыть или вернуть карточку, «не нужно» для пункта, подсказка увидена, приложение открыто с экрана «Домой» */
export async function patchOnboarding(db: Db, userId: string, p: OnboardingPatch): Promise<void> {
  await ensureRow(db, userId);
  await db.update(s.userOnboarding).set({
    ...(p.dismiss !== undefined && { checklistDismissedAt: p.dismiss ? new Date() : null }),
    ...(p.hide && { checklistHiddenItems: addTo(s.userOnboarding.checklistHiddenItems, p.hide) }),
    ...(p.hint && { hintsSeen: addTo(s.userOnboarding.hintsSeen, p.hint) }),
    // Первый запуск: дата не перезаписывается
    ...(p.pwa && { pwaSeenAt: sql`coalesce(${s.userOnboarding.pwaSeenAt}, now())` }),
    version: sql`${s.userOnboarding.version} + 1`,
  }).where(eq(s.userOnboarding.userId, userId));
}

export const EVENT_ACTIONS = ["view", "next", "skip", "back", "finish"] as const;
export type OnboardingEvent = { step: string; action: (typeof EVENT_ACTIONS)[number] };
export const isEvent = (v: unknown): v is OnboardingEvent => {
  const e = v as OnboardingEvent | null;
  return !!e && typeof e.step === "string" && /^[a-z0-9-]{1,32}$/.test(e.step) && EVENT_ACTIONS.includes(e.action);
};
export const logEvent = (db: Db, userId: string, e: OnboardingEvent) => db.insert(s.onboardingEvents).values({ userId, step: e.step, action: e.action });
