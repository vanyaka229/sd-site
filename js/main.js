/* SD Dance Studio — интерактив: мобильное меню, запись, появление блоков. */
/**
 * НАСТРОЙКА ЗАЯВОК — заполните две строки, и форма начнёт присылать заявки в Telegram.
 *
 * TELEGRAM_BOT_TOKEN — токен бота, который выдаёт @BotFather (Send /newbot).
 * TELEGRAM_CHAT_ID   — кому присылать: id вашего аккаунта. Узнать так:
 *                      1) создайте бота у @BotFather и скопируйте токен;
 *                      2) напишите своему боту любое сообщение (Start);
 *                      3) откройте https://api.telegram.org/bot<ТОКЕН>/getUpdates
 *                         и скопируйте число из "chat": { "id": ... }.
 *
 * Пример:
 *   var TELEGRAM_BOT_TOKEN = '7123456789:AAH3k...Qw9E';
 *   var TELEGRAM_CHAT_ID = '123456789';
 *
 * ВАЖНО: в этом режиме токен виден в исходнике страницы — так делают ради простоты.
 * Если бота начнут использовать для спама, перевыпустите токен у @BotFather
 * и замените строку ниже. Более защищённый вариант (токен на сервере, без правок
 * в сайте) описан в deploy/README-telegram.md.
 *
 * Пока строки пустые, форма открывает Telegram с готовым текстом заявки.
 */
var TELEGRAM_BOT_TOKEN = '8936238994:AAESTNjGWSDPqnoifiMPTsgXqM9E-FgilU0';
var TELEGRAM_CHAT_ID = '8653239953';

/* Необязательно: свой приёмник заявок (если появится). Имеет приоритет над Telegram. */
var BOOKING_ENDPOINT = '';

/* Куда открывать ручную отправку, если автоматическая не прошла.
   Это НЕ api.telegram.org: ссылка t.me/<username>?text=... открывает чат студии
   с уже заполненным текстом заявки. Работает на любом устройстве, в том числе
   там, где api.telegram.org недоступен (Крым, часть провайдеров РФ).
   @username студии — из настроек: @sd_dancestudio. */
