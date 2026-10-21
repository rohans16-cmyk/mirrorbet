"""Polymarket US, real money (asked 2026-10-16: "place bets on polymarket for me via api … only copy hightemptation").

2026-10-18: back on, copying Kch-Temp and primm's sports bets (moneyline, spread, total; soccer win/draw), sized
like copysim (stake x their bet / their usual, capped at max_stake an outcome), adds copied up to the cap. When they
sell an outcome you hold (follow_sells), the whole US position is closed (/v1/order/close-position, 2 ticks of slippage
off the price then), as the paper sims exit on their sell. The
weather matcher below (HighTempTation) is kept but he's no longer in COPY.

Polymarket US (polymarket.us, CFTC-regulated) is the exchange a US resident can legally trade; polymarket.com, where
the profiles you follow bet, blocks the US. So a copy is the same bet placed on the US exchange.

  keys     data/polymarket/us_keys.json {key_id, secret} (polymarket.us/developer, after identity check in the app),
           saved from the page, file mode 600, the secret never sent back to the browser. Each request is signed
           with Ed25519 over timestamp + method + path (X-PM-Access-Key / X-PM-Timestamp / X-PM-Signature).
  copying  only HighTempTation, only his daily-high temperature buys in Miami, Los Angeles and San Francisco: the US
           site settles those at the same station (KMIA, KLAX, KSFO), but NYC is Central Park there (his is
           LaGuardia) and Chicago is Midway (his is O'Hare), so those are different bets and are skipped. The US site
           has 6 buckets a day where his has 11, so only a bucket with the same range on both is copied.
           research/htt_us_copy.py (2026-10-16, US prices at the minute he bet): 88 of his 322 buys there had a
           matching US bucket; at his price +1¢ 24 filled, 24–0, avg 97.4¢, +2.6% a bet (all 88 at any price: 88–0,
           +1.6%). Thin: one loss at 97¢ takes ~35 wins back.
  tickets  each of his matching buys becomes a ticket (data/polymarket/us_tickets.json) from polyprofiles' live alert.
           mode "off": recorded only (a live paper record). "ask": an alert, and the page's Place button buys it for
           10 minutes. "auto": bought at once. A buy is a limit order at his price + slip, immediate-or-cancel, so it
           never pays more; stake = stake_pct of buying power, capped at max_stake; per_day buys at most. Held to
           the result (his sells are ignored, as in the backtest); settle() reads the US settlement.
"""
import base64
import json
import math
import os
import re
import threading
import time
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import polyprofiles
import sources

DIR = polyprofiles.DIR
KEYS = DIR / "us_keys.json"
CFG = DIR / "us_copy.json"
TICKETS = DIR / "us_tickets.json"
SEEN = DIR / "us_manual_seen.json"  # your own sells on Polymarket US already counted against the bot's tickets
API = "https://api.polymarket.us"
PUB = "https://gateway.polymarket.us"
ET = ZoneInfo("America/New_York")

COPY = {"0x924379a79c64b77ad5816ad362122a5f6228658e": "Kch-Temp", "0xd38b71f3e8ed1af71983e5c309eac3dfa9b35029": "primm",
        # added 2026-10-19 (user): research/leader_copy.py, his copyable sports bets: under $10K −6% to −17% (n=38),
        # $10-25K +31.9% (n=43, won 72%), $25K+ +12.9% (n=18); small samples, so a $10K floor like primm's
        "0xe18ecc345e00ee7c4f2d1f676f3dd2acb112f826": "ArielFilipino"}
# Only their big bets (2026-10-18, user: "only take primm large money bets"): research/primm_size.py, copying at his
# average + 1¢ after the US fee: all his bets −1% to −19% by size, but $10K+ +11.5% (458 bets; +7.4% / +18.2% in the
# older / newer half by game date) and $25K+ +17.2%. A bet is copied once his total on the outcome (his live buys,
# this one included) reaches the floor; the copy is sized on that total, and his adds after it top it up.
MIN_THEIRS = {"primm": 10000.0, "Kch-Temp": 5000.0, "ArielFilipino": 10000.0}  # Kch-Temp under $5K: −18.7% (76 bets, avg price + 1¢, fee)
# COPY / MIN_THEIRS are only the starting list: who's copied lives in the settings (cfg "people", asked 2026-10-19:
# "a way for me to add people to copy and set limits"), each {wallet, name, min_usd, take_profit, on}. Someone
# removed goes to cfg "former": their sells still close bets already copied from them.


def people():
    c = cfg()
    if c.get("people") is not None:
        return c["people"]
    tps = c.get("take_profit_by") or {}
    return [{"wallet": w, "name": n, "min_usd": MIN_THEIRS.get(n, 0.0), "take_profit": tps.get(n, 0.0), "on": True}
            for w, n in COPY.items()]


def copy_map():
    """{wallet: name} the bot copies now."""
    return {p["wallet"]: p["name"] for p in people() if p.get("on", True)}


def names_all():
    """Everyone it copies or did: their sells still close what was copied from them."""
    return {**(cfg().get("former") or {}), **{p["wallet"]: p["name"] for p in people()}}


def min_for(name):
    return next((float(p.get("min_usd") or 0) for p in people() if p["name"] == name), 0.0)


def _save_people(rows, former=None):
    c = cfg()
    c["people"] = rows
    if former is not None:
        c["former"] = former
    DIR.mkdir(parents=True, exist_ok=True)
    CFG.write_text(json.dumps(c, indent=1))


def person_add(text):
    """Follow them if needed (alerts come from followed profiles), then copy them: $10K+ and held to the result
    until you change it (the floor that worked for primm and ArielFilipino)."""
    text = (text or "").strip()
    if not text:
        raise ValueError("Paste their Polymarket profile link, @name or wallet.")
    key = text.rstrip("/").split("/")[-1].split("?")[0].lstrip("@").lower()
    def find():
        return next((p for p in polyprofiles.profiles()
                     if key in (p["wallet"].lower(), p["name"].lower(), (p.get("handle") or "").lower())), None)
    match = find()
    if not match:
        polyprofiles.add(text)
        match = find() or polyprofiles.profiles()[-1]
    rows = people()
    if any(r["wallet"] == match["wallet"] for r in rows):
        raise ValueError(f"{match['name']} is already on the list.")
    rows = rows + [{"wallet": match["wallet"], "name": match["name"], "min_usd": 10000.0, "take_profit": 0.0, "on": True}]
    polyprofiles.set_phone_on(match["wallet"], True)  # their bets push to your phone (2026-10-19: everyone copied does)
    former = dict(cfg().get("former") or {})
    former.pop(match["wallet"], None)
    _save_people(rows, former)
    return rows


def person_set(wallet, body):
    rows = people()
    for r in rows:
        if r["wallet"] == wallet:
            if body.get("min_usd") is not None:
                v = float(body["min_usd"])
                if not 0 <= v <= 10_000_000:
                    raise ValueError("Their minimum bet must be $0 to $10,000,000.")
                r["min_usd"] = v
            if body.get("take_profit") is not None:
                v = float(body["take_profit"] or 0)
                if not (v == 0 or 0.05 <= v <= 5):
                    raise ValueError("Auto-sell is Hold or between +5% and +500%.")
                r["take_profit"] = v
            if "on" in body:
                r["on"] = bool(body["on"])
    _save_people(rows)
    return rows


def person_remove(wallet):
    rows = people()
    former = dict(cfg().get("former") or {})
    for r in rows:
        if r["wallet"] == wallet:
            former[r["wallet"]] = r["name"]
    _save_people([r for r in rows if r["wallet"] != wallet], former)
    return people()
