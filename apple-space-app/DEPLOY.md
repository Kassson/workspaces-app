# Деплой: GitHub → Render

## Что переносить

В репозиторий идут **только текстовые файлы** (около 30 штук, ~1 МБ). Папку
`node_modules/` переносить **не нужно** — это 11 882 файла, именно она превышает
лимит загрузки. Render восстановит зависимости сам командой `npm ci`.

В репозиторий **не попадают** (перечислены в `.gitignore`):

| Что | Почему |
|---|---|
| `node_modules/` | восстанавливается из `package-lock.json` |
| `.env` | секреты; на Render задаются в Environment |
| `public/uploads/` | пользовательские файлы, не часть кода |

Файл `.env.example` **коммитится** — это шаблон без секретов.

---

## Шаг 1. Репозиторий на GitHub

```bash
cd apple-space-app

git init
git add .
git commit -m "Workspaces: initial deploy-ready commit"

# Создайте пустой репозиторий на github.com, затем:
git remote add origin https://github.com/ВАШ_ЛОГИН/workspaces.git
git branch -M main
git push -u origin main
```

Проверьте перед пушем, что секреты не уехали:

```bash
git status --short          # .env быть не должно
git ls-files | grep -c .    # ~30 файлов
```

Если `.env` уже попал в индекс — `git rm --cached .env` и **смените пароли**.

## Шаг 2. Деплой на Render (Blueprint)

В `render.yaml` уже описаны и веб-сервис, и база данных.

1. Render → **New** → **Blueprint** → подключите репозиторий.
2. Render прочитает `render.yaml` и создаст:
   - `workspaces-db` — PostgreSQL 16 (free);
   - `workspaces-app` — веб-сервис, `npm ci --omit=dev` → `node server.js`.
3. Render спросит значения для переменных с `sync: false`:

| Переменная | Что вписать |
|---|---|
| `JWT_SECRET` | случайная строка ≥32 символов (см. ниже) |
| `ROOT_TEACHER_PASSWORD` | пароль главного администратора |
| `ROOT_TEACHER_EMAIL` | почта root-аккаунта |
| `ALLOWED_ORIGIN` | адрес сервиса, напр. `https://workspaces-app.onrender.com` |
| `APP_URL` | тот же адрес |
| `YC_*` | ключи Object Storage (см. «Файлы» ниже); можно оставить пустыми |
| `VAPID_*` | ключи пушей; можно оставить пустыми |

`DATABASE_URL` подставляется автоматически из созданной базы.

Сгенерировать секрет:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

4. Дождитесь сборки. Проверка: `https://ВАШ-АДРЕС/api/health` должна вернуть
   `{"ok":true,"db":"ok",...}`.

> `PORT` задавать не нужно — Render подставляет свой.

## Шаг 3. Файлы (фото ДЗ, вложения чата) — выберите один вариант

**A. Yandex Object Storage — рекомендуется, работает на free-тарифе.**
Создайте бакет, получите ключи доступа и заполните `YC_ACCESS_KEY_ID`,
`YC_SECRET_ACCESS_KEY`, `YC_BUCKET_NAME`. Файлы переживают любые деплои.

**B. Локальный диск — просто, но с ограничениями.**
Если `YC_*` не заданы, сервер сам включится в локальный режим и будет писать
в `LOCAL_UPLOAD_DIR` (`/var/data/uploads`), раздавая файлы через
`/api/local-files/*`.

На **бесплатном** тарифе диск эфемерный: загруженные файлы исчезнут при
следующем деплое или перезапуске сервиса. Чтобы этого не было, нужен платный
**Persistent Disk**: раскомментируйте блок `disk:` в `render.yaml`
(mountPath `/var/data`, размер 1 ГБ) и переведите сервис на платный план.

## Шаг 4. После первого деплоя

- В `ALLOWED_ORIGIN` впишите фактический адрес сервиса (не `*`).
- Войдите как `root_teacher` и смените пароль.
- Создайте группу и проверьте цепочку: ДЗ с фото → сдача с телефона →
  «Статистика» → настройки группы → чат с вложением → импорт/экспорт журнала.

## Обновление версии

Render включил `autoDeploy: true`, поэтому достаточно:

```bash
git add .
git commit -m "правки"
git push
```

**Важно про кэш:** если правили `public/*`, поднимите `APP_VERSION` в
`public/index.html` и `public/teach/index.html`, `APP_ASSET_VERSION` в
`public/shared.js` и `CACHE_NAME` в `public/sw.js` на одну и ту же цифру —
иначе у пользователей останутся старые файлы в кэше браузера.

## Ограничения Render, о которых стоит знать

- **Один инстанс.** В приложении работают websocket-сервер и внутренние
  таймеры (напоминания о парах, чистка сообщений). Не поднимайте больше одной
  копии сервиса без настройки sticky sessions.
- **Спящий режим.** На free-тарифе сервис засыпает без трафика; первый запрос
  после паузы отвечает медленно (~30–60 с).
- **Схема БД** создаётся и обновляется автоматически при старте (`schema.sql`).
  Отдельная команда миграции не нужна.

## Переменные окружения (полный список)

Читаются кодом: `JWT_SECRET`, `ROOT_TEACHER_PASSWORD`, `ROOT_TEACHER_EMAIL`,
`DATABASE_URL`, `PORT`, `ALLOWED_ORIGIN`, `APP_URL`, `SCHEDULE_TIMEZONE`,
`LOCAL_UPLOAD_DIR`, `YC_ACCESS_KEY_ID`, `YC_SECRET_ACCESS_KEY`,
`YC_BUCKET_NAME`, `YC_REGION`, `YC_ENDPOINT`, `VAPID_PUBLIC_KEY`,
`VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`.

Плюс `RESEND_API_KEY` и `EMAIL_FROM` — их читает `email.js`, но этот модуль
**сейчас нигде не подключён**, поэтому письма не отправляются. Сброс пароля
работает через код от преподавателя, и почта для него не нужна.

## Проверки перед пушем

```bash
npm ci          # зависимости
npm test        # кодировка + статика клиента + 63 теста API
```

## Локальный запуск в Docker (опционально)

```bash
docker build -t workspaces .
docker run --env-file .env -p 3000:3000 workspaces
```

Образ повторяет серверное окружение и удобен, чтобы поймать проблемы до Render.
