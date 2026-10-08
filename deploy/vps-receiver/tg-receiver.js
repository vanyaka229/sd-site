#!/usr/bin/env node
'use strict';

/*
 * Приёмник заявок SD Dance Studio: POST /tg -> api.telegram.org/bot<TOKEN>/sendMessage.
 *
 * Зачем: из Крыма api.telegram.org у браузера посетителя недоступен, поэтому сайт
 * уходит в мягкий режим с кнопкой. Сервер доступ к Telegram имеет, он и служит
 * посредником: сайт отправляет заявку сюда, а в Telegram её уводит сервер.
 *
 * Зависимостей нет — только стандартная библиотека Node (проверено на Node 18+).
 *
 * Настройка (переменные окружения, см. env.example):
 *   PORT                 порт, по умолчанию 8787 (слушаем только 127.0.0.1)
 *   HOST                 адрес прослушивания, по умолчанию 127.0.0.1
 *   TG_BOT_TOKEN         токен бота от @BotFather           (или TG_BOT_TOKEN_FILE)
 *   TG_CHAT_ID           получатели через запятую: '8653239953,123456789'
 *   TG_BOT_TOKEN_FILE    файл с токеном (по умолчанию /etc/sd-studio/tg-bot-token)
 *   TG_CHAT_ID_FILE      файл с chat_id  (по умолчанию /etc/sd-studio/tg-chat-id)
 *   ALLOWED_ORIGINS      белый список Origin через запятую
 *   TG_API_BASE          подмена api.telegram.org — только для автотестов
 *   TG_TIMEOUT           таймаут запроса в Telegram, мс (по умолчанию 10000)
 *   RATE_LIMIT_PER_MIN   ограничение запросов с одного IP (по умолчанию 10, 0 — выключить)
 *   DEDUP_SECONDS        окно защиты от дублей по телефону (по умолчанию 30, 0 — выключить)
 *
 * Токен и chat_id никогда не попадают в код репозитория и в логи.
 */

const http = require('http');
const https = require('https');
const fs = require('fs');

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '127.0.0.1';
const TG_API_BASE = process.env.TG_API_BASE || 'https://api.telegram.org';
const TG_TIMEOUT = Number(process.env.TG_TIMEOUT || 10000);
const MAX_BODY = 16 * 1024;              // 16 КБ — заявке хватает с большим запасом
const DEDUP_MS = Number(process.env.DEDUP_SECONDS === undefined ? 30 : process.env.DEDUP_SECONDS) * 1000;
const RATE_LIMIT = Number(process.env.RATE_LIMIT_PER_MIN === undefined ? 10 : process.env.RATE_LIMIT_PER_MIN);
const RATE_WINDOW = 60000;
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS
  || 'https://sd-dance-st.ru,https://www.sd-dance-st.ru,http://localhost')
  .split(',').map((s) => s.trim()).filter(Boolean);

function secretFromEnvOrFile(envName, fileEnvName, defaultFile) {
  const direct = process.env[envName];
  if (direct && direct.trim()) return direct.trim();
  const path = process.env[fileEnvName] || defaultFile;
  try {
    const value = fs.readFileSync(path, 'utf8').trim();
    if (value) return value;
    console.error(`[tg] файл ${path} пуст`);
    return '';
  } catch (err) {
    console.error(`[tg] не читается ${path}: ${err.code || err.message}`);
    return '';
  }
}

const BOT_TOKEN = secretFromEnvOrFile('TG_BOT_TOKEN', 'TG_BOT_TOKEN_FILE', '/etc/sd-studio/tg-bot-token');
const CHAT_IDS = secretFromEnvOrFile('TG_CHAT_ID', 'TG_CHAT_ID_FILE', '/etc/sd-studio/tg-chat-id')
  .split(',').map((s) => s.trim()).filter(Boolean);

