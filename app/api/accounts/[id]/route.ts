import { requireUser, unauthorized } from "@/lib/session";
import { ctxOf, getRepos } from "@/lib/data";
import { fail, isVersion, updated } from "@/lib/records";
import { accountArchiveError } from "@/lib/savings";

/**
 * Имя и архив: { scope, version, name?, archived? }. Семейные счета правят оба, личные — только владелец
 * (из сессии). Остаток меняет только сверка
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser(req);
  if (!user) return unauthorized();
  const { id } = await params;
  const b = (await req.json().catch(() => null)) as { scope?: unknown; version?: unknown; name?: unknown; archived?: unknown } | null;
  const name = typeof b?.name === "string" ? b.name.trim().slice(0, 40) : undefined;
  if (!b || !isVersion(b.version) || name === "" || (b.archived !== undefined && typeof b.archived !== "boolean")) return fail(400, "Неверные данные.");
  try {
    const r = await getRepos().accounts.update(
      ctxOf(user),
      b.scope === "personal" ? "personal" : "family",
      id,
      b.version,
      (a) => {
        if (b.archived === true && !a.archived) {
          const err = accountArchiveError(a);
          if (err) return { status: 409, error: err };
        }
        return { ...a, ...(name && { name }), ...(typeof b.archived === "boolean" && { archived: b.archived }) };
      },
    );
    return updated(r, "Счёт изменил другой пользователь, проверьте и повторите.");
  } catch (e) {
    console.error(e);
    return fail(500, "Не удалось сохранить.");
  }
}
