"""Алгоритм сбора ссылок на видео.

Для каждого источника из sources.json:
  1. скачивает страницу(ы) со списком видео (HTML, RSS/Atom или JSON API);
  2. вытаскивает ссылку, название, превью и длительность;
  3. (опционально) заходит на страницу видео и ищет embed-код или прямой поток;
  4. сохраняет только новые видео в базу.

Запуск из консоли:
  python crawler.py                       собрать со всех источников
  python crawler.py --source my_site      только один источник
  python crawler.py --test my_site        проверить селекторы, ничего не сохраняя
"""
import argparse
import itertools
import json
import logging
import re
import sys
import threading
import time
from collections import namedtuple
from urllib.parse import urldefrag, urljoin, urlparse

import requests
from bs4 import BeautifulSoup

import db
import settings

log = logging.getLogger("vidhub.crawler")

MAX_BYTES = 8 * 1024 * 1024
ATTR_RE = re.compile(r"^[\w:\-|]+$")
VIDEO_FILE_RE = re.compile(r"\.(m3u8|mp4|webm|m4v)(\?|#|$)", re.I)

DEFAULT_LINK = "a@href||@href"
DEFAULT_TITLE = "a@title||@title||img@alt||a"
DEFAULT_THUMB = "img@data-src|data-original|data-lazy-src|data-thumb|data-srcset|srcset|src"
DEFAULT_VIDEO = (
    "meta[property='og:video:secure_url']@content||meta[property='og:video:url']@content||"
    "meta[property='og:video']@content||meta[name='twitter:player']@content||"
    "video source@src||video@src"
)

Page = namedtuple("Page", "url status content")


class ConfigError(Exception):
    pass


# --------------------------------------------------------------------------- утилиты

def clean(s):
    return re.sub(r"\s+", " ", s or "").strip()


def abs_url(raw, base):
    raw = (raw or "").strip()
    if not raw or raw.startswith(("data:", "javascript:", "blob:", "#")):
        return None
    u = urldefrag(urljoin(base or "", raw))[0]
    p = urlparse(u)
    if p.scheme not in ("http", "https") or not p.netloc:
        return None
    return u


def https(u):
    return "https" + u[4:] if u and u.startswith("http://") else u


def best_srcset(raw):
    parts = [p.strip().split(" ")[0] for p in raw.split(",") if p.strip()]
    return parts[-1] if parts else raw


def parse_duration(v):
    """'12:34', '1:02:03', 'PT1H2M3S', '12 мин', '754' -> секунды."""
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return int(v) if v > 0 else None
    s = str(v).strip().lower()
    if not s:
        return None
    m = re.fullmatch(r"pt(?:(\d+)h)?(?:(\d+)m)?(?:(\d+(?:\.\d+)?)s)?", s)
    if m and any(m.groups()):
        h, mi, se = (float(x) if x else 0 for x in m.groups())
        return int(h * 3600 + mi * 60 + se) or None
    m = re.fullmatch(r"(?:(\d+):)?(\d{1,3}):(\d{2})", s)
    if m:
        return int(m.group(1) or 0) * 3600 + int(m.group(2)) * 60 + int(m.group(3))
    if re.fullmatch(r"\d+(?:\.\d+)?", s):
        return int(float(s)) or None
    total, found = 0, False
    for pat, mult in ((r"(\d+)\s*(?:h|ч|час\w*|hours?)", 3600),
                      (r"(\d+)\s*(?:m|min\w*|мин\w*)", 60),
                      (r"(\d+)\s*(?:s|sec\w*|с|сек\w*)", 1)):
        mm = re.search(pat, s)
        if mm:
            total += int(mm.group(1)) * mult
            found = True
    return total if found and total > 0 else None


# --------------------------------------------------------------------------- селекторы
# Мини-язык:  "css-селектор@атрибут1|атрибут2"   — значение атрибута (первый непустой)
#             "css-селектор"                      — текст элемента
#             "@href"                             — атрибут самого элемента
#             "a@href||b@href"                    — запасные варианты (берётся первый найденный)

def split_spec(spec):
    sel, sep, attrs = spec.rpartition("@")
    if sep and ATTR_RE.match(attrs):
        return sel.strip(), attrs.split("|")
    return spec.strip(), None


def pick(node, spec, base=None, as_url=False):
    if not spec:
        return None
    for one in spec.split("||"):
        value = _pick_one(node, one.strip(), base, as_url)
        if value:
            return value
    return None


