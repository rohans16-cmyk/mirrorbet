# Polybot

Follow Polymarket traders, see every bet they make, paper-trade copies of them, and (if you want) let a bot copy them
with real money on **Polymarket US**. Everything runs on your own computer; nothing is sent anywhere except to
Polymarket (and your phone, if you set up phone alerts).

## Start

- **Mac:** double-click `start.command` (first time: right-click → Open, since it's from the internet).
- **Windows:** double-click `start.bat`.
- **Anything else:** `python3 -m venv .venv && .venv/bin/pip install -r requirements.txt && .venv/bin/python server.py`

Then open http://localhost:8100 (the start script opens it for you). A **Get started** guide at the top walks
through setup and ticks off each step as you do it. Needs Python 3.10+. Leave the window open: the bot
only runs while it does. Ctrl+C stops it.

## What's in it

- **People:** the traders you follow (Kch-Temp, primm, ArielFilipino and alwaysfade to start), with their open bets,
  activity and full record broken down by sport, market, bet size and price. Follow anyone with their
  polymarket.com/@name link.
- **Best Bets:** outcomes two or more of them hold.
- **Paper money:** practice copies of each person's bets, sized like theirs, graded on the real results. Already has a
  few days of history.
- **Real money:** the copy bot on your Polymarket US account.

## The real-money bot

It's **off** until you turn it on. To use it:

1. On polymarket.us, create an API key (Account → API keys).
2. Open the **Real money** tab and paste the key ID and secret. They're saved only in `data/polymarket/us_keys.json`
   on this computer.
3. Open **Bot settings** (the gear icon). Set your limits first: what to bet when they bet their usual size, the most a
   bet and a day, how many bets a day. Then pick **Ask me** (you confirm each one) or **Auto** (it places them).

Rules it already has (from studying these traders' past results):

- It only copies each person's bigger bets: Kch-Temp from $5K, primm / ArielFilipino / alwaysfade from $10K (their
  total on the outcome). Their smaller bets lost money when copied.
- Nothing under 30¢ (long shots weren't part of what worked) or over 83¢.
- It sells when they sell. Kch-Temp's copies also auto-sell at +100%; the rest are held to the result.
- If you sell a copy yourself in the Polymarket US app, the bot notices and counts what you actually made.

All of it can be changed in Bot settings. Past results don't promise future ones: start small.

## Phone alerts

Bot settings → Phone alerts: big bets from the people you follow, pushed to your phone through your own Telegram bot or
the free ntfy app.

## Your data

Everything is in `data/` (plain JSON files). To move to another computer, copy the whole folder. Don't share
`data/polymarket/us_keys.json`: it's your account key.

## Changing the page

The page is prebuilt in `web/dist`. To change it: `cd web && npm install && npm run build` (needs Node 20+).
