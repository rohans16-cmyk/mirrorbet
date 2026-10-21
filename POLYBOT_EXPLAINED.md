# Polybot: how it works, end to end

## 1. What it is, in one paragraph

Polybot is a copy-trading system for prediction markets. It watches a hand-picked set of traders on polymarket.com
(the global site, which blocks US users), detects each bet they place, decides whether that bet is worth copying
using rules derived from those traders' historical results, finds the identical market on Polymarket US (the
CFTC-regulated exchange US residents can use), and buys it with real money on your account within tight price and
size limits. It exits when the trader exits, at a per-trader profit target, when you press Sell, or when the market
settles. Alongside the real-money bot it runs paper-money simulations so strategies can be compared without risk.

## 2. Architecture

- **Backend:** Python 3.10+, standard library HTTP server (`server.py`) on http://localhost:8100, bound to
  127.0.0.1 only (nothing is exposed to the internet). Only two dependencies: `cryptography` (request signing)
  and `certifi` (TLS certificates).
- **Frontend:** a React + TypeScript single-page app (Vite, Tailwind, Radix UI), prebuilt into `web/dist` and
  served by the same Python server.
- **Storage:** plain JSON files in `data/polymarket/` (no database):
  - `profiles.json` – who you follow
  - `live_bets.json` – the feed of detected trader bets (last 300)
  - `closed/<wallet>.json` – each trader's full settled-bet history
  - `us_copy.json` – bot settings; `us_tickets.json` – every copy decision (bought, skipped, sold) and its P/L
  - `us_keys.json` – your Polymarket US API key (file permission 600, never sent to the browser)
  - `copysims.json` – paper-trading sims; `us_events.json` – .com→.us event mapping cache
  - `phone.json` – phone-alert settings; `us_manual_seen.json` – your own app sells already accounted for
- **Background threads** (start with the server):
  - trader watcher: every 30 s per followed wallet (plus a WebSocket listener)
  - paper sims settler: every 60 s
  - real-money settler + manual-sell sync + ticket expiry: every 10 min
  - take-profit checker: every 15 s
- **Modules:** `polyprofiles.py` (watching traders, their records, Best Bets), `polyus.py` (real-money bot),
  `copysim.py` (paper money), `phonepush.py` (Telegram / ntfy), `alerts.py` (in-app + Mac notifications),
  `server.py` (HTTP API), `sources.py` (HTTPS helper), `config.py` (paths, port).

## 3. Data sources (all official Polymarket APIs)

polymarket.com, public, no key:
- Data API (`data-api.polymarket.com`): `/positions`, `/activity`, closed positions, leaderboard (P/L, volume, rank)
- Gamma API: profile search (turn an @handle into a wallet), market lookups, live/closed market status
- CLOB order books: live prices
- Live-data WebSocket: every trade on the site in real time

Polymarket US:
- Public gateway (`gateway.polymarket.us`): events, markets, best bid/offer, settlement, search
- Authenticated trading API (`api.polymarket.us`): balances, orders, positions, account activity, close-position.
  Every request is signed with your Ed25519 private key over `timestamp + method + path`
  (headers X-PM-Access-Key / X-PM-Timestamp / X-PM-Signature).

## 4. Step 1 – Detecting a trader's bet

Every 30 seconds, for each followed wallet, the bot:
1. Reads their `/positions` and diffs it against the previous snapshot:
   - size and cost both up (by $5+) → a BUY at (Δcost / Δsize)
   - size down → a SELL at the current price (with their cost basis, so their realized P/L is known)
   - a position gone that didn't resolve (price was between 2¢ and 98¢) → a full SELL
   Position-diffing is used because Polymarket's live feed misses limit-order fills; positions are ground truth.
2. Reads their `/activity` only to mark fills as already seen (so nothing is double-counted).

Fills are grouped per (trader, outcome, side) until they go quiet for 45 s or 4 min passes – so a trader who buys
one bet as dozens of small fills produces one "bet". Bets under $25 are ignored.

First look at a newly followed trader produces no alerts (avoids treating hours-old bets as new), but runs a
**catch-up**: any open position above your copy floor, on a game that hasn't started, with no ticket yet, goes
through the copier as if just placed (still subject to the price limit).

