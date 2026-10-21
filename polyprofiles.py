"""Polymarket profiles you follow (asked 2026-10-16, starting with kch-temp): their record, open bets and activity,
and a live alert the moment one of them places a bet.

  profiles   data/polymarket/profiles.json = [{handle, wallet, name, added_at, alerts}]. Added by profile link
             (polymarket.com/@kch-temp), @handle or 0x wallet; a handle is found with Gamma's profile search.
  best()     Best Bets: the same outcome bet by two or more followed profiles (open, and how past ones graded); a new
             live bet on an outcome another followed profile holds open also alerts as a Best bet.
  summary()  per profile, from Polymarket's public data API (no key): all-time P/L, volume and rank (leaderboard),
             open positions, the record (every settled market: closed-positions, plus the redeemable positions still
             held, which are the losers since a loser is never redeemed) by sport and market type, and the last 500
             activity rows with a bet's fills merged into one row (kch-temp buys one bet as dozens of 5-share fills).
  live       one thread reads Polymarket's live-data WebSocket (wss://ws-live-data.polymarket.com, topic activity /
             trades): every trade on the site, with the trader's wallet. A followed wallet's fills are gathered per
             outcome and side until they go quiet (QUIET seconds, or MAX_WAIT from the first), then posted as one
             alert (Chrome / Mac notification via sportsalerts.post). Backstop: every POLL seconds each wallet's
             /activity is read and any fill the stream didn't deliver is alerted the same way (via = "poll"), so a
             dropped connection only delays an alert. The first poll after a start only records what's there.
             A bet of the phone threshold or more is also pushed to the phone (phonepush.py, the ntfy app).
"""
import base64
import json
import os
import re
import socket
import threading
import time
import urllib.parse
import urllib.request
import uuid
from concurrent.futures import ThreadPoolExecutor
from collections import defaultdict
from datetime import datetime, timedelta, timezone

import config
import sources

DIR = config.DATA / "polymarket"
PROFILES = DIR / "profiles.json"
LIVE = DIR / "live_bets.json"  # the bets the alerts were about, newest last (the page's Live list)
DATA_API = "https://data-api.polymarket.com"
GAMMA = "https://gamma-api.polymarket.com"
WS = ("ws-live-data.polymarket.com", "/")
QUIET, MAX_WAIT, POLL = 45, 240, 30  # POLL 120 -> 30 (2026-10-19): the live feed misses limit-order fills, so the poll is the main source
MIN_USD = 25  # a bet under this isn't worth a notification
CACHE_S = 120
FAIL_S = 120  # a failed read (Polymarket's rate limit, mostly) isn't retried by every page refresh
SETTLED_S = 900  # the settled history only grows: re-read every 15 minutes

_lock = threading.Lock()
_cache = {}
_status = {"connected": False, "since": None, "error": None, "seen": 0, "matched": 0}
_pending = {}  # (wallet, asset, side) -> the fills so far
_seen = {}  # (tx, asset) -> time: fills already counted (the stream and the poll both see them)
_started = False

SPORT = {
    "nfl": "NFL", "cfb": "College football", "nba": "NBA", "cbb": "College basketball", "wnba": "WNBA",
    "mlb": "MLB", "nhl": "NHL", "fifwc": "World Cup", "ucl": "Champions League", "uel": "Europa League",
    "epl": "Premier League", "lal": "La Liga", "bun": "Bundesliga", "sea": "Serie A", "fl1": "Ligue 1",
    "mls": "MLS", "atp": "Tennis", "wta": "Tennis", "ufc": "UFC", "cs2": "Counter-Strike", "lol": "LoL",
    "dota2": "Dota 2", "val": "Valorant", "btc": "Crypto", "eth": "Crypto", "sol": "Crypto", "xrp": "Crypto",
    "f1": "F1", "es2": "Other soccer", "elc": "Other soccer", "swe": "Other soccer", "kor": "Other soccer",
    "den": "Other soccer", "fin1": "Other soccer", "nor": "Other soccer", "ned": "Other soccer",
    "por": "Other soccer", "bra": "Other soccer", "arg": "Other soccer", "jpn": "Other soccer",
    "bl2": "Other soccer", "mex": "Other soccer", "ned2": "Other soccer", "ere": "Other soccer",
}


def _read(p, default):
    try:
        return json.loads(p.read_text())
    except Exception:
        return default


_gate = threading.BoundedSemaphore(8)  # Polymarket answers 429 to a burst: at most 8 reads in flight, all profiles


def _get(path, base=DATA_API, timeout=20, tries=5):
    """A public API read, retried: the history pages go out 10 at a time and one can hit a rate limit or time out.
    A 429 waits longer each time (2, 4, 8, 16s, or what Retry-After asks)."""
    for i in range(tries):
        try:
            with _gate:
                raw, _ = sources._get(f"{base}{path}", timeout=timeout)
            return json.loads(raw)
        except Exception as e:
            if i == tries - 1:
                raise
            wait = 1 + 2 * i
            if getattr(e, "code", None) == 429:
                after = (getattr(e, "headers", None) or {}).get("Retry-After")
                wait = float(after) if after and str(after).isdigit() else 2 ** (i + 1)
            time.sleep(wait)


def profiles():
    return _read(PROFILES, [])


def _save(rows):
    DIR.mkdir(parents=True, exist_ok=True)
    PROFILES.write_text(json.dumps(rows, indent=1))
    _cache.clear()


# ---- adding ---------------------------------------------------------------------------------------------------
def _parse(text):
    """'https://polymarket.com/@kch-temp?tab=activity' / '@kch-temp' / 'kch-temp' / '0x...' -> (handle, wallet)."""
    t = (text or "").strip()
    if not t:
        raise ValueError("Paste a Polymarket profile link, @handle or wallet.")
    if "polymarket.com" in t:
        path = urllib.parse.urlparse(t if "://" in t else "https://" + t).path.strip("/")
        part = path.split("/")[-1] if path else ""
        if part.startswith("@"):
            return part[1:], None
        if part.lower().startswith("0x"):
            return None, part.lower()
        raise ValueError("That link isn't a profile (it should look like polymarket.com/@name).")
    t = t.lstrip("@")
    if t.lower().startswith("0x") and len(t) == 42:
        return None, t.lower()
    if " " in t or len(t) > 60:
        raise ValueError("Paste a Polymarket profile link, @handle or wallet.")
    return t, None


