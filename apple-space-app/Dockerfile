# ============================================================================
#  Dockerfile — воспроизводимый образ приложения.
#
#  Render НЕ требует Docker: в render.yaml указан обычный Node-рантайм.
#  Этот файл нужен, чтобы прогнать ровно то же окружение локально:
#      docker build -t workspaces .
#      docker run --env-file .env -p 3000:3000 workspaces
#
#  ВАЖНО: без JWT_SECRET и ROOT_TEACHER_PASSWORD контейнер намеренно упадёт —
#  передайте их через --env-file или -e.
# ============================================================================
FROM node:20-bookworm-slim

# Часовой пояс: влияет на напоминания о парах
ENV TZ=Europe/Moscow
ENV NODE_ENV=production

WORKDIR /app

# 1) Зависимости отдельным слоем — пересобираются только при смене package*.json
#    --include=dev не нужен: сборки/транспиляции в проекте нет.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund \
    && npm cache clean --force

# 2) Код приложения
COPY . .

# 3) Каталог для локального режима хранилища.
#    В render.yaml он переопределён на /var/data/uploads (постоянный диск).
#    Здесь используем отдельный путь вне public/, чтобы файлы не попадали
#    в статику напрямую — раздача идёт через /api/local-files/*.
RUN mkdir -p /var/data/uploads \
    && chown -R node:node /var/data /app

# Не работаем от root
USER node

# Render сообщает порт через переменную PORT; 3000 — значение по умолчанию
ENV PORT=3000
EXPOSE 3000

# Проверка работоспособности (в образе есть только сам Node, без curl/wget)
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
