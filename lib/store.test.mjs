// Тесты семейного хранилища: приватность ответа /api/data, подготовка записей, ключи. Запуск: npm run test
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildView, entryKey, prepareEntry } from "./store.ts";

const vlad = { id: "vlad", name: "Влад" };
const masha = { id: "masha", name: "Маша" };
const exp = (id, date, base, scope, authorId, note = "") => ({ id, amount: base, currency: "RSD", rate: 1, base, catId: "c", note, date, ts: 1, scope, authorId });
const byId = (...list) => Object.fromEntries(list.map((e) => [e.id, e]));

const raw = {
  settings: { base: "RSD", currencies: ["RSD"], rates: {}, familyCategories: [{ id: "f1", name: "Продукты", limit: 40000 }], version: 1 },
  goals: { items: [], version: 0 },
  userSettings: {
    vlad: { personalCategories: [{ id: "pv", name: "Хобби Влада", limit: 1000 }], version: 1 },
    masha: { personalCategories: [{ id: "pm", name: "Секрет Маши", limit: 2000 }], version: 1 },
  },
  hashes: {
    "ft:m:2026-10": byId(exp("f1", "2026-10-02", 500, "family", "vlad"), exp("f2", "2026-10-03", 700, "family", "masha")),
    "ft:i:2026-10": byId({ ...exp("i1", "2026-10-01", 100000, undefined, "masha"), sourceId: "salary" }),
    "ft:u:vlad:m:2026-10": byId(exp("v1", "2026-10-04", 300, "personal", "vlad", "подарок Маше")),
    "ft:u:masha:m:2026-10": byId(
      exp("m1", "2026-10-05", 1200, "personal", "masha", "секретная заметка"),
      exp("m2", "2026-10-05", 800, "personal", "masha"),
      exp("m3", "2026-10-20", 150.5, "personal", "masha"),
    ),
    "ft:u:masha:m:2026-09": byId(exp("m4", "2026-09-30", 99, "personal", "masha")),
  },
};

test("приватность: личное партнёра в ответе только суммами, у обоих пользователей", () => {
  for (const [me, partner, partnerId, myIds, partnerTotal] of [
    [vlad, masha, "masha", ["v1"], { "2026-10": 2150.5, "2026-09": 99 }],
    [masha, vlad, "vlad", ["m1", "m2", "m3"], { "2026-10": 300 }],
  ]) {
    const view = buildView(raw, me, partner);
    const json = JSON.stringify(view);
    // Записи, заметки и категории партнёра отсутствуют ни в каком виде
    for (const [key, hash] of Object.entries(raw.hashes)) {
      if (!key.startsWith(`ft:u:${partnerId}:`)) continue;
      for (const e of Object.values(hash)) {
        assert.ok(!json.includes(`"${e.id}"`), `запись ${e.id} партнёра в ответе ${me.id}`);
        if (e.note) assert.ok(!json.includes(e.note), `заметка партнёра в ответе ${me.id}`);
      }
    }
    for (const c of raw.userSettings[partnerId].personalCategories) assert.ok(!json.includes(c.name), `категория партнёра у ${me.id}`);
    // Свои личные — на месте, суммы партнёра совпадают
    assert.deepEqual((view.myExpenses["2026-10"] ?? []).map((e) => e.id), myIds);
    assert.deepEqual(view.mySettings, raw.userSettings[me.id]);
    assert.deepEqual(view.partnerPersonalTotals, partnerTotal);
    // Семейное и доходы видят оба
    assert.deepEqual(view.familyExpenses["2026-10"].map((e) => e.id), ["f1", "f2"]);
    assert.deepEqual(view.incomes["2026-10"].map((e) => e.id), ["i1"]);
  }
  // Суммы партнёра по дням — для честного сравнения периодов
  assert.deepEqual(buildView(raw, vlad, masha).partnerPersonalDaily["2026-10"], { 5: 2000, 20: 150.5 });
});

const body = { id: "e1", amount: 100, currency: "RSD", rate: 1, base: 100, catId: "c", note: "x", date: "2026-10-10", ts: 5 };

test("POST /api/entries: authorId из тела игнорируется, ставится из сессии", () => {
  const e = prepareEntry("expense", { ...body, authorId: "masha", scope: "personal" }, "vlad");
  assert.equal(e.authorId, "vlad");
  assert.equal(e.scope, "personal");
  const i = prepareEntry("income", { ...body, sourceId: "salary", authorId: "masha" }, "vlad");
  assert.equal(i.authorId, "vlad");
  assert.ok(!("scope" in i));
});

test("prepareEntry отбрасывает некорректные записи и лишние поля", () => {
  assert.equal(prepareEntry("expense", { ...body, amount: -1 }, "vlad"), null);
  assert.equal(prepareEntry("expense", { ...body, date: "2026-13-01" }, "vlad"), null);
  assert.equal(prepareEntry("expense", { ...body, catId: "" }, "vlad"), null);
  assert.equal(prepareEntry("income", body, "vlad"), null); // нет sourceId
  assert.equal(prepareEntry("expense", null, "vlad"), null);
  const e = prepareEntry("expense", { ...body, hack: "<script>", scope: "weird" }, "vlad");
  assert.ok(!("hack" in e));
  assert.equal(e.scope, "family"); // неизвестный scope — семейный
});

test("ключи: личная трата — только в хеше текущего пользователя, удалить чужую нельзя", () => {
  assert.equal(entryKey("expense", "personal", "vlad", "2026-10"), "ft:u:vlad:m:2026-10");
  assert.equal(entryKey("expense", "family", "vlad", "2026-10"), "ft:m:2026-10");
  assert.equal(entryKey("income", undefined, "masha", "2026-10"), "ft:i:2026-10");
  // DELETE строит ключ из сессии: запрос Влада на удаление личной записи Маши ищет её в хеше Влада и не находит
  const key = entryKey("expense", "personal", "vlad", "2026-10");
  assert.equal(raw.hashes[key]?.m1, undefined);
  assert.ok(raw.hashes["ft:u:masha:m:2026-10"].m1);
});

test("валюта в личных настройках проверяется на сервере", async () => {
  const { isUserSettingsData } = await import("./store.ts");
  assert.equal(isUserSettingsData({ personalCategories: [], preferredCurrency: "EUR" }), true);
  assert.equal(isUserSettingsData({ personalCategories: [] }), true);
  assert.equal(isUserSettingsData({ personalCategories: [], preferredCurrency: "eur!" }), false);
  assert.equal(isUserSettingsData({ personalCategories: [], reminders: { hour: 8, weekday: 1, planDays: 3, tz: "America/New_York" } }), true);
  assert.equal(isUserSettingsData({ personalCategories: [], reminders: { hour: 8, weekday: 1, planDays: 3, tz: "Mars/Base" } }), false);
  assert.equal(isUserSettingsData({ personalCategories: [], reminders: { hour: 24, weekday: 1, planDays: 3 } }), false);
  assert.equal(isUserSettingsData({ personalCategories: [], reminders: { hour: 8, weekday: 1, planDays: 0 } }), false);
  assert.equal(isUserSettingsData({ personalCategories: [], reminders: { hour: 8.5, weekday: 1 } }), false);
});
