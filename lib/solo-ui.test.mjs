// Компонентный тест флага isSolo: одни и те же компоненты в семье показывают метки [СЕМ]/[ЛИЧН], имена и разбивку
// по людям, в solo — нет. Компоненты собираются esbuild и рендерятся в строку с подменённым контекстом.
// Запуск: npm run test
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("..", import.meta.url));
let ui;
before(async () => {
  // Внутри проекта: react и react-dom (external) находятся в его node_modules
  const out = join(root, "node_modules", ".cache", "solo-ui-test", "ui.mjs");
  await build({
    stdin: {
      contents: `
        import { createElement as h } from "react";
        import { renderToStaticMarkup } from "react-dom/server";
        import { TrackerContext } from "@/components/TrackerProvider";
        import { RecentLogs } from "@/components/entry/RecentLogs";
        import { IncomeBalance } from "@/components/entry/IncomeBalance";
        import { Contribution } from "@/components/entry/Contribution";
        import { Accounts } from "@/components/savings/Accounts";
        import { Setup } from "@/components/Setup";
        import { WithSetupCard } from "@/components/onboarding/SetupCard";
        import { Article } from "@/components/help/Help";
        import { SpaceContext, SpaceProvider, useSpace } from "@/components/SpaceProvider";
        import { SpaceSwitcher, ReadOnlyPick } from "@/components/SpaceSwitcher";
        import { SpaceSummary } from "@/components/SpaceSummary";
        import { Goals } from "@/components/savings/Goals";
        import { PlanItems } from "@/components/plan/PlanItems";
        import { fabAction } from "@/components/entry/MobileEntry";
        import { MobileLimits } from "@/components/limits/MobileLimits";
        const Probe = () => { const s = useSpace(); return JSON.stringify({ space: s.space, view: s.view, readOnly: s.readOnly, switchable: s.switchable, entryScope: s.entryScope }); };
        const C = { RecentLogs, IncomeBalance, Contribution, Accounts, Setup, WithSetupCard, Article, SpaceSwitcher, ReadOnlyPick, SpaceSummary, Goals, PlanItems, MobileLimits, Probe };
        export { fabAction };
        /** space — значение контекста бюджета (SpaceContext); provider — настоящий SpaceProvider */
        export const render = (name, ctx, props = {}, space) => {
          const inner = h(C[name], props);
          return renderToStaticMarkup(h(TrackerContext.Provider, { value: ctx }, space ? h(SpaceContext.Provider, { value: space }, inner) : inner));
        };
        export const renderInProvider = (name, ctx, props = {}) => renderToStaticMarkup(h(TrackerContext.Provider, { value: ctx }, h(SpaceProvider, null, h(C[name], props))));
      `,
      resolveDir: root, loader: "tsx",
    },
    bundle: true, platform: "node", format: "esm", jsx: "automatic", outfile: out, logLevel: "error",
    // React — внутрь сборки: npm test идёт с --conditions=react-server, а серверная сборка React без хуков и контекста
    alias: { "@": root }, define: { "process.env.NODE_ENV": "\"production\"" },
    // react-dom/server тянет встроенные модули Node через require — в ESM-сборке его нужно дать явно
    banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' },
  });
  ui = await import(pathToFileURL(out).href);
});

const { buildView } = await import("./store.ts");
const me = { id: "vlad", name: "Влад" }, partner = { id: "masha", name: "Маша" };
const month = new Date().toISOString().slice(0, 7), day = `${month}-05`;
const settings = { base: "RSD", currencies: ["RSD"], rates: {}, schemaVersion: 3, familyCategories: [{ id: "food", name: "Еда", limit: 1000 }], version: 1 };
const ex = (id, scope, authorId) => ({ id, amount: 100, currency: "RSD", rate: 1, base: 100, catId: scope === "family" ? "food" : "hobby", note: "", date: day, ts: 1, scope, authorId });
const acc = (id, scope, ownerId) => ({ id, name: id, currency: "RSD", scope, ...(ownerId && { ownerId }), balance: 10, initial: 10, updatedAt: `${day}T10:00:00.000Z`, updatedBy: "vlad", version: 1 });

