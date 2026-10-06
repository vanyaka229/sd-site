/* ==========================================================================
   SD DANCE STUDIO — движение (js/motion.js)
   Ванильный JS, без библиотек. Подключается ПОСЛЕ js/main.js, чтобы не мешать
   его работе: main.js отвечает за меню, модалку, форму и вкладки — здесь
   только анимации.

   Принципы:
   • одно чтение геометрии и одна запись на кадр (rAF), никаких layout-свойств;
   • все смещения — через transform/opacity;
   • курсор-прожектор и магнитные кнопки только для точного указателя;
   • при prefers-reduced-motion:reduce весь разгон выключается, контент виден.
   ========================================================================== */
(function () {
  'use strict';

  var root = document.documentElement;
  var body = document.body;
  if (!root || !body) return;

  var mqReduce = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  var mqFine = window.matchMedia ? window.matchMedia('(hover: hover) and (pointer: fine)') : null;

  function reduceMotion() { return !!(mqReduce && mqReduce.matches); }
  function finePointer() { return !!(mqFine && mqFine.matches); }

  /* --- Появление шапки героя (одна перерисовка на старте) ----------------- */
  requestAnimationFrame(function () {
    requestAnimationFrame(function () { body.classList.add('is-ready'); });
  });

  /* Тот же класс нужен сразу, чтобы липкая кнопка не появлялась раньше героя */
  window.addEventListener('load', function () { body.classList.add('is-ready'); });

  /* ------------------------------------------------------------------------
     Номер 1. Появление секций при прокрутке
     Один IntersectionObserver на все .rv и на блоки цифр, с самопрекращением.
     ------------------------------------------------------------------------ */
  var revealItems = [].slice.call(document.querySelectorAll('.rv'));
  /* .mask-media скрывает фото до появления (opacity:0), но не все такие блоки
     помечены классом .rv: липкие кадры рассказа (.story__media) его не имеют.
     Без наблюдателя их фотографии навсегда оставались прозрачными — на месте
     кадра был чёрный прямоугольник. Берём их в ту же группу появления. */
  [].slice.call(document.querySelectorAll('.mask-media')).forEach(function (el) {
    if (revealItems.indexOf(el) === -1) revealItems.push(el);
  });
  var factBlocks = [].slice.call(document.querySelectorAll('.fact, .offer'));

  /* Что уже видно при загрузке — раскрываем сразу, не ожидая колбэка
     наблюдателя: у липких блоков он иногда не приходит (округление долей). */
  function revealAboveFold() {
    var limit = window.innerHeight + 120;
    revealItems.forEach(function (el) {
      var r = el.getBoundingClientRect();
      if (r.top < limit && r.bottom > -120) el.classList.add('is-in');
    });
  }

  function showAll() {
    revealItems.forEach(function (el) { el.classList.add('is-in'); });
    factBlocks.forEach(function (el) { runCounters(el); });
  }

  if (!('IntersectionObserver' in window) || reduceMotion()) {
    showAll();
  } else {
    var revealObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-in');
        revealObserver.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -10% 0px', threshold: 0.08 });

    revealItems.forEach(function (el) { revealObserver.observe(el); });
    revealAboveFold();

    var blockObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        runCounters(entry.target);
        blockObserver.unobserve(entry.target);
      });
    }, { threshold: 0.35 });

    factBlocks.forEach(function (el) { blockObserver.observe(el); });
  }

  /* ------------------------------------------------------------------------
     Номер 2. Счётчики цифр
     data-count="7"            → 7
     data-count="2026"         → 2 026 (по-русски, неразрывный пробел)
     data-count="6" data-plus  → 6+
     ------------------------------------------------------------------------ */
  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

  function renderValue(node, value, opts) {
    if (opts.plus) {
      node.textContent = String(value) + '+';
      return;
    }
    if (opts.thousands) {
      node.textContent = String(value).replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0');
      return;
    }
    node.textContent = String(value);
  }

  function runCounters(host) {
    if (!host) return;
    var nums = [].slice.call(host.querySelectorAll('[data-count]'));
    if (!nums.length) return;

    nums.forEach(function (node) {
      if (node.getAttribute('data-counted') === '1') return;
      node.setAttribute('data-counted', '1');

      var raw = node.getAttribute('data-count');
      var target = parseInt(raw, 10);
      if (!isFinite(target)) { node.textContent = raw; return; }

      var opts = {
        plus: node.hasAttribute('data-plus'),
        thousands: node.hasAttribute('data-thousands') || Math.abs(target) >= 1000
      };

      if (reduceMotion()) { renderValue(node, target, opts); return; }

      var duration = 1100;
      var startedAt = null;

      function step(now) {
        if (startedAt === null) startedAt = now;
        var t = Math.min(1, (now - startedAt) / duration);
        renderValue(node, Math.round(target * easeOutCubic(t)), opts);
        if (t < 1) {
          requestAnimationFrame(step);
        } else {
          renderValue(node, target, opts);
          node.classList.add('is-counted');
        }
      }

      requestAnimationFrame(step);
    });
  }

  /* ------------------------------------------------------------------------
     Номер 3. Покадровый цикл прокрутки:
     прогресс чтения, кнопка «наверх», параллакс, липкий рассказ.
     ------------------------------------------------------------------------ */
  var progressBar = document.querySelector('.read-progress__bar');
  var toTop = document.querySelector('.to-top');
  var hero = document.querySelector('.hero, .page-hero');
  var storyItems = [].slice.call(document.querySelectorAll('.story__item'));

  /* Параллакс: собираем элементы и их коэффициент один раз */
  var parItems = [];
  [].slice.call(document.querySelectorAll('[data-parallax]')).forEach(function (el) {
    var speed = parseFloat(el.getAttribute('data-parallax'));
    parItems.push({ el: el, speed: isFinite(speed) ? speed : 0.1 });
  });

  var lastStory = -1;
  var headerH = parseFloat(
    getComputedStyle(root).getPropertyValue('--header-h')
  ) || 78;

  function clamp(v, min, max) { return v < min ? min : (v > max ? max : v); }

  function measure() {
    headerH = parseFloat(getComputedStyle(root).getPropertyValue('--header-h')) || headerH;
  }

  function frame() {
    var y = window.pageYOffset || root.scrollTop || 0;
    var max = (root.scrollHeight || body.scrollHeight) - window.innerHeight;

    /* Прогресс чтения — только transform, без пересчёта раскладки */
    if (progressBar) {
      var p = max > 0 ? clamp(y / max, 0, 1) : 0;
      progressBar.style.transform = 'scaleX(' + p.toFixed(4) + ')';
    }

    /* Кнопка «наверх» */
    if (toTop) toTop.classList.toggle('is-visible', y > 620);

    /* Липкая кнопка не должна мешать, пока виден герой */
    var heroH = hero ? hero.offsetHeight : 320;
    var ctaOn = y > heroH * 0.55;
    body.classList.toggle('has-mobile-cta', ctaOn);
    var mobileCta = document.querySelector('.mobile-cta');
    if (mobileCta) mobileCta.classList.toggle('is-visible', ctaOn);

    /* Параллакс крупных фото */
    if (!reduceMotion()) {
      var vh = window.innerHeight;
      for (var i = 0; i < parItems.length; i++) {
        var it = parItems[i];
        var r = it.el.getBoundingClientRect();
        if (r.bottom < -120 || r.top > vh + 120) continue;
        var progress = ((r.top + r.height / 2) - vh / 2) / ((vh + r.height) / 2);
        var shift = clamp(-progress * it.speed * 100, -46, 46);
        it.el.style.transform = 'translate3d(0,' + shift.toFixed(2) + 'px,0)';
      }
    }

    /* Липкий рассказ: какой кадр сейчас читается.
       Активный пункт выбираем по каждому рассказу отдельно — иначе второй
       рассказ («Основной стиль») вообще не получал активную карточку.
       Фотографию здесь НЕ трогаем: за неё отвечает .mask-media в motion.css.
       Раньше здесь выставлялся inline opacity, и фото второго рассказа
       оставалось прозрачным — на его месте был чёрный прямоугольник. */
    if (storyItems.length) {
      var line = y + headerH + Math.min(window.innerHeight * 0.42, 380);
      var active = -1;
      var activeDist = Infinity;
      for (var k = 0; k < storyItems.length; k++) {
        var itemRect = storyItems[k].getBoundingClientRect();
        var itemTop = itemRect.top + y;
        var itemBottom = itemRect.bottom + y;
        if (line >= itemTop && line <= itemBottom) { active = k; break; }
        var dist = line < itemTop ? itemTop - line : line - itemBottom;
        if (dist < activeDist) { activeDist = dist; active = k; }
      }
      if (active !== lastStory) {
        lastStory = active;
        storyItems.forEach(function (el, idx) {
          el.classList.toggle('is-active', idx === active);
        });
      }
    }
  }

  var scheduled = false;
  function onScroll() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(function () {
      scheduled = false;
      frame();
    });
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', function () { measure(); revealAboveFold(); onScroll(); }, { passive: true });
  window.addEventListener('orientationchange', function () { measure(); onScroll(); });

  measure();
  onScroll();
  window.addEventListener('load', function () { measure(); revealAboveFold(); onScroll(); });

  /* ------------------------------------------------------------------------
     Номер 4. Курсор-прожектор и магнитные кнопки (только точный указатель)
     ------------------------------------------------------------------------ */
  var cursorLayer = document.querySelector('.cursor-layer');
  var ring = document.querySelector('.cursor-layer__ring');
  var light = document.querySelector('.cursor-layer__light');

  if (cursorLayer && finePointer() && !reduceMotion()) {
    var tx = -400, ty = -400, cx = -400, cy = -400;
    var ringX = -400, ringY = -400;
    var cursorSeen = false;

    window.addEventListener('pointermove', function (e) {
      if (e.pointerType === 'touch') return;
      tx = e.clientX; ty = e.clientY;
      if (!cursorSeen) {
        cursorSeen = true;
        cx = tx; cy = ty; ringX = tx; ringY = ty;
        cursorLayer.classList.add('is-on');
      }
    }, { passive: true });

    document.addEventListener('pointerover', function (e) {
      var hot = e.target.closest && e.target.closest('a, button, .rail__item, .gal__item, [data-magnet]');
      cursorLayer.classList.toggle('is-hot', !!hot);
    }, { passive: true });

    document.addEventListener('pointerleave', function () {
      cursorLayer.classList.remove('is-on');
    }, { passive: true });

    (function cursorLoop() {
      /* разное сглаживание: свет мягче, кольцо точнее — ощущение массы */
      cx += (tx - cx) * 0.1;
      cy += (ty - cy) * 0.1;
      ringX += (tx - ringX) * 0.22;
      ringY += (ty - ringY) * 0.22;

      if (light) light.style.transform = 'translate3d(' + cx.toFixed(1) + 'px,' + cy.toFixed(1) + 'px,0)';
      if (ring) ring.style.transform = 'translate3d(' + ringX.toFixed(1) + 'px,' + ringY.toFixed(1) + 'px,0)';

      requestAnimationFrame(cursorLoop);
    })();
  } else if (cursorLayer) {
    cursorLayer.setAttribute('aria-hidden', 'true');
  }

  /* Магнитные кнопки: тянутся к курсору в пределах своего поля */
  var magnets = [].slice.call(document.querySelectorAll('[data-magnet]'));
  if (magnets.length && finePointer() && !reduceMotion()) {
    magnets.forEach(function (el) {
      var strength = parseFloat(el.getAttribute('data-magnet')) || 0.18;

      el.addEventListener('pointermove', function (e) {
        if (e.pointerType === 'touch') return;
        var r = el.getBoundingClientRect();
        var dx = (e.clientX - (r.left + r.width / 2)) * strength;
        var dy = (e.clientY - (r.top + r.height / 2)) * strength;
        el.style.setProperty('--mx', dx.toFixed(1) + 'px');
        el.style.setProperty('--my', dy.toFixed(1) + 'px');
        el.classList.add('is-pulling');
      }, { passive: true });

      el.addEventListener('pointerleave', function () {
        el.style.setProperty('--mx', '0px');
        el.style.setProperty('--my', '0px');
        el.classList.remove('is-pulling');
      }, { passive: true });
    });
  }

  /* ------------------------------------------------------------------------
     Номер 5. Отклик формы: тряска неверного поля и снятие ошибки при вводе
     ------------------------------------------------------------------------ */
  var form = document.querySelector('.booking-form');
  if (form) {
    var submitBtn = form.querySelector('button[type="submit"]');

    form.addEventListener('submit', function () {
      /* класс снимаем в конце кадра: main.js уже проставил статус */
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          var state = form.querySelector('.form-status');
          var mode = state ? state.getAttribute('data-state') : '';
          if (mode === 'sent' || mode === 'ok') form.setAttribute('data-state', 'sent');
        });
      });
    }, true);

    /* Как только поле заполнили — снимаем подсветку ошибки */
    form.addEventListener('input', function (e) {
      var field = e.target.closest ? e.target.closest('.field') : null;
      if (field) field.classList.remove('is-invalid');
      if (form.getAttribute('data-state') === 'sent') form.removeAttribute('data-state');
    });

    /* Если main.js отклонил отправку — короткая тряска полей с ошибкой */
    var statusNode = form.querySelector('.form-status');
    if (statusNode && window.MutationObserver) {
      var lastText = '';
      var observer = new MutationObserver(function () {
        var text = statusNode.textContent || '';
        var state = statusNode.getAttribute('data-state');
        if (state !== 'error' || text === lastText) { lastText = text; return; }
        lastText = text;

        var nameField = form.querySelector('input[name="name"]');
        var phoneField = form.querySelector('input[name="phone"]');
        if (nameField && nameField.value.trim().length < 2) {
          nameField.closest('.field').classList.add('is-invalid');
        }
        if (phoneField && phoneField.value.replace(/\D/g, '').length < 10) {
          phoneField.closest('.field').classList.add('is-invalid');
        }
        if (submitBtn) {
          submitBtn.style.transform = 'translate3d(0,0,0)';
        }
      });
      observer.observe(statusNode, { childList: true, characterData: true, subtree: true, attributes: true });
    }
  }

  /* ------------------------------------------------------------------------
     Номер 6. Ленты-бегущие строки: пауза, когда лента за пределами экрана
     (экономит кадры на телефоне, визуально ничего не меняет)
     ------------------------------------------------------------------------ */
  var tickers = [].slice.call(document.querySelectorAll('.ticker'));
  if (tickers.length && 'IntersectionObserver' in window) {
    var tickerObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        entry.target.classList.toggle('is-idle', !entry.isIntersecting);
      });
    }, { rootMargin: '120px 0px' });
    tickers.forEach(function (el) { tickerObserver.observe(el); });
  }

  /* ------------------------------------------------------------------------
     Номер 7. Просмотр фотографий
     Клик по кадру в галерее или рейле открывает снимок крупно. Работает
     с клавиатуры, возвращает фокус на исходный кадр, не ломает скролл.
     ------------------------------------------------------------------------ */
  var lightbox = document.getElementById('lightbox');
  var lbShots = [].slice.call(document.querySelectorAll('.gal__item img, .rail__item img'));

  if (lightbox && lbShots.length) {
    var lbImg = lightbox.querySelector('.lightbox__img');
    var lbCap = lightbox.querySelector('.lightbox__cap');
    var lbIndex = -1;
    var lbOwner = null;

    var lbRender = function (index) {
      if (index < 0) index = lbShots.length - 1;
      if (index >= lbShots.length) index = 0;
      lbIndex = index;
      var shot = lbShots[index];
      lbImg.setAttribute('src', shot.currentSrc || shot.getAttribute('src'));
      lbImg.setAttribute('alt', shot.getAttribute('alt') || '');
      var host = shot.closest('.gal__item, .rail__item');
      var cap = host ? host.querySelector('figcaption') : null;
      lbCap.textContent = (cap && cap.textContent) ? cap.textContent : (shot.getAttribute('alt') || '');
    };

    var lbOpen = function (index, owner) {
      lbOwner = owner || null;
      lbRender(index);
      lightbox.setAttribute('data-open', 'true');
      document.body.style.overflow = 'hidden';
      /* Фокус переносим в следующем кадре: пока окно было visibility:hidden,
         кнопки внутри ещё не фокусируемы. */
      var close = lightbox.querySelector('[data-lb-close]');
      if (close) {
        requestAnimationFrame(function () {
          requestAnimationFrame(function () {
            try { close.focus({ preventScroll: true }); } catch (e) { close.focus(); }
          });
        });
      }
    };

    var lbClose = function () {
      lightbox.setAttribute('data-open', 'false');
      document.body.style.overflow = '';
      if (lbOwner && lbOwner.focus) lbOwner.focus();
    };

    lbShots.forEach(function (shot, index) {
      var host = shot.closest('.gal__item, .rail__item');
      if (!host) return;
      host.setAttribute('role', 'button');
      host.setAttribute('tabindex', '0');
      host.addEventListener('click', function () { lbOpen(index, host); });
      host.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
          e.preventDefault();
          lbOpen(index, host);
        }
      });
    });

    lightbox.addEventListener('click', function (e) {
      if (e.target.closest('[data-lb-close]')) { lbClose(); return; }
      if (e.target.closest('[data-lb-next]')) { lbRender(lbIndex + 1); return; }
      if (e.target.closest('[data-lb-prev]')) { lbRender(lbIndex - 1); return; }
      if (e.target === lightbox) lbClose();
    });

    document.addEventListener('keydown', function (e) {
      if (lightbox.getAttribute('data-open') !== 'true') return;
      if (e.key === 'Escape') { lbClose(); return; }
      if (e.key === 'ArrowRight') { lbRender(lbIndex + 1); return; }
      if (e.key === 'ArrowLeft') { lbRender(lbIndex - 1); return; }
      /* Фокус не должен уезжать на страницу под просмотром */
      if (e.key === 'Tab') {
        var stops = [].slice.call(lightbox.querySelectorAll('button')).filter(function (b) { return !b.hidden; });
        if (!stops.length) return;
        var first = stops[0];
        var last = stops[stops.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });
  }

  /* ------------------------------------------------------------------------
     Номер 8. Живой отклик на изменение системных настроек
     ------------------------------------------------------------------------ */
  function onPreferenceChange() {
    if (reduceMotion()) {
      root.classList.add('reduce');
      showAll();
      parItems.forEach(function (it) { it.el.style.transform = ''; });
    } else {
      root.classList.remove('reduce');
    }
  }

  if (mqReduce && mqReduce.addEventListener) mqReduce.addEventListener('change', onPreferenceChange);
  else if (mqReduce && mqReduce.addListener) mqReduce.addListener(onPreferenceChange);
})();
