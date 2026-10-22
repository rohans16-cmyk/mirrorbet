import { useEffect, useState, type ReactNode } from "react";
import { ChevronDown, KeyRound, Loader2, Maximize2, Settings2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { LoadError } from "@/components/ui/EmptyState";
import { PageLoader } from "@/components/PageLoader";
import { PhoneAlerts } from "@/components/PhoneAlerts";
import { ask } from "@/components/ui/ask";
import { Chips, Section } from "@/components/ledger/Kit";
import { eventUrl, pickLabel } from "@/lib/polybet";

type Ticket = {
  id: string;
  at: string;
  title: string;
  outcome: string;
  his_price: number;
  his_usd: number;
  who?: string;
  want?: number;
  side?: "BUY" | "SELL";
  cur?: number;
  value?: number;
  fee?: number;
  slug?: string;
  long?: boolean;
  us_yes?: string;
  order_id?: string;
  placed_at?: string;
  test?: boolean;
  add?: boolean;
  us_event?: string | null;
  copyable?: boolean; // a skipped bet whose game isn't over: Copy now shows
  advice?: { verdict: "hold" | "sell"; why: string; lines: string[] };
  us: string | null;
  limit: number;
  ask?: number | null;
  status: "skip" | "paper" | "ready" | "placing" | "filled" | "error";
  why: string | null;
  expires?: string;
  shares?: number;
  cost?: number;
  price?: number | null;
  result?: "won" | "lost" | "sold";
  pnl?: number;
};
type Person = { wallet: string; name: string; min_usd: number; take_profit: number; on: boolean };
type Rec = { w: number; l: number; open: number; pnl: number; staked: number };
type Mode = "off" | "ask" | "auto";
type Data = {
  ok: boolean;
  error?: string;
  keys: boolean;
  cfg: {
    mode: Mode;
    stake: number;
    max_stake: number;
    per_day: number;
    max_day: number;
    slip: number;
    max_price: number;
    min_price?: number;
    take_profit: number;
    take_profit_by?: Record<string, number>;
  };
  account: { balance: number; buying_power: number; in_bets: number } | null;
  account_error: string | null;
  tickets: Ticket[];
  real: Rec;
  paper: Rec;
  today: number;
  today_usd: number;
  people: string[];
  copy_people?: Person[];
  followed?: { wallet: string; name: string }[];
  phone_people?: { wallet: string; name: string; phone_min?: number | null; phone_off?: boolean }[];
};

const usd = (x: number, sign = false) =>
  `${x < 0 ? "−" : sign && x > 0 ? "+" : ""}$${Math.abs(x).toFixed(2)}`;
const cents = (p: number | null | undefined) =>
  p == null ? "–" : `${Math.round(p * 100)}¢`;
/** The side bought on Polymarket US: "NO · James Madison −10.5" (NO on that line is the other team's cover). */
function UsSide({ t }: { t: Ticket }) {
  if (t.long == null || !t.us_yes) return null;
  return (
    <span
      title={`Bought ${t.long ? "YES" : "NO"} on "${t.us_yes}" on Polymarket US`}
      className={`max-w-[55%] truncate rounded-full px-2 py-0.5 text-[0.6875rem] font-semibold ${t.long ? "bg-emerald-500/10 text-emerald-300" : "bg-rose-500/10 text-rose-300"}`}
    >
      {t.long ? "YES" : "NO"} · {t.us_yes}
    </span>
  );
}

const post = (body: object) =>
  fetch("/api/polymarket/us", {
    method: "POST",
    body: JSON.stringify(body),
  }).then((r) => r.json());

/** Real money on Polymarket US (polyus.py): your key, the copy mode, and Kch-Temp / primm's bets matched to the same
 *  US market as tickets you place (Ask), that place themselves (Auto), or that are only recorded (Off). */
export function PolyUS({ extra }: { extra?: ReactNode } = {}) {
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const load = () =>
    fetch("/api/polymarket/us")
      .then((r) => r.json())
      .then((x: Data) =>
        x.ok ? (setD(x), setErr(null)) : setErr(x.error || "Could not load"),
      )
      .catch(() => setErr("Cannot reach the server"));
  useEffect(() => {
    load();
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, []);
  const act = async (key: string, body: object) => {
    setBusy(key);
    setMsg(null);
    const r = await post(body).catch(() => ({
      ok: false,
      error: "Cannot reach the server",
    }));
    setBusy(null);
    if (!r.ok) setMsg(r.error);
    load();
    return r;
  };

  if (err && !d) return <LoadError err={err} retry={load} />;
  if (!d) return <PageLoader scene="record" label="Reading Polymarket US…" />;
  if (!d.keys) return <KeyForm onDone={load} />;

  const c = d.cfg;
  const ready = d.tickets.filter((t) => t.status === "ready");
  const shown = d.tickets.filter((t) => t.status !== "ready");
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-end gap-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 text-xs">
          <span className="font-semibold uppercase tracking-wide text-zinc-500">
            {c.mode === "auto" ? "Copying" : c.mode === "ask" ? "Asking you about" : "Copying off for"}
          </span>
          {(d.copy_people ?? []).filter((p) => p.on).map((p) => (
            <span
              key={p.wallet}
              className="rounded-full bg-violet-500/15 px-2.5 py-0.5 font-semibold text-violet-200 ring-1 ring-violet-400/20"
              title={`Copies their bets of ${usd(p.min_usd)}+ · ${p.take_profit ? `sells at +${Math.round(p.take_profit * 100)}%` : "held to the result"} (and sells when they sell)`}
            >
              {p.name}{" "}
              <span className="font-normal text-violet-300/80">
                ${p.min_usd >= 1000 ? `${Math.round(p.min_usd / 1000)}K` : Math.round(p.min_usd)}+
                {p.take_profit ? ` · sell +${Math.round(p.take_profit * 100)}%` : ""}
              </span>
            </span>
          ))}
          {(d.copy_people ?? []).filter((p) => p.on).length === 0 && <span className="text-zinc-500">nobody yet</span>}
        </div>
        <button
          onClick={() => setSettingsOpen(true)}
          className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold text-zinc-300 ring-1 ring-white/10 transition hover:text-white"
        >
          <Settings2 className="size-4" /> Settings
        </button>
      </div>
      {msg && !settingsOpen && <p className="text-sm text-red-300">{msg}</p>}
      {(() => {
        // one card (asked 2026-10-18): total, in bets, ROI. "In bets" is the live value of the bot's open copies
        // (Polymarket US's own in-bets figure reads $0 for short-side positions); total = buying power + that.
        const inBets = d.tickets
          .filter(
            (t) => t.status === "filled" && t.side !== "SELL" && !t.result,
          )
          .reduce((a, t) => a + (t.value ?? t.cost ?? 0), 0);
        // ROI on every copy, open ones at today's value (asked 2026-10-18: one settled $1 test read −104.7%): what
        // came back + what's open is worth, less everything paid (fees included), over everything paid
        const bought = d.tickets.filter(
          (t) => t.status === "filled" && t.side !== "SELL",
        );
        const paid = bought.reduce(
          (a, t) => a + (t.cost ?? 0) + (t.fee ?? 0),
          0,
        );
        const back = bought.reduce(
          (a, t) =>
            a +
            (t.result
              ? (t.pnl ?? 0) + (t.cost ?? 0) + (t.fee ?? 0)
              : (t.value ?? t.cost ?? 0)),
          0,
        );
        const roi = paid ? (back - paid) / paid : null;
        // the record of copies that are done (asked 2026-10-19: its own square); a sale counts by what it made
        const doneBets = bought.filter((t) => t.result);
        const settled = {
          n: doneBets.length,
          w: doneBets.filter((t) => (t.pnl ?? 0) > 0).length,
          pnl: doneBets.reduce((a, t) => a + (t.pnl ?? 0), 0),
        };
        const cell = "min-w-0 flex-1 px-4 py-3";
        const label =
          "text-xs font-semibold uppercase tracking-wide text-zinc-500";
        return (
          <div className="flex flex-wrap divide-x divide-white/[0.06] rounded-2xl border border-white/10 bg-surface-1">
            <div className={cell}>
              <div className={label}>Available</div>
              <div className="text-2xl font-semibold tabular-nums text-white">
                {d.account ? usd(d.account.buying_power) : "–"}
              </div>
              {d.account_error && (
                <div className="text-xs text-red-300">{d.account_error}</div>
              )}
            </div>
            <div className={cell}>
              <div className={label}>In bets</div>
              <div className="text-2xl font-semibold tabular-nums text-white">
                {usd(inBets)}
              </div>
            </div>
            <div className={cell}>
              <div className={label}>ROI</div>
              <div
                className={`text-2xl font-semibold tabular-nums ${roi == null ? "text-white" : roi >= 0 ? "text-emerald-300" : "text-red-300"}`}
              >
                {roi == null
                  ? "–"
                  : `${roi >= 0 ? "+" : "−"}${Math.abs(roi * 100).toFixed(1)}%`}
              </div>
            </div>
            <div className={cell}>
              <div className={label}>P/L</div>
              <div
                className={`text-2xl font-semibold tabular-nums ${settled.pnl > 0 ? "text-emerald-300" : settled.pnl < 0 ? "text-red-300" : "text-white"}`}
              >
                {settled.n ? usd(settled.pnl, true) : "–"}
              </div>
            </div>
          </div>
        );
      })()}

      {ready.map((t) => (
        <Section key={t.id} title="Ready to place">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="font-semibold text-white">
                {t.outcome} · {t.title}
              </p>
              <p className="text-sm text-zinc-400">
                {t.side === "SELL"
                  ? `${t.who} sold at ${cents(t.his_price)} · sell all of yours`
                  : `${t.who} bet $${Math.round(t.his_usd).toLocaleString()} at ${cents(t.his_price)} · you ${usd(t.want ?? 0)} · US ${cents(t.ask)} · limit ${cents(t.limit)}`}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => act(t.id, { action: "skip", id: t.id })}
                className="rounded-full px-4 py-1.5 text-sm font-semibold text-zinc-400 ring-1 ring-white/10 hover:text-white"
              >
                Skip
              </button>
              <button
                disabled={busy === t.id}
                onClick={() => act(t.id, { action: "place", id: t.id })}
                className="flex items-center gap-1 rounded-full bg-violet-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-violet-500 disabled:opacity-60"
              >
                {busy === t.id && <Loader2 className="size-4 animate-spin" />}{" "}
                Place
              </button>
            </div>
          </div>
        </Section>
      ))}

      {/* open and settled side by side, trader feed underneath (asked 2026-10-19), each a short scrolling column */}
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <BotBets tickets={shown} busy={busy} act={act} />
      </div>
      {extra}

      {/* Bot settings in a window (asked 2026-10-18); the Polymarket page's header opens the same one */}
      <BotSettings open={settingsOpen} onOpenChange={setSettingsOpen} onChange={load} />
    </div>
  );
}

