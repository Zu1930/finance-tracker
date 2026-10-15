import { test } from "node:test";
import assert from "node:assert/strict";
import { invertRates } from "./fx.ts";

test("курсы переворачиваются в «1 C = x base» с 6 значащими цифрами", () => {
  assert.deepEqual(invertRates({ EUR: 0.008515, USD: 0.009532, RSD: 1 }, ["EUR", "USD"]), { EUR: 117.44, USD: 104.91 });
});

test("отсутствующие, нулевые и битые курсы пропускаются", () => {
  assert.deepEqual(invertRates({ EUR: 0, USD: -1, GBP: "x" }, ["EUR", "USD", "GBP", "XYZ"]), {});
});
