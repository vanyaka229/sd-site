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
  var hero = document.querySelector('.hero-band, .page-hero');

  function onScroll() {
    var passed = hero ? window.scrollY > hero.offsetHeight + 80 : window.scrollY > 200;
    if (toTop) toTop.classList.toggle('is-visible', window.scrollY > 600);
  }

  if (mobileCta) document.body.classList.add('has-mobile-cta');
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

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

    var setStatus = function (text, state) {
      if (!status) return;
      status.textContent = text;
      if (state) status.setAttribute('data-state', state);
      else status.removeAttribute('data-state');
    };

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var data = new FormData(form);
      var name = (data.get('name') || '').toString().trim();
      var phone = (data.get('phone') || '').toString().trim();
      var group = (data.get('group') || '').toString().trim();
      var comment = (data.get('comment') || '').toString().trim();

      if (name.length < 2 || phone.replace(/\D/g, '').length < 10) {
        setStatus('Проверьте имя и телефон — нужен номер не короче 10 цифр.', 'error');
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
      var endpoint = BOOKING_ENDPOINT || form.getAttribute('data-endpoint');
      var tgReady = TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID;

      var done = function () {
        setStatus('Заявка отправлена! Мы свяжемся с вами, чтобы подтвердить запись.', 'ok');
        form.reset();
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
          setStatus('Не удалось отправить. Напишите нам в Telegram или позвоните.', 'error');
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
          setStatus('Заявка уже отправлена. Если нужно — напишите нам в Telegram.', 'error');
          return;
        }
        var url = 'https://api.telegram.org/bot' + TELEGRAM_BOT_TOKEN + '/sendMessage';
        // получателей можно перечислить через запятую: '688076805,123456789'
        var chats = String(TELEGRAM_CHAT_ID).split(',').map(function (s) { return s.trim(); }).filter(Boolean);
        if (submit) submit.disabled = true;
        // Telegram не отдаёт CORS-заголовки, поэтому запросы отправляем в режиме no-cors:
        // доставка происходит, а ответ браузер прочитать не даёт.
        Promise.all(chats.map(function (chatId) {
          var body = new URLSearchParams({
            chat_id: chatId,
            text: message,
            disable_web_page_preview: 'true'
          });
          return fetch(url, {
            method: 'POST',
            mode: 'no-cors',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
            body: body.toString()
          });
        })).then(function () {
          try { localStorage.setItem('sd_last_booking', String(Date.now())); } catch (e) {}
          done();
        }).catch(function () {
          setStatus('Не удалось отправить. Напишите нам в Telegram или позвоните.', 'error');
        }).then(function () {
          if (submit) submit.disabled = false;
        });
        return;
      }

      window.open('https://t.me/share/url?url=' + encodeURIComponent(location.href) +
        '&text=' + encodeURIComponent(message), '_blank', 'noopener');
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
