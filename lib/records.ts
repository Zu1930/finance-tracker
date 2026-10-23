import { NextResponse } from "next/server";
import type { Done, Updated } from "./data";

export const fail = (status: number, error: string) => NextResponse.json({ error }, { status });
export const isVersion = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;

/** Ответ на создание записи: false — запись с таким id уже есть */
export const created = (ok: boolean, item: object) => (ok ? NextResponse.json({ item }) : fail(409, "Запись с таким id уже есть."));

/** Ответ на изменение записи: { item } или { ok } после удаления; 404 и 409 без текста — стандартные */
export function updated<T>(r: Updated<T>, conflict: string): Response {
  if (r.ok) return NextResponse.json(r.item ? { item: r.item } : { ok: true });
  return fail(r.status, r.error ?? (r.status === 404 ? "Не найдено." : conflict));
}

/** Ответ на запись траты, связанной с пунктом плана или регулярным платежом */
export const written = (r: Done, entry: object, conflict: string) =>
  r.ok ? NextResponse.json({ entry }) : fail(r.status, r.error ?? conflict);
