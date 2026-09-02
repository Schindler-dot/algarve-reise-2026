#!/usr/bin/env python3
"""Download real, destination-matched photos from Wikimedia Commons into /images.

Runs on a GitHub-hosted Actions runner (which has full internet access) because the
Copilot coding-agent sandbox cannot resolve external hosts. For every destination in
destination_images.json this script:

1. Tries each candidate Commons file title (in order).
2. Falls back to the Commons search API using the "search" query if no candidate works.
3. Downloads the original image, converts/normalizes it to JPEG, and writes it to
   images/<id>.jpg.
4. Records the source file title, page URL, author and license into images/SOURCES.json
   for attribution and traceability.

The script fails (non-zero exit) if any destination could not be resolved to a real photo,
so the workflow run clearly reports success/failure instead of silently skipping images.
"""
import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

from PIL import Image
import io

API = "https://commons.wikimedia.org/w/api.php"
ROOT = Path(__file__).resolve().parent.parent.parent
DATA_FILE = Path(__file__).resolve().parent / "destination_images.json"
IMAGES_DIR = ROOT / "images"
MAX_WIDTH = 1600
REQUEST_DELAY = 1.5
USER_AGENT = "algarve-reise-2026-image-fetch/1.0 (GitHub Actions; contact via repository issues)"


def http_get_with_retry(url, max_retries=6, base_delay=3):
    """GET a URL, retrying with backoff on HTTP 429 (respecting Retry-After if present)."""
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    for attempt in range(max_retries):
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                return resp.read()
        except urllib.error.HTTPError as exc:
            if exc.code == 429 and attempt < max_retries - 1:
                retry_after = exc.headers.get("Retry-After")
                delay = float(retry_after) if retry_after else base_delay * (2 ** attempt)
                print(f"    429 rate limited, waiting {delay:.0f}s before retry {attempt + 1}/{max_retries}...")
                time.sleep(delay)
                continue
            raise
    raise RuntimeError("unreachable")


def api_get(params):
    url = API + "?" + urllib.parse.urlencode(params)
    time.sleep(REQUEST_DELAY)
    return json.loads(http_get_with_retry(url).decode("utf-8"))


def imageinfo_for_title(title):
    data = api_get({
        "action": "query",
        "titles": "File:" + title,
        "prop": "imageinfo",
        "iiprop": "url|size|extmetadata|mime",
        "format": "json",
    })
    pages = data.get("query", {}).get("pages", {})
    for page in pages.values():
        if "missing" in page:
            continue
        infos = page.get("imageinfo")
        if not infos:
            continue
        info = infos[0]
        mime = info.get("mime", "")
        if not mime.startswith("image/"):
            continue
        if info.get("width", 0) < 400 or info.get("height", 0) < 300:
            continue
        return {
            "title": page.get("title", "File:" + title),
            "url": info["url"],
            "descriptionurl": info.get("descriptionurl", ""),
            "extmetadata": info.get("extmetadata", {}),
        }
    return None


def search_for(query):
    data = api_get({
        "action": "query",
        "list": "search",
        "srsearch": query,
        "srnamespace": "6",
        "srlimit": "8",
        "format": "json",
    })
    hits = data.get("query", {}).get("search", [])
    for hit in hits:
        title = hit["title"]
        if title.startswith("File:"):
            title = title[len("File:"):]
        lower = title.lower()
        if lower.endswith((".svg", ".pdf", ".ogv", ".webm", ".tif", ".tiff")):
            continue
        info = imageinfo_for_title(title)
        if info:
            return info
    return None


def resolve_destination(dest_id, meta):
    for candidate in meta.get("candidates", []):
        info = imageinfo_for_title(candidate)
        if info:
            return info
    query = meta.get("search")
    if query:
        info = search_for(query)
        if info:
            return info
    return None


def extmeta_value(extmetadata, key, default=""):
    entry = extmetadata.get(key)
    if not entry:
        return default
    value = entry.get("value", default)
    # Strip simple HTML tags that sometimes appear in Commons metadata values.
    import re
    return re.sub(r"<[^>]+>", "", value).strip() or default


def download_and_convert(url, dest_path):
    time.sleep(REQUEST_DELAY)
    raw = http_get_with_retry(url)
    img = Image.open(io.BytesIO(raw))
    img = img.convert("RGB")
    if img.width > MAX_WIDTH:
        ratio = MAX_WIDTH / float(img.width)
        img = img.resize((MAX_WIDTH, int(img.height * ratio)), Image.LANCZOS)
    dest_path.parent.mkdir(parents=True, exist_ok=True)
    img.save(dest_path, "JPEG", quality=85, optimize=True)


def main():
    IMAGES_DIR.mkdir(parents=True, exist_ok=True)
    destinations = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    sources = {}
    failures = []

    for dest_id, meta in destinations.items():
        print(f"Resolving {dest_id} ({meta['name']}) ...")
        info = None
        for attempt in range(3):
            info = resolve_destination(dest_id, meta)
            if info:
                break
            time.sleep(2)
        if not info:
            failures.append(dest_id)
            print(f"  FAILED to resolve a real photo for {dest_id}")
            continue

        dest_path = IMAGES_DIR / f"{dest_id}.jpg"
        try:
            download_and_convert(info["url"], dest_path)
        except Exception as exc:  # noqa: BLE001
            failures.append(dest_id)
            print(f"  FAILED to download/convert {dest_id}: {exc}")
            continue

        extmeta = info.get("extmetadata", {})
        sources[dest_id] = {
            "name": meta["name"],
            "commons_file": info["title"],
            "source_url": info.get("descriptionurl", ""),
            "author": extmeta_value(extmeta, "Artist", "Wikimedia Commons"),
            "license": extmeta_value(extmeta, "LicenseShortName", ""),
        }
        print(f"  OK -> {dest_path.relative_to(ROOT)} ({sources[dest_id]['commons_file']})")

    sources_path = IMAGES_DIR / "SOURCES.json"
    sources_path.write_text(json.dumps(sources, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")

    if failures:
        print("\nFailed destinations: " + ", ".join(failures))
        sys.exit(1)

    print(f"\nAll {len(destinations)} destination images downloaded successfully.")


if __name__ == "__main__":
    main()
