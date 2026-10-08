# Приёмник заявок на VPS

> **Статус на 8 октября 2026: развёртывание на VPS остановлено.**
> Порт 443 занят VPN-контейнером Amnezia (xray/Reality) — он же предъявляет чужой сертификат
> `*.google-analytics.com`: это маскировка VPN, а не поломка. Пока 443 занят, HTTPS для
> `api.sd-dance-st.ru` на этом сервере не поднять. Приёмник и nginx развёрнуты и проверены,
> файлы на сервере оставлены, службы выключены и сняты с автозапуска.
> Инструкция остаётся рабочей на случай, если владелец освободит 443.
> Актуальный путь — App Platform: [ПРИЁМНИК-ЧЕРЕЗ-APP-PLATFORM.md](ПРИЁМНИК-ЧЕРЕЗ-APP-PLATFORM.md).

Актуально на 8 октября 2026. Разворачивается на VPS владельца; хостинг сайта остаётся
на GitHub Pages, домен — `sd-dance-st.ru`.

## Зачем это нужно

Сайт отправляет заявку прямо из браузера посетителя на `api.telegram.org`. В Крыму и у части
провайдеров РФ этот адрес недоступен — заявка не уходит, и человек видит мягкий режим
«Заявка готова, отправьте одним нажатием» с кнопкой.

Сервер доступ к Telegram имеет, поэтому он становится посредником:

```
браузер посетителя
      │  POST https://api.sd-dance-st.ru/tg  (JSON: имя, телефон, группа, комментарий)
      ▼
VPS: nginx → tg-receiver.js (127.0.0.1:8787)
      │  POST https://api.telegram.org/bot<TOKEN>/sendMessage
      ▼
Telegram → владельцу приходит готовая заявка
```

Порядок попыток в `js/main.js` после этой правки: **наш приёмник → `api.telegram.org` → мягкий
режим с кнопкой**. То есть если VPS недоступен, сайт ведёт себя как раньше, ничего не ломается.

## Что понадобится

* VPS с Ubuntu 22.04 или 24.04, доступ по SSH, права `sudo`;
* одна DNS-запись: `api.sd-dance-st.ru` → IP сервера (см. ниже);
* токен бота и chat_id — те же, что уже работают на сайте (`js/main.js`).

## Шаг 0. DNS

| Тип | Имя | Значение | TTL |
| --- | --- | --- | --- |
| A | `api` | `<IP вашего VPS>` | 300–600 |

Через API Timeweb Cloud (проверено на этом домене):

```
POST https://api.timeweb.cloud/api/v1/domains/sd-dance-st.ru/dns-records
{ "type": "A", "value": "<IP>", "ttl": 600, "subdomain": "api" }
```

Важная деталь, найденная на практике: для **корня** домена API требует `subdomain` равным
полному имени (`sd-dance-st.ru`), а `@`, пустая строка и пропуск поля дают
`400 bad_subdomain_name`. Для поддоменов (`api`, `www`) достаточно короткого имени.

Проверка: `dig +short api.sd-dance-st.ru A` должен вернуть IP сервера.

## Шаг 1. Пакеты

```bash
sudo apt update
sudo apt install -y nginx nodejs certbot python3-certbot-nginx
node -v    # нужен 18 или новее; зависимостей у приёмника нет
```

## Шаг 2. Пользователь, код и секреты

```bash
# отдельный системный пользователь без логина
sudo useradd --system --no-create-home --shell /usr/sbin/nologin sdtg

# код приёмника
sudo mkdir -p /opt/sd-tg-receiver
sudo cp tg-receiver.js VPS-ПРИЁМНИК.md /opt/sd-tg-receiver/
sudo chown -R root:sdtg /opt/sd-tg-receiver
sudo chmod 750 /opt/sd-tg-receiver

# секреты: только root может читать, группа sdtg — тоже (systemd читает EnvironmentFile от root)
sudo mkdir -p /etc/sd-studio
sudo install -m 600 -o root -g root env.example /etc/sd-studio/tg-receiver.env
sudo nano /etc/sd-studio/tg-receiver.env     # впишите TG_BOT_TOKEN и проверьте TG_CHAT_ID
```

Токен и chat_id лежат **только** в `/etc/sd-studio/tg-receiver.env` (`chmod 600`). В коде,
в юните systemd и в репозитории их нет — юнит читает файл сам.

## Шаг 3. systemd

```bash
sudo cp tg-receiver.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now tg-receiver
systemctl status tg-receiver --no-pager
curl -s http://127.0.0.1:8787/health
# {"ok":true,"bot":true,"chats":1,"uptime":3}
```

Логи: `journalctl -u tg-receiver -f`. Токен в логи не пишется — только факт отправки и время.

## Шаг 4. nginx и сертификат

```bash
sudo cp nginx-api.sd-dance-st.ru.conf /etc/nginx/sites-available/api.sd-dance-st.ru
sudo ln -s /etc/nginx/sites-available/api.sd-dance-st.ru /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

sudo certbot --nginx -d api.sd-dance-st.ru     # выпустит сертификат и допишет 443 + редирект
sudo systemctl status certbot.timer            # автопродление включено
```