/** Bot settings (asked 2026-10-18), as a window of its own: the Real money tab's Settings button and the Polymarket
 *  page's settings icon (asked 2026-10-19) open this same one. It reads the bot's state itself while open. */
export function BotSettings({
  open,
  onOpenChange,
  onChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onChange?: () => unknown;
}) {
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const load = () =>
    fetch("/api/polymarket/us")
      .then((r) => r.json())
      .then((x: Data) =>
        x.ok ? (setD(x), setErr(null)) : setErr(x.error || "Could not load"),
      )
      .catch(() => setErr("Cannot reach the server"));
  useEffect(() => {
    if (!open) return;
    load();
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, [open]);
  const act = async (key: string, body: object) => {
    setBusy(key);
    setMsg(null);
    const r = await post(body).catch(() => ({
      ok: false,
      error: "Cannot reach the server",
    }));
    setBusy(null);
    if (!r.ok) setMsg(r.error);
    load();
    onChange?.();
    return r;
  };
  const reload = () => {
    load();
    onChange?.();
  };
  const c = d?.cfg;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] w-[95vw] space-y-4 overflow-y-auto rounded-3xl border-white/10 bg-surface-1 p-6 sm:max-w-2xl">
        <DialogTitle className="text-xl font-semibold text-white">
          Bot settings
        </DialogTitle>
        <DialogDescription className="sr-only">
          How the bot copies, its limits, phone alerts, and your key
        </DialogDescription>
        {err && !d ? (
          <LoadError err={err} retry={load} />
        ) : !d || !c ? (
          <div className="flex justify-center py-8 text-zinc-500">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : !d.keys ? (
          <KeyForm onDone={reload} />
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-sm font-semibold text-zinc-300">Copying</span>
              <Chips<Mode>
                value={c.mode}
                chips={[
                  ["off", "Off"],
                  ["ask", "Ask me"],
                  ["auto", "Auto"],
                ]}
                onChange={async (m) => {
                  if (
                    m === "auto" &&
                    !(await ask.confirm(
                      "Buy their matching bets with real money without asking?",
                      { ok: "Turn on Auto" },
                    ))
                  )
                    return;
                  act("mode", { action: "cfg", mode: m });
                }}
              />
            </div>
            <p className="text-sm text-zinc-400">
              Moneylines, spreads and totals (soccer win/draw) on the same US
              market and line, at up to their price +{Math.round(c.slip * 100)}¢,
              sized like their bet. Sells when they sell, or at your auto-sell.
            </p>
            <People people={d.copy_people ?? []} followed={d.followed ?? []} act={act} busy={busy} />
            <Limits c={c} save={(b) => act("cfg", { action: "cfg", ...b })} />
            <PhoneAlerts people={d.phone_people ?? []} reload={reload} />
            {msg && <p className="mt-2 text-sm text-red-300">{msg}</p>}

            <button
              onClick={async () => {
                if (
                  await ask.confirm(
                    "Remove your Polymarket US key from this computer?",
                    {
                      ok: "Remove",
                      danger: true,
                    },
                  )
                )
                  act("forget", { action: "forget" });
              }}
              className="text-xs text-zinc-500 hover:text-red-300"
            >
              Remove key
            </button>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Limits({ c, save }: { c: Data["cfg"]; save: (b: object) => void }) {
  const rows = [
    ["stake", "Bet at their usual size $", c.stake, 1],
    ["max_stake", "Max a bet $", c.max_stake, 1],
    ["max_day", "Max a day $", c.max_day, 1],
    ["per_day", "Bets a day", c.per_day, 1],
    ["min_price", "Min price ¢", c.min_price ?? 0.3, 100],
    ["max_price", "Max price ¢", c.max_price, 100],
  ] as const;
  return (
    <div className="mt-3 flex flex-wrap gap-4">
      {rows.map(([k, label, v, mul]) => (
        <label key={k} className="space-y-1 text-xs text-zinc-500">
          <span className="block">{label}</span>
          <input
            type="number"
            defaultValue={Math.round(v * mul * 100) / 100}
            onBlur={(e) => {
              const x = Number(e.target.value) / mul;
              if (x && x !== v) save({ [k]: x });
            }}
            className="w-24 rounded-lg bg-white/[0.05] px-3 py-1.5 text-sm text-white ring-1 ring-white/10 focus:outline-none focus:ring-violet-400/60"
          />
        </label>
      ))}
    </div>
  );
}

function KeyForm({ onDone }: { onDone: () => void }) {
  const [id, setId] = useState("");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const field =
    "w-full rounded-xl bg-white/[0.05] px-4 py-2 text-sm text-white ring-1 ring-white/10 placeholder:text-zinc-500 focus:outline-none focus:ring-violet-400/60";
  return (
    <Section title="Connect Polymarket US">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setErr(null);
          const r = await post({ action: "keys", key_id: id, secret }).catch(
            () => ({ ok: false, error: "Cannot reach the server" }),
          );
          setBusy(false);
          if (!r.ok) return setErr(r.error);
          onDone();
        }}
        className="max-w-md space-y-3"
      >
        <p className="text-sm text-zinc-400">
          From polymarket.us/developer. Kept on this computer only.
        </p>
        <input
          value={id}
          onChange={(e) => setId(e.target.value)}
          placeholder="Key ID"
          className={field}
        />
        <input
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          placeholder="Secret Key"
          type="password"
          autoComplete="off"
          className={field}
        />
        {err && <p className="text-sm text-red-300">{err}</p>}
        <button
          disabled={busy || !id || !secret}
          className="flex items-center gap-1 rounded-full bg-violet-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-violet-500 disabled:opacity-60"
        >
          {busy ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <KeyRound className="size-4" />
          )}{" "}
          Connect
        </button>
      </form>
    </Section>
  );
}

// ---- the bot's bets (asked 2026-10-18: "Bot activity and Trader feed both show all the activity ... make it simple, my
// open bets first"): only what the bot bought. Open ones first (live P/L, Sell now), then the settled ones. Each
// column shows its first 3 (asked 2026-10-19), the rest in the full table. Skipped bets live in the Trader feed only
// (with Copy now there).
type Status = "open" | "settled" | "sold" | "skipped";
const FIRST = 3; // bets a Bot-page column shows
const SPORT: Record<string, string> = {
  nfl: "NFL",
  cfb: "College football",
  mlb: "MLB",
  nba: "NBA",
  nhl: "NHL",
  cbb: "College basketball",
  epl: "Soccer",
  lal: "Soccer",
  lg1: "Soccer",
  fl1: "Soccer",
  sea: "Soccer",
  bun: "Soccer",
  ucl: "Soccer",
  uel: "Soccer",
  mls: "Soccer",
  fifwc: "Soccer",
  fwc: "Soccer",
};
const sportOf = (t: Ticket) =>
  SPORT[(t.slug || t.us?.replace(/^[a-z]+-/, "") || "").split("-")[0]] ??
  "Other";
const pnlOf = (t: Ticket) =>
  t.result
    ? (t.pnl ?? 0)
    : t.status === "filled" && t.side !== "SELL" && t.value != null
      ? t.value - (t.cost ?? 0) - (t.fee ?? 0)
      : null;
const statusOf = (t: Ticket): Status =>
  t.side === "SELL"
    ? "sold"
    : t.status === "filled"
      ? t.result
        ? "settled"
        : "open"
      : "skipped";
const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
const money = (x: number) =>
  Math.abs(x) >= 1e3
    ? `$${(x / 1e3).toFixed(x >= 1e4 ? 0 : 1)}K`
    : `$${Math.round(x)}`;
const reasonOf = (t: Ticket) => t.why ?? "";

function BotBets({
  tickets,
  busy,
  act,
}: {
  tickets: Ticket[];
  busy: string | null;
  act: (key: string, body: object) => Promise<unknown>;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [full, setFull] = useState<"open" | "settled" | null>(null);
  const open = tickets.filter((t) => statusOf(t) === "open");
  const done = tickets.filter((t) => statusOf(t) === "settled");
  const livePnl = open.reduce((a, t) => a + (pnlOf(t) ?? 0), 0);
  const row = (t: Ticket) => (
    <BetRow
      key={t.id}
      t={t}
      open={openId === t.id}
      toggle={() => setOpenId(openId === t.id ? null : t.id)}
      busy={busy}
      act={act}
    />
  );
  return (
    <>
      <Section
        title="Your open bets"
        right={
          open.length ? (
            <span className="flex items-center gap-2">
              <span
                className={`text-sm font-semibold ${livePnl >= 0 ? "text-emerald-300" : "text-red-300"}`}
              >
                {usd(livePnl, true)} now
              </span>
              <Expand onClick={() => setFull("open")} />
            </span>
          ) : undefined
        }
        pad={false}
      >
        {open.length === 0 ? (
          <p className="px-4 pb-4 text-sm text-zinc-500">
            Nothing open. The bot buys when Kch-Temp or primm make a bet it
            copies.
          </p>
        ) : (
          <>
            <ul className="divide-y divide-white/[0.06] border-t border-white/[0.06]">
              {open.slice(0, FIRST).map(row)}
            </ul>
            <SeeAll n={open.length} onClick={() => setFull("open")} />
          </>
        )}
      </Section>
      {(
        <Section
          title="Your settled bets"
          right={done.length ? <Expand onClick={() => setFull("settled")} /> : undefined}
          pad={false}
        >
          {done.length === 0 && <p className="px-4 pb-4 text-sm text-zinc-500">Nothing settled yet.</p>}
          <ul className="divide-y divide-white/[0.06] border-t border-white/[0.06]">
            {done.slice(0, FIRST).map(row)}
          </ul>
          <SeeAll n={done.length} onClick={() => setFull("settled")} />
        </Section>
      )}
      <BetsTable
        kind={full}
        tickets={full === "open" ? open : done}
        onClose={() => setFull(null)}
        busy={busy}
        act={act}
      />
    </>
  );
}

function SeeAll({ n, onClick }: { n: number; onClick: () => void }) {
  if (n <= FIRST) return null;
  return (
    <button
      onClick={onClick}
      className="w-full border-t border-white/[0.06] px-4 py-2 text-xs font-semibold text-zinc-400 transition hover:bg-white/[0.03] hover:text-white"
    >
      See all {n}
    </button>
  );
}

/** Newer / Older pages for a full-table window (asked 2026-10-19: one long list was too much). */
export const WINDOW_PAGE = 25;
export function Pager({
  page,
  n,
  setPage,
  labels = ["Newer", "Older"],
}: {
  page: number;
  n: number;
  setPage: (p: number) => void;
  labels?: [string, string]; // what the previous / next page holds (a table sorted by size isn't newer / older)
}) {
  if (n <= WINDOW_PAGE) return null;
  return (
    <div className="flex items-center justify-between text-xs text-zinc-500">
      <button
        disabled={page === 0}
        onClick={() => setPage(page - 1)}
        className="rounded-full px-3 py-1 font-semibold ring-1 ring-white/10 hover:text-white disabled:opacity-30"
      >
        {labels[0]}
      </button>
      <span className="tabular-nums">
        {page * WINDOW_PAGE + 1}–{Math.min((page + 1) * WINDOW_PAGE, n)} of {n}
      </span>
      <button
        disabled={(page + 1) * WINDOW_PAGE >= n}
        onClick={() => setPage(page + 1)}
        className="rounded-full px-3 py-1 font-semibold ring-1 ring-white/10 hover:text-white disabled:opacity-30"
      >
        {labels[1]}
      </button>
    </div>
  );
}

export function Expand({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title="See the full table"
      className="rounded-full p-1.5 text-zinc-500 transition hover:bg-white/[0.06] hover:text-white"
    >
      <Maximize2 className="size-3.5" />
    </button>
  );
}

/** Every open or settled bet as one table in a window (asked 2026-10-19), no scroll box or pages. */
function BetsTable({
  kind,
  tickets,
  onClose,
  busy,
  act,
}: {
  kind: "open" | "settled" | null;
  tickets: Ticket[];
  onClose: () => void;
  busy: string | null;
  act: (key: string, body: object) => Promise<unknown>;
}) {
  const paid = tickets.reduce((a, t) => a + (t.cost ?? 0), 0);
  const pnl = tickets.reduce((a, t) => a + (pnlOf(t) ?? 0), 0);
  const won = (t: Ticket) => t.result === "won" || (t.result === "sold" && (t.pnl ?? 0) > 0);
  const wins = tickets.filter(won).length;
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [kind]);
  const th = "px-3 py-2 font-semibold";
  return (
    <Dialog open={kind != null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[92vh] w-[95vw] flex-col gap-4 rounded-3xl border-white/10 bg-surface-1 p-6 sm:max-w-5xl">
        <DialogTitle className="text-xl font-semibold text-white">
          {kind === "open" ? "Your open bets" : "Your settled bets"}
        </DialogTitle>
        <DialogDescription className="text-sm text-zinc-400">
          {tickets.length} bet{tickets.length === 1 ? "" : "s"} · {usd(paid)} paid ·{" "}
          {kind === "settled" && `${wins}–${tickets.length - wins} · `}
          <span className={pnl > 0 ? "text-emerald-300" : pnl < 0 ? "text-red-300" : ""}>
            {usd(pnl, true)}
            {kind === "open" ? " now" : ""}
          </span>
        </DialogDescription>
        <div className="min-h-0 flex-1 overflow-auto rounded-2xl border border-white/[0.06]">
          <table className="w-full text-left text-sm tabular-nums">
            <thead className="sticky top-0 bg-surface-1 text-xs uppercase tracking-wide text-zinc-500">
              <tr className="border-b border-white/[0.06]">
                <th className={th}>Placed</th>
                <th className={th}>Pick</th>
                <th className={th}>Copying</th>
                <th className={`${th} text-right`}>Their bet</th>
                <th className={`${th} text-right`}>You paid</th>
                <th className={`${th} text-right`}>{kind === "open" ? "Now" : "Result"}</th>
                <th className={`${th} text-right`}>P/L</th>
                {kind === "open" && <th className={th} />}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06]">
              {tickets.slice(page * WINDOW_PAGE, (page + 1) * WINDOW_PAGE).map((t) => {
                const p = pnlOf(t);
                return (
                  <tr key={t.id} className="align-top hover:bg-white/[0.03]">
                    <td className="whitespace-nowrap px-3 py-2 text-zinc-400">{when(t.placed_at ?? t.at)}</td>
                    <td className="px-3 py-2">
                      <p className="flex items-center gap-2 font-medium text-white">
                        {pickLabel(t.title, t.outcome)}
                        <UsSide t={t} />
                      </p>
                      <p className="text-xs text-zinc-500">{t.title}</p>
                    </td>
                    <td className="px-3 py-2 text-zinc-300">
                      {t.who ?? "–"}
                      {t.add ? " (added)" : ""}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right text-zinc-300">
                      {money(t.his_usd)} at {cents(t.his_price)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right text-zinc-300">
                      {usd(t.cost ?? 0)} at {cents(t.price)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      {kind === "open" ? (
                        <span className="text-zinc-300">{cents(t.cur)}</span>
                      ) : (
                        <span className={won(t) ? "text-emerald-300" : "text-red-300"}>
                          {won(t) ? "Won" : "Lost"}
                          {t.result === "sold" ? " (sold)" : ""}
                        </span>
                      )}
                    </td>
                    <td
                      className={`whitespace-nowrap px-3 py-2 text-right font-semibold ${p == null ? "text-zinc-600" : p > 0 ? "text-emerald-300" : p < 0 ? "text-red-300" : "text-zinc-300"}`}
                    >
                      {p == null ? "–" : usd(p, true)}
                    </td>
                    {kind === "open" && (
                      <td className="px-3 py-1">
                        <SellNow t={t} busy={busy} act={act} />
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Pager page={page} n={tickets.length} setPage={setPage} />
      </DialogContent>
    </Dialog>
  );
}

function BetRow({
  t,
  open,
  toggle,
  busy,
  act,
}: {
  t: Ticket;
  open: boolean;
  toggle: () => void;
  busy: string | null;
  act: (key: string, body: object) => Promise<unknown>;
}) {
  const st = statusOf(t);
  const pnl = pnlOf(t);
  const pick = pickLabel(t.title, t.outcome);
  // a bet sold before the result reads Won or Lost by what it made (asked 2026-10-19), like one held to the end
  const won = t.result === "won" || (t.result === "sold" && (t.pnl ?? 0) > 0);
  const badge =
    st === "open"
      ? "bg-sky-500/15 text-sky-300"
      : st === "settled"
        ? won
          ? "bg-emerald-500/15 text-emerald-300"
          : "bg-red-500/15 text-red-300"
        : st === "sold"
          ? "bg-amber-500/15 text-amber-300"
          : t.status === "error"
            ? "bg-red-500/15 text-red-300"
            : "bg-white/[0.04] text-zinc-500";
  const label =
    st === "open"
      ? "Open"
      : st === "settled"
        ? `${won ? "Won" : "Lost"}${t.result === "sold" ? " (sold)" : ""}` // like the full table
        : st === "sold"
          ? "Sell"
          : t.status === "error"
            ? "Error"
            : t.status === "paper"
              ? "Recorded"
              : reasonOf(t) || "Skipped";
  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        onClick={toggle}
        onKeyDown={(e) => e.key === "Enter" && toggle()}
        className="flex cursor-pointer items-start gap-3 px-4 py-2.5 transition hover:bg-white/[0.03]"
      >
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-sm text-white">
            <span className="truncate font-medium">{pick}</span>
            <UsSide t={t} />
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-[0.6875rem] font-semibold ${badge}`}
            >
              {label}
            </span>
          </p>
          <p className="truncate text-xs text-zinc-500">
            {when(t.at)} · {t.who ?? ""}{" "}
            {t.side === "SELL" ? "sold" : `bet ${money(t.his_usd)}`} at{" "}
            {cents(t.his_price)}
            {t.status === "filled" && t.side !== "SELL"
              ? ` · you ${usd(t.cost ?? 0)} at ${cents(t.price)}${t.cur != null && !t.result ? ` → ${cents(t.cur)}` : ""}`
              : t.status === "filled" && t.side === "SELL"
                ? ` · you got ${usd(t.cost ?? 0)}`
                : t.why
                  ? ` · ${t.why}`
                  : ""}
          </p>
          {st === "open" && <SellNow t={t} busy={busy} act={act} />}
          {st === "skipped" && t.side !== "SELL" && t.copyable && (
            <span
              className="mt-1.5 inline-flex"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                disabled={busy === `copy-${t.id}`}
                onClick={async () => {
                  if (
                    await ask.confirm(
                      `Copy ${pickLabel(t.title, t.outcome)} now with real money? Sized like ${t.who}'s bet, at up to their ${cents(t.his_price)} + 1¢; not bought if the price is higher.`,
                      { ok: "Copy now" },
                    )
                  )
                    act(`copy-${t.id}`, { action: "copy", id: t.id });
                }}
                className="rounded-full bg-violet-600/80 px-2.5 py-0.5 text-[0.6875rem] font-semibold text-white transition hover:bg-violet-500 disabled:opacity-50"
              >
                {busy === `copy-${t.id}` ? "Copying…" : "Copy now"}
              </button>
            </span>
          )}
        </div>
        <div className="shrink-0 text-right">
          {pnl != null ? (
            <p
              className={`text-sm font-semibold ${pnl > 0 ? "text-emerald-300" : pnl < 0 ? "text-red-300" : "text-zinc-300"}`}
            >
              {usd(pnl, true)}
            </p>
          ) : (
            <p className="text-sm text-zinc-600">–</p>
          )}
          <ChevronDown
            className={`ml-auto mt-0.5 size-3.5 text-zinc-600 transition ${open ? "rotate-180" : ""}`}
          />
        </div>
      </div>
      {open && (
        <div className="grid gap-x-6 gap-y-1 bg-white/[0.02] px-4 py-3 text-xs text-zinc-400 sm:grid-cols-2">
          <span>
            Game · <span className="text-zinc-200">{t.title}</span>
          </span>
          <span>
            Copying · <span className="text-zinc-200">{t.who ?? "–"}</span>
            {t.add ? " (they added)" : ""}
          </span>
          {t.long != null && t.us_yes && (
            <span className="sm:col-span-2">
              On Polymarket US ·{" "}
              <span className="text-zinc-200">
                {t.long ? "YES" : "NO"} on “{t.us_yes}”
                {t.long ? "" : ` (the same as ${pick})`}
              </span>
            </span>
          )}
          <span>
            Their bet ·{" "}
            <span className="text-zinc-200">
              ${Math.round(t.his_usd).toLocaleString()} at {cents(t.his_price)}
            </span>
          </span>
          <span>
            US price then ·{" "}
            <span className="text-zinc-200">{cents(t.ask)}</span>
            {t.limit ? ` (limit ${cents(t.limit)})` : ""}
          </span>
          {t.want != null && (
            <span>
              Sized to · <span className="text-zinc-200">{usd(t.want)}</span>
            </span>
          )}
          {t.status === "filled" && (
            <span>
              Filled ·{" "}
              <span className="text-zinc-200">
                {t.shares} at {cents(t.price)} · {usd(t.cost ?? 0)} +{" "}
                {usd(t.fee ?? 0)} fee
              </span>
            </span>
          )}
          {t.cur != null && !t.result && (
            <span>
              Now ·{" "}
              <span className="text-zinc-200">
                {cents(t.cur)} · worth {usd(t.value ?? 0)}
              </span>
            </span>
          )}
          {t.result && (
            <span>
              Result ·{" "}
              <span className="text-zinc-200">
                {t.result} · {usd(t.pnl ?? 0, true)}
              </span>
            </span>
          )}
          <span>
            Sport · <span className="text-zinc-200">{sportOf(t)}</span>
          </span>
          {t.why && (
            <span className="sm:col-span-2">
              Why · <span className="text-zinc-200">{t.why}</span>
            </span>
          )}
          {t.advice && (
            <span className="sm:col-span-2">
              {t.advice.verdict === "sell" ? "Lean sell" : "Lean hold"} ·{" "}
              <span className="text-zinc-200">{t.advice.why}</span>
            </span>
          )}
          <span className="flex gap-3 sm:col-span-2">
            {t.us_event && (
              <a
                href={`https://polymarket.us/event/${t.us_event}`}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="text-violet-300 hover:text-violet-200"
              >
                Open on Polymarket US
              </a>
            )}
            {t.slug && (
              <a
                href={eventUrl(t.slug, t.title)}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="text-zinc-400 hover:text-white"
              >
                Their market
              </a>
            )}
            {t.order_id && (
              <span className="text-zinc-600">Order {t.order_id}</span>
            )}
          </span>
        </div>
      )}
    </li>
  );
}

/** Sell now, with the case for and against on hover (polyus._advice: sell value vs hold value, whether they still
 *  hold it, the take-profit test on their past bets). */
function SellNow({
  t,
  busy,
  act,
}: {
  t: Ticket;
  busy: string | null;
  act: (key: string, body: object) => Promise<unknown>;
}) {
  const key = `sell-${t.id}`;
  const a = t.advice;
  return (
    <span
      className="group relative mt-1.5 inline-flex items-center gap-2"
      onClick={(e) => e.stopPropagation()}
    >
      <button
        disabled={busy === key}
        onClick={async () => {
          if (
            await ask.confirm(
              `Sell all of ${pickLabel(t.title, t.outcome)} on Polymarket US now${t.value != null ? `, about ${usd(t.value)}` : ""}?${a ? ` ${a.verdict === "hold" ? "The data leans hold" : "The data leans sell"}: ${a.why}.` : ""}`,
              { ok: "Sell now", danger: true },
            )
          )
            act(key, { action: "sell", id: t.id });
        }}
        className="rounded-full bg-white/[0.08] px-2.5 py-0.5 text-[0.6875rem] font-semibold text-zinc-200 ring-1 ring-white/10 transition hover:bg-red-500/20 hover:text-red-200 disabled:opacity-50"
      >
        {busy === key ? "Selling…" : "Sell now"}
      </button>
      {a && (
        <span
          className={`text-[0.6875rem] font-semibold ${a.verdict === "hold" ? "text-sky-300" : "text-amber-300"}`}
        >
          {a.verdict === "hold" ? "Lean hold" : "Lean sell"}
        </span>
      )}
      {a && (
        <span className="pointer-events-none absolute left-0 top-full z-20 mt-2 hidden w-80 max-w-[80vw] rounded-xl bg-zinc-900 p-3 text-xs leading-relaxed text-zinc-300 shadow-xl ring-1 ring-white/10 group-hover:block">
          <span
            className={`mb-1.5 block font-semibold ${a.verdict === "hold" ? "text-sky-300" : "text-amber-300"}`}
          >
            {a.verdict === "hold" ? "Lean hold" : "Lean sell"}: {a.why}
          </span>
          {a.lines.map((l) => (
            <span key={l} className="mb-1 block">
              {l}
            </span>
          ))}
        </span>
      )}
    </span>
  );
}

const TP_CHOICES = [0, 0.25, 0.5, 0.85, 1, 1.5, 2];

/** Who the bot copies (asked 2026-10-19: "a way for me to add people to copy and set limits"): each person's
 *  minimum bet (smaller bets of theirs are skipped), auto-sell, on / off, remove; add by profile link, @name or wallet,
 *  or one tap for someone you already follow. New people start at $10K+ held to the result. */
function People({
  people,
  followed,
  act,
  busy,
}: {
  people: Person[];
  followed: { wallet: string; name: string }[];
  act: (key: string, body: object) => Promise<unknown>;
  busy: string | null;
}) {
  const [text, setText] = useState("");
  const field =
    "w-24 rounded-lg bg-white/[0.05] px-2.5 py-1 text-sm text-white ring-1 ring-white/10 focus:outline-none focus:ring-violet-400/60";
  return (
    <div className="space-y-2 rounded-xl border border-white/10 p-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">People it copies</div>
      {people.length === 0 && <p className="text-sm text-zinc-500">Nobody yet. Add someone below.</p>}
      {people.map((p) => (
        <div key={p.wallet} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
          <label className="flex min-w-[8rem] items-center gap-2 font-semibold text-white">
            <input
              type="checkbox"
              checked={p.on}
              onChange={() => act(`p-${p.wallet}`, { action: "person_set", wallet: p.wallet, on: !p.on })}
              className="size-4 accent-violet-500"
              title="Copy them (off: paused, kept on the list)"
            />
            <span className={p.on ? "" : "text-zinc-500 line-through"}>{p.name}</span>
          </label>
          <label className="flex items-center gap-1.5 text-xs text-zinc-500">
            their bets of $
            <input
              key={p.min_usd}
              type="number"
              min={0}
              step={1000}
              defaultValue={p.min_usd}
              onBlur={(e) => {
                const v = Number(e.target.value);
                if (e.target.value !== "" && v !== p.min_usd)
                  act(`p-${p.wallet}`, { action: "person_set", wallet: p.wallet, min_usd: v });
              }}
              className={field}
            />
            +
          </label>
          <label className="flex items-center gap-1.5 text-xs text-zinc-500">
            auto-sell
            <select
              value={String(p.take_profit ?? 0)}
              onChange={(e) =>
                act(`p-${p.wallet}`, { action: "person_set", wallet: p.wallet, take_profit: Number(e.target.value) })
              }
              className="rounded-lg bg-white/[0.05] px-2 py-1 text-sm text-white ring-1 ring-white/10 focus:outline-none"
            >
              {TP_CHOICES.map((x) => (
                <option key={x} value={String(x)}>
                  {x ? `+${Math.round(x * 100)}%` : "Hold"}
                </option>
              ))}
            </select>
          </label>
          <button
            onClick={async () => {
              if (await ask.confirm(`Stop copying ${p.name}? Bets already copied from them still sell when they sell.`, { ok: "Remove", danger: true }))
                act(`p-${p.wallet}`, { action: "person_remove", wallet: p.wallet });
            }}
            className="ml-auto text-xs text-zinc-500 hover:text-red-300"
          >
            Remove
          </button>
          {busy === `p-${p.wallet}` && <Loader2 className="size-3.5 animate-spin text-zinc-500" />}
        </div>
      ))}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) act("p-add", { action: "person_add", text }).then(() => setText(""));
        }}
        className="flex flex-wrap items-center gap-2 border-t border-white/[0.06] pt-2"
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Profile link, @name or wallet"
          className="min-w-0 flex-1 rounded-lg bg-white/[0.05] px-3 py-1.5 text-sm text-white ring-1 ring-white/10 placeholder:text-zinc-500 focus:outline-none focus:ring-violet-400/60"
        />
        <button
          disabled={!text.trim() || busy === "p-add"}
          className="flex items-center gap-1 rounded-full bg-violet-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-violet-500 disabled:opacity-50"
        >
          {busy === "p-add" && <Loader2 className="size-3.5 animate-spin" />} Add
        </button>
      </form>
      {followed.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-zinc-500">
          You follow:
          {followed.map((f) => (
            <button
              key={f.wallet}
              onClick={() => act("p-add", { action: "person_add", text: f.wallet })}
              className="rounded-full px-2.5 py-0.5 font-semibold text-zinc-300 ring-1 ring-white/10 hover:text-white"
              title={`Copy ${f.name} ($10K+ to start, held to the result)`}
            >
              + {f.name}
            </button>
          ))}
        </div>
      )}
      <p className="text-xs text-zinc-500">New people start at their $10K+ bets, held to the result. Change it here any time.</p>
    </div>
  );
}
