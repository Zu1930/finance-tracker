/**
 * Подключение скриптов к Postgres. Без --production скрипт отказывается работать с production-базой:
 * её хост задаёт PRODUCTION_DB_HOST, а если переменная не задана — production считается любая база
 */
import { drizzle } from "drizzle-orm/neon-serverless";
import * as schema from "../lib/data/postgres/schema.ts";
import { neonPool } from "../lib/data/postgres/neon.ts";

const bare = (host: string) => host.replace("-pooler.", ".");

export function connect(argv = process.argv) {
  // Миграции и перенос — через прямое (не pooled) подключение: транзакции и DDL
  const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!url) throw new Error("Не задан DATABASE_URL (или DATABASE_URL_UNPOOLED)");
  const host = new URL(url).hostname;
  const prod = process.env.PRODUCTION_DB_HOST;
  const isProduction = !prod || bare(host) === bare(prod);
  if (isProduction && !argv.includes("--production")) {
    console.error(prod ? `${host} — production-база. Запустите с --production, если это намеренно.` : "PRODUCTION_DB_HOST не задан — база считается production. Задайте его или запустите с --production.");
    process.exit(2);
  }
  const pool = neonPool(url);
  return { db: drizzle({ client: pool, schema }), pool, host, isProduction };
}
