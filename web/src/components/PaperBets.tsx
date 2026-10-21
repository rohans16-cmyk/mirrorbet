import { useEffect, useState } from "react";
import { Pause, Play, Plus, RotateCcw, Trash2, X } from "lucide-react";
import { EmptyState, LoadError } from "@/components/ui/EmptyState";
import { PageLoader } from "@/components/PageLoader";
import { ask } from "@/components/ui/ask";
import { Section, Tiles } from "@/components/ledger/Kit";
import { eventUrl, pickLabel } from "@/lib/polybet";

type Pos = {
  asset: string;
  title: string;
  outcome: string;
  slug: string;
  price: number;
  cost: number;
  shares: number;
  at: string;
  status: "open" | "won" | "lost" | "sold";
  cur: number | null;
  exit?: number;
  pnl?: number;
  by: string[];
  why?: string;
  theirs?: number;
};
type Sim = {
  id: string;
  name: string;
  wallets: "all" | string[];
  mode: "copy" | "best";
  min_agree: number;
  stake: number;
  max_stake: number;
  bankroll: number;
  min_trader_usd: number;
  max_price: number;
  follow_sells: boolean;
  active: boolean;
  created_at: string;
  people: string[];
  usual: Record<string, number | null>;
  cash: number;
  value: number;
  equity: number;
  pnl: number;
  w: number;
  l: number;
  roi: number | null;
  open: Pos[];
  settled: Pos[];
  history: {
    w: number;
    l: number;
    pnl: number;
    roi: number | null;
    since: number | null;
  };
};
type Data = {
  ok: boolean;
  error?: string;
  sims: Sim[];
  people: { wallet: string; name: string }[];
};

const usd = (x: number | null | undefined, sign = false) => {
  if (x == null) return "–";
  const a = Math.abs(x);
  const s =
    a >= 1e6
      ? `$${(a / 1e6).toFixed(2)}M`
      : a >= 1e4
        ? `$${(a / 1e3).toFixed(1)}K`
        : `$${a.toLocaleString(undefined, { maximumFractionDigits: a < 100 ? 2 : 0 })}`;
  return x < 0 ? `−${s}` : sign ? `+${s}` : s;
};
const pct = (x: number | null | undefined) =>
  x == null ? "–" : `${x >= 0 ? "+" : "−"}${Math.abs(100 * x).toFixed(1)}%`;
const cents = (p: number | null | undefined) =>
  p == null ? "" : `${Math.round(p * 100)}¢`;
const tone = (x: number) =>
  x > 0 ? "text-emerald-300" : x < 0 ? "text-red-300" : "text-zinc-300";
const day = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });

const PAGE = 20; // settled bets a page

const post = (body: object) =>
  fetch("/api/polymarket/sims", {
    method: "POST",
    body: JSON.stringify(body),
  }).then((r) => r.json());

/** Paper bets on Polymarket (copysim.py): fake-money accounts that copy Best Bets, or one or more of the profiles
 *  you follow. Each shows how it's doing live and how the same rules did on their past bets. */