Each detected bet then fans out to: the live feed, the paper sims, the real-money bot, an in-app alert, a
"Best bet" alert if another followed trader holds the same outcome, and a phone push if it's over your threshold.

## 5. Step 2 – Matching to the same market on Polymarket US

The two sites list the same games under different identifiers, so the bot translates:
- **Event:** same slug in most cases; strips .com's `-more-markets` suffix; fixes league codes that differ
  (e.g. `fifwc`→`fwc`, `fl1`→`lg1`); tries ±1 day because .com dates games in UTC and .us in Eastern time
  (a night game is a different date); falls back to the US search by team names on the same date. Results cached.
- **Market** (full-game only – no halves, quarters, team totals, props, futures):
  - Spread: same team at the same line (e.g. Temple −19.5)
  - Total: same O/U line; Over = the YES/long side
  - Moneyline: same team (fuzzy team-name matching against name / alias / abbreviation)
  - Soccer: "Will X win" and "end in a draw" map to the US full-time winner / draw markets
- It records which side of the US market is "long" (YES) vs "short" (NO), since that changes how orders are priced.

Anything it can't match identically is skipped with the reason written down (e.g. "no 45.5 total on the US game").

## 6. Step 3 – Deciding whether to copy (checked in this order)

1. **Too late:** the bet reached the bot 45+ minutes after it happened → skip.
2. **Too small:** the trader's total on that outcome (their buys in the last 3 days, or their whole position,
   whichever is larger) is under their floor → skip. Current floors: Kch-Temp $5K; primm, ArielFilipino,
   alwaysfade $10K. These came from studying their history: e.g. primm's bets lost 1–19% when copied at every
   size except $10K+, which returned +11.5% over 458 bets; ArielFilipino under $10K ran −6% to −17%.
3. **No US match** (section 5) or no one selling on the US market → skip.
4. **Price too high:** their price + 1¢ above your max (83¢) → skip.
5. **Long shot:** their price or the US price under your min (30¢) → skip (their tested record at 30¢+ was
   378 bets, +14% copied; only 11 bets below that).
6. **Price moved:** the US ask is above the limit (their price + 1¢, capped at your max) → skip. The bot never
   chases a move.
7. **Sizing:** `want = min(stake × (their total ÷ their usual bet), max per bet) − what you already put in`.
   "Their usual bet" = the median of their settled positions of $25+. So a bet twice their usual gets 2× your
   stake. If they add to a position, the bot tops up, up to the per-bet cap. Under $1 → skip.
8. **Mode Off** → recorded as a paper ticket only.
9. **Daily limits:** bets today ≥ per-day count, or today's spend + this bet > daily $ cap → skip.
10. Otherwise → a **ready** ticket. In **Ask** mode you get an alert and have 10 minutes to press Place; in
    **Auto** mode it's placed immediately.

Every decision, including skips and their reasons, is saved as a ticket, so the record shows what it did and why.

## 7. Step 4 – Placing the order

- Re-reads the US ask; if it's now above the limit, skips ("price moved").
- Stake = min(want, your buying power). Quantity = stake ÷ limit, rounded down to 0.01 contracts; under 1
  contract → skip.
- Sends a **limit order, immediate-or-cancel**, at the limit price: it fills whatever is available at or below the
  limit and cancels the rest. It can never pay more than their price + 1¢.
- Buying NO is expressed as selling YES: a NO limit of L is a YES price of 1 − L (`BUY_SHORT` intent).
- Records shares filled, cost, exchange fee and average price; sends an in-app alert and (if set up) a phone push
  like "🚨 BOUGHT $18 OF UNDER 52.5 @ 52¢ FOR THE COMMANDERS VS. 49ERS GAME, COPYING KCH-TEMP".

## 8. Step 5 – Exits

1. **Follow the trader's sell** (on by default): when they sell an outcome you hold, the bot closes your whole US
   position via `close-position`, allowing at most 2 ticks of slippage from the current bid.
2. **Take profit** (per trader; currently Kch-Temp at +100%, others hold): every 15 s it computes your gain if
   sold at the current bid, after the estimated fee (0.0695 × p × (1 − p) per contract), and sells at the target.
   Chosen from their history: Kch-Temp +100% returned +33.5% vs +30.5% holding (201 bets); for primm's $10K+ bets
   holding (+19.6%) beat every take-profit level, so his are held.
