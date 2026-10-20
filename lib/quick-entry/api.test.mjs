// /api/quick: токены, лимит, разбор без записи, запись от владельца токена. Запуск: npm run test
import { test } from "node:test";
import assert from "node:assert/strict";
import { RATE_LIMIT_PER_MIN, handleQuick, hashToken, newToken, tokenUser } from "./api.ts";

const settings = {
  base: "RSD", currencies: ["RSD"], rates: {}, version: 1,
  familyCategories: [{ id: "cafe", name: "Кафе", limit: 1 }, { id: "transport", name: "Транспорт", limit: 1 }],
};

/** Хранилище в памяти: токены по пользователям, счётчик запросов, записанные траты */
async function fakeStore() {
  const token = newToken("vlad_2");
  const tokens = { vlad_2: { t1: { name: "iPhone", hash: await hashToken(token), createdAt: "2026-10-01T00:00:00Z", lastUsedAt: null } } };
  const hits = {};
  const written = [];
  const store = {
    tokens: async (u) => tokens[u] ?? {},
    touch: async (u, id, rec) => void (tokens[u][id] = rec),
    hit: async (id) => (hits[id] = (hits[id] ?? 0) + 1),
    context: async () => ({ settings, personalCategories: [{ id: "hobby", name: "Хобби", limit: 1 }], expenses: [] }),
    write: async (userId, e) => void written.push({ userId, e }),
  };
  return { token, tokens, written, store };
}
const call = (s, auth, body) => handleQuick(auth, body, s.store, "2026-10-20", new Date("2026-10-20T10:00:00Z"));

test("формат токена: userId с «_» восстанавливается", () => {
  const t = newToken("vlad_2");
  assert.match(t, /^sl_vlad_2_[A-Za-z0-9_-]{43}$/);
  assert.equal(tokenUser(t), "vlad_2");
  assert.equal(tokenUser("sl_vlad_short"), null);
});

test("без токена, с чужим или отозванным — 401", async () => {
  const s = await fakeStore();
  const body = { text: "кофе 350", commit: true };
  assert.equal((await call(s, null, body)).status, 401);
  assert.equal((await call(s, "Bearer sl_vlad_2_" + "A".repeat(43), body)).status, 401);
  delete s.tokens.vlad_2.t1;
  assert.equal((await call(s, `Bearer ${s.token}`, body)).status, 401);
  assert.equal(s.written.length, 0);
});

test("commit=false — разбор и вопрос, ничего не пишет; lastUsedAt обновляется", async () => {
  const s = await fakeStore();
  const r = await call(s, `Bearer ${s.token}`, { text: "себе хобби 350 и такси 800", commit: false });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.summary, "−350 RSD ХОББИ (личное), −800 RSD ТРАНСПОРТ (семья). Записать?");
  assert.equal(s.written.length, 0);
  assert.equal(s.tokens.vlad_2.t1.lastUsedAt, "2026-10-20T10:00:00.000Z");
});

test("commit=true с ошибкой ничего не пишет и объясняет", async () => {
  const s = await fakeStore();
  const r = await call(s, `Bearer ${s.token}`, { text: "кофе 350 и такси 20 долларов", commit: true });
  assert.equal(r.body.ok, false);
  assert.equal(r.body.summary, "Валюта доллары не подключена.");
  assert.equal(s.written.length, 0);
  const r2 = await call(s, `Bearer ${s.token}`, { text: "такси", commit: true });
  assert.equal(r2.body.summary, "Не понял сумму в «такси».");
  const r3 = await call(s, `Bearer ${s.token}`, { text: "хрень 500", commit: true });
  assert.equal(r3.body.summary, "Не понял категорию в «хрень 500».");
  assert.equal(s.written.length, 0);
});

test("commit=true пишет от имени владельца токена", async () => {
  const s = await fakeStore();
  const r = await call(s, `Bearer ${s.token}`, { text: "кофе 350 и такси 800", commit: true });
  assert.equal(r.body.ok, true);
  assert.equal(r.body.summary, "Записано: 2 траты, −1 150 RSD");
  assert.deepEqual(s.written.map(({ userId, e }) => [userId, e.authorId, e.catId, e.amount, e.scope, e.date]), [
    ["vlad_2", "vlad_2", "cafe", 350, "family", "2026-10-20"],
    ["vlad_2", "vlad_2", "transport", 800, "family", "2026-10-20"],
  ]);
});

test("больше 30 запросов в минуту — 429", async () => {
  const s = await fakeStore();
  for (let i = 0; i < RATE_LIMIT_PER_MIN; i++) assert.equal((await call(s, `Bearer ${s.token}`, { text: "кофе 1", commit: false })).status, 200);
  assert.equal((await call(s, `Bearer ${s.token}`, { text: "кофе 1", commit: false })).status, 429);
});

test("некорректное тело — 400", async () => {
  const s = await fakeStore();
  assert.equal((await call(s, `Bearer ${s.token}`, { text: 1 })).status, 400);
});
