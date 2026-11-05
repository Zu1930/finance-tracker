/**
 * Своя клавиатура суммы на телефоне: 1 2 3 + / 4 5 6 − / 7 8 9 ЗАПИСАТЬ / , 0 ⌫ (запись — на две нижние строки).
 * «00» и «=» в раскладке нет, press их по-прежнему понимает.
 * Выражение хранится с «+» и «−»; в форму уходит строка для parseAmount (lib/utils.ts). Тесты — lib/keypad.test.mjs
 */
export const BACKSPACE = "⌫";
export const KEYS = ["1", "2", "3", "+", "4", "5", "6", "−", "7", "8", "9", ",", "0", BACKSPACE] as const;
export type Key = (typeof KEYS)[number] | "00" | "=" | "clear";

const MAX = 24;
const OPS = /[+−]$/;
/** Последнее число выражения (после последнего знака) */
const lastNum = (e: string) => e.split(/[+−]/).pop() ?? "";
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Значение выражения; знак в конце не считается. null — пусто */
export function evalExpr(e: string): number | null {
  const s = e.replace(OPS, "").replace(/,/g, ".");
  if (!s) return null;
  const parts = s.match(/[+−]?[\d.]+/g) ?? [];
  return r2(parts.reduce((a, p) => a + Number(p.replace("−", "-")), 0));
}

/** Число → «1250,5» для выражения */
const toExpr = (n: number) => String(n).replace(".", ",").replace("-", "−");

/** Нажатие клавиши: запятая одна на число, не больше 2 знаков после неё, ведущий ноль заменяется цифрой */
export function press(e: string, k: Key): string {
  if (k === "clear") return "";
  if (k === "⌫") return e.slice(0, -1);
  if (k === "=") {
    const v = evalExpr(e);
    return v === null ? "" : toExpr(v);
  }
  if (k === "+" || k === "−") {
    if (!e) return e;
    return OPS.test(e) ? e.slice(0, -1) + k : e + k;
  }
  if (e.length >= MAX) return e;
  const num = lastNum(e);
  if (k === ",") return num.includes(",") ? e : e + (num ? "," : "0,");
  const frac = num.includes(",") ? num.split(",")[1].length : -1;
  if (frac >= 2) return e;
  if (k === "00") {
    if (!num) return e + "0";
    if (num === "0") return e;
    return e + (frac === 1 ? "0" : "00");
  }
  // Цифра: «0» в начале числа заменяется
  return num === "0" ? e.slice(0, -1) + k : e + k;
}

/** Строка для поля суммы формы: без знака в конце, «−» → «-» */
export const toAmount = (e: string) => e.replace(OPS, "").replace(/−/g, "-");
/** Есть ли в выражении действие — показать «= итог» */
export const hasOp = (e: string) => /[+−]/.test(e.replace(OPS, ""));
