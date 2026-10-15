import { NextResponse } from "next/server";
import { readAllDocs } from "@/lib/redis";
import { docsToData } from "@/lib/docs";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const docs = await readAllDocs();
    const data = docsToData(docs);
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Хранилище недоступно." }, { status: 500 });
  }
}
