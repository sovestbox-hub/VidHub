"""Веб-сервер: страницы, JSON API, фоновый сбор видео.

Запуск:  python app.py
"""
import hmac
import logging
import threading
import time

from flask import Flask, abort, jsonify, redirect, render_template, request

import crawler
import db
import settings

cfg = settings.load_config()
app = Flask(__name__)
app.json.ensure_ascii = False
db.init()

CSP = (
    "default-src 'self'; "
    "img-src 'self' data: https: http:; "
    "media-src 'self' blob: https: http:; "
    "frame-src https: http:; "
    "script-src 'self' https://cdn.jsdelivr.net; "
    "style-src 'self' https://fonts.googleapis.com; "
    "font-src https://fonts.gstatic.com; "
    "connect-src 'self' https: http:; "
    "worker-src 'self' blob:; "
    "base-uri 'self'; form-action 'self'"
)


@app.after_request
def security_headers(resp):
    resp.headers["Content-Security-Policy"] = CSP
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    return resp


@app.context_processor
def inject_globals():
    return {"site_name": cfg["site_name"], "tagline": cfg["tagline"],
            "age_gate": cfg["age_gate"], "age_exit_url": cfg["age_exit_url"]}


# --------------------------------------------------------------------------- сериализация

def video_dict(row, full=False):
    playable = bool(row["embed"] or row["stream"])
    mode = cfg["click_behavior"]
    inner = mode == "player" or (mode == "auto" and playable)
    d = {
        "id": row["id"],
        "title": row["title"],
        "thumb": row["thumb"],
        "preview": row["preview"],
        "duration": row["duration"],
        "source": row["source"],
        "source_name": row["source_name"],
        "views": row["views"],
        "added_at": row["added_at"],
        "playable": playable,
        "href": ("/watch/%d" if inner else "/go/%d") % row["id"],
        "external": not inner,
    }
    if full:
        d.update(embed=row["embed"], stream=row["stream"], go="/go/%d" % row["id"])
    return d


# --------------------------------------------------------------------------- страницы

@app.get("/")
def index():
    return render_template("index.html", q=request.args.get("q", "").strip()[:100])


@app.get("/watch/<int:vid>")
def watch(vid):
    with db.db() as c:
        row = db.get_video(c, vid)
        if not row:
            abort(404)
        db.bump_views(c, vid)
    return render_template("watch.html", v=video_dict(row, full=True),
                           embed_sandbox=cfg["embed_sandbox"])


@app.get("/go/<int:vid>")
def go(vid):
    """Переход на оригинал на сайте-источнике (со счётчиком кликов)."""
    with db.db() as c:
        row = db.get_video(c, vid)
        if not row:
            abort(404)
        db.bump_views(c, vid)
    resp = redirect(row["url"], code=302)
    resp.headers["Referrer-Policy"] = "origin"
    return resp


@app.errorhandler(404)
def not_found(_e):
    return render_template("404.html"), 404


# --------------------------------------------------------------------------- API

@app.get("/api/videos")
def api_videos():
    try:
        page = max(1, int(request.args.get("page", 1)))
    except ValueError:
        page = 1
    per = cfg["per_page"]
    with db.db() as c:
        rows, total = db.search(
            c,
            q=request.args.get("q", "")[:100],
            sort=request.args.get("sort", "new"),
            source=request.args.get("source", "")[:64],
            limit=per,
            offset=(page - 1) * per,
        )
    return jsonify(items=[video_dict(r) for r in rows], page=page, total=total,
                   has_more=page * per < total)


@app.get("/api/videos/<int:vid>/related")
def api_related(vid):
    with db.db() as c:
        rows = db.related(c, vid, 12)
    return jsonify(items=[video_dict(r) for r in rows])


@app.get("/api/sources")
def api_sources():
    with db.db() as c:
        rows = db.sources_summary(c)
    return jsonify(items=[{"id": r["source"], "name": r["name"], "count": r["count"]} for r in rows])


# --------------------------------------------------------------------------- админка (curl)

def require_admin():
    token = cfg.get("admin_token") or ""
    given = request.headers.get("X-Admin-Token", "")
    if not token or not hmac.compare_digest(token, given):
        abort(403)


@app.post("/api/admin/crawl")
def admin_crawl():
    require_admin()
    if crawler.STATE["running"]:
        return jsonify(status="already_running"), 409
    threading.Thread(target=crawler.run, args=(cfg,), daemon=True).start()
    return jsonify(status="started")


@app.get("/api/admin/status")
def admin_status():
    require_admin()
    with db.db() as c:
        sources = db.all_source_status(c)
    return jsonify(crawler=crawler.STATE, sources=sources)


@app.delete("/api/admin/videos/<int:vid>")
def admin_hide(vid):
    """Скрыть видео (например, по жалобе правообладателя). Повторно оно не добавится."""
    require_admin()
    with db.db() as c:
        ok = db.hide_video(c, vid)
    return jsonify(hidden=ok), (200 if ok else 404)


# --------------------------------------------------------------------------- планировщик

def scheduler():
    interval = int(cfg["crawl_interval_minutes"]) * 60
    if cfg["crawl_on_start"]:
        time.sleep(2)
        crawler.run(cfg)
    while interval > 0:
        time.sleep(interval)
        crawler.run(cfg)


def main():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s", datefmt="%H:%M:%S")
    if cfg["crawl_on_start"] or cfg["crawl_interval_minutes"]:
        threading.Thread(target=scheduler, daemon=True).start()
    host, port = cfg["host"], int(cfg["port"])
    print("Сайт запущен: http://%s:%d" % (host, port))
    try:
        from waitress import serve
        serve(app, host=host, port=port, threads=8)
    except ImportError:
        app.run(host=host, port=port, threaded=True, use_reloader=False)


if __name__ == "__main__":
    main()
