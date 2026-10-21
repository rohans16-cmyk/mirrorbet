import { useEffect, useState, type ReactNode } from 'react'
import { Check } from 'lucide-react'

export type Scene =
  | 'board'
  | 'odds'
  | 'lines'
  | 'bets'
  | 'bankroll'
  | 'record'
  | 'chart'
  | 'sim'
  | 'plays'
  // Stocks has its own: its pages are about trades and an options account, not slips and bets
  | 'stockBoard'
  | 'stockPlays'
  | 'stockTrades'
  | 'stockBankroll'
  | 'stockRecord'
  | 'stockRules'

/** Each page's loader: what it's doing (ticked off as it goes) and things our own testing found. */
const SCENES: Record<Scene, { title: string; steps: string[]; facts: string[] }> = {
  board: {
    title: 'Building the board',
    steps: ['Reading PrizePicks', 'Projecting every player', 'Pricing each line', 'Ranking the best picks'],
    facts: [
      'A teammate being out changes a player’s share 18–25% more accurately when the model accounts for it.',
      'Blending outside projections at 75% beat our model alone on all 8 NFL stats.',
      'The model’s hit chances are checked against every graded pick; NFL’s first 715 landed within normal noise.',
      'Weather is small but real: wind, rain and cold took pass-yards bias from −7 to 0.',
    ],
  },
  odds: {
    title: 'Pulling the odds',
    steps: ['Checking the sportsbooks', 'Lining up each game', 'Finding the best price', 'Spotting what moved'],
    facts: [
      'PrizePicks often lags the sportsbooks on news, so a book move can show up before the PrizePicks line does.',
      'Two sources for the same game agreed to the half point on the consensus line, gap 0.0 median.',
      'Sharp books move first; a line that moves at every book at once usually means news.',
    ],
  },
  lines: {
    title: 'Watching the lines',
    steps: ['Comparing every save', 'Finding what moved', 'Checking your slips', 'Spotting pulled lines'],
    facts: [
      'A line taken off before its game usually means news (injury, lineup) the board hasn’t priced yet.',
      'When the books move and PrizePicks hasn’t caught up, that’s the classic stale-line spot.',
      'Big moves are 15%+ of the line and at least a full point.',
    ],
  },
  bets: {
    title: 'Grading your slips',
    steps: ['Loading your slips', 'Pulling box scores', 'Grading each leg', 'Adding up the payouts'],
    facts: [
      'An exact hit on a whole-number line is a push, not a Less win.',
      'Goblin hit chances self-correct from your graded record as it grows.',
      'Best bets skip the “last 10” bonus on tiny lines: nearly everyone clears them, so it pointed at dud risks.',
    ],
  },
  bankroll: {
    title: 'Counting your bankroll',
    steps: ['Reading your balance', 'Adding what’s riding', 'Settling finished slips', 'Drawing your bankroll'],
    facts: [
      'Promo entries and promo picks don’t count toward the day’s plan.',
      'Profit vs what the model expected shows luck: a big gap on a few dozen slips is mostly swing.',
      'A few hundred settled slips are needed before an ROI number means much.',
    ],
  },
  record: {
    title: 'Reading your record',
    steps: ['Loading graded picks', 'Matching to the model', 'Checking calibration', 'Finding what’s working'],
    facts: [
      'Calibration is checked in standard deviations, so 374-341 vs 385 expected reads as −0.9 sd: normal noise.',
      'NHL saves calls said 75% and hit 70% until a confidence pull fixed it: now 74% hit 74%.',
      'Cleared-bar goblins ran 22-11 vs 83% predicted, so their chances were pulled down automatically.',
    ],
  },
  plays: {
    title: 'Finding today’s plays',
    steps: ['Reading your record', 'Pricing every leg', 'Taking the haircut', 'Keeping what clears break-even'],
    facts: [
      'Your 60%+ slips said 72% and hit 64%: that gap is why every slip here gets an 8-point haircut.',
      '38 of the 40 lines that moved after you bet moved your way, and those legs hit 85%.',
      'A record counts only on the same kind of bet: 13-0 on Rush Attempts goblins says nothing about a normal Less.',
    ],
  },
  stockBoard: {
    title: 'Reading the market',
    steps: ['Live quotes', 'Tomorrow’s break odds', 'Pricing every contract', 'Ranking by profit at expiry'],
    facts: [
      'A stock that closes near its high breaks that high the next day about 77% of the time, vs 50% normally.',
      'Profit-at-expiry odds are the option market’s own: a fair contract has about zero edge before your view.',
      'A deep in-the-money contract is likelier to pay but costs more; a long shot pays the most and rarely does.',
    ],
  },
  stockPlays: {
    title: 'Scanning for setups',
    steps: ['Scanning 30+ stocks', 'Pricing the contracts', 'Sizing to your bankroll', 'Ranking the setups'],
    facts: [
      'One of a stock’s sharpest 5-day drops tends to bounce: the one price signal that held up in 12 years.',
      'Trading costs decide intraday option trades: a 6% round trip erased the momentum edge.',
      'Chart patterns alone didn’t predict direction in 12 years of daily charts.',
    ],
  },
  stockTrades: {
    title: 'Loading your positions',
    steps: ['Your open trades', 'Live option prices', 'Checking stops and targets', 'Looking for sell signals'],
    facts: [
      'Each position is repriced on the stock’s live price between the exchange’s 15-minute-old quotes.',
      'A sell alert fires once per signal, so you aren’t pinged twice for the same thing.',
      'The first minutes after the open swing both ways: signal alerts wait for the opening range.',
    ],
  },
  stockBankroll: {
    title: 'Tallying your options account',
    steps: ['Loading every trade', 'Pricing what’s open', 'Adding closed profit and loss', 'Drawing the account'],
    facts: [
      'Your account is your starting bankroll plus closed trades; open trades count at their live price.',
      'Expectancy is each closed trade’s P/L over the premium it risked, averaged.',
      'A few dozen closed trades are needed before a win rate means much.',
    ],
  },
  stockRecord: {
    title: 'Grading your trades',
    steps: ['Loading your trades', 'Checking every exit', 'Calls vs puts', 'Finding what’s working'],
    facts: [
      'A trade is graded on what you sold it for, not where the stock went after.',
      'Swing trades and same-day flips are graded apart: they win and lose for different reasons.',
      'The simulators are graded the same way, so you can compare your trades with theirs.',
    ],
  },
  stockRules: {
    title: 'Loading your rules',
    steps: ['Your bankroll', 'Position limits', 'Alerts', 'Strategy settings'],
    facts: [
      'Strict mode blocks a trade that breaks your rules unless you type why.',
      'Your position cap keeps one contract from being too much of the account.',
    ],
  },
  sim: {
    title: 'Opening the paper account',
    steps: [
      'Loading the paper trades',
      'Marking every option live',
      'Checking stops and the close',
      'Adding up the P/L',
    ],
    facts: [
      'A −25% stop on a 1-day option is about a 0.1% wiggle in the stock: day 1’s stops were mostly noise.',
      'Holding to 3:50 PM beat every target and stop tried on 60 days of 5-minute prices.',
      'The break-odds model was right (77% said, 77% happened), but the break is too small to sell at.',
      'Buys before 11 AM ET beat later ones; day 1 bought everything at 1:45 PM.',
      'Trading costs decide intraday options: momentum’s edge was gone at a 6% round trip.',
    ],
  },
  chart: {
    title: 'Reading the charts',
    steps: ['Live prices', 'Drawing the charts', 'Pricing the contracts', 'Running the tested signals'],
    facts: [
      'A stock that closes near its high breaks that high the next day about 77% of the time, vs 50% normally.',
      'One of a stock’s sharpest 5-day drops tends to bounce: the one price signal that held up in 12 years of testing.',
      'Trading costs decide intraday option trades: a 6% round trip erased the momentum edge.',
      'Chart patterns alone didn’t predict direction in 12 years of daily charts.',
    ],
  },
}

