#!/usr/bin/env python3
"""Character Mixer Local Asset Bridge — a small, opt-in loopback-only service.

Usage: python character_mixer_bridge.py
Requires Python 3.9+ and requests (same library as Gelbooru Downloader).
No API credentials are embedded in or stored by this service.
"""
import ipaddress
import json
import re
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

try:
    import requests
except ImportError:
    raise SystemExit("Python requests is missing. In your existing downloader environment run: python -m pip install requests")

HOST = "127.0.0.1"
PORT = 18765
MAX_BODY = 16384
MAX_IMAGE = 18 * 1024 * 1024
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36"
LOCK = threading.BoundedSemaphore(3)

def allowed_origin(origin):
    if not origin:
        return True   # Requests forwarded by RisuBard's local /proxy2.
    try:
        p = urlsplit(origin)
        return p.scheme in ("http", "https") and p.hostname in ("127.0.0.1", "localhost", "::1")
    except ValueError:
        return False

def allowed_image(url):
    try:
        p = urlsplit(url)
        host = (p.hostname or "").lower()
        suffix = any(host == root or host.endswith("." + root) for root in ("gelbooru.com", "donmai.us"))
        return p.scheme == "https" and suffix and not p.username and not p.password and p.port in (None, 443)
    except (ValueError, TypeError):
        return False

def image_extension(data):
    if len(data) < 12:
        return None
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data.startswith((b"GIF87a", b"GIF89a")):
        return "image/gif"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None

def safe_remote_get(url, *, params=None, image=False):
    # Explicit redirects let us revalidate each destination and prevent SSRF.
    with requests.Session() as session:
        current = url
        for _ in range(4):
            if image:
                if not allowed_image(current):
                    raise ValueError("Invalid remote image host")
            elif not current.startswith("https://gelbooru.com/index.php"):
                raise ValueError("Invalid API host")
            with session.get(current, params=params, timeout=(8, 35),
                             headers={"User-Agent": USER_AGENT,
                                      "Accept": "image/*" if image else "application/json",
                                      "Referer": "https://gelbooru.com/"},
                             allow_redirects=False, stream=True) as res:
                if res.status_code in (301, 302, 303, 307, 308):
                    target = requests.compat.urljoin(current, res.headers.get("Location", ""))
                    if not allowed_image(target) if image else not target.startswith("https://gelbooru.com/index.php"):
                        raise ValueError("Unsafe redirect")
                    current = target
                    params = None
                    continue
                if res.status_code != 200:
                    raise RuntimeError("Remote HTTP " + str(res.status_code))
                if image:
                    data = bytearray()
                    for chunk in res.iter_content(chunk_size=65536):
                        data.extend(chunk)
                        if len(data) > MAX_IMAGE:
                            raise ValueError("Image exceeds 18 MB")
                    mime = image_extension(data)
                    if not mime:
                        raise ValueError("Remote response is not an image")
                    return bytes(data), mime
                data = res.content
                if len(data) > 2 * 1024 * 1024:
                    raise ValueError("Search response too large")
                try:
                    parsed = json.loads(data.decode("utf-8-sig"))
                except (UnicodeError, json.JSONDecodeError):
                    raise RuntimeError("Remote API did not return JSON")
                return parsed, "application/json"
        raise RuntimeError("Too many redirects")

class Handler(BaseHTTPRequestHandler):
    server_version = "CharacterMixerBridge/1.0"
    def log_message(self, fmt, *args):
        # No request body, secrets, or query strings are ever logged.
        return

    def _cors(self):
        origin = self.headers.get("Origin", "")
        if origin and allowed_origin(origin):
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Cache-Control", "no-store")

    def _send(self, status, content, content_type="application/json"):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(content)))
        self._cors()
        self.end_headers()
        self.wfile.write(content)

    def _json(self, status, value):
        self._send(status, json.dumps(value, ensure_ascii=False).encode("utf-8"))

    def do_OPTIONS(self):
        if not allowed_origin(self.headers.get("Origin")):
            self._json(403, {"error": "Origin blocked"})
            return
        self._send(204, b"")

    def do_GET(self):
        if self.path != "/health":
            self._json(404, {"error": "Not found"})
            return
        self._json(200, {"ok": True, "service": "CharacterMixerBridge", "version": 1})

    def do_POST(self):
        if self.path not in ("/search", "/image"):
            self._json(404, {"error": "Not found"})
            return
        if not allowed_origin(self.headers.get("Origin")):
            self._json(403, {"error": "Origin blocked"})
            return
        if self.headers.get("Content-Type", "").split(";")[0].strip().lower() != "application/json":
            self._json(415, {"error": "JSON required"})
            return
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if size <= 0 or size > MAX_BODY:
                self._json(413, {"error": "Request body exceeds limit"})
                return
            body = json.loads(self.rfile.read(size).decode("utf-8"))
            if not isinstance(body, dict):
                raise ValueError("Invalid request")
        except (ValueError, UnicodeError, json.JSONDecodeError):
            self._json(400, {"error": "Invalid JSON request"})
            return
        if not LOCK.acquire(blocking=False):
            self._json(429, {"error": "Bridge busy"})
            return
        try:
            if self.path == "/search":
                tags = str(body.get("tags", "")).strip()
                # Caller-supplied tag terms, never a caller-supplied URL.
                if len(tags) > 200 or not re.fullmatch(r"[A-Za-z0-9_:\-() ]{1,200}", tags):
                    raise ValueError("Invalid tag query")
                limit = max(1, min(30, int(body.get("limit", 12))))
                page = max(0, min(200, int(body.get("page", 0))))
                user_id = str(body.get("userId") or "").strip()
                api_key = str(body.get("apiKey") or "").strip()
                if len(user_id) > 20 or not re.fullmatch(r"[0-9]*", user_id):
                    raise ValueError("Invalid user ID")
                if len(api_key) > 256 or not re.fullmatch(r"[A-Za-z0-9]*", api_key):
                    raise ValueError("Invalid API key")
                params = {"page": "dapi", "s": "post", "q": "index", "json": 1,
                          "limit": limit, "pid": page, "tags": tags}
                if user_id and api_key:
                    params.update({"user_id": user_id, "api_key": api_key})
                data, _ = safe_remote_get("https://gelbooru.com/index.php", params=params)
                self._json(200, data)
            else:
                url = str(body.get("url") or "")
                if not allowed_image(url):
                    raise ValueError("Invalid image host")
                data, mime = safe_remote_get(url, image=True)
                self._send(200, data, mime)
        except ValueError as e:
            self._json(400, {"error": str(e)[:120]})
        except requests.RequestException:
            self._json(502, {"error": "Python downloader network request failed"})
        except Exception as e:
            # The exception may contain an API URL with credentials; never echo.
            self._json(502, {"error": "Python downloader fetch failed (" + type(e).__name__ + ")"})
        finally:
            LOCK.release()

class Server(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

if __name__ == "__main__":
    server = Server((HOST, PORT), Handler)
    print("Character Mixer Local Bridge running at http://127.0.0.1:%s" % PORT, flush=True)
    print("Keep this window open while using RisuBard. Ctrl+C to stop.", flush=True)
    try:
        server.serve_forever(poll_interval=0.3)
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
