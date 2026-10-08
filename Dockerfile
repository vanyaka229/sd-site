# Приёмник заявок для App Platform (Timeweb Cloud).
#
# Почему так: у Timeweb Cloud нет продукта «функции/serverless» — ни в каталоге
# услуг, ни в Public API (проверено: /api/v1/functions, /v2/functions, /serverless,
# /faas отдают 404; в официальном SDK нет ни одной модели про функции).
# Ближайшая замена «HTTPS из коробки» — App Platform: она сама выдаёт технический
# домен с сертификатом Let's Encrypt и умеет переменные окружения.
#
# ВАЖНО: этот Dockerfile собирает ТОТ ЖЕ приёмник, что разворачивался на VPS
# (deploy/vps-receiver/tg-receiver.js) — второй копии кода нет.
#
# В панели App Platform:
#   • при подключении репозитория выберите фреймворк «Dockerfile»;
#   • поле «Путь до директории проекта» оставьте пустым (Dockerfile в корне репозитория);
#   • путь проверки состояния: /health
#   • переменные окружения (Настройки → Переменные):
#       TG_BOT_TOKEN      — токен бота (@sddance_journal_bot)
#       TG_CHAT_ID        — 8653239953 (@sd_dancestudio)
#       ALLOWED_ORIGINS   — https://sd-dance-st.ru,https://www.sd-dance-st.ru,http://localhost
#     HOST=0.0.0.0 и PORT=8080 уже заданы ниже.
#
# Токена в этом файле нет и быть не должно: он живёт только в переменных панели.

FROM node:22-alpine

WORKDIR /app

# Копируем только то, что нужно приёмнику: никаких зависимостей у него нет.
COPY deploy/vps-receiver/tg-receiver.js ./tg-receiver.js

# Снаружи контейнера приложение должно слушать все интерфейсы, а не только localhost:
# запросы приходят от обратного прокси App Platform.
ENV HOST=0.0.0.0 \
    PORT=8080 \
    NODE_ENV=production

# EXPOSE обязателен: по нему платформа понимает, какой порт проксировать.
EXPOSE 8080

# Непривилегированный пользователь (в образе node он уже есть).
USER node

# Healthcheck внутри контейнера — платформа дополнительно проверяет /health.
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s \
  CMD wget -q -O - http://127.0.0.1:8080/health || exit 1

CMD ["node", "tg-receiver.js"]
