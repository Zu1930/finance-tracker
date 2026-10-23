# Бэкапы и восстановление

Каждую ночь (01:15 UTC, то есть 02:15 зимой и 03:15 летом по Белграду) workflow `.github/workflows/backup.yml`
делает `pg_dump` production-базы, сжимает gzip и шифрует [age](https://age-encryption.org) публичным ключом.
Готовый файл `daily/spendlog-<дата>.sql.gz.age` коммитится в приватный репозиторий бэкапов. Там хранятся
последние 30 файлов; старые удаляются из рабочей копии, но остаются в истории git.

Незашифрованный дамп не попадает ни на диск раннера, ни в репозиторий. Расшифровать бэкап можно только
приватным ключом, а он хранится только офлайн. Workflow можно запустить вручную: Actions → Backup → Run workflow.

## Настройка (один раз)

1. **Ключ шифрования.** На своём компьютере:
   ```sh
   age-keygen -o backup.key        # выведет: Public key: age1…
   ```
   - Публичный ключ `age1…` → секрет `BACKUP_AGE_RECIPIENT` в репозитории приложения.
   - `backup.key` → менеджер паролей и офлайн-копия. Без этого ключа бэкапы бесполезны.
     В репозиторий, в CI и в Vercel его не кладите.
2. **Репозиторий бэкапов.** Создайте приватный репозиторий с первым коммитом (например, с README).
3. **Deploy key.**
   ```sh
   ssh-keygen -t ed25519 -N "" -C spendlog-backup -f backup_deploy
   ```
   - `backup_deploy.pub` → Settings → Deploy keys репозитория бэкапов, с галочкой **Allow write access**.
   - Содержимое `backup_deploy` → секрет `BACKUP_DEPLOY_KEY` в репозитории приложения. Затем удалите оба файла с диска.
4. **Подключение к базе.** Секрет `DATABASE_URL_UNPOOLED` — прямая строка подключения к production-базе Neon:
   хост без `-pooler`, её же Vercel кладёт в `DATABASE_URL_UNPOOLED`.
5. **Адрес репозитория.** Переменная (Variables, не Secrets) `BACKUP_REPO` = `git@github.com:<owner>/<repo>.git`.
6. Запустите workflow вручную и убедитесь, что в репозитории бэкапов появился файл.

## Восстановление

Понадобятся `age`, `gunzip` и `psql` (`brew install age libpq`). База в Neon — PostgreSQL 18; `psql` любой
современной версии восстановит текстовый дамп. Workflow сам ставит `pg_dump` той же версии, что и сервер.
Расшифрованный дамп на диск не пишется: всё идёт одним конвейером.

1. **Возьмите файл бэкапа** из репозитория бэкапов (`git clone` или Download raw), например `spendlog-2026-10-24T0115Z.sql.gz.age`.

2. **Проверьте, что ключ подходит и файл цел.** Должно вывести начало SQL-дампа:
   ```sh
   age -d -i backup.key spendlog-2026-10-24T0115Z.sql.gz.age | gunzip | head -20
   ```

3. **Создайте ветку Neon** для восстановления: Console → проект → Branches → New branch,
   имя `restore-2026-10-24`, родитель — production-ветка. Скопируйте её прямую строку подключения
   (Connect → снять галочку Connection pooling).
   Новая ветка уже содержит текущие данные родителя, поэтому восстанавливайте в отдельную пустую базу этой ветки:
   ```sh
   BRANCH_URL='postgresql://…@ep-…/neondb?sslmode=require'
   psql "$BRANCH_URL" -c 'CREATE DATABASE restore'
   # та же строка, но база restore вместо neondb
   RESTORE_URL='postgresql://…@ep-…/restore?sslmode=require'
   ```

4. **Восстановите.** Дамп создан с `--no-owner --no-privileges`, поэтому подходит для любой роли:
   ```sh
   age -d -i backup.key spendlog-2026-10-24T0115Z.sql.gz.age | gunzip | psql -v ON_ERROR_STOP=1 -q "$RESTORE_URL"
   ```
   `ON_ERROR_STOP=1` прерывает восстановление на первой ошибке. Если команда завершилась без ошибок, восстановлено всё.

5. **Проверьте.**
   ```sh
   psql "$RESTORE_URL" -c "select (select count(*) from expenses) expenses, (select count(*) from incomes) incomes, (select max(date) from expenses) last_expense"
   # Журнал миграций тоже в дампе: ничего не применится. PRODUCTION_DB_HOST=- — эта база не production
   DATABASE_URL="$RESTORE_URL" PRODUCTION_DB_HOST=- npm run db:migrate
   ```
   Посмотреть данные в приложении:
   ```sh
   DATA_BACKEND=postgres DATABASE_URL="$RESTORE_URL" npm run dev
   ```

6. **Переключите production на восстановленные данные**, если это нужно. В Vercel замените `DATABASE_URL`
   и `DATABASE_URL_UNPOOLED` на строки базы `restore` этой ветки (pooled и прямую) и сделайте Redeploy.
   Старая ветка остаётся нетронутой, пока вы её не удалите.

## Проверка восстановления

| Дата | Где | Результат |
|---|---|---|
| 2026-10-23 | Локальный Postgres 16 (Docker) на данных после переноса из Redis | `pg_dump --no-owner --no-privileges` → gzip → восстановление с `ON_ERROR_STOP=1` в пустую базу прошло без ошибок. Все 21 таблица совпадает с исходной по числу строк и md5 содержимого; журнал миграций Drizzle восстановлен (1 запись). Шифрование age в этой проверке не участвовало. |
| 2026-10-23 | Ветка Neon `staging` (`ep-hidden-star-b9v23bl5`), PostgreSQL 18.6 | Тестовый дамп → gzip → `age -r` тестовым ключом: на диске только шифротекст, заголовок `age-encryption.org/v1`. `age -d … \| gunzip \| psql -v ON_ERROR_STOP=1` в отдельную пустую базу `restore_check` ветки прошёл без ошибок. Все 21 таблица совпадает с исходной по числу строк и md5 содержимого, журнал миграций восстановлен. `restore_check` после проверки удалена, `neondb` не затрагивалась. |
