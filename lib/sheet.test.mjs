// Форма ввода поверх ленты в истории браузера: «назад» закрывает форму, не уходя со страницы. Запуск: npm run test
import { test } from "node:test";
import assert from "node:assert/strict";
import { closeSheet, isSheetOpen, openSheet, sheetUrl } from "./sheet.ts";

/** История браузера в памяти: стек адресов, back — на шаг назад */
function fakeWindow(start) {
  const stack = [start];
  let i = 0;
  const w = {
    location: { get href() { return stack[i]; } },
    history: {
      pushState: (_s, _t, url) => { stack.splice(i + 1); stack.push(new URL(url, stack[i]).href); i++; },
      replaceState: (_s, _t, url) => { stack[i] = new URL(url, stack[i]).href; },
      back: () => { if (i > 0) i--; },
    },
    stack,
  };
  return w;
}

test("открытие добавляет ?new=1, «назад» закрывает форму и остаётся на той же странице", () => {
  const w = fakeWindow("https://x.test/limits?month=2026-11");
  assert.equal(openSheet(w), true);
  assert.equal(isSheetOpen(w.location.href), true);
  assert.equal(w.location.href, "https://x.test/limits?month=2026-11&new=1");
  w.history.back(); // жест «назад»
  assert.equal(isSheetOpen(w.location.href), false);
  assert.equal(w.location.href, "https://x.test/limits?month=2026-11");
});

test("× закрывает через шаг назад — повторное «назад» уходит туда же, куда ушло бы без формы", () => {
  const w = fakeWindow("https://x.test/");
  w.history.pushState(null, "", "/chart");
  const pushed = openSheet(w);
  closeSheet(w, pushed);
  assert.equal(w.location.href, "https://x.test/chart");
  w.history.back();
  assert.equal(w.location.href, "https://x.test/");
});

test("повторное открытие не плодит записи; после перезагрузки с ?new=1 закрытие заменяет адрес", () => {
  const w = fakeWindow("https://x.test/?new=1");
  assert.equal(openSheet(w), false);
  closeSheet(w, false);
  assert.equal(w.location.href, "https://x.test/");
  assert.equal(w.stack.length, 1);
  closeSheet(w, false);
  assert.equal(w.location.href, "https://x.test/", "уже закрыта — ничего");
  assert.equal(sheetUrl("https://x.test/a?b=1#h", true), "/a?b=1&new=1#h");
});

test("мастер плана — своя запись ?plan=1: «назад» закрывает мастер, форма ввода не задета", () => {
  const w = fakeWindow("https://x.test/limits");
  assert.equal(openSheet(w, "plan"), true);
  assert.equal(w.location.href, "https://x.test/limits?plan=1");
  assert.equal(isSheetOpen(w.location.href), false, "это не форма ввода");
  assert.equal(isSheetOpen(w.location.href, "plan"), true);
  w.history.back();
  assert.equal(isSheetOpen(w.location.href, "plan"), false);
  assert.equal(w.location.href, "https://x.test/limits");
  // Перезагрузка с ?plan=1: закрытие заменяет адрес
  const r = fakeWindow("https://x.test/limits?plan=1");
  assert.equal(openSheet(r, "plan"), false);
  closeSheet(r, false, "plan");
  assert.equal(r.location.href, "https://x.test/limits");
  assert.equal(r.stack.length, 1);
});
