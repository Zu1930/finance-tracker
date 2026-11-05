// Палитра команд: поиск, лимит результатов, стрелки по кругу. Запуск: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { filterCmds, step } from "./palette.ts";

const c = (id, group, label) => ({ id, group, label, run: () => {} });
const cmds = [
  c("go-entry", "Перейти", "Ввод"), c("go-limits", "Перейти", "Лимиты"), c("go-money", "Перейти", "Деньги"), c("go-sum", "Перейти", "Итоги"),
  c("sp-family", "Бюджет", "Семья"), c("sp-personal", "Бюджет", "Личное"), c("sp-all", "Бюджет", "Всё вместе"),
  c("write", "Записать", "Трату"), c("plan", "План", "Декабрь"), c("set-cur", "Настройки", "Валюты"),
];

test("пустой запрос — первые 7 по порядку", () => {
  assert.deepEqual(filterCmds(cmds, "").map((x) => x.id), cmds.slice(0, 7).map((x) => x.id));
});

test("все слова запроса — в группе или названии, без учёта регистра и ё", () => {
  assert.deepEqual(filterCmds(cmds, "бюджет лич").map((x) => x.id), ["sp-personal"]);
  assert.deepEqual(filterCmds(cmds, "ВСЕ").map((x) => x.id), ["sp-all"]);
  assert.deepEqual(filterCmds(cmds, "перейти").length, 4);
  assert.deepEqual(filterCmds(cmds, "нет такого"), []);
});

test("совпадение с началом названия — выше", () => {
  assert.deepEqual(filterCmds(cmds, "д").slice(0, 2).map((x) => x.id), ["go-money", "plan"]);
});

test("стрелки по кругу", () => {
  assert.equal(step(0, -1, 5), 4);
  assert.equal(step(4, 1, 5), 0);
  assert.equal(step(2, 1, 5), 3);
  assert.equal(step(0, 1, 0), 0);
});
