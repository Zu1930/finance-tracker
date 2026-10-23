/** Разделы настроек и короткие подписи состояния для меню (справа от названия) */
import type { TrackerData } from "./types.ts";

export const SECTIONS = ["family", "currency", "input", "device", "data", "account", "beta"] as const;
export type Section = (typeof SECTIONS)[number];
export const isSection = (s: string): s is Section => (SECTIONS as readonly string[]).includes(s);

/** Группы меню: подпись группы и пункты; beta — только админу */
export const GROUPS: { label: string; items: { id: Section; title: string }[] }[] = [
  { label: "Бюджет", items: [{ id: "family", title: "Семья" }, { id: "currency", title: "Валюты" }] },
  { label: "Ввод", items: [{ id: "input", title: "Голос и Siri" }] },
  { label: "Устройство", items: [{ id: "device", title: "Это устройство" }] },
  { label: "Данные", items: [{ id: "data", title: "Данные" }] },
  { label: "Аккаунт", items: [{ id: "account", title: "Аккаунт" }] },
  { label: "Админ", items: [{ id: "beta", title: "Бета" }] },
];
export const TITLES = Object.fromEntries(GROUPS.flatMap((g) => g.items.map((i) => [i.id, i.title]))) as Record<Section, string>;

/** 1 токен, 2 токена, 5 токенов */
export function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10, m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
}

/** То, чего нет в /api/data: из /api/family, /api/quick/tokens, /api/archive, /api/admin/signup-codes и браузера; null — ещё не известно */
export type MetaInput = {
  members: number | null;
  tokens: number | null;
  archives: number | null;
  activeCodes: number | null;
  theme: "auto" | "dark" | "light";
  notifications: boolean | null;
};

export function settingsMeta(data: TrackerData, x: MetaInput): Record<Section, string> {
  const st = data.settings;
  const mine = data.mySettings.preferredCurrency;
  const n = (v: number | null, f: (v: number) => string) => (v === null ? "…" : f(v));
  return {
    family: data.solo ? "Только вы" : n(x.members, (m) => (m <= 1 ? "Только вы" : `${m} ${plural(m, "участник", "участника", "участников")}`)),
    currency: st ? `${st.base}${mine && mine !== st.base && st.currencies.includes(mine) ? ` · моя ${mine}` : ""}` : "—",
    input: `строка ${data.mySettings.hideQuickEntry ? "скрыта" : "видна"} · ${n(x.tokens, (t) => `${t} ${plural(t, "токен", "токена", "токенов")}`)}`,
    device: `${x.theme} · увед. ${x.notifications === null ? "…" : x.notifications ? "вкл" : "выкл"}`,
    data: n(x.archives, (a) => (a ? `${a} ${plural(a, "архив", "архива", "архивов")}` : "архивов нет")),
    account: data.me.name,
    beta: n(x.activeCodes, (c) => `${c} ${plural(c, "активный код", "активных кода", "активных кодов")}`),
  };
}
