/**
 * Сверка Redis и Postgres после переноса: npm run db:verify -- [--production]
 * Число записей по сущностям, суммы base по месяцу/разделу/автору, остатки счетов, allocated копилок,
 * оплаченные регулярные по месяцам, ответ /api/data каждому пользователю. Любое расхождение — код выхода 1
 */
import { connect } from "./db.ts";
import { compare, metrics, readPostgresSource, readRedisSource } from "../lib/data/migrate.ts";
import { parseUsers } from "../lib/users.ts";

const users = parseUsers(process.env.USERS);
const { db, pool, host } = connect();
try {
  const rows = compare(metrics(await readRedisSource(users), users), metrics(await readPostgresSource(db, users), users));
  const w = Math.max(...rows.map((r) => r.metric.length));
  console.log(`Сверка Redis ↔ ${host}\n  ${"".padEnd(2)} ${"показатель".padEnd(w)}  ${"redis".padStart(14)}  ${"postgres".padStart(14)}`);
  for (const r of rows) console.log(`  ${r.ok ? "✓ " : "✗ "} ${r.metric.padEnd(w)}  ${String(r.redis ?? "—").padStart(14)}  ${String(r.postgres ?? "—").padStart(14)}`);
  const bad = rows.filter((r) => !r.ok).length;
  console.log(bad ? `\nРАСХОЖДЕНИЙ: ${bad}` : `\nРасхождений нет (${rows.length} показателей)`);
  process.exitCode = bad ? 1 : 0;
} finally {
  await pool.end();
}
