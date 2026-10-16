"""Загрузка config.json и sources.json."""
import json
import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

DEFAULTS = {
    "site_name": "VidHub",
    "tagline": "Свежие видео со всего интернета в одном месте",
    "host": "127.0.0.1",
    "port": 8000,
    # auto   — своё окно с плеером, если для видео найден embed/поток, иначе переход на сайт-источник
    # player — всегда страница с плеером на вашем сайте
    # redirect — клик сразу ведёт на видео на сайте-источнике
    "click_behavior": "auto",
    "per_page": 24,
    "age_gate": False,
    "age_exit_url": "https://www.google.com",
    "embed_sandbox": True,
    "crawl_on_start": True,
    "crawl_interval_minutes": 60,
    "max_videos": 20000,
    "request_timeout": 20,
    "force_https_media": True,
    "user_agent": "Mozilla/5.0 (compatible; VidHubBot/1.0)",
    "admin_token": "",
}


def _read_json(name, default):
    path = os.path.join(BASE_DIR, name)
    if not os.path.exists(path):
        return default
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def load_config():
    cfg = dict(DEFAULTS)
    cfg.update(_read_json("config.json", {}))
    if cfg["click_behavior"] not in ("auto", "player", "redirect"):
        raise ValueError("config.json: click_behavior должен быть auto, player или redirect")
    return cfg


def load_sources(only_enabled=True):
    data = _read_json("sources.json", [])
    out = []
    for src in data:
        if not isinstance(src, dict) or "id" not in src:
            continue
        if only_enabled and not src.get("enabled", True):
            continue
        out.append(src)
    return out
