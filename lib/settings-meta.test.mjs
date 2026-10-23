// Подписи состояния в меню настроек. Запуск: npm run test
import { test } from "node:test";
import assert from "node:assert/strict";
import { settingsMeta, plural, isSection } from "./settings-meta.ts";

const data = (extra = {}) => ({
  me: { id: "vlad", name: "Влад" }, partner: { id: "masha", name: "Маша" },
  settings: { base: "RSD", currencies: ["RSD", "EUR"], rates: { EUR: 117 }, familyCategories: [], version: 1 },
  mySettings: { personalCategories: [], version: 1 }, ...extra,
});
const x = (extra = {}) => ({ members: 2, tokens: 1, archives: 0, activeCodes: 3, theme: "dark", notifications: true, ...extra });

test("семья, валюты, голос, устройство, данные, аккаунт, бета", () => {
  assert.deepEqual(settingsMeta(data(), x()), {
    family: "2 участника", currency: "RSD", input: "строка видна · 1 токен", device: "dark · увед. вкл",
    data: "архивов нет", account: "Влад", beta: "3 активных кода",
  });
  const m = settingsMeta(data({ solo: true, mySettings: { personalCategories: [], preferredCurrency: "EUR", hideQuickEntry: true, version: 1 } }),
    x({ members: 1, tokens: 5, archives: 2, activeCodes: 1, theme: "auto", notifications: false }));
  assert.equal(m.family, "Только вы");
  assert.equal(m.currency, "RSD · моя EUR");
  assert.equal(m.input, "строка скрыта · 5 токенов");
  assert.equal(m.device, "auto · увед. выкл");
  assert.equal(m.data, "2 архива");
  assert.equal(m.beta, "1 активный код");
  assert.equal(settingsMeta(data(), x({ members: 6, archives: 1 })).family, "6 участников");
  assert.equal(settingsMeta(data(), x({ archives: 1 })).data, "1 архив");
  assert.equal(settingsMeta(data({ mySettings: { personalCategories: [], preferredCurrency: "RSD", version: 1 } }), x()).currency, "RSD", "моя = основная — без второй части");
  assert.equal(settingsMeta(data(), x({ tokens: null, members: null })).input, "строка видна · …", "пока грузится");
});

test("plural и isSection", () => {
  assert.deepEqual([1, 2, 4, 5, 11, 12, 14, 21, 22, 25, 111].map((n) => plural(n, "а", "б", "в")).join(""), "абб" + "вввв" + "абв" + "в");
  assert.equal(isSection("beta"), true);
  assert.equal(isSection("siri"), false);
});
