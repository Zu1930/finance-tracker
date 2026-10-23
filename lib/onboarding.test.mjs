// Знакомство с приложением: миграция прежних пользователей, опрос целиком одной транзакцией, «Настрою сам»,
// короткий опрос приглашённого, карточка «Настройка» из данных, подсказки по одной. Запуск: npm run test
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { freshDb } from "./test/auth-kit.mjs";

const schema = await import("./data/postgres/schema.ts");
const { postgresRepos } = await import("./data/postgres/repos.ts");
const { buildView } = await import("./store.ts");
const { acceptInvite } = await import("./family.ts");
const ob = await import("./onboarding.ts");
const srv = await import("./onboarding-server.ts");
const { eq } = await import("drizzle-orm");

const RSD_PER = { RSD: 1, EUR: 117.2, USD: 100.5, RUB: 1.25 };
const TODAY = "2026-10-15";
let db, sql, r;

beforeEach(async () => {
  ({ db, sql } = await freshDb(schema));
  r = postgresRepos(db);
  await sql(`INSERT INTO users (id, name) VALUES ('anna', 'Анна'), ('boris', 'Борис')`);
});

const ctxOf = async (who) => ({ userId: who, householdId: await r.system.ensureHousehold(who) });
const fresh = async (who) => { await srv.startOnboarding(db, who); return ctxOf(who); };
const row = async (who) => (await db.select().from(schema.userOnboarding).where(eq(schema.userOnboarding.userId, who)))[0];
const viewOf = async (ctx) => {
  const list = await r.system.members(ctx.householdId);
  return buildView(await r.store.snapshot(ctx), list.find((u) => u.id === ctx.userId), list.find((u) => u.id !== ctx.userId) ?? null);
};

test("миграция: прежние пользователи — done и без карточки, подсказки пустые; без строки — тоже done", async () => {
  // INSERT из 0004 на базе, где пользователи уже есть (в freshDb миграции прошли до их появления)
  const insert = readFileSync(new URL("../drizzle/0004_onboarding.sql", import.meta.url), "utf8").split("\n").find((l) => l.startsWith("INSERT"));
  await sql(insert);
  const a = await row("anna");
  assert.equal(a.status, "done");
  assert.ok(a.checklistDismissedAt);
  assert.deepEqual(a.hintsSeen, []);
  await sql(`INSERT INTO users (id, name) VALUES ('script', 'Из скрипта')`);
  const st = await srv.onboardingState(db, await ctxOf("script"));
  assert.equal(st.status, "done");
  assert.equal(st.dismissed, true);
});

test("новый пользователь — pending; complete solo: валюта, лимиты в ней с округлением, ровно выбранное", async () => {
  const ctx = await fresh("anna");
  assert.equal((await srv.onboardingState(db, ctx)).status, "pending");
  const res = await srv.completeOnboarding(db, ctx, {
    currency: "EUR", who: "solo",
    cats: [{ key: "food", name: "Продукты", scope: "family" }, { key: "cafe", name: "Кафе", scope: "personal" }, { key: "transport", name: "Транспорт", scope: "family" }, { name: "Хобби", scope: "personal" }],
    payments: [{ key: "rent", amount: 700, day: 20 }, { key: "loan", amount: 170, day: 1 }],
    accounts: [{ key: "card", balance: 1200 }],
  }, RSD_PER, TODAY);
  assert.deepEqual(res, { ok: true, inviteCode: null, inviteUntil: null });
  const v = await viewOf(ctx);
  assert.equal(v.solo, true);
  assert.equal(v.settings.base, "EUR");
  assert.deepEqual(v.settings.familyCategories, [], "в solo всё личное");
  // 40000/117.2 = 341.3 → 340; 15000/117.2 = 128 → 130; 6000/117.2 = 51.2 → 51; своя — 0
  assert.deepEqual(v.mySettings.personalCategories.map((c) => [c.name, c.limit]), [["Продукты", 340], ["Кафе", 130], ["Транспорт", 51], ["Хобби", 0], ["Прочее", 0]]);
  // Аренда → «Для дома» не выбрана → «Прочее» (создана без лимита); кредит — тоже «Прочее»
  const other = v.mySettings.personalCategories.find((c) => c.name === "Прочее");
  assert.deepEqual(v.recurring.mine.map((p) => [p.name, p.categoryId === other.id, p.scope, p.amounts[0].amount, p.startMonth]),
    [["Аренда", true, "personal", 700, "2026-10"], ["Кредит", true, "personal", 170, "2026-11"]], "день прошёл — со следующего месяца");
  assert.deepEqual(v.savings.accounts.mine.map((a) => [a.name, a.currency, a.balance]), [["Карта", "EUR", 1200]]);
  assert.equal(v.savings.recons.length, 1, "первая сверка — точка отсчёта");
  const a = await row("anna");
  assert.equal(a.status, "done");
  assert.ok(a.completedAt);
  assert.deepEqual(await srv.completeOnboarding(db, ctx, { currency: "EUR" }, RSD_PER, TODAY), { ok: false, status: 409, error: "Настройка уже пройдена." });
});