export function PaperBets() {
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [making, setMaking] = useState(false);
  const load = () =>
    fetch("/api/polymarket/sims")
      .then((r) => r.json())
      .then((x: Data) =>
        x.ok
          ? (setD(x), setErr(null))
          : setErr(x.error || "Could not load paper bets"),
      )
      .catch(() => setErr("Cannot reach the server"));
  useEffect(() => {
    load();
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, []);
  if (err && !d) return <LoadError err={err} retry={load} />;
  if (!d) return <PageLoader scene="sim" label="Loading paper bets…" />;
  return (
    <div className="space-y-5">
      {making ? (
        <NewSim
          people={d.people}
          onDone={() => {
            setMaking(false);
            load();
          }}
        />
      ) : (
        <button
          onClick={() => setMaking(true)}
          className="flex items-center gap-1 rounded-full bg-violet-600 px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-violet-500"
        >
          <Plus className="size-4" /> New
        </button>
      )}
      {d.sims.map((s) => (
        <SimCard key={s.id} s={s} reload={load} />
      ))}
    </div>
  );
}

function rules(s: Sim) {
  return [
    `${usd(s.stake)} when they bet their usual (${Object.values(s.usual)
      .map((u) => usd(u))
      .join(" / ")}), more or less as they do, up to ${usd(s.max_stake)}`,
    s.mode === "best" ? `${s.min_agree}+ agree` : "every bet",
    `their bet ${usd(s.min_trader_usd)}+`,
    `up to ${cents(s.max_price)}`,
    s.follow_sells ? "sells when they sell" : "holds to the result",
  ].join(" · ");
}

function SimCard({ s, reload }: { s: Sim; reload: () => void }) {
  const [showDone, setShowDone] = useState(false);
  const [page, setPage] = useState(0);
  const pages = Math.ceil(s.settled.length / PAGE);
  const n = s.w + s.l;
  const h = s.history;
  const hn = h.w + h.l;
  const act = (body: object) =>
    post({ action: "update", id: s.id, ...body }).then(reload);
  const iconBtn =
    "rounded-full p-2 text-zinc-500 transition hover:bg-white/[0.06] hover:text-white";
  return (
    <Section pad={false}>
      <div className="space-y-4 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-semibold text-white">{s.name}</h3>
              {!s.active && (
                <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-xs text-zinc-400">
                  Paused
                </span>
              )}
            </div>
            {/* who it copies, unless the name already says ("Copy Kch-Temp") */}
            {(s.wallets === "all" ||
              !s.people.every((n) => s.name.includes(n))) && (
              <p className="text-sm text-zinc-400">
                {s.wallets === "all"
                  ? "Everyone you follow"
                  : s.people.join(", ")}
              </p>
            )}
            <p className="text-xs text-zinc-500">
              {rules(s)} · since {day(s.created_at)}
            </p>
          </div>
          <div className="flex items-center">
            <button
              onClick={() => act({ active: !s.active })}
              title={s.active ? "Pause" : "Resume"}
              className={iconBtn}
            >
              {s.active ? (
                <Pause className="size-4" />
              ) : (
                <Play className="size-4" />
              )}
            </button>
            <button
              onClick={async () => {
                if (
                  await ask.confirm(
                    `Start ${s.name} over? Its bets are cleared and the bankroll resets.`,
                    { ok: "Start over" },
                  )
                )
                  act({ reset: true });
              }}
              title="Start over"
              className={iconBtn}
            >
              <RotateCcw className="size-4" />
            </button>
            {s.id !== "best" && (
              <button
                onClick={async () => {
                  if (
                    await ask.confirm(`Delete ${s.name}?`, {
                      ok: "Delete",
                      danger: true,
                    })
                  )
                    post({ action: "remove", id: s.id }).then(reload);
                }}
                title="Delete"
                className={`${iconBtn} hover:text-red-300`}
              >
                <Trash2 className="size-4" />
              </button>
            )}
          </div>
        </div>

        <Tiles
          tiles={[
            {
              label: "P/L",
              value: usd(s.pnl, true),
              tone: s.pnl > 0 ? "good" : s.pnl < 0 ? "bad" : undefined,
              sub: `${usd(s.equity)} of ${usd(s.bankroll)}`,
            },
            {
              label: "Record",
              value: n ? `${s.w}–${s.l}` : "–",
              sub: `${s.open.length} open`,
            },
            {
              label: "ROI",
              value: pct(s.roi),
              sub: n ? "on settled bets" : "nothing settled yet",
            },
            {
              label: "Past bets",
              value: hn ? pct(h.roi) : "–",
              tone: !hn ? undefined : (h.roi ?? 0) >= 0 ? "good" : "bad",
              sub: hn
                ? `${h.w}–${h.l} · ${usd(h.pnl, true)} sized like theirs`
                : "none match these rules",
            },
          ]}
        />
      </div>

      {s.open.length > 0 && <PosList rows={s.open} />}
      {s.settled.length > 0 && (
        <div className="border-t border-white/[0.06]">
          <button
            onClick={() => setShowDone((v) => !v)}
            className="w-full px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500 hover:text-white"
          >
            {showDone ? "Hide settled" : `Settled (${s.settled.length})`}
          </button>
          {showDone && (
            <>
              <PosList rows={s.settled.slice(page * PAGE, (page + 1) * PAGE)} />
              {pages > 1 && (
                <div className="flex items-center justify-between border-t border-white/[0.06] px-4 py-2 text-xs text-zinc-500">
                  <button
                    disabled={page === 0}
                    onClick={() => setPage((p) => p - 1)}
                    className="rounded-full px-3 py-1 font-semibold hover:text-white disabled:opacity-30"
                  >
                    Newer
                  </button>
                  <span>
                    {page * PAGE + 1}–
                    {Math.min((page + 1) * PAGE, s.settled.length)} of{" "}
                    {s.settled.length}
                  </span>
                  <button
                    disabled={page >= pages - 1}
                    onClick={() => setPage((p) => p + 1)}
                    className="rounded-full px-3 py-1 font-semibold hover:text-white disabled:opacity-30"
                  >
                    Older
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </Section>
  );
}

function PosList({ rows }: { rows: Pos[] }) {
  return (
    <div className="divide-y divide-white/[0.06] border-t border-white/[0.06]">
      {rows.map((x) => {
        const open = x.status === "open";
        const pnl = open ? x.shares * (x.cur ?? 0) - x.cost : (x.pnl ?? 0);
        return (
          <a
            key={x.asset + x.at}
            href={eventUrl(x.slug, x.title)}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-3 px-4 py-2.5 transition hover:bg-white/[0.03]"
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-white">
                {pickLabel(x.title, x.outcome)}
                <span className="ml-1.5 font-normal text-zinc-400">
                  {cents(x.price)} → {cents(open ? x.cur : x.exit)}
                </span>
              </span>
              <span className="block truncate text-xs text-zinc-500">
                {x.title} · {x.by.join(" + ")}
                {x.theirs ? ` ${usd(x.theirs)} → you ${usd(x.cost)}` : ""}
                {x.why ? ` · ${x.why}` : ""}
              </span>
            </span>
            <span className="shrink-0 text-right">
              <span className={`block text-sm font-semibold ${tone(pnl)}`}>
                {usd(pnl, true)}
              </span>
              <span
                className={`text-xs capitalize ${open ? "text-zinc-500" : tone(pnl)}`}
              >
                {open ? day(x.at) : x.status}
              </span>
            </span>
          </a>
        );
      })}
    </div>
  );
}

function NewSim({
  people,
  onDone,
}: {
  people: { wallet: string; name: string }[];
  onDone: () => void;
}) {
  const [name, setName] = useState("");
  const [who, setWho] = useState<string[]>([]);
  const [mode, setMode] = useState<"copy" | "best">("copy");
  const [agree, setAgree] = useState(2);
  const [stake, setStake] = useState("100");
  const [maxStake, setMaxStake] = useState("500");
  const [bank, setBank] = useState("1000");
  const [minUsd, setMinUsd] = useState("25");
  const [maxC, setMaxC] = useState("97");
  const [sells, setSells] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  if (!people.length)
    return (
      <EmptyState
        title="Follow someone first"
        hint="Paper bets copy the profiles you follow."
      />
    );
  const toggle = (w: string) =>
    setWho((cur) =>
      cur.includes(w) ? cur.filter((x) => x !== w) : [...cur, w],
    );
  const field =
    "w-24 rounded-lg bg-white/[0.05] px-3 py-1.5 text-sm text-white ring-1 ring-white/10 focus:outline-none focus:ring-violet-400/60";
  const chip = (on: boolean) =>
    `rounded-full px-3 py-1 text-sm font-semibold ring-1 transition ${on ? "bg-white text-black ring-white" : "text-zinc-400 ring-white/10 hover:text-white"}`;
  const save = async () => {
    setSaving(true);
    setErr(null);
    const r = await post({
      name:
        name ||
        (who.length === 1
          ? `Copy ${people.find((p) => p.wallet === who[0])?.name}`
          : "Paper bets"),
      wallets: who,
      mode: who.length > 1 ? mode : "copy",
      min_agree: agree,
      stake: Number(stake),
      max_stake: Number(maxStake),
      bankroll: Number(bank),
      min_trader_usd: Number(minUsd),
      max_price: Number(maxC) / 100,
      follow_sells: sells,
    }).catch(() => ({ ok: false, error: "Cannot reach the server" }));
    setSaving(false);
    if (!r.ok) return setErr(r.error);
    onDone();
  };
  return (
    <Section
      title="New paper bets"
      right={
        <button
          onClick={onDone}
          className="rounded-full p-1 text-zinc-500 hover:text-white"
          title="Cancel"
        >
          <X className="size-4" />
        </button>
      }
    >
      <div className="space-y-4">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name (optional)"
          className="w-full max-w-xs rounded-lg bg-white/[0.05] px-3 py-1.5 text-sm text-white ring-1 ring-white/10 placeholder:text-zinc-500 focus:outline-none focus:ring-violet-400/60"
        />
        <div className="space-y-1.5">
          <p className="text-xs text-zinc-500">Copy</p>
          <div className="flex flex-wrap gap-1.5">
            {people.map((p) => (
              <button
                key={p.wallet}
                onClick={() => toggle(p.wallet)}
                className={chip(who.includes(p.wallet))}
              >
                {p.name}
              </button>
            ))}
          </div>
        </div>
        {who.length > 1 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              onClick={() => setMode("copy")}
              className={chip(mode === "copy")}
            >
              Every bet any of them makes
            </button>
            <button
              onClick={() => setMode("best")}
              className={chip(mode === "best")}
            >
              Only when they agree
            </button>
            {mode === "best" && (
              <label className="ml-2 flex items-center gap-2 text-sm text-zinc-400">
                at least
                <input
                  type="number"
                  min={2}
                  max={who.length}
                  value={agree}
                  onChange={(e) =>
                    setAgree(
                      Math.max(
                        2,
                        Math.min(who.length, Number(e.target.value) || 2),
                      ),
                    )
                  }
                  className="w-16 rounded-lg bg-white/[0.05] px-2 py-1 text-sm text-white ring-1 ring-white/10"
                />
                of {who.length}
              </label>
            )}
          </div>
        )}
        <div className="flex flex-wrap gap-4">
          {(
            [
              ["Bet at their usual size $", stake, setStake],
              ["Max a bet $", maxStake, setMaxStake],
              ["Bankroll $", bank, setBank],
              ["Skip their bets under $", minUsd, setMinUsd],
              ["Max price ¢", maxC, setMaxC],
            ] as const
          ).map(([label, v, set]) => (
            <label key={label} className="space-y-1 text-xs text-zinc-500">
              <span className="block">{label}</span>
              <input
                type="number"
                value={v}
                onChange={(e) => set(e.target.value)}
                className={field}
              />
            </label>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm text-zinc-300">
          <input
            type="checkbox"
            checked={sells}
            onChange={(e) => setSells(e.target.checked)}
            className="accent-violet-500"
          />
          Sell when they sell (otherwise hold to the result)
        </label>
        {err && <p className="text-sm text-red-300">{err}</p>}
        <button
          disabled={saving || !who.length}
          onClick={save}
          className="rounded-full bg-violet-600 px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-violet-500 disabled:opacity-50"
        >
          Start
        </button>
      </div>
    </Section>
  );
}