if (!BOT_TOKEN || !CHAT_IDS.length) {
  console.error('[tg] нет TG_BOT_TOKEN или TG_CHAT_ID — сервер не стартует');
  process.exit(1);
}

const LIMITS = { name: 80, phone: 40, group: 80, comment: 600 };
const hits = new Map();     // ip -> { count, since }
const lastByPhone = new Map(); // телефон -> время последней заявки

/* --- вспомогательное ------------------------------------------------------ */

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .trim();
}

function corsHeaders(origin) {
  if (!origin || ALLOWED_ORIGINS.indexOf(origin) === -1) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function send(res, status, body, extra) {
  const text = JSON.stringify(body);
  res.writeHead(status, Object.assign({
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
  }, extra || {}));
  res.end(text);
}

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd) return fwd.split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
}

function rateLimited(ip) {
  if (!RATE_LIMIT) return false;
  const now = Date.now();
  const row = hits.get(ip);
  if (!row || now - row.since > RATE_WINDOW) {
    hits.set(ip, { count: 1, since: now });
    return false;
  }
  row.count += 1;
  return row.count > RATE_LIMIT;
}

function duplicate(phone) {
  if (!DEDUP_MS) return false;
  const now = Date.now();
  const prev = lastByPhone.get(phone);
  if (prev && now - prev < DEDUP_MS) return true;
  lastByPhone.set(phone, now);
  return false;
}

/* --- отправка в Telegram -------------------------------------------------- */

function sendToTelegram(text) {
  const base = new URL(TG_API_BASE);
  const lib = base.protocol === 'http:' ? http : https;
  const body = new URLSearchParams({
    chat_id: '', // подставляется ниже для каждого получателя
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: 'true',
  });

  const one = (chatId) => new Promise((resolve, reject) => {
    body.set('chat_id', chatId);
    const payload = body.toString();
    const req = lib.request({
      protocol: base.protocol,
      hostname: base.hostname,
      port: base.port || (base.protocol === 'http:' ? 80 : 443),
      path: `/bot${BOT_TOKEN}/sendMessage`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'Content-Length': Buffer.byteLength(payload),
      },
      timeout: TG_TIMEOUT,
    }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        raw += chunk;
        if (raw.length > 8192) res.destroy();
      });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          // message_id из ответа Telegram — прямое доказательство доставки в журнале
          let messageId = null;
          try { messageId = (JSON.parse(raw).result || {}).message_id || null; } catch (e) {}
          resolve({ chatId, status: res.statusCode, messageId });
        } else {
          // описание из Telegram («chat not found», «bot was blocked» и т.п.) — в лог, без токена
          let description = '';
          try { description = String(JSON.parse(raw).description || '').slice(0, 120); } catch (e) {}
          reject(new Error(`HTTP ${res.statusCode}${description ? ' — ' + description : ''}`));
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end(payload);
  });

  return Promise.all(CHAT_IDS.map(one));
}

/* --- разбор и проверка заявки -------------------------------------------- */

function validate(data) {
  const clean = {};
  const errors = [];
  ['name', 'phone', 'group', 'comment'].forEach((key) => {
    const raw = data[key];
    const value = typeof raw === 'string' ? raw.trim() : '';
    if (value.length > LIMITS[key]) errors.push(key);
    clean[key] = value;
  });
  if (clean.name.length < 2) errors.push('name');
  if (clean.phone.replace(/\D/g, '').length < 10) errors.push('phone');
  return { clean, errors };
}

function buildMessage(clean) {
  const lines = [
    '<b>Заявка с сайта SD Dance Studio</b>',
    'Имя: ' + escapeHtml(clean.name),
    'Телефон: ' + escapeHtml(clean.phone),
  ];
  if (clean.group) lines.push('Группа: ' + escapeHtml(clean.group));
  if (clean.comment) lines.push('Комментарий: ' + escapeHtml(clean.comment));
  return lines.join('\n');
}

/* --- HTTP ----------------------------------------------------------------- */

