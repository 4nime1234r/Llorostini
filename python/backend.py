from __future__ import annotations

import base64
import json
import os
import sys
import threading
import time
import traceback
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

_proto_fd = os.dup(1)
os.dup2(2, 1)
sys.stdout = sys.stderr
_out = os.fdopen(_proto_fd, "w", encoding="utf-8", newline="\n", buffering=1)
sys.stdin.reconfigure(encoding="utf-8")

import netutil
import orphans
import spotify
import storage
from downloader import (AUDIO_FORMATS, SUBTITLE_CHOICES, THUMBNAIL_FORMATS, VIDEO_CONTAINERS,
                        DownloadCancelledError, DownloaderError, PlaylistInfo, VideoInfo, default_download_dir,
                        download, estimate_playlist_size, estimate_seconds_size, estimate_video_size,
                        fetch_spotify, fetch_thumbnail, free_space, get_info, get_playlist_info, has_ffmpeg,
                        parse_rate_limit, platform_of, safe_filename, spotify_playlist_info, spotify_video_info,
                        url_kind)
from links import find_urls, read_queue_file
from updater import UpdateError, fetch_latest_release, is_newer
from version import APP_NAME, GITHUB_REPO, __version__

SPEEDS = {"Sin límite": None, "500 KB/s": "500K", "1 MB/s": "1M", "2 MB/s": "2M", "5 MB/s": "5M", "10 MB/s": "10M"}
PROGRESS_INTERVAL = 0.15

_write_lock = threading.Lock()


def send(message: dict) -> None:
    line = json.dumps(message, ensure_ascii=False, default=str)
    with _write_lock:
        _out.write(line + "\n")
        _out.flush()


def emit(event: str, data=None) -> None:
    send({"event": event, "data": data})


def _data_url(raw: bytes | None) -> str | None:
    if not raw:
        return None
    if raw.startswith(b"\x89PNG"):
        mime = "image/png"
    elif raw[:4] == b"RIFF" and raw[8:12] == b"WEBP":
        mime = "image/webp"
    else:
        mime = "image/jpeg"
    return f"data:{mime};base64,{base64.b64encode(raw).decode('ascii')}"


def _video_dict(info: VideoInfo | None) -> dict | None:
    if info is None:
        return None
    return {
        "title": info.title,
        "uploader": info.uploader,
        "duration": info.duration,
        "heights": info.heights,
        "fpsByHeight": {str(h): list(rates) for h, rates in info.fps_by_height.items()},
        "fpsOptions": info.fps_options,
        "source": info.source,
        "thumbnail": _data_url(fetch_thumbnail(info.thumbnail_url)),
    }


def _playlist_dict(info: PlaylistInfo | None) -> dict | None:
    if info is None:
        return None
    return {
        "title": info.title,
        "uploader": info.uploader,
        "total": info.total,
        "skipped": info.skipped,
        "source": info.source,
        "thumbnail": _data_url(fetch_thumbnail(info.thumbnail_url)),
    }


def _apply_proxy(settings: dict) -> None:
    try:
        netutil.set_proxy(str(settings.get("proxy") or ""))
    except ValueError as exc:
        raise DownloaderError(str(exc)) from exc