def _pick_one(node, spec, base, as_url):
    sel, attrs = split_spec(spec)
    try:
        el = node.select_one(sel) if sel else node
    except Exception as e:  # некорректный CSS-селектор
        raise ConfigError("неверный селектор %r: %s" % (spec, e))
    if el is None:
        return None
    if attrs is None:
        text = clean(el.get_text(" ", strip=True)) or None
        return (abs_url(text, base) if as_url else text)
    for a in attrs:
        raw = el.get(a)
        if isinstance(raw, list):
            raw = " ".join(raw)
        raw = (raw or "").strip()
        if not raw:
            continue
        if a.endswith("srcset"):
            raw = best_srcset(raw)
        if as_url:
            u = abs_url(raw, base)
            if u:
                return u
        else:
            return raw
    return None


def make_soup(content, xml=False):
    if xml:
        # RSS-пространства имён: media:thumbnail -> media-thumbnail (удобно для CSS-селекторов)
        content = re.sub(rb"<(/?)([A-Za-z0-9_]+):([A-Za-z0-9_]+)", rb"<\1\2-\3", content)
        return BeautifulSoup(content, "xml")
    try:
        return BeautifulSoup(content, "lxml")
    except Exception:
        return BeautifulSoup(content, "html.parser")


# --------------------------------------------------------------------------- JSON

def dig(obj, path):
    cur = obj
    for part in str(path).split("."):
        if part == "":
            continue
        if isinstance(cur, list):
            try:
                cur = cur[int(part)]
            except (ValueError, IndexError):
                return None
        elif isinstance(cur, dict):
            cur = cur.get(part)
        else:
            return None
        if cur is None:
            return None
    return cur


def render(tpl, obj):
    """'thumbs.0.src' -> значение по пути;  'https://x/v/{id}' -> подстановка полей."""
    if not tpl:
        return None
    if "{" in tpl:
        def sub(m):
            v = dig(obj, m.group(1))
            return "" if v is None else str(v)
        return re.sub(r"\{([^{}]+)\}", sub, tpl)
    return dig(obj, tpl)


def parse_json(src, content, page_url):
    data = json.loads(content.decode("utf-8", errors="replace"))
    rows = dig(data, src.get("items_path", "")) if src.get("items_path") else data
    if not isinstance(rows, list):
        raise ConfigError("items_path %r не указывает на список" % src.get("items_path"))
    f = src.get("fields") or {}
    if "url" not in f or "title" not in f:
        raise ConfigError("для type=json нужны fields.url и fields.title")
    out = []
    for r in rows:
        url = abs_url(render(f["url"], r), page_url)
        title = clean(str(render(f["title"], r) or ""))
        if not url or not title:
            continue
        out.append({
            "url": url,
            "title": title,
            "thumb": abs_url(render(f.get("thumb"), r), page_url),
            "preview": abs_url(render(f.get("preview"), r), page_url),
            "duration": parse_duration(render(f.get("duration"), r)),
            "embed": abs_url(render(f.get("embed"), r), page_url),
            "stream": abs_url(render(f.get("stream"), r), page_url),
        })
    return out, len(rows)


# --------------------------------------------------------------------------- листинг

def parse_listing(src, page):
    kind = src.get("type", "html")
    if kind == "json":
        return parse_json(src, page.content, page.url)

    soup = make_soup(page.content, xml=(kind == "rss"))
    sel = src.get("selectors") or {}
    item_sel = sel.get("item") or ("item, entry" if kind == "rss" else None)
    if not item_sel:
        raise ConfigError("не задан selectors.item")
    try:
        nodes = soup.select(item_sel)
    except Exception as e:
        raise ConfigError("неверный selectors.item %r: %s" % (item_sel, e))

    link_spec = sel.get("link") or ("link@href||link" if kind == "rss" else DEFAULT_LINK)
    title_spec = sel.get("title") or ("title" if kind == "rss" else DEFAULT_TITLE)
    out = []
    for n in nodes:
        url = pick(n, link_spec, page.url, as_url=True)
        title = pick(n, title_spec)
        if not url or not title:
            continue
        thumb = pick(n, sel.get("thumb") or DEFAULT_THUMB, page.url, as_url=True)
        if not thumb and kind == "rss":
            thumb = pick(n, "media-thumbnail@url||media-content@url||enclosure@url", page.url, as_url=True)
        if not thumb and kind == "rss":
            thumb = thumb_from_description(n, page.url)
        out.append({
            "url": url,
            "title": title,
            "thumb": thumb,
            "preview": pick(n, sel.get("preview"), page.url, as_url=True),
            "duration": parse_duration(pick(n, sel.get("duration"))),
            "embed": None,
            "stream": None,
        })
    return out, len(nodes)