CITY = {"Miami": "mia", "Los Angeles": "lax", "San Francisco": "sfo"}
OTHER_STATION = {"New York City": "the US market reads Central Park, his reads LaGuardia",
                 "NYC": "the US market reads Central Park, his reads LaGuardia",
                 "Chicago": "the US market reads Midway, his reads O'Hare"}
DEFAULTS = {"mode": "ask", "stake": 5.0, "max_stake": 10.0, "per_day": 10, "max_day": 50.0, "slip": 0.01, "max_price": 0.90,
            # no long shots (2026-10-19: alwaysfade's mid-game add to Commanders ML at 5c was copied for $17.86). Their
            # tested record is 378 bets at 30c+ (+14% copied); under 30c only 11, none under 10c.
            "min_price": 0.30,
            "follow_sells": True, "take_profit": 0.0,
            # auto-sell per person (2026-10-18, user: "sell when we reach some profit for kch and some other profit for
            # primm"; then "optimize the bot to make the most money, i dont care when you sell"): the most money on
            # their past bets. Kch-Temp: +100% +33.5% vs +30.5% holding (201 bets; +150% read higher on ~12 bets,
            # too few). primm $10K+: holding +19.6% beat every level (+150% +14.8%, +50% +9.3%). 0 = hold.
            "take_profit_by": {"Kch-Temp": 1.0, "primm": 0.0}}
ASK_S = 600  # an "ask" ticket can be placed for 10 minutes
LATE_S = 2700  # a buy reaching us 45+ min after it happened isn't copied
SETTLE_S = 600
INF = 999

_lock = threading.RLock()
_started = False


def _read(p, default):
    try:
        return json.loads(p.read_text())
    except Exception:
        return default


def _now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


# ---- keys and requests ---------------------------------------------------------------------------------------
def keys():
    k = _read(KEYS, {})
    return k if k.get("key_id") and k.get("secret") else None


def save_keys(key_id, secret):
    key_id, secret = (key_id or "").strip(), (secret or "").strip()
    if not re.fullmatch(r"[0-9a-fA-F-]{20,}", key_id):
        raise ValueError("The Key ID looks wrong (it's a long id like 1a2b3c4d-…).")
    try:
        raw = base64.b64decode(secret, validate=True)
    except Exception:
        raise ValueError("The Secret Key looks wrong (copy the whole thing from polymarket.us/developer).")
    if len(raw) < 32:
        raise ValueError("The Secret Key is too short.")
    DIR.mkdir(parents=True, exist_ok=True)
    fd = os.open(KEYS, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        json.dump({"key_id": key_id, "secret": secret, "saved_at": _now()}, f)
    os.chmod(KEYS, 0o600)
    return account()  # proves the key works


def forget_keys():
    KEYS.unlink(missing_ok=True)


def _signed(method, path, body=None):
    from cryptography.hazmat.primitives.asymmetric import ed25519
    k = keys()
    if not k:
        raise RuntimeError("No Polymarket US key yet: add it on the Polymarket page.")
    priv = ed25519.Ed25519PrivateKey.from_private_bytes(base64.b64decode(k["secret"])[:32])
    ts = str(int(time.time() * 1000))
    sig = base64.b64encode(priv.sign(f"{ts}{method}{path.split('?')[0]}".encode())).decode()  # signed without the query
    req = urllib.request.Request(f"{API}{path}", method=method,
                                 data=json.dumps(body).encode() if body is not None else None,
                                 headers={"X-PM-Access-Key": k["key_id"], "X-PM-Timestamp": ts, "X-PM-Signature": sig,
                                          "Content-Type": "application/json", "User-Agent": "polyshadow"})
    try:
        with urllib.request.urlopen(req, timeout=20, context=sources.SSL) as r:
            raw = r.read()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"Polymarket US {e.code}: {e.read().decode()[:300]}")


def _pub(path):
    raw, _ = sources._get(f"{PUB}{path}", timeout=20)
    return json.loads(raw)


def account():
    b = (_signed("GET", "/v1/account/balances").get("balances") or [{}])[0]
    return {"balance": float(b.get("currentBalance") or 0), "buying_power": float(b.get("buyingPower") or 0),
            "open_orders": float(b.get("openOrders") or 0), "in_bets": float(b.get("assetNotional") or 0)}


def ask_price(slug, long):
    """What one contract costs right now: the long (YES) ask, or for the short side one minus the long bid."""
    m = _pub(f"/v1/markets/{slug}/bbo").get("marketData") or {}
    if long:
        v = (m.get("bestAsk") or {}).get("value")
        return float(v) if v else None
    v = (m.get("bestBid") or {}).get("value")
    return round(1 - float(v), 4) if v else None


# ---- his market -> the same US market --------------------------------------------------------------------------
def _their_range(title):
    """'… be between 80-81°F on …' / '… 77°F or below …' / '… 96°F or higher …' -> (lo, hi), whole degrees."""
    if m := re.search(r"be between (\d+)-(\d+)°F", title):
        return int(m.group(1)), int(m.group(2))
    if m := re.search(r"be (\d+)°F or below", title):
        return -INF, int(m.group(1))
    if m := re.search(r"be (\d+)°F or higher", title):
        return int(m.group(1)), INF


def _us_range(slug):
    """US bucket suffixes: lt84f (83 or below), gte84lt85f (84–85), gte92f (92 or above)."""
    b = slug.rsplit("-", 1)[-1]
    if m := re.fullmatch(r"gte(\d+)lt(\d+)f", b):
        return int(m.group(1)), int(m.group(2))
    if m := re.fullmatch(r"lt(\d+)f", b):
        return -INF, int(m.group(1)) - 1
    if m := re.fullmatch(r"gte(\d+)f", b):
        return int(m.group(1)), INF


_events = {}


def match(title, slug):
    """His bet -> {us: US market slug, city, day} or {why: the reason it can't be copied}."""
    m = re.search(r"highest temperature in (.+?) be", title or "")
    if not m:
        return {"why": "not a daily-high temperature market"}
    city = m.group(1)
    if city in OTHER_STATION:
        return {"city": city, "why": f"different weather station: {OTHER_STATION[city]}"}
    if city not in CITY:
        return {"city": city, "why": "no US market for this city"}
    d = re.search(r"on-([a-z]+)-(\d+)-(\d{4})", slug or "")
    rng = _their_range(title)
    if not d or not rng:
        return {"city": city, "why": "couldn't read the date or the range"}
    day = datetime.strptime(f"{d.group(1)} {d.group(2)} {d.group(3)}", "%B %d %Y").strftime("%Y-%m-%d")
    key = (city, day)
    if key not in _events or time.time() - _events[key][0] > 3600:
        try:
            e = _pub(f"/v1/events/slug/temp-{CITY[city]}high-{day}")
            e = e.get("event", e)
            _events[key] = (time.time(), {_us_range(x["slug"]): x["slug"] for x in e.get("markets", [])})
        except Exception:
            _events[key] = (time.time(), {})
    us = _events[key][1].get(rng)
    if not us:
        return {"city": city, "day": day, "why": "the US market has no bucket with this range"}
    return {"city": city, "day": day, "us": us}


def _norm(x):
    return re.sub(r"[^a-z0-9 ]", "", (x or "").lower().replace("&", "and")).replace(" fc", "").replace("fc ", "").strip()