test("complete: пропущенные шаги — категории по умолчанию, без счетов нет и сверки; RSD без пересчёта", async () => {
  const ctx = await fresh("anna");
  assert.equal((await srv.completeOnboarding(db, ctx, { currency: "RSD" }, RSD_PER, TODAY)).ok, true);
  const v = await viewOf(ctx);
  assert.deepEqual(v.mySettings.personalCategories.map((c) => [c.name, c.limit]), [["Продукты", 40000], ["Кафе", 15000], ["Транспорт", 6000], ["Для дома", 8000], ["Прочее", 8000]]);
  assert.equal(v.savings.accounts.mine.length, 0);
  assert.equal(v.savings.recons.length, 0);
  assert.equal(v.recurring.mine.length, 0);
});

test("complete для пары: семья с одним участником, семейные и личные категории, платёж — scope категории, приглашение", async () => {
  const ctx = await fresh("anna");
  const res = await srv.completeOnboarding(db, ctx, {
    currency: "RSD", who: "pair",
    cats: [{ key: "home", name: "Для дома", scope: "family" }, { key: "cafe", name: "Кафе", scope: "personal" }, { key: "fun", name: "Развлечения", scope: "personal" }],
    payments: [{ key: "internet", amount: 2990, day: 5 }, { key: "subs", amount: 1500, day: 15 }],
    accounts: [{ key: "card", balance: 0 }, { key: "eur", balance: 300 }],
  }, RSD_PER, TODAY);
  assert.equal(res.ok, true);
  assert.match(res.inviteCode, /\S{6,}/);
  const [h] = await db.select().from(schema.households).where(eq(schema.households.id, ctx.householdId));
  assert.equal(h.kind, "family");
  const v = await viewOf(ctx);
  assert.deepEqual(v.settings.familyCategories.map((c) => c.name), ["Для дома"]);
  assert.deepEqual(v.mySettings.personalCategories.map((c) => c.name), ["Кафе", "Развлечения"]);
  assert.deepEqual(v.recurring.family.map((p) => p.name), ["Интернет"]);
  assert.deepEqual(v.recurring.mine.map((p) => p.name), ["Подписки"], "подписки → «Развлечения», она личная");
  assert.ok(v.settings.currencies.includes("EUR"));
  assert.deepEqual(v.savings.accounts.mine.map((a) => [a.name, a.currency, a.balance]), [["Карта", "RSD", 0], ["Счёт в евро", "EUR", 300]]);
  assert.equal(v.savings.recons.length, 1);
});

