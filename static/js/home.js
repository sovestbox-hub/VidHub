/* Главная: лента с бесконечной прокруткой, сортировка, фильтр по источнику */
(function () {
  const grid = document.getElementById("grid");
  const more = document.getElementById("more");
  const empty = document.getElementById("empty");
  const status = document.getElementById("status");
  const sentinel = document.getElementById("sentinel");

  const p = new URLSearchParams(location.search);
  const state = {
    q: (p.get("q") || "").trim(),
    sort: ["new", "popular", "long"].includes(p.get("sort")) ? p.get("sort") : "new",
    source: p.get("source") || "",
    page: 0, loading: false, more: true, shown: 0,
  };

  function url(over) {
    const s = Object.assign({ q: state.q, sort: state.sort, source: state.source }, over);
    const u = new URLSearchParams();
    if (s.q) u.set("q", s.q);
    if (s.sort !== "new") u.set("sort", s.sort);
    if (s.source) u.set("source", s.source);
    const qs = u.toString();
    return "/" + (qs ? "?" + qs : "");
  }

  /* вкладки */
  document.querySelectorAll("#tabs a").forEach((a) => {
    a.href = url({ sort: a.dataset.sort });
    if (a.dataset.sort === state.sort) a.setAttribute("aria-current", "page");
  });

  /* источники */
  fetch("/api/sources").then((r) => r.json()).then((d) => {
    if (d.items.length < 2) return;
    const box = document.getElementById("chips");
    const all = VH.el("a", "chip", "Все");
    all.href = url({ source: "" });
    if (!state.source) all.setAttribute("aria-current", "true");
    box.appendChild(all);
    d.items.forEach((s) => {
      const c = VH.el("a", "chip", s.name || s.id);
      c.appendChild(VH.el("small", "", String(s.count)));
      c.href = url({ source: s.id });
      if (state.source === s.id) c.setAttribute("aria-current", "true");
      box.appendChild(c);
    });
  }).catch(() => {});

  function skeletons(n) {
    const out = [];
    for (let i = 0; i < n; i++) {
      const c = VH.el("div", "card skeleton");
      c.appendChild(VH.el("div", "thumb"));
      const b = VH.el("div", "body");
      b.append(VH.el("div", "line"), VH.el("div", "line s"));
      c.appendChild(b);
      grid.appendChild(c);
      out.push(c);
    }
    return out;
  }

  function showEmpty() {
    const link = document.getElementById("empty-link");
    if (state.q || state.source) {
      document.getElementById("empty-title").textContent = state.q ? "Ничего не нашлось" : "В этом источнике пока пусто";
      document.getElementById("empty-text").textContent = state.q
        ? "По запросу «" + state.q + "» видео нет. Попробуйте другое слово."
        : "Видео из этого источника появятся после следующего обновления.";
      link.hidden = false;
    }
    empty.hidden = false;
  }

  async function load() {
    if (state.loading || !state.more) return;
    state.loading = true;
    more.hidden = true;
    const sk = skeletons(state.page === 0 ? 12 : 4);
    try {
      state.page++;
      const q = new URLSearchParams({ page: state.page, sort: state.sort });
      if (state.q) q.set("q", state.q);
      if (state.source) q.set("source", state.source);
      const r = await fetch("/api/videos?" + q);
      if (!r.ok) throw new Error(r.status);
      const d = await r.json();
      sk.forEach((n) => n.remove());

      // афиша: на обычной главной первая карточка крупнее
      const featureFirst = state.page === 1 && !state.q && !state.source && d.items.length >= 5;
      d.items.forEach((v, i) => grid.appendChild(VH.card(v, { feature: featureFirst && i === 0, eager: i < 4 && state.page === 1 })));
      state.shown += d.items.length;
      state.more = d.has_more;

      if (state.page === 1) {
        if (!state.shown) showEmpty();
        else if (state.q) { status.textContent = "Найдено: " + d.total; status.hidden = false; }
      }
    } catch (e) {
      sk.forEach((n) => n.remove());
      state.page--;
      more.textContent = "Не удалось загрузить. Повторить";
      more.hidden = false;
    } finally {
      state.loading = false;
      // если экран высокий и ещё не заполнен — подгружаем следующую порцию сразу
      if (state.more && more.hidden && sentinel.getBoundingClientRect().top < window.innerHeight + 900) {
        setTimeout(load, 0);
      }
    }
  }

  more.addEventListener("click", () => { more.textContent = "Показать ещё"; load(); });

  if ("IntersectionObserver" in window) {
    new IntersectionObserver((e) => { if (e[0].isIntersecting && state.shown) load(); }, { rootMargin: "900px" }).observe(sentinel);
  } else {
    more.hidden = false; // запасной вариант без IntersectionObserver
  }

  /* «/» — быстрый переход к поиску */
  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) {
      e.preventDefault();
      document.getElementById("q").focus();
    }
  });

  load();
})();
