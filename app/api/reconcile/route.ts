import { NextResponse } from "next/server";
import { people, requireUser, unauthorized } from "@/lib/auth";
import { getRepos } from "@/lib/data";
import { fail } from "@/lib/records";
import { applyReconcile, flowsOf, reconView } from "@/lib/savings";

const DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const isNumMap = (v: unknown): v is Record<string, number> =>
  !!v && typeof v === "object" && !Array.isArray(v) && Object.values(v).every((x) => typeof x === "number" && Number.isFinite(x));

/**
 * Сверка: { balances: { accountId: остаток }, versions: { accountId: версия, которую видел клиент }, day: YYYY-MM-DD }.
 * Принимаются семейные и свои личные счета (чужой id → 403), остальные сохраняют остаток. Остатки и снимок
 * по всем счетам семьи пишутся атомарно; в ответ — снимок без поштучных остатков
 */
export async function POST(req: Request) {
  const ctx = await requireUser(req);
  if (!ctx) return unauthorized();
  const b = (await req.json().catch(() => null)) as { balances?: unknown; versions?: unknown; day?: unknown } | null;
  if (!b || !isNumMap(b.balances) || !isNumMap(b.versions) || typeof b.day !== "string" || !DAY.test(b.day)) return fail(400, "Неверные данные сверки.");
  try {
    const raw = await getRepos().store.snapshot(ctx);
    if (!raw.settings || !raw.savings) return fail(409, "Трекер ещё не настроен.");
    const at = new Date().toISOString();
    const res = applyReconcile(raw.savings, ctx.userId, { balances: b.balances, versions: b.versions, day: b.day }, raw.settings.base, raw.settings.rates, flowsOf(raw.hashes), { id: crypto.randomUUID(), at });
    if ("error" in res) return fail(res.status, res.error);
    // Версии всех счетов проверяются, изменённые записываются: снимок не должен смешать старые и новые остатки
    const seen = [...Object.values(raw.savings.accounts), ...Object.values(raw.savings.userAccounts).flatMap((h) => Object.values(h))];
    const ok = await getRepos().recons.add(ctx, res.recon, seen, res.changed, raw.savings.recons.length);
    if (!ok) return fail(409, "Счета изменил другой пользователь, проверьте и повторите.");
    return NextResponse.json({ recon: reconView(res.recon, ctx.userId, (await people(ctx)).partner?.id ?? "") });
  } catch (e) {
    console.error(e);
    return fail(500, "Не удалось сохранить сверку.");
  }
}
