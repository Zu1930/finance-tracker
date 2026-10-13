import { NextResponse } from "next/server";
import { readAllDocs } from "@/lib/redis";
import { isMonthId } from "@/lib/docs";
import type { GoalsDoc, MonthDoc, Settings, TrackerData } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const docs = await readAllDocs();
    const data: TrackerData = {
      settings: (docs.settings as Settings | undefined) ?? null,
      goals: (docs.goals as GoalsDoc | undefined)?.items ?? [],
      months: {},
    };
    for (const [id, body] of Object.entries(docs)) {
      if (isMonthId(id)) data.months[id] = body as MonthDoc;
    }
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Хранилище недоступно." }, { status: 500 });
  }
}
