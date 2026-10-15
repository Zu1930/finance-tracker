// Тесты пользователей и сессий. Запуск: npm run test
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseUsers } from "./users.ts";
import { signSession, verifySession } from "./session.ts";

const SECRET = "test-secret";
const passwords = { vlad: "pw-vlad", masha: "pw-masha" };
const creds = (pw) => (id) => (pw[id] ? { secret: SECRET, password: pw[id] } : null);

test("USERS: ровно двое, имена и id", () => {
  assert.deepEqual(parseUsers("vlad:Влад, masha:Маша"), [{ id: "vlad", name: "Влад" }, { id: "masha", name: "Маша" }]);
  assert.throws(() => parseUsers("vlad:Влад"), /ровно двух/);
  assert.throws(() => parseUsers("a:A,b:B,c:C"), /ровно двух/);
  assert.throws(() => parseUsers(undefined), /ровно двух/);
  assert.throws(() => parseUsers("vlad:Влад,vlad:Ещё"), /повторяется/);
  assert.throws(() => parseUsers("vl.ad:Влад,masha:Маша"), /неверный id/);
});

test("подпись верна для своего пользователя", async () => {
  const cookie = await signSession("vlad", { secret: SECRET, password: passwords.vlad });
  assert.match(cookie, /^vlad\.[0-9a-f]{64}$/);
  assert.deepEqual(await verifySession(cookie, creds(passwords)), { userId: "vlad" });
});

test("подмена userId в cookie не проходит", async () => {
  const cookie = await signSession("vlad", { secret: SECRET, password: passwords.vlad });
  const forged = "masha" + cookie.slice(cookie.indexOf("."));
  assert.equal(await verifySession(forged, creds(passwords)), null);
  assert.equal(await verifySession("nobody" + cookie.slice(4), creds(passwords)), null);
  assert.equal(await verifySession("garbage", creds(passwords)), null);
  assert.equal(await verifySession("", creds(passwords)), null);
});

test("после смены пароля старая cookie не проходит, а у партнёра — проходит", async () => {
  const vlad = await signSession("vlad", { secret: SECRET, password: passwords.vlad });
  const masha = await signSession("masha", { secret: SECRET, password: passwords.masha });
  const changed = { ...passwords, vlad: "new-pw" };
  assert.equal(await verifySession(vlad, creds(changed)), null);
  assert.deepEqual(await verifySession(masha, creds(changed)), { userId: "masha" });
});
