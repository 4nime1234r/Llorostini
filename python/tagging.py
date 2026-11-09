from __future__ import annotations

from pathlib import Path
from typing import Optional, Sequence

TAGGED_SUFFIXES = (".mp3", ".m4a", ".flac")


def _number(value: Optional[int]) -> str:
    return str(value) if value else ""


def _tag_mp3(path: Path, title: str, artists: Sequence[str], album: str, album_artist: str, year: str,
             number: Optional[int], cover: Optional[bytes]) -> None:
    from mutagen.id3 import APIC, ID3, TALB, TDRC, TIT2, TPE1, TPE2, TRCK, ID3NoHeaderError

    try:
        tags = ID3(str(path))
    except ID3NoHeaderError:
        tags = ID3()
    for frame in ("TIT2", "TPE1", "TPE2", "TALB", "TDRC", "TRCK"):
        tags.delall(frame)
    tags.add(TIT2(encoding=3, text=title))
    if artists:
        tags.add(TPE1(encoding=3, text=list(artists)))
    if album_artist:
        tags.add(TPE2(encoding=3, text=album_artist))
    if album:
        tags.add(TALB(encoding=3, text=album))
    if year:
        tags.add(TDRC(encoding=3, text=year))
    if number:
        tags.add(TRCK(encoding=3, text=_number(number)))
    if cover:
        tags.delall("APIC")
        tags.add(APIC(encoding=3, mime="image/jpeg", type=3, desc="Cover", data=cover))
    tags.save(str(path))


def _tag_m4a(path: Path, title: str, artists: Sequence[str], album: str, album_artist: str, year: str,
             number: Optional[int], cover: Optional[bytes]) -> None:
    from mutagen.mp4 import MP4, MP4Cover

    audio = MP4(str(path))
    audio["\xa9nam"] = [title]
    if artists:
        audio["\xa9ART"] = [", ".join(artists)]
    if album_artist:
        audio["aART"] = [album_artist]
    if album:
        audio["\xa9alb"] = [album]
    if year:
        audio["\xa9day"] = [year]
    if number:
        audio["trkn"] = [(number, 0)]
    if cover:
        audio["covr"] = [MP4Cover(cover, imageformat=MP4Cover.FORMAT_JPEG)]
    audio.save()


def _tag_flac(path: Path, title: str, artists: Sequence[str], album: str, album_artist: str, year: str,
              number: Optional[int], cover: Optional[bytes]) -> None:
    from mutagen.flac import FLAC, Picture

    audio = FLAC(str(path))
    audio["title"] = [title]
    if artists:
        audio["artist"] = list(artists)
    if album_artist:
        audio["albumartist"] = [album_artist]
    if album:
        audio["album"] = [album]
    if year:
        audio["date"] = [year]
    if number:
        audio["tracknumber"] = [_number(number)]
    if cover:
        picture = Picture()
        picture.type = 3
        picture.mime = "image/jpeg"
        picture.desc = "Cover"
        picture.data = cover
        audio.clear_pictures()
        audio.add_picture(picture)
    audio.save()


def apply_metadata(path: Path, *, title: str, artists: Sequence[str], album: str = "", album_artist: str = "",
                   year: str = "", number: Optional[int] = None, cover: Optional[bytes] = None) -> bool:
    suffix = path.suffix.lower()
    try:
        if suffix == ".mp3":
            _tag_mp3(path, title, artists, album, album_artist, year, number, cover)
        elif suffix == ".m4a":
            _tag_m4a(path, title, artists, album, album_artist, year, number, cover)
        elif suffix == ".flac":
            _tag_flac(path, title, artists, album, album_artist, year, number, cover)
        else:
            return False
    except Exception:
        return False
    return True
