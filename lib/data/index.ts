import "server-only";
import { redisRepos } from "./redis/repos";
import { DEFAULT_HOUSEHOLD, type Ctx, type Repos } from "./types";

export type * from "./types";

let repos: Repos | null = null;

/** Хранилище приложения: route handlers работают только через него */
export const getRepos = (): Repos => (repos ??= redisRepos());

/** Контекст запроса: пользователь сессии и его бюджет (пока у всех один) */
export const ctxOf = (user: { id: string }): Ctx => ({ userId: user.id, householdId: DEFAULT_HOUSEHOLD });