Фаервол (если включён `ufw`): наружу нужны только 80 и 443, порт 8787 остаётся локальным.

```bash
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

## Шаг 5. Проверка

```bash
# 1. Здоровье через HTTPS
curl -s https://api.sd-dance-st.ru/health
# {"ok":true,"bot":true,"chats":1,"uptime":...}

# 2. Настоящая заявка с пометкой «тест»
curl -s -X POST https://api.sd-dance-st.ru/tg \
  -H 'Content-Type: application/json' \
  -H 'Origin: https://sd-dance-st.ru' \
  -d '{"name":"ТЕСТ","phone":"+7 949 000 00 00","group":"Dancehall 10+","comment":"контрольная заявка, проверка приёмника"}'
# {"ok":true}   и заявка появляется в Telegram (@sd_dancestudio)

# 3. Экран ошибок
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://api.sd-dance-st.ru/tg -H 'Content-Type: text/plain' -d '{}'   # 415
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://api.sd-dance-st.ru/tg -H 'Origin: https://evil.example' -H 'Content-Type: application/json' -d '{}'   # 403
curl -s -o /dev/null -w '%{http_code}\n' https://api.sd-dance-st.ru/tg   # 405
```

Что означают ответы:

| Код | Тело | Когда |
| --- | --- | --- |
| 200 | `{"ok":true}` | заявка принята и ушла в Telegram (или это дубль за 30 с) |
| 400 | `bad_json`, `validation_failed` | не разобрали JSON или не хватает имени/телефона |
| 403 | `origin_not_allowed` | Origin не из белого списка |
| 404 | `not_found` | путь не `/tg` |
| 405 | `method_not_allowed` | не POST |
| 413 | `body_too_large` | тело больше 16 КБ |
| 415 | `expected_application_json` | `Content-Type` не JSON |
| 429 | `too_many_requests` | больше 10 заявок с одного IP в минуту |
| 502 | `telegram_failed` | Telegram не принял сообщение (сайт уйдёт в мягкий режим) |

Запросы без заголовка `Origin` разрешены — так работает `curl` и внутренние проверки.
Белый список настраивается переменной `ALLOWED_ORIGINS`.

## Шаг 6. Со стороны сайта

В `js/main.js` адрес приёмника задан отдельной константой:

```js
var BOOKING_SERVER = 'https://api.sd-dance-st.ru/tg';
```

Сайт сначала пробует приёмник (таймаут 5 с), затем `api.telegram.org` (7 с), затем мягкий режим
с кнопкой. Ничего дополнительно настраивать не нужно; если приёмник выключить, сайт продолжит
работать по старой схеме.

## Доступные переменные

| Переменная | По умолчанию | Зачем |
| --- | --- | --- |
| `PORT` / `HOST` | `8787` / `127.0.0.1` | где слушать (наружу смотрит nginx) |
| `TG_BOT_TOKEN` | — | токен бота; можно вместо этого `TG_BOT_TOKEN_FILE` |
| `TG_CHAT_ID` | — | получатели через запятую; можно `TG_CHAT_ID_FILE` |
| `ALLOWED_ORIGINS` | `https://sd-dance-st.ru,https://www.sd-dance-st.ru,http://localhost` | белый список Origin |
| `TG_TIMEOUT` | `10000` | таймаут запроса в Telegram, мс |
| `RATE_LIMIT_PER_MIN` | `10` | запросов с одного IP в минуту (`0` — выключить) |
| `DEDUP_SECONDS` | `30` | защита от повторной заявки с тем же телефоном (`0` — выключить) |
| `TG_API_BASE` | `https://api.telegram.org` | только для автотестов |

## Если что-то сломалось

* **502 в ответе и заявки не идут.** Проверьте доступ сервера к Telegram:
  `curl -s -o /dev/null -w '%{http_code}\n' https://api.telegram.org` (ждём 200). Если сервер
  в России/Крыму и Telegram блокируется — приёмник не поможет, вопрос к провайдеру VPS.
* **Не стартует юнит.** `journalctl -u tg-receiver -n 50` — чаще всего не заполнен
  `/etc/sd-studio/tg-receiver.env` или порт занят.
* **Сайт уходит в мягкий режим, хотя приёмник жив.** Проверьте `ALLOWED_ORIGINS` — в списке
  должны быть оба адреса сайта, включая `https://www.sd-dance-st.ru`; смотрите
  `/var/log/nginx/api.sd-dance-st.ru.access.log`.
* **Сменили токен бота** (`/revoke` у @BotFather) — правьте только
  `/etc/sd-studio/tg-receiver.env` и перезапускайте юнит: `sudo systemctl restart tg-receiver`.

## Автотест без VPS

Приёмник можно проверить локально, подменив Telegram мок-сервером:

```bash
node sd-studio-design/tools/test_vps_receiver.cjs
```

Тест поднимает приёмник на 127.0.0.1, шлёт заявки и проверяет 24 сценария: успешную отправку,
экранирование HTML, белый список Origin, preflight, лимит тела, проверку полей, приманку для
ботов, защиту от дублей, ошибку Telegram (502), ограничение частоты (429) и отсутствие секретов
в логах.
