/* ==========================================================================
   sample-web · 動態引擎（Motion Engine）
   Lenis 平滑滾動 × GSAP ScrollTrigger 同步核心
   --------------------------------------------------------------------------
   整合原理（官方建議模式）：
   1. lenis.on('scroll', ScrollTrigger.update) — Lenis 每次滾動時通知 ScrollTrigger
      重算進度，捲動觸發動畫與平滑滾動共用同一份座標系。
   2. gsap.ticker.add(time => lenis.raf(time * 1000)) — 由 GSAP 的全域 ticker
      驅動 Lenis 的 raf，兩套引擎共用單一 requestAnimationFrame 迴圈，
      杜絕雙 rAF 造成的掉幀與相位差。
   3. gsap.ticker.lagSmoothing(0) — 關閉 lag smoothing，捲動跟手不補間。
   4. 視窗 resize（防抖）→ lenis.resize() + ScrollTrigger.refresh() 重算座標。
   ========================================================================== */
(function () {
  'use strict';

  var MotionEngine = {
    lenis: null,
    ready: false,
    reducedMotion: false,
    isTouch: false,
    hasFinePointer: false,

    /* ---------- 初始化（由各動效頁呼叫一次） ---------- */
    init: function (options) {
      options = options || {};
      if (this.ready) return this;
      this.ready = true;

      this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      this.isTouch = window.matchMedia('(hover: none), (pointer: coarse)').matches;
      this.hasFinePointer = window.matchMedia('(pointer: fine)').matches;

      var html = document.documentElement;

      /* Lenis 平滑滾動：reduced-motion 或觸控裝置降級為原生滾動 */
      if (window.Lenis && !this.reducedMotion && !this.isTouch && options.smooth !== false) {
        html.style.scrollBehavior = 'auto'; /* 避免與 CSS scroll-behavior 衝突 */
        this.lenis = new window.Lenis({
          duration: 1.15,
          easing: function (t) { return Math.min(1, 1.001 - Math.pow(2, -10 * t)); },
          smoothWheel: true,
          wheelMultiplier: 1,
          touchMultiplier: 1.5
        });
      }

      var hasGsap = !!(window.gsap && window.ScrollTrigger);

      if (hasGsap) {
        window.gsap.registerPlugin(window.ScrollTrigger);

        if (this.lenis) {
          /* 關鍵同步：Lenis 捲動 → ScrollTrigger.update */
          this.lenis.on('scroll', window.ScrollTrigger.update);
          /* 關鍵同步：gsap.ticker 驅動 Lenis 渲染 */
          window.gsap.ticker.add(function (time) {
            MotionEngine.lenis.raf(time * 1000);
          });
          window.gsap.ticker.lagSmoothing(0);
        }
      } else if (this.lenis) {
        /* 無 GSAP 時仍以原生 rAF 驅動 Lenis */
        var raf = function (time) {
          MotionEngine.lenis.raf(time);
          requestAnimationFrame(raf);
        };
        requestAnimationFrame(raf);
      }

      /* 視窗尺寸改變：防抖後重算 Lenis 與 ScrollTrigger 座標 */
      var resizeTimer = null;
      window.addEventListener('resize', function () {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(function () {
          if (MotionEngine.lenis && MotionEngine.lenis.resize) MotionEngine.lenis.resize();
          if (window.ScrollTrigger) window.ScrollTrigger.refresh();
        }, 200);
      });

      /* 錨點平滑捲動（相容無 Lenis 情境） */
      document.querySelectorAll('a[href^="#"]').forEach(function (link) {
        link.addEventListener('click', function (e) {
          var id = link.getAttribute('href');
          if (!id || id === '#' || id.length < 2) return;
          var target = document.querySelector(id);
          if (!target) return;
          e.preventDefault();
          var offset = -(options.anchorOffset || 72);
          if (MotionEngine.lenis) {
            MotionEngine.lenis.scrollTo(target, { offset: offset, duration: 1.35 });
          } else {
            var top = target.getBoundingClientRect().top + window.pageYOffset + offset;
            window.scrollTo({ top: top, behavior: MotionEngine.reducedMotion ? 'auto' : 'smooth' });
          }
        });
      });

      return this;
    },

    /* ---------- 便利方法：捲動進度監聽（rAF 節流，不觸發重排） ---------- */
    onScrollProgress: function (callback) {
      if (window.ScrollTrigger) {
        window.ScrollTrigger.create({
          trigger: document.body,
          start: 'top top',
          end: 'bottom bottom',
          onUpdate: function (self) { callback(self.progress); }
        });
      } else {
        var ticking = false;
        window.addEventListener('scroll', function () {
          if (ticking) return;
          ticking = true;
          requestAnimationFrame(function () {
            var max = document.documentElement.scrollHeight - window.innerHeight;
            callback(max > 0 ? window.pageYOffset / max : 0);
            ticking = false;
          });
        }, { passive: true });
      }
    }
  };

  window.MotionEngine = MotionEngine;
})();