test("ошибка на середине — откат целиком: ни настроек, ни категорий, статус pending", async () => {
  const ctx = await fresh("anna");
  // В обход parseDraft: отрицательная сумма валится уже после записи настроек и категорий
  const res = await srv.completeOnboarding(db, ctx, { currency: "RSD", payments: [{ key: "rent", amount: -1, day: 1 }], accounts: [{ key: "card", balance: 5 }] }, RSD_PER, TODAY);
  assert.equal(res.ok, false);
  assert.equal(res.status, 400);
  assert.equal(await r.settings.get(ctx), null);
  assert.equal(await r.userSettings.get(ctx), null);
  assert.equal((await db.select().from(schema.accounts)).length, 0);
  assert.equal((await row("anna")).status, "pending");
});

test("«Настрою сам»: solo с прежними значениями по умолчанию, статус skipped, повтор — 409", async () => {
  const ctx = await fresh("anna");
  assert.deepEqual(await srv.skipOnboarding(db, ctx, "EUR"), { ok: true });
  const v = await viewOf(ctx);
  assert.equal(v.settings.base, "EUR");
  assert.equal(v.mySettings.personalCategories.length, 8);
  assert.equal((await row("anna")).status, "skipped");
  assert.equal((await srv.skipOnboarding(db, ctx, "EUR")).status, 409);
});

test("приглашённый: короткий опрос, всё его — личное, семейные настройки не трогаются", async () => {
  const anna = await fresh("anna");
  const { inviteCode } = await srv.completeOnboarding(db, anna, { currency: "RSD", who: "pair", cats: [{ key: "home", name: "Для дома", scope: "family" }] }, RSD_PER, TODAY);
  const boris = await fresh("boris");
  assert.equal((await acceptInvite(db, inviteCode, "boris")).ok, true);
  const bctx = await ctxOf("boris");
  const st = await srv.onboardingState(db, bctx);
  assert.equal(st.invited, true);
  assert.equal(st.status, "pending");
  // Семейный пресет приглашённому нельзя
  assert.equal((await srv.completeOnboarding(db, bctx, { cats: [{ key: "home", name: "Для дома", scope: "family" }] }, RSD_PER, TODAY)).status, 400);
  assert.equal((await srv.completeOnboarding(db, bctx, {
    cats: [{ key: "cafe", name: "Кафе", scope: "family" }], payments: [{ key: "rent", amount: 30000, day: 1 }], accounts: [{ key: "cash", balance: 5000 }],
  }, RSD_PER, TODAY)).ok, true);
  const v = await viewOf(bctx);
  assert.deepEqual(v.settings.familyCategories.map((c) => c.name), ["Для дома"], "семейные — как были");
  assert.deepEqual(v.mySettings.personalCategories.map((c) => c.name), ["Кафе", "Прочее"]);
  assert.deepEqual(v.recurring.mine.map((p) => [p.name, p.scope]), [["Аренда", "personal"]]);
  assert.equal(v.recurring.family.length, 0);
  assert.deepEqual(v.savings.accounts.mine.map((a) => a.name), ["Наличные"]);
  assert.equal(v.savings.recons.length, 1, "в семье сверок не было — первая");
  // Анна в семье — владелец, не приглашённая
  assert.equal((await srv.onboardingState(db, anna)).invited, false);
});

test("черновик: неизвестные пресеты, повторы и мусор — отказ; своя категория обрезается", () => {
  assert.equal(ob.parseDraft({ currency: "GBP" }), null);
  assert.equal(ob.parseDraft({ cats: [{ key: "nope", name: "x", scope: "family" }] }), null);
  assert.equal(ob.parseDraft({ cats: [{ name: "Хобби", scope: "personal" }, { name: "хобби", scope: "personal" }] }), null);
  assert.equal(ob.parseDraft({ payments: [{ key: "rent", amount: 0, day: 1 }] }), null);
  assert.equal(ob.parseDraft({ payments: [{ key: "rent", amount: 10, day: 32 }] }), null);
  assert.equal(ob.parseDraft({ accounts: [{ key: "card", balance: -1 }] }), null);
  assert.deepEqual(ob.parseDraft({ cats: [{ key: "food", name: "любое", scope: "family" }, { name: `  ${"я".repeat(50)} `, scope: "personal" }] }).cats.map((c) => c.name.length), [8, 40]);
  assert.deepEqual(ob.parseDraft({}), {});
});

