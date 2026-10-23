# Переключение входа на Better Auth

Runbook для одного переключения. Выполняет человек с доступом к Vercel и Neon. Каждый шаг проверяется перед следующим.
Займёт около 20 минут. Данные бюджета не меняются: добавляются таблицы входа и email у двух пользователей.

После деплоя старые cookie `ft_session` перестают работать: оба пользователя один раз входят заново по email и
прежнему паролю.

## Перед началом

- [ ] Production работает на Postgres (`docs/cutover.md` выполнен), бэкапы настроены (`docs/restore.md`).
- [ ] Выбраны email обоих пользователей.
- [ ] Ветка с Better Auth проверена на preview со staging-базой (раздел «Проверка на preview» ниже).
- [ ] Локально: Node 22, репозиторий на коммите, который пойдёт в production, выполнен `npm ci`.

## Подготовка окружения

Как в `docs/cutover.md`: файл `.env.cutover.local` (не попадает в git) со строкой из **Vercel → Storage → база
Neon → Show secret** и прежними паролями из Vercel (Settings → Environment Variables → `PASSWORD_VLAD`,
`PASSWORD_MASHA`):

```sh
DATABASE_URL_UNPOOLED='…'
MIGRATE_USERS='vlad:<email Влада>,masha:<email Маши>'
PASSWORD_VLAD='…'
PASSWORD_MASHA='…'
```

```sh
set -a; source .env.cutover.local; set +a
export PRODUCTION_DB_HOST="$(node -e 'console.log(new URL(process.env.DATABASE_URL_UNPOOLED).hostname)')"
echo "$PRODUCTION_DB_HOST"   # должен быть ep-dawn-breeze-…, а не другой проект Neon
```

## Шаги

### 1. Бэкап

Actions → **Backup** → Run workflow. Дождитесь зелёного запуска и нового файла в репозитории бэкапов.

### 2. Миграции и пользователи

```sh
npm run db:migrate -- --production
npm run db:migrate-users -- --production --dry-run
```
Ожидаемо: `ПРОБНЫЙ ЗАПУСК` и обе строки `пароль: задан`. Ошибка `нет в users` значит, что база не та.

```sh
npm run db:migrate-users -- --production
```
Повторный запуск безопасен: заданный пароль он не меняет (`пароль: уже был`).

Старая версия приложения на новые таблицы не смотрит, поэтому до деплоя всё работает как раньше.

### 3. Переменные и деплой

Vercel → Settings → Environment Variables, окружение **Production**:
- `BETTER_AUTH_SECRET` = вывод `openssl rand -hex 32`, тип Sensitive;
- `BETTER_AUTH_URL` = адрес production, например `https://<проект>.vercel.app`, без `/` в конце.
  Это адрес, по которому пользователи открывают приложение. С другого адреса вход будет отклонён.

`USERS`, `PASSWORD_*`, `SESSION_SECRET` пока **не удаляйте**: они нужны предыдущему деплою для отката.

Затем задеплойте ветку в production (merge в main или Redeploy нового коммита).

### 4. Проверка

Под **каждым** пользователем:
- [ ] Открыть приложение → экран `:: AUTH` → вход по email и прежнему паролю.
- [ ] Траты на месте. Записать тестовую трату → появилась → удалить.
- [ ] Настройки → `:: АККАУНТ`: email верный, в «Активных сессиях» есть это устройство.
- [ ] Быстрые команды: фраза в Siri записывает трату по прежнему токену (потом удалите её). Токены не меняются.
- [ ] Vercel → Logs: нет ошибок 500.

Затем удалите `.env.cutover.local`: `rm .env.cutover.local`.

### 5. Уборка — через неделю, когда откат уже не понадобится

Удалите из Vercel `USERS`, `PASSWORD_VLAD`, `PASSWORD_MASHA`, `SESSION_SECRET`, `MIGRATION_OWNER` (если есть)
и `DATA_BACKEND`: новый код их не читает.

## Откат

Vercel → Deployments → предыдущий production-деплой → **⋯ → Promote to Production** (Instant Rollback).
Старая версия входит по `USERS`/`PASSWORD_*` и выбору пользователя кнопками. Таблицы Better Auth и новые
столбцы `users` ей не мешают. Данные бюджета общие, ничего переносить не нужно.

Пароль, сменённый в новой версии, в старой не действует: там вход по прежнему паролю из Vercel.

## Проверка на preview

Preview-деплой со staging-базой, до production:

1. В Neon создайте ветку от production (Branches → New branch). В ней та же схема и данные, а production
   не меняется. Строка подключения — Connect, прямая (без pooling).
2. Vercel → Environment Variables, окружение **Preview**: `DATABASE_URL` и `DATABASE_URL_UNPOOLED` — строки этой
   ветки, `BETTER_AUTH_SECRET` — отдельный секрет. `BETTER_AUTH_URL` для preview не нужен: адрес берётся из
   системных переменных Vercel.
3. Локально с `DATABASE_URL_UNPOOLED` ветки и `PRODUCTION_DB_HOST` production: `npm run db:migrate`, затем
   `npm run db:migrate-users` (без `--production`: это не production).
4. Запушьте ветку и откройте её preview. Пройдите шаг 4 под обоими пользователями, плюс: неверный пароль даёт
   `!! НЕВЕРНЫЙ EMAIL ИЛИ ПАРОЛЬ`; смена пароля; «Завершить» другую сессию; «Выйти везде, кроме этого»; «Выйти».
5. Удалите ветку Neon после проверки.
