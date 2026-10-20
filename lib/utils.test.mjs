// Форматирование сумм: без «-0». Запуск: npm run test
import { test } from "node:test";
import assert from "node:assert/strict";
import { fmt, minus, signed } from "./utils.ts";
import { fmtChange, fmtPct } from "./metrics.ts";

test("ноль после округления — «0» без знака", () => {
  for (const z of [0, -0, -0.001, 0.004, -0.0049]) assert.equal(fmt(z), "0");
  assert.equal(signed(-0.004), "0");
  assert.equal(signed(-0), "0");
  assert.equal(minus(0), "0");
  assert.equal(minus(-0.001), "0");
  assert.equal(fmtPct(-0.001), "0%");
  assert.equal(fmtChange(-0.004), "0%");
  // Обычные значения — со знаком
  assert.equal(signed(-1250), "−1 250");
  assert.equal(signed(300), "+300");
  assert.equal(minus(1250.5), "−1 250,5");
  assert.equal(fmtPct(-0.12), "−12%");
});
