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

/* Необязательно: внешний приёмник заявок (Web3Forms/Formspree и подобные).
   Если задан, пробуется после нашего приёмника на VPS. */
var BOOKING_ENDPOINT = '';

/* Наш приёмник заявок на VPS: он сам пересылает заявку в Telegram, поэтому
   работает и там, где браузер до api.telegram.org не достаёт (Крым, часть
   провайдеров РФ). Пробуется ПЕРВЫМ. Адрес меняется только здесь.
   Развёртывание: deploy/VPS-ПРИЁМНИК.md. */
var BOOKING_SERVER = 'https://api.sd-dance-st.ru/tg';
var BOOKING_SERVER_TIMEOUT = 5000;   // ждём приёмник не дольше 5 секунд

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
  /* Сброс состояния формы на обычный вид: заполняется в блоке формы ниже
     и вызывается при каждом открытии окна. */
  var resetBookingState = null;

  function openModal(event) {
    if (!modal) return;
    if (event) event.preventDefault();
    lastFocused = document.activeElement;
    /* Каждое открытие окна — с чистого листа: подпись, кнопки и поля как в первый раз.
       Сброс делаем только на переходе «закрыто -> открыто». */
    if (resetBookingState && modal.getAttribute('data-open') !== 'true') resetBookingState();
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
    /* Ни «черновик» полей, ни «готовая заявка» в памяти браузера больше не нужны:
       форма всегда открывается обычной, поля пустые. Старые ключи вычищаем,
       чтобы у вернувшихся посетителей не оставалось следов прошлых открытий. */
    var forgetSaved = function () {
      try {
        localStorage.removeItem('sd_booking_draft');
        localStorage.removeItem('sd_booking_ready');
      } catch (e) {}
    };
    forgetSaved();

    var setStatus = function (text, state) {
      if (!status) return;
      status.textContent = text;
      if (state) status.setAttribute('data-state', state);
      else status.removeAttribute('data-state');
    };

    /* Кнопка ручной отправки. Она появляется ТОЛЬКО после реальной попытки отправки,
       когда ни приёмник, ни Telegram не ответили, — из памяти браузера её не поднимаем. */
    var manual = form.querySelector('.booking-form__manual');
    var MANUAL_LABEL = 'Отправить заявку в Telegram';
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

    /* Появление окна всегда возвращает форму к обычному виду: подпись пустая,
       кнопка t.me спрятана, основная кнопка на месте, поля пустые.
       Никакого «готово» до отправки и никаких следов прошлого открытия.
       Эту функцию вызывает openModal (см. выше). */
    var resetToPlainForm = function () {
      lastMessage = '';
      setStatus('', null);
      if (manual) {
        manual.hidden = true;
        manual.textContent = MANUAL_LABEL;
        manual.removeAttribute('href');
      }
      if (submit) {
        submit.hidden = false;
        submit.disabled = false;
      }
      form.reset();
      form.querySelectorAll('.field').forEach(function (field) {
        field.classList.remove('is-invalid');
      });
    };
    resetBookingState = resetToPlainForm;

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
        copyToClipboard(fresh);
        manual.textContent = 'Скопировано — вставьте заявку в чат';
      });
    }

    /* Черновик убран полностью (8 октября 2026): автосохранение полей приводило к тому,
       что форма открывалась заполненной прошлыми значениями. Ничего в поля не подставляем
       и ничего из полей не сохраняем — при новом визите форма всегда пустая. */

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
          manual.textContent = MANUAL_LABEL;
        }
        /* На экране должна остаться одна понятная кнопка, а не две одинаковые:
           прячем «Отправить заявку» и оставляем ручную отправку. */
        if (submit) { submit.hidden = true; submit.disabled = false; }
        /* В память браузера ничего не пишем: мягкий режим живёт только в этой попытке. */
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
        forgetSaved();
        if (manual) manual.hidden = true;
        if (submit) submit.hidden = false;
      };

      /* Порядок попыток:
           1) наш приёмник на VPS (работает там, где браузер до Telegram не достаёт);
           2) api.telegram.org напрямую;
           3) мягкий режим «отправьте одним нажатием».
         Любой успех означает, что заявка отправлена. */
      var settled = false;
      var finishDone = function () { if (settled) return; settled = true; done(); };
      var finishSoft = function () { if (settled) return; settled = true; showManual(SOFT_TEXT); };

      var fallback = function () {
        if (endpoint) {
          if (submit) submit.disabled = true;
          fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ name: name, phone: phone, group: group, comment: comment, message: message })
          }).then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            finishDone();
          }).catch(function () {
            finishSoft();
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
            finishDone();
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
            finishDone();
          }).catch(function (error) {
            // В режиме no-cors ответ прочитать нельзя, поэтому «ошибка сети» не значит,
            // что заявка не ушла. Не пугаем человека зря: предлагаем продублировать
            // в Telegram одной кнопкой и не сообщаем о провале.
            console.log('[SD] отправка в Telegram не подтвердилась:', error && error.message, timedOut ? '(таймаут)' : '(сеть)');
            finishSoft();
          }).then(function () {
            if (submit) submit.disabled = false;
          });
          return;
        }

        window.open(TELEGRAM_SEND_BASE + encodeURIComponent(message), '_blank', 'noopener');
        finishDone();
      };

      /* Попытка 1: наш приёмник на VPS. Он сам пересылает заявку в Telegram,
         поэтому работает даже там, где браузер до api.telegram.org не достаёт.
         Ответ читаем как JSON (сервер отдаёт CORS-заголовки для нашего домена). */
      if (BOOKING_SERVER && window.fetch) {
        if (submit) submit.disabled = true;
        var serverController = window.AbortController ? new AbortController() : null;
        var serverTimedOut = false;
        var serverGuard = new Promise(function (_, reject) {
          setTimeout(function () {
            serverTimedOut = true;
            if (serverController) { try { serverController.abort(); } catch (e) {} }
            reject(new Error('timeout'));
          }, BOOKING_SERVER_TIMEOUT);
        });
        var serverCall = fetch(BOOKING_SERVER, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          signal: serverController ? serverController.signal : undefined,
          body: JSON.stringify({
            name: name,
            phone: phone,
            group: group,
            comment: comment,
            company: honeypot ? honeypot.value : ''
          })
        }).then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.json().catch(function () { return null; });
        }).then(function (data) {
          /* Успехом считаем ТОЛЬКО явное {"ok":true}. Иначе чужой сервер,
             ответивший 200, был бы принят за доставленную заявку. */
          if (!data || data.ok !== true) {
            throw new Error('ответ без ok:true' + (data && data.error ? ' (' + data.error + ')' : ''));
          }
          return true;
        });

        Promise.race([serverCall, serverGuard]).then(function () {
          if (submit) submit.disabled = false;
          finishDone();
        }).catch(function (error) {
          if (settled) return;
          console.log('[SD] приёмник на VPS не ответил:', error && error.message,
            serverTimedOut ? '(таймаут)' : '(сеть)', '— пробую Telegram напрямую');
          if (submit) submit.disabled = false;
          fallback();
        });
        return;
      }

      fallback();
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
