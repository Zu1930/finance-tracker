import { NextResponse } from "next/server";
import type { CasResult } from "./data";
import { CONFLICT_MESSAGE } from "./store";

/** Общая часть PUT-эндпоинтов с проверкой версии: { version, data } → 200 { version } или 409 */
export async function casResponse<T extends object>(version: unknown, doc: T | null, write: (expected: number, doc: T) => Promise<CasResult>) {
  if (typeof version !== "number" || !Number.isInteger(version) || version < 0 || !doc) {
    return NextResponse.json({ error: "Неверные данные." }, { status: 400 });
  }
  try {
    const res = await write(version, doc);
    if (!res.ok) return NextResponse.json({ error: CONFLICT_MESSAGE, version: res.version }, { status: 409 });
    return NextResponse.json({ version: res.version });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Не удалось сохранить." }, { status: 500 });
  }
}