const G = 'rgb(52,211,153)'
const R = 'rgb(248,113,113)'
const d = (ms: number) => ({ animationDelay: `${ms}ms` })

/** Cards dealt from a deck into a row; each one's hit-chance bar fills; the best gets a star. */
function BoardScene() {
  const cards = [0.71, 0.58, 0.83, 0.64, 0.52]
  return (
    <>
      {cards.map((p, i) => {
        const x = 70 + i * 140
        const best = p === Math.max(...cards)
        return (
          <g key={i} className="ld-deal" style={{ ...d(i * 140), ['--dx' as string]: `${330 - x}px` }}>
            <rect
              x={x}
              y={40}
              width={120}
              height={170}
              rx={14}
              fill="rgba(255,255,255,0.05)"
              stroke={best ? 'rgba(251,191,36,0.7)' : 'rgba(255,255,255,0.1)'}
              strokeWidth={best ? 2 : 1}
            />
            <circle cx={x + 60} cy={88} r={22} fill="rgba(255,255,255,0.08)" />
            <rect x={x + 22} y={124} width={76} height={7} rx={3.5} fill="rgba(255,255,255,0.12)" />
            <rect x={x + 32} y={138} width={56} height={6} rx={3} fill="rgba(255,255,255,0.07)" />
            <rect x={x + 16} y={176} width={88} height={8} rx={4} fill="rgba(255,255,255,0.06)" />
            <rect
              className="ld-fill"
              style={d(700 + i * 140)}
              x={x + 16}
              y={176}
              width={88 * p}
              height={8}
              rx={4}
              fill={p >= 0.6 ? G : 'rgb(251,191,36)'}
            />
            <text
              className="ld-pop"
              style={d(900 + i * 140)}
              x={x + 60}
              y={166}
              textAnchor="middle"
              fontSize={15}
              fontWeight={800}
              fill="#fff"
            >
              {Math.round(p * 100)}%
            </text>
            {best && (
              <text
                className="ld-pop"
                style={d(1700)}
                x={x + 104}
                y={60}
                textAnchor="middle"
                fontSize={22}
                fill="rgb(251,191,36)"
              >
                ★
              </text>
            )}
          </g>
        )
      })}
    </>
  )
}

