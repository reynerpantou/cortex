import { useEffect, useRef, useState } from "react";

// Categorical slots validated (CVD + normal-vision + 3:1 contrast) against
// Cortex's dark card surface #1e212a, assigned in fixed order. "Other" is a
// neutral fold, not a hue, so it also carries a hatch texture — never color alone.
export const SERIES = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181"];
export const OTHER_COLOR = "#6b7285";
export const INCOME_COLOR = "#199e70";
export const EXPENSE_COLOR = "#d95926";

export interface Slice {
  key: string;
  label: string;
  value: number;
  color: string;
  hatched?: boolean;
}

interface DonutProps {
  slices: Slice[];
  total: number;
  centerLabel: string;
  format: (v: number) => string;
  active: string | null;
  onHover: (key: string | null) => void;
  onSelect?: (key: string) => void;
}

const CX = 110;
const CY = 110;
const R_OUT = 100;
const R_IN = 68;

function arcPath(start: number, end: number): string {
  const large = end - start > Math.PI ? 1 : 0;
  const p = (r: number, a: number) => `${CX + r * Math.sin(a)} ${CY - r * Math.cos(a)}`;
  return [
    `M ${p(R_OUT, start)}`,
    `A ${R_OUT} ${R_OUT} 0 ${large} 1 ${p(R_OUT, end)}`,
    `L ${p(R_IN, end)}`,
    `A ${R_IN} ${R_IN} 0 ${large} 0 ${p(R_IN, start)}`,
    "Z",
  ].join(" ");
}

const pctText = (part: number, whole: number) => {
  const pct = whole > 0 ? (part / whole) * 100 : 0;
  return `${pct.toFixed(pct < 10 ? 1 : 0)}%`;
};

export function Donut({ slices, total, centerLabel, format, active, onHover, onSelect }: DonutProps) {
  const visible = slices.filter((s) => s.value > 0);
  const hovered = visible.find((s) => s.key === active) ?? null;
  let angle = 0;

  return (
    <svg className="donut" viewBox="0 0 220 220" role="img" aria-label={centerLabel}>
      <defs>
        <pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="6" height="6" fill={OTHER_COLOR} />
          <line x1="0" y1="0" x2="0" y2="6" stroke="#9aa0b1" strokeWidth="2" />
        </pattern>
      </defs>
      {visible.length === 1 ? (
        <circle
          cx={CX}
          cy={CY}
          r={(R_OUT + R_IN) / 2}
          fill="none"
          stroke={visible[0].hatched ? "url(#hatch)" : visible[0].color}
          strokeWidth={R_OUT - R_IN}
          onMouseEnter={() => onHover(visible[0].key)}
          onMouseLeave={() => onHover(null)}
          onClick={() => onSelect?.(visible[0].key)}
          style={{ cursor: onSelect ? "pointer" : "default" }}
        />
      ) : (
        visible.map((s) => {
          const start = angle;
          const end = angle + (s.value / total) * Math.PI * 2;
          angle = end;
          return (
            <path
              key={s.key}
              d={arcPath(start, end)}
              fill={s.hatched ? "url(#hatch)" : s.color}
              stroke="var(--bg-1)"
              strokeWidth={2}
              opacity={active && active !== s.key ? 0.45 : 1}
              onMouseEnter={() => onHover(s.key)}
              onMouseLeave={() => onHover(null)}
              onClick={() => onSelect?.(s.key)}
              style={{ cursor: onSelect ? "pointer" : "default", transition: "opacity 0.12s ease" }}
            >
              <title>{`${s.label}: ${format(s.value)} (${pctText(s.value, total)})`}</title>
            </path>
          );
        })
      )}
      <text x={CX} y={CY - 8} textAnchor="middle" className="donut-center-label">
        {hovered ? hovered.label : centerLabel}
      </text>
      <text x={CX} y={CY + 16} textAnchor="middle" className="donut-center-value">
        {format(hovered ? hovered.value : total)}
      </text>
      {hovered && (
        <text x={CX} y={CY + 34} textAnchor="middle" className="donut-center-pct">
          {pctText(hovered.value, total)}
        </text>
      )}
    </svg>
  );
}

