import "server-only";
import webpush, { type PushSubscription } from "web-push";
import { getRepos, type Ctx } from "./data";
import { updateMessage, type PushMessage } from "./push";

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

export const saveSubscription = (ctx: Ctx, subscription: PushSubscription) => getRepos().push.save(ctx, subscription);
/** Удалить подписку можно только свою */
export const removeSubscription = (ctx: Ctx, endpoint: string) => getRepos().push.remove(ctx, endpoint);
export const hasSubscription = (ctx: Ctx, endpoint: string) => getRepos().push.has(ctx, endpoint);

/**
 * Отправить пользователям (или всем). Подписка, которую push-сервис больше не знает (404/410), удаляется.
 * Возвращает число доставленных
 */
export async function sendPush(msg: PushMessage, userIds?: string[]): Promise<number> {
  if (!vapid()) return 0;
  const targets = await getRepos().system.subscriptions(userIds);
  let ok = 0;
  await Promise.all(
    targets.map(async (s) => {
      try {
        await webpush.sendNotification(s.subscription, JSON.stringify(msg), { TTL: 24 * 60 * 60 });
        ok++;
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) await getRepos().system.dropSubscription(s.subscription.endpoint);
        else console.error("push", code, (e as Error).message);
      }
    }),
  );
  return ok;
}

/**
 * Пуш «приложение обновилось»: при первом старте сервера с новым коммитом (только production на Vercel).
 * Версия меняется атомарно с возвратом прежней — из нескольких инстансов пуш уйдёт один раз
 */
export async function notifyUpdate(): Promise<void> {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA;
  if (process.env.VERCEL_ENV !== "production" || !sha || !vapid()) return;
  const previous = await getRepos().system.swapAppVersion(sha);
  const msg = updateMessage(previous, sha, process.env.VERCEL_GIT_COMMIT_MESSAGE);
  if (msg) await sendPush(msg);
}