/** A board of matchups and prices that flip in like a split-flap sign; the best price in each row lights up. */
function OddsScene() {
  const rows = [
    ['−110', '−105', '−112'],
    ['+145', '+150', '+138'],
    ['−240', '−225', '−250'],
    ['+102', '−104', '+100'],
  ]
  const best = [1, 1, 1, 0]
  return (
    <>
      {rows.map((r, i) => (
        <g key={i}>
          <rect x={40} y={34 + i * 52} width={190} height={40} rx={10} fill="rgba(255,255,255,0.04)" />
          <rect x={56} y={48 + i * 52} width={110} height={8} rx={4} fill="rgba(255,255,255,0.12)" />
          <rect x={56} y={60 + i * 52} width={70} height={6} rx={3} fill="rgba(255,255,255,0.06)" />
          {r.map((o, j) => {
            const x = 260 + j * 170
            const b = best[i] === j
            return (
              <g key={j} className="ld-flip" style={d(i * 160 + j * 90)}>
                <rect
                  x={x}
                  y={34 + i * 52}
                  width={150}
                  height={40}
                  rx={10}
                  fill={b ? 'rgba(52,211,153,0.12)' : 'rgba(255,255,255,0.05)'}
                  stroke={b ? 'rgba(52,211,153,0.55)' : 'none'}
                />
                <line x1={x} x2={x + 150} y1={54 + i * 52} y2={54 + i * 52} stroke="rgba(0,0,0,0.35)" />
                <text
                  x={x + 75}
                  y={60 + i * 52}
                  textAnchor="middle"
                  fontSize={17}
                  fontWeight={800}
                  fill={b ? G : '#e4e4e7'}
                  fontFamily="ui-monospace, monospace"
                >
                  {o}
                </text>
              </g>
            )
          })}
        </g>
      ))}
    </>
  )
}