function ctxFor(solo) {
  const raw = {
    settings: solo ? { ...settings, familyCategories: [] } : settings, goals: null,
    userSettings: { vlad: { personalCategories: [{ id: "hobby", name: "Хобби", limit: 500 }], version: 1 } },
    hashes: {
      ...(!solo && { [`ft:m:${month}`]: { f1: ex("f1", "family", "masha") } }),
      [`ft:u:vlad:m:${month}`]: { p1: ex("p1", "personal", "vlad") },
      [`ft:i:${month}`]: { i1: { id: "i1", amount: 5000, currency: "RSD", rate: 1, base: 5000, sourceId: "salary", note: "", date: day, ts: 2, authorId: "vlad" } },
    },
    savings: { accounts: solo ? {} : { fa: acc("Общий", "family") }, goals: {}, userAccounts: { vlad: { va: acc("Мой", "personal", "vlad") } }, userGoals: {}, recons: [] },
  };
  const data = buildView(raw, me, solo ? null : partner);
  const noop = () => {};
  return { data, isSolo: !!data.solo, scopeTag: (s) => (data.solo ? "" : s === "family" ? "СЕМ" : "ЛИЧН"), toast: noop, api: async () => null, removeEntry: noop, restoreEntry: noop, setSettings: noop, setMySettings: noop, month, offline: null };
}
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

test("семья: символы бюджетов, имена авторов и разбивка по людям на месте", () => {
  const c = ctxFor(false);
  assert.equal(c.isSolo, false);
  const html = ui.render("RecentLogs", c);
  const logs = text(html);
  assert.match(html, /data-icon="space-family"/);
  assert.match(html, /data-icon="space-personal"/);
  assert.doesNotMatch(logs, /\[СЕМ\]|\[ЛИЧН\]/, "старые метки заменены иконками");
  assert.match(logs, /Маша/);
  assert.match(text(ui.render("IncomeBalance", c)), /Влад.*Маша/);
  assert.match(text(ui.render("Contribution", c, { sums: { vlad: 1, masha: 2 } })), /Влад 1 · Маша 2/);
  const acc = text(ui.render("Accounts", c));
  assert.match(acc, /СЕМЬЯ/);
  assert.match(acc, /ЛИЧНОЕ/);
});

test("solo: ни меток СЕМ/ЛИЧН, ни имён, ни разбивки по людям, ни семейных разделов", () => {
  const c = ctxFor(true);
  assert.equal(c.isSolo, true);
  assert.equal(c.data.partner, null);
  const raw = ["RecentLogs", "IncomeBalance", "Accounts"].map((n) => ui.render(n, c)).join(" | ");
  assert.doesNotMatch(raw, /data-icon="space-/, "без иконок бюджета");
  const all = text(raw);
  assert.doesNotMatch(all, /СЕМ\]|ЛИЧН\]|Семья|Личное|СЕМЬЯ|ЛИЧНОЕ|◆|◇|∑|Маша/);
  assert.doesNotMatch(text(ui.render("IncomeBalance", c)), /Влад/, "доход без строки по человеку");
  assert.match(text(ui.render("IncomeBalance", c)), /Всего \+5 000 RSD/);
  assert.equal(ui.render("Contribution", c, { sums: { vlad: 1 } }), "", "вклад по людям не рисуется");
  assert.match(text(ui.render("Accounts", c)), /Мои счета/);
  assert.match(text(ui.render("RecentLogs", c)), /ХОББИ/);
});

test("онбординг: экран :: НАСТРОЙКА со стартовыми категориями", () => {
  const c = { ...ctxFor(true), data: { ...ctxFor(true).data, settings: null } };
  const html = text(ui.render("Setup", c));
  assert.match(html, /Настройка/);
  assert.match(html, /Валюта лимитов/);
  assert.match(html, /Продукты/);
});

const ob = (extra = {}) => ({ status: "done", completedAt: null, dismissed: false, hidden: [], hintsSeen: [], pwaSeen: false, tokens: 0, invited: false, ...extra });
const withOb = (solo, o) => { const c = ctxFor(solo); return { ...c, patchOnboarding: () => {}, data: { ...c.data, onboarding: o } }; };