test("пересчёт пресетов и валюта по локали", () => {
  assert.equal(ob.roundPreset(1234), 1200);
  assert.equal(ob.roundPreset(128), 130);
  assert.equal(ob.roundPreset(51.2), 51);
  assert.equal(ob.presetIn(82000, "EUR", RSD_PER), 700);
  assert.equal(ob.presetIn(82000, "RUB", RSD_PER), 65600);
  assert.deepEqual(ob.ratesFor("EUR", ["EUR", "RSD", "USD"], RSD_PER), { RSD: 0.00853242, USD: 0.857509 });
  assert.equal(ob.localeCurrency("sr-Latn-RS"), "RSD");
  assert.equal(ob.localeCurrency("sr-RS"), "RSD");
  assert.equal(ob.localeCurrency("ru-RU"), "RUB");
  assert.equal(ob.localeCurrency("de-DE"), "EUR");
  assert.equal(ob.localeCurrency("ru"), "RUB");
  assert.equal(ob.localeCurrency("en-GB"), "USD");
  assert.equal(ob.accountPresets("EUR").some((a) => a.key === "eur"), false);
});

test("карточка: выполнение из данных, «не нужно» засчитывается", async () => {
  const ctx = await fresh("anna");
  await srv.completeOnboarding(db, ctx, { currency: "RSD" }, RSD_PER, TODAY);
  const st = await srv.onboardingState(db, ctx);
  let items = ob.checklist(await viewOf(ctx), st);
  assert.deepEqual(items.filter((i) => i.done).map((i) => i.id), ["categories", "voice"]);
  assert.equal(ob.checklistDone(items), 2);
  await r.expenses.add(ctx, { id: "e1", amount: 300, currency: "RSD", rate: 1, base: 300, catId: "", note: "", date: TODAY, ts: 1, scope: "personal", authorId: "anna" });
  await srv.patchOnboarding(db, "anna", { hide: "pwa" });
  await srv.patchOnboarding(db, "anna", { hide: "pwa" });
  items = ob.checklist(await viewOf(ctx), await srv.onboardingState(db, ctx));
  assert.equal(ob.checklistDone(items), 4, "категории, трата, голос + «не нужно» у приложения");
  assert.deepEqual((await row("anna")).checklistHiddenItems, ["pwa"], "без повторов");
});

test("отметки: × скрывает карточку, вернуть можно; подсказка и pwa — один раз на пользователя", async () => {
  const ctx = await fresh("anna");
  assert.equal((await srv.onboardingState(db, ctx)).dismissed, false);
  await srv.patchOnboarding(db, "anna", { dismiss: true });
  assert.equal((await srv.onboardingState(db, ctx)).dismissed, true);
  await srv.patchOnboarding(db, "anna", { dismiss: false });
  assert.equal((await srv.onboardingState(db, ctx)).dismissed, false);
  await srv.patchOnboarding(db, "anna", { hint: "entry" });
  await srv.patchOnboarding(db, "anna", { hint: "entry" });
  await srv.patchOnboarding(db, "anna", { pwa: true });
  const first = (await row("anna")).pwaSeenAt;
  await srv.patchOnboarding(db, "anna", { pwa: true });
  const a = await row("anna");
  assert.deepEqual(a.hintsSeen, ["entry"]);
  assert.equal(a.pwaSeenAt.getTime(), first.getTime(), "первый запуск не перезаписывается");
  assert.equal(srv.parsePatch({ hint: "nope" }), null);
  assert.equal(srv.parsePatch({}), null);
  assert.deepEqual(srv.parsePatch({ dismiss: true, hide: "voice" }), { dismiss: true, hide: "voice" });
});