/** Three props' lines stepping over time; one moves a lot, one gets pulled. */
function LinesScene() {
  const paths = [
    { d: 'M40,60 H220 V48 H420 V48 H560 V30 H760', c: G, tag: '+28%', ty: 26 },
    { d: 'M40,130 H300 V142 H520 V160 H760', c: R, tag: '−19%', ty: 156 },
    { d: 'M40,210 H380', c: 'rgba(161,161,170,0.7)', tag: '', ty: 0 },
  ]
  return (
    <>
      {paths.map((p, i) => (
        <g key={i}>
          <path
            className="draw-in"
            style={d(i * 260)}
            pathLength={1}
            d={p.d}
            fill="none"
            stroke={p.c}
            strokeWidth={3}
            strokeLinecap="round"
          />
          {p.tag && (
            <g className="ld-pop" style={d(1300 + i * 200)}>
              <rect x={690} y={p.ty - 16} width={64} height={24} rx={12} fill="rgba(12,13,20,0.9)" stroke={p.c} />
              <text x={722} y={p.ty} textAnchor="middle" fontSize={13} fontWeight={800} fill={p.c}>
                {p.tag}
              </text>
            </g>
          )}
        </g>
      ))}
      <g className="ld-pop" style={d(1500)}>
        <circle cx={392} cy={210} r={13} fill="rgba(248,113,113,0.2)" stroke={R} strokeWidth={2} />
        <path d="M386,204 L398,216 M398,204 L386,216" stroke={R} strokeWidth={2.5} strokeLinecap="round" />
        <text x={416} y={215} fontSize={13} fontWeight={700} fill={R}>
          pulled
        </text>
      </g>
    </>
  )
}

/** A slip printing up out of a slot, its legs ticked off one by one, the payout stamped at the bottom. */
function BetsScene() {
  const legs = [true, true, false, true]
  return (
    <>
      <rect x={250} y={226} width={300} height={10} rx={5} fill="rgba(255,255,255,0.12)" />
      <g className="ld-print">
        <rect
          x={290}
          y={20}
          width={220}
          height={210}
          rx={12}
          fill="rgba(255,255,255,0.06)"
          stroke="rgba(255,255,255,0.12)"
        />
        {legs.map((ok, i) => (
          <g key={i}>
            <rect x={310} y={42 + i * 36} width={120} height={8} rx={4} fill="rgba(255,255,255,0.14)" />
            <rect x={310} y={54 + i * 36} width={80} height={6} rx={3} fill="rgba(255,255,255,0.06)" />
            <g className="ld-pop" style={d(900 + i * 300)}>
              <circle cx={480} cy={50 + i * 36} r={11} fill={ok ? 'rgba(52,211,153,0.18)' : 'rgba(248,113,113,0.18)'} />
              <path
                d={ok ? `M474,${50 + i * 36} l4,4 l8,-8` : `M475,${45 + i * 36} l10,10 M485,${45 + i * 36} l-10,10`}
                stroke={ok ? G : R}
                strokeWidth={2.4}
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </g>
          </g>
        ))}
        <line x1={310} x2={490} y1={190} y2={190} stroke="rgba(255,255,255,0.1)" strokeDasharray="4 4" />
        <text
          className="ld-pop"
          style={d(2200)}
          x={400}
          y={216}
          textAnchor="middle"
          fontSize={16}
          fontWeight={800}
          fill={G}
        >
          3 of 4 · graded
        </text>
      </g>
    </>
  )
}

/** Bars growing, a profit line drawn over them, a coin popping at the end. */
function BankrollScene() {
  const bars = [40, 62, 48, 80, 70, 104, 92, 130]
  return (
    <>
      {bars.map((h, i) => (
        <rect
          key={i}
          className="ld-grow"
          style={d(i * 90)}
          x={90 + i * 80}
          y={230 - h}
          width={46}
          height={h}
          rx={8}
          fill={i % 3 === 2 ? 'rgba(248,113,113,0.45)' : 'rgba(52,211,153,0.45)'}
        />
      ))}
      <path
        className="draw-in"
        style={d(900)}
        pathLength={1}
        d={bars.map((h, i) => `${i ? 'L' : 'M'}${113 + i * 80},${215 - h}`).join(' ')}
        fill="none"
        stroke="#fff"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <g className="ld-pop" style={d(1800)}>
        <circle cx={673} cy={85} r={16} fill="rgb(251,191,36)" />
        <text x={673} y={91} textAnchor="middle" fontSize={16} fontWeight={900} fill="#713f12">
          $
        </text>
      </g>
    </>
  )
}

