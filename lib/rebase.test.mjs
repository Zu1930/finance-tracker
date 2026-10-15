// Тесты пересчёта базовой валюты. Запуск: npm run test (node --test, без зависимостей)
import { test } from "node:test";
import assert from "node:assert/strict";
import { rebaseEntry, rebaseSettings, rebaseStore, roundLimit } from "./rebase.ts";

const R = 117.2; // 1 EUR = 117.2 RSD
const toEUR = { from: "RSD", to: "EUR", rate: R, limitRounding: 10 };
const toRSD = { from: "EUR", to: "RSD", rate: 1 / R, limitRounding: 0 };
const near = (a, b, eps = 0.01) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);

const exp = (id, amount, currency, rate, scope = "family", authorId = "vlad") => ({ id, amount, currency, rate, base: Math.round(amount * rate * 100) / 100, catId: "c1", note: "", date: "2026-10-10", ts: 1, scope, authorId });

const settings = {
  base: "RSD",
  currencies: ["RSD", "EUR", "USD"],
  rates: { EUR: R, USD: 100.5, GBP: null },
  familyCategories: [{ id: "c1", name: "Продукты", limit: 40000 }, { id: "c2", name: "Кафе", limit: 15000 }],
  version: 3,
};

const byId = (...list) => Object.fromEntries(list.map((e) => [e.id, e]));
/** Хранилище двух пользователей: семейное, доходы и личное у каждого */
const raw = {
  settings,
  goals: { items: [{ id: "g1", name: "Отпуск", target: 150000, ops: [{ id: "o1", amount: 60000, date: "2026-09-01", ts: 1 }] }], version: 1 },
  userSettings: {
    vlad: { personalCategories: [{ id: "pv", name: "Хобби", limit: 12000 }], version: 2 },
    masha: { personalCategories: [{ id: "pm", name: "Спорт", limit: 9000 }], version: 1 },
  },
  hashes: {
    "ft:m:2026-10": byId(exp("e1", 1200, "RSD", 1), exp("e2", 45, "EUR", R), exp("e3", 30, "USD", 100.5)),
    "ft:i:2026-10": byId({ ...exp("i1", 2100, "EUR", R), sourceId: "salary" }),
    "ft:u:vlad:m:2026-10": byId(exp("pv1", 3000, "RSD", 1, "personal", "vlad")),
    "ft:u:masha:m:2026-10": byId(exp("pm1", 20, "EUR", R, "personal", "masha"), exp("pm2", 5860, "RSD", 1, "personal", "masha")),
  },
};

test("запись в NEW получает rate 1 и base = amount", () => {
  const e = rebaseEntry(exp("e", 45, "EUR", 117.5), toEUR);
  assert.equal(e.rate, 1);
  assert.equal(e.base, 45);
});

test("запись в OLD: base = amount / R", () => {
  const e = rebaseEntry(exp("e", 1200, "RSD", 1), toEUR);
  near(e.rate, 1 / R, 1e-12);
  assert.equal(e.base, Math.round((1200 / R) * 100) / 100);
});

test("запись в третьей валюте: amount * rate = base до копейки", () => {
  const e = rebaseEntry(exp("e", 30, "USD", 100.5), toEUR);
  near(e.rate, 100.5 / R, 1e-12);
  near(e.amount * e.rate, e.base);
});

test("rates пересчитаны: ключа NEW нет, OLD = 1/R, null остаётся null", () => {
  const s = rebaseSettings(settings, toEUR, "2026-10-20");
  assert.equal(s.base, "EUR");
  assert.ok(!("EUR" in s.rates));
  near(s.rates.RSD, 1 / R, 1e-12);
  near(s.rates.USD, 100.5 / R, 1e-12);
  assert.equal(s.rates.GBP, null);
  assert.deepEqual(s.currencies, ["EUR", "RSD", "USD"]);
  assert.deepEqual(s.baseHistory, [{ from: "RSD", to: "EUR", rate: R, at: "2026-10-20" }]);
});

test("лимиты округляются по выбранному шагу", () => {
  // 40000 / 117.2 = 341.2969…
  assert.equal(roundLimit(40000 / R, 10), 340);
  assert.equal(roundLimit(40000 / R, 100), 300);
  assert.equal(roundLimit(40000 / R, 1), 341);
  assert.equal(roundLimit(40000 / R, 0), 341.3);
  const s = rebaseSettings(settings, toEUR, "2026-10-20");
  assert.deepEqual(s.familyCategories.map((c) => c.limit), [340, 130]);
});

test("rebase пересчитывает личные данные обоих пользователей", () => {
  const eur = rebaseStore(raw, toEUR, "2026-10-20");
  const v = eur.hashes["ft:u:vlad:m:2026-10"].pv1;
  const [m1, m2] = Object.values(eur.hashes["ft:u:masha:m:2026-10"]);
  assert.equal(v.base, Math.round((3000 / R) * 100) / 100);
  assert.equal(m1.base, 20); // запись Маши в EUR — точная
  assert.equal(m2.base, Math.round((5860 / R) * 100) / 100);
  assert.equal(eur.userSettings.vlad.personalCategories[0].limit, 100); // 12000/117.2 = 102.4 → шаг 10
  assert.equal(eur.userSettings.masha.personalCategories[0].limit, 80);
  // Версии не трогаются — их поднимает запись
  assert.equal(eur.userSettings.vlad.version, 2);
  assert.equal(eur.settings.version, 3);
});

test("туда и обратно с тем же R возвращает исходные суммы", () => {
  const back = rebaseStore(rebaseStore(raw, toEUR, "2026-10-20"), toRSD, "2026-10-21");
  assert.equal(back.settings.base, "RSD");
  const [e1, e2, e3] = Object.values(back.hashes["ft:m:2026-10"]);
  const [o1, o2, o3] = Object.values(raw.hashes["ft:m:2026-10"]);
  assert.equal(e1.base, 1200); // запись в RSD снова точная
  near(e2.base, o2.base);
  near(e3.base, o3.base);
  near(back.hashes["ft:i:2026-10"].i1.base, raw.hashes["ft:i:2026-10"].i1.base);
  near(back.hashes["ft:u:masha:m:2026-10"].pm1.base, raw.hashes["ft:u:masha:m:2026-10"].pm1.base);
  near(back.settings.rates.EUR, R, 1e-9);
  near(back.settings.rates.USD, 100.5, 1e-9);
  // Копилки округляются до копеек на каждом шаге — погрешность в пределах R * 0.005
  near(back.goals.items[0].target, 150000, R * 0.005);
  near(back.goals.items[0].ops[0].amount, 60000, R * 0.005);
  // Лимиты — до шага округления: 40000 → 340 EUR → 39848 RSD
  near(back.settings.familyCategories[0].limit, 40000, (10 / 2) * R);
  assert.equal(back.settings.baseHistory.length, 2);
});
