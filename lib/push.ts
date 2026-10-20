/**
 * Когда и что отправлять пушем. Чистые функции — их вызывает ежедневный cron и тесты (lib/push.test.mjs).
 * Время — в часовом поясе семьи (APP_TZ, по умолчанию Europe/Belgrade).
 */
import { monthName } from "./utils.ts";

export type PushMessage = { title: string; body: string; url: string; tag: string };

/** Дата в часовом поясе: день, день недели (0 — воскресенье), последний день месяца */
export function localDate(now: Date, tz: string): { date: string; month: string; day: number; weekday: number; lastDay: number } {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" })
      .formatToParts(now)
      .map((x) => [x.type, x.value]),
  );
  const y = Number(p.year), m = Number(p.month), d = Number(p.day);
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    month: `${p.year}-${p.month}`,
    day: d,
    weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday),
    lastDay: new Date(Date.UTC(y, m, 0)).getUTCDate(),
  };
}

/** За сколько дней до конца месяца напоминать о плане */
export const PLAN_DAYS_BEFORE = 2;

/** Напоминание спланировать следующий месяц — за 2 дня до конца, если плана на него ещё нет */
export function planReminder(today: { day: number; lastDay: number }, nextMonth: string, hasPlan: boolean): PushMessage | null {
  if (hasPlan || today.day !== today.lastDay - PLAN_DAYS_BEFORE) return null;
  return {
    title: `Пора спланировать ${monthName(nextMonth).toLowerCase()}`,
    body: "Доход, лимиты и покупки на месяц",
    url: `/limits?month=${nextMonth}`,
    tag: `plan-${nextMonth}`,
  };
}

/** По воскресеньям — напомнить внести траты; count — сколько записей человек сделал за 7 дней */
export function weeklyReminder(weekday: number, count: number, week: string): PushMessage | null {
  if (weekday !== 0) return null;
  return {
    title: "Внесите траты за неделю",
    body: count === 0 ? "За неделю ни одной записи" : `За неделю записей: ${count}. Всё ли внесено?`,
    url: "/",
    tag: `weekly-${week}`,
  };
}

/** После деплоя: прежняя версия есть и отличается от текущей. Первая установка — без пуша */
export function updateMessage(previous: string | null, current: string, commitMessage?: string): PushMessage | null {
  if (!previous || previous === current) return null;
  const first = commitMessage?.split("\n")[0].trim();
  return { title: "SPEND.LOG обновился", body: first || "Откройте, чтобы загрузить новую версию", url: "/", tag: `update-${current.slice(0, 7)}` };
}
