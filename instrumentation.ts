/** Next вызывает при старте сервера: без базы и секрета входа запускаться нельзя */
export async function register() {
  const missing = ["DATABASE_URL", "BETTER_AUTH_SECRET"].filter((k) => !process.env[k]);
  if (missing.length) throw new Error(`Не заданы переменные окружения: ${missing.join(", ")}`);
  // Первый старт новой версии на Vercel — пуш «приложение обновилось». Не задерживаем старт и не роняем его
  if (process.env.NEXT_RUNTIME === "nodejs") {
    import("@/lib/push-server").then((m) => m.notifyUpdate()).catch((e) => console.error("push update", e));
  }
}
