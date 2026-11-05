// Ширина шкалы из символов никогда не больше контейнера и не больше 60 символов. Запуск: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { BAR_MAX, barCells } from "./ascii.ts";

test("шкала помещается в контейнер при любой ширине и любом шрифте", () => {
  // Ширина «█»: 8.4 (14px моно), 13.3 (запасной шрифт), 16.2 (17px запасной)
  for (const charW of [8.4, 13.3, 16.2])
    for (let w = 0; w <= 2600; w += 7) {
      const n = barCells(w, charW);
      assert.ok(n * charW <= w, `${n} × ${charW} > ${w}`);
      assert.ok(n <= BAR_MAX);
      // и не короче, чем можно: ещё один символ уже не влез бы (если не упёрлись в 60)
      if (n < BAR_MAX) assert.ok((n + 1) * charW > w, `в ${w}px влезло бы ${n + 1}`);
    }
});

test("до замера — 24; контейнера нет — 0; потолок 60", () => {
  assert.equal(barCells(300, 0), 24);
  assert.equal(barCells(0, 9), 0);
  assert.equal(barCells(5000, 9), 60);
  assert.equal(barCells(5000, 9, 30), 30);
});