/** A calendar filling in day by day with hits and misses. */
function RecordScene() {
  const cells = Array.from({ length: 35 }, (_, i) => ((i * 7 + 3) % 10 < 6 ? 'w' : (i * 5) % 9 < 3 ? 'p' : 'l'))
  return (
    <>
      {cells.map((c, i) => {
        const x = 170 + (i % 7) * 66
        const y = 22 + Math.floor(i / 7) * 44
        return (
          <rect
            key={i}
            className="ld-pop"
            style={d(i * 45)}
            x={x}
            y={y}
            width={54}
            height={34}
            rx={8}
            fill={c === 'w' ? 'rgba(52,211,153,0.5)' : c === 'l' ? 'rgba(248,113,113,0.45)' : 'rgba(255,255,255,0.07)'}
          />
        )
      })}
    </>
  )
}

/** Candles growing in, a moving average drawn through them. */
function ChartScene() {
  const c = [50, 56, 52, 61, 58, 66, 62, 70, 67, 74, 71, 78, 75, 82, 79, 85]
  return (
    <>
      {c.map((v, i) => {
        const prev = i ? c[i - 1] : v - 4
        const up = v >= prev
        const top = 250 - Math.max(v, prev) * 2.6
        const h = Math.max(4, Math.abs(v - prev) * 2.6)
        return (
          <g key={i} className="ld-candle" style={d(i * 60)}>
            <line
              x1={70 + i * 44}
              x2={70 + i * 44}
              y1={top - 10}
              y2={top + h + 10}
              stroke={up ? G : R}
              strokeOpacity={0.6}
              strokeWidth={1.5}
            />
            <rect x={60 + i * 44} y={top} width={20} height={h} rx={3} fill={up ? G : R} fillOpacity={0.85} />
          </g>
        )
      })}
      <path
        className="draw-in"
        style={d(1100)}
        pathLength={1}
        d={c.map((v, i) => `${i ? 'L' : 'M'}${70 + i * 44},${262 - v * 2.6}`).join(' ')}
        fill="none"
        stroke="rgb(56,189,248)"
        strokeWidth={2.5}
        strokeLinecap="round"
      />
    </>
  )
}

/** A price line drawing itself, buys and sells popping onto it with their P/L, the account total landing at the end. */
function SimScene() {
  const pts = [150, 140, 152, 128, 118, 126, 104, 112, 96, 88, 100, 76, 84, 70]
  const x = (i: number) => 50 + i * 54
  const trades: [number, number, boolean][] = [
    [1, 4, true],
    [5, 7, false],
    [8, 11, true],
  ]
  return (
    <>
      {[60, 120, 180].map((y) => (
        <line key={y} x1={30} x2={770} y1={y} y2={y} stroke="rgba(255,255,255,0.04)" />
      ))}
      <path
        className="draw-in"
        pathLength={1}
        d={pts.map((y, i) => `${i ? 'L' : 'M'}${x(i)},${y}`).join(' ')}
        fill="none"
        stroke="rgba(255,255,255,0.75)"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {trades.map(([a, b, win], k) => (
        <g key={k}>
          <line
            className="animate-fade"
            style={d(500 + k * 450)}
            x1={x(a)}
            x2={x(b)}
            y1={pts[a]}
            y2={pts[b]}
            stroke={win ? G : R}
            strokeWidth={6}
            strokeOpacity={0.18}
            strokeLinecap="round"
          />
          <path className="ld-pop" style={d(400 + k * 450)} d={`M${x(a) - 8},${pts[a] + 16} l8,-12 l8,12 z`} fill={G} />
          <circle
            className="ld-pop"
            style={d(700 + k * 450)}
            cx={x(b)}
            cy={pts[b]}
            r={7}
            fill={win ? G : R}
            stroke="#0f1017"
            strokeWidth={2}
          />
          <g className="ld-pop" style={d(800 + k * 450)}>
            <rect
              x={x(b) - 30}
              y={pts[b] - 38}
              width={60}
              height={22}
              rx={11}
              fill="rgba(12,13,20,0.9)"
              stroke={win ? G : R}
            />
            <text x={x(b)} y={pts[b] - 23} textAnchor="middle" fontSize={12} fontWeight={800} fill={win ? G : R}>
              {win ? '+$62' : '−$41'}
            </text>
          </g>
        </g>
      ))}
      <g className="ld-pop" style={d(2100)}>
        <rect
          x={600}
          y={196}
          width={150}
          height={44}
          rx={14}
          fill="rgba(52,211,153,0.12)"
          stroke="rgba(52,211,153,0.5)"
        />
        <text x={675} y={225} textAnchor="middle" fontSize={20} fontWeight={900} fill={G}>
          +$83
        </text>
      </g>
    </>
  )
}

