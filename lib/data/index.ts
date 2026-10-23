import "server-only";
import { drizzle } from "drizzle-orm/neon-serverless";
import { postgresRepos, type Db } from "./postgres/repos.ts";
import { neonPool } from "./postgres/neon.ts";
import * as schema from "./postgres/schema.ts";
import type { Repos } from "./types.ts";

export type * from "./types.ts";

let db: Db | null = null;
let repos: Repos | null = null;

/** Postgres приложения: данные и вход (lib/auth.ts) в одной базе */
export function getDb(): Db {
  if (db) return db;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL не задан");
  return (db = drizzle({ client: neonPool(url), schema }));
}

/** Route handlers работают с данными только через репозитории */
export const getRepos = (): Repos => (repos ??= postgresRepos(getDb()));
