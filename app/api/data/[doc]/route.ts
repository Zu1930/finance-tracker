import { NextResponse } from "next/server";
import { writeDoc } from "@/lib/redis";
import { DOC_ID } from "@/lib/docs";

const MAX_BYTES = 900_000; // запас до лимита запроса Upstash

export async function PUT(req: Request, { params }: { params: Promise<{ doc: string }> }) {
  const { doc } = await params;
  if (!DOC_ID.test(doc)) {
    return NextResponse.json({ error: "Неизвестный документ." }, { status: 400 });
  }
  const text = await req.text();
  if (text.length > MAX_BYTES) {
    return NextResponse.json({ error: "Документ слишком большой." }, { status: 413 });
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Тело запроса не JSON." }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Ожидается JSON-объект." }, { status: 400 });
  }
  try {
    await writeDoc(doc, body);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Не удалось сохранить." }, { status: 500 });
  }
}
