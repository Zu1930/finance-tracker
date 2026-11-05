// Доходы личные: мастер плана (сумма средних по участникам), риски «Итогов», порядок участников. Запуск: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildView } from "./store.ts";
import { spaceData } from "./space.ts";
import { average, familyMembers, incomeByMember, monthIncome } from "./metrics.ts";
import { wizardInput } from "./plan-view.ts";
import { bars } from "./summary.ts";

const settings = { base: "RSD", currencies: ["RSD"], rates: {}, schemaVersion: 3, familyCategories: [{ id: "food", name: "Еда", limit: 1000 }], version: 1 };
const inc = (id, date, base, authorId) => ({ id, amount: base, currency: "RSD", rate: 1, base, sourceId: "salary", note: "", date, ts: 1, authorId });
const byId = (...l) => Object.fromEntries(l.map((x) => [x.id, x]));
// Три завершённых месяца до ноября: Влад 300/300/300, Маша 100/200/0
const raw = {
  settings, goals: null, userSettings: {},
  hashes: {
    "ft:i:2026-08": byId(inc("a", "2026-08-05", 300, "vlad"), inc("b", "2026-08-06", 100, "masha")),
    "ft:i:2026-09": byId(inc("c", "2026-09-05", 300, "vlad"), inc("d", "2026-09-06", 200, "masha")),
    "ft:i:2026-10": byId(inc("e", "2026-10-05", 300, "vlad")),
    "ft:i:2026-11": byId(inc("f", "2026-11-02", 50, "vlad"), inc("g", "2026-11-03", 70, "masha")),
  },
};
const vlad = { id: "vlad", name: "Влад" }, masha = { id: "masha", name: "Маша" };
const today = "2026-11-05";

test("мастер плана: подставлена сумма средних по участникам — как раньше среднее семьи; в ◇ шага дохода нет", () => {
  const d = buildView(raw, vlad, masha, "2026-11");
  const w = wizardInput(d, "family", false, "2026-11", today);
  assert.equal(w.average, 400, "(400 + 500 + 300) / 3");
  assert.deepEqual(w.averageBy, { vlad: 300, masha: 100 });
  assert.equal(w.averageBy.vlad + w.averageBy.masha, w.average);
  // У Маши — то же самое: средние не зависят от того, кто смотрит
  assert.deepEqual(wizardInput(buildView(raw, masha, vlad, "2026-11"), "family", false, "2026-11", today).averageBy, { vlad: 300, masha: 100 });
  const mine = wizardInput(d, "personal", false, "2026-11", today);
  assert.deepEqual([mine.withIncome, mine.average, mine.averageBy], [false, null, null]);
  // ◇: доход — только мой
  const avgMine = average(spaceData(d, "personal"), today);
  assert.deepEqual([avgMine.income, avgMine.incomeBy], [300, { vlad: 300 }]);
});

test("Итоги «По месяцам»: доход семьи в ◆ и ∑, мой — в ◇; суммы как до изменения", () => {
  const d = buildView(raw, vlad, masha, "2026-11");
  const inc = (sp) => bars(spaceData(d, sp), today, 4).map((b) => b.income);
  assert.deepEqual(inc("family"), [400, 500, 300, 120]);
  assert.deepEqual(inc("all"), [400, 500, 300, 120]);
  assert.deepEqual(inc("personal"), [300, 300, 300, 50]);
  // Сравнение 1–N дней: Маша получила 3-го — по 2-е число её дохода нет
  assert.equal(monthIncome(d, "2026-11", 2), 50);
  assert.equal(monthIncome(d, "2026-11", 3), 120);
});

test("строка «Доходы за месяц»: участники по порядку вступления, у кого 0 — 0", () => {
  const d = buildView(raw, masha, vlad, "2026-11");
  d.memberIds = ["vlad", "masha"];
  assert.deepEqual(familyMembers(d).map((u) => u.name), ["Влад", "Маша"], "Маша видит Влада первым — он вступил раньше");
  assert.deepEqual(incomeByMember(d, "2026-10"), { vlad: 300, masha: 0 });
  assert.deepEqual(incomeByMember(d, "2026-11"), { vlad: 50, masha: 70 });
});
