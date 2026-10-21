import { useEffect, useMemo, useState } from "react";
import {
  Bell,
  BellOff,
  ExternalLink,
  Loader2,
  Plus,
  Settings2,
  Trash2,
  X,
} from "lucide-react";
import { EmptyState, LoadError } from "@/components/ui/EmptyState";
import { ask } from "@/components/ui/ask";
import { PaperBets } from "@/components/PaperBets";
import { eventUrl, pickLabel } from "@/lib/polybet";
import { BotSettings, Pager, PolyUS, WINDOW_PAGE } from "@/components/PolyUS";
import {
  Chips,
  PageHead,
  Section,
  TabBar,
  Tiles,
} from "@/components/ledger/Kit";

type Act = {
  type: string;
  side: string;
  title: string;
  outcome: string;
  slug: string;
  icon: string;
  shares: number;
  usd: number;
  price: number | null;
  at: number;
  fills: number;
  sport: string;
};
type Pos = {
  title: string;
  outcome: string;
  slug: string;
  shares: number;
  avg: number;
  cur: number;
  cost: number;
  value: number;
  pnl: number;
  end: string;
  icon: string;
};
// flat = summed per-bet ROI: flat / bets is the ROI of copying every bet for the same amount
type Group = {
  name: string;
  w: number;
  l: number;
  pnl: number;
  cost: number;
  flat: number;
};
type Dim = "sport" | "kind" | "combo" | "size" | "price" | "pick" | "month";
type FDim = "sport" | "kind" | "size" | "price" | "pick"; // the dims a filter can pin
// settled bets summed per (sport, market, size, price, pick, day), as polyprofiles.record sends them (CELL_COLS):
// size / price index the bucket labels, flat is the summed per-bet ROI
type CellRow = [
  number,
  number,
  number,
  number,
  number,
  string,
  string,
  number,
  number,
  string,
  string,
];
type RecordData = {
  ok: boolean;
  error?: string;
  cells: CellRow[];
  sizes: string[];
  prices: string[];
};
type Bet = {
  w: number;
  l: number;
  flat: number;
  pnl: number;
  cost: number;
  sport: string;
  kind: string;
  size: string;
  price: string;
  pick: string;
  end: string;
  sizeI: number;
  priceI: number;
};
type Profile = {
  handle: string;
  wallet: string;
  name: string;
  alerts: boolean;
  phone_min?: number | null;
  error?: string;
  pnl?: number | null;
  volume?: number | null;
  rank?: string | null;
  record?: {
    w: number;
    l: number;
    pnl: number;
    cost: number;
    avg_price: number | null;
  };
  // false while a new profile's whole settled history is still being read (in the background)
  history?: { complete: boolean; n: number };
  open?: Pos[]; // the biggest 200
  open_n?: number;
  open_value?: number;
  activity?: Act[];
};
type LiveBet = {
  id: string;
  wallet: string;
  name: string;
  side: string;
  title: string;
  outcome: string;
  slug: string;
  usd: number;
  price: number;
  fills: number;
  at: string;
};
type Person = {
  name: string;
  wallet: string;
  avg: number | null;
  cost: number;
  pnl: number;
  status: string;
};
type Shared = {
  asset: string;
  title: string;
  outcome: string;
  slug: string;
  icon: string;
  status: "open" | "won" | "lost";
  price: number | null;
  cur: number | null;
  stake: number;
  end: string;
  people: Person[];
  against: string[];
};
type Clash = {
  title: string;
  slug: string;
  icon: string;
  end: string;
  open: boolean;
  sides: {
    name: string;
    outcome: string;
    avg: number | null;
    cost: number;
    status: string;
  }[];
};
// a followed profile's fresh bet you can still take, scored by how his similar settled bets did copied flat
// (polyprofiles.take_now)
type Take = {
  wallet: string;
  name: string;
  title: string;
  outcome: string;
  slug: string;
  icon: string;
  avg: number;
  cur: number;
  cost: number;
  end: string;
  at: number;
  factors: { dim: string; name: string; n: number; copy: number }[];
  score: number;
  now: number;
};
type Best = {
  open: Shared[];
  settled: Shared[];
  clash: Clash[];
  record: {
    w: number;
    l: number;
    pnl: number;
    staked: number;
    avg_price: number | null;
  };
};
type Data = {
  ok: boolean;
  error?: string;
  profiles: Profile[];
  best: Best;
  take?: Take[];
  live: LiveBet[];
  stream: { connected: boolean; error: string | null };
};

