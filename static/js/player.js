/* VPlayer — свой видеоплеер на HTML5 <video>.
 *
 * Возможности: MP4/WebM и HLS (.m3u8, через hls.js) с выбором качества, перемотка с подсказкой времени,
 * скорость, громкость, PiP, полный экран, горячие клавиши, двойной тап ±10 с, продолжение с места остановки.
 *
 *   new VPlayer(containerElement, { src, poster, title, id, sourceUrl, sourceName });
 *
 * hls.js подгружается с CDN только для .m3u8. Чтобы хостить свой экземпляр, задайте до загрузки страницы:
 *   window.VPLAYER_HLS_URL = "/static/js/hls.min.js";
 */
(function () {
  const HLS_URL = window.VPLAYER_HLS_URL || "https://cdn.jsdelivr.net/npm/hls.js@1.5.17/dist/hls.min.js";
  const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

  const P = {
    play: "M8 5v14l11-7z",
    pause: "M6 19h4V5H6v14zm8-14v14h4V5h-4z",
    volHigh: "M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z",
    volLow: "M18.5 12c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM5 9v6h4l5 5V4L9 9H5z",
    mute: "M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z",
    full: "M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z",
    fullExit: "M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z",
    pip: "M19 11h-8v6h8v-6zm4 8V4.98C23 3.88 22.1 3 21 3H3c-1.1 0-2 .88-2 1.98V19c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2zm-2 .02H3V4.97h18v14.05z",
  };
  const svg = (d) => '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + d + '"/></svg>';

  const TEMPLATE =
    '<div class="vp paused" tabindex="0" role="region" aria-label="Видеоплеер">' +
    '<video playsinline preload="metadata"></video>' +
    '<div class="vp-shade"></div>' +
    '<button class="vp-big" type="button" aria-label="Воспроизвести">' + svg(P.play) + "</button>" +
    '<div class="vp-spin"></div>' +
    '<div class="vp-toast" role="status" aria-live="polite"></div>' +
    '<div class="vp-error"><p></p><a class="btn primary" target="_blank" rel="noopener nofollow"></a></div>' +
    '<div class="vp-bar">' +
    '<div class="vp-seek" role="slider" tabindex="0" aria-label="Перемотка" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">' +
    '<div class="vp-track"></div><div class="vp-buf"></div><div class="vp-fill"></div><div class="vp-knob"></div><div class="vp-tip">0:00</div></div>' +
    '<div class="vp-row">' +
    '<button class="vp-btn" data-a="play" type="button" aria-label="Воспроизвести">' + svg(P.play) + "</button>" +
    '<div class="vp-vol"><button class="vp-btn" data-a="mute" type="button" aria-label="Выключить звук">' + svg(P.volHigh) + "</button>" +
    '<input type="range" min="0" max="1" step="0.02" value="1" aria-label="Громкость"></div>' +
    '<span class="vp-time"><span class="vp-cur">0:00</span><span class="vp-sep">/</span><span class="vp-dur">0:00</span></span>' +
    '<span class="vp-spacer"></span>' +
    '<button class="vp-btn txt" data-a="quality" type="button" aria-label="Качество" hidden>Авто</button>' +
    '<button class="vp-btn txt" data-a="speed" type="button" aria-label="Скорость">1×</button>' +
    '<button class="vp-btn" data-a="pip" type="button" aria-label="Картинка в картинке" hidden>' + svg(P.pip) + "</button>" +
    '<button class="vp-btn" data-a="full" type="button" aria-label="На весь экран">' + svg(P.full) + "</button>" +
    "</div></div></div>";

  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const fmt = (s) => {
    if (!isFinite(s) || s < 0) s = 0;
    s = Math.floor(s);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(x).padStart(2, "0");
  };
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ничего */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ничего */ } },
  };

  let hlsLoader = null;
  function loadHls() {
    if (window.Hls) return Promise.resolve(window.Hls);
    if (!hlsLoader) {
      hlsLoader = new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = HLS_URL;
        s.onload = () => (window.Hls ? resolve(window.Hls) : reject(new Error("hls.js")));
        s.onerror = () => reject(new Error("hls.js не загрузился"));
        document.head.appendChild(s);
      });
    }
    return hlsLoader;
  }

  class VPlayer {
    constructor(root, opts) {
      this.o = opts || {};
      root.innerHTML = TEMPLATE;
      const el = (this.el = root.querySelector(".vp"));
      const $ = (s) => el.querySelector(s);
      this.v = $("video");
      this.seek = $(".vp-seek");
      this.fill = $(".vp-fill");
      this.buf = $(".vp-buf");
      this.knob = $(".vp-knob");
      this.tip = $(".vp-tip");
      this.toastEl = $(".vp-toast");
      this.volInput = $(".vp-vol input");
      this.btn = {};
      el.querySelectorAll("[data-a]").forEach((b) => { this.btn[b.dataset.a] = b; });
      this.curEl = $(".vp-cur");
      this.durEl = $(".vp-dur");
      this.menu = null;
      this.quality = -1;
      this.levels = [];
      this.hls = null;
      this.dragging = false;
      this.lastPointer = "mouse";
      this.lastSave = 0;

      if (this.o.poster) this.v.poster = this.o.poster;
      this.bindUI();
      this.bindVideo();
      this.restoreVolume();
      this.load();
      this.setupMediaSession();
    }

    /* ---------- загрузка источника ---------- */
    load() {
      const src = this.o.src;
      if (/\.m3u8(\?|#|$)/i.test(src)) {
        loadHls()
          .then((Hls) => (Hls.isSupported() ? this.useHls(Hls, src) : (this.v.src = src)))
          .catch(() => { this.v.src = src; }); // Safari умеет HLS сам
      } else {
        this.v.src = src;
      }
    }

    useHls(Hls, src) {
      const hls = (this.hls = new Hls({ capLevelToPlayerSize: true, enableWorker: true, maxBufferLength: 30 }));
      hls.loadSource(src);
      hls.attachMedia(this.v);
      hls.on(Hls.Events.MANIFEST_PARSED, (_e, d) => {
        this.levels = d.levels.map((l, i) => ({ i, h: l.height })).filter((l) => l.h).sort((a, b) => b.h - a.h);
        if (this.levels.length > 1) this.btn.quality.hidden = false;
      });
      hls.on(Hls.Events.LEVEL_SWITCHED, (_e, d) => {
        if (this.quality !== -1) return;
        const l = hls.levels[d.level];
        this.btn.quality.textContent = l && l.height ? "Авто " + l.height + "p" : "Авто";
      });
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (!data.fatal) return;
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR && !this.netRetry) { this.netRetry = true; hls.startLoad(); }
        else if (data.type === Hls.ErrorTypes.MEDIA_ERROR && !this.mediaRetry) { this.mediaRetry = true; hls.recoverMediaError(); }
        else this.fail();
      });
    }

    fail() {
      const el = this.el;
      el.classList.add("error");
      el.classList.remove("waiting");
      el.querySelector(".vp-error p").textContent = "Не удалось загрузить видео. Возможно, оно удалено или недоступно в вашем регионе.";
      const a = el.querySelector(".vp-error a");
      if (this.o.sourceUrl) {
        a.href = this.o.sourceUrl;
        a.textContent = "Смотреть на " + (this.o.sourceName || "сайте-источнике");
      } else {
        a.hidden = true;
      }
    }

    /* ---------- действия ---------- */
    toggle() { if (this.el.classList.contains("error")) return; this.v.paused ? this.v.play().catch(() => {}) : this.v.pause(); }

    seekBy(d) {
      const v = this.v;
      if (!isFinite(v.duration)) return;
      v.currentTime = clamp(v.currentTime + d, 0, v.duration);
      this.toast((d > 0 ? "+" : "−") + Math.abs(d) + " с");
    }

    setVolume(x) {
      const v = this.v;
      v.volume = clamp(x, 0, 1);
      v.muted = v.volume === 0;
      this.toast("Громкость " + Math.round(v.volume * 100) + "%");
    }

    toggleMute() { this.v.muted = !this.v.muted; if (!this.v.muted && this.v.volume === 0) this.v.volume = 0.5; }

    setRate(r) { this.v.playbackRate = clamp(r, 0.25, 4); }

    isFull() { return document.fullscreenElement === this.el || document.webkitFullscreenElement === this.el; }

    toggleFull() {
      const el = this.el;
      if (this.isFull()) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      else if (el.requestFullscreen) el.requestFullscreen().catch(() => {});
      else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
      else if (this.v.webkitEnterFullscreen) this.v.webkitEnterFullscreen(); // iPhone
    }

    togglePip() {
      if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => {});
      else if (this.v.requestPictureInPicture) this.v.requestPictureInPicture().catch(() => {});
    }

    toast(text) {
      const t = this.toastEl;
      t.textContent = text;
      t.classList.add("on");
      clearTimeout(this.toastT);
      this.toastT = setTimeout(() => t.classList.remove("on"), 900);
    }

    /* ---------- меню (скорость / качество) ---------- */
    openMenu(btn, items, current, onPick) {
      const same = this.menuBtn === btn;
      this.closeMenu();
      if (same) return;
      const m = document.createElement("div");
      m.className = "vp-menu";
      m.setAttribute("role", "menu");
      items.forEach((it) => {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = it.label;
        if (it.value === current) b.className = "on";
        b.addEventListener("click", () => { onPick(it.value); this.closeMenu(); });
        m.appendChild(b);
      });
      this.el.appendChild(m);
      this.menu = m;
      this.menuBtn = btn;
      clearTimeout(this.idleT);
      const first = m.querySelector(".on") || m.firstChild;
      if (first) first.focus();
    }

    closeMenu() {
      if (this.menu) this.menu.remove();
      this.menu = null;
      this.menuBtn = null;
      this.poke();
    }

    /* ---------- показ/скрытие панели ---------- */
    poke() {
      const el = this.el;
      el.classList.remove("idle");
      clearTimeout(this.idleT);
      if (!this.v.paused && !this.menu && !this.overBar && !this.dragging) {
        this.idleT = setTimeout(() => el.classList.add("idle"), 2800);
      }
    }

    /* ---------- интерфейс ---------- */
    bindUI() {
      const el = this.el, v = this.v, b = this.btn;

      this.el.querySelector(".vp-big").addEventListener("click", () => this.toggle());
      b.play.addEventListener("click", () => this.toggle());
      b.mute.addEventListener("click", () => this.toggleMute());
      b.full.addEventListener("click", () => this.toggleFull());
      b.pip.addEventListener("click", () => this.togglePip());
      b.speed.addEventListener("click", () =>
        this.openMenu(b.speed, SPEEDS.map((s) => ({ label: s === 1 ? "Обычная" : String(s).replace(".", ",") + "×", value: s })), v.playbackRate, (r) => this.setRate(r)));
      b.quality.addEventListener("click", () => {
        const items = [{ label: "Авто", value: -1 }].concat(this.levels.map((l) => ({ label: l.h + "p", value: l.i })));
        this.openMenu(b.quality, items, this.quality, (q) => {
          this.quality = q;
          if (this.hls) this.hls.currentLevel = q;
          b.quality.textContent = q === -1 ? "Авто" : (this.hls.levels[q].height + "p");
        });
      });
      this.volInput.addEventListener("input", () => {
        v.volume = parseFloat(this.volInput.value);
        v.muted = v.volume === 0;
      });

      if (document.pictureInPictureEnabled && !v.disablePictureInPicture) b.pip.hidden = false;
      if (!(el.requestFullscreen || el.webkitRequestFullscreen || v.webkitEnterFullscreen)) b.full.hidden = true;

      /* клик / двойной клик по видео */
      el.addEventListener("pointerdown", (e) => { this.lastPointer = e.pointerType; });
      v.addEventListener("click", () => {
        if (this.menu) { this.closeMenu(); return; }
        if (this.lastPointer === "touch" && el.classList.contains("idle")) { this.poke(); return; }
        clearTimeout(this.clickT);
        this.clickT = setTimeout(() => this.toggle(), 220);
      });
      v.addEventListener("dblclick", (e) => {
        clearTimeout(this.clickT);
        const r = v.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width;
        if (x < 0.33) this.seekBy(-10);
        else if (x > 0.66) this.seekBy(10);
        else this.toggleFull();
      });

      /* авто-скрытие панели */
      ["pointermove", "pointerdown", "keydown", "focusin"].forEach((t) => el.addEventListener(t, () => this.poke()));
      const bar = el.querySelector(".vp-bar");
      bar.addEventListener("pointerenter", () => { this.overBar = true; this.poke(); });
      bar.addEventListener("pointerleave", () => { this.overBar = false; this.poke(); });
      document.addEventListener("pointerdown", (e) => {
        if (this.menu && !this.menu.contains(e.target) && !(this.menuBtn && this.menuBtn.contains(e.target))) this.closeMenu();
      });

      /* полоса перемотки */
      const seek = this.seek;
      const ratio = (e) => { const r = seek.getBoundingClientRect(); return clamp((e.clientX - r.left) / r.width, 0, 1); };
      const showAt = (r) => {
        const w = seek.clientWidth;
        this.tip.textContent = fmt(r * (v.duration || 0));
        this.tip.style.left = clamp(r * w, 26, w - 26) + "px";
      };
      seek.addEventListener("pointerdown", (e) => {
        if (!isFinite(v.duration)) return;
        seek.setPointerCapture(e.pointerId);
        this.dragging = true;
        seek.classList.add("drag");
        const r = ratio(e);
        this.paint(r);
        showAt(r);
      });
      seek.addEventListener("pointermove", (e) => {
        const r = ratio(e);
        showAt(r);
        if (this.dragging) this.paint(r);
      });
      const end = (e) => {
        if (!this.dragging) return;
        this.dragging = false;
        seek.classList.remove("drag");
        v.currentTime = ratio(e) * v.duration;
        this.poke();
      };
      seek.addEventListener("pointerup", end);
      seek.addEventListener("pointercancel", () => { this.dragging = false; seek.classList.remove("drag"); });

      /* горячие клавиши */
      document.addEventListener("keydown", (e) => {
        if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
        const t = e.target;
        if (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
        if ((e.key === " " || e.key === "Enter") && /^(BUTTON|A)$/.test(t.tagName)) return; // пусть работает кнопка
        const k = e.key;
        let handled = true;
        if (k === " " || k === "k" || k === "K" || k === "л" || k === "Л") this.toggle();
        else if (k === "ArrowLeft") this.seekBy(-5);
        else if (k === "ArrowRight") this.seekBy(5);
        else if (k === "j" || k === "J" || k === "о" || k === "О") this.seekBy(-10);
        else if (k === "l" || k === "L" || k === "д" || k === "Д") this.seekBy(10);
        else if (k === "ArrowUp") this.setVolume(v.volume + 0.05);
        else if (k === "ArrowDown") this.setVolume(v.volume - 0.05);
        else if (k === "m" || k === "M" || k === "ь" || k === "Ь") this.toggleMute();
        else if (k === "f" || k === "F" || k === "а" || k === "А") this.toggleFull();
        else if (k === "Home") v.currentTime = 0;
        else if (k === "End" && isFinite(v.duration)) v.currentTime = v.duration - 0.1;
        else if (/^[0-9]$/.test(k) && isFinite(v.duration)) v.currentTime = (v.duration * Number(k)) / 10;
        else if (k === ">" || k === "<") {
          const i = SPEEDS.indexOf(v.playbackRate);
          const n = clamp((i < 0 ? 2 : i) + (k === ">" ? 1 : -1), 0, SPEEDS.length - 1);
          this.setRate(SPEEDS[n]);
          this.toast("Скорость " + SPEEDS[n] + "×");
        } else if (k === "Escape" && this.menu) this.closeMenu();
        else handled = false;
        if (handled) { e.preventDefault(); this.poke(); }
      });

      const fsChange = () => {
        const full = this.isFull();
        b.full.innerHTML = svg(full ? P.fullExit : P.full);
        b.full.setAttribute("aria-label", full ? "Выйти из полноэкранного режима" : "На весь экран");
      };
      document.addEventListener("fullscreenchange", fsChange);
      document.addEventListener("webkitfullscreenchange", fsChange);
    }

    /* ---------- события видео ---------- */
    bindVideo() {
      const v = this.v, el = this.el, b = this.btn;
      const syncPlay = () => {
        const paused = v.paused;
        el.classList.toggle("paused", paused);
        b.play.innerHTML = svg(paused ? P.play : P.pause);
        b.play.setAttribute("aria-label", paused ? "Воспроизвести" : "Пауза");
        this.poke();
      };
      v.addEventListener("play", syncPlay);
      v.addEventListener("pause", () => { syncPlay(); this.savePosition(true); });
      v.addEventListener("ended", () => { syncPlay(); store.del(this.posKey()); });
      ["waiting", "seeking"].forEach((t) => v.addEventListener(t, () => el.classList.add("waiting")));
      ["playing", "canplay", "seeked", "loadeddata"].forEach((t) => v.addEventListener(t, () => el.classList.remove("waiting")));
      v.addEventListener("timeupdate", () => { this.onTime(); this.savePosition(false); });
      v.addEventListener("progress", () => this.onBuffer());
      v.addEventListener("durationchange", () => { this.durEl.textContent = fmt(v.duration); this.onTime(); });
      v.addEventListener("loadedmetadata", () => { this.durEl.textContent = fmt(v.duration); this.resume(); });
      v.addEventListener("ratechange", () => {
        b.speed.textContent = String(v.playbackRate).replace(".", ",") + "×";
      });
      v.addEventListener("volumechange", () => this.syncVolume());
      v.addEventListener("error", () => { if (v.error && v.error.code !== 1 && !this.hls) this.fail(); });
      window.addEventListener("pagehide", () => this.savePosition(true));
    }

    onTime() {
      const v = this.v;
      this.curEl.textContent = fmt(v.currentTime);
      if (!this.dragging && isFinite(v.duration) && v.duration > 0) {
        const r = v.currentTime / v.duration;
        this.paint(r, true);
        this.seek.setAttribute("aria-valuenow", String(Math.round(r * 100)));
        this.seek.setAttribute("aria-valuetext", fmt(v.currentTime) + " из " + fmt(v.duration));
      }
    }

    paint(r, silent) {
      this.fill.style.width = r * 100 + "%";
      this.knob.style.left = r * 100 + "%";
      if (!silent) this.curEl.textContent = fmt(r * (this.v.duration || 0));
    }

    onBuffer() {
      const v = this.v;
      if (!isFinite(v.duration) || !v.duration) return;
      let end = 0;
      for (let i = 0; i < v.buffered.length; i++) {
        if (v.buffered.start(i) <= v.currentTime + 0.5) end = Math.max(end, v.buffered.end(i));
      }
      this.buf.style.width = (end / v.duration) * 100 + "%";
    }

    /* ---------- громкость и позиция ---------- */
    restoreVolume() {
      const vol = parseFloat(store.get("vp_vol"));
      if (isFinite(vol)) this.v.volume = clamp(vol, 0, 1);
      this.v.muted = store.get("vp_muted") === "1";
      this.syncVolume();
    }

    syncVolume() {
      const v = this.v;
      const level = v.muted ? 0 : v.volume;
      this.volInput.value = level;
      this.btn.mute.innerHTML = svg(level === 0 ? P.mute : level < 0.5 ? P.volLow : P.volHigh);
      this.btn.mute.setAttribute("aria-label", level === 0 ? "Включить звук" : "Выключить звук");
      store.set("vp_vol", String(v.volume));
      store.set("vp_muted", v.muted ? "1" : "0");
    }

    posKey() { return "vp_pos_" + (this.o.id || this.o.src); }

    savePosition(force) {
      const v = this.v, now = Date.now();
      if (!force && now - this.lastSave < 4000) return;
      if (!isFinite(v.duration) || v.duration < 40) return;
      this.lastSave = now;
      if (v.currentTime > 10 && v.currentTime < v.duration - 15) store.set(this.posKey(), String(Math.floor(v.currentTime)));
      else if (v.currentTime >= v.duration - 15) store.del(this.posKey()); // почти досмотрели — начнём сначала
    }

    resume() {
      const v = this.v;
      const t = parseInt(store.get(this.posKey()), 10);
      if (t > 5 && isFinite(v.duration) && t < v.duration - 15) {
        v.currentTime = t;
        this.toast("Продолжаем с " + fmt(t));
      }
    }

    setupMediaSession() {
      if (!("mediaSession" in navigator) || typeof MediaMetadata === "undefined") return;
      try {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: this.o.title || "",
          artist: this.o.sourceName || "",
          artwork: this.o.poster ? [{ src: this.o.poster }] : [],
        });
        navigator.mediaSession.setActionHandler("play", () => this.toggle());
        navigator.mediaSession.setActionHandler("pause", () => this.toggle());
        navigator.mediaSession.setActionHandler("seekbackward", () => this.seekBy(-10));
        navigator.mediaSession.setActionHandler("seekforward", () => this.seekBy(10));
      } catch (e) { /* не критично */ }
    }

    destroy() {
      if (this.hls) this.hls.destroy();
      this.v.removeAttribute("src");
      this.v.load();
    }
  }

  window.VPlayer = VPlayer;
})();