def add(text):
    handle, wallet = _parse(text)
    name = handle
    if wallet is None:
        q = urllib.parse.urlencode({"q": handle, "search_profiles": "true", "limit_per_type": 10})
        found = _get(f"/public-search?{q}", base=GAMMA).get("profiles") or []
        hit = next((p for p in found if (p.get("name") or "").lower() == handle.lower()), None)
        if not hit or not hit.get("proxyWallet"):
            raise ValueError(f"No Polymarket profile named @{handle}.")
        wallet, name = hit["proxyWallet"].lower(), hit.get("name") or handle
    else:
        act = _get(f"/activity?user={wallet}&limit=1")
        name = (act[0].get("name") if act else None) or wallet[:8]
    rows = profiles()
    if any(r["wallet"] == wallet for r in rows):
        raise ValueError(f"@{name} is already on the list.")
    row = {"handle": (handle or name), "wallet": wallet, "name": name,
           "added_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "alerts": True}
    _save(rows + [row])
    _poll_one(row, quiet=True)  # what they've already done isn't news
    return row


def remove(wallet):
    """Unfollow, and drop what was kept about them (asked 2026-10-19): their rows in the trader feed, the cached
    profile / bets / settled history, and the saved closed-position history (re-read if you follow them again).
    The bot's own tickets copied from them stay: that's your money."""
    _save([r for r in profiles() if r["wallet"] != wallet])
    with _lock:
        LIVE.write_text(json.dumps([r for r in _read(LIVE, []) if r.get("wallet") != wallet]))
    for d in (_cache, _held, _closed, _settled_rows):
        d.pop(wallet, None)
    try:
        (DIR / "closed" / f"{wallet}.json").unlink(missing_ok=True)
    except OSError as e:
        print(f"[polyprofiles] remove {wallet}: {e}")


def set_alerts(wallet, on):
    rows = profiles()
    for r in rows:
        if r["wallet"] == wallet:
            r["alerts"] = bool(on)
    _save(rows)


def set_phone_on(wallet, on):
    """This person's phone pushes on or off (2026-10-18: primm only, from $500)."""
    rows = profiles()
    for r in rows:
        if r["wallet"] == wallet:
            r["phone_off"] = not on
    _save(rows)


def set_phone_min(wallet, usd):
    """This person's phone-push threshold (phonepush.py); None = the default one."""
    rows = profiles()
    for r in rows:
        if r["wallet"] == wallet:
            r["phone_min"] = None if usd in (None, "") else round(max(0.0, float(usd)), 2)
    _save(rows)


# ---- the page -------------------------------------------------------------------------------------------------
def pick_label(title, outcome):
    """What the bet actually is (web/src/lib/polybet.ts pickLabel, same rules): "Spread: Washington (-4.5)" + "Purdue"
    is "Purdue +4.5" (a wrong-side buy on 2026-10-16 came from reading the title), totals "Over 61.5", "Will X win"
    "X to win" / "X not to win", "A vs. B: Both Teams to Score" + No "Both Teams to Score: No", "A vs. B" + A "A to win"."""
    t, o = title or "", (outcome or "").strip()
    m = re.search(r"Spread:\s*(.+?)\s*\(([-+]?\d+(?:\.\d+)?)\)", t, re.I)
    if m:
        fav, n = m.group(1), abs(float(m.group(2)))
        prefix = t[:m.start()].strip()
        same = o.lower() == fav.lower()
        return f"{prefix + ' ' if prefix else ''}{fav if same else o} {'−' if same else '+'}{n:g}"
    m = re.search(r"O/U\s*(\d+(?:\.\d+)?)", t, re.I)
    if m and o.lower() in ("over", "under"):
        return f"{o} {m.group(1)}"
    m = re.search(r"(highest|lowest) temperature in (.+?) be (?:between )?(.+?) on ", t, re.I)
    if m and o.lower() in ("yes", "no"):
        return f"{m.group(2)} {'high' if m.group(1).lower().startswith('high') else 'low'} {'not ' if o.lower() == 'no' else ''}{m.group(3)}"
    m = re.match(r"Will (.+?) win\b", t, re.I)
    if m and o.lower() in ("yes", "no"):
        return f"{m.group(1)} {'to win' if o.lower() == 'yes' else 'not to win'}"
    m = re.search(r" vs\.? .+?:\s*(.+)$", t, re.I)
    if m and o.lower() in ("yes", "no"):
        return f"{m.group(1)}: {o}"
    if re.search(r" vs\.? ", t, re.I) and ":" not in t and o.lower() not in ("yes", "no", "draw"):
        return f"{o} to win"
    return o


US_GATEWAY = "https://gateway.polymarket.us"
US_EVENTS = DIR / "us_events.json"  # polymarket.com event slug -> polymarket.us event slug (null: none found), kept
US_PREFIX = {"fifwc": "fwc", "fl1": "lg1"}  # league codes the two sites spell differently
US_MISS_S = 6 * 3600  # an event not found is looked for again after this (the US site lists games later)
_us = {}


def _us_exists(slug):
    try:
        raw, _ = sources._get(f"{US_GATEWAY}/v1/events/slug/{urllib.parse.quote(slug)}", timeout=10)
        return bool(json.loads(raw))
    except Exception:
        return False


def us_event(slug, title=""):
    """The polymarket.us event for a polymarket.com one (asked 2026-10-16: links should open .us, where the user
    trades). Same slug for most sports games; .com's "-more-markets" pages (spreads, totals) are the main event on .us,
    and a few league codes differ (US_PREFIX). Failing those, the US search for the title's teams, on the same date.
    Kept in US_EVENTS: a found event for good, a miss for US_MISS_S."""
    if not _us:
        _us.update({k: v for k, v in _read(US_EVENTS, {}).items() if v.get("us")})  # misses re-checked after a restart
    hit = _us.get(slug)
    if hit and (hit.get("us") or time.time() - hit.get("at", 0) < US_MISS_S):
        return hit.get("us")
    base = re.sub(r"-more-markets$", "", slug or "")
    pre = base.split("-")[0]
    tries = [base] + ([US_PREFIX[pre] + base[len(pre):]] if pre in US_PREFIX else [])
    # .com dates a game by UTC, .us by Eastern time: a night game (8:20 PM ET = 00:20Z) is a day apart (2026-10-18:
    # .com nfl-dal-gb-2026-10-19 is .us nfl-dal-gb-2026-10-18, and primm's $20K Packers bet went uncopied)
    day = re.search(r"\d{4}-\d{2}-\d{2}", base)
    days = []
    if day:
        d0 = datetime.fromisoformat(day.group(0))
        days = [(d0 + timedelta(days=k)).date().isoformat() for k in (-1, 1)]
        tries += [t.replace(day.group(0), d) for t in list(tries) for d in days]
    found = next((t for t in tries if t and _us_exists(t)), None)
    if not found and title:
        q = re.sub(r"^.*?Spread:\s*|\(.*?\)|:.*$|^Will\s+|\s+win\b.*$", " ", title).strip()
        try:
            raw, _ = sources._get(f"{US_GATEWAY}/v1/search?query={urllib.parse.quote(q)}", timeout=10)
            for e in json.loads(raw).get("events") or []:
                if day and any(d in (e.get("slug") or "") for d in [day.group(0)] + days):
                    found = e["slug"]
                    break
        except Exception:
            pass
    _us[slug] = {"us": found, "at": time.time()}
    DIR.mkdir(parents=True, exist_ok=True)
    US_EVENTS.write_text(json.dumps(_us))
    return found


def _sport(slug):
    s = (slug or "").lower()
    if "temperature" in s or "precipitation" in s or "hurricane" in s:
        return "Weather"
    if "updown" in s or "up-or-down" in s or "bitcoin" in s or "ethereum" in s:
        return "Crypto"
    pre = s.split("-")[0]
    return SPORT.get(pre, "Other")  # smaller leagues' codes (IRL1, FR2, JAP...) read as noise one by one


def _kind(slug, title):
    s, t = (slug or "").lower(), (title or "").lower()
    if "player-props" in s:
        return "Player prop"
    if "halftime" in s or "at halftime" in t:
        return "Halftime"
    if "exact-score" in s or t.startswith("exact score"):
        return "Exact score"
    if "spread" in s or t.startswith("spread"):
        return "Spread"
    if "total" in s or "o/u" in t:
        return "Total"
    if "btts" in s or "both teams" in t:
        return "Both score"
    if "temperature" in s:
        return "Temperature"
    if "updown" in s or "up or down" in t:
        return "Up or down"
    if " vs" in t or t.startswith("will ") and " win" in t:
        return "Moneyline"
    return "Other"


def _pages(path, size=50, cap=100000, batch=10):
    """Every page of a list endpoint. Pages are 50 rows at most whatever limit is asked, and a busy trader has
    thousands of settled markets, so pages are read 10 at a time until a short one."""
    out = []
    with ThreadPoolExecutor(batch) as ex:
        for start in range(0, cap, size * batch):
            pages = list(ex.map(lambda off: _get(f"{path}&limit={size}&offset={off}"),
                                range(start, start + size * batch, size)))
            for rows in pages:
                if not isinstance(rows, list):
                    raise ValueError(f"Polymarket: {rows}")
                out += rows
                if len(rows) < size:
                    return out
    return out


_closed = {}  # wallet -> (time, closed positions)
HIST = DIR / "closed"  # <wallet>.json = {"rows": [closed positions], "complete": bool}: the settled history, kept
_filling = set()  # wallets whose first full read is running in the background
_hist_lock = threading.Lock()
OVERLAP_S = 3 * 86400  # a refresh re-reads this far behind the newest saved row (a position's row can still change)


def _save_hist(wallet, rows, complete):
    HIST.mkdir(parents=True, exist_ok=True)
    tmp = HIST / f"{wallet}.json.tmp"
    tmp.write_text(json.dumps({"rows": rows, "complete": complete}))
    tmp.replace(HIST / f"{wallet}.json")


def _fill_history(wallet):
    """First read of a profile's whole settled history (thousands of pages for a bot-sized trader), newest first, in
    the background so the page isn't held up; then saved, so it's never read whole again."""
    try:
        rows = _pages(f"/closed-positions?user={wallet}&sortBy=TIMESTAMP&sortDirection=DESC")
        _save_hist(wallet, rows, True)
        with _hist_lock:
            _closed[wallet] = (time.time(), rows)
    except Exception as e:
        print(f"[polyprofiles] history {wallet[:10]}: {e}")
    finally:
        _filling.discard(wallet)
        _cache.pop(wallet, None)  # the next page refresh shows the whole record


def _history(wallet):
    """(closed positions, complete). Saved history plus a newest-first read down to it, every SETTLED_S; a profile
    with no saved history gets its full read started in the background (complete=False until it lands)."""
    hit = _closed.get(wallet)
    if hit and time.time() - hit[0] < SETTLED_S:
        return hit[1], True
    saved = _read(HIST / f"{wallet}.json", None)
    if not saved or not saved.get("complete"):
        if wallet not in _filling:
            _filling.add(wallet)
            threading.Thread(target=_fill_history, args=(wallet,), daemon=True).start()
        return (hit[1] if hit else []), False
    rows = saved["rows"]
    newest = max((r.get("timestamp") or 0 for r in rows), default=0)
    fresh, off = [], 0
    while True:  # pages of 50, newest first, until one reaches back past what's saved
        page = _get(f"/closed-positions?user={wallet}&sortBy=TIMESTAMP&sortDirection=DESC&limit=50&offset={off}")
        fresh += page
        if len(page) < 50 or min((r.get("timestamp") or 0 for r in page), default=0) < newest - OVERLAP_S:
            break
        off += 50
    seen = {(r.get("asset"), r.get("conditionId")) for r in fresh}
    rows = fresh + [r for r in rows if (r.get("asset"), r.get("conditionId")) not in seen]
    _save_hist(wallet, rows, True)
    with _hist_lock:
        _closed[wallet] = (time.time(), rows)
    return rows, True


def _settled(wallet, positions):
    """Every settled market: (pnl, cost, won, slug, title, outcome, avg_price, at), and whether the history is all in."""
    out = []
    closed, complete = _history(wallet)
    for c in closed:
        cost = (c.get("avgPrice") or 0) * (c.get("totalBought") or 0)
        out.append({"pnl": c.get("realizedPnl") or 0, "cost": cost, "won": (c.get("realizedPnl") or 0) > 0,
                    "slug": c.get("eventSlug") or c.get("slug"), "title": c.get("title"), "outcome": c.get("outcome"),
                    "price": c.get("avgPrice"), "at": c.get("timestamp"), "end": c.get("endDate")})
    for p in positions:
        if not p.get("redeemable"):
            continue
        out.append({"pnl": p.get("cashPnl") or 0, "cost": p.get("initialValue") or 0, "won": (p.get("curPrice") or 0) >= 0.5,
                    "slug": p.get("eventSlug") or p.get("slug"), "title": p.get("title"), "outcome": p.get("outcome"),
                    "price": p.get("avgPrice"), "at": None, "end": p.get("endDate")})
    return out, complete


_held = {}  # wallet -> {asset: bet}: every outcome a profile ever bet, for Best Bets


def _bets(wallet, positions):
    """Every outcome this wallet bet, by outcome token: open positions, unredeemed settled ones and the closed history
    (complete, unlike the activity feed). status: open / won / lost / sold (closed before the result)."""
    out = {}
    for c in (_closed.get(wallet) or (0, []))[1]:
        cur = c.get("curPrice")
        out[c.get("asset")] = {"asset": c.get("asset"), "cond": c.get("conditionId"), "title": c.get("title"),
                               "outcome": c.get("outcome"), "slug": c.get("eventSlug") or c.get("slug"), "icon": c.get("icon"),
                               "avg": c.get("avgPrice"), "cost": (c.get("avgPrice") or 0) * (c.get("totalBought") or 0),
                               "pnl": c.get("realizedPnl") or 0, "cur": cur, "end": c.get("endDate"), "at": c.get("timestamp"),
                               "status": "won" if cur is not None and cur >= 0.99 else "lost" if cur is not None and cur <= 0.01 else "sold"}
    for x in positions:
        cur = x.get("curPrice")
        out[x.get("asset")] = {"asset": x.get("asset"), "cond": x.get("conditionId"), "title": x.get("title"),
                               "outcome": x.get("outcome"), "slug": x.get("eventSlug") or x.get("slug"), "icon": x.get("icon"),
                               "avg": x.get("avgPrice"), "cost": x.get("initialValue") or 0, "pnl": x.get("cashPnl") or 0,
                               "cur": cur, "end": x.get("endDate"), "at": None,
                               "status": "open" if not x.get("redeemable") else "won" if (cur or 0) >= 0.5 else "lost"}
    return {a: b for a, b in out.items() if a and b["cost"] >= MIN_USD}


TAKE_DAYS = 3  # "Take now": his buy in the last 3 days
TAKE_MOVE = 0.05  # and today's price within 5¢ of his average either way (a bigger drop is the game moving, not a sale)
TAKE_MIN = 15  # a group needs this many settled bets to count toward the score
TAKE_SHRINK = 40  # a group of n bets counts n / (n + 40) of its copy return (20 bets: a third)


def _copy_groups(rows):
    """(dim, name) -> [bets, summed per-bet return] over his settled bets, for the groups take_now() scores with."""
    g = defaultdict(lambda: [0, 0.0])
    for r in rows:
        if not r["cost"]:
            continue
        sport, kind = _sport(r["slug"]), _kind(r["slug"], r["title"])
        for k in (("combo", f"{sport} · {kind}"), ("sport", sport), ("size", SIZES[_bucket(r["cost"], SIZES)][1]),
                  ("price", PRICES[_bucket(r["price"] or 0, PRICES)][1])):
            g[k][0] += 1
            g[k][1] += r["pnl"] / r["cost"]
    return g


def take_now():
    """Best bets to take, from what they just did (asked 2026-10-16): every followed profile's buy in the last
    TAKE_DAYS that's still open and still near his price, scored by how HIS settled bets of the same kind did if
    copied flat. Groups: sport + market (or the sport, when that combo has under TAKE_MIN bets), his bet size, his
    entry price; each group's copy return is shrunk by its size and the score is their mean. `now` is the score at
    today's price instead of his (a share still pays $1, so paying more earns less). Newest-scored first.
    Someone the real-money bot copies only shows bets at or over his floor there (asked 2026-10-19: a $5.9K
    ArielFilipino bet showed +9% while his under-$10K copies ran -6% to -17%): the floor is the measured rule, and
    the averaged groups here would otherwise water it down."""
    import polyus
    floors = {x["wallet"]: float(x.get("min_usd") or 0) for x in polyus.people() if x.get("on", True)}
    out = []
    now = time.time()
    for p in profiles():
        w = p["wallet"]
        floor = floors.get(w, 0.0)
        hit, rows = _cache.get(w), _settled_rows.get(w)
        if not hit or rows is None:
            continue
        groups = _copy_groups(rows)
        bought = {}  # (title, outcome) -> his latest buy time
        for a in hit[1].get("activity") or []:
            if a["type"] == "TRADE" and a["side"] == "BUY":
                k = (a["title"], a["outcome"])
                bought[k] = max(bought.get(k, 0), a["at"])
        for b in (_held.get(w) or {}).values():
            at = bought.get((b["title"], b["outcome"]))
            cur, avg = b.get("cur"), b.get("avg")
            if (b["status"] != "open" or not at or now - at > TAKE_DAYS * 86400 or cur is None or not avg
                    or not 0.03 <= cur <= 0.97 or abs(cur - avg) > TAKE_MOVE or b["cost"] < floor):
                continue
            sport, kind = _sport(b["slug"]), _kind(b["slug"], b["title"])
            combo = groups.get(("combo", f"{sport} · {kind}"), [0, 0])
            factors = [("combo", f"{sport} · {kind}") if combo[0] >= TAKE_MIN else ("sport", sport),
                       ("size", SIZES[_bucket(b["cost"], SIZES)][1]), ("price", PRICES[_bucket(avg, PRICES)][1])]
            fs, parts = [], []
            for dim, name in factors:
                n, flat = groups.get((dim, name), [0, 0.0])
                if not n:
                    continue
                copy = flat / n
                fs.append({"dim": dim, "name": name, "n": n, "copy": round(copy, 4)})
                if n >= TAKE_MIN:
                    parts.append(copy * n / (n + TAKE_SHRINK))
            if not parts:
                continue
            score = sum(parts) / len(parts)
            out.append({"wallet": w, "name": p["name"], "title": b["title"], "outcome": b["outcome"], "slug": b["slug"],
                        "icon": b.get("icon"), "avg": avg, "cur": cur, "cost": b["cost"], "end": b.get("end"), "at": at,
                        "factors": fs, "score": round(score, 4), "now": round((1 + score) * avg / cur - 1, 4)})
    out.sort(key=lambda r: -r["now"])
    return out


def best():
    """Best Bets: the same outcome bet by two or more followed profiles (each staking MIN_USD+). Open ones are the
    ones you can still take; settled ones grade the idea: flat $100 at the stake-weighted average price of the
    profiles' entries. `against`: a followed profile on another outcome of the same market."""
    names = {p["wallet"]: p["name"] for p in profiles()}
    by_asset, by_cond = defaultdict(list), defaultdict(set)
    for w, bets in _held.items():
        if w not in names:
            continue
        for a, b in bets.items():
            by_asset[a].append((w, b))
            by_cond[b["cond"]].add((w, a))
    rows = []
    for a, who in by_asset.items():
        if len({w for w, _ in who}) < 2:
            continue
        b0 = who[0][1]
        sts = {b["status"] for _, b in who}
        status = "open" if "open" in sts else "won" if "won" in sts else "lost" if "lost" in sts else "sold"
        cost = sum(b["cost"] for _, b in who)
        price = sum((b["avg"] or 0) * b["cost"] for _, b in who) / cost if cost else None
        cur = next((b["cur"] for _, b in who if b["status"] == "open"), b0["cur"])
        rows.append({"asset": a, "title": b0["title"], "outcome": b0["outcome"], "slug": b0["slug"], "icon": b0["icon"],
                     "status": status, "price": price, "cur": cur, "stake": cost,
                     "end": max((b["end"] or "" for _, b in who), default=""),
                     "at": max((b["at"] or 0 for _, b in who), default=0),
                     "people": sorted([{"name": names[w], "wallet": w, "avg": b["avg"], "cost": b["cost"], "pnl": b["pnl"],
                                        "status": b["status"]} for w, b in who], key=lambda x: -x["cost"]),
                     "against": sorted({names[w] for w, a2 in by_cond[b0["cond"]] if a2 != a and w in names})})
    open_ = sorted([r for r in rows if r["status"] == "open"], key=lambda r: (r["end"] or "9", -r["stake"]))
    done = sorted([r for r in rows if r["status"] in ("won", "lost")], key=lambda r: (r["end"] or "", r["at"]), reverse=True)
    w_ = sum(r["status"] == "won" for r in done)
    pnl = sum((100 * (1 / r["price"] - 1) if r["status"] == "won" else -100) for r in done if r["price"])
    # the other way round: a market where followed profiles took different outcomes (no outcome has 2+ of them)
    clash = []
    for cond, pairs in by_cond.items():
        outs = defaultdict(list)
        for w, a in pairs:
            outs[a].append(w)
        if len(outs) < 2 or len({w for w, _ in pairs}) < 2 or any(len(v) > 1 for v in outs.values()):
            continue
        sides = []
        for a, ws in outs.items():
            b = _held[ws[0]][a]
            sides.append({"name": names[ws[0]], "outcome": b["outcome"], "avg": b["avg"], "cost": b["cost"], "status": b["status"]})
        b0 = _held[next(iter(pairs))[0]][next(iter(pairs))[1]]
        clash.append({"title": b0["title"], "slug": b0["slug"], "icon": b0["icon"], "end": b0["end"] or "", "sides": sides,
                      "open": any(x["status"] == "open" for x in sides)})
    clash.sort(key=lambda r: r["end"], reverse=True)
    clash.sort(key=lambda r: not r["open"])  # open first, then newest
    return {"open": open_, "settled": done[:100], "clash": clash[:50],
            "record": {"w": w_, "l": len(done) - w_, "pnl": pnl, "staked": 100 * len(done),
                       "avg_price": sum(r["price"] or 0 for r in done) / len(done) if done else None}}


# Record breakdowns (asked 2026-10-16: "which of his trades should I take"): size is his stake, price his average
# entry. The page sums each group's per-bet ROI too ("Flat": copying every bet for the same amount; kch-temp: +14% on
# his money, ~+2% flat, his edge is the big bets) and filters by any of them.
SIZES = ((100, "Under $100"), (1e3, "$100–1k"), (1e4, "$1k–10k"), (5e4, "$10k–50k"), (2e5, "$50k–200k"),
         (float("inf"), "$200k+"))
PRICES = ((.35, "Under 35¢"), (.5, "35–50¢"), (.65, "50–65¢"), (.8, "65–80¢"), (.9, "80–90¢"), (float("inf"), "90¢+"))
def _bucket(x, cuts):
    return next(i for i, (hi, _) in enumerate(cuts) if x < hi)


def _pick(r):
    o = (r["outcome"] or "").strip().lower()
    if o in ("over", "under", "yes", "no"):
        return o.title()
    return "Favorite" if (r["price"] or 0) >= .5 else "Underdog"  # a team or player: favored when bought at 50¢+


OPEN_MAX = 200
CELL_COLS = ["w", "l", "pnl", "cost", "flat", "sport", "kind", "size", "price", "pick", "end"]
_settled_rows = {}  # wallet -> settled bets from the last summary read


def record(wallet):
    """The Record tab's data for one profile: settled bets summed into cells, one per (sport, market, size, price, pick,
    day), so the page can group and filter exactly without 100,000 rows (e46m3). size / price index SIZES / PRICES;
    flat is the cell's summed per-bet ROI."""
    rows = _settled_rows.get(wallet)
    if rows is None:
        p = next((x for x in profiles() if x["wallet"] == wallet), None)
        if not p:
            return {"ok": False, "error": "Not a profile you follow"}
        _profile(p)
        rows = _settled_rows.get(wallet, [])
    cells = {}
    for r in rows:
        end = r.get("end") or (datetime.fromtimestamp(r["at"], timezone.utc).strftime("%Y-%m-%d") if r.get("at") else "")
        k = (_sport(r["slug"]), _kind(r["slug"], r["title"]), _bucket(r["cost"], SIZES), _bucket(r["price"] or 0, PRICES),
             _pick(r), end[:10])
        c = cells.setdefault(k, [0, 0, 0.0, 0.0, 0.0])
        c[0 if r["won"] else 1] += 1
        c[2] += r["pnl"]
        c[3] += r["cost"]
        c[4] += r["pnl"] / r["cost"] if r["cost"] else 0
    return {"ok": True, "cols": CELL_COLS, "sizes": [x[1] for x in SIZES], "prices": [x[1] for x in PRICES],
            "cells": [[c[0], c[1], round(c[2], 2), round(c[3], 2), round(c[4], 4), *k] for k, c in cells.items()]}


def _merge(acts):
    """Newest first; a bet bought as many fills (same outcome and side, under 30 minutes apart) becomes one row."""
    out = []
    for a in acts:
        typ = a.get("type")
        if typ not in ("TRADE", "REDEEM", "SPLIT", "MERGE", "CONVERSION"):
            continue
        key = (typ, a.get("conditionId"), a.get("outcomeIndex"), a.get("side"))
        last = out[-1] if out else None
        if last and last["_key"] == key and last["_t0"] - a["timestamp"] < 1800:
            last["shares"] += a.get("size") or 0
            last["usd"] += a.get("usdcSize") or 0
            last["fills"] += 1
            last["_t0"] = a["timestamp"]
            last["first_at"] = a["timestamp"]
            continue
        out.append({"_key": key, "_t0": a["timestamp"], "type": typ, "side": a.get("side") or "",
                    "title": a.get("title"), "outcome": a.get("outcome"), "slug": a.get("eventSlug") or a.get("slug"),
                    "icon": a.get("icon"), "shares": a.get("size") or 0, "usd": a.get("usdcSize") or 0,
                    "at": a["timestamp"], "first_at": a["timestamp"], "fills": 1})
    for r in out:
        r.pop("_key"), r.pop("_t0")
        r["price"] = r["usd"] / r["shares"] if r["type"] == "TRADE" and r["shares"] else None
        r["sport"] = _sport(r["slug"])
    return out


def _activity(w, pages=3):
    """The latest bets, merged. A bet can be hundreds of fills, so up to 1,500 rows are read; the oldest merged row
    is dropped when the read hit that cap (it may be missing fills)."""
    acts = []
    for i in range(pages):
        rows = _get(f"/activity?user={w}&limit=500&offset={i * 500}")
        acts += rows
        if len(rows) < 500:
            return _merge(acts)[:150]
    return _merge(acts)[:-1][:150]


def _profile(p):
    w = p["wallet"]
    hit = _cache.get(w)
    if hit and time.time() - hit[0] < CACHE_S:
        return hit[1]
    lb = _get(f"/v1/leaderboard?timePeriod=ALL&orderBy=PNL&limit=1&user={w}")
    lb = lb[0] if lb else {}
    positions = _pages(f"/positions?user={w}&sizeThreshold=0.01", size=500)
    settled, complete = _settled(w, positions)
    _held[w] = _bets(w, positions)
    open_ = [{"asset": x.get("asset"), "title": x.get("title"), "outcome": x.get("outcome"), "slug": x.get("eventSlug") or x.get("slug"),
              "shares": x.get("size"), "avg": x.get("avgPrice"), "cur": x.get("curPrice"), "cost": x.get("initialValue"),
              "value": x.get("currentValue"), "pnl": x.get("cashPnl"), "end": x.get("endDate"), "icon": x.get("icon")}
             for x in positions if not x.get("redeemable")]
    open_.sort(key=lambda x: -(x["cost"] or 0))
    _settled_rows[w] = settled  # the Record tab asks for these by itself (record())
    w_, l_ = sum(r["won"] for r in settled), sum(not r["won"] for r in settled)
    cost = sum(r["cost"] for r in settled)
    out = {**p, "pnl": lb.get("pnl"), "volume": lb.get("vol"), "rank": lb.get("rank"),
           "record": {"w": w_, "l": l_, "pnl": sum(r["pnl"] for r in settled), "cost": cost,
                      "avg_price": (sum((r["price"] or 0) * r["cost"] for r in settled) / cost) if cost else None},
           "history": {"complete": complete, "n": len(settled)},
           # a bot-sized trader holds thousands: the biggest OPEN_MAX are listed, the totals cover them all
           "open": open_[:OPEN_MAX], "open_n": len(open_), "open_value": sum(x["value"] or 0 for x in open_),
           "activity": _activity(w)}
    _cache[w] = (time.time(), out)  # dropped when a history read lands (_fill_history)
    return out


# ---- live prices (asked 2026-10-18: "fix all the stale polymarket values, i want to see live values") ----------
# The positions feed's curPrice lags (and is cached CACHE_S here); every open bet shown is re-priced from the order
# books: POST clob /books, 50 tokens a call, kept LIVE_S. The price is polymarket.com's display price: the midpoint,
# or the last trade when the spread is over 10¢.
CLOB = "https://clob.polymarket.com"
LIVE_S = 10
_live = {}  # token -> (time, price)


def _book_price(b):
    bids = [float(x["price"]) for x in b.get("bids") or []]
    asks = [float(x["price"]) for x in b.get("asks") or []]
    last = float(b["last_trade_price"]) if b.get("last_trade_price") else None
    if bids and asks and max(bids) <= min(asks) and min(asks) - max(bids) <= 0.10:
        return round((max(bids) + min(asks)) / 2, 4)
    return last


def live_prices(tokens):
    """{token: price now} for the tokens that have a book (a closed market has none: it's left out)."""
    now = time.time()
    tokens = {t for t in tokens if t}
    need = [t for t in tokens if not (_live.get(t) and now - _live[t][0] < LIVE_S)]

    def batch(ts):
        try:
            req = urllib.request.Request(f"{CLOB}/books", data=json.dumps([{"token_id": t} for t in ts]).encode(),
                                         headers={"User-Agent": "polybot", "Content-Type": "application/json"},
                                         method="POST")
            with urllib.request.urlopen(req, timeout=10, context=sources.SSL) as r:
                return json.loads(r.read())
        except Exception as e:
            print(f"[polyprofiles] live prices: {e}")
            return []
    if need:
        chunks = [need[i:i + 50] for i in range(0, len(need), 50)]
        with ThreadPoolExecutor(min(8, len(chunks))) as ex:
            for books in ex.map(batch, chunks):
                for b in books or []:
                    p = _book_price(b)
                    if p is not None:
                        _live[b["asset_id"]] = (now, p)
    return {t: _live[t][1] for t in tokens if t in _live}


def _relive(rows):
    """Re-price followed profiles' open bets in place: _held (Best Bets, Take now) and each profile's open list."""
    held = [b for bets in _held.values() for b in bets.values() if b["status"] == "open"]
    opens = [x for r in rows for x in r.get("open") or []]
    px = live_prices([b["asset"] for b in held] + [x.get("asset") for x in opens])
    for b in held:
        if b["asset"] in px:
            b["cur"] = px[b["asset"]]
    for x in opens:
        p = px.get(x.get("asset"))
        if p is not None and x.get("shares"):
            x["cur"], x["value"] = p, round(x["shares"] * p, 2)
            x["pnl"] = round(x["value"] - (x["cost"] or 0), 2)


_failed = {}  # wallet -> (time, error): a profile that just failed waits FAIL_S before it's read again


def summary():
    def one(p):
        hit = _failed.get(p["wallet"])
        if hit and time.time() - hit[0] < FAIL_S:
            return {**p, "error": hit[1]}
        try:
            out = _profile(p)
            _failed.pop(p["wallet"], None)
            return out
        except Exception as e:
            print(f"[polyprofiles] {p['name']}: {e}")
            _failed[p["wallet"]] = (time.time(), str(e)[:200])
            return {**p, "error": str(e)[:200]}
    ps = profiles()
    with ThreadPoolExecutor(max(1, len(ps))) as ex:  # all at once: a cold read is ~15s a profile
        rows = list(ex.map(one, ps))
    rows = [{**r, "open": [dict(x) for x in r.get("open") or []]} for r in rows]  # the cache keeps its own copy
    _relive(rows)
    for r in rows:  # the total, when every open bet is listed (a bot-sized one keeps the feed's total)
        if "open_value" in r and r.get("open_n", 0) <= len(r["open"]):
            r["open_value"] = round(sum(x["value"] or 0 for x in r["open"]), 2)
    followed = {p["wallet"] for p in ps}  # the feed shows only people you still follow
    return {"ok": True, "profiles": rows, "best": best(), "take": take_now(),
            "live": [r for r in _read(LIVE, [])[-300:][::-1] if r.get("wallet") in followed], "stream": dict(_status)}


# ---- live alerts ----------------------------------------------------------------------------------------------
# ---- position watcher (2026-10-19) -----------------------------------------------------------------------------
# Kch-Temp's $139.9K Under 52.5 was thousands of $1-5 fills: the live stream carries none of these traders' (maker)
# fills, and /activity's newest 100 trades are a few seconds of them, so the bot saw $290 of it. Now every POLL each
# followed profile's open positions are compared with the last look: a position that grew is a buy of the difference
# (cost and price exact from initialValue), one that shrank or vanished before its market resolved is a sell. The
# deltas go through _fill / _flush like fills did (one alert per bet, merged until quiet), and fills from the stream
# and /activity are no longer alerted (they'd count twice).
_pos = {}  # wallet -> {asset: {size, cost, title, outcome, slug, cur}}
POS_MIN_USD = 5


def position_cost(wallet, asset):
    """Their cost in this outcome as of the last look (None if unknown)."""
    return ((_pos.get(wallet) or {}).get(asset) or {}).get("cost")


def _watch_positions(p):
    w = p["wallet"]
    try:
        rows = _pages(f"/positions?user={w}&sizeThreshold=0.1", size=500, cap=20000)
    except Exception as e:
        print(f"[polyprofiles] positions {p['name']}: {e}")
        return
    resolved = {x.get("asset") for x in rows if x.get("redeemable")}
    cur = {}
    for x in rows:
        a = x.get("asset")
        if not a or x.get("redeemable"):
            continue
        cur[a] = {"size": float(x.get("size") or 0), "cost": float(x.get("initialValue") or 0), "title": x.get("title"),
                  "outcome": x.get("outcome"), "slug": x.get("eventSlug") or x.get("slug"),
                  "cur": float(x.get("curPrice") or 0)}
    old = _pos.get(w)
    _pos[w] = cur
    if old is None:  # the first look records what's there, and the copier checks it for bets it should hold
        try:
            import polyus
            threading.Thread(target=polyus.catch_up, args=(w, cur), daemon=True).start()
        except Exception as e:
            print(f"[polyprofiles] catch-up: {e}")
        return
    now = time.time()

    def fill(a, side, n, size, usd, price, basis=None):
        _fill(w, {"asset": a, "side": side, "title": n["title"], "outcome": n["outcome"], "eventSlug": n["slug"],
                  "size": size, "usdcSize": usd, "price": price, "timestamp": now, "basis": basis}, "positions")
    for a, n in cur.items():
        o = old.get(a)
        ds = n["size"] - (o["size"] if o else 0.0)
        dc = n["cost"] - (o["cost"] if o else 0.0)
        if ds > 1e-6 and dc >= POS_MIN_USD:
            fill(a, "BUY", n, ds, dc, dc / ds)
        elif ds < -1e-6 and -ds * n["cur"] >= POS_MIN_USD:  # basis: the sold shares at their average buy price
            fill(a, "SELL", n, -ds, -ds * n["cur"], n["cur"], -ds * o["cost"] / o["size"] if o["size"] else None)
    for a, o in old.items():  # gone, and not because its market resolved: sold
        if a not in cur and a not in resolved and 0.02 < o["cur"] < 0.98 and o["size"] * o["cur"] >= POS_MIN_USD:
            fill(a, "SELL", o, o["size"], o["size"] * o["cur"], o["cur"], o["cost"])


def _fill(wallet, f, via):
    """One fill of a followed wallet (from the position watcher) into its bet's pending alert."""
    if via != "positions":
        return  # stream / activity fills: the position watcher counts these bets now (2026-10-19)
    key = (wallet, f.get("asset"), f.get("side"))
    with _lock:
        b = _pending.get(key)
        if not b:
            b = _pending[key] = {"wallet": wallet, "asset": f.get("asset"), "side": f.get("side"), "title": f.get("title"),
                                 "outcome": f.get("outcome"), "slug": f.get("eventSlug") or f.get("slug"),
                                 "shares": 0.0, "usd": 0.0, "fills": 0, "first": time.time(), "last": 0, "via": via,
                                 "ts": None, "basis": 0.0}
        size = float(f.get("size") or 0)
        ts = f.get("timestamp")  # when the trade really happened (the stream and /activity both carry it)
        if ts:
            ts = float(ts) / (1000 if float(ts) > 1e11 else 1)
            b["ts"] = ts if b["ts"] is None else min(b["ts"], ts)
        b["shares"] += size
        b["usd"] += float(f.get("usdcSize") or size * float(f.get("price") or 0))
        if b.get("basis", 0.0) is not None:
            b["basis"] = None if f.get("basis") is None else b.get("basis", 0.0) + float(f["basis"])
        b["fills"] += 1
        b["last"] = time.time()


def feed_catch_up(row):
    """A bet the copier's catch-up found in someone's positions (polyus.catch_up) into the Trader feed too (asked
    2026-10-19: Kch-Temp's $139.9K Under 52.5 showed as only the $290 fill the old counting saw). A row for the same
    buy already there is raised to the whole position; otherwise it's added."""
    with _lock:
        live = _read(LIVE, [])
        old = next((r for r in reversed(live) if r.get("wallet") == row["wallet"] and r.get("asset") == row["asset"]
                    and r.get("side") == "BUY"), None)
        if old:
            if old["usd"] >= row["usd"] - MIN_USD:
                return
            old.update({"usd": round(row["usd"], 2), "price": row["price"], "via": "catch-up",
                        "shares": round(row["usd"] / row["price"], 2) if row["price"] else old.get("shares")})
        else:
            live.append({"id": uuid.uuid4().hex[:10], **row, "usd": round(row["usd"], 2), "fills": 0,
                         "shares": round(row["usd"] / row["price"], 2) if row["price"] else 0,
                         "at": datetime.now(timezone.utc).isoformat(timespec="seconds")})
        DIR.mkdir(parents=True, exist_ok=True)
        LIVE.write_text(json.dumps(live[-300:]))
    _cache.pop(row["wallet"], None)


def _flush(force=False):
    now = time.time()
    with _lock:
        done = [k for k, b in _pending.items() if force or now - b["last"] > QUIET or now - b["first"] > MAX_WAIT]
        bets = [_pending.pop(k) for k in done]
    if not bets:
        return
    names = {p["wallet"]: p for p in profiles()}
    import alerts as sportsalerts
    for b in bets:
        p = names.get(b["wallet"])
        if not p or b["usd"] < MIN_USD:
            continue
        if not b["title"]:  # the stream sends some trades without the market: look it up by the outcome's token
            b.update({k: v for k, v in _market(b["asset"]).items() if v})
        price = b["usd"] / b["shares"] if b["shares"] else 0
        verb = "bought" if b["side"] == "BUY" else "sold"
        row = {"id": uuid.uuid4().hex[:10], "wallet": b["wallet"], "name": p["name"], "side": b["side"], "asset": b["asset"],
               "title": b["title"], "outcome": b["outcome"], "slug": b["slug"], "shares": round(b["shares"], 2),
               "usd": round(b["usd"], 2), "price": round(price, 4), "fills": b["fills"], "via": b["via"],
               "at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
               "traded_at": datetime.fromtimestamp(b["ts"], timezone.utc).isoformat(timespec="seconds") if b.get("ts") else None}
        if b["side"] == "SELL" and b.get("basis"):  # what the sale made them over what those shares cost (asked 2026-10-19)
            row.update({"avg": round(b["basis"] / b["shares"], 4), "pnl": round(b["usd"] - b["basis"], 2)})
        with _lock:
            DIR.mkdir(parents=True, exist_ok=True)
            LIVE.write_text(json.dumps((_read(LIVE, []) + [row])[-300:]))
        _cache.pop(b["wallet"], None)
        try:  # the copy sims take (or exit) it
            import copysim
            copysim.on_bet(row)
        except Exception as e:
            print(f"[polyprofiles] copysim: {e}")
        # the real-money copy on Polymarket US (Kch-Temp and primm, back on 2026-10-18)
        try:
            import polyus
            polyus.on_bet(row)
        except Exception as e:
            print(f"[polyprofiles] polyus: {e}")
        if p.get("alerts", True):
            sportsalerts.post("poly", f"{p['name']} {verb} {pick_label(b['title'], b['outcome'])} {round(price * 100)}¢",
                              f"${b['usd']:,.0f} · {b['title']}", {"link": "p.poly"})
        others = [names[w]["name"] for w, bets in _held.items()
                  if w != b["wallet"] and w in names and (bets.get(b["asset"]) or {}).get("status") == "open"]
        if b["side"] == "BUY" and others:
            sportsalerts.post("poly_best", f"Best bet: {' + '.join([p['name']] + others)} on {pick_label(b['title'], b['outcome'])}",
                              f"{b['title']} · now {round(price * 100)}¢", {"link": "p.poly"})
        try:  # a big one goes to the phone too (ntfy), one push per bet with the Best-bet news folded in
            import phonepush
            if phonepush.wants(p, b["side"], b["usd"]):
                us = us_event(b["slug"], b["title"]) if b["slug"] else None
                link = (f"https://polymarket.us/event/{us}" if us else
                        "https://polymarket.us/search?q=" + urllib.parse.quote((b["title"] or "").rstrip("?")))
                text = f"${b['usd']:,.0f} at {round(price * 100)}¢ · {b['title']}"
                if b["side"] == "BUY" and others:
                    text += f"\nBest bet: {', '.join(others)} also on it"
                phonepush.send(f"{p['name']} {verb} {pick_label(b['title'], b['outcome'])}", text, click=link,
                               actions=[("Open bet", link), (f"{p['name']}'s profile", f"https://polymarket.com/@{p['handle']}")],
                               tags=["moneybag"] if b["side"] == "BUY" else ["outbox_tray"])
        except Exception as e:
            print(f"[polyprofiles] phone: {e}")


_markets = {}


def _market(asset):
    """An outcome token -> {title, outcome, slug} (Gamma), cached."""
    if asset in _markets:
        return _markets[asset]
    out = {}
    try:
        m = (_get(f"/markets?clob_token_ids={asset}", base=GAMMA) or [{}])[0]
        ids, names = json.loads(m.get("clobTokenIds") or "[]"), json.loads(m.get("outcomes") or "[]")
        ev = (m.get("events") or [{}])[0]
        out = {"title": m.get("question"), "outcome": names[ids.index(asset)] if asset in ids and len(names) == len(ids) else None,
               "slug": ev.get("slug") or m.get("slug")}
    except Exception as e:
        print(f"[polyprofiles] market {asset[:12]}: {e}")
    _markets[asset] = out
    return out


def _mark(tx, asset):
    k = ((tx or "").lower(), asset)
    if k in _seen:
        return False
    _seen[k] = time.time()
    return True


_polled = set()  # wallets polled since the server started: a new one's first read only records what's there


def _poll_one(p, quiet=False):
    # a profile's first read is quiet (2026-10-19: alwaysfade's 3-hour-old Packers bets were alerted as new right after
    # he was followed, and his paper sim "won" them at his old prices)
    quiet = quiet or p["wallet"] not in _polled
    _polled.add(p["wallet"])
    try:
        acts = _get(f"/activity?user={p['wallet']}&limit=100&type=TRADE")
    except Exception as e:
        print(f"[polyprofiles] poll {p['name']}: {e}")
        return
    for a in reversed(acts):
        if time.time() - a.get("timestamp", 0) > 6 * 3600:
            _mark(a.get("transactionHash"), a.get("asset"))
            continue
        if _mark(a.get("transactionHash"), a.get("asset")) and not quiet:
            _fill(p["wallet"], a, "poll")


def _poll_loop():
    first = True
    while True:
        try:
            for p in profiles():
                _poll_one(p, quiet=first)  # marks fills seen (alerts come from the position watcher)
                _watch_positions(p)
            first = False
            cut = time.time() - 86400
            for k in [k for k, t in _seen.items() if t < cut]:
                _seen.pop(k, None)
            _flush()
        except Exception as e:
            print(f"[polyprofiles] poll: {e}")
        for _ in range(POLL // 10):
            time.sleep(10)
            _flush()


def _send(s, text):
    """A client frame (masked, as the protocol requires)."""
    data, mask = text.encode(), os.urandom(4)
    n = len(data)
    head = bytes([0x81]) + (bytes([0x80 | n]) if n < 126 else bytes([0x80 | 126]) + n.to_bytes(2, "big"))
    s.sendall(head + mask + bytes(c ^ mask[i % 4] for i, c in enumerate(data)))


def _stream():
    """Polymarket's live trade stream forever (reconnecting): a followed wallet's fills go to _fill."""
    host, path = WS
    while True:
        try:
            sock = socket.create_connection((host, 443), timeout=60)
            s = sources.SSL.wrap_socket(sock, server_hostname=host)
            key = base64.b64encode(os.urandom(16)).decode()
            s.sendall((f"GET {path} HTTP/1.1\r\nHost: {host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                       f"Origin: https://polymarket.com\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n").encode())
            buf = b""
            while b"\r\n\r\n" not in buf:
                chunk = s.recv(4096)
                if not chunk:
                    raise ConnectionError("closed during handshake")
                buf += chunk
            head, rest = buf.split(b"\r\n\r\n", 1)
            if b" 101 " not in head.split(b"\r\n")[0]:
                raise ConnectionError(head.split(b"\r\n")[0].decode())
            _send(s, json.dumps({"action": "subscribe", "subscriptions": [{"topic": "activity", "type": "trades"}]}))
            _status.update(connected=True, since=datetime.now(timezone.utc).isoformat(timespec="seconds"), error=None)
            box = [rest]

            def exact(n):
                while len(box[0]) < n:
                    chunk = s.recv(65536)
                    if not chunk:
                        raise ConnectionError("closed")
                    box[0] += chunk
                out, box[0] = box[0][:n], box[0][n:]
                return out
            frag, last_ping, wallets, wallets_at = b"", time.time(), set(), 0
            while True:
                if time.time() - last_ping > 5:  # the server drops a client that doesn't ping
                    _send(s, "PING")
                    last_ping = time.time()
                if time.time() - wallets_at > 30:
                    wallets, wallets_at = {p["wallet"] for p in profiles()}, time.time()
                b1, b2 = exact(2)
                op, ln = b1 & 0x0F, b2 & 0x7F
                if ln == 126:
                    ln = int.from_bytes(exact(2), "big")
                elif ln == 127:
                    ln = int.from_bytes(exact(8), "big")
                if b2 & 0x80:
                    exact(4)
                data = exact(ln)
                if op == 8:
                    raise ConnectionError("server closed")
                if op == 9:
                    mask = os.urandom(4)
                    s.sendall(bytes([0x8A, 0x80 | len(data)]) + mask + bytes(c ^ mask[i % 4] for i, c in enumerate(data)))
                    continue
                if op == 0:
                    frag += data
                    if not b1 & 0x80:
                        continue
                    data, frag = frag, b""
                elif op == 1 and not b1 & 0x80:
                    frag = data
                    continue
                elif op != 1:
                    continue
                _status["seen"] += 1
                if not wallets:
                    continue
                low = data.lower()
                if not any(w.encode() in low for w in wallets):
                    continue
                try:
                    f = json.loads(data).get("payload") or {}
                except ValueError:
                    continue
                w = (f.get("proxyWallet") or "").lower()
                if w in wallets:
                    _status["matched"] += 1
                    _mark(f.get("transactionHash"), f.get("asset"))
                    _fill(w, f, "live")
        except Exception as e:
            _status.update(connected=False, error=str(e)[:200])
            print(f"[polyprofiles] stream: {e}")
            time.sleep(10)


def start():
    """The stream and the backstop poll (the main server only)."""
    global _started
    if _started:
        return
    _started = True
    threading.Thread(target=_stream, daemon=True, name="poly-stream").start()
    threading.Thread(target=_poll_loop, daemon=True, name="poly-poll").start()


if __name__ == "__main__":
    print(json.dumps(summary(), indent=1, default=str)[:4000])