const usd = (x: number | null | undefined, sign = false) => {
  if (x == null) return "–";
  const a = Math.abs(x);
  const s =
    a >= 1e6
      ? `$${(a / 1e6).toFixed(2)}M`
      : a >= 1e4
        ? `$${(a / 1e3).toFixed(1)}K`
        : `$${a.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  return x < 0 ? `−${s}` : sign ? `+${s}` : s;
};
const cents = (p: number | null | undefined) =>
  p == null ? "" : `${Math.round(p * 100)}¢`;
const ago = (sec: number) => {
  const m = Math.max(0, (Date.now() / 1000 - sec) / 60);
  return m < 60
    ? `${Math.round(m)}m`
    : m < 1440
      ? `${Math.round(m / 60)}h`
      : `${Math.round(m / 1440)}d`;
};
// one decimal near the ends: 4,399–21 is 99.5%, not "100%"
const winPct = (w: number, l: number) => {
  const x = (100 * w) / Math.max(1, w + l);
  return `${x >= 99 || x <= 1 ? x.toFixed(1) : Math.round(x)}%`;
};
const tone = (x: number) =>
  x > 0 ? "text-emerald-300" : x < 0 ? "text-red-300" : "text-zinc-300";

/** Polymarket profiles you follow: record, open bets, activity (a bet's fills merged), and a live alert when one
 *  places a bet (polyprofiles.py). */
export function PolyProfiles() {
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  // always opens on People (never the last tab)
  const [page, setPage] = useState<"people" | "best" | "paper" | "us">("people");
  const [text, setText] = useState("");
  const [adding, setAdding] = useState(false);
  const [addErr, setAddErr] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [settings, setSettings] = useState(false);

  const load = () => {
    setRefreshing(true);
    return fetch("/api/polymarket/profiles")
      .then((r) => r.json())
      .then((x: Data) =>
        x.ok
          ? (setD(x), setErr(null))
          : setErr(x.error || "Could not load the profiles"),
      )
      .catch(() => setErr("Cannot reach the server"))
      .finally(() => setRefreshing(false));
  };
  // every minute; every 10s while someone's history is still being read, so it lands without a reload
  const reading = !!d?.profiles.some((x) => x.history && !x.history.complete);
  useEffect(() => {
    if (!d) load();
    const id = setInterval(load, reading ? 10000 : 15000);
    return () => clearInterval(id);
  }, [reading]); // eslint-disable-line react-hooks/exhaustive-deps

  const post = (body: object) =>
    fetch("/api/polymarket/profiles", {
      method: "POST",
      body: JSON.stringify(body),
    }).then((r) => r.json());
  const add = async () => {
    if (!text.trim()) return;
    setAdding(true);
    setAddErr(null);
    const r = await post({ text }).catch(() => ({
      ok: false,
      error: "Cannot reach the server",
    }));
    setAdding(false);
    if (!r.ok) return setAddErr(r.error);
    setText("");
    setSel(r.profile.wallet);
    load();
  };

  if (err && !d) return <LoadError err={err} retry={load} />;
  if (!d) return <Skeleton />;
  const p = d.profiles.find((x) => x.wallet === sel) ?? d.profiles[0];
  const takeN = (d.take ?? []).filter((x) => x.now >= TAKE_MIN).length;
  const hint = {
    people: "",
    best: "Their newest bets you can still take, ranked by how their similar bets have done.",
    paper: "Practice with fake money: copies of their bets, sized like theirs, at their price +1¢.",
    us: "Your Polymarket US account: the bot copies the people in Bot settings, each from their minimum bet, with real money.",
  }[page];

  const addForm = (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        add();
      }}
      className="flex items-center gap-2"
    >
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Profile link or @handle"
        className="w-56 rounded-full bg-white/[0.05] px-4 py-1.5 text-sm text-white ring-1 ring-white/10 placeholder:text-zinc-500 focus:outline-none focus:ring-violet-400/60"
      />
      <button
        disabled={adding}
        className="flex items-center gap-1 rounded-full bg-violet-600 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-violet-500 disabled:opacity-60"
      >
        {adding ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Plus className="size-4" />
        )}{" "}
        Follow
      </button>
    </form>
  );
  return (
    <div className="space-y-5">
      <PageHead
        title="Polymarket"
        right={
          <div className="flex flex-col items-end gap-1">
            <div className="flex items-center gap-3">
              {refreshing && (
                <Loader2
                  className="size-3.5 animate-spin text-zinc-500"
                  aria-label="Updating"
                />
              )}
              <span
                title={
                  d.stream.connected
                    ? "Watching every Polymarket trade"
                    : d.stream.error || "Not connected"
                }
                className={`flex items-center gap-1.5 text-xs ${d.stream.connected ? "text-emerald-300" : "text-zinc-500"}`}
              >
                <span
                  className={`size-2 rounded-full ${d.stream.connected ? "animate-pulse bg-emerald-400" : "bg-zinc-600"}`}
                />
                {d.stream.connected ? "Live" : "Offline"}
              </span>
              <button
                onClick={() => setSettings(true)}
                title="Bot settings"
                aria-label="Bot settings"
                className="rounded-full p-2 text-zinc-400 transition hover:bg-white/[0.06] hover:text-white"
              >
                <Settings2 className="size-4" />
              </button>
              {addForm}
            </div>
            {(addErr || err) && (
              <span className="text-xs text-red-300">
                {addErr || `Couldn't update: ${err}`}
              </span>
            )}
          </div>
        }
      />

      {/* the bot's settings window, phone alerts included (asked 2026-10-19: the phone icon became this) */}
      <BotSettings open={settings} onOpenChange={setSettings} onChange={load} />

      {!p ? (
        <EmptyState
          title="No profiles yet"
          hint="Paste a polymarket.com/@name link to follow someone."
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <TabBar
              value={page}
              onChange={setPage}
              tabs={[
                ["people", "People"],
                [
                  "best",
                  takeN + d.best.open.length
                    ? `Best Bets · ${takeN + d.best.open.length}`
                    : "Best Bets",
                ],
                ["paper", "Paper money"],
                ["us", "Real money"],
              ]}
            />
            {hint && <span className="text-xs text-zinc-500">{hint}</span>}
          </div>

          {page === "us" ? (
            <PolyUS />
          ) : page === "paper" ? (
            <PaperBets />
          ) : page === "best" ? (
            <div className="space-y-6">
              <TakeNow rows={d.take ?? []} />
              <div className="space-y-3">
                <h2 className="text-sm font-semibold text-zinc-300">
                  When two or more agree
                </h2>
                <BestBets b={d.best} people={d.profiles.length} />
              </div>
            </div>
          ) : (
            <PeoplePanel d={d} sel={sel} setSel={setSel} load={load} post={post} />
          )}
        </>
      )}
    </div>
  );
}

/** The People page: someone's chips, tiles and Open / Activity / Record tables. The Polymarket page shows it under
 *  People and the Bot tab shows the same thing as its trader feed (asked 2026-10-19: "reuse the same exact tables as
 *  the full app polymarket tab to show trader feed in the bot tab"). */
