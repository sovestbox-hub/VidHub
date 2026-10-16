/* Страница просмотра: плеер, embed или запасной вариант + похожие видео */
(function () {
  const v = JSON.parse(document.getElementById("video-data").textContent);
  const stage = document.getElementById("player");

  if (v.stream) {
    new VPlayer(stage, {
      src: v.stream, poster: v.thumb, title: v.title, id: v.id,
      sourceUrl: v.go, sourceName: v.source_name,
    });
  } else if (v.embed) {
    const f = document.createElement("iframe");
    f.src = v.embed;
    f.title = v.title;
    f.allow = "autoplay; fullscreen; picture-in-picture; encrypted-media";
    f.referrerPolicy = "origin";
    if (stage.dataset.sandbox === "1") {
      f.setAttribute("sandbox", "allow-scripts allow-same-origin allow-presentation allow-forms allow-popups allow-popups-to-escape-sandbox");
    }
    stage.appendChild(f);
  } else {
    // Встроить нельзя — ведём на оригинал
    const box = VH.el("div", "nostage");
    if (v.thumb) box.style.backgroundImage = "url(" + JSON.stringify(v.thumb) + ")";
    box.appendChild(VH.el("p", "", "Это видео нельзя воспроизвести на нашем сайте. Оно открывается на сайте-источнике."));
    const a = VH.el("a", "btn primary", "Смотреть на " + v.source_name);
    a.href = v.go; a.target = "_blank"; a.rel = "noopener nofollow";
    box.appendChild(a);
    stage.appendChild(box);
  }

  document.getElementById("wviews").textContent = VH.views(v.views + 1) || "Первый просмотр";
  document.getElementById("wadded").textContent = "Добавлено " + VH.timeAgo(v.added_at);

  const copy = document.getElementById("copy");
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      copy.textContent = "Ссылка скопирована";
    } catch (e) {
      copy.textContent = "Скопируйте адрес из строки браузера";
    }
    setTimeout(() => { copy.textContent = "Копировать ссылку"; }, 2200);
  });

  fetch("/api/videos/" + v.id + "/related")
    .then((r) => r.json())
    .then((d) => {
      const box = document.getElementById("related");
      d.items.forEach((it) => box.appendChild(VH.card(it)));
      if (!d.items.length) box.closest("aside").hidden = true;
    })
    .catch(() => {});
})();
