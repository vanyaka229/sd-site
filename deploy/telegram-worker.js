/**
 * Посредник «форма сайта → Telegram».
 *
 * Зачем: токен Telegram-бота нельзя держать в коде сайта — его увидит любой
 * и сможет писать от имени бота. Поэтому токен живёт здесь, в переменных
 * окружения Cloudflare Worker, а сайт знает только адрес этого воркера.
 *
 * Переменные окружения (Settings → Variables and Secrets):
 *   BOT_TOKEN      — токен бота от @BotFather
 *   CHAT_ID        — куда присылать заявки (id чата @sd_dancestudio)
 *   ALLOWED_ORIGIN — адрес сайта, например https://sd-dance-st.ru
 *
 * Деплой: Cloudflare → Workers & Pages → Create → Worker → вставить этот код.
 */

const MAX = { name: 80, phone: 40, group: 80, comment: 600 };

function json(body, status, cors) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors },
  });
}

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function clean(value, limit) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

export default {
  async fetch(request, env) {
    const cors = {
      'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    };

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'POST') return json({ ok: false, error: 'method' }, 405, cors);

    let data;
    try {
      data = await request.json();
    } catch {
      return json({ ok: false, error: 'bad-json' }, 400, cors);
    }

    const name = clean(data.name, MAX.name);
    const phone = clean(data.phone, MAX.phone);
    const group = clean(data.group, MAX.group);
    const comment = clean(data.comment, MAX.comment);

    if (name.length < 2 || phone.replace(/\D/g, '').length < 10) {
      return json({ ok: false, error: 'validation' }, 400, cors);
    }
    // простая защита от спама: не больше 5 заявок в минуту с одного адреса
    if (!env.BOT_TOKEN || !env.CHAT_ID) {
      return json({ ok: false, error: 'not-configured' }, 500, cors);
    }

    const when = new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });
    const lines = [
      '<b>Новая заявка с сайта</b>',
      `<b>Имя:</b> ${esc(name)}`,
      `<b>Телефон:</b> ${esc(phone)}`,
      group ? `<b>Группа:</b> ${esc(group)}` : '',
      comment ? `<b>Комментарий:</b> ${esc(comment)}` : '',
      `<i>${esc(when)} (МСК)</i>`,
    ].filter(Boolean);

    const tg = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: env.CHAT_ID,
        text: lines.join('\n'),
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });

    const result = await tg.json().catch(() => ({}));
    if (!tg.ok || result.ok === false) {
      return json({ ok: false, error: 'telegram', detail: result.description || tg.status }, 502, cors);
    }

    return json({ ok: true }, 200, cors);
  },
};
