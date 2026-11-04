// Своя клавиатура суммы на телефоне. Запуск: npm run test
import { test } from "node:test";
import assert from "node:assert/strict";
import { evalExpr, hasOp, press, toAmount } from "./keypad.ts";
import { parseAmount } from "./utils.ts";

const type = (keys, from = "") => [...keys].reduce((e, k) => press(e, k), from);
const typeList = (keys, from = "") => keys.reduce((e, k) => press(e, k), from);

test("выражение 450+120−50: значение, «= итог», строка для формы", () => {
  const e = type("450+120−50");
  assert.equal(e, "450+120−50");
  assert.equal(evalExpr(e), 520);
  assert.equal(hasOp(e), true);
  assert.equal(toAmount(e), "450+120-50");
  assert.equal(parseAmount(toAmount(e)), 520);
  assert.equal(press(e, "="), "520");
  assert.equal(hasOp("450"), false);
  assert.equal(hasOp("450+"), false, "знак в конце — ещё нет действия");
});

test("знаки: не в начале, повторный заменяет, знак в конце не считается", () => {
  assert.equal(press("", "+"), "");
  assert.equal(press("", "−"), "");
  assert.equal(type("5+−"), "5−");
  assert.equal(evalExpr("5+"), 5);
  assert.equal(toAmount("5+"), "5");
});

test("запятая: одна на число, «0,» в начале числа, не больше 2 знаков", () => {
  assert.equal(type(","), "0,");
  assert.equal(type("12,,5"), "12,5");
  assert.equal(type("1,5+,"), "1,5+0,");
  assert.equal(type("1,234"), "1,23");
  assert.equal(evalExpr("1,5+0,25"), 1.75);
  assert.equal(press("7,5", "="), "7,5");
});

test("00: в начале — один ноль, после запятой — до 2 знаков, ведущий ноль заменяется цифрой", () => {
  assert.equal(typeList(["00"]), "0");
  assert.equal(typeList(["00", "00"]), "0");
  assert.equal(typeList(["3", "00"]), "300");
  assert.equal(typeList(["3", ",", "5", "00"]), "3,50");
  assert.equal(typeList(["3", ",", "00"]), "3,00");
  assert.equal(typeList(["3", ",", "00", "00"]), "3,00");
  assert.equal(type("05"), "5");
  assert.equal(typeList(["1", "+", "00", "7"]), "1+7");
});

test("⌫ стирает символ, долгое нажатие — всё", () => {
  assert.equal(press("450+", "⌫"), "450");
  assert.equal(press("", "⌫"), "");
  assert.equal(press("450+120", "clear"), "");
});

test("= на пустом и отрицательный итог", () => {
  assert.equal(press("", "="), "");
  assert.equal(press("50−120", "="), "−70");
  assert.ok(Number.isNaN(parseAmount(toAmount("−70"))), "форма не примет отрицательную сумму");
});