var TELEGRAM_USERNAME = 'sd_dancestudio';
var TELEGRAM_SEND_BASE = 'https://t.me/' + TELEGRAM_USERNAME + '?text=';
(function () {
  'use strict';

  /* --- Мобильное меню ---------------------------------------------------- */
  var burger = document.querySelector('.burger');
  var menu = document.querySelector('.mobile-menu');

  function closeMenu() {
    if (!burger || !menu) return;
    burger.setAttribute('aria-expanded', 'false');
    menu.removeAttribute('data-open');
  }

  if (burger && menu) {
    burger.addEventListener('click', function () {
      var open = burger.getAttribute('aria-expanded') === 'true';
      burger.setAttribute('aria-expanded', String(!open));
      if (open) {
        menu.removeAttribute('data-open');
      } else {
        menu.setAttribute('data-open', 'true');
      }
    });

    menu.addEventListener('click', function (event) {
      if (event.target.closest('a')) closeMenu();
    });
  }

  /* --- Модальное окно записи ------------------------------------------- */
  var modal = document.getElementById('booking');
  var lastFocused = null;

  function openModal(event) {
    if (!modal) return;
    if (event) event.preventDefault();
    lastFocused = document.activeElement;
    modal.setAttribute('data-open', 'true');
    document.body.style.overflow = 'hidden';
    var focusable = modal.querySelector('a, button');
    if (focusable) focusable.focus();
  }

  function closeModal() {
    if (!modal) return;
    modal.setAttribute('data-open', 'false');
    document.body.style.overflow = '';
    if (lastFocused && lastFocused.focus) lastFocused.focus();
  }

  document.addEventListener('click', function (event) {
    if (event.target.closest('[data-booking]')) {
      openModal(event);
      closeMenu();
      return;
    }
    if (event.target.closest('[data-close]')) {
      closeModal();
      return;
    }
    if (event.target === modal) closeModal();
  });

  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Escape') return;
    if (modal && modal.getAttribute('data-open') === 'true') closeModal();
    closeMenu();
  });


  /* --- Липкая кнопка на телефоне и кнопка «наверх» ---------------------- */
  var mobileCta = document.querySelector('.mobile-cta');
  var toTop = document.querySelector('.to-top');

  // Класс has-mobile-cta переключает js/motion.js: кнопка выезжает, когда
  // герой прокручен. Здесь только страховка, если motion.js не подключён.
  if (mobileCta && !document.querySelector('.read-progress')) {
    document.body.classList.add('has-mobile-cta');
    mobileCta.classList.add('is-visible');
  }
  if (toTop && !document.querySelector('.read-progress')) {
    var fallbackScroll = function () {
      toTop.classList.toggle('is-visible', window.scrollY > 600);
    };
    window.addEventListener('scroll', fallbackScroll, { passive: true });
    fallbackScroll();
  }

  document.addEventListener('click', function (event) {
    if (event.target.closest('.to-top')) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  });

  /* --- Форма записи ------------------------------------------------------ */
  var form = document.querySelector('.booking-form');

  if (form) {
    var status = form.querySelector('.form-status');
    var submit = form.querySelector('button[type="submit"]');
    var DRAFT_KEY = 'sd_booking_draft';

    var setStatus = function (text, state) {
      if (!status) return;
      status.textContent = text;
      if (state) status.setAttribute('data-state', state);
      else status.removeAttribute('data-state');
    };

    /* Кнопка ручной отправки и сохранённая «готовая» заявка. */
    var manual = form.querySelector('.booking-form__manual');
    var READY_KEY = 'sd_booking_ready';
    var lastMessage = '';
    /* Мягкий текст вместо слова «ошибка»: заявка готова, её осталось отправить. */
    var SOFT_TEXT = 'Заявка готова — отправьте её одним нажатием: откроется чат студии с готовым текстом.';

    /* Копирование в буфер — запасной путь, если Telegram не установлен.
       navigator.clipboard есть только в защищённом контексте (https), поэтому
       для file:// и старых браузеров держим второй способ через execCommand. */
    var copyToClipboard = function (text) {
      var fallback = function () {
        try {
          var area = document.createElement('textarea');
          area.value = text;
          area.setAttribute('readonly', '');
          area.style.position = 'fixed';
          area.style.top = '-2000px';
          document.body.appendChild(area);
          area.select();
          document.execCommand('copy');
          document.body.removeChild(area);
        } catch (e) {}
      };
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text)['catch'](fallback);
          return;
        }
      } catch (e) {}
      fallback();
    };

    var rememberReady = function (text) {
      try { localStorage.setItem(READY_KEY, text); } catch (e) {}
    };

    // Прошлую «готовую» заявку не теряем: окно откроется с уже живой кнопкой.
    try {
      var readySaved = localStorage.getItem(READY_KEY);
      if (readySaved) {
        lastMessage = readySaved;
        if (manual) {
          manual.hidden = false;
          manual.setAttribute('href', TELEGRAM_SEND_BASE + encodeURIComponent(readySaved));
        }
        if (submit) submit.hidden = true;
        setStatus('Заявка сохранена — отправьте её одним нажатием: откроется чат студии с готовым текстом.', 'ready');
      }
    } catch (e) {}

    /* Заявку собираем заново прямо в момент нажатия: если человек поправил
       телефон уже после мягкого перехода, в чат уйдёт актуальный текст. */
    var refreshMessage = function () {
      var el = form.elements;
      var nm = el.name ? el.name.value.trim() : '';
      var ph = el.phone ? el.phone.value.trim() : '';
      var gr = el.group ? el.group.value.trim() : '';
      var cm = el.comment ? el.comment.value.trim() : '';
      if (nm.length < 2 || ph.replace(/\D/g, '').length < 10) return lastMessage;
      return [
        'Заявка с сайта SD Dance Studio',
        'Имя: ' + nm,
        'Телефон: ' + ph,
        gr ? 'Группа: ' + gr : '',
        cm ? 'Комментарий: ' + cm : ''
      ].filter(Boolean).join('\n');
    };

    /* Нажатие на кнопку ручной отправки: заявка уходит в буфер — если Telegram
       на устройстве не установлен, текст можно вставить в чат вручную. */
    if (manual) {
      manual.addEventListener('click', function () {
        var fresh = refreshMessage();
        if (!fresh) return;
        lastMessage = fresh;
        manual.setAttribute('href', TELEGRAM_SEND_BASE + encodeURIComponent(fresh));
        rememberReady(fresh);
        copyToClipboard(fresh);
        manual.textContent = 'Скопировано — вставьте заявку в чат';
      });
    }

    /* Черновик: если человек случайно закрыл окно, поля не пропадут.
       Для сохранённых значений автосохранение отключаем — иначе браузер
       восстанавливает их уже после того, как мы записали пустые. */
    var draftReady = false;
    try {
      var saved = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
      if (saved && typeof saved === 'object') {
        ['name', 'phone', 'comment'].forEach(function (key) {
          var field = form.elements[key];
          if (field && saved[key]) field.value = saved[key];
        });
        if (saved.group) {
          var sel = form.elements.group;
          if (sel) sel.value = saved.group;
        }
      }
    } catch (e) {}

    requestAnimationFrame(function () {
      requestAnimationFrame(function () { draftReady = true; });
    });

    var saveDraft = function () {
      if (!draftReady) return;
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify({
          name: form.elements.name ? form.elements.name.value : '',
          phone: form.elements.phone ? form.elements.phone.value : '',
          group: form.elements.group ? form.elements.group.value : '',
          comment: form.elements.comment ? form.elements.comment.value : ''
        }));
      } catch (e) {}
    };

    form.addEventListener('change', saveDraft);
    form.addEventListener('focusout', saveDraft);

    /* Поле-приманка для ботов: люди его не видят и не заполняют */
    var honeypot = form.querySelector('[data-honeypot]');

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var data = new FormData(form);
      var name = (data.get('name') || '').toString().trim();
      var phone = (data.get('phone') || '').toString().trim();
      var group = (data.get('group') || '').toString().trim();
      var comment = (data.get('comment') || '').toString().trim();

      if (honeypot && honeypot.value) return; // бот молча уходит ни с чем

      /* Разметку проверяем сами: у формы стоит novalidate, поэтому сообщение
         об ошибке всегда видно, а не только во всплывающей подсказке браузера. */
      var problems = [];
      if (name.length < 2) problems.push('имя');
      if (phone.replace(/\D/g, '').length < 10) problems.push('телефон');

      if (problems.length) {
        form.querySelectorAll('.field').forEach(function (field) {
          field.classList.remove('is-invalid');
        });
        if (name.length < 2) {
          var nameField = form.elements.name;
          if (nameField) nameField.closest('.field').classList.add('is-invalid');
        }
        if (phone.replace(/\D/g, '').length < 10) {
          var phoneField = form.elements.phone;
          if (phoneField) {
            phoneField.closest('.field').classList.add('is-invalid');
            if (phoneField.focus) phoneField.focus();
          }
        }
        setStatus('Проверьте ' + problems.join(' и ') + ' — тогда мы сможем перезвонить.', 'error');
        return;
      }

      var lines = [
        'Заявка с сайта SD Dance Studio',
        'Имя: ' + name,
        'Телефон: ' + phone,
        group ? 'Группа: ' + group : '',
        comment ? 'Комментарий: ' + comment : ''
      ].filter(Boolean);
      var message = lines.join('\n');
      lastMessage = message;

      /* Никакого слова «ошибка» в основном пути: если Telegram не подтвердил
         отправку за 7 секунд, показываем мягкий сценарий — заявка готова,
         отправить её можно одним нажатием. Текст тот же, что уходит ботом. */
      var showManual = function (text) {
        if (manual) {
          manual.hidden = false;
          manual.setAttribute('href', TELEGRAM_SEND_BASE + encodeURIComponent(message));
          manual.textContent = 'Отправить заявку в Telegram';
        }
        /* На экране должна остаться одна понятная кнопка, а не две одинаковые:
           прячем «Отправить заявку» и оставляем ручную отправку. */
        if (submit) { submit.hidden = true; submit.disabled = false; }
        rememberReady(message);
        setStatus(text, 'ready');
      };

      var endpoint = BOOKING_ENDPOINT || form.getAttribute('data-endpoint');
      var tgReady = TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID;

      /* Отклик сразу, а не после ответа сети: иначе на медленном соединении
         человек видит прошлый текст и жмёт кнопку второй раз. */
      setStatus('Отправляем заявку…', 'pending');

      var done = function () {
        setStatus('Заявка отправлена! Мы свяжемся с вами, чтобы подтвердить запись.', 'ok');
        form.reset();
        lastMessage = '';
        try { localStorage.removeItem(DRAFT_KEY); localStorage.removeItem(READY_KEY); } catch (e) {}
        if (manual) manual.hidden = true;
        if (submit) submit.hidden = false;
      };

      if (endpoint) {
        if (submit) submit.disabled = true;
        fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ name: name, phone: phone, group: group, comment: comment, message: message })
        }).then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          done();
        }).catch(function () {
          showManual(SOFT_TEXT);
        }).then(function () {
          if (submit) submit.disabled = false;
        });
        return;
      }

      // простой путь: отправляем прямо в Telegram через бота
      if (tgReady) {
        var last = 0;
        try { last = Number(localStorage.getItem('sd_last_booking') || 0); } catch (e) {}
        if (Date.now() - last < 30000) {
          // защита от дублей: Telegram уже получил такую заявку минуту назад
          done();
          return;
        }
        var url = 'https://api.telegram.org/bot' + TELEGRAM_BOT_TOKEN + '/sendMessage';
        // получателей можно перечислить через запятую: '688076805,123456789'
        var chats = String(TELEGRAM_CHAT_ID).split(',').map(function (s) { return s.trim(); }).filter(Boolean);
        if (submit) submit.disabled = true;

        // Страховка по времени: если сеть «съела» запрос, через 7 секунд сдаёмся,
        // разблокируем кнопку и предлагаем отправить вручную. Гонка промисов
        // срабатывает даже если сам запрос отмену проигнорировал.
        var controller = window.AbortController ? new AbortController() : null;
        var timedOut = false;
        var guard = new Promise(function (_, reject) {
          setTimeout(function () {
            timedOut = true;
            if (controller) { try { controller.abort(); } catch (e) {} }
            reject(new Error('timeout'));
          }, 7000);
        });

        // Telegram не отдаёт CORS-заголовки, поэтому запросы отправляем в режиме no-cors:
        // доставка происходит, а ответ браузер прочитать не даёт.
        Promise.race([Promise.all(chats.map(function (chatId) {
          var body = new URLSearchParams({
            chat_id: chatId,
            text: message,
            disable_web_page_preview: 'true'
          });
          return fetch(url, {
            method: 'POST',
            mode: 'no-cors',
            signal: controller ? controller.signal : undefined,
            headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
            body: body.toString()
          });
        })), guard]).then(function () {
          try { localStorage.setItem('sd_last_booking', String(Date.now())); } catch (e) {}
          done();
        }).catch(function (error) {
          // В режиме no-cors ответ прочитать нельзя, поэтому «ошибка сети» не значит,
          // что заявка не ушла. Не пугаем человека зря: предлагаем продублировать
          // в Telegram одной кнопкой и не сообщаем о провале.
          console.log('[SD] отправка в Telegram не подтвердилась:', error && error.message, timedOut ? '(таймаут)' : '(сеть)');
          showManual(SOFT_TEXT);
        }).then(function () {
          if (submit) submit.disabled = false;
        });
        return;
      }

      window.open(TELEGRAM_SEND_BASE + encodeURIComponent(message), '_blank', 'noopener');
      done();
    });
  }

  /* --- Вкладки в окне записи -------------------------------------------- */
  var tabs = Array.prototype.slice.call(document.querySelectorAll('.modal__tab'));

  tabs.forEach(function (tab) {
    tab.addEventListener('click', function () {
      tabs.forEach(function (t) {
        var selected = t === tab;
        t.setAttribute('aria-selected', String(selected));
        var pane = document.getElementById(t.getAttribute('aria-controls'));
        if (pane) pane.hidden = !selected;
      });
    });
  });

  /* --- Лесенка для соседних блоков --------------------------------------- */
  document.querySelectorAll('[data-stagger]').forEach(function (host) {
    Array.prototype.slice.call(host.children).forEach(function (child, i) {
      if (i > 0 && i < 4) child.classList.add('reveal--d' + i);
    });
  });

  /* --- Появление блоков при скролле ------------------------------------ */
  var items = Array.prototype.slice.call(document.querySelectorAll('.reveal'));

  if (!('IntersectionObserver' in window)) {
    items.forEach(function (el) { el.classList.add('is-visible'); });
    return;
  }

  var observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-visible');
      observer.unobserve(entry.target);
    });
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });

  items.forEach(function (el) { observer.observe(el); });
})();
