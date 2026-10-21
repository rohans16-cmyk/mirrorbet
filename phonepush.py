"""Phone notifications for followed Polymarket profiles' big bets (asked 2026-10-17: "notified on my phone when the
ppl i am following place a bet larger than some threshold i set in the app ... whatever is free").

Two free ways (`via`):
  ntfy      ntfy.sh: a phone app, no account. This server POSTs each alert to a topic the app subscribes to. Anyone
            who knows a topic's name can read it, so the topic is a random name made here. On the user's iPhone the
            messages landed in the app but no banner showed until it was opened (a known ntfy iOS issue), hence:
  telegram  your own Telegram bot (made with @BotFather; its token is pasted in the app and kept only here). Linking:
            the page opens t.me/<bot>?start=<code>, you tap Start, and link() finds that /start <code> message with
            getUpdates and keeps its chat id; pushes then go to that chat as ordinary Telegram messages

  config   data/polymarket/phone.json = {on, via, topic, min_usd, sells, tg_token, tg_bot, tg_chat, tg_code}: off until
           you turn it on; a bet (one alert's fills added up, polyprofiles._flush) of min_usd or more is pushed; sells
           only if `sells`
  per person   a profile's `phone_min` (profiles.json) replaces min_usd for them (None = the default)
  status   the last push sent and the last error, for the page

Sent from a thread, so a slow ntfy never holds up the alerts. Only while this server runs on the Mac.
"""
import html
import json
import secrets
import threading
import re
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

import config
import sources

PATH = config.DATA / "polymarket" / "phone.json"
NTFY = "https://ntfy.sh"
TG = "https://api.telegram.org/bot"
# profiles: pushes for followed profiles' big bets. Off 2026-10-18 at the user's request: the Polymarket US bot's own
# buys and sells (polyus._announce) still push while `on` is on.
DEFAULTS = {"on": False, "profiles": True, "via": "ntfy", "topic": "", "min_usd": 1000.0, "sells": False,
            "tg_token": "", "tg_bot": "", "tg_chat": None, "tg_code": ""}
EMOJI = {"moneybag": "💰", "outbox_tray": "📤", "white_check_mark": "✅"}  # ntfy tags, as Telegram text
_lock = threading.Lock()
_status = {"last": None, "error": None}


def get():
    try:
        cur = json.loads(PATH.read_text())
    except Exception:
        cur = {}
    out = {**DEFAULTS, **cur}
    if not out["topic"]:  # made once: long and random, since a topic's name is all that guards it
        out["topic"] = "picks-" + secrets.token_hex(8)
        _write(out)
    return out


def _write(cfg):
    PATH.parent.mkdir(parents=True, exist_ok=True)
    PATH.write_text(json.dumps(cfg, indent=1))


def view():
    """For the page: everything but the bot token (only the bot's name and whether a chat is linked)."""
    cfg = get()
    out = {k: v for k, v in cfg.items() if k not in ("tg_token", "tg_chat")}
    return {"ok": True, **out, "tg_linked": cfg["tg_chat"] is not None, "status": dict(_status)}


def _tg(token, method, body=None):
    req = urllib.request.Request(f"{TG}{token}/{method}", data=json.dumps(body or {}).encode(), method="POST",
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=15, context=sources.SSL) as r:
            out = json.loads(r.read())
    except urllib.error.HTTPError as e:  # Telegram explains itself in the body: "Unauthorized", "chat not found"
        try:
            out = json.loads(e.read())
        except Exception:
            raise e
    if not out.get("ok"):
        raise ValueError(f"Telegram: {out.get('description') or out}")
    return out["result"]


def set_token(token):
    """A bot token from @BotFather: checked with getMe, then waiting for you to tap Start (link())."""
    token = (token or "").strip()
    if not re.fullmatch(r"\d+:[\w-]{30,}", token):
        raise ValueError("That doesn't look like a bot token (it's like 123456789:AAH...). Copy it from @BotFather.")
    me = _tg(token, "getMe")
    with _lock:
        cfg = get()
        cfg.update(tg_token=token, tg_bot=me.get("username") or "", tg_chat=None, tg_code=secrets.token_hex(4), via="telegram")
        _write(cfg)
    return view()


