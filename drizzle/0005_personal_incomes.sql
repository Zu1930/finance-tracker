-- Доходы личные: владелец дохода — его автор. Строки incomes уже хранят author_id (scope у них нет);
-- семейными оставались только удалённые доходы в корзине (owner_id NULL) — их «Вернуть» мог любой участник.
-- Повторный запуск ничего не меняет: условие owner_id IS NULL
UPDATE "deleted_entries" SET "owner_id" = "entry"->>'authorId' WHERE "kind" = 'income' AND "owner_id" IS NULL AND "entry"->>'authorId' IS NOT NULL;
