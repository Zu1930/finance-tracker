/**
 * Сброс забытого пароля: npm run reset-password -- <email> [--production]
 * Выводит временный пароль и завершает все сессии пользователя. Пароль сменить в Настройках → АККАУНТ
 */
import { connect } from "./db.ts";
import { resetPassword } from "../lib/auth-admin.ts";

const email = process.argv.slice(2).find((a) => !a.startsWith("--"));
if (!email) {
  console.error("Использование: npm run reset-password -- <email> [--production]");
  process.exit(2);
}
const { db, pool, host } = connect();
try {
  const r = await resetPassword(db, email);
  console.log(`${host}: пароль ${r.userId} сброшен, завершено сессий: ${r.sessions}`);
  console.log(`Временный пароль: ${r.password}`);
} finally {
  await pool.end();
}
