// Правила пушей: дата в часовом поясе, план в конце месяца, воскресное напоминание, обновление. Запуск: npm run test
import { test } from "node:test";
import assert from "node:assert/strict";
import { localDate, planReminder, updateMessage, weeklyReminder } from "./push.ts";

test("локальная дата: полночь в Белграде — уже следующий день", () => {
  assert.deepEqual(localDate(new Date("2026-10-31T23:30:00Z"), "Europe/Belgrade"), { date: "2026-11-01", month: "2026-11", day: 1, weekday: 0, lastDay: 30, hour: 0 });
  assert.equal(localDate(new Date("2026-02-10T12:00:00Z"), "Europe/Belgrade").lastDay, 28);
  assert.equal(localDate(new Date("2026-07-10T17:05:00Z"), "Europe/Belgrade").hour, 19); // летом UTC+2
  assert.equal(localDate(new Date("2026-01-10T17:05:00Z"), "Europe/Belgrade").hour, 18);
  assert.equal(localDate(new Date("2026-01-10T23:05:00Z"), "Europe/Belgrade").hour, 0); // не «24»
});

test("план — за 2 дня до конца месяца и только если плана ещё нет", () => {
  assert.equal(planReminder({ day: 28, lastDay: 31 }, "2026-11", false), null);
  const r = planReminder({ day: 29, lastDay: 31 }, "2026-11", false);
  assert.deepEqual(r, { title: "Пора спланировать ноябрь", body: "Доход, лимиты и покупки на месяц", url: "/limits?month=2026-11", tag: "plan-2026-11" });
  assert.equal(planReminder({ day: 29, lastDay: 31 }, "2026-11", true), null);
  assert.ok(planReminder({ day: 26, lastDay: 28 }, "2027-03", false)); // февраль
});

test("план — за выбранное число дней", () => {
  assert.ok(planReminder({ day: 30, lastDay: 31 }, "2026-11", false, 1));
  assert.equal(planReminder({ day: 29, lastDay: 31 }, "2026-11", false, 1), null);
  assert.ok(planReminder({ day: 26, lastDay: 31 }, "2026-11", false, 5));
});

test("траты — в выбранный день недели", () => {
  assert.equal(weeklyReminder(0, 3, "2026-10-26", 1), null);
  assert.ok(weeklyReminder(1, 3, "2026-10-26", 1));
});

test("воскресенье — напоминание о вводе, текст по числу записей", () => {
  assert.equal(weeklyReminder(1, 0, "2026-10-25"), null);
  assert.equal(weeklyReminder(0, 0, "2026-10-25").body, "За неделю ни одной записи");
  assert.equal(weeklyReminder(0, 12, "2026-10-25").body, "За неделю записей: 12. Всё ли внесено?");
});

test("обновление: только при смене версии, первая установка без пуша", () => {
  assert.equal(updateMessage(null, "abc1234567"), null);
  assert.equal(updateMessage("abc1234567", "abc1234567"), null);
  assert.deepEqual(updateMessage("old", "def4567890", "Планировщик бюджета\n\nподробности"), { title: "Новая версия", body: "Планировщик бюджета", url: "/", tag: "update-def4567" });
});
