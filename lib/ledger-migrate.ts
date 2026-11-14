/**
 * Перевод бюджетов на балансы из журнала (scripts/migrate-ledger.ts). Идемпотентно: бюджет с ledger_since
 * пропускается. Каждый бюджет — одной транзакцией; dry — та же работа с откатом в конце, в базе ничего не меняется.
 *
 * 1. Счёт: initial = записанный остаток, initial_at = день миграции. Семейный счёт → личный счёт владельца семьи
 *    (общих счетов нет), в лог — предупреждение. У каждого человека — основной счёт (primary).
 * 2. Все существующие траты и доходы — legacy: остаются для истории и лимитов, баланс не двигают.
 * 3. Цели: «отложено» (goals.allocated) → части GoalAlloc. Личная — на счёт владельца, семейная — по тем, кто
 *    откладывал (goal_ops.by); что не разложилось — создателю (первая операция) или владельцу семьи, с предупреждением.
 *    Счёт — в валюте цели, если у человека такой есть, иначе основной (сумма по текущему курсу).
 * 4. Снимки сверки не трогаются: остаются для графика за 6 месяцев.
 */
import { and, asc, eq, isNull } from "drizzle-orm";
import * as s from "./data/postgres/schema.ts";
import type { Db } from "./data/postgres/repos.ts";
import { convert, type Rates } from "./ledger.ts";

const r2 = (n: number) => Math.round(n * 100) / 100;

export type HouseholdReport = {
  householdId: string;
  name: string;
  status: "migrated" | "skipped";
  accounts: { id: string; name: string; owner: string; currency: string; initial: number; primary: boolean; fromFamily: boolean }[];
  legacyExpenses: number;
  legacyIncomes: number;
  allocs: { goal: string; account: string; owner: string; amount: number; currency: string }[];
  /** Снимков сверки, оставленных для истории */
  recons: number;
  warnings: string[];
};

class Rollback extends Error {}

type Acc = typeof s.accounts.$inferSelect;

/** Счёт человека для части цели: в валюте цели (больший остаток), иначе основной */
function accountFor(accounts: Acc[], userId: string, currency: string, primary: Map<string, string>): Acc | null {
  const mine = accounts.filter((a) => a.ownerId === userId && !a.archived);
  const same = mine.filter((a) => a.currency === currency).sort((a, b) => b.balance - a.balance)[0];
  return same ?? mine.find((a) => a.id === primary.get(userId)) ?? null;
}