def _same_team(name, team):
    """A .com team name vs a US side's team ({name, alias, safeName, abbreviation})."""
    a = _norm(name)
    if not a or not team:
        return False
    for b in (team.get("name"), team.get("safeName"), team.get("alias"), team.get("abbreviation"), team.get("displayAbbreviation"),
              f"{team.get('name', '')} {team.get('alias', '')}"):
        b = _norm(b)
        if b and (a == b or (len(a) > 3 and len(b) > 3 and (a.startswith(b) or b.startswith(a)))):
            return True
    return False


_us_ev = {}


def _us_markets(us_slug):
    hit = _us_ev.get(us_slug)
    if hit and time.time() - hit[0] < 300:
        return hit[1]
    e = _pub(f"/v1/events/slug/{us_slug}")
    e = e.get("event", e)
    ms = [m for m in e.get("markets") or [] if not m.get("closed")]
    _us_ev[us_slug] = (time.time(), ms)
    return ms


def _full(t):  # full-game markets only (not halves, quarters, team points)
    return not any(x in t for x in ("half", "quarter", "team_points", "1h", "corners"))


def match_sport(title, slug, outcome):
    """Their .com bet -> {us: market slug, long: True for the YES/long side} or {why}."""
    us_ev = polyprofiles.us_event(slug, title)
    if not us_ev:
        return {"why": "no matching game on Polymarket US"}
    try:
        ms = _us_markets(us_ev)
    except Exception as e:
        return {"why": f"couldn't read the US game: {str(e)[:80]}"}
    t = title or ""
    sides = lambda m: m.get("marketSides") or []
    if m := re.match(r"Spread:\s*(.+?)\s*\(([-+]?\d+(?:\.\d+)?)\)", t):  # Spread: Temple (-19.5), outcome either team
        fav, line = m.group(1), abs(float(m.group(2)))
        want = -line if _norm(outcome) == _norm(fav) else line  # the line of the side they bought
        for x in ms:
            if x.get("sportsMarketType", "").endswith("full_game_spread") and _full(x["sportsMarketType"]):
                for sd in sides(x):
                    try:
                        if _same_team(outcome, sd.get("team")) and abs(float(sd["description"]) - want) < 1e-6:
                            return {"us": x["slug"], "long": bool(sd.get("long"))}
                    except ValueError:
                        pass
        return {"why": f"no {outcome} {want:+g} spread on the US game"}
    if m := re.search(r"O/U\s*(\d+(?:\.\d+)?)", t):  # A vs. B: O/U 45.5, outcome Over/Under
        line = float(m.group(1))
        for x in ms:
            ty = x.get("sportsMarketType", "")
            if ty.endswith("full_game_total") and _full(ty) and abs(float(x.get("line") or -1) - line) < 1e-6:
                return {"us": x["slug"], "long": outcome == "Over"}
        return {"why": f"no {line:g} total on the US game"}
    if re.search(r"end in a draw", t, re.I):
        for x in ms:
            if x.get("sportsMarketType", "").endswith("full_time_winner") and x["slug"].endswith("-draw"):
                return {"us": x["slug"], "long": outcome == "Yes"}
        return {"why": "no draw market on the US game"}
    if m := re.match(r"Will (.+?) win\b", t):  # soccer: Will Toulouse FC win on 2026-10-16? Yes/No
        team = m.group(1)
        for x in ms:
            ty = x.get("sportsMarketType", "")
            if ty.endswith("full_time_winner") and _full(ty) and any(sd.get("long") and _same_team(team, sd.get("team")) for sd in sides(x)):
                return {"us": x["slug"], "long": outcome == "Yes"}
        return {"why": f"no {team} to win on the US game"}
    if " vs" in t and ":" not in t:  # moneyline: Toledo vs. Eastern Michigan, outcome a team
        for x in ms:
            ty = x.get("sportsMarketType", "")
            if (ty.endswith("full_game_winner") or ty.endswith("moneyline")) and _full(ty):
                for sd in sides(x):
                    if _same_team(outcome, sd.get("team")) or _norm(sd.get("description")) == _norm(outcome):
                        return {"us": x["slug"], "long": bool(sd.get("long"))}
        return {"why": f"no {outcome} moneyline on the US game"}
    return {"why": "market type not copied (props, halves, futures…)"}


# ---- copying -------------------------------------------------------------------------------------------------
def cfg():
    return {**DEFAULTS, **_read(CFG, {})}


def set_cfg(body):
    c = cfg()
    if "mode" in body:
        if body["mode"] not in ("off", "ask", "auto"):
            raise ValueError("Mode is off, ask or auto.")
        if body["mode"] != "off" and not keys():
            raise ValueError("Add your Polymarket US key first.")
        c["mode"] = body["mode"]
    for k, lo, hi in (("stake", 1, 10000), ("max_stake", 1, 10000), ("per_day", 1, 100), ("max_day", 1, 100000), ("slip", 0, 0.05),
                      ("max_price", 0.05, 0.99), ("min_price", 0.01, 0.95)):
        if body.get(k) is not None:
            v = float(body[k])
            if not lo <= v <= hi:
                raise ValueError(f"{k.replace('_', ' ')} must be between {lo:g} and {hi:g}.")
            c[k] = int(v) if k == "per_day" else v
    if c.get("min_price", 0) >= c["max_price"]:
        raise ValueError("Min price has to be under max price.")
    if body.get("take_profit") is not None:  # auto-sell at this gain (0.85 = +85%); 0 = off
        v = float(body["take_profit"])
        if not (v == 0 or 0.05 <= v <= 5):
            raise ValueError("Take profit is off or between +5% and +500%.")
        c["take_profit"] = v
    if isinstance(body.get("take_profit_by"), dict):
        by = dict(c.get("take_profit_by") or {})
        for name, v in body["take_profit_by"].items():
            v = float(v or 0)
            if not (v == 0 or 0.05 <= v <= 5):
                raise ValueError("Take profit is off or between +5% and +500%.")
            by[str(name)] = v
        c["take_profit_by"] = by
    if "follow_sells" in body:
        c["follow_sells"] = bool(body["follow_sells"])
    DIR.mkdir(parents=True, exist_ok=True)
    CFG.write_text(json.dumps(c, indent=1))
    return c


def tickets():
    return _read(TICKETS, [])


def _save(rows):
    DIR.mkdir(parents=True, exist_ok=True)
    TICKETS.write_text(json.dumps(rows[-500:], indent=1))


def _update(tid, **kw):
    with _lock:
        rows = tickets()
        for t in rows:
            if t["id"] == tid:
                t.update(kw)
                _save(rows)
                return t


def _bought_today():
    today = datetime.now(ET).date()
    return sum(1 for t in tickets() if t.get("filled") and datetime.fromisoformat(t["placed_at"]).astimezone(ET).date() == today)


def _today(key):
    today = datetime.now(ET).date()
    return sum((1 if key == "n" else t.get("cost") or 0) for t in tickets()
               if t.get("filled") and t.get("side", "BUY") == "BUY" and datetime.fromisoformat(t["placed_at"]).astimezone(ET).date() == today)


def _bought_today():
    return _today("n")


def _their_total(row):
    """Their total buys of this outcome in the live feed over the last 3 days (this alert included)."""
    cut = time.time() - 3 * 86400
    tot = 0.0
    for r in polyprofiles._read(polyprofiles.LIVE, []):
        if r.get("wallet") == row["wallet"] and r.get("asset") == row["asset"] and r.get("side") == "BUY":
            try:
                if datetime.fromisoformat(r["at"]).timestamp() >= cut:
                    tot += r["usd"]
            except Exception:
                pass
    pos = polyprofiles.position_cost(row["wallet"], row["asset"])  # their whole position, as the watcher last saw it
    return max(tot, row["usd"], pos or 0)