class Backend:
    def __init__(self) -> None:
        self.video: VideoInfo | None = None
        self.playlist: PlaylistInfo | None = None
        self.track: spotify.SpotifyTrack | None = None
        self.cancel_event = threading.Event()
        self.busy = False
        self._last_progress: dict[str, float] = {}

    def init(self) -> dict:
        settings = storage.load_settings()
        try:
            _apply_proxy(settings)
        except DownloaderError:
            pass
        return {
            "appName": APP_NAME,
            "version": __version__,
            "repo": GITHUB_REPO,
            "hasFfmpeg": has_ffmpeg(),
            "defaultDir": str(default_download_dir()),
            "settings": settings,
            "choices": {
                "containers": list(VIDEO_CONTAINERS),
                "audioFormats": list(AUDIO_FORMATS),
                "subtitles": SUBTITLE_CHOICES,
                "thumbnailFormats": list(THUMBNAIL_FORMATS),
                "speeds": list(SPEEDS),
            },
        }

    def save_settings(self, settings: dict) -> dict:
        merged = {**storage.load_settings(), **settings}
        netutil.normalize_proxy(str(merged.get("proxy") or ""))
        storage.save_settings(merged)
        _apply_proxy(merged)
        return merged

    def sweep_orphans(self) -> int:
        return orphans.sweep()

    def classify(self, text: str) -> list[dict]:
        return [{"url": url, "kind": url_kind(url), "platform": platform_of(url)} for url in find_urls(text)]

    def search(self, url: str) -> dict:
        _apply_proxy(storage.load_settings())
        self.video = self.playlist = self.track = None
        if platform_of(url) == "spotify":
            found = fetch_spotify(url)
            if isinstance(found, spotify.SpotifyTrack):
                self.track = found
                self.video = spotify_video_info(found)
                kind = "spotify_track"
            else:
                self.playlist = spotify_playlist_info(found)
                kind = "spotify_list"
        else:
            kind = url_kind(url)
            if kind != "playlist":
                self.video = get_info(url)
            if kind != "video":
                try:
                    self.playlist = get_playlist_info(url)
                except DownloaderError:
                    if kind == "playlist":
                        raise
        return {
            "kind": kind,
            "video": _video_dict(self.video),
            "playlist": _playlist_dict(self.playlist),
            "track": self.track.as_dict() if self.track else None,
        }

    def _selected_entries(self, start: int, end: int):
        if self.playlist is None:
            return []
        return [entry for entry in self.playlist.entries if start <= entry.index <= end]

    def space(self, folder: str, estimate: dict | None = None) -> dict:
        estimate = estimate or {}
        height = estimate.get("height")
        audio = bool(estimate.get("audio"))
        audio_format = str(estimate.get("audioFormat") or "mp3")
        size = None
        mode = estimate.get("mode")
        if mode == "list" and self.playlist is not None:
            size = estimate_playlist_size(self._selected_entries(int(estimate.get("start") or 1),
                                                                 int(estimate.get("end") or self.playlist.total)),
                                          height, audio, audio_format)
        elif mode == "video" and self.video is not None:
            size = estimate_video_size(self.video, height, audio, audio_format)
        elif mode == "seconds":
            size = estimate_seconds_size(float(estimate.get("seconds") or 0), height, audio, audio_format)
        return {"free": free_space(folder) if folder else None, "estimate": size}

    def plan_playlist(self, start: int, end: int, out_dir: str, by_channel: bool) -> dict:
        playlist = self.playlist
        if playlist is None:
            raise DownloaderError("Primero busca una lista de reproducción.")
        folder = Path(out_dir) / safe_filename(playlist.title)
        width = max(2, len(str(playlist.total)))
        jobs = []
        for entry in self._selected_entries(start, end):
            prefix = f"{entry.index:0{width}d} - "
            target = folder / safe_filename(entry.channel or "Sin canal") if by_channel else folder
            job = {"url": entry.url, "title": f"{prefix}{entry.title}", "out_dir": str(target), "prefix": prefix,
                   "duration": entry.duration}
            if entry.meta is not None:
                job["spotify"] = entry.meta
            jobs.append(job)
        unavailable = []
        for entry in playlist.unavailable:
            if not start <= entry.index <= end:
                continue
            reason = ("El video es privado." if "Private" in entry.title
                      else "El video fue eliminado." if "Deleted" in entry.title
                      else "El video no está disponible.")
            unavailable.append({"url": entry.url, "title": f"{entry.index:0{width}d} - {entry.title}",
                                "reason": reason})
        return {"folder": str(folder), "jobs": jobs, "unavailable": unavailable}

    def start_downloads(self, jobs: list[dict], options: dict, mode: str) -> bool:
        if self.busy:
            raise DownloaderError("Ya hay una descarga en curso.")
        settings = storage.load_settings()
        _apply_proxy(settings)
        if not jobs:
            raise DownloaderError("No hay nada que descargar.")
        audio = bool(options.get("audio"))
        subs = options.get("subtitles") if not audio else None
        thumbnail = settings.get("thumbnail_format") if settings.get("save_thumbnail") else None
        if thumbnail not in THUMBNAIL_FORMATS:
            thumbnail = None
        embed_lyrics = bool(settings.get("embed_lyrics"))
        rate = parse_rate_limit(SPEEDS.get(str(settings.get("speed_limit"))))
        workers = max(1, min(int(settings.get("parallel_downloads") or 1), len(jobs))) if mode == "queue" else 1
        if rate and workers > 1:
            rate //= workers
        out = str(options.get("outDir") or default_download_dir())
        container = str(options.get("container") or "mp4")
        audio_format = str(options.get("audioFormat") or "mp3")

        self.cancel_event.clear()
        self.busy = True
        self._last_progress.clear()
        results = {"ok": 0, "fail": 0}
        lock = threading.Lock()

        def run(job: dict) -> None:
            job_id = str(job["id"])
            if self.cancel_event.is_set():
                emit("job_cancelled", {"id": job_id})
                return
            emit("job_start", {"id": job_id})

            def hook(status: dict) -> None:
                self._progress(job_id, status)

            from_spotify = bool(job.get("spotify")) or platform_of(job["url"]) == "spotify"
            try:
                path = download(job["url"], job.get("out_dir") or out, job.get("height"), audio, hook, container,
                                audio_format, subs, rate, self.cancel_event.is_set, job.get("prefix", ""),
                                job.get("fps"), thumbnail, (embed_lyrics and audio) or (embed_lyrics and from_spotify),
                                on_retry=lambda attempt, total: emit("job_retry", {"id": job_id, "attempt": attempt,
                                                                                   "total": total}),
                                spotify_meta=job.get("spotify"),
                                on_status=lambda text: emit("job_status", {"id": job_id, "text": text}))
                kind = "audio" if audio or from_spotify else "video"
                storage.add_history(path, kind)
                with lock:
                    results["ok"] += 1
                emit("job_done", {"id": job_id, "path": str(path), "name": Path(path).stem, "kind": kind})
            except DownloadCancelledError:
                emit("job_cancelled", {"id": job_id})
            except Exception as exc:
                message = str(exc) if isinstance(exc, DownloaderError) else f"Error inesperado: {exc}"
                if not isinstance(exc, DownloaderError):
                    traceback.print_exc()
                storage.add_failure(job["url"], str(job.get("title") or job["url"]), message)
                with lock:
                    results["fail"] += 1
                emit("job_error", {"id": job_id, "message": message})

        def worker() -> None:
            try:
                with ThreadPoolExecutor(max_workers=workers) as pool:
                    for job in jobs:
                        pool.submit(run, job)
            finally:
                self.busy = False
                emit("jobs_finished", {**results, "cancelled": self.cancel_event.is_set(), "mode": mode})

        threading.Thread(target=worker, daemon=True).start()
        return True

    def _progress(self, job_id: str, status: dict) -> None:
        state = status.get("status")
        now = time.monotonic()
        if state == "downloading":
            if now - self._last_progress.get(job_id, 0) < PROGRESS_INTERVAL:
                return
            self._last_progress[job_id] = now
            total = status.get("total_bytes") or status.get("total_bytes_estimate")
            done = status.get("downloaded_bytes") or 0
            emit("progress", {"id": job_id, "state": "downloading",
                              "fraction": min(1.0, done / total) if total else None,
                              "speed": status.get("speed") or 0,
                              "eta": status.get("eta")})
        elif state == "finished":
            emit("progress", {"id": job_id, "state": "processing"})

    def cancel(self) -> bool:
        self.cancel_event.set()
        return True

    def add_failures(self, items: list[dict]) -> bool:
        for item in items:
            storage.add_failure(item.get("url", ""), item.get("title", ""), item.get("reason", ""))
        return True

    def history(self) -> list[dict]:
        entries = storage.load_history()
        for entry in entries:
            entry["exists"] = bool(entry.get("path")) and Path(entry["path"]).exists()
        return entries

    def history_remove(self, entry: dict) -> list[dict]:
        storage.remove_history({key: value for key, value in entry.items() if key != "exists"})
        return self.history()

    def history_clear(self) -> list[dict]:
        storage.clear_history()
        return []

    def queue_read(self, path: str) -> dict:
        items, quality, fps = read_queue_file(Path(path))
        for item in items:
            item["kind"] = url_kind(item["url"])
        return {"items": items, "quality": quality, "fps": fps}

    def queue_write(self, path: str, items: list[dict], quality: str, fps: str) -> int:
        target = Path(path)
        if target.suffix.lower() == ".txt":
            target.write_text("\n".join(item["url"] for item in items) + "\n", encoding="utf-8")
        else:
            data = {"app": APP_NAME, "version": 1, "quality": quality, "fps": fps, "items": items}
            target.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        return len(items)

    def check_update(self) -> dict:
        release = fetch_latest_release()
        return {"version": release.version, "notes": release.notes, "pageUrl": release.page_url,
                "assetUrl": release.asset_url, "newer": is_newer(release.version)}


