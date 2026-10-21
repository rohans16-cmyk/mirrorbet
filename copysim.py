"""Copy-trading sims on Polymarket, paper money (asked 2026-10-16): copy the Best Bets (an outcome two or more followed
profiles bet), or any mix of followed profiles, with your own stake and rules.

  sims       data/polymarket/copysims.json = [{id, name, wallets ("all" or [wallet]), mode, min_agree, stake, bankroll,
             min_trader_usd, max_price, follow_sells, active, created_at, positions: [...]}]
             mode "copy": every bet any of them makes. mode "best": an outcome once min_agree of them hold it.
             (The built-in "Copy Best Bets" sim was removed 2026-10-19; a "best" sim can still be made by hand.)
  entries    on_bet() gets each followed profile's bet from polyprofiles' live alerts (stream + poll): the sim buys
             at their price + SLIP (you'd get a worse fill than them, never better), once per outcome.
             Skipped: their bet under min_trader_usd, a price over max_price, or no cash left.
  sizing     (asked 2026-10-17; the bets before were resized the same way, resize()) bets follow their size: `stake` x (their bet / their usual bet,
             the median of their past positions), so a bet twice their usual is 2 x stake. When they add to an open
             outcome the sim adds too (the price averages). An outcome's total is capped at max_stake; a short bankroll
             buys what it can.
  exits      a copied profile selling (follow_sells): sell at their price - SLIP. Otherwise the market's result:
             settle() reads Gamma every 10 minutes (open markets for the live price, closed=true for the result).
  history    backtest(): the same rules on every past bet of theirs (the complete closed-position history), at their
             average price + SLIP, sized like live bets. Their average, not the first fill, so it's a rough guide.
"""
import json
import threading
import time
import uuid
from datetime import datetime, timezone

import polyprofiles

PATH = polyprofiles.DIR / "copysims.json"
SLIP = 0.01
from polyus import LATE_S  # the real bot's: a bet reaching us 45+ min after it happened isn't copied (one number for both)
SETTLE_S = 60  # results (Gamma) checked every minute; the page's prices are live from the books (summary)
USUAL_S = 3600
_lock = threading.RLock()
_marks = {}  # asset -> (time, {closed, price})
_usual = {}  # wallet -> (time, median position $)
_started = False

DEFAULTS = {"wallets": "all", "mode": "copy", "min_agree": 2, "stake": 100.0, "bankroll": 1000.0, "min_trader_usd": 25.0,
            "max_stake": 500.0, "max_price": 0.97, "follow_sells": True, "active": True}


def _now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _load():
    try:
        rows = json.loads(PATH.read_text())
    except Exception:
        rows = []
    return rows  # the always-there "Copy Best Bets" sim is gone (asked 2026-10-19: "get rid of this")


def _save(rows):
    polyprofiles.DIR.mkdir(parents=True, exist_ok=True)
    PATH.write_text(json.dumps(rows, indent=1))


def _wallets(sim):
    followed = [p["wallet"] for p in polyprofiles.profiles()]
    return followed if sim["wallets"] == "all" else [w for w in sim["wallets"] if w in followed]


# ---- managing ------------------------------------------------------------------------------------------------
def _clean(body):
    out = {}
    if "name" in body:
        out["name"] = (str(body["name"]).strip() or "Paper bets")[:40]
    if "wallets" in body:
        w = body["wallets"]
        out["wallets"] = "all" if w == "all" else [str(x).lower() for x in (w or [])]
        if out["wallets"] != "all" and not out["wallets"]:
            raise ValueError("Pick at least one person to copy.")
    if "mode" in body:
        if body["mode"] not in ("copy", "best"):
            raise ValueError("Mode is copy or best.")
        out["mode"] = body["mode"]
    for k, lo, hi in (("min_agree", 2, 10), ("stake", 1, 1e6), ("bankroll", 1, 1e8), ("min_trader_usd", 0, 1e7), ("max_stake", 1, 1e7), ("max_price", 0.02, 0.99)):
        if k in body and body[k] is not None:
            v = float(body[k])
            if not lo <= v <= hi:
                raise ValueError(f"{k.replace('_', ' ')} must be between {lo:g} and {hi:g}.")
            out[k] = int(v) if k == "min_agree" else v
    for k in ("follow_sells", "active"):
        if k in body:
            out[k] = bool(body[k])
    return out


def create(body):
    sim = {**DEFAULTS, "name": "Paper bets", **_clean(body), "id": uuid.uuid4().hex[:8], "created_at": _now(), "positions": []}
    if sim["mode"] == "best" and sim["wallets"] != "all" and len(sim["wallets"]) < sim["min_agree"]:
        raise ValueError(f"Pick at least {sim['min_agree']} people for {sim['min_agree']} to agree.")
    with _lock:
        _save(_load() + [sim])
    return sim


