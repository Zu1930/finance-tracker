/**
 * Сессия: cookie ft_session = <userId>.<hex HMAC-SHA256(userId, SESSION_SECRET + ":" + пароль пользователя)>.
 * Web Crypto — работает и в proxy.ts, и в route handlers. Смена пароля разлогинивает только этого пользователя.
 */
import { getUser, passwordOf, type User } from "./users.ts";

export const SESSION_COOKIE = "ft_session";

type Credentials = { secret: string; password: string };

const hex = (buf: ArrayBuffer) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");

export async function signSession(userId: string, { secret, password }: Credentials): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(`${secret}:${password}`), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return `${userId}.${hex(await crypto.subtle.sign("HMAC", key, enc.encode(userId)))}`;
}

export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Проверка подписи; credentialsOf — где взять секрет и пароль пользователя (в тестах — фикстура) */
export async function verifySession(
  value: string,
  credentialsOf: (userId: string) => Credentials | null,
): Promise<{ userId: string } | null> {
  const dot = value.indexOf(".");
  if (dot <= 0) return null;
  const userId = value.slice(0, dot);
  const creds = credentialsOf(userId);
  if (!creds) return null;
  return safeEqual(value, await signSession(userId, creds)) ? { userId } : null;
}

/** Секрет и пароль из окружения; неизвестный пользователь — null */
export function envCredentials(userId: string): Credentials | null {
  const secret = process.env.SESSION_SECRET;
  const password = getUser(userId) ? passwordOf(userId) : null;
  return secret && password ? { secret, password } : null;
}

export const readSession = (cookieValue: string) => verifySession(cookieValue, envCredentials);

function cookieValue(header: string | null, name: string): string | null {
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

/**
 * Пользователь запроса для route handlers. Проверяем заново, а не полагаемся только на proxy.ts.
 * null — ответить unauthorized()
 */
export async function requireUser(req: Request): Promise<User | null> {
  const value = cookieValue(req.headers.get("cookie"), SESSION_COOKIE);
  const session = value ? await readSession(value) : null;
  return session ? getUser(session.userId) : null;
}

export const unauthorized = () => Response.json({ error: "unauthorized" }, { status: 401 });
