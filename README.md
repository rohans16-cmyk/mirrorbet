# PolyShadow

A copy-trading bot for prediction markets. PolyShadow watches selected traders on [polymarket.com](https://polymarket.com),
detects each bet they place, decides whether it's worth copying using rules derived from their historical results, and
places the same bet with real money on [Polymarket US](https://polymarket.us), within strict price and size limits.
Paper-trading simulations run alongside it, so strategies can be compared without risking money.

Everything runs locally on your own computer; nothing is sent anywhere except to Polymarket (and your phone, if you set
up alerts).

> Full technical walkthrough: [POLYSHADOW_EXPLAINED.md](POLYSHADOW_EXPLAINED.md)

## Features

- **Trader tracking:** follow anyone by `polymarket.com/@name` link, @handle or wallet. See their P/L, open bets,
  activity, and full record broken down by sport, market type, bet size and entry price.
- **Real-money copy bot (Polymarket US):** copies qualifying bets automatically (**Auto**) or after you confirm each one
  (**Ask**), with limit orders that never pay more than the trader's price + 1¢.
- **Exits:** sells when the trader sells, at a per-trader take-profit target, when you press Sell, or at settlement.
  Sells you make yourself in the Polymarket US app are detected and credited to the right bets.
- **Risk limits:** normal bet size, max per bet, max per day, max bets per day, and an allowed price range.
- **Paper money:** simulated copies of any trader or group of traders (including "consensus" bets two or more of them
  hold), graded on real results, plus backtests over their full history.
- **Research views:** "Best Bets" (outcomes several followed traders hold) and "Take now" (recent bets scored by how
  the trader's similar past bets performed, with shrinkage for small samples).
- **Alerts:** in-app and macOS notifications, plus phone pushes via your own Telegram bot or the free ntfy app.

## How it works

1. **Detect:** every 30 s the bot reads each followed wallet's positions from Polymarket's public API and diffs them
   against the last snapshot. Fills are grouped into one bet per trader and outcome.
2. **Match:** finds the identical market on Polymarket US (same game, same line, same side), handling differences in
   event naming, league codes and time zones. Full-game moneylines, spreads, totals and soccer win/draw are supported.
3. **Filter:** copies only if the trader's total on the outcome is above their floor, the bet arrived within 45
   minutes, the price is inside your range, and Polymarket US still sells it at no more than their price + 1¢.
4. **Size:** `your bet = normal bet × (their bet ÷ their usual bet)`, capped by your per-bet and daily limits and your
   buying power. Adds by the trader are topped up to the cap.
5. **Execute:** an immediate-or-cancel limit order through the signed Polymarket US trading API.
6. **Exit and account:** follows their sells, applies take-profit targets, settles results, and tracks P/L per bet
   including fees and partial sells.

Every decision, including skips and the reason for each, is recorded, so the history shows exactly what the bot did
and why.

## Tech stack

| Layer | Technology |
|---|---|
| Backend | Python 3.10+ (standard library HTTP server, threads, WebSocket client), `cryptography` (Ed25519 request signing), `certifi` |
| Frontend | React 19, TypeScript, Vite, Tailwind CSS v4, Radix UI / shadcn/ui, lucide-react |
| Storage | JSON files on disk (no database) |
| APIs | Polymarket data, Gamma, CLOB and live-data WebSocket; Polymarket US public gateway and authenticated trading API; Telegram Bot API / ntfy |

## Project layout

```
server.py         HTTP server and API routes (http://polyshadow.localhost:8100)
polyprofiles.py   following traders: detection, records, Best Bets, Take now, US event matching
polyus.py         real-money bot: market matching, copy rules, sizing, orders, exits, settlement, P/L
copysim.py        paper-money copy simulations and backtests
phonepush.py      phone alerts (Telegram / ntfy)
alerts.py         in-app and macOS notifications
sources.py        HTTPS helper
config.py         paths and port
web/              React frontend (prebuilt into web/dist)
data/             your local data (not in git)
```

## Getting started

Requires Python 3.10+.

```bash
git clone https://github.com/rohans16-cmyk/polyshadow.git
cd polyshadow
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python server.py
```

Then open http://polyshadow.localhost:8100 (http://localhost:8100 works too). On a Mac you can instead double-click
`start.command` (Windows: `start.bat`).

Chrome, Edge and Firefox open `polyshadow.localhost` on their own. Safari needs it added to `/etc/hosts` once:

```bash
echo "127.0.0.1 polyshadow.localhost" | sudo tee -a /etc/hosts
```

A fresh clone starts with no followed traders and no history: add traders on the **People** tab. The `data/` folder
is created on first run.

### Connecting Polymarket US (optional, real money)

The real-money bot is off until you turn it on.

1. On polymarket.us, create an API key (Account → API keys).
2. Open the **Real money** tab and paste the key ID and secret. They're stored only in `data/polymarket/us_keys.json`
   (file permission 600) and never sent to the browser.
3. Open **Bot settings** (gear icon), set your limits first, then choose **Ask me** or **Auto**.

### Running it in the background (macOS)

The bot only works while the server is running and the computer is awake. To run it as a LaunchAgent that starts at
login, restarts if it stops, and prevents idle sleep, create `~/Library/LaunchAgents/com.<you>.polyshadow.plist` running
`/usr/bin/caffeinate -i <path>/.venv/bin/python -u server.py` with `WorkingDirectory` set to the project, `RunAtLoad`
and `KeepAlive` true, then:

```bash
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.<you>.polyshadow.plist   # start
launchctl bootout gui/$(id -u)/com.<you>.polyshadow                                  # stop
```

### Changing the frontend

The page is prebuilt in `web/dist`. To modify it (Node 20+):

```bash
cd web && npm install && npm run build
```

## Default copy rules

These came from studying the original traders' past results and can all be changed in Bot settings:

- Copy only bigger bets (per-trader floor, e.g. $5K or $10K total on the outcome); smaller ones lost money when copied.
- Price between 30¢ and 83¢; never more than 1¢ above the trader's price.
- Follow the trader's sells; optional per-trader take-profit (e.g. +100%).

## Limitations

- It's a follower: the edge belongs to the traders, and it's only kept if the bot can buy within 1¢ of their price.
  Polymarket's feed can lag, and bets whose price has moved are skipped.
- The rules come from historical analysis, some on small samples. Past results don't guarantee future ones.
- No stop-loss and no forecasting model: entries are rule-based filters, not predictions.
- Props, halves and futures aren't copied, and markets must match exactly on both sites.
- Runs only while your computer is on and awake.

## Security

`data/` is git-ignored because it holds your Polymarket US API key and personal trading history. Never commit
`data/polymarket/us_keys.json`. The server listens on `127.0.0.1` only.

## Disclaimer

For personal and educational use. Trading prediction markets involves risk of loss. Check that prediction-market
trading is legal where you live, and start small.