export async function migrateHousehold(db: Db, householdId: string, o: { day: string; dry: boolean }): Promise<HouseholdReport> {
  let report: HouseholdReport | null = null;
  try {
    await db.transaction(async (raw) => {
      const tx = raw as unknown as Db;
      const [h] = await tx.select().from(s.households).where(eq(s.households.id, householdId)).for("update");
      if (!h) throw new Error(`Нет бюджета ${householdId}`);
      const rep: HouseholdReport = { householdId, name: h.name, status: "skipped", accounts: [], legacyExpenses: 0, legacyIncomes: 0, allocs: [], recons: 0, warnings: [] };
      report = rep;
      if (h.ledgerSince) return;
      rep.status = "migrated";
      const base = h.baseCurrency ?? "";
      const rates: Rates = h.rates ?? {};
      const members = await tx.select().from(s.memberships)
        .where(and(eq(s.memberships.householdId, householdId), eq(s.memberships.status, "active"))).orderBy(asc(s.memberships.joinedAt));
      const owner = members.find((m) => m.role === "owner")?.userId ?? members[0]?.userId;
      const names = new Map((await tx.select({ id: s.users.id, name: s.users.name }).from(s.users)).map((u) => [u.id, u.name]));
      const who = (id: string | null | undefined) => (id ? names.get(id) ?? id : "—");

      // 1. Счета
      let accounts = await tx.select().from(s.accounts).where(eq(s.accounts.householdId, householdId));
      const family = accounts.filter((a) => !a.ownerId);
      if (family.length && !owner) throw new Error(`В бюджете ${householdId} есть общие счета, но нет участников`);
      for (const a of family) rep.warnings.push(`Общий счёт «${a.name}» (${a.balance} ${a.currency}) стал личным счётом ${who(owner)}.`);
      // Основной: уже отмеченный, иначе действующий с наибольшим остатком в базе
      const primary = new Map<string, string>();
      const ownerOf = (a: Acc) => a.ownerId ?? owner!;
      for (const a of accounts) if (a.primary) primary.set(ownerOf(a), a.id);
      const inBase = (a: Acc) => convert(a.balance, a.currency, base, base, rates) ?? -Infinity;
      for (const a of [...accounts].filter((x) => !x.archived).sort((x, y) => inBase(y) - inBase(x))) if (!primary.has(ownerOf(a))) primary.set(ownerOf(a), a.id);
      for (const a of accounts) {
        const ownerId = ownerOf(a);
        const isPrimary = primary.get(ownerId) === a.id;
        await tx.update(s.accounts)
          .set({ scope: "personal", ownerId, initial: r2(a.balance), initialAt: o.day, primary: isPrimary, version: a.version + 1 })
          .where(and(eq(s.accounts.householdId, householdId), eq(s.accounts.id, a.id)));
        rep.accounts.push({ id: a.id, name: a.name, owner: who(ownerId), currency: a.currency, initial: r2(a.balance), primary: isPrimary, fromFamily: !a.ownerId });
      }
      accounts = await tx.select().from(s.accounts).where(eq(s.accounts.householdId, householdId));
      const pending = (await tx.select().from(s.ledgerMoves).where(eq(s.ledgerMoves.householdId, householdId))).filter((m) => m.date >= o.day);
      if (pending.length) rep.warnings.push(`Переводов и корректировок с датой от ${o.day}: ${pending.length} — они войдут в баланс.`);

      // 2. Записи до журнала
      rep.legacyExpenses = (await tx.update(s.expenses).set({ legacy: true })
        .where(and(eq(s.expenses.householdId, householdId), eq(s.expenses.legacy, false))).returning({ id: s.expenses.id })).length;
      rep.legacyIncomes = (await tx.update(s.incomes).set({ legacy: true })
        .where(and(eq(s.incomes.householdId, householdId), eq(s.incomes.legacy, false))).returning({ id: s.incomes.id })).length;

      // 3. Цели
      const goals = await tx.select().from(s.goals).where(eq(s.goals.householdId, householdId));
      const existing = await tx.select().from(s.goalAllocs).where(eq(s.goalAllocs.householdId, householdId));
      const reserved = new Map<string, number>();
      for (const x of existing) reserved.set(x.accountId, (reserved.get(x.accountId) ?? 0) + x.amount);
      for (const g of goals) {
        if (!(g.allocated > 0)) continue;
        if (existing.some((x) => x.goalId === g.id)) { rep.warnings.push(`Цель «${g.name}»: части уже есть — пропущена.`); continue; }
        const ops = await tx.select().from(s.goalOps).where(and(eq(s.goalOps.householdId, householdId), eq(s.goalOps.goalId, g.id))).orderBy(asc(s.goalOps.pos));
        // Кто сколько отложил, в валюте цели
        const parts = new Map<string, number>();
        if (g.ownerId) parts.set(g.ownerId, g.allocated);
        else {
          const net = new Map<string, number>();
          for (const op of ops) net.set(op.by, (net.get(op.by) ?? 0) + op.amount);
          const active = new Set(members.map((m) => m.userId));
          let left = g.allocated;
          for (const [u, v] of [...net].sort((a, b) => b[1] - a[1])) {
            if (!(v > 0) || !active.has(u) || left <= 0) continue;
            const take = r2(Math.min(v, left));
            parts.set(u, take);
            left = r2(left - take);
          }
          if (left > 0) {
            const creator = ops.find((op) => active.has(op.by))?.by ?? owner!;
            parts.set(creator, r2((parts.get(creator) ?? 0) + left));
            rep.warnings.push(`Семейная цель «${g.name}»: ${left} ${g.currency} без автора — отдано ${who(creator)} (создатель цели или владелец семьи).`);
          }
        }
        let placed = true;
        for (const [u, amount] of parts) {
          const a = accountFor(accounts, u, g.currency, primary);
          if (!a) { rep.warnings.push(`Цель «${g.name}»: у ${who(u)} нет счёта — ${amount} ${g.currency} не разложено, цель не тронута.`); placed = false; break; }
          const v = convert(amount, g.currency, a.currency, base, rates);
          if (v === null) { rep.warnings.push(`Цель «${g.name}»: нет курса ${g.currency} → ${a.currency}, цель не тронута.`); placed = false; break; }
          if (a.currency !== g.currency) rep.warnings.push(`Цель «${g.name}»: ${amount} ${g.currency} → ${r2(v)} ${a.currency} на «${a.name}» по текущему курсу.`);
        }
        if (!placed) continue;
        for (const [u, amount] of parts) {
          const a = accountFor(accounts, u, g.currency, primary)!;
          const v = r2(convert(amount, g.currency, a.currency, base, rates)!);
          await tx.insert(s.goalAllocs).values({ householdId, goalId: g.id, accountId: a.id, amount: v, version: 1 })
            .onConflictDoUpdate({ target: [s.goalAllocs.householdId, s.goalAllocs.goalId, s.goalAllocs.accountId], set: { amount: v, version: 1 } });
          reserved.set(a.id, (reserved.get(a.id) ?? 0) + v);
          rep.allocs.push({ goal: g.name, account: a.name, owner: who(u), amount: v, currency: a.currency });
        }
        // Деньги цели теперь — части на счетах; операции остаются историей
        await tx.update(s.goals).set({ allocated: 0, version: g.version + 1 }).where(and(eq(s.goals.householdId, householdId), eq(s.goals.id, g.id)));
      }
      for (const a of accounts) {
        const res = r2(reserved.get(a.id) ?? 0);
        if (res > a.initial) rep.warnings.push(`Счёт «${a.name}» (${who(a.ownerId)}): под цели ${res} ${a.currency} при остатке ${a.initial} — «свободно» будет меньше нуля.`);
      }

      // 4. Снимки сверки — только история
      rep.recons = (await tx.select({ id: s.recons.id }).from(s.recons).where(eq(s.recons.householdId, householdId))).length;
      await tx.update(s.households).set({ ledgerSince: o.day }).where(eq(s.households.id, householdId));
      if (o.dry) throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
  return report!;
}

/** Все действующие бюджеты; распущенные (архив) не трогаются — они только для чтения и будут удалены */
export async function migrateLedger(db: Db, o: { day: string; dry: boolean }): Promise<HouseholdReport[]> {
  const list = await db.select({ id: s.households.id }).from(s.households)
    .where(and(eq(s.households.status, "active"), isNull(s.households.ledgerSince))).orderBy(asc(s.households.createdAt));
  const out: HouseholdReport[] = [];
  for (const h of list) out.push(await migrateHousehold(db, h.id, o));
  return out;
}

/** Сводка для человека: по бюджету — строки; полный отчёт — JSON */
export function summary(reports: HouseholdReport[], o: { day: string; dry: boolean }): string {
  const lines = [`${o.dry ? "ПРОБНЫЙ ПРОГОН (--dry), ничего не записано" : "МИГРАЦИЯ ВЫПОЛНЕНА"} · день перехода ${o.day} · бюджетов: ${reports.length}`];
  for (const r of reports) {
    lines.push("", `■ ${r.name} (${r.householdId}) — ${r.status === "migrated" ? "переведён" : "уже на журнале"}`);
    if (r.status === "skipped") continue;
    lines.push(`  счета: ${r.accounts.length} (из общих: ${r.accounts.filter((a) => a.fromFamily).length})`);
    for (const a of r.accounts) lines.push(`    ${a.primary ? "★" : "·"} ${a.name} — ${a.owner}, ${a.initial} ${a.currency}${a.fromFamily ? " [был общим]" : ""}`);
    lines.push(`  записи → legacy: трат ${r.legacyExpenses}, доходов ${r.legacyIncomes}`);
    lines.push(`  части целей: ${r.allocs.length}`);
    for (const x of r.allocs) lines.push(`    ${x.goal}: ${x.amount} ${x.currency} на «${x.account}» (${x.owner})`);
    lines.push(`  снимков сверки для истории: ${r.recons}`);
    if (r.warnings.length) lines.push(`  предупреждения: ${r.warnings.length}`, ...r.warnings.map((w) => `    ! ${w}`));
  }
  return lines.join("\n");
}