test("карточка «Настройка»: счёт из данных, «не нужно» засчитано; скрыта — нет; во время опроса — нет", () => {
  // solo: категория одна (не ≥ 3), своя трата есть, голос включён; pwa — «не нужно»
  const html = text(ui.render("WithSetupCard", withOb(true, ob({ hidden: ["pwa"] })), { children: "ФОРМА" }));
  assert.match(html, /:: Настройка 3\/6/);
  assert.match(html, /ФОРМА/);
  assert.match(html, /не нужно/);
  for (const o of [ob({ dismissed: true }), ob({ status: "pending" })]) {
    const h = text(ui.render("WithSetupCard", withOb(true, o), { children: "ФОРМА" }));
    assert.doesNotMatch(h, /Настройка \d/);
    assert.match(h, /ФОРМА/);
  }
  assert.doesNotMatch(text(ui.render("WithSetupCard", withOb(true, undefined), { children: "x" })), /Настройка/, "прежние без состояния — без карточки");
});

test("помощь: семейные блоки solo не видит, статья family у solo — «Пригласить партнёра»", () => {
  const md = "# Семья\n\n<!-- family -->\nСЕМЕЙНЫЙ-БЛОК\n<!-- /family -->\n\nОБЩИЙ";
  const solo = text(ui.render("Article", withOb(true, ob()), { id: "family", md }));
  assert.doesNotMatch(solo, /СЕМЕЙНЫЙ-БЛОК/);
  assert.match(solo, /Пригласить партнёра/);
  assert.match(solo, /ОБЩИЙ/);
  assert.match(text(ui.render("Article", withOb(false, ob()), { id: "family", md })), /СЕМЕЙНЫЙ-БЛОК/);
});

// ---------- Бюджет экрана: ◆ семья, ◇ личное, ∑ всё вместе ----------
const sp = (space, extra = {}) => ({ space, view: space, readOnly: space === "all", switchable: true, entryScope: space === "all" ? null : space, chooserOpen: false, setChooserOpen: () => {}, setSpace: () => {}, ...extra });
const probe = (c) => JSON.parse(ui.renderInProvider("Probe", c).replaceAll("&quot;", '"'));
const famCtx = () => ({ ...ctxFor(false), patchOnboarding: () => {} });

