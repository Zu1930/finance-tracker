/**
 * Маленький Markdown для статей помощи (content/help/*.md), без зависимостей: заголовки #–###, абзацы, списки
 * (- и 1.), `код`, [ссылки](/путь), **жирный**. Разметка не исполняется: на выходе дерево, React рисует его сам.
 * Блоки <!-- family -->…<!-- /family --> видит только семья. Тесты — lib/markdown.test.mjs
 */

export type Inline = { t: "text" | "code" | "bold"; v: string } | { t: "link"; v: string; href: string };
export type Block =
  | { t: "h"; level: 1 | 2 | 3; text: Inline[] }
  | { t: "p"; text: Inline[] }
  | { t: "ul" | "ol"; items: Inline[][] };

/** Без семейных блоков для solo; для семьи — только убрать сами метки */
export const forAudience = (md: string, solo: boolean) =>
  solo ? md.replace(/<!--\s*family\s*-->[\s\S]*?<!--\s*\/family\s*-->/g, "") : md.replace(/<!--\s*\/?family\s*-->/g, "");

/** Ссылка только на свой путь или http(s): javascript: и прочее становится текстом */
const safeHref = (h: string) => (/^\/(?!\/)/.test(h) || /^https?:\/\//.test(h) ? h : null);

export function inline(s: string): Inline[] {
  const out: Inline[] = [];
  const re = /`([^`]+)`|\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  for (let m = re.exec(s); m; m = re.exec(s)) {
    if (m.index > last) out.push({ t: "text", v: s.slice(last, m.index) });
    if (m[1] !== undefined) out.push({ t: "code", v: m[1] });
    else if (m[2] !== undefined) out.push({ t: "bold", v: m[2] });
    else {
      const href = safeHref(m[4]);
      out.push(href ? { t: "link", v: m[3], href } : { t: "text", v: m[3] });
    }
    last = re.lastIndex;
  }
  if (last < s.length) out.push({ t: "text", v: s.slice(last) });
  return out;
}

export function parseMarkdown(md: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: { t: "ul" | "ol"; items: string[] } | null = null;
  const flush = () => {
    if (para.length) blocks.push({ t: "p", text: inline(para.join(" ")) });
    if (list) blocks.push({ t: list.t, items: list.items.map(inline) });
    para = [];
    list = null;
  };
  for (const raw of md.replace(/<!--[\s\S]*?-->/g, "").split("\n")) {
    const line = raw.trim();
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    const li = /^(?:([-*])|\d+[.)])\s+(.*)$/.exec(line);
    if (!line) flush();
    else if (h) {
      flush();
      blocks.push({ t: "h", level: h[1].length as 1 | 2 | 3, text: inline(h[2]) });
    } else if (li) {
      const t = li[1] ? "ul" : "ol";
      if (para.length || (list && list.t !== t)) flush();
      list ??= { t, items: [] };
      list.items.push(li[2]);
    } else if (list && /^\s/.test(raw)) list.items[list.items.length - 1] += ` ${line}`;
    else {
      if (list) flush();
      para.push(line);
    }
  }
  flush();
  return blocks;
}
