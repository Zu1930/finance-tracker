import { NextResponse } from "next/server";
import { listUsers } from "@/lib/users";

/** Публичный список для экрана входа: только id и имена */
export function GET() {
  return NextResponse.json(listUsers());
}
