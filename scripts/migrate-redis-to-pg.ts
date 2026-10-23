/**
 * Перенос Redis → Postgres: npm run db:migrate-redis -- [--dry-run] [--production] [--force]
 * Redis (KV_REST_API_URL/TOKEN) только читается. Бюджет default, участники из USERS (первый — owner).
 * Одна транзакция, upsert по id — повторный запуск безопасен. --dry-run выполняет всё и откатывает.
 * Если в Postgres есть данные новее Redis (приложение уже пишет в Postgres) — отказ; --force перезаписывает их
 */
import { connect } from "./db.ts";
import { importToPostgres, readRedisSource } from "../lib/data/migrate.ts";
import { parseUsers } from "../lib/users.ts";

const dryRun = process.argv.includes("--dry-run");
const force = process.argv.includes("--force");
const users = parseUsers(process.env.USERS);
const { db, pool, host } = connect();
try {
  const { counts, skipped } = await importToPostgres(db, await readRedisSource(users), users, { dryRun, force });
  console.log(`${dryRun ? "ПРОБНЫЙ ПЕРЕНОС, изменения откатаны" : "Перенесено"}: Redis → ${host}, бюджет default, участники ${users.map((u) => u.id).join(", ")} (owner — ${users[0].id})`);
  const width = Math.max(...Object.keys(counts).map((k) => k.length));
  for (const [table, n] of Object.entries(counts)) console.log(`  ${table.padEnd(width)}  ${n}`);
  for (const s of skipped) console.warn(`  не перенесено: ${s}`);
} finally {
  await pool.end();
}
