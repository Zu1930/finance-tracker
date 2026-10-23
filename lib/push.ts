/**
 * Когда и что отправлять пушем. Чистые функции — их вызывает ежедневный cron и тесты (lib/push.test.mjs).
 * Время — в часовом поясе устройства пользователя (Reminders.tz), без него — APP_TZ (по умолчанию Europe/Belgrade).
 */
import { monthName } from "./utils.ts";
import type { Reminders } from "./types.ts";

export type PushMessage = { title: string; body: string; url: string; tag: string };

/** Дата в часовом поясе: день, день недели (0 — воскресенье), последний день месяца, час */
export function localDate(now: Date, tz: string): { date: string; month: string; day: number; weekday: number; lastDay: number; hour: number } {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short", hour: "2-digit", hourCycle: "h23" })
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
    hour: Number(p.hour),
  };
}

/** Без своих настроек: в 19:00, по воскресеньям, план — за 2 дня до конца месяца */
export const DEFAULT_REMINDERS: Reminders = { hour: 19, weekday: 0, planDays: 2 };

/** Напоминание спланировать следующий месяц — за days дней до конца, если плана на него ещё нет */
export function planReminder(today: { day: number; lastDay: number }, nextMonth: string, hasPlan: boolean, days = DEFAULT_REMINDERS.planDays): PushMessage | null {
  if (hasPlan || today.day !== today.lastDay - days) return null;
  return {
    title: `Пора спланировать ${monthName(nextMonth).toLowerCase()}`,
    body: "Доход, лимиты и покупки на месяц",
    url: `/limits?month=${nextMonth}`,
    tag: `plan-${nextMonth}`,
  };
}

/** В выбранный день недели (по умолчанию воскресенье) — напомнить внести траты; count — записей человека за 7 дней */
export function weeklyReminder(weekday: number, count: number, week: string, day = DEFAULT_REMINDERS.weekday): PushMessage | null {
  if (weekday !== day) return null;
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
  return { title: "Новая версия", body: first || "Откройте, чтобы загрузить новую версию", url: "/", tag: `update-${current.slice(0, 7)}` };
}