function PeoplePanel({
  d,
  sel,
  setSel,
  load,
  post,
}: {
  d: Data;
  sel: string | null;
  setSel: (w: string | null) => void;
  load: () => unknown;
  post: (body: object) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [view, setView] = useState<"activity" | "open" | "record">("open");
  const [pending, setPending] = useState<"alerts" | "remove" | null>(null);
  const iconBtn =
    "rounded-full p-2 transition hover:bg-white/[0.06] hover:text-white";
  const p = d.profiles.find((x) => x.wallet === sel) ?? d.profiles[0];
  if (!p) return null;
  const mid = !!p.history && !p.history.complete; // his record isn't all in yet
  // the bets an alert went out for, marked on their Activity rows
  const alerted = new Set(
    d.live
      .filter((x) => x.wallet === p.wallet)
      .map((x) => `${x.slug}|${x.outcome}|${x.side}`),
  );
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {d.profiles.map((x) => (
          <button
            key={x.wallet}
            onClick={() => setSel(x.wallet)}
            className={`rounded-full px-3 py-1 text-sm font-semibold ring-1 transition ${x.wallet === p.wallet ? "bg-white text-black ring-white" : "text-zinc-400 ring-white/10 hover:text-white"}`}
          >
            {x.name}
          </button>
        ))}
        <span className="ml-auto flex items-center">
          <a
            href={`https://polymarket.com/@${p.handle}`}
            target="_blank"
            rel="noreferrer"
            title="Open on Polymarket"
            className={`${iconBtn} text-zinc-500`}
          >
            <ExternalLink className="size-4" />
          </a>
          <button
            disabled={pending != null}
            onClick={async () => {
              setPending("alerts");
              await post({
                action: "alerts",
                wallet: p.wallet,
                on: !p.alerts,
              }).catch(() => null);
              await load();
              setPending(null);
            }}
            title={
              p.alerts
                ? "Alerts on: tap to mute"
                : "Alerts off: tap to turn on"
            }
            className={`${iconBtn} ${p.alerts ? "text-violet-300" : "text-zinc-500"}`}
          >
            {pending === "alerts" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : p.alerts ? (
              <Bell className="size-4" />
            ) : (
              <BellOff className="size-4" />
            )}
          </button>
          <button
            onClick={async () => {
              if (
                !(await ask.confirm(`Stop following ${p.name}?`, {
                  ok: "Remove",
                  danger: true,
                }))
              )
                return;
              setPending("remove");
              await post({ action: "remove", wallet: p.wallet }).catch(
                () => null,
              );
              setSel(null);
              await load();
              setPending(null);
            }}
            disabled={pending != null}
            title="Stop following"
            className={`${iconBtn} text-zinc-500 hover:!text-red-300`}
          >
            {pending === "remove" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Trash2 className="size-4" />
            )}
          </button>
        </span>
      </div>

      {p.error ? (
        <LoadError err={p.error} retry={load} />
      ) : (
        <>
          <Tiles
            tiles={[
              {
                label: "Profit",
                value: usd(p.pnl, true),
                tone: (p.pnl ?? 0) >= 0 ? "good" : "bad",
                sub: p.rank ? `#${p.rank} all-time` : undefined,
              },
              {
                label: "Record",
                value: mid ? "…" : `${p.record!.w}–${p.record!.l}`,
                // the average price is the win rate it takes to break even (a 91¢ grinder needs 91%)
                sub: mid
                  ? "reading his history"
                  : `${winPct(p.record!.w, p.record!.l)} · needs ${p.record!.avg_price == null ? "–" : `${Math.round(p.record!.avg_price * 100)}%`}`,
              },
              {
                label: "ROI",
                value: mid
                  ? "…"
                  : p.record!.cost
                    ? `${((100 * p.record!.pnl) / p.record!.cost).toFixed(1)}%`
                    : "–",
                sub: `${usd(p.volume)} traded`,
              },
              {
                label: "Open",
                value: usd(p.open_value ?? 0),
                sub: `${(p.open_n ?? 0).toLocaleString()} bet${p.open_n === 1 ? "" : "s"}`,
              },
            ]}
          />

          <TabBar
            value={view}
            onChange={setView}
            tabs={[
              ["open", "Open"],
              ["activity", "Activity"],
              ["record", "Record"],
            ]}
          />

          {view === "activity" && (
            <ActivityList key={p.wallet} rows={p.activity!} alerted={alerted} />
          )}
          {view === "open" && <OpenList key={p.wallet} rows={p.open!} />}
          {view === "record" &&
            (mid ? (
              <Section>
                <div className="flex items-center gap-3 py-6 text-sm text-zinc-400">
                  <Loader2 className="size-5 shrink-0 animate-spin text-violet-300" />
                  <span>
                    Reading {p.name}'s whole history from Polymarket. A
                    big trader has thousands of bets, so this can take a
                    few minutes the first time; it fills in by itself.
                  </span>
                </div>
              </Section>
            ) : (
              <RecordView
                key={p.wallet}
                wallet={p.wallet}
                n={p.history?.n ?? 0}
              />
            ))}
        </>
      )}
    </>
  );
}

