/** Пользователь бюджета. USERS=vlad:Влад,masha:Маша читают только скрипты переноса из Redis (scripts/migrate-redis-to-pg.ts) */
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
