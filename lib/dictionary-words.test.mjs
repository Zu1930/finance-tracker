// Словарь: старых формулировок («Сверка», «Копилки», «График», «на жизнь», «Остаток по лимитам», «Сбережения»)
// нет в текстах интерфейса — компонентах, страницах, ответах API, справке и словаре. В коде и комментариях — можно
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { ru } from "./i18n.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const files = (dir, ext) => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? files(p, ext) : ext.some((e) => p.endsWith(e)) ? [p] : [];
});
// Доходы личные: нет «доход семьи», «семейный доход», «доходы видят все» и подсказки «+» в семейной форме
const OLD = /[Сс]верк|СВЕРК|[Кк]опилк|КОПИЛК|[Гг]рафик|ГРАФИК|[Нн]а жизнь|НА ЖИЗНЬ|[Оо]статок по лимитам|Сбережени|СБЕРЕЖЕН|[Дд]оход[а-я]* семьи|[Сс]емейн[а-я]* доход|доходы видят|Начните с «\+»/;
// Строка без комментариев: // в начале, * в блоке, /* … */ и {/* … */}
const code = (line) => line.replace(/\{?\/\*.*?\*\/\}?/g, "").replace(/^\s*(\/\/|\*|\/\*\*).*$/, "").replace(/(^|\s)\/\/ .*$/, (m) => (/[<>{}'"`]/.test(m) ? m : ""));

test("старых формулировок нет в интерфейсе", () => {
  const bad = [];
  const sources = [
    ...files(join(root, "components"), [".tsx", ".ts"]),
    ...files(join(root, "app"), [".tsx", ".ts"]),
    join(root, "lib/help.ts"), join(root, "lib/onboarding.ts"), join(root, "lib/onboarding-server.ts"),
  ];
  for (const p of sources) {
    readFileSync(p, "utf8").split("\n").forEach((line, i) => {
      if (OLD.test(code(line))) bad.push(`${relative(root, p)}:${i + 1}: ${line.trim().slice(0, 100)}`);
    });
  }
  for (const p of files(join(root, "content"), [".md"])) {
    readFileSync(p, "utf8").split("\n").forEach((line, i) => OLD.test(line) && bad.push(`${relative(root, p)}:${i + 1}: ${line.trim().slice(0, 100)}`));
  }
  for (const [k, v] of Object.entries(ru)) if (OLD.test(v)) bad.push(`i18n ${k}: ${v}`);
  assert.deepEqual(bad, []);
});

test("единые термины: «Можно потратить», «Текущие траты», «Обновить остатки», «Цели», «Итоги»", () => {
  assert.equal(ru["budget.canSpend"], "Можно потратить");
  assert.equal(ru["budget.currentSpending"], "Текущие траты");
  assert.equal(ru["plan.living"], "На текущие траты");
  assert.equal(ru["money.update"], "Обновить остатки");
  assert.equal(ru["money.goals"], "Цели");
  assert.equal(ru["money.onGoals"], "На цели");
  assert.equal(ru["money.free"], "Свободно");
  assert.equal(ru["nav.summary"], "Итоги");
});