/** The People page on its own, loading the profiles itself: the Bot tab's trader feed (2026-10-19). */
export function TraderTables() {
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const load = () =>
    fetch("/api/polymarket/profiles")
      .then((r) => r.json())
      .then((x: Data) => (x.ok ? (setD(x), setErr(null)) : setErr(x.error || "Could not load the profiles")))
      .catch(() => setErr("Cannot reach the server"));
  useEffect(() => {
    load();
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, []);
  const post = (body: object) =>
    fetch("/api/polymarket/profiles", { method: "POST", body: JSON.stringify(body) }).then((r) => r.json());
  if (err && !d) return <LoadError err={err} retry={load} />;
  if (!d) return <Skeleton />;
  if (!d.profiles.length) return null;
  return (
    <div className="space-y-4">
      <PeoplePanel d={d} sel={sel} setSel={setSel} load={load} post={post} />
    </div>
  );
}

function ActivityList({
  rows,
  alerted,
}: {
  rows: Act[];
  alerted: Set<string>;
}) {
  // by time (the feed's order) or by the dollar amount; filtered by what he did and the sport
  const [sort, setSort] = useState<"new" | "big" | "small">("new");
  const [kind, setKind] = useState<"all" | "Buy" | "Sell" | "Cashed">("all");
  const [sport, setSport] = useState("");
  // 25 a page (asked 2026-10-19: "add pagination to the tables on the bot tab"); back to the first on a new filter
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [sort, kind, sport]);
  if (!rows.length) return <EmptyState title="No activity yet" />;
  // Polymarket's words, plainly: a REDEEM is collecting a settled bet's payout and a MERGE trades both sides back
  // for $1; either way he took the money ("Cashed", the user's word)
  const label = (a: Act) =>
    a.type === "TRADE"
      ? a.side === "SELL"
        ? "Sell"
        : "Buy"
      : a.type === "REDEEM" || a.type === "MERGE"
        ? "Cashed"
        : a.type[0] + a.type.slice(1).toLowerCase();
  const count = (k: string) =>
    rows.filter((a) => (!sport || a.sport === sport) && label(a) === k).length;
  const sports = [...new Set(rows.map((a) => a.sport).filter(Boolean))].sort();
  const shown = rows.filter(
    (a) =>
      (kind === "all" || label(a) === kind) && (!sport || a.sport === sport),
  );
  const sorted =
    sort === "new"
      ? shown
      : [...shown].sort((a, b) =>
          sort === "big" ? b.usd - a.usd : a.usd - b.usd,
        );
  const total = shown.reduce((a, x) => a + (x.usd || 0), 0);
  return (
    <Section pad={false}>
      <div className="flex flex-wrap items-center gap-2 border-b border-white/[0.06] px-4 py-3">
        <Chips
          value={kind}
          onChange={setKind}
          chips={[
            ["all", "All"],
            ["Buy", `Buys ${count("Buy")}`],
            ["Sell", `Sells ${count("Sell")}`],
            ["Cashed", `Cashed ${count("Cashed")}`],
          ]}
        />
        {sports.length > 1 && (
          <select
            value={sport}
            onChange={(e) => setSport(e.target.value)}
            className={`rounded-full bg-white/[0.05] py-1 pl-3 pr-7 text-xs font-semibold ring-1 focus:outline-none ${sport ? "text-white ring-violet-400/60" : "text-zinc-400 ring-white/10"}`}
          >
            <option value="">All sports</option>
            {sports.map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </select>
        )}
        <span className="ml-auto flex items-center gap-3">
          <span className="text-xs tabular-nums text-zinc-500">
            {shown.length} · {usd(total)}
          </span>
          <Chips
            value={sort}
            onChange={setSort}
            chips={[
              ["new", "Newest"],
              ["big", "Biggest"],
              ["small", "Smallest"],
            ]}
          />
        </span>
      </div>
      {sorted.length === 0 && (
        <p className="px-4 py-6 text-sm text-zinc-500">
          Nothing matches. Try All or another sport.
        </p>
      )}
      <div className="divide-y divide-white/[0.06]">
        {sorted.slice(page * WINDOW_PAGE, (page + 1) * WINDOW_PAGE).map((a, i) => (
          <a
            key={`${a.at}|${a.slug}|${a.outcome}|${a.side}|${i}`}
            href={eventUrl(a.slug, a.title)}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-3 px-4 py-2.5 transition hover:bg-white/[0.03]"
          >
            <span
              className={`w-14 shrink-0 text-sm ${label(a) === "Cashed" ? "text-emerald-300" : label(a) === "Sell" ? "text-red-300" : "text-zinc-400"}`}
            >
              {label(a)}
            </span>
            {a.icon && (
              <img
                src={a.icon}
                alt=""
                className="size-8 shrink-0 rounded-md bg-white/[0.04] object-contain"
              />
            )}
            <span className="min-w-0 flex-1">
              {/* the pick itself ("Purdue +4.5"), then the market it's in: the title alone names the other side */}
              <span
                className={`block truncate text-sm font-medium ${a.side === "SELL" ? "text-red-300" : "text-white"}`}
              >
                {pickLabel(a.title, a.outcome)}
                {a.price != null && (
                  <span className="ml-1.5 font-normal text-zinc-400">
                    {cents(a.price)}
                  </span>
                )}
              </span>
              <span className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 truncate text-xs text-zinc-500">
                  {a.title}
                </span>
                {alerted.has(`${a.slug}|${a.outcome}|${a.side}`) && (
                  <span title="Alert sent" className="text-violet-300">
                    <Bell className="size-3.5" />
                  </span>
                )}
                <span className="text-xs text-zinc-500">
                  {Math.round(a.shares).toLocaleString()} shares
                  {a.fills > 1 ? ` · ${a.fills} fills` : ""}
                </span>
              </span>
            </span>
            <span className="shrink-0 text-right">
              <span className="block text-sm font-semibold text-white">
                {usd(a.usd)}
              </span>
              <span className="text-xs text-zinc-500">{ago(a.at)}</span>
            </span>
          </a>
        ))}
      </div>
      <div className="border-t border-white/[0.06] px-4 py-2 empty:hidden">
        <Pager
          page={page}
          n={sorted.length}
          setPage={setPage}
          labels={sort === "big" ? ["Bigger", "Smaller"] : sort === "small" ? ["Smaller", "Bigger"] : ["Newer", "Older"]}
        />
      </div>
    </Section>
  );
}

function OpenList({ rows }: { rows: Pos[] }) {
  const [page, setPage] = useState(0);
  if (!rows.length) return <EmptyState title="Nothing open" />;
  return (
    <Section pad={false}>
      <div className="divide-y divide-white/[0.06]">
        {rows.slice(page * WINDOW_PAGE, (page + 1) * WINDOW_PAGE).map((x, i) => (
          <a
            key={i}
            href={eventUrl(x.slug, x.title)}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-3 px-4 py-2.5 transition hover:bg-white/[0.03]"
          >
            {x.icon && (
              <img
                src={x.icon}
                alt=""
                className="size-8 shrink-0 rounded-md bg-white/[0.04] object-contain"
              />
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-white">
                {pickLabel(x.title, x.outcome)}
                <span className="ml-1.5 font-normal text-zinc-400">
                  {cents(x.avg)} → {cents(x.cur)}
                </span>
              </span>
              <span className="block truncate text-xs text-zinc-500">
                {x.title}
              </span>
            </span>
            <span className="shrink-0 text-right">
              <span className="block text-sm font-semibold text-white">
                {usd(x.value)}
              </span>
              <span className={`text-xs ${tone(x.pnl)}`}>
                {usd(x.pnl, true)}
              </span>
            </span>
          </a>
        ))}
      </div>
      <div className="border-t border-white/[0.06] px-4 py-2 empty:hidden">
        <Pager page={page} n={rows.length} setPage={setPage} labels={["Previous", "Next"]} />
      </div>
    </Section>
  );
}

const SMALL = 10; // fewer bets than this reads as noise (greyed)
const MIN_SPOT = 20; // a "Copy these" / "Skip these" group needs this many bets
const BREAKDOWNS: [Dim, string][] = [
  ["size", "Bet size"],
  ["price", "Price"],
  ["sport", "Sport"],
  ["kind", "Market"],
  ["combo", "Sport + market"],
  ["pick", "Pick"],
  ["month", "Month"],
];
const FDIMS: FDim[] = ["sport", "kind", "size", "price", "pick"];
const PERIODS = [
  ["all", "All time"],
  ["180", "6 months"],
  ["90", "90 days"],
  ["30", "30 days"],
] as const;
type Period = (typeof PERIODS)[number][0];
// how a group reads on its own ("Bets of $50k–200k", "Bought at 35–50¢")
const spotName = (dim: Dim, name: string) =>
  dim === "size"
    ? `Bets of ${name}`
    : dim === "price"
      ? `Bought at ${name}`
      : dim === "pick"
        ? `${name} picks`
        : name;

const monthOf = (end: string) =>
  end
    ? new Date(`${end.slice(0, 7)}-15`).toLocaleDateString(undefined, {
        month: "short",
        year: "numeric",
      })
    : "Unknown";

function tally(
  bets: Bet[],
  key: (b: Bet) => string,
  order?: (b: Bet) => number,
) {
  const m = new Map<string, Group & { order: number }>();
  for (const b of bets) {
    const k = key(b);
    const g = m.get(k) ?? {
      name: k,
      w: 0,
      l: 0,
      pnl: 0,
      cost: 0,
      flat: 0,
      order: order ? order(b) : 0,
    };
    g.w += b.w;
    g.l += b.l;
    g.pnl += b.pnl;
    g.cost += b.cost;
    g.flat += b.flat;
    m.set(k, g);
  }
  return [...m.values()].sort((a, b) =>
    order ? a.order - b.order : b.w + b.l - (a.w + a.l),
  );
}
// the return of betting the same amount on every bet in the group, in %
const copyPct = (g: { w: number; l: number; flat: number }) =>
  g.w + g.l ? (100 * g.flat) / (g.w + g.l) : 0;
const signed = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(0)}%`;

/** The Record tab (rebuilt 2026-10-16: seven tables and five dropdowns read as noise). What to copy and what to skip
 *  first, then one breakdown at a time; a period and any tapped group filter everything. "If you copied" is the
 *  return of betting the same amount on each of his bets, which is what following him earns; his own ROI is weighted
 *  by his stakes. Bets come from polyprofiles.record as summed cells. */
function RecordView({ wallet, n: total }: { wallet: string; n: number }) {
  const [rec, setRec] = useState<RecordData | null>(null);
  const [f, setF] = useState<Partial<Record<FDim, string>>>({});
  const [period, setPeriod] = useState<Period>("all");
  const [by, setBy] = useState<Dim>("size");
  // read again when his settled count changes (a bet settled since)
  useEffect(() => {
    let live = true;
    fetch(`/api/polymarket/record?wallet=${wallet}`)
      .then((r) => r.json())
      .then((x: RecordData) => live && setRec(x))
      .catch(
        () =>
          live &&
          setRec({
            ok: false,
            error: "Cannot reach the server",
            cells: [],
            sizes: [],
            prices: [],
          }),
      );
    return () => {
      live = false;
    };
  }, [wallet, total]);
  const bets = useMemo<Bet[]>(
    () =>
      (rec?.cells ?? []).map(
        ([w, l, pnl, cost, flat, sport, kind, size, price, pick, end]) => ({
          w,
          l,
          pnl,
          cost,
          flat,
          sport,
          kind,
          pick,
          end,
          size: rec!.sizes[size] ?? "?",
          price: rec!.prices[price] ?? "?",
          sizeI: size,
          priceI: price,
        }),
      ),
    [rec],
  );
  const inPeriod = useMemo(() => {
    if (period === "all") return bets;
    const cut = new Date(Date.now() - Number(period) * 864e5)
      .toISOString()
      .slice(0, 10);
    return bets.filter((b) => b.end >= cut);
  }, [bets, period]);

  if (!rec)
    return (
      <Section>
        <div className="flex items-center gap-3 py-6 text-sm text-zinc-400">
          <Loader2 className="size-5 shrink-0 animate-spin text-violet-300" />
          Loading {total.toLocaleString()} settled bets…
        </div>
      </Section>
    );
  if (!rec.ok) return <LoadError err={rec.error} />;

  // the bets matching every filter except those in `skip`
  const match = (...skip: FDim[]) =>
    inPeriod.filter((b) =>
      FDIMS.every((k) => skip.includes(k) || !f[k] || b[k] === f[k]),
    );
  const all = match();
  const table = (dim: Dim, rows: Bet[]) =>
    dim === "size"
      ? tally(
          rows,
          (b) => b.size,
          (b) => b.sizeI,
        )
      : dim === "price"
        ? tally(
            rows,
            (b) => b.price,
            (b) => b.priceI,
          )
        : dim === "combo"
          ? tally(rows, (b) => `${b.sport} · ${b.kind}`)
          : dim === "month"
            ? tally(
                rows,
                (b) => monthOf(b.end),
                (b) => -Number(b.end.slice(0, 7).replace("-", "") || 0),
              )
            : tally(rows, (b) => b[dim]);
  // a table leaves out its own filter, so "Sport" still lists every sport with the picked one lit
  const rowsFor = (dim: Dim) =>
    dim === "combo"
      ? match("sport", "kind")
      : dim === "month"
        ? all
        : match(dim);
  const lit = (dim: Dim, name: string) =>
    dim === "combo"
      ? name === `${f.sport} · ${f.kind}`
      : dim !== "month" && f[dim] === name;
  const pick = (dim: Dim, name: string) => {
    if (dim === "month") return;
    if (dim === "combo") {
      const [sport, kind] = name.split(" · ");
      const on = f.sport === sport && f.kind === kind;
      return setF((cur) => ({
        ...cur,
        sport: on ? undefined : sport,
        kind: on ? undefined : kind,
      }));
    }
    setF((cur) => ({ ...cur, [dim]: cur[dim] === name ? undefined : name }));
  };

  // Copy these / Skip these: groups of MIN_SPOT+ bets among what's shown, best and worst copy return, one per stat
  // line (a sport that's all one market would otherwise show twice)
  const spots: { dim: Dim; g: Group }[] = [];
  const seen = new Set<string>();
  for (const dim of [
    "size",
    "price",
    "sport",
    "kind",
    "combo",
    "pick",
  ] as Dim[]) {
    if (dim !== "combo" && f[dim as FDim]) continue;
    if (dim === "combo" && (f.sport || f.kind)) continue;
    for (const g of table(dim, all)) {
      const key = `${g.w}|${g.l}|${Math.round(g.pnl)}`;
      if (g.w + g.l < MIN_SPOT || seen.has(key) || g.w + g.l === all.length)
        continue;
      seen.add(key);
      spots.push({ dim, g });
    }
  }
  spots.sort((a, b) => copyPct(b.g) - copyPct(a.g));
  const good = spots.filter((x) => copyPct(x.g) >= 3).slice(0, 4);
  const bad = spots
    .filter((x) => copyPct(x.g) <= -3)
    .reverse()
    .slice(0, 4);

  const w = all.reduce((a, b) => a + b.w, 0);
  const n = w + all.reduce((a, b) => a + b.l, 0);
  const pnl = all.reduce((a, b) => a + b.pnl, 0);
  const copy = copyPct({
    w,
    l: n - w,
    flat: all.reduce((a, b) => a + b.flat, 0),
  });
  const chips = [
    ...(period !== "all"
      ? [
          [
            PERIODS.find((p) => p[0] === period)![1],
            () => setPeriod("all"),
          ] as const,
        ]
      : []),
    ...FDIMS.filter((k) => f[k]).map(
      (k) =>
        [
          spotName(k, f[k]!),
          () => setF((cur) => ({ ...cur, [k]: undefined })),
        ] as const,
    ),
  ];
  const narrowed = chips.length > 0;
  const rows = table(by, rowsFor(by));

  return (
    <div className="space-y-4">
      <Section>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Chips value={period} onChange={setPeriod} chips={PERIODS} />
          {narrowed && (
            <button
              onClick={() => {
                setF({});
                setPeriod("all");
              }}
              className="text-xs text-zinc-400 hover:text-white"
            >
              Clear filters
            </button>
          )}
        </div>
        {chips.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {chips.map(([label, off]) => (
              <button
                key={label}
                onClick={off}
                className="flex items-center gap-1 rounded-full bg-violet-500/15 px-2.5 py-1 text-xs font-semibold text-violet-200 hover:bg-violet-500/25"
              >
                {label} <X className="size-3" />
              </button>
            ))}
          </div>
        )}
        <div className="mt-4 flex flex-wrap items-end gap-x-8 gap-y-3">
          {narrowed && (
            <div>
              <div className="text-xs text-zinc-500">Record</div>
              <div className="text-2xl font-semibold tabular-nums text-white">
                {n ? `${w}–${n - w}` : "–"}
              </div>
              <div className="text-xs text-zinc-500">
                {n ? `${winPct(w, n - w)} won` : "no bets"}
              </div>
            </div>
          )}
          <div>
            <div className="text-xs text-zinc-500">If you copied every bet</div>
            <div
              className={`text-2xl font-semibold tabular-nums ${tone(copy)}`}
            >
              {n ? signed(copy) : "–"}
            </div>
            <div className="text-xs text-zinc-500">
              {n
                ? `${copy >= 0 ? "+" : "−"}$${Math.abs(copy).toFixed(0)} per $100 bet`
                : ""}
            </div>
          </div>
          {narrowed && (
            <div>
              <div className="text-xs text-zinc-500">His profit</div>
              <div
                className={`text-2xl font-semibold tabular-nums ${tone(pnl)}`}
              >
                {usd(pnl, true)}
              </div>
              <div className="text-xs text-zinc-500">on these bets</div>
            </div>
          )}
          {n > 0 && n < SMALL && (
            <span className="text-xs text-amber-300">
              Only {n} bets: too few to trust
            </span>
          )}
        </div>
      </Section>

      {n === 0 ? (
        <EmptyState
          title="No bets match"
          hint="Remove a filter or pick a longer period."
        />
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <SpotList
              title="Copy these"
              empty={`Nothing with ${MIN_SPOT}+ bets makes money to copy.`}
              spots={good}
              onPick={pick}
            />
            <SpotList
              title="Skip these"
              empty={`Nothing with ${MIN_SPOT}+ bets loses money to copy.`}
              spots={bad}
              onPick={pick}
            />
          </div>

          <Section
            title="Break down by"
            right={<Chips value={by} onChange={setBy} chips={BREAKDOWNS} />}
          >
            <GroupTable
              rows={rows}
              lit={(name) => lit(by, name)}
              onPick={by === "month" ? undefined : (name) => pick(by, name)}
            />
            <p className="mt-3 text-xs text-zinc-500">
              If you copied: what betting the same amount on each of these would
              have made. His profit is weighted by his own stakes, so his
              biggest bets drive it.{" "}
              {by === "month" ? "" : "Tap a row to filter by it. "}Grey rows
              have fewer than {SMALL} bets.
            </p>
          </Section>
        </>
      )}
    </div>
  );
}

function SpotList({
  title,
  empty,
  spots,
  onPick,
}: {
  title: string;
  empty: string;
  spots: { dim: Dim; g: Group }[];
  onPick: (dim: Dim, name: string) => void;
}) {
  return (
    <Section title={title} pad={false}>
      {spots.length === 0 ? (
        <p className="px-4 pb-4 text-sm text-zinc-500">{empty}</p>
      ) : (
        <div className="divide-y divide-white/[0.06]">
          {spots.map(({ dim, g }) => {
            const c = copyPct(g);
            return (
              <button
                key={`${dim}|${g.name}`}
                onClick={() => onPick(dim, g.name)}
                className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left transition hover:bg-white/[0.03]"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-white">
                    {spotName(dim, g.name)}
                  </span>
                  <span className="text-xs text-zinc-500">
                    {g.w}–{g.l} · {winPct(g.w, g.l)} won
                  </span>
                </span>
                <span
                  className={`shrink-0 text-lg font-semibold tabular-nums ${tone(c)}`}
                >
                  {signed(c)}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </Section>
  );
}

function GroupTable({
  rows,
  lit,
  onPick,
}: {
  rows: Group[];
  lit: (name: string) => boolean;
  onPick?: (name: string) => void;
}) {
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, 12);
  return (
    <>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-zinc-500">
            <th className="pb-2 font-medium" />
            <th className="pb-2 text-right font-medium">Bets</th>
            <th className="pb-2 text-right font-medium">Won</th>
            <th className="pb-2 text-right font-medium">If you copied</th>
            <th className="hidden pb-2 text-right font-medium sm:table-cell">
              His profit
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/[0.06]">
          {shown.map((g) => {
            const n = g.w + g.l;
            const c = copyPct(g);
            const on = lit(g.name);
            return (
              <tr
                key={g.name}
                onClick={onPick ? () => onPick(g.name) : undefined}
                className={`${onPick ? "cursor-pointer hover:bg-white/[0.03]" : ""} ${on ? "bg-violet-500/10" : ""} ${n < SMALL && !on ? "opacity-40" : ""}`}
              >
                <td
                  className={`py-2 pl-1 ${on ? "font-semibold text-violet-200" : "text-white"}`}
                >
                  {g.name}
                </td>
                <td className="py-2 text-right tabular-nums text-zinc-300">
                  {g.w}–{g.l}
                </td>
                <td className="py-2 text-right tabular-nums text-zinc-300">
                  {winPct(g.w, g.l)}
                </td>
                <td
                  className={`py-2 text-right font-semibold tabular-nums ${tone(c)}`}
                >
                  {signed(c)}
                </td>
                <td
                  className={`hidden py-2 pr-1 text-right tabular-nums sm:table-cell ${tone(g.pnl)}`}
                >
                  {usd(g.pnl, true)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.length > 12 && (
        <button
          onClick={() => setAll(!all)}
          className="mt-2 text-xs text-zinc-400 hover:text-white"
        >
          {all ? "Show fewer" : `Show all ${rows.length}`}
        </button>
      )}
    </>
  );
}

/** First load: the page's shape while Polymarket is read (a cold read is a few seconds). */
function Skeleton() {
  const bar = "animate-pulse rounded-full bg-white/[0.06]";
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Reading Polymarket">
      <PageHead
        title="Polymarket"
        right={
          <span className="flex items-center gap-2 text-xs text-zinc-500">
            <Loader2 className="size-3.5 animate-spin" /> Reading Polymarket…
          </span>
        }
      />
      <div className={`${bar} h-10 w-96 max-w-full`} />
      <div className="flex gap-2">
        {[80, 110, 96].map((x) => (
          <div key={x} className={`${bar} h-7`} style={{ width: x }} />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-[5.5rem] animate-pulse rounded-2xl border border-white/10 bg-surface-1"
          />
        ))}
      </div>
      <div className={`${bar} h-10 w-64`} />
      <div className="divide-y divide-white/[0.06] rounded-2xl border border-white/10 bg-surface-1">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3">
            <div className="size-8 animate-pulse rounded-md bg-white/[0.06]" />
            <div className="flex-1 space-y-1.5">
              <div className={`${bar} h-3 w-2/3`} />
              <div className={`${bar} h-3 w-1/4`} />
            </div>
            <div className={`${bar} h-4 w-14`} />
          </div>
        ))}
      </div>
    </div>
  );
}

const TAKE_MIN = 0.02; // an expected return under +2% at today's price goes in "Not worth it"
const FACTOR_SMALL = 15; // polyprofiles.TAKE_MIN: a smaller group shows but doesn't count

/** Take now (asked 2026-10-16: "best bets to take based on activity"): every followed profile's buy from the last
 *  3 days that's still open and within 5¢ of his price, ranked by the return of copying his settled bets of the same
 *  kind (sport + market, bet size, entry price) at today's price. */
function TakeNow({ rows }: { rows: Take[] }) {
  const [more, setMore] = useState(false);
  const take = rows.filter((x) => x.now >= TAKE_MIN);
  const weak = rows.filter((x) => x.now < TAKE_MIN);
  const row = (x: Take) => (
    <a
      key={`${x.wallet}|${x.title}|${x.outcome}`}
      href={eventUrl(x.slug, x.title)}
      target="_blank"
      rel="noreferrer"
      className="flex items-start gap-3 px-4 py-3 transition hover:bg-white/[0.03]"
    >
      {x.icon && (
        <img
          src={x.icon}
          alt=""
          className="mt-0.5 size-8 shrink-0 rounded-md bg-white/[0.04] object-contain"
        />
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-white">
          {pickLabel(x.title, x.outcome)}
          <span className="ml-1.5 font-normal text-zinc-400">
            now {cents(x.cur)}
          </span>
        </span>
        <span className="block truncate text-xs text-zinc-500">
          {x.name} bet {usd(x.cost)} at {cents(x.avg)} · {ago(x.at)} ago ·{" "}
          {x.title}
        </span>
        <span className="mt-1.5 flex flex-wrap gap-1.5">
          {x.factors.map((f) => (
            <span
              key={f.dim}
              title={`${f.n} of his settled bets; copying each for the same amount returned ${signed(100 * f.copy)}`}
              className={`rounded-md bg-white/[0.04] px-1.5 py-0.5 text-[0.6875rem] ${f.n < FACTOR_SMALL ? "text-zinc-600" : "text-zinc-400"}`}
            >
              {f.name}{" "}
              <span className={f.n < FACTOR_SMALL ? "" : tone(f.copy)}>
                {signed(100 * f.copy)}
              </span>{" "}
              <span className="text-zinc-600">({f.n})</span>
            </span>
          ))}
        </span>
      </span>
      <span className="shrink-0 text-right">
        <span
          className={`block text-lg font-semibold tabular-nums ${tone(x.now)}`}
        >
          {signed(100 * x.now)}
        </span>
        <span className="text-[0.6875rem] text-zinc-500">expected</span>
      </span>
    </a>
  );
  return (
    <div className="space-y-3">
      <Section title="Take now" pad={false}>
        {take.length === 0 ? (
          <p className="px-4 pb-4 text-sm text-zinc-500">
            Nothing worth taking right now. This lists their bets from the last
            3 days that are still open and within 5¢ of their price; following
            more active bettors fills it faster.
          </p>
        ) : (
          <div className="divide-y divide-white/[0.06]">{take.map(row)}</div>
        )}
      </Section>
      {weak.length > 0 && (
        <div>
          <button
            onClick={() => setMore(!more)}
            className="text-xs text-zinc-400 hover:text-white"
          >
            {more ? "Hide" : `Not worth it (${weak.length})`}
          </button>
          {more && (
            <Section pad={false}>
              <div className="divide-y divide-white/[0.06]">
                {weak.map(row)}
              </div>
            </Section>
          )}
        </div>
      )}
      <p className="text-xs text-zinc-500">
        Expected: what copying his past bets of the same kind returned (sport
        and market, his bet size, his price), shrunk when a group is small and
        adjusted to today's price. Grey groups have under {FACTOR_SMALL} bets
        and don't count.
      </p>
    </div>
  );
}

/** The same outcome bet by two or more of the profiles you follow: open ones first (still takeable), how past ones
 *  went (flat $100 each at their average entry), and markets where they took opposite sides. */
function BestBets({ b, people }: { b: Best; people: number }) {
  if (people < 2)
    return (
      <EmptyState
        title="Follow two or more profiles"
        hint="Best Bets are the outcomes two or more of them bet."
      />
    );
  const r = b.record;
  const n = r.w + r.l;
  const status = (s: string) =>
    s === "won"
      ? "text-emerald-300"
      : s === "lost"
        ? "text-red-300"
        : "text-zinc-400";
  const row = (x: Shared) => (
    <a
      key={x.asset}
      href={eventUrl(x.slug, x.title)}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-3 px-4 py-2.5 transition hover:bg-white/[0.03]"
    >
      {x.icon && (
        <img
          src={x.icon}
          alt=""
          className="size-8 shrink-0 rounded-md bg-white/[0.04] object-contain"
        />
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-white">
          {pickLabel(x.title, x.outcome)}
          <span className="ml-1.5 font-normal text-zinc-400">
            {cents(x.status === "open" ? x.cur : x.price)}
          </span>
        </span>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="truncate text-xs text-zinc-500">{x.title}</span>
          {x.people.map((m) => (
            <span key={m.wallet} className="text-xs text-zinc-400">
              {m.name}{" "}
              <span className="text-zinc-500">
                {cents(m.avg)} · {usd(m.cost)}
              </span>
            </span>
          ))}
          {x.against.length > 0 && (
            <span className="text-xs text-amber-300">
              vs {x.against.join(", ")}
            </span>
          )}
        </span>
      </span>
      <span className="shrink-0 text-right">
        <span className="block text-sm font-semibold text-white">
          {usd(x.stake)}
        </span>
        <span className={`text-xs capitalize ${status(x.status)}`}>
          {x.status === "open" ? x.end : x.status}
        </span>
      </span>
    </a>
  );
  return (
    <div className="space-y-5">
      {b.open.length + b.settled.length > 0 && (
        <Tiles
          tiles={[
            {
              label: "Open",
              value: String(b.open.length),
              sub: b.open.length
                ? usd(b.open.reduce((a, x) => a + x.stake, 0)) + " staked"
                : "none right now",
            },
            {
              label: "Record",
              value: n ? `${r.w}–${r.l}` : "–",
              sub: n
                ? `${winPct(r.w, r.l)} · needs ${r.avg_price == null ? "–" : `${Math.round(r.avg_price * 100)}%`}`
                : "no settled ones yet",
            },
            {
              label: "ROI",
              value: n ? `${((100 * r.pnl) / r.staked).toFixed(1)}%` : "–",
              tone: !n ? undefined : r.pnl >= 0 ? "good" : "bad",
              sub: n ? `$100 on each: ${usd(r.pnl, true)}` : undefined,
            },
          ]}
        />
      )}
      {b.open.length + b.settled.length === 0 && (
        <EmptyState
          title="No shared bets yet"
          hint="None of them has bet the same outcome as another. A new bet that matches one gets its own alert."
        />
      )}
      {b.open.length > 0 && (
        <Section title="Open" pad={false}>
          <div className="divide-y divide-white/[0.06]">{b.open.map(row)}</div>
        </Section>
      )}
      {b.settled.length > 0 && (
        <Section title="Settled" pad={false}>
          <div className="divide-y divide-white/[0.06]">
            {b.settled.map(row)}
          </div>
        </Section>
      )}
      {b.clash.length > 0 && (
        <Section title="Opposite sides" pad={false}>
          <div className="divide-y divide-white/[0.06]">
            {b.clash.map((c) => (
              <a
                key={c.slug + c.title}
                href={eventUrl(c.slug, c.title)}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-3 px-4 py-2.5 transition hover:bg-white/[0.03]"
              >
                {c.icon && (
                  <img
                    src={c.icon}
                    alt=""
                    className="size-8 shrink-0 rounded-md bg-white/[0.04] object-contain"
                  />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-white">
                    {c.title}
                  </span>
                  <span className="flex flex-wrap gap-x-3 text-xs">
                    {c.sides.map((x) => (
                      <span key={x.name} className="text-zinc-400">
                        {x.name}{" "}
                        <span className="font-semibold text-violet-200">
                          {pickLabel(c.title, x.outcome)}
                        </span>{" "}
                        {cents(x.avg)} · {usd(x.cost)}{" "}
                        <span className={`capitalize ${status(x.status)}`}>
                          {x.status === "open" ? "" : x.status}
                        </span>
                      </span>
                    ))}
                  </span>
                </span>
                <span className="shrink-0 text-xs text-zinc-500">{c.end}</span>
              </a>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}
