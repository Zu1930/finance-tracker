import { requireUser, unauthorized } from "@/lib/session";
import { ctxOf, getRepos } from "@/lib/data";
import { fail, isVersion, updated } from "@/lib/records";
import { goalDeleteError } from "@/lib/savings";

const CONFLICT = "Копилку изменил другой пользователь, проверьте и повторите.";
const scopeOf = (v: unknown) => (v === "personal" ? "personal" : "family");

/** Имя и цель: { scope, version, name?, target? }. Права как у счетов */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser(req);
  if (!user) return unauthorized();
  const { id } = await params;
  const b = (await req.json().catch(() => null)) as { scope?: unknown; version?: unknown; name?: unknown; target?: unknown } | null;
  const name = typeof b?.name === "string" ? b.name.trim().slice(0, 40) : undefined;
  const target = b?.target;
  if (!b || !isVersion(b.version) || name === "" || (target !== undefined && !(typeof target === "number" && Number.isFinite(target) && target > 0))) {
    return fail(400, "Неверные данные.");
  }
  try {
    return updated(await getRepos().goals.update(ctxOf(user), scopeOf(b.scope), id, b.version, (g) => ({ ...g, ...(name && { name }), ...(typeof target === "number" && { target }) })), CONFLICT);
  } catch (e) {
    console.error(e);
    return fail(500, "Не удалось сохранить.");
  }
}

/** Удаление ?scope=: только пустая копилка, иначе 409 «СНАЧАЛА ВЕРНИТЕ ДЕНЬГИ» */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser(req);
  if (!user) return unauthorized();
  const { id } = await params;
  try {
    return updated(await getRepos().goals.update(ctxOf(user), scopeOf(new URL(req.url).searchParams.get("scope")), id, undefined, (g) => {
      const err = goalDeleteError(g);
      return err ? { status: 409, error: err } : null;
    }), CONFLICT);
  } catch (e) {
    console.error(e);
    return fail(500, "Не удалось удалить.");
  }
}