def update(sid, body):
    with _lock:
        rows = _load()
        for s in rows:
            if s["id"] == sid:
                s.update(_clean(body))
                if body.get("reset"):  # start over: positions gone, the bankroll back, the clock restarted
                    s["positions"], s["created_at"] = [], _now()
        _save(rows)


def remove(sid):
    with _lock:
        _save([s for s in _load() if s["id"] != sid])


# ---- live ----------------------------------------------------------------------------------------------------
def _holders(sim, asset):
    """Followed wallets in this sim that hold this outcome open: their positions (polyprofiles' cache) plus buys
    seen live since (the cache can be minutes old)."""
    ws = set(_wallets(sim))
    out = {w for w in ws if ((polyprofiles._held.get(w) or {}).get(asset) or {}).get("status") == "open"}
    cut = time.time() - 7 * 86400
    for r in polyprofiles._read(polyprofiles.LIVE, []):
        if r.get("asset") == asset and r.get("side") == "BUY" and r.get("wallet") in ws:
            try:
                if datetime.fromisoformat(r["at"]).timestamp() > cut:
                    out.add(r["wallet"])
            except Exception:
                pass
    return out


def usual(wallet):
    """Their usual bet: the median cost of their settled positions of $25+ (the full saved history). None with none."""
    hit = _usual.get(wallet)
    if hit and time.time() - hit[0] < USUAL_S:
        return hit[1]
    try:
        rows = json.loads((polyprofiles.DIR / "closed" / f"{wallet}.json").read_text())["rows"]
        costs = sorted(c for c in ((r.get("avgPrice") or 0) * (r.get("totalBought") or 0) for r in rows) if c >= 25)
    except Exception:
        costs = []
    out = costs[len(costs) // 2] if costs else None
    _usual[wallet] = (time.time(), out)
    return out


def _size(sim, wallet, their_usd):
    """What the sim bets on one of their bets: stake x their bet / their usual."""
    u = usual(wallet)
    return sim["stake"] * (their_usd / u if u else 1)


def on_bet(bet):
    """A followed profile's bet (polyprofiles._flush): {wallet, name, side, asset, title, outcome, slug, price, usd}."""
    if not bet.get("asset"):
        return
    # a trade more than LATE_S old is news, not a copy (2026-10-19: a newly followed profile's 3-hour-old bets were
    # copied at their old prices after the game had moved). Same 45 min as the real bot (polyus.LATE_S): at 15 min the
    # sims missed Kch-Temp's Under 52.5, which Polymarket's feed delivered 15.9 min late and the real bot bought.
    lag = None
    try:
        if bet.get("traded_at"):
            lag = (datetime.now(timezone.utc) - datetime.fromisoformat(bet["traded_at"])).total_seconds()
    except Exception:
        pass
    if lag is not None and lag > LATE_S:
        return
    # a late one is entered at today's price, like the real bot buys at the US ask (skipped past their price + SLIP)
    now_px = None
    if lag is not None and lag > 60 and bet.get("side") == "BUY":
        now_px = polyprofiles.live_prices([bet["asset"]]).get(bet["asset"])
    names = {p["wallet"]: p["name"] for p in polyprofiles.profiles()}
    with _lock:
        rows = _load()
        for sim in rows:
            if not sim.get("active", True) or bet["wallet"] not in _wallets(sim):
                continue
            pos = next((x for x in sim["positions"] if x["asset"] == bet["asset"] and x["status"] == "open"), None)
            if bet["side"] == "SELL":
                if pos and sim.get("follow_sells", True) and bet["wallet"] in pos["by_wallets"]:
                    _close(sim, pos, max(0.0, bet["price"] - SLIP), "sold", f"{bet['name']} sold")
                continue
            if not pos and any(x["asset"] == bet["asset"] for x in sim["positions"]):
                continue  # one entry per outcome (they add to an open one: so do we)
            if bet.get("catch_up") and pos:
                continue  # a catch-up is their whole position: one the sim already holds isn't added again
            if bet["usd"] < sim["min_trader_usd"]:
                continue
            price = min(0.99, bet["price"] + SLIP)
            if now_px is not None:
                if now_px > bet["price"] + SLIP:
                    continue  # moved past their price: the real bot wouldn't buy it either
                price = min(0.99, now_px + SLIP)
            if price > sim["max_price"]:
                continue
            who = {bet["wallet"]}
            if sim["mode"] == "best" and not pos:
                who |= _holders(sim, bet["asset"])
                if len(who) < sim["min_agree"]:
                    continue
            cap = sim.get("max_stake", DEFAULTS["max_stake"])
            amt = round(min(_size(sim, bet["wallet"], bet["usd"]), cap - (pos["cost"] if pos else 0), _cash(sim)), 2)
            if amt < 1:
                continue
            if pos:  # they added: so do we, at the new price
                pos["shares"] += amt / price
                pos["cost"] = round(pos["cost"] + amt, 2)
                pos["price"] = round(pos["cost"] / pos["shares"], 4)
                pos["theirs"] = round(pos.get("theirs", 0) + bet["usd"], 2)
                pos["adds"] = pos.get("adds", 0) + 1
                if bet["wallet"] not in pos["by_wallets"]:
                    pos["by_wallets"] = sorted(set(pos["by_wallets"]) | {bet["wallet"]})
                    pos["by"] = sorted(names.get(w, w[:8]) for w in pos["by_wallets"])
                continue
            sim["positions"].append({"asset": bet["asset"], "title": bet["title"], "outcome": bet["outcome"],
                                     "slug": bet["slug"], "price": round(price, 4), "cost": amt,
                                     "shares": amt / price, "at": _now(), "status": "open", "cur": bet["price"],
                                     "theirs": round(bet["usd"], 2), "by_wallets": sorted(who),
                                     "by": sorted(names.get(w, w[:8]) for w in who), "trigger": bet["name"]})
        _save(rows)


def _close(sim, pos, price, status, why=""):
    pos.update(status=status, exit=round(price, 4), pnl=round(pos["shares"] * price - pos["cost"], 2),
               settled_at=_now(), why=why)


def _cash(sim):
    c = sim["bankroll"]
    for x in sim["positions"]:
        c -= x["cost"]
        if x["status"] != "open":
            c += x["cost"] + x["pnl"]
    return c


def _mark(asset):
    """{closed, price}: the outcome's price now, or its result (1 / 0) once the market's closed."""
    hit = _marks.get(asset)
    if hit and time.time() - hit[0] < 60:
        return hit[1]
    out = None
    for q in ("", "&closed=true"):
        try:
            m = polyprofiles._get(f"/markets?clob_token_ids={asset}{q}", base=polyprofiles.GAMMA)
        except Exception:
            continue
        if not m:
            continue
        m = m[0]
        ids, prices = json.loads(m.get("clobTokenIds") or "[]"), json.loads(m.get("outcomePrices") or "[]")
        if asset in ids and len(prices) == len(ids):
            out = {"closed": bool(m.get("closed")), "price": float(prices[ids.index(asset)])}
        break
    _marks[asset] = (time.time(), out)
    return out


def settle():
    with _lock:
        rows = _load()
        assets = {x["asset"] for s in rows for x in s["positions"] if x["status"] == "open"}
    marks = {a: _mark(a) for a in assets}
    with _lock:
        rows = _load()
        for s in rows:
            for x in s["positions"]:
                m = marks.get(x["asset"])
                if x["status"] != "open" or not m:
                    continue
                x["cur"] = m["price"]
                if m["closed"] and m["price"] in (0.0, 1.0):
                    _close(s, x, m["price"], "won" if m["price"] == 1.0 else "lost")
        _save(rows)


def _loop():
    while True:
        try:
            settle()
        except Exception as e:
            print(f"[copysim] settle: {e}")
        time.sleep(SETTLE_S)


def start():
    global _started
    if _started:
        return
    _started = True
    threading.Thread(target=_loop, daemon=True, name="copysim").start()


def resize():
    """One-off (2026-10-17): the flat bets from before sizing, redone at their size from the live bets they came from.
    Each buy of theirs on the outcome, from the entry until it settled, at stake x their bet / their usual, capped at
    max_stake. Results stay; cost, shares, price and P/L follow the new size. The bankroll isn't replayed (a day of
    big bets could run past it). Rows already resized, or with no live bets found, are left alone."""
    live = sorted((r for r in polyprofiles._read(polyprofiles.LIVE, []) if r.get("side") == "BUY"), key=lambda r: r["at"])
    done = 0
    with _lock:
        rows = _load()
        for sim in rows:
            cap = sim.get("max_stake", DEFAULTS["max_stake"])
            for x in sim["positions"]:
                if x.get("resized"):
                    continue
                t0 = datetime.fromisoformat(x["at"]).timestamp() - 300
                t1 = datetime.fromisoformat(x["settled_at"]).timestamp() if x.get("settled_at") else time.time()
                cost = shares = theirs = 0.0
                n = 0
                for r in live:
                    t = datetime.fromisoformat(r["at"]).timestamp()
                    if r["asset"] != x["asset"] or r["wallet"] not in x["by_wallets"] or not t0 <= t <= t1:
                        continue
                    price = min(0.99, r["price"] + SLIP)
                    if r["usd"] < sim["min_trader_usd"] or price > sim["max_price"] or cost >= cap:
                        continue
                    amt = min(_size(sim, r["wallet"], r["usd"]), cap - cost)
                    cost, shares, theirs, n = cost + amt, shares + amt / price, theirs + r["usd"], n + 1
                if not n:
                    continue
                x.update(cost=round(cost, 2), shares=shares, price=round(cost / shares, 4), theirs=round(theirs, 2),
                         adds=n - 1, resized=True)
                if x["status"] != "open":
                    x["pnl"] = round(shares * x["exit"] - cost, 2)
                done += 1
        _save(rows)
    return done


# ---- history -------------------------------------------------------------------------------------------------
def backtest(sim):
    """The sim's rules on every settled past bet of its people at their average price + SLIP, sized like live bets:
    stake x their cost / their usual (the mean of that across people when several hold it), capped at max_stake."""
    ws = _wallets(sim)
    by_asset = {}
    for w in ws:
        for a, b in (polyprofiles._held.get(w) or {}).items():
            by_asset.setdefault(a, []).append((w, b))
    w_ = l_ = 0
    pnl = staked = 0.0
    first = None
    for a, bets in by_asset.items():
        bets = [(w, b) for w, b in bets if b["cost"] >= sim["min_trader_usd"]]
        need = sim["min_agree"] if sim["mode"] == "best" else 1
        if len(bets) < need or any(b["status"] == "open" for _, b in bets):
            continue
        cost = sum(b["cost"] for _, b in bets)
        price = min(0.99, sum((b["avg"] or 0) * b["cost"] for _, b in bets) / cost + SLIP)
        if price > sim["max_price"]:
            continue
        ratio = sum(b["cost"] / (usual(w) or b["cost"]) for w, b in bets) / len(bets)
        amt = min(sim["stake"] * ratio, sim.get("max_stake", DEFAULTS["max_stake"]))
        staked += amt
        sts = {b["status"] for _, b in bets}
        st = "won" if "won" in sts else "lost" if "lost" in sts else "sold"
        if st == "won":
            w_ += 1
            pnl += amt * (1 / price - 1)
        elif st == "lost":
            l_ += 1
            pnl -= amt
        else:  # sold before the result: their return on what they put in
            r = sum(b["pnl"] for _, b in bets) / cost
            if r > 0:
                w_ += 1
            else:
                l_ += 1
            pnl += amt * r
        ts = [b["at"] for _, b in bets if b.get("at")]
        if ts:
            first = min([first] + ts) if first else min(ts)
    n = w_ + l_
    return {"w": w_, "l": l_, "pnl": round(pnl, 2), "roi": pnl / staked if staked else None, "since": first}


# ---- the page ------------------------------------------------------------------------------------------------
def summary():
    for p in polyprofiles.profiles():  # their positions (cached) for the history and who holds what
        try:
            polyprofiles._profile(p)
        except Exception as e:
            print(f"[copysim] {p['name']}: {e}")
    names = {p["wallet"]: p["name"] for p in polyprofiles.profiles()}
    out = []
    with _lock:
        rows = _load()
    px = polyprofiles.live_prices([x["asset"] for s in rows for x in s["positions"] if x["status"] == "open"])
    for s in rows:
        for x in s["positions"]:
            if x["status"] == "open" and x["asset"] in px:
                x["cur"] = px[x["asset"]]  # live from the book (shown only: settle() saves its own)
    for s in rows:
        pos = s["positions"]
        open_ = [x for x in pos if x["status"] == "open"]
        done = [x for x in pos if x["status"] != "open"]
        value = sum(x["shares"] * (x.get("cur") or 0) for x in open_)
        cash = _cash(s)
        staked = sum(x["cost"] for x in done)
        realized = sum(x["pnl"] for x in done)
        out.append({**DEFAULTS, **{k: v for k, v in s.items() if k != "positions"},
                    "people": [names[w] for w in _wallets(s)],
                    "usual": {names[w]: usual(w) for w in _wallets(s)},
                    "cash": round(cash, 2), "value": round(value, 2), "equity": round(cash + value, 2),
                    "pnl": round(cash + value - s["bankroll"], 2),
                    "w": sum(x["pnl"] > 0 for x in done), "l": sum(x["pnl"] <= 0 for x in done),
                    "roi": realized / staked if staked else None,
                    "open": sorted(open_, key=lambda x: x["at"], reverse=True),
                    "settled": sorted(done, key=lambda x: x.get("settled_at") or "", reverse=True),
                    "history": backtest(s)})
    return {"ok": True, "sims": out, "people": [{"wallet": w, "name": n} for w, n in names.items()]}