def thumb_from_description(node, base):
    for tag in ("description", "content", "summary"):
        el = node.find(tag)
        if el and "<img" in el.get_text():
            inner = BeautifulSoup(el.get_text(), "html.parser").find("img")
            if inner and inner.get("src"):
                return abs_url(inner["src"], base)
    return None


# --------------------------------------------------------------------------- HTTP

class Fetcher:
    def __init__(self, cfg):
        self.timeout = cfg["request_timeout"]
        self.s = requests.Session()
        self.s.headers.update({
            "User-Agent": cfg["user_agent"],
            "Accept": "text/html,application/xhtml+xml,application/xml,application/json;q=0.9,*/*;q=0.5",
            "Accept-Language": "ru,en;q=0.8",
        })
        self._last = {}

    def get(self, url, referer=None, delay=0.0):
        host = urlparse(url).netloc
        wait = self._last.get(host, 0) + delay - time.time()
        if wait > 0:
            time.sleep(wait)
        headers = {"Referer": referer} if referer else {}
        r = self.s.get(url, headers=headers, timeout=self.timeout, stream=True)
        self._last[host] = time.time()
        try:
            r.raise_for_status()
            buf = bytearray()
            for chunk in r.iter_content(65536):
                buf += chunk
                if len(buf) > MAX_BYTES:
                    break
            return Page(r.url, r.status_code, bytes(buf))
        finally:
            r.close()


# --------------------------------------------------------------------------- детали видео

def classify(url):
    return "stream" if VIDEO_FILE_RE.search(url) else "embed"


def enrich(src, item, fetcher, fetch_page=True):
    """Ищет способ показать видео на вашем сайте: embed-код или прямой поток."""
    tpl = src.get("embed_template")
    if tpl and not item.get("embed"):
        m = re.search(src.get("id_regex") or r"(\d+)", item["url"])
        if m:
            item["embed"] = tpl.replace("{id}", m.group(1) if m.groups() else m.group(0))

    d = src.get("details") or {}
    if not (d.get("fetch") and fetch_page):
        return
    try:
        page = fetcher.get(item["url"], referer=src.get("base_url"), delay=src.get("delay_seconds", 1.5))
    except requests.RequestException as e:
        log.warning("  страница видео недоступна %s: %s", item["url"], e)
        return
    soup = make_soup(page.content)
    for spec_key, forced in (("embed", "embed"), ("stream", "stream")):
        v = pick(soup, d.get(spec_key), page.url, as_url=True)
        if v:
            item[forced] = v
    if not item.get("embed") and not item.get("stream"):
        v = pick(soup, d.get("video") or DEFAULT_VIDEO, page.url, as_url=True)
        if v:
            item[classify(v)] = v
    if not item.get("thumb"):
        item["thumb"] = pick(soup, d.get("thumb") or "meta[property='og:image']@content", page.url, as_url=True)
    if not item.get("duration") and d.get("duration"):
        item["duration"] = parse_duration(pick(soup, d["duration"]))


def finalize(src, item, cfg):
    item["source"] = src["id"]
    item["source_name"] = src.get("name") or src["id"]
    item["title"] = item["title"][:200]
    if cfg.get("force_https_media"):
        for k in ("thumb", "preview", "embed", "stream"):
            item[k] = https(item.get(k))
    return item


# --------------------------------------------------------------------------- сбор

def page_urls(src):
    tpl = src.get("url")
    if not tpl:
        raise ConfigError("у источника %r не указан url" % src.get("id"))
    if "{page}" not in tpl:
        return [tpl]
    start, step = int(src.get("start_page", 1)), int(src.get("page_step", 1))
    return [tpl.replace("{page}", str(start + i * step)) for i in range(int(src.get("max_pages", 2)))]


def fetch_listing(src, fetcher, first_only=False):
    """Возвращает (items, nodes_found). Бросает исключение, если не получилась первая страница."""
    items, seen, total_nodes = [], set(), 0
    urls = page_urls(src)
    for i, url in enumerate(urls[:1] if first_only else urls):
        try:
            page = fetcher.get(url, referer=src.get("base_url"), delay=src.get("delay_seconds", 1.5))
            found, nodes = parse_listing(src, page)
        except (requests.RequestException, ValueError) as e:
            if i == 0:
                raise
            log.warning("  страница %s пропущена: %s", url, e)
            break
        total_nodes += nodes
        if nodes == 0:
            break
        for it in found:
            if it["url"] not in seen:
                seen.add(it["url"])
                items.append(it)
    return items, total_nodes


