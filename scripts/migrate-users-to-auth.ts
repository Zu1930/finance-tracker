/**
 * Пользователи → Better Auth: npm run db:migrate-users -- [--dry-run] [--production]
 * MIGRATE_USERS="vlad:email1,masha:email2", пароли — прежние PASSWORD_VLAD, PASSWORD_MASHA.
 * id прежние, email подтверждён. Повторный запуск безопасен и уже заданный пароль не меняет
 */
import { connect } from "./db.ts";
import { importAuthUsers, parseMigrateUsers } from "../lib/auth-admin.ts";

const dryRun = process.argv.includes("--dry-run");
const list = parseMigrateUsers(process.env.MIGRATE_USERS, process.env);
const { db, pool, host } = connect();
try {
  const rows = await importAuthUsers(db, list, { dryRun });
  console.log(`${dryRun ? "ПРОБНЫЙ ЗАПУСК, изменения откатаны" : "Готово"}: ${host}`);
  for (const r of rows) console.log(`  ${r.id}  ${r.email}${r.emailChanged ? " (email записан)" : ""}  пароль: ${r.password}`);
} finally {
  await pool.end();
}
