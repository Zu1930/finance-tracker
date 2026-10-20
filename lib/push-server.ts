import "server-only";
import webpush, { type PushSubscription } from "web-push";
import { getRedis } from "./redis";
import { updateMessage, type PushMessage } from "./push";

/** Подписки всех устройств: поле — endpoint, значение — { userId, subscription } */
const SUBS = "ft:push";
/** Версия, о которой уже сообщили пушем */
const VERSION = "ft:push:version";

type Stored = { userId: string; subscription: PushSubscription; at: string };

/** VAPID из окружения; без ключей пуши выключены, приложение работает как раньше */
export function vapid(): { publicKey: string } | null {
  const pub = process.env.VAPID_PUBLIC_KEY, priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return null;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:admin@example.com", pub, priv);
  return { publicKey: pub };
}

export const isSubscription = (v: unknown): v is PushSubscription => {
  const s = v as PushSubscription | null;
  return !!s && typeof s.endpoint === "string" && /^https:\/\//.test(s.endpoint) && typeof s.keys?.p256dh === "string" && typeof s.keys?.auth === "string";
};

export const saveSubscription = (userId: string, subscription: PushSubscription) =>
  getRedis().hset(SUBS, { [subscription.endpoint]: { userId, subscription, at: new Date().toISOString() } satisfies Stored });

/** Удалить подписку можно только свою */
export async function removeSubscription(userId: string, endpoint: string): Promise<void> {
  const s = await getRedis().hget<Stored>(SUBS, endpoint);
  if (s?.userId === userId) await getRedis().hdel(SUBS, endpoint);
}

export async function hasSubscription(userId: string, endpoint: string): Promise<boolean> {
  return (await getRedis().hget<Stored>(SUBS, endpoint))?.userId === userId;
}

/**
 * Отправить пользователям (или всем). Подписка, которую push-сервис больше не знает (404/410), удаляется.
 * Возвращает число доставленных
 */
export async function sendPush(msg: PushMessage, userIds?: string[]): Promise<number> {
  if (!vapid()) return 0;
  const all = Object.values((await getRedis().hgetall<Record<string, Stored>>(SUBS)) ?? {});
  const targets = all.filter((s) => !userIds || userIds.includes(s.userId));
  let ok = 0;
  await Promise.all(
    targets.map(async (s) => {
      try {
        await webpush.sendNotification(s.subscription, JSON.stringify(msg), { TTL: 24 * 60 * 60 });
        ok++;
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) await getRedis().hdel(SUBS, s.subscription.endpoint);
        else console.error("push", code, (e as Error).message);
      }
    }),
  );
  return ok;
}

/**
 * Пуш «приложение обновилось»: при первом старте сервера с новым коммитом (только production на Vercel).
 * SET … GET атомарно меняет версию и возвращает прежнюю — из нескольких инстансов пуш уйдёт один раз
 */
export async function notifyUpdate(): Promise<void> {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA;
  if (process.env.VERCEL_ENV !== "production" || !sha || !vapid()) return;
  const previous = await getRedis().set<string>(VERSION, sha, { get: true });
  const msg = updateMessage(previous, sha, process.env.VERCEL_GIT_COMMIT_MESSAGE);
  if (msg) await sendPush(msg);
}