interface TrendProps {
  points: { label: string; income: number; expense: number }[];
  incomeLabel: string;
  expenseLabel: string;
  netLabel: string;
  format: (v: number) => string;
  compact: (v: number) => string;
}

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / exp;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nice * exp;
}

// Grouped bars (income vs expense per month) on one shared axis, with a
// per-month hover tooltip. Thin bars, 4px rounded tops anchored to the
// baseline, hairline gridlines.
export function TrendChart({ points, incomeLabel, expenseLabel, netLabel, format, compact }: TrendProps) {
  const [hover, setHover] = useState<number | null>(null);
  // Draw at the container's real width (not a scaled viewBox) so tick labels
  // stay legible on a phone instead of shrinking with the chart.
  const plotRef = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(640);
  useEffect(() => {
    const el = plotRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setW(Math.max(280, Math.round(entry.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const H = 220;
  const PAD_L = 48;
  const PAD_R = 8;
  const PAD_T = 12;
  const PAD_B = 28;
  const max = niceMax(Math.max(0, ...points.flatMap((p) => [p.income, p.expense])));
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;
  const groupW = plotW / Math.max(points.length, 1);
  const barW = Math.min(18, groupW / 3.2);
  const y = (v: number) => PAD_T + plotH - (v / max) * plotH;
  const ticks = [0, max / 2, max];

  const bar = (x: number, v: number, color: string) => {
    const h = Math.max(0, (v / max) * plotH);
    if (h <= 0) return null;
    const r = Math.min(4, h, barW / 2);
    const top = PAD_T + plotH - h;
    const bottom = PAD_T + plotH;
    return (
      <path
        d={`M ${x} ${bottom} L ${x} ${top + r} Q ${x} ${top} ${x + r} ${top} L ${x + barW - r} ${top} Q ${x + barW} ${top} ${x + barW} ${top + r} L ${x + barW} ${bottom} Z`}
        fill={color}
      />
    );
  };

  const hp = hover !== null ? points[hover] : null;

  return (
    <div className="trend">
      <div className="chart-legend">
        <span className="legend-item"><span className="legend-swatch" style={{ background: INCOME_COLOR }} />{incomeLabel}</span>
        <span className="legend-item"><span className="legend-swatch" style={{ background: EXPENSE_COLOR }} />{expenseLabel}</span>
      </div>
      <div className="trend-plot" ref={plotRef}>
        <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="trend-svg" role="img" aria-label={`${incomeLabel} / ${expenseLabel}`} onMouseLeave={() => setHover(null)}>
          {ticks.map((tk) => (
            <g key={tk}>
              <line x1={PAD_L} x2={W - PAD_R} y1={y(tk)} y2={y(tk)} className={tk === 0 ? "chart-baseline" : "chart-grid"} />
              <text x={PAD_L - 8} y={y(tk) + 4} textAnchor="end" className="chart-tick">{compact(tk)}</text>
            </g>
          ))}
          {points.map((p, i) => {
            const gx = PAD_L + i * groupW;
            const cx = gx + groupW / 2;
            return (
              <g key={p.label}>
                {hover === i && <rect x={gx + 2} y={PAD_T} width={groupW - 4} height={plotH} className="chart-hover-band" />}
                {bar(cx - barW - 1, p.income, INCOME_COLOR)}
                {bar(cx + 1, p.expense, EXPENSE_COLOR)}
                <text x={cx} y={H - 8} textAnchor="middle" className="chart-tick">{p.label}</text>
                <rect
                  x={gx}
                  y={PAD_T}
                  width={groupW}
                  height={plotH + PAD_B}
                  fill="transparent"
                  onMouseEnter={() => setHover(i)}
                  onFocus={() => setHover(i)}
                  tabIndex={0}
                  aria-label={`${p.label}: ${incomeLabel} ${format(p.income)}, ${expenseLabel} ${format(p.expense)}`}
                />
              </g>
            );
          })}
        </svg>
        {hp && hover !== null && (
          <div
            className="chart-tooltip"
            style={{ left: `${((PAD_L + (hover + 0.5) * groupW) / W) * 100}%` }}
          >
            <div className="chart-tooltip-title">{hp.label}</div>
            <div className="chart-tooltip-row"><span className="legend-swatch" style={{ background: INCOME_COLOR }} />{incomeLabel}<strong>{format(hp.income)}</strong></div>
            <div className="chart-tooltip-row"><span className="legend-swatch" style={{ background: EXPENSE_COLOR }} />{expenseLabel}<strong>{format(hp.expense)}</strong></div>
            <div className="chart-tooltip-row chart-tooltip-net">{netLabel}<strong>{format(hp.income - hp.expense)}</strong></div>
          </div>
        )}
      </div>
    </div>
  );
}

function useWidth(fallback: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setW(Math.max(260, Math.round(entry.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

function niceBound(v: number): number {
  return v <= 0 ? 0 : niceMax(v);
}

export interface ColumnPoint {
  label: string;
  value: number | null; // null = no data (drawn as a gap, not a zero)
  detail?: string;
}

interface ColumnProps {
  points: ColumnPoint[];
  color: (v: number) => string;
  format: (v: number) => string;
  tick: (v: number) => string;
  ariaLabel: string;
  height?: number;
}

// One series of columns on one axis. Negative values hang below a zero
// baseline (savings rate), with the same rounded-end mark spec as the trend.
export function ColumnChart({ points, color, format, tick, ariaLabel, height = 180 }: ColumnProps) {
  const [hover, setHover] = useState<number | null>(null);
  const [ref, W] = useWidth(600);
  const H = height;
  const PAD_L = 48;
  const PAD_R = 8;
  const PAD_T = 10;
  const PAD_B = 26;
  const vals = points.map((p) => p.value ?? 0);
  const hi = niceBound(Math.max(0, ...vals));
  const lo = -niceBound(Math.max(0, ...vals.map((v) => -v)));
  const span = hi - lo || 1;
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;
  const slot = plotW / Math.max(points.length, 1);
  const barW = Math.min(26, slot * 0.6);
  const y = (v: number) => PAD_T + ((hi - v) / span) * plotH;
  const ticks = Array.from(new Set([lo, 0, hi]));

  const bar = (x: number, v: number, fill: string) => {
    const y0 = y(0);
    const y1 = y(v);
    const h = Math.abs(y1 - y0);
    if (h < 0.5) return null;
    const r = Math.min(4, h, barW / 2);
    if (v >= 0) {
      return <path d={`M ${x} ${y0} L ${x} ${y1 + r} Q ${x} ${y1} ${x + r} ${y1} L ${x + barW - r} ${y1} Q ${x + barW} ${y1} ${x + barW} ${y1 + r} L ${x + barW} ${y0} Z`} fill={fill} />;
    }
    return <path d={`M ${x} ${y0} L ${x} ${y1 - r} Q ${x} ${y1} ${x + r} ${y1} L ${x + barW - r} ${y1} Q ${x + barW} ${y1} ${x + barW} ${y1 - r} L ${x + barW} ${y0} Z`} fill={fill} />;
  };

  const hp = hover !== null ? points[hover] : null;
  return (
    <div className="trend-plot" ref={ref}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="trend-svg" role="img" aria-label={ariaLabel} onMouseLeave={() => setHover(null)}>
        {ticks.map((tk) => (
          <g key={tk}>
            <line x1={PAD_L} x2={W - PAD_R} y1={y(tk)} y2={y(tk)} className={tk === 0 ? "chart-baseline" : "chart-grid"} />
            <text x={PAD_L - 8} y={y(tk) + 4} textAnchor="end" className="chart-tick">{tick(tk)}</text>
          </g>
        ))}
        {points.map((p, i) => {
          const sx = PAD_L + i * slot;
          const showLabel = points.length <= 12 || i % Math.ceil(points.length / 12) === 0;
          return (
            <g key={`${p.label}-${i}`}>
              {hover === i && <rect x={sx + 1} y={PAD_T} width={slot - 2} height={plotH} className="chart-hover-band" />}
              {p.value != null && bar(sx + (slot - barW) / 2, p.value, color(p.value))}
              {showLabel && <text x={sx + slot / 2} y={H - 8} textAnchor="middle" className="chart-tick">{p.label}</text>}
              <rect
                x={sx}
                y={PAD_T}
                width={slot}
                height={plotH + PAD_B}
                fill="transparent"
                tabIndex={0}
                onMouseEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
                aria-label={`${p.label}: ${p.value == null ? "—" : format(p.value)}`}
              />
            </g>
          );
        })}
      </svg>
      {hp && hover !== null && (
        <div className="chart-tooltip" style={{ left: `${((PAD_L + (hover + 0.5) * slot) / W) * 100}%` }}>
          <div className="chart-tooltip-title">{hp.label}</div>
          <div className="chart-tooltip-row"><strong style={{ marginLeft: 0, paddingLeft: 0 }}>{hp.value == null ? "—" : format(hp.value)}</strong></div>
          {hp.detail && <div className="chart-tooltip-row">{hp.detail}</div>}
        </div>
      )}
    </div>
  );
}

// Sequential single-hue ramp stepped for the dark surface: near-zero sits
// darkest (recedes into the card), the biggest days are lightest.
export const HEAT_RAMP = ["#104281", "#1c5cab", "#2a78d6", "#5598e7", "#86b6ef"];

export interface HeatDay {
  date: string; // YYYY-MM-DD
  value: number;
  inRange: boolean;
}

// Week columns × weekday rows (Mon first), GitHub-contribution style.
export function Heatmap({
  days,
  weekdayLabels,
  format,
  dayLabel,
  lessLabel,
  moreLabel,
}: {
  days: HeatDay[];
  weekdayLabels: string[];
  format: (v: number) => string;
  dayLabel: (iso: string) => string;
  lessLabel: string;
  moreLabel: string;
}) {
  // Quantile buckets over the days that had spending: rent day or one big
  // purchase shouldn't flatten every ordinary day into the same shade.
  const spent = days.filter((d) => d.inRange && d.value > 0).map((d) => d.value).sort((a, b) => a - b);
  const cuts = HEAT_RAMP.slice(1).map((_, i) => spent[Math.floor(((i + 1) / HEAT_RAMP.length) * spent.length)] ?? Infinity);
  const level = (v: number) => (v <= 0 ? -1 : cuts.filter((c) => v >= c).length);
  const weeks: HeatDay[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));
  const big = weeks.length <= 6;

  return (
    <div className="heatmap-wrap">
      <div className={`heatmap ${big ? "is-big" : ""}`}>
        <div className="heatmap-labels">
          {weekdayLabels.map((l, i) => (
            <span key={l} className="chart-tick-html">{i % 2 === 0 || big ? l : ""}</span>
          ))}
        </div>
        {weeks.map((w, wi) => (
          <div key={wi} className="heatmap-col">
            {w.map((d) => {
              const lv = d.inRange ? level(d.value) : -2;
              return (
                <span
                  key={d.date}
                  className={`heatmap-cell ${lv === -2 ? "is-out" : lv === -1 ? "is-zero" : ""}`}
                  style={lv >= 0 ? { background: HEAT_RAMP[lv] } : undefined}
                  title={d.inRange ? `${dayLabel(d.date)}: ${format(d.value)}` : undefined}
                >
                  {big && d.inRange ? <span className="heatmap-daynum">{Number(d.date.slice(8))}</span> : null}
                </span>
              );
            })}
          </div>
        ))}
      </div>
      <div className="heatmap-legend">
        <span>{lessLabel}</span>
        <span className="heatmap-cell is-zero" />
        {HEAT_RAMP.map((c) => (
          <span key={c} className="heatmap-cell" style={{ background: c }} />
        ))}
        <span>{moreLabel}</span>
      </div>
    </div>
  );
}

export interface FlowNode {
  key: string;
  label: string;
  value: number;
  color: string;
}

// Money flow: income sources → total → where it went (plus "Saved", or
// "From savings" on the left when spending exceeded income). Band widths
// are proportional to amounts on one shared scale.
export function FlowChart({
  sources,
  uses,
  centerLabel,
  format,
}: {
  sources: FlowNode[];
  uses: FlowNode[];
  centerLabel: string;
  format: (v: number) => string;
}) {
  const [ref, W] = useWidth(640);
  const [hover, setHover] = useState<string | null>(null);
  const total = Math.max(
    sources.reduce((s, n) => s + n.value, 0),
    uses.reduce((s, n) => s + n.value, 0)
  );
  const GAP = 8;
  const NODE_W = 10;
  const MIN_SLOT = 34; // room for a two-line label, however thin the band
  const narrow = W < 520;
  const LABEL_W = narrow ? 108 : 150;
  const FLOW_H = 240;
  const k = total > 0 ? FLOW_H / total : 0;

  // Each node gets a slot at least MIN_SLOT tall so labels never collide;
  // the band itself stays proportional and sits centered in its slot.
  const layoutSide = (nodes: FlowNode[]) => {
    let y = 0;
    const out = nodes.map((n) => {
      const h = Math.max(n.value * k, 1.5);
      const slot = Math.max(h, MIN_SLOT);
      const node = { ...n, h, y: y + (slot - h) / 2, slotY: y, slot };
      y += slot + GAP;
      return node;
    });
    return { nodes: out, height: Math.max(0, y - GAP) };
  };
  const L = layoutSide(sources);
  const R = layoutSide(uses);
  const H = Math.max(FLOW_H, L.height, R.height) + 8;
  const shift = (side: { nodes: ReturnType<typeof layoutSide>["nodes"]; height: number }) => {
    const off = (H - side.height) / 2;
    return side.nodes.map((n) => ({ ...n, y: n.y + off, slotY: n.slotY + off }));
  };
  const left = shift(L);
  const right = shift(R);

  const xL = LABEL_W;
  const xC = W / 2 - NODE_W / 2;
  const xR = W - LABEL_W - NODE_W;
  const centerH = total * k;
  const centerY = (H - centerH) / 2;

  const band = (x0: number, y0: number, x1: number, y1: number, h: number) => {
    const mx = (x0 + x1) / 2;
    return `M ${x0} ${y0} C ${mx} ${y0}, ${mx} ${y1}, ${x1} ${y1} L ${x1} ${y1 + h} C ${mx} ${y1 + h}, ${mx} ${y0 + h}, ${x0} ${y0 + h} Z`;
  };

  let cyL = centerY;
  let cyR = centerY;
  const trunc = (s: string) => (narrow && s.length > 12 ? s.slice(0, 11) + "…" : s);

  return (
    <div className="flow-plot" ref={ref}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="trend-svg" role="img" aria-label={centerLabel} onMouseLeave={() => setHover(null)}>
        {left.map((n) => {
          const d = band(xL + NODE_W, n.y, xC, cyL, n.h);
          cyL += n.h;
          return (
            <path key={`l-${n.key}`} d={d} fill={n.color} opacity={hover && hover !== n.key ? 0.12 : 0.32} onMouseEnter={() => setHover(n.key)}>
              <title>{`${n.label} → ${centerLabel}: ${format(n.value)}`}</title>
            </path>
          );
        })}
        {right.map((n) => {
          const d = band(xC + NODE_W, cyR, xR, n.y, n.h);
          cyR += n.h;
          return (
            <path key={`r-${n.key}`} d={d} fill={n.color} opacity={hover && hover !== n.key ? 0.12 : 0.4} onMouseEnter={() => setHover(n.key)}>
              <title>{`${centerLabel} → ${n.label}: ${format(n.value)} (${pctText(n.value, total)})`}</title>
            </path>
          );
        })}
        <rect x={xC} y={centerY} width={NODE_W} height={Math.max(centerH, 1)} rx={3} fill="var(--text-3)" />
        {left.map((n) => (
          <g key={`ln-${n.key}`}>
            <rect x={xL} y={n.y} width={NODE_W} height={n.h} rx={3} fill={n.color} />
            <text x={xL - 6} y={n.slotY + n.slot / 2 - 2} textAnchor="end" className="flow-label">{trunc(n.label)}</text>
            <text x={xL - 6} y={n.slotY + n.slot / 2 + 12} textAnchor="end" className="flow-value">{format(n.value)}</text>
          </g>
        ))}
        {right.map((n) => (
          <g key={`rn-${n.key}`}>
            <rect x={xR} y={n.y} width={NODE_W} height={n.h} rx={3} fill={n.color} />
            <text x={xR + NODE_W + 6} y={n.slotY + n.slot / 2 - 2} className="flow-label">{trunc(n.label)}</text>
            <text x={xR + NODE_W + 6} y={n.slotY + n.slot / 2 + 12} className="flow-value">{format(n.value)}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}