def _not_started(us_event):
    try:
        e = _pub(f"/v1/events/slug/{us_event}")
        e = e.get("event", e)
        st = e.get("startTime")
        return not e.get("live") and not e.get("ended") and (
            not st or datetime.fromisoformat(st.replace("Z", "+00:00")) > datetime.now(timezone.utc))
    except Exception:
        return False


def catch_up(wallet, positions):
    """The bot's first look at someone it copies (asked 2026-10-19: "this should be automatic"): every open position of
    theirs over their floor, on a game that hasn't started, with no ticket of ours yet, goes through on_bet as if just
    placed (their whole position, their average price): bought if Polymarket US still sells it at their price + slip.
    Catches what the server missed while it was down or what the old fill counting missed (Kch-Temp's $139.9K
    Under 52.5, seen as $290)."""
    name = copy_map().get(wallet)
    if not name or cfg()["mode"] == "off":
        return
    have = {t["asset"] for t in tickets() if not (t["status"] == "skip" and "you copy from" in (t.get("why") or ""))}
    for asset, n in positions.items():
        if asset in have or n["cost"] < min_for(name) or not n["size"]:
            continue
        us = polyprofiles.us_event(n["slug"] or "", n["title"] or "")
        if not us or not _not_started(us):
            continue
        row = {"wallet": wallet, "name": name, "side": "BUY", "asset": asset, "title": n["title"], "outcome": n["outcome"],
               "slug": n["slug"], "usd": n["cost"], "price": round(n["cost"] / n["size"], 4),
               "traded_at": _now(), "via": "catch-up"}
        print(f"[polyus] catch-up: {name} {n['outcome']} · {n['title']} (${n['cost']:,.0f})")
        try:
            polyprofiles.feed_catch_up(row)  # the Trader feed shows the whole bet too
        except Exception as e:
            print(f"[polyus] catch-up feed {asset[:10]}: {e}")
        try:  # and the paper sims (2026-10-19: they never got catch-up bets, so Copy Kch-Temp missed the Under 52.5)
            import copysim
            copysim.on_bet(dict(row, catch_up=True))
        except Exception as e:
            print(f"[polyus] catch-up sims {asset[:10]}: {e}")
        try:
            on_bet(row)
        except Exception as e:
            print(f"[polyus] catch-up {asset[:10]}: {e}")


def copy_now(tid):
    """Your "Copy now" on a bet the bot skipped (asked 2026-10-18 after a matching bug skipped primm's $20K Packers
    bet): their alert run through the copier again as an ask ticket, then placed at once with the usual limit (their
    price + slip) and sizing. Returns the new ticket."""
    old = next((t for t in tickets() if t["id"] == tid), None)
    if not old or old.get("side", "BUY") != "BUY" or old["status"] not in ("skip", "error", "paper"):
        raise ValueError("Only a skipped bet can be copied now.")
    wallet = next((w for w, n in names_all().items() if n == old.get("who")), None)
    row = next((r for r in reversed(polyprofiles._read(polyprofiles.LIVE, []))
                if r.get("asset") == old["asset"] and r.get("wallet") == wallet and r.get("side") == "BUY"), None)
    if not row:
        raise ValueError("Their bet isn't in the recent alerts any more.")
    _update(tid, why=f"{old.get('why')} (copy now pressed)")
    before = {t["id"] for t in tickets()}
    on_bet(row, mode="ask", quiet=True, stale_ok=True)  # you pressed it: its price limit still guards
    new = next((t for t in reversed(tickets()) if t["id"] not in before and t["asset"] == old["asset"]), None)
    if not new:
        raise ValueError("Couldn't copy it.")
    if new["status"] != "ready":
        raise ValueError(f"Not copied: {new.get('why')}")
    return place(new["id"])


def on_bet(row, mode=None, quiet=False, stale_ok=False):
    """A followed profile's bet from polyprofiles' live alert: Kch-Temp / primm buys become tickets, sized like copysim
    (stake x their bet / their usual), each add of theirs another ticket until the outcome reaches max_stake."""
    if row.get("wallet") not in names_all():
        return
    if row.get("side") == "SELL":  # a sell is followed however late it comes: getting out is the point
        return on_sell(row)
    if row.get("wallet") not in copy_map():
        return
    if row.get("side") != "BUY":
        return
    # a buy that reaches us more than LATE_S after it happened isn't copied (2026-10-19: the backfill of a newly followed
    # profile; the live feed misses limit-order fills, so most alerts come from /activity, which can lag ~20 min). The
    # price limit (their price + slip) guards anything later than a few minutes; the skip is logged with its reason.
    late = None
    try:
        if row.get("traded_at"):
            late = (datetime.now(timezone.utc) - datetime.fromisoformat(row["traded_at"])).total_seconds()
    except Exception:
        pass
    if late is not None and late > LATE_S and not stale_ok:
        with _lock:
            rows = tickets()
            rows.append({"id": uuid.uuid4().hex[:10], "at": _now(), "asset": row["asset"], "title": row.get("title"),
                         "who": copy_map()[row["wallet"]], "outcome": row.get("outcome"), "his_price": row.get("price"),
                         "his_usd": row.get("usd"), "slug": row.get("slug"), "us": None, "status": "skip",
                         "why": f"reached the bot {round(late / 60)} min after they bet (Polymarket's feed was slow)",
                         "mode": cfg()["mode"]})
            _save(rows)
        return
    import copysim
    who = copy_map()[row["wallet"]]
    small = _their_total(row) < min_for(who)
    m = {} if small else match_sport(row.get("title"), row.get("slug"), row.get("outcome"))
    c = cfg()
    if mode:
        c = {**c, "mode": mode}
    with _lock:
        rows = tickets()
        prior = [t for t in rows if t["asset"] == row["asset"]]
        put = sum(t.get("cost") or 0 for t in prior if t.get("filled") and t.get("side", "BUY") == "BUY")
        u = copysim.usual(row["wallet"])
        theirs = _their_total(row)  # his whole stake on it so far: a skipped early buy is caught up on a later one
        want = min(c["stake"] * (theirs / u if u else 1), c["max_stake"]) - put
        floor = min_for(who)
        limit = math.floor(min(row["price"] + c["slip"], c["max_price"]) * 100 + 1e-9) / 100
        t = {"id": uuid.uuid4().hex[:10], "at": _now(), "asset": row["asset"], "title": row["title"], "who": who,
             "outcome": row["outcome"], "his_price": row["price"], "his_usd": row["usd"], "slug": row.get("slug"),
             "us": m.get("us"), "long": m.get("long"), "limit": limit, "want": round(max(want, 0), 2),
             "status": "skip", "why": m.get("why"), "mode": c["mode"], "add": bool(prior)}
        if theirs < floor:  # checked first: no US lookup for a bet that's too small to copy
            t["why"] = f"{who}'s ${theirs:,.0f} on it is under the ${floor:,.0f} you copy from"
        elif t["us"]:
            try:
                t["ask"] = ask_price(t["us"], t["long"])
            except Exception as e:
                t["ask"], t["why"] = None, f"couldn't read the US price: {str(e)[:80]}"
            if t["ask"] is None:
                t["why"] = t["why"] or "no one is selling it on the US market"
            elif row["price"] + c["slip"] > c["max_price"]:
                t["why"] = f"their {round(row['price'] * 100)}¢ is over your {round(c['max_price'] * 100)}¢ max"
            elif min(row["price"], t["ask"]) < c.get("min_price", 0):
                t["why"] = (f"{round(min(row['price'], t['ask']) * 100)}¢ is under your "
                            f"{round(c['min_price'] * 100)}¢ min (long shots aren't copied)")
            elif t["ask"] > limit:
                t["why"] = f"US price {round(t['ask'] * 100)}¢ is over their {round(row['price'] * 100)}¢ + {round(c['slip'] * 100)}¢"
            elif want < 1:
                t["why"] = (f"already {usd_(put)} in, the {usd_(c['max_stake'])} cap" if put >= c["max_stake"] - 1
                            else f"already {usd_(put)} in" if put else f"their ${theirs:,.0f} sizes to under $1")
            elif c["mode"] == "off":
                t["status"], t["why"] = "paper", "copying is off: recorded only"
            elif _today("n") >= c["per_day"]:
                t["why"] = f"already {c['per_day']} bets today"
            elif _today("usd") + want > c["max_day"]:
                t["why"] = f"over your {usd_(c['max_day'])} a day"
            else:
                t["status"], t["why"] = "ready", None
                t["expires"] = (datetime.now(timezone.utc) + timedelta(seconds=ASK_S)).isoformat(timespec="seconds")
        rows.append(t)
        _save(rows)
    if t["status"] == "ready" and not quiet:
        if c["mode"] == "auto":
            threading.Thread(target=_place_quiet, args=(t["id"],), daemon=True).start()
        else:
            import alerts as sportsalerts
            sportsalerts.post("poly", f"Copy {who}: {t['outcome']} {usd_(t['want'])} at {round(t['ask'] * 100)}¢",
                              f"{t['title']} · tap Place within 10 min", {"link": "p.poly", "kind": "poly"}, prefix="Polymarket US")


