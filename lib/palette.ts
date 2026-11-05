/**
 * Палитра команд (⌘/Ctrl + K): поиск по словам и выбор стрелками. Сами команды собирает components/CommandPalette.tsx.
 * Тесты — lib/palette.test.mjs
 */
export type Cmd = { id: string; group: string; label: string; keys?: string; run: () => void };

/** Сколько результатов показывать */
export const LIMIT = 7;
const norm = (s: string) => s.toLowerCase().replace(/ё/g, "е");

/** Каждое слово запроса — в названии или группе; пустой запрос — первые LIMIT команд по порядку */
export function filterCmds(cmds: Cmd[], q: string, limit = LIMIT): Cmd[] {
  const words = norm(q).split(/\s+/).filter(Boolean);
  const hay = (c: Cmd) => norm(`${c.group} ${c.label}`);
  const found = words.length ? cmds.filter((c) => words.every((w) => hay(c).includes(w))) : cmds;
  // Совпадение с началом названия — выше
  const first = words[0];
  const ranked = first ? [...found].sort((a, b) => Number(!norm(a.label).startsWith(first)) - Number(!norm(b.label).startsWith(first))) : found;
  return ranked.slice(0, limit);
}

/** ↑ / ↓ по кругу; пустой список — 0 */
export const step = (i: number, delta: number, n: number) => (n ? (i + delta + n) % n : 0);
