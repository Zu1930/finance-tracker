/** Применить миграции из drizzle/: npm run db:migrate [-- --production] */
import { migrate } from "drizzle-orm/neon-serverless/migrator";
import { connect } from "./db.ts";

const { db, pool, host } = connect();
try {
  await migrate(db, { migrationsFolder: new URL("../drizzle", import.meta.url).pathname });
  console.log(`Миграции применены: ${host}`);
} finally {
  await pool.end();
}