def collect_source(src, cfg, fetcher):
    """Скачивает листинг, оставляет только новые видео и дособирает детали."""
    items, nodes = fetch_listing(src, fetcher)
    with db.db() as c:
        known = db.existing_urls(c, [i["url"] for i in items])
    new = [i for i in items if i["url"] not in known]

    cap = int((src.get("details") or {}).get("max_per_run", 40))
    if (src.get("details") or {}).get("fetch"):
        new = new[:cap]  # остальные подхватятся в следующий запуск
    for it in new:
        enrich(src, it, fetcher)
        finalize(src, it, cfg)
    return new, len(items), nodes


_lock = threading.Lock()
STATE = {"running": False, "started": None, "finished": None, "result": None}


def run(cfg=None, only=None):
    """Один проход по всем включённым источникам. Возвращает словарь со статистикой."""
    if not _lock.acquire(blocking=False):
        return None
    STATE.update(running=True, started=int(time.time()))
    try:
        cfg = cfg or settings.load_config()
        sources = [s for s in settings.load_sources() if not only or s["id"] == only]
        fetcher = Fetcher(cfg)
        batches, report = [], {}
        for src in sources:
            log.info("Источник %s (%s)", src["id"], src.get("url"))
            try:
                new, found, nodes = collect_source(src, cfg, fetcher)
                err = None
                if nodes == 0:
                    err = "селектор item ничего не нашёл — проверьте sources.json (python crawler.py --test %s)" % src["id"]
                elif found == 0:
                    err = "блоки найдены (%d), но без ссылки/названия — проверьте link и title" % nodes
                batches.append(new)
            except Exception as e:  # один сломанный источник не должен ронять остальные
                new, found, err = [], 0, str(e)
            if err:
                log.warning("  %s", err)
            log.info("  найдено %d, новых %d", found, len(new))
            report[src["id"]] = {"found": found, "new": len(new), "error": err}

        # чередуем источники, чтобы на главной они были перемешаны; старые вставляем первыми
        mixed = [x for grp in itertools.zip_longest(*batches) for x in grp if x]
        with db.db() as c:
            for item in reversed(mixed):
                db.insert_video(c, item)
            for sid, r in report.items():
                db.set_source_status(c, sid, r["found"], r["new"], r["error"])
            db.prune(c, cfg.get("max_videos"))
        STATE["result"] = report
        return report
    finally:
        STATE.update(running=False, finished=int(time.time()))
        _lock.release()


# --------------------------------------------------------------------------- проверка селекторов

def test_source(source_id, limit=5, with_details=False):
    cfg = settings.load_config()
    src = next((s for s in settings.load_sources(only_enabled=False) if s["id"] == source_id), None)
    if not src:
        print("Источник %r не найден в sources.json" % source_id)
        return 1
    fetcher = Fetcher(cfg)
    print("Загружаю", page_urls(src)[0])
    try:
        items, nodes = fetch_listing(src, fetcher, first_only=True)
    except Exception as e:
        print("Ошибка загрузки/разбора:", e)
        return 1
    print("Найдено блоков (selectors.item): %d, из них с названием и ссылкой: %d" % (nodes, len(items)))
    if nodes == 0:
        print("-> Селектор item ничего не нашёл. Откройте страницу в браузере, ПКМ по карточке видео -> "
              "«Просмотреть код» и подберите селектор повторяющегося блока.")
    for it in items[:limit]:
        if with_details:
            enrich(src, it, fetcher)
        finalize(src, it, cfg)
        print("-" * 60)
        for k in ("title", "url", "thumb", "preview", "duration", "embed", "stream"):
            print("%-9s %s" % (k, it.get(k)))
    if items:
        miss = {k: sum(1 for i in items if not i.get(k)) for k in ("thumb", "duration")}
        print("-" * 60)
        print("Без превью: %d из %d, без длительности: %d из %d" % (miss["thumb"], len(items), miss["duration"], len(items)))
    return 0


def main():
    ap = argparse.ArgumentParser(description="Сбор ссылок на видео")
    ap.add_argument("--source", help="собрать только этот источник (id из sources.json)")
    ap.add_argument("--test", metavar="ID", help="проверить селекторы источника без записи в базу")
    ap.add_argument("--limit", type=int, default=5, help="сколько элементов показать в --test")
    ap.add_argument("--details", action="store_true", help="в --test дополнительно открыть страницы видео")
    args = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s", datefmt="%H:%M:%S")
    db.init()
    if args.test:
        sys.exit(test_source(args.test, args.limit, args.details))
    report = run(only=args.source)
    if report is None:
        print("Сбор уже выполняется")
        sys.exit(1)
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
