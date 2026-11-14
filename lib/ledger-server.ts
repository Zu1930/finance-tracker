import "server-only";
import { getRepos, type Bind, type Ctx } from "@/lib/data";
import { bindAccount, defaultAccountId } from "@/lib/ledger";
import { ledgerEntries } from "@/lib/store";
import type { Account, Settings } from "@/lib/types";

/** Счета бюджета и настройки для проверок записи на сервере. Счета партнёра клиенту не отдаются */
export async function ledgerCtx(ctx: Ctx): Promise<{ accounts: Account[]; settings: Settings | null; bind: Bind }> {
  const repos = getRepos();
  const [accounts, settings] = await Promise.all([repos.accounts.list(ctx), repos.settings.get(ctx)]);
  const o = { accounts, base: settings?.base ?? "", rates: settings?.rates ?? {} };
  const bind: Bind = (e, accountId, ownerId, accountAmount) => bindAccount(e, accountId, accountAmount, { ...o, userId: ownerId });
  return { accounts, settings, bind };
}

/** Счёт по умолчанию для записи без выбора (Siri): последний использованный, основной или первый */
export async function defaultAccount(ctx: Ctx): Promise<string | null> {
  const raw = await getRepos().store.snapshot(ctx);
  const accounts = [
    ...Object.values(raw.savings?.accounts ?? {}),
    ...Object.values(raw.savings?.userAccounts ?? {}).flatMap((h) => Object.values(h ?? {})),
  ];
  return defaultAccountId(ctx.userId, accounts, ledgerEntries(raw));
}

const DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
/** День пользователя из тела запроса; нет — сегодня на сервере (UTC) */
export const dayOf = (v: unknown) => (typeof v === "string" && DAY.test(v) ? v : new Date().toISOString().slice(0, 10));
