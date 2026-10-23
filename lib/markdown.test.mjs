// Markdown статей помощи: блоки, разметка в строке, безопасные ссылки, семейные блоки. Запуск: npm run test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { forAudience, inline, parseMarkdown } from "./markdown.ts";
import { ARTICLES } from "./help.ts";

test("заголовки, абзацы из нескольких строк, списки обоих видов", () => {
  assert.deepEqual(parseMarkdown("# Заголовок\n\nпервая\nвторая\n\n- раз\n- два\n\n1. один\n2) два\n### Мелкий"), [
    { t: "h", level: 1, text: [{ t: "text", v: "Заголовок" }] },
    { t: "p", text: [{ t: "text", v: "первая вторая" }] },
    { t: "ul", items: [[{ t: "text", v: "раз" }], [{ t: "text", v: "два" }]] },
    { t: "ol", items: [[{ t: "text", v: "один" }], [{ t: "text", v: "два" }]] },
    { t: "h", level: 3, text: [{ t: "text", v: "Мелкий" }] },
  ]);
});

test("в строке: код, жирный, ссылки; javascript: — просто текст", () => {
  assert.deepEqual(inline("Суммы `450+120` и **жирно** [тут](/help/entry) [x](javascript:alert) [ext](https://example.com)"), [
    { t: "text", v: "Суммы " }, { t: "code", v: "450+120" }, { t: "text", v: " и " }, { t: "bold", v: "жирно" }, { t: "text", v: " " },
    { t: "link", v: "тут", href: "/help/entry" }, { t: "text", v: " " }, { t: "text", v: "x" }, { t: "text", v: " " },
    { t: "link", v: "ext", href: "https://example.com" },
  ]);
  assert.deepEqual(inline("[чужой](//evil.example)"), [{ t: "text", v: "чужой" }]);
});

test("семейные блоки: solo не видит, семья видит без меток", () => {
  const md = "Общее\n\n<!-- family -->\nСемейное\n<!-- /family -->\n\nЕщё";
  assert.equal(JSON.stringify(parseMarkdown(forAudience(md, true))).includes("Семейное"), false);
  assert.equal(JSON.stringify(parseMarkdown(forAudience(md, false))).includes("Семейное"), true);
  assert.equal(forAudience(md, false).includes("<!--"), false);
});

test("у каждой статьи есть файл с заголовком", () => {
  for (const a of ARTICLES) {
    const md = readFileSync(new URL(`../content/help/${a.id}.md`, import.meta.url), "utf8");
    assert.equal(parseMarkdown(md)[0].t, "h", a.id);
  }
});
