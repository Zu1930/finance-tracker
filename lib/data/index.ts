import "server-only";
import { drizzle } from "drizzle-orm/neon-serverless";
import { redisRepos } from "./redis/repos.ts";
import { postgresRepos } from "./postgres/repos.ts";
import { neonPool } from "./postgres/neon.ts";
import * as schema from "./postgres/schema.ts";
import { DEFAULT_HOUSEHOLD, type Ctx, type Repos } from "./types.ts";

export type * from "./types.ts";

let repos: Repos | null = null;

/** Хранилище: DATA_BACKEND=redis (по умолчанию) или postgres. Route handlers работают только через него */
export function getRepos(): Repos {
  if (repos) return repos;
  const backend = process.env.DATA_BACKEND ?? "redis";
  if (backend === "postgres") {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATA_BACKEND=postgres, но DATABASE_URL не задан");
    repos = postgresRepos(drizzle({ client: neonPool(url), schema }));
  } else if (backend === "redis") repos = redisRepos();
  else throw new Error(`DATA_BACKEND: неизвестное хранилище «${backend}»`);
  return repos;
}

/** Контекст запроса: пользователь сессии и его бюджет (пока у всех один) */
export const ctxOf = (user: { id: string }): Ctx => ({ userId: user.id, householdId: DEFAULT_HOUSEHOLD });