def usd_(x):
    return f"${x:,.2f}"


def _held(asset):
    """Your filled buys of this outcome not yet settled or sold."""
    return [t for t in tickets() if t["asset"] == asset and t.get("side", "BUY") == "BUY" and t["status"] == "filled"
            and t.get("result") is None]


def _sell_ticket(h, who, price, usd, mode):
    """A ready SELL ticket for the buy ticket h's outcome (None if one is already waiting or going)."""
    with _lock:
        rows = tickets()
        if any(t.get("side") == "SELL" and t["asset"] == h["asset"] and t["status"] in ("ready", "placing") for t in rows):
            return None
        t = {"id": uuid.uuid4().hex[:10], "at": _now(), "side": "SELL", "asset": h["asset"], "title": h["title"],
             "who": who, "outcome": h["outcome"], "his_price": price, "his_usd": usd, "us": h["us"],
             "long": h["long"], "status": "ready", "why": None, "mode": mode,
             "expires": (datetime.now(timezone.utc) + timedelta(seconds=ASK_S)).isoformat(timespec="seconds")}
        rows.append(t)
        _save(rows)
    return t


def sell_now(tid):
    """Your Sell button (asked 2026-10-18, like the stocks page's Alpaca sell): close that bet's whole US position now."""
    h = next((x for x in tickets() if x["id"] == tid), None)
    if not h or h.get("side", "BUY") != "BUY" or h["status"] != "filled" or h.get("result") is not None:
        raise ValueError("That bet isn't open.")
    t = _sell_ticket(h, "You", h.get("cur"), 0, "manual")
    if not t:
        raise ValueError("A sell for this bet is already going.")
    return sell(t["id"])


def _game_name(t):
    """"Commanders vs. 49ers" for a ticket: from a total's title, a moneyline's, else the US event's teams."""
    title = t.get("title") or ""
    if ":" in title and " vs" in title.split(":")[0]:
        return title.split(":")[0].strip()
    if " vs" in title and not title.startswith("Spread"):
        return title.strip()
    ev = t.get("us_event") or (polyprofiles.us_event(t["slug"], title) if t.get("slug") else None)
    if ev:
        try:
            e = _pub(f"/v1/events/slug/{ev}")
            e = e.get("event", e)
            names = [x.get("name") or "" for x in (e.get("teams") or [])]
            nick = lambda n: n.split()[-1] if n else ""  # noqa: E731  "Washington Commanders" -> "Commanders"
            if len(names) == 2 and all(names):
                return f"{nick(names[0])} vs. {nick(names[1])}"
            return (e.get("title") or ev).replace("  ", " ")
        except Exception:
            pass
    return title or "the"


def _announce(t):
    """The bot placed a bet (or a sell): an in-app alert with its own sound (kind poly_bot) and a phone push (ntfy /
    Telegram, whichever is set up in the phone panel; every bot order, not only big ones)."""
    sell_ = t.get("side") == "SELL"
    pick = polyprofiles.pick_label(t["title"], t["outcome"])
    title = f"{'Sold' if sell_ else 'Bought'} {pick} · {usd_(t.get('cost') or 0)}"
    text = (f"{t['shares']:g} at {round((t.get('price') or 0) * 100)}¢ on Polymarket US"
            + (f" · copying {t['who']}" if t.get("who") in names_all().values() else f" · {t['who'].lower()}" if t.get("who") else "")
            + f" · {t['title']}")
    try:
        import alerts as sportsalerts
        sportsalerts.post("poly_bot", title, text, {"link": "p.poly"}, prefix="Polymarket US")
    except Exception as e:
        print(f"[polyus] alert: {e}")
    try:
        import phonepush
        if phonepush.get().get("on"):
            # the bot's own pushes stand out (asked 2026-10-19): siren, ALL CAPS, one fact a line; other pushes unchanged
            # one sentence (asked 2026-10-19): "🚨 BOUGHT $18 OF UNDER 52.5 @ 52¢ FOR THE COMMANDERS VS. 49ERS GAME,
            # COPYING KCH-TEMP"
            who = t.get("who")
            line = (f"🚨 {'SOLD' if sell_ else 'BOUGHT'} ${round(t.get('cost') or 0):,} OF {pick.upper()} "
                    f"@ {round((t.get('price') or 0) * 100)}¢ FOR THE {_game_name(t).upper()} GAME")
            if sell_ and t.get("profit") is not None:  # a sale says what it made (asked 2026-10-19), not who
                p = t["profit"]
                line += f", {'PROFIT' if p >= 0 else 'LOSS'} {'+' if p >= 0 else '−'}${abs(p):,.2f}"
            elif who in names_all().values():
                line += f", COPYING {who.upper()}"
            phonepush.send("Polymarket US", line, click="https://polymarket.us/portfolio")
    except Exception as e:
        print(f"[polyus] push: {e}")


def on_sell(row):
    """They sold an outcome you hold: a sell ticket that closes the whole US position (Auto: at once; Ask: Place)."""
    c = cfg()
    held = _held(row.get("asset"))
    if not held or not c.get("follow_sells", True):
        return
    who = names_all()[row["wallet"]]
    t = _sell_ticket(held[0], who, row["price"], row["usd"], c["mode"])
    if not t:
        return
    if c["mode"] == "auto":
        threading.Thread(target=_place_quiet, args=(t["id"],), daemon=True).start()
    else:
        import alerts as sportsalerts
        sportsalerts.post("poly", f"{who} sold {t['outcome']}: sell yours?", f"{t['title']} · tap Place within 10 min",
                          {"link": "p.poly", "kind": "poly"}, prefix="Polymarket US")


def _fills(r, long):
    """(contracts, dollars on your side, fee) from an order response's executions (prices there are the YES price)."""
    n_ = cash = fee = 0.0
    for x in r.get("executions") or []:
        if x.get("type") in ("EXECUTION_TYPE_FILL", "EXECUTION_TYPE_PARTIAL_FILL"):
            n, p = float(x.get("lastShares") or 0), float((x.get("lastPx") or {}).get("value") or 0)
            n_ += n
            cash += n * (p if long else 1 - p)
            fee += float((x.get("commissionNotionalCollected") or {}).get("value") or 0)
    return n_, cash, fee


