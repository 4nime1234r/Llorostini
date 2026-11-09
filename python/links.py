from __future__ import annotations

import json
import re
from pathlib import Path

URL_PATTERN = re.compile(r"https?://[^\s{}\"'<>]+")


def find_urls(text: str) -> list[str]:
    seen: dict[str, None] = {}
    for url in URL_PATTERN.findall(str(text)):
        seen.setdefault(url.rstrip(".,;)"), None)
    return list(seen)


def read_queue_file(path: Path) -> tuple[list[dict], str | None, str | None]:
    text = path.read_text(encoding="utf-8-sig", errors="ignore")
    if path.suffix.lower() == ".json" or text.lstrip().startswith(("{", "[")):
        try:
            data = json.loads(text)
        except ValueError:
            data = None
        if isinstance(data, (dict, list)):
            raw = data.get("items", []) if isinstance(data, dict) else data
            items = []
            for entry in raw if isinstance(raw, list) else []:
                record = entry if isinstance(entry, dict) else {"url": entry}
                found = find_urls(str(record.get("url") or ""))
                if not found:
                    continue
                title = record.get("title")
                item = {"url": found[0], "title": title if isinstance(title, str) else None}
                for key in ("out_dir", "prefix"):
                    if isinstance(record.get(key), str) and record[key]:
                        item[key] = record[key]
                duration = record.get("duration")
                if isinstance(duration, (int, float)) and duration > 0:
                    item["duration"] = int(duration)
                if isinstance(record.get("spotify"), dict):
                    item["spotify"] = record["spotify"]
                items.append(item)
            quality = data.get("quality") if isinstance(data, dict) else None
            fps = data.get("fps") if isinstance(data, dict) else None
            return items, quality, fps
    return [{"url": url, "title": None} for url in find_urls(text)], None, None