METHODS = {
    "init": lambda b, p: b.init(),
    "settings.save": lambda b, p: b.save_settings(p["settings"]),
    "orphans.sweep": lambda b, p: b.sweep_orphans(),
    "urls.classify": lambda b, p: b.classify(p["text"]),
    "search": lambda b, p: b.search(p["url"]),
    "space": lambda b, p: b.space(p.get("folder", ""), p.get("estimate")),
    "playlist.plan": lambda b, p: b.plan_playlist(int(p["start"]), int(p["end"]), p["outDir"],
                                                  bool(p.get("byChannel"))),
    "download.start": lambda b, p: b.start_downloads(p["jobs"], p["options"], p.get("mode", "single")),
    "download.cancel": lambda b, p: b.cancel(),
    "history.list": lambda b, p: b.history(),
    "history.remove": lambda b, p: b.history_remove(p["entry"]),
    "history.clear": lambda b, p: b.history_clear(),
    "history.addFailures": lambda b, p: b.add_failures(p["items"]),
    "queue.read": lambda b, p: b.queue_read(p["path"]),
    "queue.write": lambda b, p: b.queue_write(p["path"], p["items"], p.get("quality", ""), p.get("fps", "")),
    "update.check": lambda b, p: b.check_update(),
}

KNOWN_ERRORS = (DownloaderError, UpdateError, ValueError, OSError)


def handle(backend: Backend, request: dict) -> None:
    request_id = request.get("id")
    method = METHODS.get(request.get("method"))
    try:
        if method is None:
            raise ValueError(f"Método desconocido: {request.get('method')}")
        result = method(backend, request.get("params") or {})
        send({"id": request_id, "ok": True, "result": result})
    except KNOWN_ERRORS as exc:
        send({"id": request_id, "ok": False, "error": str(exc)})
    except Exception as exc:
        traceback.print_exc()
        send({"id": request_id, "ok": False, "error": f"Error inesperado: {exc}"})


def main() -> None:
    backend = Backend()
    emit("ready", {"version": __version__})
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
        except ValueError:
            continue
        threading.Thread(target=handle, args=(backend, request), daemon=True).start()
    backend.cancel_event.set()
    time.sleep(0.5)
    os._exit(0)


if __name__ == "__main__":
    main()
