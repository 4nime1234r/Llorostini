from __future__ import annotations

import json
import re
import unicodedata
import urllib.error
import urllib.request
from dataclasses import asdict, dataclass, field, replace
from typing import Callable, Optional
from urllib.parse import urlparse

import netutil
import yt_dlp

USER_AGENT = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
              "Chrome/126.0 Safari/537.36")
EMBED_URL = "https://open.spotify.com/embed/{kind}/{sid}"
NEXT_DATA = re.compile(r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', re.S)
URL_PATTERN = re.compile(
    r"open\.spotify\.com/(?:intl-[a-zA-Z-]+/)?(?:embed/)?(track|album|playlist|artist|show|episode|user)/([A-Za-z0-9]{6,32})")
URI_PATTERN = re.compile(r"^spotify:(track|album|playlist|artist|show|episode|user):([A-Za-z0-9]+)$")
SHORT_HOSTS = ("spotify.link", "spotify.app.link")
SUPPORTED_KINDS = ("track", "album", "playlist")
MIN_SCORE = 70.0
EARLY_STOP = 115.0
OFFICIAL_SUFFIXES = ("official", "vevo", "topic", "music", "records", "tv", "officialchannel", "oficial")
MAX_DURATION_GAP = 30.0
SIZE_CODES = (("ab67616d00001e02", "ab67616d0000b273"), ("ab67616d00004851", "ab67616d0000b273"))
NOISE_WORDS = ("live", "cover", "remix", "karaoke", "instrumental", "slowed", "sped up", "reverb", "8d", "nightcore",
               "acoustic", "tribute", "reaction", "mashup", "piano", "lofi", "lo fi", "bass boosted", "loop", "extended",
               "version", "en vivo", "en directo")


class SpotifyError(Exception):
    pass


@dataclass(frozen=True)
class SpotifyTrack:
    id: str
    title: str
    artists: tuple[str, ...]
    duration: float
    url: str
    album: str = ""
    album_artist: str = ""
    cover_url: str = ""
    release_year: str = ""
    track_number: Optional[int] = None

    @property
    def artist(self) -> str:
        return self.artists[0] if self.artists else ""

    @property
    def artist_text(self) -> str:
        return ", ".join(self.artists)

    def as_dict(self) -> dict:
        data = asdict(self)
        data["artists"] = list(self.artists)
        return data

    @staticmethod
    def from_dict(data: dict) -> "SpotifyTrack":
        return SpotifyTrack(
            id=str(data.get("id", "")),
            title=str(data.get("title", "")),
            artists=tuple(str(a) for a in data.get("artists", [])),
            duration=float(data.get("duration") or 0),
            url=str(data.get("url", "")),
            album=str(data.get("album", "")),
            album_artist=str(data.get("album_artist", "")),
            cover_url=str(data.get("cover_url", "")),
            release_year=str(data.get("release_year", "")),
            track_number=data.get("track_number") if isinstance(data.get("track_number"), int) else None,
        )


@dataclass(frozen=True)
class SpotifyCollection:
    kind: str
    name: str
    owner: str
    cover_url: str
    tracks: list[SpotifyTrack] = field(default_factory=list)


@dataclass(frozen=True)
class Match:
    url: str
    title: str
    channel: str
    duration: float
    score: float


class _QuietLogger:
    def debug(self, msg): pass
    def info(self, msg): pass
    def warning(self, msg): pass
    def error(self, msg): pass


def is_spotify(url: str) -> bool:
    text = url.strip()
    if URI_PATTERN.match(text):
        return True
    host = urlparse(text).netloc.lower()
    return host == "open.spotify.com" or host in SHORT_HOSTS


def _match_kind(url: str) -> Optional[tuple[str, str]]:
    text = url.strip()
    match = URI_PATTERN.match(text) or URL_PATTERN.search(text)
    return (match.group(1), match.group(2)) if match else None


def parse_url(url: str) -> Optional[tuple[str, str]]:
    found = _match_kind(url)
    if found and found[0] in SUPPORTED_KINDS:
        return found
    return None


def unsupported_kind(url: str) -> Optional[str]:
    found = _match_kind(url)
    if found and found[0] not in SUPPORTED_KINDS:
        return found[0]
    return None


def unsupported_message(kind: str) -> str:
    labels = {"artist": "los artistas", "show": "los podcasts", "episode": "los episodios de podcast",
              "user": "los perfiles de usuario"}
    return (f"Spotify: {labels.get(kind, 'ese tipo de enlace')} no están soportados. "
            "Pega el enlace de una canción, un álbum o una lista de reproducción.")


def resolve_short(url: str) -> str:
    if urlparse(url.strip()).netloc.lower() not in SHORT_HOSTS:
        return url
    request = urllib.request.Request(url.strip(), headers={"User-Agent": USER_AGENT})
    try:
        with netutil.open_url(request, timeout=15) as response:
            return response.geturl()
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise SpotifyError("No se pudo abrir el enlace corto de Spotify. Revisa tu conexión.") from exc


def _embed_entity(kind: str, sid: str) -> dict:
    request = urllib.request.Request(EMBED_URL.format(kind=kind, sid=sid),
                                     headers={"User-Agent": USER_AGENT, "Accept-Language": "en-US,en;q=0.9"})
    try:
        with netutil.open_url(request, timeout=20) as response:
            html = response.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            raise SpotifyError("No se encontró ese contenido en Spotify (¿es privado o fue eliminado?).") from exc
        raise SpotifyError(f"Spotify respondió con el error {exc.code}.") from exc
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise SpotifyError("No se pudo conectar con Spotify. Revisa tu conexión a internet.") from exc
    match = NEXT_DATA.search(html)
    if not match:
        raise SpotifyError("Spotify cambió su página y no se pudieron leer los datos de la canción.")
    try:
        props = json.loads(match.group(1))["props"]["pageProps"]
    except (ValueError, KeyError) as exc:
        raise SpotifyError("Spotify devolvió datos que no se pueden interpretar.") from exc
    entity = (props.get("state") or {}).get("data", {}).get("entity")
    if not entity:
        if props.get("status") == 404:
            raise SpotifyError("No se encontró ese contenido en Spotify (¿es privado o fue eliminado?).")
        raise SpotifyError("Spotify no devolvió información de ese enlace.")
    return entity


def _cover(entity: dict) -> str:
    images = (entity.get("visualIdentity") or {}).get("image") or []
    images = [image for image in images if image.get("url")]
    if not images:
        return ""
    best = max(images, key=lambda image: image.get("maxWidth") or 0)
    return best["url"]


def upgrade_cover(url: str) -> str:
    for small, large in SIZE_CODES:
        if small in url:
            return url.replace(small, large)
    return url


def _year(entity: dict) -> str:
    iso = (entity.get("releaseDate") or {}).get("isoString") or ""
    return iso[:4]


def _track_from_entity(entity: dict, sid: str) -> SpotifyTrack:
    artists = tuple(a.get("name", "") for a in entity.get("artists") or [] if a.get("name"))
    return SpotifyTrack(
        id=sid,
        title=str(entity.get("name") or entity.get("title") or ""),
        artists=artists,
        duration=(entity.get("duration") or 0) / 1000,
        url=f"https://open.spotify.com/track/{sid}",
        cover_url=_cover(entity),
        release_year=_year(entity),
    )


def fetch_track(sid: str) -> SpotifyTrack:
    return _track_from_entity(_embed_entity("track", sid), sid)


def fetch_collection(kind: str, sid: str) -> SpotifyCollection:
    entity = _embed_entity(kind, sid)
    name = str(entity.get("name") or entity.get("title") or "")
    owner = str(entity.get("subtitle") or "")
    cover = _cover(entity)
    year = _year(entity)
    tracks = []
    for position, item in enumerate(entity.get("trackList") or [], 1):
        uri = str(item.get("uri") or "")
        if not uri.startswith("spotify:track:"):
            continue
        track_id = uri.split(":")[-1]
        subtitle = str(item.get("subtitle") or "")
        tracks.append(SpotifyTrack(
            id=track_id,
            title=str(item.get("title") or ""),
            artists=(subtitle,) if subtitle else (),
            duration=(item.get("duration") or 0) / 1000,
            url=f"https://open.spotify.com/track/{track_id}",
            album=name if kind == "album" else "",
            album_artist=owner if kind == "album" else "",
            cover_url=cover if kind == "album" else "",
            release_year=year if kind == "album" else "",
            track_number=position if kind == "album" else None,
        ))
    if not tracks:
        raise SpotifyError("La lista o el álbum no tiene canciones visibles (¿es privado?).")
    return SpotifyCollection(kind=kind, name=name, owner=owner, cover_url=cover, tracks=tracks)


def fetch(url: str):
    url = resolve_short(url)
    unsupported = unsupported_kind(url)
    if unsupported:
        raise SpotifyError(unsupported_message(unsupported))
    parsed = parse_url(url)
    if not parsed:
        raise SpotifyError("No se reconoce ese enlace de Spotify. Debe ser de una canción, álbum o lista.")
    kind, sid = parsed
    return fetch_track(sid) if kind == "track" else fetch_collection(kind, sid)


def enrich(track: SpotifyTrack) -> SpotifyTrack:
    if track.cover_url and track.release_year and track.artists:
        return track
    full = fetch_track(track.id)
    return replace(
        track,
        artists=track.artists if track.artists and len(track.artists) > 1 else (full.artists or track.artists),
        cover_url=track.cover_url or full.cover_url,
        release_year=track.release_year or full.release_year,
        duration=track.duration or full.duration,
    )


def fetch_cover_bytes(url: str) -> Optional[bytes]:
    for candidate in dict.fromkeys((upgrade_cover(url), url)):
        if not candidate:
            continue
        try:
            request = urllib.request.Request(candidate, headers={"User-Agent": USER_AGENT})
            with netutil.open_url(request, timeout=20) as response:
                data = response.read(8_000_000)
            if data:
                return data
        except (urllib.error.URLError, TimeoutError, OSError):
            continue
    return None


def _fold(text: str) -> str:
    decomposed = unicodedata.normalize("NFKD", str(text))
    plain = "".join(char for char in decomposed if not unicodedata.combining(char)).casefold()
    return re.sub(r"\s+", " ", re.sub(r"[^\w\s]", " ", plain)).strip()


def _tokens(text: str) -> set[str]:
    return set(_fold(text).split())


def _core_title(title: str) -> str:
    cut = re.split(r"\s+-\s+|\s*[\(\[]", title, maxsplit=1)[0]
    return cut.strip() or title


def score(track: SpotifyTrack, candidate: dict) -> Optional[float]:
    duration = candidate.get("duration")
    if not duration:
        return None
    title = str(candidate.get("title") or "")
    channel = str(candidate.get("channel") or candidate.get("uploader") or "")
    wanted = _tokens(_core_title(track.title))
    if not wanted:
        return None
    coverage = len(wanted & _tokens(title)) / len(wanted)
    gap = abs(float(duration) - track.duration) if track.duration else 0.0
    if coverage < 0.6 or gap > MAX_DURATION_GAP:
        return None

    points = 30 * coverage
    points += 50 if gap <= 2 else 45 if gap <= 4 else 40 if gap <= 8 else 20 if gap <= 15 else 0
    artist_tokens = _tokens(track.artist)
    if artist_tokens and artist_tokens & (_tokens(title) | _tokens(channel)):
        points += 20
    if _is_official_channel(track.artist, channel):
        points += 35
        if _fold(channel).endswith("topic"):
            points += 15
    title_folded = _fold(title)
    original = _fold(track.title)
    for word in NOISE_WORDS:
        if re.search(r"\b" + re.escape(word) + r"\b", title_folded) and word not in original:
            points -= 40
    if "official video" in title_folded or "music video" in title_folded or "video oficial" in title_folded:
        points -= 5
    if any(word in title_folded for word in ("lyric", "letra", "sub espanol", "subtitulado")):
        points -= 25
    return points


def _is_official_channel(artist: str, channel: str) -> bool:
    compact_artist = _fold(artist).replace(" ", "")
    compact_channel = _fold(channel).replace(" ", "")
    if not compact_artist or not compact_channel:
        return False
    if compact_channel == compact_artist:
        return True
    if compact_channel.startswith(compact_artist) and compact_channel[len(compact_artist):] in OFFICIAL_SUFFIXES:
        return True
    return compact_channel.endswith("topic") and compact_artist in compact_channel


def _search(query: str) -> list[dict]:
    opts = {"quiet": True, "no_warnings": True, "extract_flat": True, "skip_download": True,
            "logger": _QuietLogger(), "proxy": netutil.get_proxy(), "socket_timeout": 20}
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(f"ytsearch10:{query}", download=False)
    except Exception as exc:
        raise SpotifyError("No se pudo buscar la canción en YouTube. Revisa tu conexión.") from exc
    return [entry for entry in (info.get("entries") or []) if entry and entry.get("id")]


def find_match(track: SpotifyTrack, should_cancel: Optional[Callable[[], bool]] = None) -> Optional[Match]:
    artist = track.artist
    queries = [f"{artist} {track.title}".strip(), f"{artist} {track.title} topic".strip(),
               f"{track.title} {artist} audio".strip()]
    candidates: dict[str, dict] = {}
    best: Optional[tuple[float, dict]] = None
    for query in queries:
        if should_cancel is not None and should_cancel():
            return None
        for entry in _search(query):
            candidates.setdefault(entry["id"], entry)
        for entry in candidates.values():
            value = score(track, entry)
            if value is not None and (best is None or value > best[0]):
                best = (value, entry)
        if best is not None and best[0] >= EARLY_STOP:
            break
    if best is None or best[0] < MIN_SCORE:
        return None
    entry = best[1]
    return Match(
        url=f"https://www.youtube.com/watch?v={entry['id']}",
        title=str(entry.get("title") or ""),
        channel=str(entry.get("channel") or entry.get("uploader") or ""),
        duration=float(entry.get("duration") or 0),
        score=best[0],
    )
