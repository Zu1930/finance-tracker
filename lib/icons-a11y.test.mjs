// Иконки: у кнопки или ссылки только с иконкой должно быть имя — label у <Icon>. Статический разбор исходников .tsx.
// Плюс: символы ◆ ◇ ∑ ↻ ● ⌫ ⚙ в разметке больше не используются (в тостах и строках данных — можно). Запуск: npm run test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const files = (dir) => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? files(p) : p.endsWith(".tsx") ? [p] : [];
});
const sources = [...files(join(root, "components")), ...files(join(root, "app"))].map((p) => ({ path: relative(root, p), src: readFileSync(p, "utf8") }));

/** Конец открывающего тега: первый «>» вне {…} */
function tagEnd(src, from) {
  let depth = 0;
  for (let i = from; i < src.length; i++) {
    const c = src[i];
    if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === ">" && depth === 0) return i;
  }
  return -1;
}

/** Кнопки и ссылки, внутри которых есть <Icon> без label и нет другого видимого текста */
export function unlabeled(src) {
  const out = [];
  const re = /<(button|a|Link)\b/g;
  let m;
  while ((m = re.exec(src))) {
    const tag = m[1];
    const open = tagEnd(src, m.index);
    if (open < 0 || src[open - 1] === "/") continue;
    const close = src.indexOf(`</${tag}>`, open);
    if (close < 0) continue;
    const inner = src.slice(open + 1, close);
    const icons = inner.match(/<Icon\b[\s\S]*?\/>/g) ?? [];
    if (!icons.length) continue;
    const rest = inner
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
      .replace(/<Icon\b[\s\S]*?\/>/g, "")
      .replace(/<\/?[A-Za-z][^>]*>/g, "")
      .trim();
    if (!rest && icons.every((i) => !/\blabel=/.test(i))) out.push(src.slice(0, m.index).split("\n").length);
  }
  return out;
}

test("разбор: находит иконку без подписи и пропускает подписанные", () => {
  assert.deepEqual(unlabeled(`<button onClick={() => go()}>\n<Icon name="close" />\n</button>`), [1]);
  assert.deepEqual(unlabeled(`<button><Icon name="close" label={t("action.close")} /></button>`), []);
  assert.deepEqual(unlabeled(`<Link href="/">\n<Icon name="feed" />\n{t("nav.feed")}\n</Link>`), []);
  assert.deepEqual(unlabeled(`<a href="/"><span><Icon name="help" /></span></a>`), [1]);
});

test("в интерфейсе нет кнопок и ссылок с иконкой без имени", () => {
  const bad = sources.flatMap(({ path, src }) => unlabeled(src).map((line) => `${path}:${line}`));
  assert.deepEqual(bad, []);
});

test("символы ◆ ◇ ∑ ↻ ● ⌫ ⚙ — не в разметке (только тосты, строки данных и комментарии)", () => {
  const bad = [];
  for (const { path, src } of sources) {
    src.split("\n").forEach((line, i) => {
      // Комментарии: строка с // или * в начале, /* … */; « // » внутри JSX — это текст, его не трогаем
      const code = line.replace(/\/\*.*?\*\//g, "").replace(/^\s*(\/\/|\*).*$/, "").replace(/\s\/\/ [^'"`]*$/, (m) => (/[<>{}]/.test(m) ? m : ""));
      if (!/[◆◇∑↻●⌫⚙]/.test(code)) return;
      // Тосты — текст, его можно скопировать: там символы бюджета остаются
      if (/toast\(/.test(code)) return;
      bad.push(`${path}:${i + 1}: ${line.trim().slice(0, 80)}`);
    });
  }
  assert.deepEqual(bad, []);
});