def link():
    """Find the /start <code> you sent the bot and keep that chat. Returns view(); tg_linked says if it worked."""
    cfg = get()
    if not cfg["tg_token"]:
        raise ValueError("Paste your bot token first.")
    if cfg["tg_chat"] is not None:
        return view()
    for u in _tg(cfg["tg_token"], "getUpdates", {"allowed_updates": ["message"]}):
        m = u.get("message") or {}
        if (m.get("chat") or {}).get("type") == "private" and (m.get("text") or "").strip() == f"/start {cfg['tg_code']}":
            with _lock:
                cfg = get()
                cfg["tg_chat"] = m["chat"]["id"]
                _write(cfg)
            _tg(cfg["tg_token"], "getUpdates", {"offset": u["update_id"] + 1})  # read: the next link starts clean
            send("Linked", "Big bets from the people you follow will show up here.", tags=["white_check_mark"], wait=True)
            break
    return view()


def update(patch):
    with _lock:
        cfg = get()
        if "on" in patch:
            cfg["on"] = bool(patch["on"])
        if "sells" in patch:
            cfg["sells"] = bool(patch["sells"])
        if "profiles" in patch:
            cfg["profiles"] = bool(patch["profiles"])
        if "min_usd" in patch:
            cfg["min_usd"] = round(min(10_000_000.0, max(0.0, float(patch["min_usd"]))), 2)
        if patch.get("via") in ("ntfy", "telegram"):
            cfg["via"] = patch["via"]
        if patch.get("tg_unlink"):
            cfg.update(tg_token="", tg_bot="", tg_chat=None, tg_code="", via="ntfy")
        if patch.get("new_topic"):  # a fresh name: the old one stops getting pushes (resubscribe on the phone)
            cfg["topic"] = "picks-" + secrets.token_hex(8)
        _write(cfg)
    return view()


def wants(profile, side, usd):
    """Is this bet big enough to push? profile's phone_min, else the default; buys always, sells if asked."""
    cfg = get()
    if not cfg["on"] or not cfg.get("profiles", True) or not profile.get("alerts", True) or profile.get("phone_off"):
        return False
    if side != "BUY" and not cfg["sells"]:
        return False
    floor = profile.get("phone_min")
    return usd >= (cfg["min_usd"] if floor is None else floor)


def _post(msg):
    req = urllib.request.Request(NTFY, data=json.dumps(msg).encode(), method="POST",
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=15, context=sources.SSL) as r:
        r.read()


def _post_tg(cfg, title, text, actions, tags):
    """The same alert as a Telegram message: bold title, the text, its links as buttons under it."""
    if not cfg["tg_token"] or cfg["tg_chat"] is None:
        raise ValueError("Telegram isn't linked yet: paste the bot token and tap Start in Telegram.")
    icon = "".join(EMOJI.get(t, "") for t in (tags or []))
    body = {"chat_id": cfg["tg_chat"], "parse_mode": "HTML", "disable_web_page_preview": True,
            "text": f"{icon + ' ' if icon else ''}<b>{html.escape(title)}</b>\n{html.escape(text)}"}
    if actions:
        body["reply_markup"] = {"inline_keyboard": [[{"text": label, "url": url} for label, url in actions[:3]]]}
    _tg(cfg["tg_token"], "sendMessage", body)


def send(title, text, click=None, actions=None, priority=4, tags=None, wait=False):
    """One push to the phone. wait=True (the Test button) sends it now and raises what went wrong."""
    cfg = get()
    msg = {"topic": cfg["topic"], "title": title, "message": text, "priority": priority}
    if click:
        msg["click"] = click
    if actions:
        msg["actions"] = [{"action": "view", "label": label, "url": url} for label, url in actions][:3]
    if tags:
        msg["tags"] = tags

    def go():
        for i in range(2):  # one retry: a dropped connection shouldn't lose the alert
            try:
                if cfg["via"] == "telegram":
                    _post_tg(cfg, title, text, actions, tags)
                else:
                    _post(msg)
                _status.update(last={"title": title, "at": datetime.now(timezone.utc).isoformat(timespec="seconds")},
                               error=None)
                return
            except Exception as e:
                _status["error"] = f"{type(e).__name__}: {e}"[:200]
                print(f"[phonepush] {title}: {e}")
                if wait:
                    raise
                time.sleep(5)
    if wait:
        go()
    else:
        threading.Thread(target=go, daemon=True, name="phone-push").start()
