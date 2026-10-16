/* Общие функции: карточка видео, форматирование, возрастное подтверждение */
(function () {
  const nf = new Intl.NumberFormat("ru", { notation: "compact", maximumFractionDigits: 1 });
  const rtf = new Intl.RelativeTimeFormat("ru", { numeric: "auto" });

  const PLAY = "M8 5v14l11-7z";
  const EXT = "M14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7zM19 19H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14c1.1 0 2-.9 2-2v-7h-2v7z";

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function icon(path) {
    const ns = "http://www.w3.org/2000/svg";
    const s = document.createElementNS(ns, "svg");
    s.setAttribute("viewBox", "0 0 24 24");
    s.setAttribute("aria-hidden", "true");
    const p = document.createElementNS(ns, "path");
    p.setAttribute("d", path);
    s.appendChild(p);
    return s;
  }

  function duration(sec) {
    if (!sec) return "";
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    const mm = h ? String(m).padStart(2, "0") : String(m);
    return (h ? h + ":" : "") + mm + ":" + String(s).padStart(2, "0");
  }

  function timeAgo(ts) {
    const diff = ts * 1000 - Date.now(); // отрицательное число
    const abs = Math.abs(diff) / 1000;
    const units = [["year", 31536000], ["month", 2592000], ["week", 604800], ["day", 86400], ["hour", 3600], ["minute", 60]];
    for (const [u, s] of units) {
      if (abs >= s) return rtf.format(Math.round(diff / 1000 / s), u);
    }
    return "только что";
  }

  function views(n) {
    return n > 0 ? nf.format(n) + " просм." : "";
  }

  /* Анимированное превью при наведении мыши (если источник дал preview) */
  function attachPreview(thumb, img, url) {
    const isVideo = /\.(mp4|webm)(\?|#|$)/i.test(url);
    const original = img.src;
    let timer = null, pv = null;
    const start = () => {
      if (isVideo) {
        pv = el("video", "pv");
        pv.muted = true; pv.loop = true; pv.playsInline = true; pv.src = url;
        thumb.appendChild(pv);
        pv.play().catch(() => {});
      } else {
        img.src = url;
      }
    };
    const stop = () => {
      clearTimeout(timer);
      if (pv) { pv.remove(); pv = null; } else if (img.src !== original) { img.src = original; }
    };
    thumb.addEventListener("pointerenter", (e) => { if (e.pointerType === "mouse") timer = setTimeout(start, 250); });
    thumb.addEventListener("pointerleave", stop);
  }

  function card(v, opts) {
    opts = opts || {};
    const a = el("a", "card" + (opts.feature ? " feature" : ""));
    a.href = v.href;
    if (v.external) { a.target = "_blank"; a.rel = "noopener nofollow"; }

    const thumb = el("div", "thumb" + (v.thumb ? "" : " noimg"));
    const img = new Image();
    img.alt = ""; img.decoding = "async"; img.referrerPolicy = "no-referrer";
    if (!opts.eager) img.loading = "lazy";
    img.addEventListener("error", () => thumb.classList.add("noimg"));
    if (v.thumb) img.src = v.thumb;
    thumb.appendChild(img);
    if (v.preview && v.thumb) attachPreview(thumb, img, v.preview);

    const play = el("span", "play");
    play.appendChild(icon(PLAY));
    thumb.appendChild(play);

    if (v.duration) thumb.appendChild(el("span", "dur", duration(v.duration)));
    if (v.external) {
      const ext = el("span", "ext");
      ext.title = "Откроется на сайте-источнике";
      ext.appendChild(icon(EXT));
      thumb.appendChild(ext);
    }

    const body = el("div", "body");
    body.appendChild(el("h3", "title", v.title));
    const meta = el("div", "meta");
    meta.appendChild(el("span", "src", v.source_name));
    const stats = el("div", "stats");
    const vw = views(v.views);
    if (vw) stats.appendChild(el("span", "", vw));
    stats.appendChild(el("span", "", timeAgo(v.added_at)));
    meta.appendChild(stats);
    body.appendChild(meta);

    a.append(thumb, body);
    return a;
  }

  function ageGate() {
    if (!document.body.dataset.ageGate) return;
    let ok = false;
    try { ok = localStorage.getItem("vh_age_ok") === "1"; } catch (e) { /* приватный режим */ }
    if (ok) return;
    const dlg = document.getElementById("age");
    if (!dlg || !dlg.showModal) return;
    dlg.addEventListener("cancel", (e) => e.preventDefault()); // Esc не закрывает окно
    document.getElementById("age-yes").addEventListener("click", () => {
      try { localStorage.setItem("vh_age_ok", "1"); } catch (e) { /* ничего */ }
      dlg.close();
    });
    dlg.showModal();
  }

  window.VH = { el, icon, card, duration, timeAgo, views };
  document.addEventListener("DOMContentLoaded", ageGate);
})();