3. **Your Sell button** on any open copy.
4. **Sells you make yourself in the Polymarket US app** are detected from your account activity and credited to
   the right bot tickets, so the P/L reflects what you actually got.
5. **Settlement:** every 10 minutes it reads the US settlement; win pays $1 per contract held.

There is **no stop-loss**: a position is not sold just because its price falls.

## 9. P/L accounting

- Per ticket: `P/L = (contracts still held × $1 if won, else $0) + cash from any sells − cost − fees`.
- Partial sells are split across your open buys of that outcome in proportion to the contracts each still holds,
  with cost basis allocated the same way; each sell records its own profit.
- The page shows the real-money record (wins, losses, open, total P/L, total staked), today's bet count and spend,
  and for each open copy: its current value at the US midpoint, plus a **sell-or-hold suggestion** comparing what
  selling now nets (bid less fee) with holding at the "fair" price from polymarket.com (the bigger market), whether
  the trader still holds it, and the take-profit test from their history. The suggestion is display only; it doesn't
  trigger sells.
- **Copy now:** a bet skipped because of a matching problem or error (not because of your rules) can be copied with
  one click while the game is still open; the price limit still applies.

## 10. Paper money (copy sims)

Separate from the real bot. Each sim has its own bankroll (default $1,000), stake (default $100), per-outcome cap,
max price, minimum trader bet, and which traders it copies:
- **copy** mode: every bet of the chosen traders. **best** mode: only outcomes N of them hold (consensus).
- Entries at their price + 1¢ (never a better fill than them); late bets at the current price, and skipped if the
  price moved past theirs + 1¢. Same 45-minute lateness rule as the real bot.
- Same sizing as the real bot (stake × their bet ÷ their usual). Adds when they add.
- Exits: sells at their price − 1¢ when they sell, otherwise held to the result (checked every minute).
- **Backtest:** runs a sim's rules over each trader's full settled history (at their average price + 1¢) – a rough
  guide, since it uses their average fill, not their first.

## 11. The People page (research tools)

For each followed trader: all-time P/L, volume and leaderboard rank, open bets, recent activity (fills merged into
bets), and their full record broken down by sport, market type (moneyline, spread, total, props…), bet size bucket
and entry price bucket.

- **Best Bets:** outcomes two or more followed traders hold, with how past overlaps graded.
- **Take now:** their buys from the last 3 days that are still open and still within 5¢ of their price, scored by
  how their past bets of the same kind did if copied. Groups: sport + market type, bet size, entry price. Each
  group's return is shrunk by `n / (n + 40)` (a 20-bet group counts a third) so small samples don't dominate, then
  averaged; re-scored at today's price (paying more earns less). For traders the bot copies, only bets above their
  floor are shown.
- Follow anyone by polymarket.com/@name link, @handle or wallet address.

## 12. Notifications

- In-app alerts (with sounds); if no page is open, a Mac notification.
- Phone: your own Telegram bot (linked by tapping Start on a one-time code) or the ntfy app. The bot's own buys and
  sells always push when phone alerts are on; followed traders' bets push above a $ threshold you set, per person.

## 13. Your current live settings

Auto mode · $5 normal bet · $20 max per bet · 10 bets/day · $200/day · 30¢–83¢ · their price + 1¢ max ·
follow sells on · copying Kch-Temp ($5K+, take profit +100%) and ArielFilipino ($10K+, hold) · primm and
alwaysfade off. Real cap right now is your buying power.

## 14. Honest limitations

- It's a follower: the edge is the traders' and the bot only keeps it if it can get within 1¢ of their price.
  Polymarket's feed can lag up to ~20 minutes; anything that moved is skipped, so some good bets are missed.
- The rules (floors, price band, take-profit levels) come from historical studies, some on small samples
  (38–200 bets). Past results don't guarantee future ones; they should be re-checked on newer data.
- No stop-loss and no line-movement / expected-value model – entries are rule-based filters, not forecasts.
- Only full-game moneylines, spreads, totals and soccer win/draw are copied; props, halves and futures aren't.
- US and .com markets must match exactly (same line, same settlement source) or the bet is skipped.
- It only runs while the computer is on and the server window is open.
- The research scripts that produced the thresholds aren't included in this folder; only their results are,
  as notes in the code.
