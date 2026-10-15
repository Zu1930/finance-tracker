/** Пользователи семейного бюджета из окружения: USERS=vlad:Влад,masha:Маша, пароли PASSWORD_VLAD, PASSWORD_MASHA */
export type User = { id: string; name: string };

const ID = /^[a-z0-9_]+$/i;

/** Разбор USERS. Пользователей ровно двое — иначе понятная ошибка */
export function parseUsers(raw: string | undefined): User[] {
  const users = (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((pair) => {
      const i = pair.indexOf(":");
      const id = (i < 0 ? pair : pair.slice(0, i)).trim();
      const name = (i < 0 ? id : pair.slice(i + 1)).trim() || id;
      if (!ID.test(id)) throw new Error(`USERS: неверный id «${id}» — только латиница, цифры и _`);
      return { id, name };
    });
  if (users.length !== 2) {
    throw new Error(`USERS должен описывать ровно двух пользователей, сейчас ${users.length}. Пример: USERS=vlad:Влад,masha:Маша`);
  }
  if (users[0].id === users[1].id) throw new Error(`USERS: id «${users[0].id}» повторяется`);
  return users;
}

/** Без паролей — можно отдавать на клиент */
export const listUsers = (): User[] => parseUsers(process.env.USERS);
export const getUser = (id: string): User | null => listUsers().find((u) => u.id === id) ?? null;
export const partnerOf = (id: string): User => listUsers().find((u) => u.id !== id)!;
/** Имя переменной пароля: PASSWORD_ + id в верхнем регистре */
export const passwordOf = (id: string): string | null => process.env[`PASSWORD_${id.toUpperCase()}`] || null;

/** Проверка конфигурации при старте сервера (instrumentation.ts) */
export function assertUsersConfig(): void {
  const users = listUsers();
  const missing = users.filter((u) => !passwordOf(u.id)).map((u) => `PASSWORD_${u.id.toUpperCase()}`);
  if (!process.env.SESSION_SECRET) missing.push("SESSION_SECRET");
  if (missing.length) throw new Error(`Не заданы переменные окружения: ${missing.join(", ")}`);
}

/** Кто запускает перенос старых данных: MIGRATION_OWNER или первый из USERS */
export const migrationOwner = (): User => getUser(process.env.MIGRATION_OWNER ?? "") ?? listUsers()[0];
