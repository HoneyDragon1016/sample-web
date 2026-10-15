/* ==========================================================================
   sample-web · 共用互動腳本（原生 ES6+，無相依套件）
   功能：行動選單、Header 捲動狀態、Reveal、表單即時驗證、Lightbox、
         Dialog 控制、Tabs、Parallax、年份自動填入
   ========================================================================== */
(function () {
  'use strict';

  /* ---------- Lucide 圖示 ---------- */
  if (window.lucide) window.lucide.createIcons();

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- 年份 ---------- */
  document.querySelectorAll('[data-year]').forEach((el) => {
    el.textContent = new Date().getFullYear();
  });

  /* ---------- 行動選單（aria-expanded） ---------- */
  document.querySelectorAll('[data-nav-toggle]').forEach((btn) => {
    const menu = document.getElementById(btn.getAttribute('aria-controls'));
    if (!menu) return;
    btn.addEventListener('click', () => {
      const open = btn.getAttribute('aria-expanded') === 'true';
      btn.setAttribute('aria-expanded', String(!open));
      menu.classList.toggle('hidden', open);
    });
    // 點擊選單連結後自動收合
    menu.querySelectorAll('a').forEach((a) => a.addEventListener('click', () => {
      btn.setAttribute('aria-expanded', 'false');
      menu.classList.add('hidden');
    }));
  });

  /* ---------- Header 捲動狀態 ---------- */
  const header = document.querySelector('[data-header-scroll]');
  if (header) {
    const onScroll = () => header.classList.toggle('is-scrolled', window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  /* ---------- Reveal on scroll ---------- */
  const reveals = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window && !prefersReducedMotion) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add('is-visible');
          io.unobserve(e.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    reveals.forEach((el) => io.observe(el));
  } else {
    reveals.forEach((el) => el.classList.add('is-visible'));
  }

  /* ---------- 表單驗證（即時 UI 回饋） ---------- */
  function showFieldError(input, message) {
    const errorEl = document.getElementById(input.id + '-error');
    input.setAttribute('aria-invalid', message ? 'true' : 'false');
    if (errorEl) {
      errorEl.textContent = message || '';
      errorEl.classList.toggle('hidden', !message);
    }
    input.classList.toggle('border-rose-400/70', !!message);
    input.classList.toggle('border-white/10', !message);
  }

  function validateField(input) {
    if (input.type === 'checkbox') {
      const msg = input.checked ? '' : (input.dataset.error || '請勾選此項');
      showFieldError(input, msg);
      return !msg;
    }
    if (input.validity.valid) {
      showFieldError(input, '');
      return true;
    }
    const message = input.validity.valueMissing
      ? (input.dataset.error || '此欄位為必填')
      : (input.dataset.error || input.validationMessage);
    showFieldError(input, message);
    return false;
  }

  document.querySelectorAll('form[data-validate]').forEach((form) => {
    const fields = form.querySelectorAll('input, select, textarea');
    fields.forEach((field) => {
      field.addEventListener('blur', () => { if (field.value || field.required) validateField(field); });
      field.addEventListener('input', () => {
        if (field.getAttribute('aria-invalid') === 'true') validateField(field);
      });
    });

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      let firstInvalid = null;
      fields.forEach((field) => {
        if (!field.willValidate && field.type !== 'checkbox') return;
        const ok = validateField(field);
        if (!ok && !firstInvalid) firstInvalid = field;
      });
      const success = form.querySelector('[data-form-success]');
      if (firstInvalid) {
        if (success) success.classList.add('hidden');
        firstInvalid.focus();
        return;
      }
      // 此處可接入後端（例如 Cloudflare Pages Functions 或第三方表單服務）
      form.reset();
      fields.forEach((f) => showFieldError(f, ''));
      if (success) {
        success.classList.remove('hidden');
        success.focus();
      }
    });
  });

  /* ---------- Dialog（Modal / Lightbox） ---------- */
  document.querySelectorAll('[data-dialog-open]').forEach((btn) => {
    const dlg = document.getElementById(btn.dataset.dialogOpen);
    if (!dlg || typeof dlg.showModal !== 'function') return;
    btn.addEventListener('click', () => dlg.showModal());
  });
  document.querySelectorAll('dialog.site-dialog').forEach((dlg) => {
    // 點擊遮罩（dialog 本身）即關閉
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
    dlg.querySelectorAll('[data-dialog-close]').forEach((b) => b.addEventListener('click', () => dlg.close()));
  });

  /* ---------- Lightbox（相簿） ---------- */
  const lightbox = document.getElementById('lightbox');
  if (lightbox) {
    const img = lightbox.querySelector('[data-lightbox-img]');
    const caption = lightbox.querySelector('[data-lightbox-caption]');
    const items = Array.from(document.querySelectorAll('[data-lightbox-item]'));
    let index = 0;

    const show = (i) => {
      index = (i + items.length) % items.length;
      const item = items[index];
      img.src = item.dataset.src;
      img.alt = item.dataset.alt || '';
      caption.textContent = item.dataset.caption || '';
    };

    items.forEach((item, i) => item.addEventListener('click', () => {
      show(i);
      lightbox.showModal();
    }));
    lightbox.querySelector('[data-lightbox-prev]').addEventListener('click', () => show(index - 1));
    lightbox.querySelector('[data-lightbox-next]').addEventListener('click', () => show(index + 1));
    lightbox.querySelectorAll('[data-dialog-close]').forEach((b) => b.addEventListener('click', () => lightbox.close()));
    lightbox.addEventListener('click', (e) => { if (e.target === lightbox) lightbox.close(); });
    lightbox.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') show(index - 1);
      if (e.key === 'ArrowRight') show(index + 1);
    });
  }

  /* ---------- Tabs（路線切換，符合 WAI-ARIA Tabs 模式） ---------- */
  document.querySelectorAll('[data-tabs]').forEach((group) => {
    const tabs = Array.from(group.querySelectorAll('[role="tab"]'));
    const select = (tab) => {
      tabs.forEach((t) => {
        const selected = t === tab;
        t.setAttribute('aria-selected', String(selected));
        t.tabIndex = selected ? 0 : -1;
        const panel = document.getElementById(t.getAttribute('aria-controls'));
        if (panel) panel.hidden = !selected;
      });
      tab.focus();
    };
    tabs.forEach((tab, i) => {
      tab.addEventListener('click', () => select(tab));
      tab.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          e.preventDefault();
          const dir = e.key === 'ArrowRight' ? 1 : -1;
          select(tabs[(i + dir + tabs.length) % tabs.length]);
        }
      });
    });
  });

  /* ---------- Parallax（輕量 rAF，尊重 reduced motion） ---------- */
  const parallaxEls = document.querySelectorAll('[data-parallax]');
  if (parallaxEls.length && !prefersReducedMotion) {
    let ticking = false;
    const update = () => {
      const y = window.scrollY;
      parallaxEls.forEach((el) => {
        const speed = parseFloat(el.dataset.parallax) || 0.25;
        const rect = el.parentElement.getBoundingClientRect();
        if (rect.bottom < 0 || rect.top > window.innerHeight) return;
        el.style.transform = `translate3d(0, ${(y * speed).toFixed(1)}px, 0) scale(1.12)`;
      });
      ticking = false;
    };
    window.addEventListener('scroll', () => {
      if (!ticking) { requestAnimationFrame(update); ticking = true; }
    }, { passive: true });
    update();
  }
})();
