/**
 * Коды закрытой регистрации (signup_codes) и проверка ссылок-приглашений при регистрации.
 * В базе только SHA-256 кода: сам код показывается один раз при создании
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import * as s from "./data/postgres/schema.ts";
import type { Db } from "./data/postgres/repos.ts";

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // без похожих 0/O, 1/I/L

/** Код для ввода руками: XXXXX-XXXXX */
export function newSignupCode(): string {
  const b = randomBytes(10);
  const chars = [...b].map((x) => ALPHABET[x % ALPHABET.length]).join("");
  return `${chars.slice(0, 5)}-${chars.slice(5)}`;
}
/** Код ссылки /join/<код>: 22 символа base64url */
export const newInviteCode = () => randomBytes(16).toString("base64url");

const normalizeSignup = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, "");
export const hashCode = (code: string) => createHash("sha256").update(code).digest("hex");
export const hashSignupCode = (code: string) => hashCode(normalizeSignup(code));

export const isAdmin = (userId: string) => (process.env.ADMIN_USER_IDS ?? "").split(",").map((x) => x.trim()).filter(Boolean).includes(userId);
export const registrationMode = () => (process.env.REGISTRATION_MODE === "open" ? "open" : "invite");

export type SignupCodeView = { id: string; usesTotal: number; usesLeft: number; createdAt: string; expiresAt: string; revoked: boolean };

export async function createSignupCode(db: Db, createdBy: string, uses: number, days: number): Promise<{ code: string; item: SignupCodeView }> {
  const code = newSignupCode();
  const [row] = await db.insert(s.signupCodes).values({
    id: randomUUID(), codeHash: hashSignupCode(code), createdBy, usesTotal: uses, usesLeft: uses, expiresAt: new Date(Date.now() + days * 86_400_000),
  }).returning();
  return { code, item: view(row) };
}

const view = (r: typeof s.signupCodes.$inferSelect): SignupCodeView => ({
  id: r.id, usesTotal: r.usesTotal, usesLeft: r.usesLeft, createdAt: r.createdAt.toISOString(), expiresAt: r.expiresAt.toISOString(), revoked: !!r.revokedAt,
});

export const listSignupCodes = async (db: Db) => (await db.select().from(s.signupCodes).orderBy(desc(s.signupCodes.createdAt))).map(view);

export const revokeSignupCode = async (db: Db, id: string) =>
  (await db.update(s.signupCodes).set({ revokedAt: new Date() }).where(and(eq(s.signupCodes.id, id), isNull(s.signupCodes.revokedAt))).returning({ id: s.signupCodes.id })).length > 0;

/** Списать одно использование атомарно: false — кода нет, истёк, отозван или кончился */
export async function consumeSignupCode(db: Db, code: string): Promise<boolean> {
  const rows = await db.update(s.signupCodes).set({ usesLeft: sql`${s.signupCodes.usesLeft} - 1` })
    .where(and(eq(s.signupCodes.codeHash, hashSignupCode(code)), gt(s.signupCodes.usesLeft, 0), gt(s.signupCodes.expiresAt, new Date()), isNull(s.signupCodes.revokedAt)))
    .returning({ id: s.signupCodes.id });
  return rows.length > 0;
}

/** Действующее приглашение по коду ссылки: не использовано, не отозвано, не истекло, бюджет активен */
export async function findInvite(db: Db, code: string) {
  const [row] = await db.select({ invite: s.householdInvites, household: s.households }).from(s.householdInvites)
    .innerJoin(s.households, eq(s.households.id, s.householdInvites.householdId))
    .where(and(
      eq(s.householdInvites.codeHash, hashCode(code)), isNull(s.householdInvites.usedAt), isNull(s.householdInvites.revokedAt),
      gt(s.householdInvites.expiresAt, new Date()), eq(s.households.status, "active"),
    ));
  return row ?? null;
}
