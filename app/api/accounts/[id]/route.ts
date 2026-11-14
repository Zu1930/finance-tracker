import { requireUser, unauthorized } from "@/lib/auth";
import { getRepos } from "@/lib/data";
import { fail, isVersion, updated } from "@/lib/records";
import { accountArchiveError } from "@/lib/savings";
import { accountBalance, reserved } from "@/lib/ledger";
import { ledgerEntries } from "@/lib/store";

/**
 * Имя и архив: { scope, version, name?, archived? }. Семейные счета правят оба, личные — только владелец
 * (из сессии). Остаток меняет только журнал: корректировка — POST /api/accounts/:id/adjust.
 * В архив — только счёт с нулевым остатком и без резервов под цели
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireUser(req);
  if (!ctx) return unauthorized();
  const { id } = await params;
  const b = (await req.json().catch(() => null)) as { scope?: unknown; version?: unknown; name?: unknown; archived?: unknown } | null;
  const name = typeof b?.name === "string" ? b.name.trim().slice(0, 40) : undefined;
  if (!b || !isVersion(b.version) || name === "" || (b.archived !== undefined && typeof b.archived !== "boolean")) return fail(400, "Неверные данные.");
  try {
    // Остаток счёта на журнале — из записей; резерв под цели не даёт убрать счёт в архив
    const raw = b.archived === true ? await getRepos().store.snapshot(ctx) : null;
    const entries = raw ? ledgerEntries(raw) : [];
    const today = new Date().toISOString().slice(0, 10);
    const r = await getRepos().accounts.update(
      ctx,
      b.scope === "personal" ? "personal" : "family",
      id,
      b.version,
      (a) => {
        if (b.archived === true && !a.archived) {
          const err = accountArchiveError({ ...a, balance: accountBalance(a, entries, today) })
            ?? (reserved(a.id, raw?.savings?.allocs ?? []) > 0 ? "СНАЧАЛА ВЕРНИТЕ ДЕНЬГИ ИЗ ЦЕЛЕЙ" : null);
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
