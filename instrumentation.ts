import { assertUsersConfig } from "@/lib/users";

/** Next вызывает при старте сервера: без двух пользователей и их паролей запускаться нельзя */
export async function register() {
  assertUsersConfig();
  // Первый старт новой версии на Vercel — пуш «приложение обновилось». Не задерживаем старт и не роняем его
  if (process.env.NEXT_RUNTIME === "nodejs") {
    import("@/lib/push-server").then((m) => m.notifyUpdate()).catch((e) => console.error("push update", e));
  }
}
