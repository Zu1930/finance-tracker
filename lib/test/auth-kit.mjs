// Общее для тестов входа и бюджетов: PGlite с миграциями и запросы к Better Auth как из браузера
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

export const ORIGIN = "http://localhost:3000";
process.env.BETTER_AUTH_SECRET ??= "test-secret-test-secret-test-secret-0123";
process.env.BETTER_AUTH_URL ??= ORIGIN;

/** Пустая база со всеми миграциями; sql — сырой SQL для подготовки данных */
export async function freshDb(schema) {
  const client = new PGlite();
  const db = drizzle({ client, schema });
  await migrate(db, { migrationsFolder: new URL("../../drizzle", import.meta.url).pathname });
  return { db, sql: (q) => client.exec(q) };
}

let ipN = 0;
/** call(path, { body, cookie, ip, headers }) → { status, json, cookie, location } */
export const caller = (auth) => async (path, { body, cookie, ip = `10.0.${Math.floor(++ipN / 250) % 250}.${ipN % 250}`, method = body ? "POST" : "GET", headers = {} } = {}) => {
  const h = { origin: ORIGIN, "x-forwarded-for": ip, "user-agent": "Mozilla/5.0 (iPhone) Safari", ...headers };
  if (body) h["content-type"] = "application/json";
  if (cookie) h.cookie = cookie;
  const url = path.startsWith("http") ? path : `${ORIGIN}/api/auth${path}`;
  const res = await auth.handler(new Request(url, { method, headers: h, body: body && JSON.stringify(body) }));
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  return { status: res.status, json, cookie: res.headers.getSetCookie().map((c) => c.split(";")[0]).filter((c) => !/=$/.test(c)).join("; "), location: res.headers.get("location") };
};
