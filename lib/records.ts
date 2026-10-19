import "server-only";
import { NextResponse } from "next/server";
import { casHashes, getRedis } from "./redis";

type Fail = { status: number; error: string };
export const fail = (status: number, error: string) => NextResponse.json({ error }, { status });
export const isVersion = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;

/** Новая запись хеша (поля с таким id ещё нет) */
export async function createRecord<T extends { id: string }>(key: string, doc: T): Promise<Response> {
  const ok = await casHashes([{ key, id: doc.id, expected: -1, op: "set", doc }]);
  return ok ? NextResponse.json({ item: doc }) : fail(409, "Запись с таким id уже есть.");
}

/**
 * Изменить запись хеша по CAS. change возвращает новую запись, null — удалить, { status, error } — отказ.
 * version — какую видел клиент: при расхождении 409 с conflict. Без version — до 5 попыток на свежих данных
 * (для операций, которые складываются: «+ выделить» и «− вернуть» двоих не должны конфликтовать)
 */
export async function updateRecord<T extends { version: number }>(
  key: string,
  id: string,
  version: number | undefined,
  change: (cur: T) => T | null | Fail,
  conflict: string,
): Promise<Response> {
  for (let i = 0; i < 5; i++) {
    const cur = await getRedis().hget<T>(key, id);
    if (!cur) return fail(404, "Не найдено.");
    if (version !== undefined && cur.version !== version) return fail(409, conflict);
    const next = change(cur);
    if (next && "error" in next) return fail(next.status, next.error);
    const doc = next && { ...next, version: cur.version + 1 };
    const ok = await casHashes([doc ? { key, id, expected: cur.version, op: "set", doc } : { key, id, expected: cur.version, op: "del" }]);
    if (ok) return NextResponse.json(doc ? { item: doc } : { ok: true });
    if (version !== undefined) break;
  }
  return fail(409, conflict);
}
