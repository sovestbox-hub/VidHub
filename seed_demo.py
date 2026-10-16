"""Заполняет сайт демонстрационными видео, чтобы оценить интерфейс до настройки реальных источников.

  python seed_demo.py            добавить демо-данные
  python seed_demo.py --clear    удалить демо-данные

Тестовые видео берутся с публичных демо-хостов (MDN, Mux, YouTube). Превью рисуются локально.
Свой файл вместо демо-ролика:  python seed_demo.py --mp4 /static/demo/my.mp4
"""
import argparse
import hashlib
import os
import random

import db

BASE = os.path.dirname(os.path.abspath(__file__))
THUMBS = os.path.join(BASE, "static", "demo")

MP4 = "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4"
HLS = "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8"
YT = "https://www.youtube.com/embed/aqz-KE-bpKQ"

TITLES = [
    "Рассвет над горами: таймлапс за один день", "Как делают керамику вручную", "Ночной город с высоты птичьего полёта",
    "Путешествие по северной Норвегии", "Лучшие кофейни Киева за выходные", "Океанские волны в замедленной съёмке",
    "Сборка мини-ПК своими руками", "Прогулка по осеннему лесу", "Секреты идеального тирамису", "Закат на побережье Адриатики",
    "Дрон над озером Свитязь", "Как устроены часы с механическим заводом", "Ретро-автомобили на городском параде",
    "Зимний Львов: огни и рынки", "Мастер-класс по акварели для начинающих", "Тихая рыбалка на рассвете",
    "Подводный мир Красного моря", "Запуск ракеты: полная запись", "Горный велопробег по Карпатам", "Первый снег в парке",
    "Уличная еда Бангкока", "Как работает ветрогенератор", "Старый маяк и штормовое море", "Йога на крыше небоскрёба",
    "Тайны космоса: что скрывает Юпитер", "Весенний цветущий сад",
]
SOURCES = [("demo_tube", "Demo Tube"), ("clip_zone", "Clip Zone"), ("open_reel", "Open Reel")]


def make_thumb(i, title):
    h = int(hashlib.md5(title.encode()).hexdigest()[:4], 16)
    hue = h % 360
    path = os.path.join(THUMBS, "thumb-%d.svg" % i)
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360">'
        '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">'
        '<stop offset="0" stop-color="hsl(%d 70%% 52%%)"/><stop offset="1" stop-color="hsl(%d 65%% 22%%)"/></linearGradient></defs>'
        '<rect width="640" height="360" fill="url(#g)"/>'
        '<circle cx="%d" cy="%d" r="%d" fill="hsl(%d 90%% 80%%)" opacity=".28"/>'
        '<circle cx="%d" cy="%d" r="%d" fill="hsl(%d 80%% 15%%)" opacity=".35"/>'
        '</svg>'
    ) % (hue, (hue + 40) % 360, 100 + h % 400, 60 + h % 120, 50 + h % 90, (hue + 30) % 360,
         500 - h % 300, 260 + h % 90, 120 + h % 110, hue)
    with open(path, "w", encoding="utf-8") as f:
        f.write(svg)
    return "/static/demo/thumb-%d.svg" % i


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--clear", action="store_true")
    ap.add_argument("--mp4", default=MP4)
    args = ap.parse_args()
    db.init()
    with db.db() as c:
        c.execute("DELETE FROM videos WHERE url LIKE 'https://example.com/demo/%'")
        if args.clear:
            print("Демо-данные удалены")
            return
        rnd = random.Random(7)
        for i, title in enumerate(TITLES):
            src, name = SOURCES[i % 3]
            kind = i % 4  # 0 — mp4, 1 — hls, 2 — youtube-embed, 3 — только переход на источник
            db.insert_video(c, {
                "source": src, "source_name": name, "title": title,
                "url": "https://example.com/demo/%d" % i,
                "thumb": make_thumb(i, title),
                "duration": rnd.choice([47, 95, 184, 312, 466, 721, 1205, 2310]),
                "stream": args.mp4 if kind == 0 else (HLS if kind == 1 else None),
                "embed": YT if kind == 2 else None,
            })
            c.execute("UPDATE videos SET views=? WHERE url=?", (rnd.choice([0, 12, 340, 1800, 25400]), "https://example.com/demo/%d" % i))
    print("Добавлено демо-видео: %d. Откройте сайт и посмотрите интерфейс." % len(TITLES))


if __name__ == "__main__":
    main()
