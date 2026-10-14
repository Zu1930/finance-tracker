import { NextResponse } from "next/server";
import { writeDocs } from "@/lib/redis";
import { DOC_ID, isIncomeId, isMonthId } from "@/lib/docs";

/** Принимает экспорт: { settings, goals: Goal[], months: { "m-YYYY-MM": { expenses } }, incomes?: { "i-YYYY-MM": { items } } } */
export async function POST(req: Request) {
  const data = (await req.json().catch(() => null)) as {
    settings?: unknown;
    goals?: unknown;
    months?: Record<string, unknown>;
    incomes?: Record<string, unknown>;
  } | null;

  if (!data || typeof data !== "object" || !data.settings || typeof data.settings !== "object") {
    return NextResponse.json({ error: "В файле нет настроек трекера." }, { status: 400 });
  }
  const docs: Record<string, unknown> = { settings: data.settings };
  docs.goals = { items: Array.isArray(data.goals) ? data.goals : [] };
  for (const [id, body] of Object.entries(data.months ?? {})) {
    if (DOC_ID.test(id) && isMonthId(id) && body && typeof body === "object") docs[id] = body;
  }
  for (const [id, body] of Object.entries(data.incomes ?? {})) {
    if (DOC_ID.test(id) && isIncomeId(id) && body && typeof body === "object") docs[id] = body;
  }
  try {
    await writeDocs(docs);
    return NextResponse.json({ ok: true, months: Object.keys(docs).filter(isMonthId).length });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Не удалось записать данные." }, { status: 500 });
  }
}
