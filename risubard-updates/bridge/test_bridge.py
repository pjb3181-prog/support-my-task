"""Offline tests for the loopback Python bridge; never contact Gelbooru."""
import importlib.util
import json
import pathlib
import threading
import unittest
from unittest.mock import patch
from urllib.request import Request, urlopen
from urllib.error import HTTPError

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("character_mixer_bridge", HERE / "character_mixer_bridge.py")
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)

class BridgeTests(unittest.TestCase):
    def test_url_allowlist(self):
        self.assertTrue(bridge.allowed_image("https://img3.gelbooru.com/images/a.png"))
        self.assertTrue(bridge.allowed_image("https://cdn.donmai.us/original/a.jpg"))
        self.assertFalse(bridge.allowed_image("http://127.0.0.1:7777/private.png"))
        self.assertFalse(bridge.allowed_image("https://gelbooru.com.evil.example/a.png"))
        self.assertFalse(bridge.allowed_image("file:///etc/passwd"))
        self.assertFalse(bridge.allowed_image("https://google.com/x.png"))
    def test_image_magic(self):
        self.assertEqual(bridge.image_extension(b"\x89PNG\r\n\x1a\n" + b"abcd"),"image/png")
        self.assertIsNone(bridge.image_extension(b"<html>forbidden</html>"))
    def test_http_search_and_image_no_internet(self):
        server = bridge.Server(("127.0.0.1", 0), bridge.Handler)
        addr = "http://127.0.0.1:%d" % server.server_address[1]
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        calls = []
        def fake_get(url, *, params=None, image=False):
            calls.append((url,params,image))
            if image:
                return b"\x89PNG\r\n\x1a\n" + b"12345678", "image/png"
            return {"post":[{"id":123,"rating":"general","tags":"smile"}]}, "application/json"
        try:
            with patch.object(bridge, "safe_remote_get", side_effect=fake_get):
                with urlopen(addr+"/health",timeout=3) as res:
                    health = json.loads(res.read())
                    self.assertTrue(health["ok"])
                req=Request(addr+"/search",data=json.dumps({"tags":"smile rating:general","limit":5,"userId":"123","apiKey":"fakekey"}).encode(),
                            headers={"Content-Type":"application/json"},method="POST")
                with urlopen(req,timeout=3) as res:
                    posts=json.loads(res.read())
                self.assertEqual(posts["post"][0]["id"],123)
                self.assertEqual(calls[0][1]["user_id"],"123")
                self.assertEqual(calls[0][1]["limit"],5)
                req=Request(addr+"/image",data=json.dumps({"url":"https://img3.gelbooru.com/images/a.png"}).encode(),
                            headers={"Content-Type":"application/json"},method="POST")
                with urlopen(req,timeout=3) as res:
                    self.assertEqual(res.headers.get("Content-Type"),"image/png")
                    self.assertTrue(res.read().startswith(b"\x89PNG"))
                self.assertTrue(calls[-1][2])
                # SSRF attempt must be rejected before any requests are sent
                req=Request(addr+"/image",data=json.dumps({"url":"http://127.0.0.1:8080/secret"}).encode(),
                            headers={"Content-Type":"application/json"},method="POST")
                with self.assertRaises(HTTPError) as e:
                    urlopen(req,timeout=3)
                self.assertEqual(e.exception.code,400)
                self.assertEqual(len(calls),2)
        finally:
            server.shutdown()
            server.server_close()
            thread.join(3)

if __name__=="__main__":
    unittest.main()
