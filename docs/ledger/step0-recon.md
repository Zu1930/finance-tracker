# Шаг 0. Разведка: балансы из журнала

## Слой хранения

- **Только Neon Postgres** (drizzle, `lib/data/postgres/{schema,repos}.ts`, миграции `drizzle/000N_*.sql`).
  Redis уже снят: упоминания остались лишь в комментариях («хеши как в Redis»). Миграция Redis → Postgres завершена,
  поэтому изменения вписываю в Postgres.
- Route handlers работают через `getRepos()` (`lib/data/types.ts` — интерфейсы), а `store.snapshot()` собирает `RawStore`.
- В окружении сессии **нет `DATABASE_URL`**. Для `--dry` нужна строка ветки Neon:
  `DATABASE_URL_UNPOOLED` (или `DATABASE_URL`), см. `scripts/db.ts`.
  Локальная копия возможна на `@electric-sql/pglite` (на нём уже идут тесты репозиториев), но там будут только синтетические данные.

## Как устроено сейчас (важно для решений)

| Что | Сейчас | Расхождение с ТЗ |
|---|---|---|
| Счета | `accounts.scope = family \| personal`, у family `owner_id IS NULL`; хранится `balance` | п.1: общих счетов нет |
| Записи | две таблицы: `expenses` (scope, category, plan/recurring) и `incomes`; `amount/currency/rate/base` | в ТЗ единый `Entry` |
| Цели | `goals.allocated` (в валюте цели) + `goal_ops` (+/−, `by`) | `GoalAlloc` по счетам |
| Сверка | `recons` (jsonb snapshot + `total_all/total_family`), `POST /api/reconcile` | удалить, оставить историю |
| Виды | `Space = family \| personal \| all` (`lib/space.ts`) | в ТЗ `mine \| family`, `all` под вопросом |
| Архив семьи | `claims`: при выходе из семьи «забрать семейный счёт» | без семейных счетов не нужно |
| Кто создаёт траты | форма ввода, `/api/quick` (Siri), оплата регулярного, покупка по плану | всем нужен `accountId` |

`all` ≠ `family`: `family` — семейные траты обоих и доходы всех, без моих личных трат; `all` — всё сразу:
семейные траты, мои личные траты поштучно и суммы партнёра.

Базовый прогон: `npm test` — 231/232. Падает `lib/onboarding.test.mjs:48` («день прошёл — со следующего месяца»)
ещё до моих правок: тест зависит от сегодняшней даты.

## Файлы, которые затрону

**Шаг 2 — чистые функции**
- `lib/ledger.ts` (новый), `lib/ledger.test.mjs` (новый)

**Шаг 3 — модель и API**
- `lib/types.ts` — `Account` (+`initialAt`, без `scope/balance`), поля записи, `GoalAlloc`, `Transfer/Adjustment`
- `lib/data/postgres/schema.ts` + `drizzle/0006_ledger.sql` (+ `drizzle/meta`)
- `lib/data/types.ts`, `lib/data/postgres/repos.ts` — счета, переводы и корректировки, `goal_allocs`, трата из цели в одной транзакции
- `lib/store.ts` — снимок: журнал, резервы
- `app/api/entries/route.ts`, `app/api/entries/[id]/route.ts`, `lib/entry-edit.ts` — инварианты счёта
- `app/api/accounts/route.ts`, `app/api/accounts/[id]/route.ts`, **новый** `app/api/accounts/[id]/adjust/route.ts`
- **новые** `app/api/transfers/route.ts`, `app/api/goals/[id]/alloc/route.ts`; `app/api/goals/*` — без `allocated`
- `app/api/quick/route.ts`, `lib/quick-entry/entry.ts`, `app/api/recurring/[id]/pay/route.ts` — счёт по умолчанию
- `lib/onboarding-server.ts` — пресеты счетов только личные
- `lib/archive.ts` — claims счетов, вид архива
- `lib/rebase.ts` — смена базы без `allocated` и сверки
- `lib/export.ts`, `app/api/account/export` — новые поля

**Шаг 4 — миграция**
- `scripts/migrate-ledger.ts` (новый), `package.json` (скрипт `db:migrate-ledger`), `docs/ledger/migration.md`

**Шаг 5 — UI**
- `components/entry/EntryForm.tsx`, `MobileEntry.tsx`, `useEntryDraft.ts` — счёт, «семейная», «из цели», перевод
- `components/money/MoneyView.tsx` — карточки счетов, цели, корректировка
- `components/TrackerProvider.tsx`, `lib/space.ts`, `components/SpaceSwitcher.tsx`, `lib/i18n.ts`, `lib/help.ts`

**Шаг 6 — удалить**
- `lib/savings.ts`: `reconcile`, `flowsSince`, `gapStatus`, `applyReconcile`, `byCurrency`, `monthChange`, `migrateGoals`, `applyGoalOp`
- `lib/money.ts`: `verdict`, `unrecordedEntry`, `STALE_DAYS/daysSince/isStale`
- `components/money/UpdateBalances.tsx`, `app/api/reconcile/route.ts`, `ReconsRepo.add`, `LegacyRepo.importGoals`
- тесты сверки в `lib/savings.test.mjs`, `lib/money.test.mjs`; `partner.lastUpdatedAt`

## Мои предложения по спорным местам (ждут подтверждения)

1. **Семейные счета при миграции** → переходят в личные к владельцу семьи (`role = owner`); в лог пишется предупреждение.
   Создавать семейные счета больше нельзя.
2. **Записи** → таблицы `expenses` и `incomes` сохраняю, добавляю `account_id`, `account_amount` (сумма в валюте счёта),
   `goal_id`, `legacy`. Нынешние `amount/currency/rate` = `origAmount/origCurrency/rate`. Переводы и корректировки идут в
   новую таблицу `ledger_moves`. Единая таблица `entries` потребует переписать лимиты, план, регулярные платежи, архив и экспорт.
3. **Виды**: `personal → mine`, `family` по ТЗ. `all` оставить как «Всё»: мои счета, мои личные траты и семейное. Он не
   совпадает с `family`, потому что показывает мои личные траты поштучно.
4. **«Основной счёт»**: добавить флаг `primary` и выставить его при миграции. Выбирается счёт в валюте цели, а если такого
   нет — счёт с наибольшим остатком в базе. Семейную цель раскладываю по `goal_ops.by` (кто сколько откладывал) и только
   остаток кладу создателю.
5. **Siri, регулярные платежи и план** без явного счёта → последний использованный счёт автора. Если счетов нет → 400
   «Сначала добавьте счёт».
