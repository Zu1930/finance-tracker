// Доходы личные во вводе: переключатель «Доход» только в ◇ (и у solo); доход, начатый в ◆ («+2100», голос,
// командная строка), переключает форму на ◇ ДОХОД с подсказкой. Компоненты собираются esbuild. Запуск: npm test
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { build } from "esbuild";
import { incomeAllowed, incomeSwitch } from "./space.ts";
import { parsePhrase } from "./quick-entry/parse.ts";
import { buildView } from "./store.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
let ui;
before(async () => {
  const out = join(root, "node_modules", ".cache", "income-ui-test", "ui.mjs");
  await build({
    stdin: {
      contents: `
        import { createElement as h } from "react";
        import { renderToStaticMarkup } from "react-dom/server";
        import { TrackerContext } from "@/components/TrackerProvider";
        import { SpaceContext } from "@/components/SpaceProvider";
        import { EntryPage } from "@/components/entry/EntryPage";
        export { scopeReasonText } from "@/components/entry/QuickEntry";
        export const render = (ctx, space) => renderToStaticMarkup(h(TrackerContext.Provider, { value: ctx }, h(SpaceContext.Provider, { value: space }, h(EntryPage))));
      `,
      resolveDir: root, loader: "tsx",
    },
    bundle: true, platform: "node", format: "esm", jsx: "automatic", outfile: out, logLevel: "error",
    alias: { "@": root }, define: { "process.env.NODE_ENV": "\"production\"" },
    plugins: [{ name: "nav", setup(b) {
      b.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "nav", namespace: "stub" }));
      b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: "export const useSearchParams = () => new URLSearchParams(); export const useRouter = () => ({ push() {}, replace() {} }); export const usePathname = () => '/';", loader: "js" }));
    } }],
    banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' },
  });
  ui = await import(pathToFileURL(out).href);
});

const me = { id: "vlad", name: "Влад" }, partner = { id: "masha", name: "Маша" };
const settings = { base: "RSD", currencies: ["RSD", "EUR"], rates: { EUR: 117 }, schemaVersion: 3, familyCategories: [{ id: "food", name: "Еда", limit: 1000 }], version: 1 };
const raw = { settings, goals: null, userSettings: { vlad: { personalCategories: [{ id: "hobby", name: "Хобби", limit: 100 }], version: 1 } }, hashes: {} };
const noop = () => {};
const ctxOf = (solo) => {
  const data = buildView(raw, me, solo ? null : partner);
  data.mySettings = { ...data.mySettings, hideQuickEntry: true };
  return { data, isSolo: solo, toast: noop, api: async () => null, addEntry: noop, removeEntry: noop, setSettings: noop, setMySettings: noop, month: "2026-11", setMonth: noop, patchOnboarding: noop };
};
const spaceOf = (space) => ({ space, setSpace: noop, view: space, readOnly: space === "all", switchable: true, entryScope: space === "all" ? null : space, chooserOpen: false, setChooserOpen: noop });
const hasIncomeToggle = (html) => /aria-label="Тип записи"/.test(html);

test("переключателя «Доход» в ◆ нет, в ◇ и у solo — есть", () => {
  assert.equal(hasIncomeToggle(ui.render(ctxOf(false), spaceOf("family"))), false);
  assert.equal(hasIncomeToggle(ui.render(ctxOf(false), spaceOf("personal"))), true);
  assert.equal(hasIncomeToggle(ui.render(ctxOf(true), spaceOf("family"))), true);
  assert.deepEqual([incomeAllowed("family", false), incomeAllowed("personal", false), incomeAllowed("family", true)], [false, true, true]);
});

test("в ◆ «+2100» и голосом «зарплата 2100 евро» — доход: форма переключается на ◇ ДОХОД с подсказкой", () => {
  // «+» на пустой сумме и разобранный доход ведут в одно и то же переключение
  assert.deepEqual(incomeSwitch("family", false), { scope: "personal", note: true });
  assert.deepEqual(incomeSwitch("personal", false), { scope: "personal", note: false }, "в ◇ — без подсказки");
  assert.deepEqual(incomeSwitch("family", true), { scope: "family", note: false }, "solo — не переключается");
  const ctx = { today: "2026-11-05", base: "RSD", currencies: ["RSD", "EUR"], familyCategories: settings.familyCategories, personalCategories: [], dictionary: {}, defaultScope: "family", incomeSources: [{ id: "salary", name: "Зарплата" }] };
  for (const text of ["+2100", "зарплата 2100 евро"]) {
    const [p] = parsePhrase(text, ctx);
    assert.deepEqual([p.kind, p.scope, p.amount], ["income", "personal", 2100], text);
    // Строка разбора командной строки в ◆: ◇ и мета «доход — личный»; в ◇ меты нет
    assert.equal(ui.scopeReasonText(p, "family"), "доход — личный");
    assert.equal(ui.scopeReasonText(p, "personal"), null);
  }
});

test("лента месяца: в ◆ и ∑ — строка «Доходы за …» с двумя именами и без записей доходов, в ◇ — мои доходы строками", () => {
  const cur = new Date().toISOString().slice(0, 7);
  const inc = (id, base, authorId, note) => ({ id, amount: base, currency: "RSD", rate: 1, base, sourceId: "salary", note, date: `${cur}-01`, ts: 1, authorId });
  const withInc = { ...raw, hashes: { [`ft:i:${cur}`]: { i1: inc("i1", 246120, "vlad", "моя-зп"), i2: inc("i2", 150000, "masha", "зп-маши") } } };
  const ctx = (who, other) => {
    const data = buildView(withInc, who, other);
    data.memberIds = ["vlad", "masha"];
    return { ...ctxOf(false), data };
  };
  for (const [who, other] of [[me, partner], [partner, me]]) {
    for (const sp of ["family", "all"]) {
      const html = ui.render(ctx(who, other), spaceOf(sp)).replace(/\s/g, " ");
      assert.match(html, /Доходы за [^<]*<\/span><span> · Влад <b>246 120<\/b><\/span><span> · Маша <b>150 000<\/b>/, `${who.id} ${sp}`);
      assert.ok(!html.includes("моя-зп") && !html.includes("зп-маши"), `${who.id} ${sp}: записи доходов в ленте`);
    }
  }
  const mine = ui.render(ctx(me, partner), spaceOf("personal"));
  assert.ok(mine.includes("моя-зп") && !mine.includes("зп-маши"));
  assert.ok(!mine.includes("Доходы за"));
});
