import { assertUsersConfig } from "@/lib/users";

/** Next вызывает при старте сервера: без двух пользователей и их паролей запускаться нельзя */
export function register() {
  assertUsersConfig();
}