const server = http.createServer((req, res) => {
  const origin = req.headers.origin;

  if (req.method === 'OPTIONS') {
    if (origin && ALLOWED_ORIGINS.indexOf(origin) === -1) return send(res, 403, { ok: false, error: 'origin_not_allowed' });
    res.writeHead(204, Object.assign({ 'Content-Length': 0 }, corsHeaders(origin)));
    return res.end();
  }

  if (req.url === '/health') {
    return send(res, 200, { ok: true, bot: Boolean(BOT_TOKEN), chats: CHAT_IDS.length, uptime: Math.round(process.uptime()) });
  }

  if (req.url !== '/tg') return send(res, 404, { ok: false, error: 'not_found' });
  if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'method_not_allowed' }, { Allow: 'POST, OPTIONS' });
  if (origin && ALLOWED_ORIGINS.indexOf(origin) === -1) {
    console.warn('[tg] отклонён Origin:', origin);
    return send(res, 403, { ok: false, error: 'origin_not_allowed' });
  }
  const type = String(req.headers['content-type'] || '');
  if (type.indexOf('application/json') === -1) return send(res, 415, { ok: false, error: 'expected_application_json' });

  const declared = Number(req.headers['content-length'] || 0);
  if (declared > MAX_BODY) return send(res, 413, { ok: false, error: 'body_too_large' });

  const ip = clientIp(req);
  if (rateLimited(ip)) return send(res, 429, { ok: false, error: 'too_many_requests' }, corsHeaders(origin));

  let raw = '';
  let tooBig = false;
  req.setEncoding('utf8');
  req.on('data', (chunk) => {
    if (tooBig) return;
    raw += chunk;
    if (Buffer.byteLength(raw) > MAX_BODY) {
      tooBig = true;
      send(res, 413, { ok: false, error: 'body_too_large' }, corsHeaders(origin));
      req.destroy();
    }
  });
  req.on('end', () => {
    if (tooBig) return;

    let data;
    try {
      data = JSON.parse(raw || '{}');
    } catch (err) {
      return send(res, 400, { ok: false, error: 'bad_json' }, corsHeaders(origin));
    }
    if (!data || typeof data !== 'object') return send(res, 400, { ok: false, error: 'bad_json' }, corsHeaders(origin));

    // приманка для ботов: поле заполнено — молча отвечаем «ок», но никуда не шлём
    if (typeof data.company === 'string' && data.company.trim()) {
      console.log('[tg] honeypot: заявка отброшена');
      return send(res, 200, { ok: true }, corsHeaders(origin));
    }

    const { clean, errors } = validate(data);
    if (errors.length) {
      return send(res, 400, { ok: false, error: 'validation_failed', fields: errors }, corsHeaders(origin));
    }
    if (duplicate(clean.phone)) {
      console.log('[tg] дубль заявки за 30 с — не отправляю повторно');
      return send(res, 200, { ok: true, duplicate: true }, corsHeaders(origin));
    }

    const started = Date.now();
    sendToTelegram(buildMessage(clean))
      .then((rows) => {
        const ids = rows.map((r) => r.messageId).filter(Boolean).join(', ');
        console.log(`[tg] заявка отправлена в ${rows.length} чат(ов) за ${Date.now() - started} мс`
          + (ids ? ` (message_id ${ids})` : ''));
        send(res, 200, { ok: true }, corsHeaders(origin));
      })
      .catch((err) => {
        console.error('[tg] Telegram не принял заявку:', err.message);
        send(res, 502, { ok: false, error: 'telegram_failed' }, corsHeaders(origin));
      });
  });
});

server.headersTimeout = 20000;
server.requestTimeout = 20000;
server.listen(PORT, HOST, () => {
  console.log(`[tg] приёмник слушает http://${HOST}:${PORT}/tg | получателей: ${CHAT_IDS.length} | белый список: ${ALLOWED_ORIGINS.join(', ')}`);
});
