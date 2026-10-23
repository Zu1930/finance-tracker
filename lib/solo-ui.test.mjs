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
        const C = { RecentLogs, IncomeBalance, Contribution, Accounts, Setup };
        export const render = (name, ctx, props = {}) => renderToStaticMarkup(h(TrackerContext.Provider, { value: ctx }, h(C[name], props)));
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

test("семья: метки, имена авторов и разбивка по людям на месте", () => {
  const c = ctxFor(false);
  assert.equal(c.isSolo, false);
  const logs = text(ui.render("RecentLogs", c));
  assert.match(logs, /\[СЕМ\]/);
  assert.match(logs, /\[ЛИЧН\]/);
  assert.match(logs, /Маша/);
  assert.match(text(ui.render("IncomeBalance", c)), /Влад.*Маша/);
  assert.match(text(ui.render("Contribution", c, { sums: { vlad: 1, masha: 2 } })), /Влад 1 · Маша 2/);
  const acc = text(ui.render("Accounts", c));
  assert.match(acc, /Семья/);
  assert.match(acc, /Личное/);
});

test("solo: ни меток СЕМ/ЛИЧН, ни имён, ни разбивки по людям, ни семейных разделов", () => {
  const c = ctxFor(true);
  assert.equal(c.isSolo, true);
  assert.equal(c.data.partner, null);
  const all = ["RecentLogs", "IncomeBalance", "Accounts"].map((n) => text(ui.render(n, c))).join(" | ");
  assert.doesNotMatch(all, /СЕМ\]|ЛИЧН\]|Семья|Личное|Маша/);
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