const DRAW: Record<Scene, () => ReactNode> = {
  sim: SimScene,
  plays: BetsScene,
  stockBoard: ChartScene,
  stockPlays: ChartScene,
  stockTrades: ChartScene,
  stockBankroll: BankrollScene,
  stockRecord: RecordScene,
  stockRules: ChartScene,
  board: BoardScene,
  odds: OddsScene,
  lines: LinesScene,
  bets: BetsScene,
  bankroll: BankrollScene,
  record: RecordScene,
  chart: ChartScene,
}

/** A full loading screen for a page: its own animated scene, a checklist of what it's doing (moves on a timer and
 *  waits on the last step), and a fact from our own testing rotating underneath. `label` replaces the title. */
export function PageLoader({ scene, label, className = '' }: { scene: Scene; label?: string; className?: string }) {
  const cfg = SCENES[scene]
  const [step, setStep] = useState(0)
  const [fact, setFact] = useState(() => Math.floor(Math.random() * cfg.facts.length))
  useEffect(() => {
    const a = setInterval(() => setStep((s) => Math.min(s + 1, cfg.steps.length - 1)), 1000)
    const b = setInterval(() => setFact((f) => (f + 1) % cfg.facts.length), 4200)
    return () => {
      clearInterval(a)
      clearInterval(b)
    }
  }, [cfg])
  const Draw = DRAW[scene]
  return (
    <section
      role="status"
      aria-live="polite"
      className={`animate-rise overflow-hidden rounded-3xl border border-white/[0.08] bg-gradient-to-b from-[#15161f] to-[#0f1017] ${className}`}
    >
      <div className="px-5 pt-5">
        <div className="ld-shimmer text-2xl font-black tracking-tight">{label ?? cfg.title}</div>
      </div>
      <div className="grid gap-4 p-4 md:p-5 lg:grid-cols-[1fr_16rem]">
        <div className="relative overflow-hidden rounded-2xl bg-black/20 ring-1 ring-white/[0.05]">
          <svg viewBox="0 0 800 260" className="block h-[240px] w-full" aria-hidden>
            <Draw />
          </svg>
          <div className="ld-scan pointer-events-none absolute inset-y-0 w-24 bg-gradient-to-r from-transparent via-white/[0.05] to-transparent" />
        </div>
        <ol className="space-y-1.5 self-center">
          {cfg.steps.map((t, i) => {
            const done = i < step
            const now = i === step
            return (
              <li
                key={t}
                className={`flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm transition-colors ${now ? 'bg-white/[0.05] text-white' : done ? 'text-zinc-300' : 'text-zinc-600'}`}
              >
                <span className="grid size-5 shrink-0 place-items-center">
                  {done ? (
                    <span className="ld-pop grid size-5 place-items-center rounded-full bg-emerald-500/20">
                      <Check className="size-3 text-emerald-300" strokeWidth={3} />
                    </span>
                  ) : now ? (
                    <span className="size-4 animate-spin rounded-full border-2 border-sky-400/25 border-t-sky-400" />
                  ) : (
                    <span className="size-1.5 rounded-full bg-zinc-700" />
                  )}
                </span>
                {t}
              </li>
            )
          })}
        </ol>
      </div>
      <div className="border-t border-white/[0.05] px-5 py-3">
        <p key={fact} className="animate-fade text-xs leading-relaxed text-zinc-400">
          <span className="mr-1.5 rounded bg-white/[0.06] px-1.5 py-0.5 text-[0.625rem] font-bold uppercase tracking-wide text-zinc-300">
            From our tests
          </span>
          {cfg.facts[fact]}
        </p>
      </div>
    </section>
  )
}
