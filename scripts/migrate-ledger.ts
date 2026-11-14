/**
 * Перевод бюджетов на балансы из журнала: npm run db:migrate-ledger -- [--dry] [--day YYYY-MM-DD] [--out файл] [--production]
 * --dry — тот же расчёт с откатом, ничего не пишется. Повторный запуск пропускает уже переведённые бюджеты.
 * Схема (drizzle/0006_ledger.sql) должна быть применена: npm run db:migrate. Логика — lib/ledger-migrate.ts
 */
import { writeFileSync } from "node:fs";
import { connect } from "./db.ts";
import { migrateLedger, summary } from "../lib/ledger-migrate.ts";
import type { Db } from "../lib/data/postgres/repos.ts";

const argv = process.argv;
const arg = (name: string) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const dry = argv.includes("--dry");
const day = arg("--day") ?? new Date().toISOString().slice(0, 10);
if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
  console.error("--day должен быть YYYY-MM-DD");
  process.exit(2);
}

const { db, pool, host } = connect();
try {
  const reports = await migrateLedger(db as unknown as Db, { day, dry });
  const text = summary(reports, { day, dry });
  console.log(`База: ${host}\n${text}`);
  const out = arg("--out");
  if (out) {
    writeFileSync(out, JSON.stringify({ host, day, dry, reports }, null, 2) + "\n");
    console.log(`\nПолный отчёт: ${out}`);
  }
} finally {
  await pool.end();
}
