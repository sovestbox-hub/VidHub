"""SQLite-хранилище. Без внешних зависимостей."""
import contextlib
import os
import sqlite3
import time

DB_PATH = os.environ.get(
    "VIDHUB_DB",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "vidhub.db"),
)

SCHEMA = """
CREATE TABLE IF NOT EXISTS videos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  source_name TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  title_lc TEXT NOT NULL,
  url TEXT NOT NULL UNIQUE,
  thumb TEXT,
  preview TEXT,
  duration INTEGER,
  embed TEXT,
  stream TEXT,
  views INTEGER NOT NULL DEFAULT 0,
  hidden INTEGER NOT NULL DEFAULT 0,
  added_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_videos_source ON videos(source, hidden);
CREATE INDEX IF NOT EXISTS idx_videos_views ON videos(views DESC);
CREATE TABLE IF NOT EXISTS source_status (
  source TEXT PRIMARY KEY,
  last_run INTEGER,
  found INTEGER,
  new INTEGER,
  error TEXT
);
"""

SORTS = {
    "new": "id DESC",
    "popular": "views DESC, id DESC",
    "long": "duration DESC, id DESC",
}


def connect():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


@contextlib.contextmanager
def db():
    conn = connect()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init():
    with db() as c:
        c.executescript(SCHEMA)


def _like_escape(s):
    return s.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def insert_video(conn, v):
    """Добавляет видео. Возвращает True, если запись новая."""
    cur = conn.execute(
        """INSERT OR IGNORE INTO videos
           (source, source_name, title, title_lc, url, thumb, preview, duration, embed, stream, added_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
        (
            v["source"], v.get("source_name", ""), v["title"], v["title"].casefold(), v["url"],
            v.get("thumb"), v.get("preview"), v.get("duration"), v.get("embed"), v.get("stream"),
            int(time.time()),
        ),
    )
    return cur.rowcount > 0


def existing_urls(conn, urls):
    urls = list(urls)
    found = set()
    for i in range(0, len(urls), 500):
        chunk = urls[i:i + 500]
        q = "SELECT url FROM videos WHERE url IN (%s)" % ",".join("?" * len(chunk))
        found.update(r["url"] for r in conn.execute(q, chunk))
    return found


def search(conn, q="", sort="new", source="", limit=24, offset=0):
    where, args = ["hidden=0"], []
    for word in q.casefold().split()[:6]:
        where.append("title_lc LIKE ? ESCAPE '\\'")
        args.append("%" + _like_escape(word) + "%")
    if source:
        where.append("source=?")
        args.append(source)
    clause = " AND ".join(where)
    total = conn.execute("SELECT COUNT(*) FROM videos WHERE " + clause, args).fetchone()[0]
    order = SORTS.get(sort, SORTS["new"])
    rows = conn.execute(
        "SELECT * FROM videos WHERE %s ORDER BY %s LIMIT ? OFFSET ?" % (clause, order),
        args + [limit, offset],
    ).fetchall()
    return rows, total


def get_video(conn, vid):
    return conn.execute("SELECT * FROM videos WHERE id=? AND hidden=0", (vid,)).fetchone()


def related(conn, vid, limit=12):
    return conn.execute(
        "SELECT * FROM videos WHERE hidden=0 AND id!=? ORDER BY RANDOM() LIMIT ?", (vid, limit)
    ).fetchall()


def bump_views(conn, vid):
    conn.execute("UPDATE videos SET views = views + 1 WHERE id=?", (vid,))


def hide_video(conn, vid):
    return conn.execute("UPDATE videos SET hidden=1 WHERE id=?", (vid,)).rowcount > 0


def sources_summary(conn):
    return conn.execute(
        """SELECT source, MAX(source_name) AS name, COUNT(*) AS count
           FROM videos WHERE hidden=0 GROUP BY source ORDER BY count DESC"""
    ).fetchall()


def set_source_status(conn, source, found, new, error=None):
    conn.execute(
        """INSERT INTO source_status (source,last_run,found,new,error) VALUES (?,?,?,?,?)
           ON CONFLICT(source) DO UPDATE SET last_run=excluded.last_run, found=excluded.found,
           new=excluded.new, error=excluded.error""",
        (source, int(time.time()), found, new, error),
    )


def all_source_status(conn):
    return [dict(r) for r in conn.execute("SELECT * FROM source_status")]


def prune(conn, keep):
    if keep and keep > 0:
        conn.execute(
            "DELETE FROM videos WHERE id NOT IN (SELECT id FROM videos ORDER BY id DESC LIMIT ?)"
            " AND hidden=0", (keep,))