def _position(slug):
    return float((((_signed("GET", "/v1/portfolio/positions").get("positions") or {}).get(slug)) or {}).get("netPosition") or 0)


def sell(tid, auto=False):
    """Close the whole US position in a sell ticket's market; the proceeds are split over the buys it closes."""
    with _lock:
        t = next((x for x in tickets() if x["id"] == tid), None)
        if not t or t["status"] != "ready":
            raise ValueError("That sell isn't waiting to be placed.")
        _update(tid, status="placing")
    try:
        held = _position(t["us"])
        if not held:
            _update(tid, status="skip", why="nothing held on Polymarket US")
            for b in _held(t["asset"]):
                _update(b["id"], result="sold", pnl=round(-b["cost"] - b.get("fee", 0), 2), why="position gone on US")
            return
        m = _pub(f"/v1/markets/{t['us']}/bbo").get("marketData") or {}
        ref = (m.get("bestBid") if t["long"] else m.get("bestAsk")) or {}  # long sells into the YES bid; short buys YES back
        body = {"marketSlug": t["us"], "synchronousExecution": True, "maxBlockTime": "5",
                "manualOrderIndicator": "MANUAL_ORDER_INDICATOR_AUTOMATIC" if auto else "MANUAL_ORDER_INDICATOR_MANUAL"}
        if ref.get("value"):
            body["slippageTolerance"] = {"currentPrice": {"value": ref["value"], "currency": "USD"}, "ticks": 2}
        r = _signed("POST", "/v1/order/close-position", body)
    except Exception as e:
        cur = next((x for x in tickets() if x["id"] == tid), {})
        if cur.get("status") == "placing":
            _update(tid, status="error", why=str(e)[:200])
        raise
    n, cash, fee = _fills(r, t["long"])
    left = abs(_position(t["us"])) if n else abs(held)
    done = _update(tid, status="filled" if n else "skip", order_id=r.get("id"), shares=round(n, 2), cost=round(cash, 2),
                   fee=round(fee, 2), price=round(cash / n, 4) if n else None, placed_at=_now(), auto=auto,
                   why=None if n else "nothing sold within 2 ticks")
    if n:
        buys = _held(t["asset"])
        total = sum(b["shares"] - b.get("sold_shares", 0) for b in buys) or 1
        basis = 0.0  # what the shares sold cost you (their share of each buy's cost and fee)
        for b in buys:
            part = (b["shares"] - b.get("sold_shares", 0)) / total
            if b["shares"]:
                basis += (b["cost"] + b.get("fee", 0)) * (n * part) / b["shares"]
            kw = {"sold_shares": round(b.get("sold_shares", 0) + n * part, 4),
                  "sold_cash": round(b.get("sold_cash", 0) + (cash - fee) * part, 4)}
            if left < 0.01:
                kw.update(result="sold", pnl=round(kw["sold_cash"] - b["cost"] - b.get("fee", 0), 2))
            _update(b["id"], **kw)
        done = _update(tid, profit=round(cash - fee - basis, 2))  # the sell push says what it made
        _announce(done)
    return done


def _place_quiet(tid):
    try:
        t = next((x for x in tickets() if x["id"] == tid), {})
        (sell if t.get("side") == "SELL" else place)(tid, auto=True)
    except Exception as e:
        print(f"[polyus] auto place {tid}: {e}")
        t = next((x for x in tickets() if x["id"] == tid), {})
        if t.get("status") == "error":  # a price that moved is a skip, not news; a failed order is
            try:
                import alerts as sportsalerts
                import phonepush
                sportsalerts.post("poly_bot", f"Bot couldn't place {t.get('outcome')}", f"{t.get('title')} · {str(e)[:120]}",
                                  {"link": "p.poly"}, prefix="Polymarket US")
                if phonepush.get().get("on"):
                    phonepush.send("Polymarket US", f"🚨 COULDN'T BUY {(t.get('outcome') or '').upper()} FOR THE "
                                   f"{_game_name(t).upper()} GAME: {str(e)[:100]}")
            except Exception as e2:
                print(f"[polyus] alert: {e2}")


def place(tid, auto=False):
    """Buy a ready ticket: limit at his price + slip, immediate-or-cancel (fills what's there at or under it)."""
    if next((x for x in tickets() if x["id"] == tid), {}).get("side") == "SELL":
        return sell(tid, auto)
    with _lock:
        t = next((x for x in tickets() if x["id"] == tid), None)
        if not t or t["status"] != "ready":
            raise ValueError("That copy isn't waiting to be placed.")
        if datetime.fromisoformat(t["expires"]) < datetime.now(timezone.utc):
            _update(tid, status="skip", why="expired: not placed within 10 minutes")
            raise ValueError("Too late: that copy expired.")
        _update(tid, status="placing")
    try:
        c = cfg()
        ask = ask_price(t["us"], t["long"])
        if ask is None or ask > t["limit"]:
            _update(tid, status="skip", ask=ask, why=f"price moved to {round((ask or 1) * 100)}¢, over the {round(t['limit'] * 100)}¢ limit")
            raise ValueError("The price moved past the limit: not bought.")
        acct = account()
        stake = min(t["want"], acct["buying_power"])
        qty = math.floor(stake / t["limit"] * 100) / 100
        if qty < 1:
            _update(tid, status="skip", why=f"stake ${stake:.2f} buys under one contract")
            raise ValueError(f"Not enough buying power (${acct['buying_power']:.2f}).")
        yes = t["long"]
        # the price is always the YES price: buying NO at L is selling YES at 1 − L or better
        px = t["limit"] if yes else round(1 - t["limit"], 2)
        order = {"marketSlug": t["us"], "type": "ORDER_TYPE_LIMIT", "price": {"value": f"{px:.2f}", "currency": "USD"},
                 "quantity": qty, "tif": "TIME_IN_FORCE_IMMEDIATE_OR_CANCEL",
                 "intent": "ORDER_INTENT_BUY_LONG" if yes else "ORDER_INTENT_BUY_SHORT",
                 "manualOrderIndicator": "MANUAL_ORDER_INDICATOR_AUTOMATIC" if auto else "MANUAL_ORDER_INDICATOR_MANUAL",
                 "synchronousExecution": True, "maxBlockTime": "5"}
        r = _signed("POST", "/v1/orders", order)
    except Exception as e:
        cur = next((x for x in tickets() if x["id"] == tid), {})
        if cur.get("status") == "placing":
            _update(tid, status="error", why=str(e)[:200])
        raise
    shares = cost = fee = 0.0
    for x in r.get("executions") or []:
        if x.get("type") in ("EXECUTION_TYPE_FILL", "EXECUTION_TYPE_PARTIAL_FILL"):
            n, p = float(x.get("lastShares") or 0), float((x.get("lastPx") or {}).get("value") or 0)
            shares += n
            cost += n * (p if yes else 1 - p)
            fee += float((x.get("commissionNotionalCollected") or {}).get("value") or 0)
    done = _update(tid, status="filled" if shares else "skip", order_id=r.get("id"), qty=qty, shares=round(shares, 2),
                   cost=round(cost, 2), fee=round(fee, 2), price=round(cost / shares, 4) if shares else None,
                   placed_at=_now(), filled=shares > 0, auto=auto,
                   why=None if shares else "nothing filled at or under the limit")
    if shares:
        _announce(done)
    return done


def skip(tid):
    _update(tid, status="skip", why="you passed")


