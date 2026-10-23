import { NextResponse } from "next/server";
import { requireUser, unauthorized } from "@/lib/session";
import { ctxOf, getRepos } from "@/lib/data";
import { migrateLegacy, needsMigration } from "@/lib/migrate";
import { listUsers, migrationOwner } from "@/lib/users";

/** Проверки, общие для скачивания копии и запуска: только MIGRATION_OWNER и только до миграции */
async function guard(req: Request) {
  const user = await requireUser(req);
  if (!user) return { error: unauthorized() };
  if (user.id !== migrationOwner().id) return { error: NextResponse.json({ error: "Перенос запускает другой пользователь." }, { status: 403 }) };
  const ctx = ctxOf(user);
  const current = await getRepos().settings.get(ctx);
  const legacy = await getRepos().legacy.docs(ctx);
  if (!needsMigration(current, legacy)) return { error: NextResponse.json({ error: "Переносить нечего: данные уже в семейном формате." }, { status: 409 }) };
  return { legacy, ctx };
}

/** Резервная копия старых данных перед переносом — скачивается автоматически */
export async function GET(req: Request) {
  const g = await guard(req);
  if (g.error) return g.error;
  return NextResponse.json({ version: 1, ...g.legacy });
}

/** Одноразовый перенос в семейный формат одной транзакцией. Старые ft:doc:* остаются как резервная копия */
export async function POST(req: Request) {
  const g = await guard(req);
  if (g.error) return g.error;
  try {
    const raw = migrateLegacy(g.legacy, migrationOwner().id, listUsers().map((u) => u.id));
    await getRepos().store.replace(g.ctx, raw);
    return NextResponse.json({ ok: true, months: Object.keys(raw.hashes).length });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Не удалось перенести данные." }, { status: 500 });
  }
}