test("SpaceProvider: по умолчанию семья; у solo контекста нет — один бюджет без переключателя", () => {
  assert.deepEqual(probe(famCtx()), { space: "family", view: "family", readOnly: false, switchable: true, entryScope: "family" });
  assert.deepEqual(probe(ctxFor(true)), { space: "all", view: "all", readOnly: false, switchable: false, entryScope: "personal" });
  const sw = ui.renderInProvider("SpaceSwitcher", famCtx());
  assert.match(text(sw), /СЕМЬЯ/);
  assert.match(sw, /data-icon="space-family".*data-icon="chevron"/s);
  assert.equal(ui.renderInProvider("SpaceSwitcher", ctxFor(true)), "", "у solo переключателя нет");
  const soloHtml = ui.renderInProvider("SpaceSummary", ctxFor(true));
  assert.match(text(soloHtml), /Осталось в лимитах/i);
  assert.doesNotMatch(text(soloHtml), /сем|видите только вы|только просмотр/i);
  assert.doesNotMatch(soloHtml, /data-icon="(space-|lock|view)/);
});

test("итог: семья — по людям, личное — «видите только вы», всё вместе — семья + моё и только просмотр", () => {
  const c = famCtx();
  const fam = text(ui.render("SpaceSummary", c, {}, sp("family")));
  assert.match(fam, /семейных лимитах/i);
  assert.match(fam, /Влад \d.*Маша \d/);
  const perHtml = ui.render("SpaceSummary", c, {}, sp("personal"));
  const per = text(perHtml);
  assert.match(per, /моих лимитах/i);
  assert.match(per, /Это видите только вы/);
  assert.match(perHtml, /data-icon="lock"/);
  assert.doesNotMatch(per, /Маша/);
  const allHtml = ui.render("SpaceSummary", c, {}, sp("all"));
  const all = text(allHtml);
  assert.match(all, /Осталось всего/i);
  assert.match(all, /Семья \d.*Моё \d/);
  assert.match(all, /Только просмотр/);
  assert.match(allHtml, /data-icon="space-family".*data-icon="space-personal".*data-icon="view"/s);
});

test("лента/логи: семья — без моих личных, личное — без имён и семейных, всё — оба символа", () => {
  const c = famCtx();
  const fam = text(ui.render("RecentLogs", c, {}, sp("family")));
  assert.match(fam, /ЕДА/);
  assert.doesNotMatch(fam, /ХОББИ/);
  assert.match(fam, /Маша/);
  const per = text(ui.render("RecentLogs", c, {}, sp("personal")));
  assert.match(per, /ХОББИ/);
  assert.doesNotMatch(per, /ЕДА|Маша|Влад/);
});

test("всё вместе — только просмотр: нет действий создания и изменения, «+» открывает выбор бюджета", () => {
  const c = famCtx();
  const html = ["Accounts", "Goals", "RecentLogs", "PlanItems"].map((n) => ui.render(n, c, n === "Goals" ? { allocated: 0, free: 0, missing: [], empty: false } : n === "PlanItems" ? { month, withStatus: true } : {}, sp("all"))).join("");
  assert.doesNotMatch(html, />Сверка<|\+ Счёт|Убрать счёт|>Создать<|Выделить|Удалить копилку|\+ Добавить|Удалить покупку/);
  assert.doesNotMatch(html, /<button class="(?![^"]*invisible)[^"]*"[^>]*><svg[^>]*data-icon="trash"/, "удаление в логах скрыто");
  assert.match(text(ui.render("Accounts", c, {}, sp("all"))), /СЕМЬЯ.*ЛИЧНОЕ/, "обе группы");
  // В своём бюджете действия на месте
  const fam = ui.render("Accounts", c, {}, sp("family"));
  assert.match(fam, />Сверка</);
  assert.match(fam, /\+ Счёт/);
  assert.doesNotMatch(text(fam), /ЛИЧНОЕ/, "только семейные счета");
  assert.match(text(ui.render("ReadOnlyPick", c, {}, sp("all"))), /Только просмотр.*СЕМЬЯ.*ЛИЧНОЕ/);
  assert.equal(ui.fabAction(true, false), "chooser");
  assert.equal(ui.fabAction(true, true), "chooser");
  assert.equal(ui.fabAction(false, false), "entry");
  assert.equal(ui.fabAction(false, true), "voice");
});

test("мобильные лимиты: в ◆ и ◇ будущий месяц можно спланировать, в ∑ — только просмотр; текущий — «осталось на жизнь»", () => {
  const next = (() => { const [y, m] = month.split("-").map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`; })();
  const sp = (space) => ({ space, setSpace: () => {}, view: space, readOnly: space === "all", switchable: true, entryScope: space === "all" ? null : space, chooserOpen: false, setChooserOpen: () => {} });
  const at = (m) => ({ ...famCtx(), month: m, setMonth: () => {} });
  for (const s of ["family", "personal"]) assert.match(text(ui.render("MobileLimits", at(next), {}, sp(s))), /Спланировать/, s);
  const all = text(ui.render("MobileLimits", at(next), {}, sp("all")));
  assert.doesNotMatch(all, /Спланировать/);
  assert.match(all, /ещё не спланирован/);
  // ◇ — без дохода: три вопроса
  assert.match(text(ui.render("MobileLimits", at(next), {}, sp("personal"))), /Три вопроса/);
  const cur = text(ui.render("MobileLimits", at(month), {}, sp("family")));
  assert.match(cur, /Осталось на жизнь/);
  assert.match(cur, /На день можно ~/);
  assert.match(cur, /Категории/);
  // Заголовки без «лимиты», «регулярные», «план» (кроме строки «План …» / «Без плана»)
  const heads = [...ui.render("MobileLimits", at(month), {}, sp("family")).matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/g)].map((m) => text(m[1]).toLowerCase());
  for (const h of heads) assert.doesNotMatch(h, /лимит|регулярн|план/, h);
});