def _activities(pages=10):
    """Your Polymarket US account's activity (trades, resolutions, deposits), newest first."""
    out, cur = [], None
    for _ in range(pages):
        r = _signed("GET", "/v1/portfolio/activities" + (f"?cursor={cur}" if cur else ""))
        out += r.get("activities") or []
        cur = r.get("nextCursor")
        if r.get("eof") or not cur:
            break
    return out


def sync_manual_sells():
    """Sells you make yourself in the Polymarket US app (asked 2026-10-19: "i sold much earlier on some of these bets"),
    counted against the bot's tickets for that market and side the way the bot's own sells are: split across the
    open buys by the contracts each still holds. Without this a bet you sold early was settled as if held to the end
    (Under 52.5 showed +$16.11 when you sold it for +$4.13). Each sale is counted once (SEEN)."""
    if not keys():
        return
    try:
        acts = _activities()
    except Exception as e:
        print(f"[polyus] activities: {e}")
        return
    seen = set(_read(SEEN, []))
    with _lock:
        rows = tickets()
        bot_orders = {t.get("order_id") for t in rows if t.get("side") == "SELL" and t.get("order_id")}
        changed, new_seen = False, []
        for a in reversed(acts):  # oldest first
            tr = a.get("trade") if a.get("type") == "ACTIVITY_TYPE_TRADE" else None
            if not tr:
                continue
            ex = tr["aggressorExecution"] if tr.get("isAggressor", True) else tr.get("passiveExecution")
            o = (ex or {}).get("order") or {}
            if o.get("action") != "ORDER_ACTION_SELL" or ex["id"] in seen or o.get("id") in bot_orders:
                continue
            new_seen.append(ex["id"])
            long = o.get("outcomeSide") == "OUTCOME_SIDE_YES"
            n, p = float(ex.get("lastShares") or 0), float((ex.get("lastPx") or {}).get("value") or 0)
            cash = n * (p if long else 1 - p)
            fee = float((ex.get("commissionNotionalCollected") or {}).get("value") or 0)
            buys = [t for t in rows if t.get("us") == o.get("marketSlug") and bool(t.get("long")) == long
                    and t.get("status") == "filled" and t.get("side", "BUY") == "BUY"
                    and t["shares"] - t.get("sold_shares", 0) > 1e-6]
            total = sum(t["shares"] - t.get("sold_shares", 0) for t in buys)
            if not total:
                continue  # a position the bot didn't buy
            for t in buys:
                part = (t["shares"] - t.get("sold_shares", 0)) / total
                t["sold_shares"] = round(t.get("sold_shares", 0) + min(n, total) * part, 4)
                t["sold_cash"] = round(t.get("sold_cash", 0) + (cash - fee) * part, 4)
                t["sold_by_you"] = True
                if t["shares"] - t["sold_shares"] <= 0.01:  # all of it sold: that's the result, whatever the game did
                    t["result"], t["pnl"] = "sold", round(t["sold_cash"] - t["cost"] - t.get("fee", 0), 2)
                    t["why"] = "you sold it on Polymarket US"
                elif t.get("result") in ("won", "lost"):  # settled before this sale was seen: redo the P/L
                    win = t["result"] == "won"
                    t["pnl"] = round(((t["shares"] - t["sold_shares"]) if win else 0) + t["sold_cash"]
                                     - t["cost"] - t.get("fee", 0), 2)
            changed = True
        if changed:
            _save(rows)
    if new_seen:
        DIR.mkdir(parents=True, exist_ok=True)
        SEEN.write_text(json.dumps(sorted(seen | set(new_seen))))


def settle():
    """Filled copies (and paper ones) once the US market settles: 1 = YES won."""
    for t in tickets():
        if t["status"] not in ("filled", "paper") or t.get("result") is not None or not t.get("us") \
                or t.get("side") == "SELL":
            continue
        try:
            s = _pub(f"/v1/markets/{t['us']}/settlement").get("settlement")
        except Exception:
            continue
        if s is None:
            continue
        win = (float(s) >= 0.5) == t.get("long", t["outcome"] == "Yes")
        kw = {"result": "won" if win else "lost"}
        if t["status"] == "filled":
            kw["pnl"] = round(((t["shares"] - t.get("sold_shares", 0)) if win else 0) + t.get("sold_cash", 0)
                              - t["cost"] - t.get("fee", 0), 2)
        else:  # paper: the sized copy at the ask then, less the fee
            p, a = t.get("ask") or t["limit"], t.get("want") or 10
            kw["pnl"] = round(a / p * (1 if win else 0) - a - a / p * 0.0695 * p * (1 - p), 2)
        _update(t["id"], **kw)


# ---- take profit (asked 2026-10-18: "we should have like an auto sell at 85 90 100%") ---------------------------
# research/takeprofit.py on their past bets, sized like theirs: Kch-Temp hold +30.5%, sell at +85% +31.4%, +90% +30.8%,
# +100% +33.5% (about even); primm hold −1.1%, +85% −6.0%, +100% −4.7% (worse). Off by default; the user turns it on.
TP_S = 15


def _gain(t, bid):
    """Your gain if the rest sold at bid now: (what sold already + this sale, less the fee) / what you paid, minus 1."""
    left = t["shares"] - t.get("sold_shares", 0)
    paid = t["cost"] + t.get("fee", 0)
    got = t.get("sold_cash", 0) + left * bid - left * 0.0695 * bid * (1 - bid)
    return got / paid - 1 if paid else 0


def tp_for(c, who):
    """This bet's auto-sell level: its person's, else the general one (0 = hold)."""
    per = next((p for p in (c.get("people") or []) if p["name"] == who), None)
    if per is not None:
        return float(per.get("take_profit") or 0)
    by = c.get("take_profit_by") or {}
    return by[who] if who in by else (c.get("take_profit") or 0)


def take_profits():
    c = cfg()
    if not keys() or not (c.get("take_profit") or any((c.get("take_profit_by") or {}).values())
                          or any(p.get("take_profit") for p in (c.get("people") or []))):
        return
    busy = {t["asset"] for t in tickets() if t.get("side") == "SELL" and t["status"] in ("ready", "placing")}
    for t in tickets():
        tp = tp_for(c, t.get("who"))
        if (not tp or t["status"] != "filled" or t.get("side", "BUY") != "BUY" or t.get("result") is not None
                or not t.get("us") or t["asset"] in busy):
            continue
        try:
            m = _pub(f"/v1/markets/{t['us']}/bbo").get("marketData") or {}
            bid = (m.get("bestBid") or {}).get("value") if t["long"] else (m.get("bestAsk") or {}).get("value")
            if not bid:
                continue
            bid = float(bid) if t["long"] else 1 - float(bid)  # what your side sells for now
            g = _gain(t, bid)
            if g < tp:
                continue
            s = _sell_ticket(t, "Take profit", bid, 0, "auto")
            if s:
                _update(s["id"], why=f"up {g:+.0%} at {round(bid * 100)}¢ (your take profit is +{tp:.0%})")
                busy.add(t["asset"])
                sell(s["id"], auto=True)
        except Exception as e:
            print(f"[polyus] take profit {t['id']}: {e}")


def _tp_loop():
    while True:
        try:
            take_profits()
        except Exception as e:
            print(f"[polyus] take profit: {e}")
        time.sleep(TP_S)


def _loop():
    while True:
        try:
            sync_manual_sells()
            settle()
            now = datetime.now(timezone.utc)
            for t in tickets():
                if t["status"] == "ready" and datetime.fromisoformat(t["expires"]) < now:
                    _update(t["id"], status="skip", why="expired: not placed within 10 minutes")
        except Exception as e:
            print(f"[polyus] settle: {e}")
        time.sleep(SETTLE_S)