test("подсказки: по одной, family не видна solo, тишина 10 секунд после опроса", () => {
  const st = { hintsSeen: ["entry"], completedAt: "2026-10-15T10:00:00.000Z" };
  const later = Date.parse(st.completedAt) + 60_000;
  assert.equal(ob.visibleHint(["entry", "family", "voice"], st, false, later), "family");
  assert.equal(ob.visibleHint(["entry", "family", "voice"], st, true, later), "voice");
  assert.equal(ob.visibleHint(["family", "voice"], st, false, Date.parse(st.completedAt) + 5_000), null);
  assert.equal(ob.visibleHint(["entry"], st, false, later), null);
});

test("события шагов: проверка и запись", async () => {
  assert.equal(srv.isEvent({ step: "currency", action: "next" }), true);
  assert.equal(srv.isEvent({ step: "currency", action: "jump" }), false);
  assert.equal(srv.isEvent({ step: "Шаг 1", action: "view" }), false);
  await srv.logEvent(db, "anna", { step: "intro", action: "view" });
  assert.deepEqual((await db.select().from(schema.onboardingEvents)).map((e) => [e.userId, e.step, e.action]), [["anna", "intro", "view"]]);
});

test("черновик /welcome: переживает перезагрузку, чужой не подхватывается; пропущенные шаги и пустые строки не уходят", () => {
  const mem = new Map();
  const store = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v), removeItem: (k) => mem.delete(k) };
  const d = {
    userId: "anna", step: 4, currency: "EUR", who: "pair", picked: { food: "family", cafe: "personal" }, custom: [{ name: "Хобби", scope: "family" }],
    pays: { rent: { amount: "700,5", day: "1" }, phone: { amount: "", day: "28" } }, accounts: { card: "1200", cash: " ", eur: "0" }, skipped: [],
  };
  ob.writeDraft(store, d);
  assert.deepEqual(ob.readDraft(store, "anna"), d, "после перезагрузки — то же самое");
  assert.equal(ob.readDraft(store, "boris"), null);
  store.setItem(ob.WELCOME_DRAFT_KEY, "{битый");
  assert.equal(ob.readDraft(store, "anna"), null);

  assert.deepEqual(ob.toDraft(d, false), {
    currency: "EUR", who: "pair",
    cats: [{ key: "food", name: "Продукты", scope: "family" }, { key: "cafe", name: "Кафе", scope: "personal" }, { name: "Хобби", scope: "family" }],
    payments: [{ key: "rent", amount: 700.5, day: 1 }],
    accounts: [{ key: "card", balance: 1200 }, { key: "eur", balance: 0 }],
  });
  const skipped = ob.toDraft(d, false, ["who", "cats", "accounts"]);
  assert.equal(skipped.who, "solo");
  assert.equal("cats" in skipped, false, "категории — по умолчанию на сервере");
  assert.equal("accounts" in skipped, false);
  // Приглашённый: без валюты и «для кого», всё личное, семейный пресет не попадает
  const inv = ob.toDraft(d, true);
  assert.equal("currency" in inv, false);
  assert.deepEqual(inv.cats, [{ key: "cafe", name: "Кафе", scope: "personal" }, { name: "Хобби", scope: "personal" }]);
  assert.ok(ob.parseDraft(ob.toDraft(d, false)), "то, что собирает экран, проходит проверку сервера");
});

test("/welcome: при pending ведёт туда отовсюду, кроме помощи и (если бюджет есть) настроек; пройден — нет", () => {
  const pending = { onboarding: { status: "pending" }, settings: null };
  assert.equal(ob.needsWelcome(pending, "/"), true);
  assert.equal(ob.needsWelcome(pending, "/limits"), true);
  assert.equal(ob.needsWelcome(pending, "/help/start"), false);
  assert.equal(ob.needsWelcome(pending, "/settings/account"), true, "без бюджета настройкам нечего показать");
  assert.equal(ob.needsWelcome({ ...pending, settings: { base: "RSD" } }, "/settings/account"), false);
  for (const status of ["done", "skipped"]) assert.equal(ob.needsWelcome({ onboarding: { status }, settings: null }, "/"), false);
  assert.equal(ob.needsWelcome({ settings: null }, "/"), false, "нет данных о знакомстве — как пройдено");
});
