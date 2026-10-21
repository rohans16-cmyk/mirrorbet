"""Polybot: copy the Polymarket traders you follow, on paper and with real money on Polymarket US.

    python3 server.py        then open http://localhost:8100

GET  /api/polymarket/profiles   the people you follow, their bets and the trader feed
GET  /api/polymarket/record     one person's Record tab (?wallet=)
GET  /api/polymarket/us         the real-money bot: your key, settings, tickets
GET  /api/polymarket/sims       the paper-money copy sims
GET  /api/polymarket/phone      phone alerts (Telegram / ntfy)
GET  /api/polymarket/go         open a polymarket.com game on polymarket.us (?slug=&title=)
GET  /api/alerts                in-app alerts since a time (?since=)
POST the same /api/polymarket/* paths with an {action} body
"""
import json
import mimetypes
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, quote, urlparse

import config


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass  # quiet: errors still print

    def _send(self, code, obj):
        raw = json.dumps(obj, default=str).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(raw)

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(n) or b"{}")

    def _static(self, path):
        root = config.WEB_DIST.resolve()
        f = (root / path.lstrip("/")).resolve()
        if not str(f).startswith(str(root)) or not f.is_file():
            f = root / "index.html"  # single-page app
        if not f.is_file():
            return self._send(500, {"ok": False, "error": "The page isn't built (web/dist is missing)."})
        raw = f.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", mimetypes.guess_type(str(f))[0] or "application/octet-stream")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-cache" if f.name == "index.html" else "public, max-age=31536000")
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        url = urlparse(self.path)
        q = {k: v[0] for k, v in parse_qs(url.query).items()}
        try:
            if url.path == "/api/alerts":
                import alerts
                return self._send(200, {"ok": True, "alerts": alerts.alerts(q.get("since"))})
            if url.path == "/api/polymarket/go":
                import polyprofiles
                slug, title = q.get("slug", ""), q.get("title", "")
                try:
                    us = polyprofiles.us_event(slug, title)
                except Exception:
                    us = None
                to = (f"https://polymarket.us/event/{us}" if us else
                      "https://polymarket.us/search?q=" + quote((title or slug).rstrip("?")))
                self.send_response(302)
                self.send_header("Location", to)
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            if url.path == "/api/polymarket/record":
                import polyprofiles
                return self._send(200, polyprofiles.record(q.get("wallet", "")))
            if url.path == "/api/polymarket/phone":
                import phonepush
                return self._send(200, phonepush.view())
            if url.path == "/api/polymarket/profiles":
                import polyprofiles
                return self._send(200, polyprofiles.summary())
            if url.path == "/api/polymarket/us":
                import polyus
                return self._send(200, polyus.summary())
            if url.path == "/api/polymarket/sims":
                import copysim
                return self._send(200, copysim.summary())
            if url.path == "/api/presence":
                return self._send(200, {"ok": True})
        except Exception as e:
            traceback.print_exc()
            return self._send(200, {"ok": False, "error": str(e)})
        if url.path.startswith("/api/"):
            return self._send(404, {"ok": False, "error": "not_found"})
        return self._static(url.path)

    def do_POST(self):
        path = urlparse(self.path).path
        try:
            body = self._body()
            if path == "/api/presence":
                return self._send(200, {"ok": True})
            if path == "/api/polymarket/phone":
                import phonepush
                if body.get("action") == "test":
                    phonepush.send("Test from Polybot", "Phone alerts work. Big bets from the people you follow land here.",
                                   tags=["white_check_mark"], wait=True)
                    return self._send(200, phonepush.view())
                if body.get("action") == "tg_token":  # your Telegram bot's token, from @BotFather
                    return self._send(200, phonepush.set_token(body.get("token")))
                if body.get("action") == "tg_link":  # did you tap Start in Telegram yet?
                    return self._send(200, phonepush.link())
                return self._send(200, phonepush.update(body))
            if path == "/api/polymarket/profiles":
                import polyprofiles
                act = body.get("action")
                if act == "remove":
                    polyprofiles.remove(body.get("wallet"))
                elif act == "alerts":
                    polyprofiles.set_alerts(body.get("wallet"), body.get("on"))
                elif act == "phone_min":
                    polyprofiles.set_phone_min(body.get("wallet"), body.get("usd"))
                elif act == "phone_on":
                    polyprofiles.set_phone_on(body.get("wallet"), bool(body.get("on")))
                else:
                    return self._send(200, {"ok": True, "profile": polyprofiles.add(body.get("text"))})
                return self._send(200, {"ok": True})
            if path == "/api/polymarket/us":
                import polyus
                act = body.get("action")
                if act == "keys":
                    return self._send(200, {"ok": True, "account": polyus.save_keys(body.get("key_id"), body.get("secret"))})
                if act == "forget":
                    polyus.forget_keys()
                    polyus.set_cfg({"mode": "off"})
                elif act == "cfg":
                    polyus.set_cfg(body)
                elif act == "place":
                    return self._send(200, {"ok": True, "ticket": polyus.place(body.get("id"))})
                elif act == "skip":
                    polyus.skip(body.get("id"))
                elif act == "person_add":
                    return self._send(200, {"ok": True, "people": polyus.person_add(body.get("text"))})
                elif act == "person_set":
                    return self._send(200, {"ok": True, "people": polyus.person_set(body.get("wallet"), body)})
                elif act == "person_remove":
                    return self._send(200, {"ok": True, "people": polyus.person_remove(body.get("wallet"))})
                elif act == "copy":
                    return self._send(200, {"ok": True, "ticket": polyus.copy_now(body.get("id"))})
                elif act == "sell":
                    return self._send(200, {"ok": True, "ticket": polyus.sell_now(body.get("id"))})
                else:
                    raise ValueError("Unknown action.")
                return self._send(200, {"ok": True})
            if path == "/api/polymarket/sims":
                import copysim
                act = body.pop("action", "create")
                if act == "remove":
                    copysim.remove(body.get("id"))
                elif act == "update":
                    copysim.update(body.pop("id", None), body)
                else:
                    return self._send(200, {"ok": True, "sim": copysim.create(body)})
                return self._send(200, {"ok": True})
        except (ValueError, RuntimeError) as e:
            return self._send(400, {"ok": False, "error": str(e)})
        except Exception as e:
            traceback.print_exc()
            return self._send(500, {"ok": False, "error": str(e)})
        return self._send(404, {"ok": False, "error": "not_found"})


def main():
    import copysim
    import polyprofiles
    import polyus
    polyprofiles.start()  # the people you follow: a live alert when one bets
    copysim.start()  # paper sims: settle every 10 minutes
    polyus.start()  # the real-money bot: settles, expires unplaced tickets, auto-sells
    print(f"Polybot is running: http://localhost:{config.PORT}  (Ctrl+C to stop)")
    server = ThreadingHTTPServer(("127.0.0.1", config.PORT), Handler)
    server.daemon_threads = True
    server.serve_forever()


if __name__ == "__main__":
    main()