def start():
    global _started
    if not _started:
        _started = True
        threading.Thread(target=_loop, daemon=True, name="polyus").start()
        threading.Thread(target=_tp_loop, daemon=True, name="polyus-tp").start()


# research/takeprofit.py (2026-10-18): copying their settled bets, ROI sized like theirs. Holding to the result vs the
# best take-profit level tried (10-100%); every level was worse than holding for both.
TP_TEST = {"Kch-Temp": {"n": 201, "hold": 0.305, "tp": 0.067, "tp_at": "+25%", "best_tp": 0.218, "best_at": "+60%"},
           # his $10K+ bets only (what's copied): research/primm_big_tp.py
           "primm": {"n": 72, "hold": 0.196, "tp": 0.012, "tp_at": "+25%", "best_tp": 0.148, "best_at": "+150%"}}


def _advice(t, sell_px):
    """Sell now or hold, from the data: what selling gets you (the US bid on your side, less the fee) vs what holding
    is worth at the fair price (.com's live price: the bigger market), whether they still hold it, and the
    take-profit test on their past bets."""
    left = t["shares"] - t.get("sold_shares", 0)
    fair_src = ".com"
    fair = polyprofiles.live_prices([t["asset"]]).get(t["asset"]) if not str(t["asset"]).startswith("test-") else None
    if fair is None:
        fair, fair_src = t["cur"], "the US midpoint"
    sell_now = left * sell_px - left * 0.0695 * sell_px * (1 - sell_px)
    hold = left * fair
    paid = t["cost"] + t.get("fee", 0)
    w = next((k for k, v in names_all().items() if v == t.get("who")), None)
    theirs = ((polyprofiles._held.get(w) or {}).get(t["asset"]) or {}).get("status") if w else None
    lines = [f"Sell now: about {usd_(sell_now)} ({round(sell_px * 100)}¢ bid, less the fee), "
             f"{'+' if sell_now >= paid else '−'}{usd_(abs(sell_now - paid))} on the {usd_(paid)} you paid.",
             f"Hold: worth about {usd_(hold)} on average ({fair_src} prices it at {round(fair * 100)}¢); "
             f"pays {usd_(left)} if it wins, $0 if it loses."]
    if theirs == "open":
        lines.append(f"{t['who']} still holds it (the bot sells when they do).")
    elif theirs in ("sold", "won", "lost"):
        lines.append(f"{t['who']} is out of it ({theirs}).")
    tp = TP_TEST.get(t.get("who"))
    if tp:
        lines.append(f"On {tp['n']:,} of {t['who']}'s past bets, holding returned {tp['hold']:+.1%}; selling at "
                     f"{tp['tp_at']} returned {tp['tp']:+.1%} (best take-profit, {tp['best_at']}: {tp['best_tp']:+.1%}).")
    tp_on = tp_for(cfg(), t.get("who"))
    if tp_on:
        lines.append(f"Take profit is on: it sells by itself at +{tp_on:.0%} (now {(sell_now / paid - 1) if paid else 0:+.0%}).")
    if theirs in ("sold",):
        verdict, why = "sell", "they've sold"
    elif sell_now > hold:
        verdict, why = "sell", "US pays more than it's worth right now"
    else:
        verdict = "hold"
        why = (f"selling costs about {usd_(hold - sell_now)} vs holding's average"
               + (", and early selling did worse on their past bets" if tp else ""))
    return {"verdict": verdict, "why": why, "lines": lines}


_events_state = {}  # US event slug -> (time, still open?)


def _open_event(slug):
    hit = _events_state.get(slug)
    if hit and time.time() - hit[0] < 60:
        return hit[1]
    try:
        e = _pub(f"/v1/events/slug/{slug}")
        e = e.get("event", e)
        ok = not (e.get("ended") or e.get("closed") or e.get("finishedTimestamp"))
    except Exception:
        ok = False
    _events_state[slug] = (time.time(), ok)
    return ok


def summary():
    out = {"ok": True, "keys": bool(keys()), "cfg": cfg(), "account": None, "account_error": None}
    if out["keys"]:
        try:
            out["account"] = account()
        except Exception as e:
            out["account_error"] = str(e)[:200]
    rows = tickets()
    real = [t for t in rows if t["status"] == "filled" and t.get("side", "BUY") == "BUY"]
    paper = [t for t in rows if t["status"] == "paper"]

    def rec(xs):
        done = [t for t in xs if t.get("result")]
        return {"w": sum(t["result"] == "won" for t in done), "l": sum(t["result"] == "lost" for t in done),
                "open": len(xs) - len(done), "pnl": round(sum(t.get("pnl") or 0 for t in done), 2),
                "staked": round(sum(t.get("cost") or t.get("want") or 10 for t in done), 2)}
    for t in rows:  # your open copies at today's US price (the midpoint on your side), with sell-or-hold advice
        if t["status"] == "filled" and t.get("side", "BUY") == "BUY" and t.get("result") is None and t.get("us"):
            try:
                m = _pub(f"/v1/markets/{t['us']}/bbo").get("marketData") or {}
                bid, ask = (m.get("bestBid") or {}).get("value"), (m.get("bestAsk") or {}).get("value")
                if bid and ask:
                    bid, ask = float(bid), float(ask)
                    mid = (bid + ask) / 2
                    t["cur"] = round(mid if t["long"] else 1 - mid, 4)
                    t["value"] = round((t["shares"] - t.get("sold_shares", 0)) * t["cur"], 2)
                    t["advice"] = _advice(t, bid if t["long"] else 1 - ask)
            except Exception as e:
                print(f"[polyus] advice: {e}")
    for t in rows[-500:]:  # the US game page for each (the event slug, cached in polyprofiles)
        if t.get("slug") and "us_event" not in t:
            try:
                t["us_event"] = polyprofiles.us_event(t["slug"], t.get("title", ""))
            except Exception:
                pass
    # Copy now only while the game isn't over (asked 2026-10-18): skipped buys from the last 2 days, their US event's
    # state (ended / closed), cached a minute
    cut = datetime.now(timezone.utc) - timedelta(days=2)
    for t in rows[-500:]:
        if (t["status"] in ("skip", "error", "paper") and t.get("side", "BUY") == "BUY" and t.get("us_event")
                and datetime.fromisoformat(t["at"]) > cut):
            # only a skip that went wrong (no match found, an error), not one your rules made (too small, over your
            # limits, the price moved)
            ruled = re.search(r"you copy from|sizes to under|already|over your|bets today|a day|is over their|"
                              r"price moved|max|not copied|no .* (spread|total|moneyline)|draw market|bucket",
                              t.get("why") or "")
            t["copyable"] = not ruled and _open_event(t["us_event"]) and not any(
                x["asset"] == t["asset"] and x["status"] == "filled" and x.get("side", "BUY") == "BUY" for x in rows)
    out.update(tickets=rows[-500:][::-1], real=rec(real), paper=rec(paper), today=_bought_today(),
               today_usd=round(_today("usd"), 2), people=list(copy_map().values()),
               copy_people=people(),
               followed=[{"wallet": p["wallet"], "name": p["name"]} for p in polyprofiles.profiles()
                         if p["wallet"] not in {r["wallet"] for r in people()}],
               # everyone followed, for the Phone alerts panel in Bot settings (asked 2026-10-19)
               phone_people=[{"wallet": p["wallet"], "name": p["name"], "phone_min": p.get("phone_min"),
                              "phone_off": p.get("phone_off", False)} for p in polyprofiles.profiles()])
    return out
